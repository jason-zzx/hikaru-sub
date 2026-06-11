use crate::settings::{load_settings, AppSettings};
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

/// FFmpeg 来源：用户设置 / 随应用捆绑 / 系统 PATH。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FfmpegSource {
    Settings,
    Bundled,
    System,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub available: bool,
    pub path: String,
    pub source: FfmpegSource,
    pub version: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractProgress {
    /// 已处理时长（毫秒）
    processed_ms: i64,
    /// 视频总时长（毫秒），未知时为 0
    duration_ms: i64,
    /// 0.0 ~ 1.0，总时长未知时为 None
    percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub duration_ms: i64,
}

const EXECUTABLE_NAME: &str = if cfg!(windows) {
    "ffmpeg.exe"
} else {
    "ffmpeg"
};

/// 随应用打包的 ffmpeg 路径（`resource_dir/binaries/ffmpeg`），仅在文件存在时返回。
fn bundled_ffmpeg(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?;
    let candidate = dir.join("binaries").join(EXECUTABLE_NAME);
    candidate.is_file().then_some(candidate)
}

/// 按优先级解析 ffmpeg 可执行路径：用户设置 → 捆绑 → 系统 PATH。
pub fn resolve_ffmpeg(app: &AppHandle, settings: &AppSettings) -> (String, FfmpegSource) {
    if let Some(path) = settings
        .ffmpeg_path
        .as_ref()
        .filter(|p| !p.trim().is_empty())
    {
        return (path.clone(), FfmpegSource::Settings);
    }
    if let Some(path) = bundled_ffmpeg(app) {
        return (path.to_string_lossy().into_owned(), FfmpegSource::Bundled);
    }
    (EXECUTABLE_NAME.to_string(), FfmpegSource::System)
}

pub fn ffmpeg_status(app: &AppHandle) -> FfmpegStatus {
    let settings = load_settings(app).unwrap_or_default();
    let (path, source) = resolve_ffmpeg(app, &settings);

    let output = Command::new(&path).arg("-version").output();
    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let version = stdout.lines().next().map(|s| s.to_string());
            FfmpegStatus {
                available: true,
                path,
                source,
                version,
            }
        }
        _ => FfmpegStatus {
            available: false,
            path,
            source,
            version: None,
        },
    }
}

#[tauri::command]
pub fn check_ffmpeg(app: AppHandle) -> FfmpegStatus {
    ffmpeg_status(&app)
}

/// 解析 `HH:MM:SS.cc` 为毫秒。
fn parse_hhmmss_ms(input: &str) -> Option<i64> {
    let s = input.trim();
    let (hms, frac) = s.split_once('.').unwrap_or((s, "0"));
    let mut parts = hms.split(':');
    let h: i64 = parts.next()?.trim().parse().ok()?;
    let m: i64 = parts.next()?.trim().parse().ok()?;
    let sec: i64 = parts.next()?.trim().parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    // ffmpeg 输出为厘秒（2 位），补足到毫秒
    let mut frac3 = String::with_capacity(3);
    frac3.push_str(frac);
    while frac3.len() < 3 {
        frac3.push('0');
    }
    let ms: i64 = frac3.get(0..3)?.parse().ok()?;
    Some(((h * 60 + m) * 60 + sec) * 1000 + ms)
}

/// 从 ffmpeg stderr 行中提取 `Duration:` 时长。
fn parse_duration_line(line: &str) -> Option<i64> {
    let idx = line.find("Duration:")?;
    let rest = &line[idx + "Duration:".len()..];
    let token = rest.split(',').next()?.trim();
    if token.starts_with("N/A") {
        return None;
    }
    parse_hhmmss_ms(token)
}

/// 从 ffmpeg 进度行中提取 `time=` 已处理时长。
fn parse_time_token(line: &str) -> Option<i64> {
    let idx = line.find("time=")?;
    let rest = &line[idx + "time=".len()..];
    let token = rest.split_whitespace().next()?;
    if token.starts_with("N/A") {
        return None;
    }
    parse_hhmmss_ms(token)
}

/// 提取音轨为 16kHz 单声道 PCM WAV（兼容 Whisper 系模型），过程中推送进度事件。
///
/// 进度事件名：`audio_extract_progress`，载荷见 `ExtractProgress`。
#[tauri::command]
pub async fn extract_audio(
    app: AppHandle,
    video_path: String,
    audio_path: String,
) -> Result<String, String> {
    let video = PathBuf::from(&video_path);
    if !video.is_file() {
        return Err(format!("视频文件不存在: {video_path}"));
    }
    if let Some(parent) = PathBuf::from(&audio_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let settings = load_settings(&app).unwrap_or_default();
    let (ffmpeg, _source) = resolve_ffmpeg(&app, &settings);
    let audio_out = audio_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        run_extract(&app, &ffmpeg, &video_path, &audio_path)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))??;

    Ok(audio_out)
}

