use crate::media_server::MediaServer;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFontFile {
    pub path: String,
    pub url: String,
    pub file_name: String,
    pub display_name: Option<String>,
    pub family_names: Vec<String>,
    pub font_names: Vec<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct FontMetadata {
    display_name: Option<String>,
    family_names: Vec<String>,
    font_names: Vec<String>,
}

#[derive(Debug, Clone)]
struct FontName {
    value: String,
    name_id: u16,
    platform_id: u16,
    language_id: u16,
}

fn is_supported_font(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("ttf") | Some("otf") | Some("ttc") | Some("otc")
    )
}

fn read_u16(data: &[u8], offset: usize) -> Option<u16> {
    let bytes = data.get(offset..offset + 2)?;
    Some(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn font_offsets(data: &[u8]) -> Vec<usize> {
    if data.get(0..4) != Some(b"ttcf") {
        return vec![0];
    }

    let Some(count) = read_u32(data, 8) else {
        return Vec::new();
    };
    let mut offsets = Vec::new();
    for index in 0..count as usize {
        let Some(offset) = read_u32(data, 12 + index * 4) else {
            break;
        };
        offsets.push(offset as usize);
    }
    offsets
}

fn table_offset(data: &[u8], font_offset: usize, tag: &[u8; 4]) -> Option<usize> {
    let table_count = read_u16(data, font_offset + 4)? as usize;
    let records_offset = font_offset + 12;

    for index in 0..table_count {
        let record_offset = records_offset + index * 16;
        if data.get(record_offset..record_offset + 4) == Some(tag) {
            return Some(read_u32(data, record_offset + 8)? as usize);
        }
    }

    None
}

fn decode_utf16be(bytes: &[u8]) -> Option<String> {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
        .collect();
    String::from_utf16(&units).ok()
}

fn decode_name_string(platform_id: u16, encoding_id: u16, bytes: &[u8]) -> Option<String> {
    let decoded = if platform_id == 0 || platform_id == 3 {
        decode_utf16be(bytes)
    } else if platform_id == 1 && encoding_id == 0 && bytes.is_ascii() {
        String::from_utf8(bytes.to_vec()).ok()
    } else if bytes.is_ascii() {
        String::from_utf8(bytes.to_vec()).ok()
    } else {
        None
    }?;

    let value = decoded.trim_matches('\0').trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn contains_cjk(value: &str) -> bool {
    value.chars().any(|ch| {
        matches!(
            ch as u32,
            0x2e80..=0x2eff
                | 0x3000..=0x303f
                | 0x3040..=0x30ff
                | 0x31f0..=0x31ff
                | 0x3400..=0x4dbf
                | 0x4e00..=0x9fff
                | 0xf900..=0xfaff
                | 0xff00..=0xffef
                | 0xac00..=0xd7af
        )
    })
}

fn language_rank(name: &FontName) -> u8 {
    if contains_cjk(&name.value) {
        return 0;
    }

    if name.platform_id == 3 {
        match name.language_id & 0x03ff {
            0x0004 => 1, // Chinese
            0x0011 => 2, // Japanese
            0x0012 => 3, // Korean
            0x0009 => 4, // English
            _ => 5,
        }
    } else {
        6
    }
}

fn name_id_rank(name_id: u16) -> u8 {
    if name_id == 16 {
        0
    } else {
        1
    }
}

fn push_unique_name(
    out: &mut Vec<String>,
    seen: &mut std::collections::HashSet<String>,
    value: String,
) {
    let key = value.to_lowercase();
    if seen.insert(key) {
        out.push(value);
    }
}

fn parse_font_metadata(data: &[u8]) -> FontMetadata {
    let mut names = Vec::new();

    for font_offset in font_offsets(data) {
        let Some(name_offset) = table_offset(data, font_offset, b"name") else {
            continue;
        };
        let Some(count) = read_u16(data, name_offset + 2) else {
            continue;
        };
        let Some(storage_offset) = read_u16(data, name_offset + 4) else {
            continue;
        };
        let storage_base = name_offset + storage_offset as usize;

        for index in 0..count as usize {
            let record_offset = name_offset + 6 + index * 12;
            let (
                Some(platform_id),
                Some(encoding_id),
                Some(language_id),
                Some(name_id),
                Some(length),
                Some(offset),
            ) = (
                read_u16(data, record_offset),
                read_u16(data, record_offset + 2),
                read_u16(data, record_offset + 4),
                read_u16(data, record_offset + 6),
                read_u16(data, record_offset + 8),
                read_u16(data, record_offset + 10),
            )
            else {
                continue;
            };

            if !matches!(name_id, 1 | 4 | 6 | 16) {
                continue;
            }

            let string_offset = storage_base + offset as usize;
            let Some(bytes) = data.get(string_offset..string_offset + length as usize) else {
                continue;
            };
            let Some(value) = decode_name_string(platform_id, encoding_id, bytes) else {
                continue;
            };
            names.push(FontName {
                value,
                name_id,
                platform_id,
                language_id,
            });
        }
    }

    names.sort_by_key(|name| {
        (
            language_rank(name),
            name_id_rank(name.name_id),
            name.value.to_lowercase(),
        )
    });

    let mut family_records: Vec<FontName> = names
        .iter()
        .filter(|name| name.name_id == 1 || name.name_id == 16)
        .cloned()
        .collect();
    family_records.sort_by_key(|name| {
        (
            language_rank(name),
            name_id_rank(name.name_id),
            name.value.to_lowercase(),
        )
    });

    let mut family_names = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for name in family_records {
        push_unique_name(&mut family_names, &mut seen, name.value);
    }

    let mut font_names = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for name in names {
        push_unique_name(&mut font_names, &mut seen, name.value);
    }

    FontMetadata {
        display_name: family_names.first().cloned(),
        family_names,
        font_names,
    }
}

fn default_font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "windows")]
    {
        dirs.push(PathBuf::from(r"C:\Windows\Fonts"));
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(
                PathBuf::from(local_app_data)
                    .join("Microsoft")
                    .join("Windows")
                    .join("Fonts"),
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        dirs.push(PathBuf::from("/System/Library/Fonts"));
        dirs.push(PathBuf::from("/Library/Fonts"));
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join("Library").join("Fonts"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        dirs.push(PathBuf::from("/usr/share/fonts"));
        dirs.push(PathBuf::from("/usr/local/share/fonts"));
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(
                PathBuf::from(&home)
                    .join(".local")
                    .join("share")
                    .join("fonts"),
            );
            dirs.push(PathBuf::from(home).join(".fonts"));
        }
    }

    dirs
}

fn collect_font_paths(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_font_paths(&path, out);
        } else if is_supported_font(&path) {
            out.push(path);
        }
    }
}

