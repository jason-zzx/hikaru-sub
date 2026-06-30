use crate::ffmpeg::resolve_ffmpeg;
use crate::media_server::MediaServer;
use crate::settings::load_settings;
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderSubtitlePreviewFrameArgs {
    pub video_path: String,
    pub ass_text: String,
    pub time_ms: u64,
    pub font_dir: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderSubtitlePreviewFrameResult {
    pub image_path: String,
    pub image_url: String,
}

#[tauri::command]
pub async fn render_subtitle_preview_frame(
    app: AppHandle,
    args: RenderSubtitlePreviewFrameArgs,
    server: State<'_, MediaServer>,
) -> Result<RenderSubtitlePreviewFrameResult, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法读取应用缓存目录: {e}"))?
        .join("preview");
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("无法创建预览缓存目录: {e}"))?;

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let file_stem = build_preview_file_stem(args.time_ms, nonce);
    let ass_path = cache_dir.join(format!("{file_stem}.ass"));
    std::fs::write(&ass_path, args.ass_text).map_err(|e| format!("无法写入预览 ASS: {e}"))?;

    let image_path = cache_dir.join(format!("{file_stem}.png"));
    let seconds = format!("{:.3}", args.time_ms as f64 / 1000.0);
    let filter = build_subtitles_filter(&ass_path.to_string_lossy(), args.font_dir.as_deref());
    let settings = load_settings(&app).unwrap_or_default();
    let (ffmpeg, _) = resolve_ffmpeg(&app, &settings);

    let output = Command::new(ffmpeg)
        .arg("-hide_banner")
        .arg("-y")
        .arg("-ss")
        .arg(seconds)
        .arg("-i")
        .arg(&args.video_path)
        .arg("-frames:v")
        .arg("1")
        .arg("-vf")
        .arg(filter)
        .arg("-an")
        .arg(&image_path)
        .output()
        .map_err(|e| format!("无法启动 FFmpeg 预览渲染: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "FFmpeg 预览渲染失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let image_url = server.register_path(image_path.clone())?;
    Ok(RenderSubtitlePreviewFrameResult {
        image_path: image_path.to_string_lossy().to_string(),
        image_url,
    })
}

fn escape_filter_path(path: &str) -> String {
    path.replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "\\'")
}

fn build_subtitles_filter(ass_path: &str, font_dir: Option<&str>) -> String {
    let mut filter = format!("ass=filename='{}'", escape_filter_path(ass_path));
    if let Some(font_dir) = font_dir.map(str::trim).filter(|value| !value.is_empty()) {
        filter.push_str(&format!(":fontsdir='{}'", escape_filter_path(font_dir)));
    }
    filter
}

fn build_preview_file_stem(time_ms: u64, nonce: u128) -> String {
    format!("preview-{time_ms}-{nonce}")
}

#[cfg(test)]
mod tests {
    use super::{build_preview_file_stem, build_subtitles_filter, escape_filter_path};

    #[test]
    fn escapes_windows_paths_for_ffmpeg_filter() {
        assert_eq!(
            escape_filter_path(r"F:\creates\hikaroom32\.hikaru\subtitles.ass"),
            "F\\:/creates/hikaroom32/.hikaru/subtitles.ass",
        );
    }

    #[test]
    fn builds_filter_with_optional_font_dir() {
        let filter = build_subtitles_filter(
            r"F:\creates\hikaroom32\.hikaru\subtitles.ass",
            Some(r"C:\Windows\Fonts"),
        );
        assert!(filter.contains("ass=filename='F\\:/creates/hikaroom32/.hikaru/subtitles.ass'"));
        assert!(filter.contains("fontsdir='C\\:/Windows/Fonts'"));
    }

    #[test]
    fn preview_file_stem_includes_time_and_nonce() {
        assert_eq!(build_preview_file_stem(1234, 5678), "preview-1234-5678");
    }
}
