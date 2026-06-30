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
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string();
        fonts.push(PreviewFontFile {
            path: path.to_string_lossy().to_string(),
            url,
            file_name,
        });
    }

    Ok(fonts)
}

#[cfg(test)]
mod tests {
    use super::is_supported_font;
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
}
