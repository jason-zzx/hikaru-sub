//! Fixed-path application style library: `<app_config_dir>/style-library.json`.
//! Rust owns only path resolution and text I/O; schema lives on the frontend.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

const STYLE_LIBRARY_FILENAME: &str = "style-library.json";

pub fn style_library_path_for(config_dir: &Path) -> PathBuf {
    config_dir.join(STYLE_LIBRARY_FILENAME)
}

fn style_library_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::app_paths::app_config_dir(app)
        .map_err(|e| format!("无法解析样式库配置目录：{e}"))?;
    Ok(style_library_path_for(&dir))
}

/// Load raw library text. `Ok(None)` means the file does not exist.
pub fn load_style_library_text(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("读取样式库失败（{}）：{err}", path.display())),
    }
}

/// Write `content` via same-directory temp file + platform replacement.
pub fn save_style_library_text(path: &Path, content: &str) -> Result<(), String> {
    save_style_library_text_with(path, content, replace_file)
}

fn save_style_library_text_with(
    path: &Path,
    content: &str,
    replace: fn(&Path, &Path) -> Result<(), String>,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法解析样式库父目录：{}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("无法创建样式库配置目录（{}）：{err}", parent.display()))?;

    let temp_path = unique_temp_path(parent);
    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|err| format!("无法创建样式库临时文件（{}）：{err}", temp_path.display()))?;
        file.write_all(content.as_bytes())
            .map_err(|err| format!("写入样式库临时文件失败（{}）：{err}", temp_path.display()))?;
        // Ensure OS buffer is committed before replacement.
        file.sync_all()
            .map_err(|err| format!("同步样式库临时文件失败（{}）：{err}", temp_path.display()))?;
        drop(file);
        replace(&temp_path, path)
            .map_err(|err| format!("保存样式库失败（{}）：{err}", path.display()))?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn unique_temp_path(parent: &Path) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    // ponytail: pid+nanos is enough; no need for uuid crate.
    parent.join(format!(
        ".style-library.{}.{}.tmp",
        std::process::id(),
        nanos
    ))
}

/// Platform-correct same-directory replacement. Never deletes dest first.
fn replace_file(temp: &Path, dest: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        replace_file_windows(temp, dest)
    }
    #[cfg(not(windows))]
    {
        fs::rename(temp, dest).map_err(|err| err.to_string())
    }
}

#[cfg(windows)]
fn replace_file_windows(temp: &Path, dest: &Path) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(
            lp_replaced_file_name: *const u16,
            lp_replacement_file_name: *const u16,
            lp_backup_file_name: *const u16,
            dw_replace_flags: u32,
            lp_exclude: *mut core::ffi::c_void,
            lp_reserved: *mut core::ffi::c_void,
        ) -> i32;

        fn MoveFileExW(
            lp_existing_file_name: *const u16,
            lp_new_file_name: *const u16,
            dw_flags: u32,
        ) -> i32;

        fn GetLastError() -> u32;
    }

    const REPLACEFILE_WRITE_THROUGH: u32 = 0x0000_0001;
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;

    fn wide(path: &Path) -> Vec<u16> {
        OsStr::new(path).encode_wide().chain(Some(0)).collect()
    }

    let temp_w = wide(temp);
    let dest_w = wide(dest);

    if dest.exists() {
        let ok = unsafe {
            ReplaceFileW(
                dest_w.as_ptr(),
                temp_w.as_ptr(),
                ptr::null(),
                REPLACEFILE_WRITE_THROUGH,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            let code = unsafe { GetLastError() };
            return Err(format!("ReplaceFileW 失败（错误码 {code}）"));
        }
        return Ok(());
    }

    let ok = unsafe {
        MoveFileExW(
            temp_w.as_ptr(),
            dest_w.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        let code = unsafe { GetLastError() };
        return Err(format!("MoveFileExW 失败（错误码 {code}）"));
    }
    Ok(())
}

#[tauri::command]
pub fn load_style_library(app: AppHandle) -> Result<Option<String>, String> {
    let path = style_library_path(&app)?;
    load_style_library_text(&path)
}

#[tauri::command]
pub fn save_style_library(app: AppHandle, content: String) -> Result<(), String> {
    let path = style_library_path(&app)?;
    save_style_library_text(&path, &content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn fixed_path_is_config_dir_join_filename() {
        let root = PathBuf::from("C:/apps/hikaru-sub/data");
        assert_eq!(
            style_library_path_for(&root),
            root.join("style-library.json")
        );
    }

    #[test]
    fn missing_file_returns_none() {
        let dir = tempdir().unwrap();
        let path = style_library_path_for(dir.path());
        assert!(matches!(load_style_library_text(&path), Ok(None)));
    }

    #[test]
    fn write_creates_directory_and_round_trips() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("nested-config");
        let path = style_library_path_for(&nested);
        let body = r#"{"version":1,"styles":[]}"#;
        save_style_library_text(&path, body).unwrap();
        assert_eq!(
            load_style_library_text(&path).unwrap().as_deref(),
            Some(body)
        );
        assert!(nested.is_dir());
    }

    #[test]
    fn failed_replacement_preserves_destination_and_cleans_temp() {
        let dir = tempdir().unwrap();
        let path = style_library_path_for(dir.path());
        fs::write(&path, "previous").unwrap();

        let err = save_style_library_text_with(&path, "next", |_temp, _dest| {
            Err("controlled failure".into())
        })
        .unwrap_err();
        assert!(
            err.contains("controlled failure") || err.contains("保存样式库失败"),
            "{err}"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "previous");

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".tmp") || name.starts_with(".style-library."))
            .collect();
        assert!(leftovers.is_empty(), "temp files left: {leftovers:?}");
    }

    #[test]
    fn failed_first_run_seed_leaves_no_library_file() {
        let dir = tempdir().unwrap();
        let path = style_library_path_for(dir.path());
        assert!(!path.exists());

        let _ = save_style_library_text_with(&path, r#"{"version":1,"styles":[]}"#, |_t, _d| {
            Err("seed boom".into())
        });
        assert!(!path.exists());
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains("style-library"))
            .collect();
        assert!(leftovers.is_empty(), "leftovers: {leftovers:?}");
    }

    #[test]
    fn read_error_is_contextual_not_missing() {
        let dir = tempdir().unwrap();
        // On Windows, opening a directory as a file yields a read error.
        let path = dir.path().to_path_buf();
        let err = load_style_library_text(&path).unwrap_err();
        assert!(err.contains("读取样式库失败"), "{err}");
        assert!(!err.contains("null"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_replace_overwrites_existing() {
        let dir = tempdir().unwrap();
        let path = style_library_path_for(dir.path());
        fs::write(&path, "old").unwrap();
        save_style_library_text(&path, "new").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_rename_overwrites_existing() {
        let dir = tempdir().unwrap();
        let path = style_library_path_for(dir.path());
        fs::write(&path, "old").unwrap();
        save_style_library_text(&path, "new").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }
}
