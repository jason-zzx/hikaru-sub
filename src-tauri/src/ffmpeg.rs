use crate::settings::{load_settings, AppSettings};
use serde::Serialize;
use std::process::Command;
use tauri::AppHandle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub available: bool,
    pub path: String,
    pub version: Option<String>,
}

fn resolve_ffmpeg_path(settings: &AppSettings) -> String {
    settings
        .ffmpeg_path
        .clone()
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "ffmpeg".into())
}

pub fn ffmpeg_status(app: &AppHandle) -> FfmpegStatus {
    let settings = load_settings(app).unwrap_or_default();
    let path = resolve_ffmpeg_path(&settings);

    let output = Command::new(&path).arg("-version").output();

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let version = stdout.lines().next().map(|s| s.to_string());
            FfmpegStatus {
                available: true,
                path,
                version,
            }
        }
        _ => FfmpegStatus {
            available: false,
            path,
            version: None,
        },
    }
}

#[tauri::command]
pub fn check_ffmpeg(app: AppHandle) -> FfmpegStatus {
    ffmpeg_status(&app)
}