#[tauri::command]
pub fn discover_preview_fonts(
    extra_dirs: Vec<String>,
    server: State<'_, MediaServer>,
) -> Result<Vec<PreviewFontFile>, String> {
    let mut dirs = default_font_dirs();
    dirs.extend(
        extra_dirs
            .into_iter()
            .filter(|dir| !dir.trim().is_empty())
            .map(PathBuf::from),
    );

    let mut paths = Vec::new();
    for dir in dirs {
        collect_font_paths(&dir, &mut paths);
    }
    paths.sort();
    paths.dedup();

    let mut fonts = Vec::new();
    for path in paths {
        let url = server.register_path(path.clone())?;
        let metadata = std::fs::read(&path)
            .map(|bytes| parse_font_metadata(&bytes))
            .unwrap_or_default();
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string();
        fonts.push(PreviewFontFile {
            path: path.to_string_lossy().to_string(),
            url,
            file_name,
            display_name: metadata.display_name,
            family_names: metadata.family_names,
            font_names: metadata.font_names,
        });
    }

    Ok(fonts)
}

#[cfg(test)]
mod tests {
    use super::{is_supported_font, parse_font_metadata};
    use std::path::Path;

    #[test]
    fn recognizes_common_font_extensions() {
        assert!(is_supported_font(Path::new("NotoSansSC-Regular.ttf")));
        assert!(is_supported_font(Path::new("NotoSansSC-Regular.OTF")));
        assert!(is_supported_font(Path::new("NotoSansCJK.ttc")));
        assert!(is_supported_font(Path::new("Collection.OTC")));
    }

