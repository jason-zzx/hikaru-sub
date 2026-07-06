use crate::dependencies::{resolve_ffmpeg_paths, ResolvedFfmpegSource};
use crate::process::hidden_command;
use crate::settings::{load_settings, AppSettings};
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};

/// FFmpeg 来源：用户设置 / 受管下载 / 系统 PATH。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FfmpegSource {
    Settings,
    Managed,
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
    /// 视频帧率（r_frame_rate 优先，回退 avg_frame_rate），无法解析时为 None
    pub fps: Option<f64>,
}

/// 与 `resolve_ffmpeg` 同目录解析 ffprobe 可执行路径。
pub fn resolve_ffprobe(app: &AppHandle, settings: &AppSettings) -> String {
    resolve_ffmpeg_paths(app, settings).ffprobe
}

/// 按优先级解析 ffmpeg 可执行路径：用户设置 → 系统 PATH → 受管下载。
pub fn resolve_ffmpeg(app: &AppHandle, settings: &AppSettings) -> (String, FfmpegSource) {
    let resolved = resolve_ffmpeg_paths(app, settings);
    let source = match resolved.source {
        ResolvedFfmpegSource::Settings => FfmpegSource::Settings,
        ResolvedFfmpegSource::Managed => FfmpegSource::Managed,
        ResolvedFfmpegSource::System | ResolvedFfmpegSource::Missing => FfmpegSource::System,
    };
    (resolved.ffmpeg, source)
}

pub fn ffmpeg_status(app: &AppHandle) -> FfmpegStatus {
    let settings = load_settings(app).unwrap_or_default();
    let (path, source) = resolve_ffmpeg(app, &settings);

    let output = hidden_command(&path).arg("-version").output();
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
    let mut child = hidden_command(ffmpeg)
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

/// 解析 ffprobe 的 "30000/1001" 形式帧率；无效（0/0、N/A、非正数）返回 None。
fn parse_rational_fps(value: &str) -> Option<f64> {
    let v = value.trim();
    if v.is_empty() || v == "N/A" {
        return None;
    }
    if let Some((num, den)) = v.split_once('/') {
        let num: f64 = num.parse().ok()?;
        let den: f64 = den.parse().ok()?;
        if den == 0.0 || num <= 0.0 {
            return None;
        }
        return Some(num / den);
    }
    v.parse::<f64>().ok().filter(|f| *f > 0.0)
}

/// 解析 ffprobe `-of default=noprint_wrappers=1` 的 key=value 输出。
fn parse_video_info_output(stdout: &str) -> Result<VideoInfo, String> {
    let mut width: Option<u32> = None;
    let mut height: Option<u32> = None;
    let mut duration_ms: i64 = 0;
    let mut r_fps: Option<f64> = None;
    let mut avg_fps: Option<f64> = None;

    for line in stdout.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        match key {
            "width" => width = value.parse().ok(),
            "height" => height = value.parse().ok(),
            "duration" => {
                duration_ms = value
                    .parse::<f64>()
                    .ok()
                    .map(|d| (d * 1000.0) as i64)
                    .unwrap_or(0)
            }
            "r_frame_rate" => r_fps = parse_rational_fps(value),
            "avg_frame_rate" => avg_fps = parse_rational_fps(value),
            _ => {}
        }
    }

    let width = width.ok_or("无法解析宽度")?;
    let height = height.ok_or("无法解析高度")?;
    Ok(VideoInfo {
        width,
        height,
        duration_ms,
        fps: r_fps.or(avg_fps),
    })
}

/// 使用 ffprobe 获取视频信息（分辨率、时长、帧率）
#[tauri::command]
pub async fn get_video_info(app: AppHandle, video_path: String) -> Result<VideoInfo, String> {
    let video = PathBuf::from(&video_path);
    if !video.is_file() {
        return Err(format!("视频文件不存在: {video_path}"));
    }

    let settings = load_settings(&app).unwrap_or_default();
    let ffprobe = resolve_ffprobe(&app, &settings);

    let output = hidden_command(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration,r_frame_rate,avg_frame_rate",
            "-of",
            "default=noprint_wrappers=1",
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

    parse_video_info_output(&String::from_utf8_lossy(&output.stdout))
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

fn run_extract_waveform(
    ffmpeg: &str,
    video_path: &str,
    samples: usize,
) -> Result<Vec<f32>, String> {
    // FFmpeg 提取 16bit PCM，单声道，16kHz
    let mut child = hidden_command(ffmpeg)
        .args([
            "-i",
            video_path,
            "-vn",
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("无法启动 FFmpeg: {e}"))?;

    let mut stdout = child.stdout.take().ok_or("无法读取输出")?;
    let mut pcm_data = Vec::new();
    stdout
        .read_to_end(&mut pcm_data)
        .map_err(|e| format!("读取失败: {e}"))?;

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
        let percent =
            (*duration_ms > 0).then(|| (processed as f64 / *duration_ms as f64).clamp(0.0, 1.0));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_video_info_normal() {
        let out = "width=1920\nheight=1080\nr_frame_rate=30000/1001\navg_frame_rate=30000/1001\nduration=1445.361000\n";
        let info = parse_video_info_output(out).unwrap();
        assert_eq!(info.width, 1920);
        assert_eq!(info.height, 1080);
        assert_eq!(info.duration_ms, 1445361);
        let fps = info.fps.unwrap();
        assert!((fps - 29.97).abs() < 0.01);
    }

    #[test]
    fn parse_video_info_r_frame_rate_invalid_falls_back_to_avg() {
        let out = "width=1280\nheight=720\nr_frame_rate=0/0\navg_frame_rate=25/1\nduration=10.0\n";
        let info = parse_video_info_output(out).unwrap();
        assert_eq!(info.fps, Some(25.0));
    }

    #[test]
    fn parse_video_info_missing_fps_and_duration() {
        let out = "width=640\nheight=480\nr_frame_rate=N/A\navg_frame_rate=0/0\n";
        let info = parse_video_info_output(out).unwrap();
        assert_eq!(info.fps, None);
        assert_eq!(info.duration_ms, 0);
    }

    #[test]
    fn parse_video_info_missing_dimensions_errors() {
        assert!(parse_video_info_output("duration=1.0\n").is_err());
    }
}
