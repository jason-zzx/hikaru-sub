//! Portable vs installed app data roots.
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

const PORTABLE_MARKER: &str = ".portable";
const WEBVIEW2_USER_DATA_FOLDER: &str = "WEBVIEW2_USER_DATA_FOLDER";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortableRoots {
    pub data: PathBuf,
    pub cache: PathBuf,
    pub webview: PathBuf,
}

pub fn detect_portable(exe_dir: &Path) -> bool {
    exe_dir.join(PORTABLE_MARKER).is_file()
}

pub fn portable_roots(exe_dir: &Path) -> PortableRoots {
    PortableRoots {
        data: exe_dir.join("data"),
        cache: exe_dir.join("cache"),
        webview: exe_dir.join("webview"),
    }
}

fn exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    exe.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| format!("无法解析可执行文件目录：{}", exe.display()))
}

static PORTABLE: OnceLock<bool> = OnceLock::new();

/// 仅在 `bootstrap_portable_paths` 成功完成后才可能为 true。
/// 尚未 bootstrap、或 bootstrap 失败退出前，一律视为非便携。
pub fn is_portable() -> bool {
    *PORTABLE.get().unwrap_or(&false)
}

/// 检测标记并完成目录/WebView 初始化；成功后才把 `is_portable()` 置为 true。
fn resolve_portable_flag(exe_dir: &Path) -> Result<bool, String> {
    if !detect_portable(exe_dir) {
        return Ok(false);
    }
    apply_portable_bootstrap(exe_dir)?;
    Ok(true)
}

/// Call before WebView/Tauri window creation.
/// 失败时由调用方弹框并退出；不会把 `is_portable` 锁成 true。
pub fn bootstrap_portable_paths() -> Result<(), String> {
    let dir = exe_dir()?;
    let portable = resolve_portable_flag(&dir)?;
    let _ = PORTABLE.set(portable);
    Ok(())
}

pub fn apply_portable_bootstrap(exe_dir: &Path) -> Result<PortableRoots, String> {
    if !detect_portable(exe_dir) {
        return Err("当前不是便携模式".into());
    }
    let roots = portable_roots(exe_dir);
    for path in [&roots.data, &roots.cache, &roots.webview] {
        std::fs::create_dir_all(path)
            .map_err(|e| format!("无法创建 portable 目录 {}: {e}", path.display()))?;
    }
    // Called once at process start before other threads touch WebView2.
    unsafe {
        std::env::set_var(WEBVIEW2_USER_DATA_FOLDER, &roots.webview);
    }
    Ok(roots)
}

/// 启动致命错误：弹框提示，用户确认后结束进程。
pub fn show_fatal_startup_error_and_exit(error: &str) -> ! {
    let message = format!(
        "便携模式初始化失败，应用即将退出。\n\n{error}\n\n请确认程序所在目录可写，或将软件复制到有写入权限的位置后重试。"
    );
    show_startup_error_dialog("Hikaru Sub", &message);
    std::process::exit(1);
}

#[cfg(windows)]
fn show_startup_error_dialog(title: &str, body: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            hwnd: *mut core::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            flags: u32,
        ) -> i32;
    }

    const MB_OK: u32 = 0x0000_0000;
    const MB_ICONERROR: u32 = 0x0000_0010;
    const MB_SETFOREGROUND: u32 = 0x0001_0000;
    const MB_TOPMOST: u32 = 0x0004_0000;

    let text: Vec<u16> = OsStr::new(body).encode_wide().chain(Some(0)).collect();
    let caption: Vec<u16> = OsStr::new(title).encode_wide().chain(Some(0)).collect();
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_OK | MB_ICONERROR | MB_SETFOREGROUND | MB_TOPMOST,
        );
    }
}

#[cfg(not(windows))]
fn show_startup_error_dialog(title: &str, body: &str) {
    eprintln!("{title}: {body}");
}

pub fn app_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if is_portable() {
        return Ok(portable_roots(&exe_dir()?).data);
    }
    app.path()
        .app_config_dir()
        .map_err(|e| e.to_string())
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if is_portable() {
        return Ok(portable_roots(&exe_dir()?).data);
    }
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
}

pub fn work_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if is_portable() {
        return Ok(portable_roots(&exe_dir()?).cache);
    }
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法读取应用缓存目录: {e}"))?;
    Ok(root.join("cache"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn detect_portable_requires_marker_file() {
        let dir = tempdir().unwrap();
        assert!(!detect_portable(dir.path()));
        fs::write(dir.path().join(".portable"), b"").unwrap();
        assert!(detect_portable(dir.path()));
    }

    #[test]
    fn portable_roots_are_flat_siblings() {
        let exe_dir = PathBuf::from("C:/apps/hikaru-sub");
        let roots = portable_roots(&exe_dir);
        assert_eq!(roots.data, exe_dir.join("data"));
        assert_eq!(roots.cache, exe_dir.join("cache"));
        assert_eq!(roots.webview, exe_dir.join("webview"));
    }

    #[test]
    fn apply_portable_bootstrap_creates_dirs_and_sets_webview_env() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(".portable"), b"").unwrap();
        let prev = std::env::var_os(WEBVIEW2_USER_DATA_FOLDER);
        let roots = apply_portable_bootstrap(dir.path()).unwrap();
        assert!(roots.data.is_dir());
        assert!(roots.cache.is_dir());
        assert!(roots.webview.is_dir());
        assert_eq!(
            std::env::var_os(WEBVIEW2_USER_DATA_FOLDER).unwrap(),
            roots.webview.as_os_str()
        );
        match prev {
            Some(v) => unsafe { std::env::set_var(WEBVIEW2_USER_DATA_FOLDER, v) },
            None => unsafe { std::env::remove_var(WEBVIEW2_USER_DATA_FOLDER) },
        }
    }

    #[test]
    fn resolve_portable_flag_false_without_marker() {
        let dir = tempdir().unwrap();
        assert!(!resolve_portable_flag(dir.path()).unwrap());
    }

    #[test]
    fn resolve_portable_flag_true_after_successful_bootstrap() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(".portable"), b"").unwrap();
        let prev = std::env::var_os(WEBVIEW2_USER_DATA_FOLDER);
        assert!(resolve_portable_flag(dir.path()).unwrap());
        match prev {
            Some(v) => unsafe { std::env::set_var(WEBVIEW2_USER_DATA_FOLDER, v) },
            None => unsafe { std::env::remove_var(WEBVIEW2_USER_DATA_FOLDER) },
        }
    }

    #[test]
    fn resolve_portable_flag_errors_when_data_path_blocked() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(".portable"), b"").unwrap();
        // 用同名文件挡住 data/ 目录创建，模拟无写权限/冲突。
        fs::write(dir.path().join("data"), b"blocked").unwrap();
        let err = resolve_portable_flag(dir.path()).unwrap_err();
        assert!(err.contains("无法创建 portable 目录"), "{err}");
    }
}