fn run_extract(
    app: &AppHandle,
    ffmpeg: &str,
    video_path: &str,
    audio_path: &str,
) -> Result<(), String> {
    let mut child = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-y",
            "-i",
            video_path,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            audio_path,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 FFmpeg（{ffmpeg}）：{e}"))?;

    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 FFmpeg 输出".to_string())?;

    let mut duration_ms: i64 = 0;
    let mut tail = String::new();
    let mut buf = [0u8; 4096];
    let mut line: Vec<u8> = Vec::new();

    // ffmpeg 进度以 \r 刷新、信息以 \n 换行，需同时按两者切分
    loop {
        let n = stderr.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        for &byte in &buf[..n] {
            if byte == b'\n' || byte == b'\r' {
                if !line.is_empty() {
                    let text = String::from_utf8_lossy(&line).into_owned();
                    handle_stderr_line(app, &text, &mut duration_ms, &mut tail);
                    line.clear();
                }
            } else {
                line.push(byte);
            }
        }
    }
    if !line.is_empty() {
        let text = String::from_utf8_lossy(&line).into_owned();
        handle_stderr_line(app, &text, &mut duration_ms, &mut tail);
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("FFmpeg 提取音轨失败：{}", tail.trim()));
    }

    // 收尾：推送 100%
    let _ = app.emit(
        "audio_extract_progress",
        ExtractProgress {
            processed_ms: duration_ms,
            duration_ms,
            percent: Some(1.0),
        },
    );
    Ok(())
}

/// 使用 ffprobe 获取视频信息（分辨率、时长）
#[tauri::command]
pub async fn get_video_info(
    app: AppHandle,
    video_path: String,
) -> Result<VideoInfo, String> {
    let video = PathBuf::from(&video_path);
    if !video.is_file() {
        return Err(format!("视频文件不存在: {video_path}"));
    }

    let settings = load_settings(&app).unwrap_or_default();
    let (ffmpeg_path, _) = resolve_ffmpeg(&app, &settings);

    // ffprobe 通常与 ffmpeg 在同一目录
    let ffprobe = if ffmpeg_path.ends_with("ffmpeg.exe") || ffmpeg_path.ends_with("ffmpeg") {
        ffmpeg_path.replace("ffmpeg", "ffprobe")
    } else {
        "ffprobe".to_string()
    };

    let output = Command::new(&ffprobe)
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration",
            "-of", "csv=p=0",
            &video_path,
        ])
        .output()
        .map_err(|e| format!("执行 ffprobe 失败: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe 失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.trim().split(',').collect();

    if parts.len() < 2 {
        return Err("无法解析视频信息".to_string());
    }

    let width: u32 = parts[0].parse().map_err(|_| "无法解析宽度")?;
    let height: u32 = parts[1].parse().map_err(|_| "无法解析高度")?;

    // duration 可能为空或 N/A
    let duration_ms = if parts.len() >= 3 {
        parts[2].parse::<f64>().ok().map(|d| (d * 1000.0) as i64).unwrap_or(0)
    } else {
        0
    };

    Ok(VideoInfo {
        width,
        height,
        duration_ms,
    })
}

/// 提取音频波形数据（峰值数组），用于 Timeline 渲染
#[tauri::command]
pub async fn extract_waveform(
    app: AppHandle,
    video_path: String,
    samples: usize,
) -> Result<Vec<f32>, String> {
    let settings = load_settings(&app).unwrap_or_default();
    let (ffmpeg, _) = resolve_ffmpeg(&app, &settings);

    tauri::async_runtime::spawn_blocking(move || {
        run_extract_waveform(&ffmpeg, &video_path, samples)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

fn run_extract_waveform(ffmpeg: &str, video_path: &str, samples: usize) -> Result<Vec<f32>, String> {
    // FFmpeg 提取 16bit PCM，单声道，16kHz
    let mut child = Command::new(ffmpeg)
        .args([
            "-i", video_path,
            "-vn",
            "-f", "s16le",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("无法启动 FFmpeg: {e}"))?;

    let mut stdout = child.stdout.take().ok_or("无法读取输出")?;
    let mut pcm_data = Vec::new();
    stdout.read_to_end(&mut pcm_data).map_err(|e| format!("读取失败: {e}"))?;

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("FFmpeg 提取音频失败".to_string());
    }

    // 转换为 i16 样本
    let mut audio_samples = Vec::with_capacity(pcm_data.len() / 2);
    for chunk in pcm_data.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
        audio_samples.push(sample);
    }

    // 下采样计算峰值
    let chunk_size = audio_samples.len() / samples.max(1);
    let mut peaks = Vec::with_capacity(samples);

    for i in 0..samples {
        let start = i * chunk_size;
        let end = ((i + 1) * chunk_size).min(audio_samples.len());
        if start >= audio_samples.len() {
            peaks.push(0.0);
            continue;
        }

        let chunk = &audio_samples[start..end];
        let max = chunk.iter().map(|&s| s.abs_diff(0)).max().unwrap_or(0);
        peaks.push(max as f32 / 32768.0); // 归一化到 0-1
    }

    Ok(peaks)
}

fn handle_stderr_line(app: &AppHandle, text: &str, duration_ms: &mut i64, tail: &mut String) {
    if *duration_ms == 0 {
        if let Some(d) = parse_duration_line(text) {
            *duration_ms = d;
        }
    }
    if let Some(processed) = parse_time_token(text) {
        let percent = (*duration_ms > 0)
            .then(|| (processed as f64 / *duration_ms as f64).clamp(0.0, 1.0));
        let _ = app.emit(
            "audio_extract_progress",
            ExtractProgress {
                processed_ms: processed,
                duration_ms: *duration_ms,
                percent,
            },
        );
    }
    // 保留最近一行非空输出，失败时作为错误信息
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        *tail = trimmed.to_string();
    }
}