    #[test]
    fn rejects_non_font_extensions() {
        assert!(!is_supported_font(Path::new("readme.txt")));
        assert!(!is_supported_font(Path::new("video.mp4")));
        assert!(!is_supported_font(Path::new("font.woff2")));
    }

    #[test]
    fn parses_localized_font_family_names() {
        let font = minimal_name_table_font(&[
            (3, 1, 0x0409, 1, "Microsoft YaHei"),
            (3, 1, 0x0804, 1, "微软雅黑"),
        ]);

        let metadata = parse_font_metadata(&font);

        assert_eq!(metadata.display_name.as_deref(), Some("微软雅黑"));
        assert_eq!(
            metadata.family_names,
            vec!["微软雅黑".to_string(), "Microsoft YaHei".to_string()]
        );
        assert!(metadata.font_names.contains(&"Microsoft YaHei".to_string()));
        assert!(metadata.font_names.contains(&"微软雅黑".to_string()));
    }

    #[test]
    fn parses_full_and_postscript_font_names_for_lookup() {
        let font = minimal_name_table_font(&[
            (3, 1, 0x0804, 1, ".苹方-简"),
            (3, 1, 0x0409, 1, ".PingFang SC"),
            (3, 1, 0x0409, 4, ".PingFang SC Regular"),
            (3, 1, 0x0409, 6, "PingFangSC-Regular"),
        ]);

        let metadata = parse_font_metadata(&font);

        assert_eq!(metadata.display_name.as_deref(), Some(".苹方-简"));
        assert_eq!(
            metadata.family_names,
            vec![".苹方-简".to_string(), ".PingFang SC".to_string()]
        );
        assert!(metadata
            .font_names
            .contains(&"PingFangSC-Regular".to_string()));
        assert!(metadata
            .font_names
            .contains(&".PingFang SC Regular".to_string()));
    }

    fn write_u16(bytes: &mut [u8], offset: usize, value: u16) {
        bytes[offset] = (value >> 8) as u8;
        bytes[offset + 1] = value as u8;
    }

    fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset] = (value >> 24) as u8;
        bytes[offset + 1] = (value >> 16) as u8;
        bytes[offset + 2] = (value >> 8) as u8;
        bytes[offset + 3] = value as u8;
    }

    fn utf16be(value: &str) -> Vec<u8> {
        value
            .encode_utf16()
            .flat_map(|unit| [(unit >> 8) as u8, unit as u8])
            .collect()
    }

    fn minimal_name_table_font(records: &[(u16, u16, u16, u16, &str)]) -> Vec<u8> {
        let name_offset = 28;
        let string_offset = 6 + records.len() * 12;
        let strings: Vec<Vec<u8>> = records
            .iter()
            .map(|(_, _, _, _, value)| utf16be(value))
            .collect();
        let name_length = string_offset + strings.iter().map(Vec::len).sum::<usize>();
        let mut bytes = vec![0; name_offset + name_length];

        write_u32(&mut bytes, 0, 0x00010000);
        write_u16(&mut bytes, 4, 1);
        bytes[12..16].copy_from_slice(b"name");
        write_u32(&mut bytes, 20, name_offset as u32);
        write_u32(&mut bytes, 24, name_length as u32);

        write_u16(&mut bytes, name_offset, 0);
        write_u16(&mut bytes, name_offset + 2, records.len() as u16);
        write_u16(&mut bytes, name_offset + 4, string_offset as u16);

        let mut next_string_offset = 0;
        for (index, ((platform, encoding, language, name_id, _), string)) in
            records.iter().zip(strings.iter()).enumerate()
        {
            let record_offset = name_offset + 6 + index * 12;
            write_u16(&mut bytes, record_offset, *platform);
            write_u16(&mut bytes, record_offset + 2, *encoding);
            write_u16(&mut bytes, record_offset + 4, *language);
            write_u16(&mut bytes, record_offset + 6, *name_id);
            write_u16(&mut bytes, record_offset + 8, string.len() as u16);
            write_u16(&mut bytes, record_offset + 10, next_string_offset as u16);

            let output_offset = name_offset + string_offset + next_string_offset;
            bytes[output_offset..output_offset + string.len()].copy_from_slice(string);
            next_string_offset += string.len();
        }

        bytes
    }
}
