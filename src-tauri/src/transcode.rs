use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use crate::ffmpeg::{resolve_ffmpeg, resolve_ffprobe};
use crate::settings::load_settings;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProxyVideoFormat {
    Mp4H264,
}

impl ProxyVideoFormat {
    fn for_current_platform() -> Self {
        Self::Mp4H264
    }

    fn extension(self) -> &'static str {
        "mp4"
    }

    fn is_valid_video_codec(self, codec: &str) -> bool {
        let codec = codec.to_ascii_lowercase();
        codec == "h264"
    }
}

#[derive(Clone, serde::Serialize)]
struct TranscodeProgressEvent {
    percent: f32,
}

struct TranscodeJob {
    cache_path: PathBuf,
    completed: bool,
    progress: f32,
}

struct TranscodeState {
    cache_dir: PathBuf,
    jobs: Arc<Mutex<HashMap<String, TranscodeJob>>>,
}

impl TranscodeState {
    fn new(cache_dir: PathBuf) -> Self {
        fs::create_dir_all(&cache_dir).ok();
        Self {
            cache_dir,
            jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
pub async fn detect_video_codec(app: AppHandle, path: String) -> Result<String, String> {
    let settings = load_settings(&app)?;
    let ffprobe = resolve_ffprobe(&app, &settings);
    probe_video_codec(&ffprobe, &path)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPlaybackProbe {
    pub video_codec: String,
    pub audio_codec: Option<String>,
    pub format_name: String,
    pub needs_transcode: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    streams: Vec<FfprobeStream>,
    format: FfprobeFormat,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: String,
    codec_name: String,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    format_name: String,
}

/// 判断 WebView `<video>` 能否直接播放该文件（经本地 HTTP 服务提供）。
pub fn evaluate_playback_compat(
    format_name: &str,
    video_codec: &str,
    audio_codec: Option<&str>,
) -> (bool, Option<String>) {
    let video = video_codec.to_ascii_lowercase();
    const UNSUPPORTED_VIDEO: &[&str] =
        &["hevc", "h265", "av1", "mpeg2video", "vc1", "prores"];
    if UNSUPPORTED_VIDEO.iter().any(|codec| video.contains(codec)) {
        return (
            true,
            Some(format!("视频编码 {video_codec} 不受 WebView 直接播放支持")),
        );
    }

    let formats: Vec<&str> = format_name
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();

    if formats.iter().any(|f| *f == "webm") {
        if video.contains("vp") {
            return (false, None);
        }
        return (
            true,
            Some(format!("WebM 容器内的 {video_codec} 无法直接播放")),
        );
    }

    if formats.iter().any(|f| matches!(*f, "matroska" | "avi" | "mpegts" | "flv" | "asf" | "wmv")) {
        return (
            true,
            Some(format!(
                "容器格式 {format_name} 无法通过 HTML5 视频标签直接播放"
            )),
        );
    }

    const MP4_FAMILY: &[&str] = &["mov", "mp4", "m4v", "3gp", "3g2", "mj2"];
    if formats.iter().any(|f| MP4_FAMILY.contains(f)) {
        if video != "h264" && !video.contains("avc") {
            return (
                true,
                Some(format!("MP4 内视频编码 {video_codec} 可能无法直接播放")),
            );
        }
        if let Some(audio_codec) = audio_codec {
            let audio = audio_codec.to_ascii_lowercase();
            const SUPPORTED_AUDIO: &[&str] = &["aac", "mp3", "opus", "mpeg4generic", "mp4a"];
            if !SUPPORTED_AUDIO.iter().any(|codec| audio.contains(codec)) {
                return (
                    true,
                    Some(format!("MP4 内音频编码 {audio_codec} 可能无法直接播放")),
                );
            }
        }
        return (false, None);
    }

    (
        true,
        Some(format!("未知或不支持的容器格式 {format_name}")),
    )
}

fn probe_video_codec(ffprobe: &str, path: &str) -> Result<String, String> {
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .map_err(|e| format!("执行 ffprobe 失败: {}", e))?;

    if !output.status.success() {
        return Err("ffprobe 执行失败".to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn probe_video_playback_with_ffprobe(
    ffprobe: &str,
    path: &str,
) -> Result<VideoPlaybackProbe, String> {
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            path,
        ])
        .output()
        .map_err(|e| format!("执行 ffprobe 失败: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe 执行失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("解析 ffprobe 输出失败: {}", e))?;

    let video_codec = parsed
        .streams
        .iter()
        .find(|stream| stream.codec_type == "video")
        .map(|stream| stream.codec_name.clone())
        .ok_or_else(|| "未找到视频流".to_string())?;

    let audio_codec = parsed
        .streams
        .iter()
        .find(|stream| stream.codec_type == "audio")
        .map(|stream| stream.codec_name.clone());

    let format_name = parsed.format.format_name;
    let (needs_transcode, reason) = evaluate_playback_compat(
        &format_name,
        &video_codec,
        audio_codec.as_deref(),
    );

    Ok(VideoPlaybackProbe {
        video_codec,
        audio_codec,
        format_name,
        needs_transcode,
        reason,
    })
}

#[tauri::command]
pub async fn probe_video_playback(app: AppHandle, path: String) -> Result<VideoPlaybackProbe, String> {
    let settings = load_settings(&app)?;
    let ffprobe = resolve_ffprobe(&app, &settings);
    probe_video_playback_with_ffprobe(&ffprobe, &path)
}

fn proxy_cache_path(cache_dir: &PathBuf, hash: &str, format: ProxyVideoFormat) -> PathBuf {
    cache_dir.join(format!("{hash}.{}", format.extension()))
}

fn remove_stale_proxy_caches(cache_dir: &PathBuf, hash: &str) {
    for ext in ["webm"] {
        let stale = cache_dir.join(format!("{hash}.{ext}"));
        if stale.exists() {
            let _ = fs::remove_file(stale);
        }
    }
}

fn is_valid_proxy_cache(ffprobe: &str, cache_path: &Path, format: ProxyVideoFormat) -> bool {
    let Ok(metadata) = fs::metadata(cache_path) else {
        return false;
    };
    if metadata.len() < 10240 {
        return false;
    }

    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            cache_path.to_str().unwrap_or_default(),
        ])
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let codec = String::from_utf8_lossy(&output.stdout).trim().to_string();
            format.is_valid_video_codec(&codec)
        }
        _ => false,
    }
}

fn transcode_ffmpeg_args(input: &str, output: &str, _format: ProxyVideoFormat) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-i".into(),
        input.into(),
        "-vf".into(),
        "scale=-2:480".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "ultrafast".into(),
        "-g".into(),
        "1".into(),
        "-crf".into(),
        "22".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "128k".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-y".into(),
        output.into(),
    ]
}

#[tauri::command]
pub async fn start_transcode(
    app: AppHandle,
    video_path: String,
) -> Result<String, String> {
    let settings = load_settings(&app)?;
    let ffmpeg = resolve_ffmpeg(&app, &settings).0;
    let ffprobe = resolve_ffprobe(&app, &settings);
    let proxy_format = ProxyVideoFormat::for_current_platform();

    let state = app.state::<TranscodeState>();
    let mut jobs = state.jobs.lock().await;

    // 检查是否已有任务（包括进行中的任务）
    if let Some(job) = jobs.get(&video_path) {
        println!("Task already exists for: {}", video_path);
        if job.completed && job.cache_path.exists() {
            return Ok(job.cache_path.to_string_lossy().to_string());
        } else if !job.completed {
            // 任务进行中，直接返回缓存路径
            println!("Task in progress, returning cache path");
            return Ok(job.cache_path.to_string_lossy().to_string());
        }
    }

    let hash = format!("{:x}", md5::compute(&video_path));
    let cache_path = proxy_cache_path(&state.cache_dir, &hash, proxy_format);
    remove_stale_proxy_caches(&state.cache_dir, &hash);

    if cache_path.exists() {
        println!("Cache file exists, validating: {:?}", cache_path);
        if is_valid_proxy_cache(&ffprobe, &cache_path, proxy_format) {
            println!("Using existing cache: {:?}", cache_path);
            jobs.insert(
                video_path.clone(),
                TranscodeJob {
                    cache_path: cache_path.clone(),
                    completed: true,
                    progress: 100.0,
                },
            );
            return Ok(cache_path.to_string_lossy().to_string());
        }

        println!("Cache file invalid or corrupted, removing");
        let _ = fs::remove_file(&cache_path);
    }

    jobs.insert(
        video_path.clone(),
        TranscodeJob {
            cache_path: cache_path.clone(),
            completed: false,
            progress: 0.0,
        },
    );

    let output_path = cache_path.to_string_lossy().to_string();
    let input_path = video_path.clone();
    let jobs_handle = state.jobs.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        println!(
            "Starting transcode ({:?}): {} -> {}",
            proxy_format, input_path, output_path
        );

        // 先获取视频时长
        let duration_output = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                &input_path,
            ])
            .output();

        let total_duration: f64 = duration_output
            .ok()
            .and_then(|out| String::from_utf8_lossy(&out.stdout).trim().parse().ok())
            .unwrap_or(0.0);

        let args = transcode_ffmpeg_args(&input_path, &output_path, proxy_format);

        println!("FFmpeg args: {:?}", args);

        let child = Command::new(&ffmpeg)
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn();

        match child {
            Ok(mut process) => {
                if let Some(stderr) = process.stderr.take() {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines() {
                        if let Ok(line_text) = line {
                            // 解析 FFmpeg 进度：time=00:01:23.45
                            if let Some(time_pos) = line_text.find("time=") {
                                let time_str = &line_text[time_pos + 5..];
                                if let Some(end) = time_str.find(' ') {
                                    let time_token = &time_str[..end];
                                    if let Some(current) = parse_time_to_seconds(time_token) {
                                        let percent = if total_duration > 0.0 {
                                            (current / total_duration * 100.0).min(100.0) as f32
                                        } else {
                                            0.0
                                        };

                                        if let Ok(mut jobs) = jobs_handle.try_lock() {
                                            if let Some(job) = jobs.get_mut(&input_path) {
                                                job.progress = percent;
                                            }
                                        }

                                        let _ = app_handle.emit("transcode_progress", TranscodeProgressEvent { percent });
                                    }
                                }
                            }
                        }
                    }
                }

                let result = process.wait();
                match result {
                    Ok(status) if status.success() => {
                        println!("Transcode completed: {}", output_path);
                        if let Ok(mut jobs) = jobs_handle.try_lock() {
                            if let Some(job) = jobs.get_mut(&input_path) {
                                job.completed = true;
                                job.progress = 100.0;
                            }
                        }
                        let _ = app_handle.emit("transcode_progress", TranscodeProgressEvent { percent: 100.0 });
                    }
                    _ => {
                        println!("Transcode failed: {}", output_path);
                        let _ = fs::remove_file(&output_path);
                        if let Ok(mut jobs) = jobs_handle.try_lock() {
                            jobs.remove(&input_path);
                        }
                    }
                }
            }
            Err(e) => {
                println!("Failed to spawn ffmpeg: {}", e);
                if let Ok(mut jobs) = jobs_handle.try_lock() {
                    jobs.remove(&input_path);
                }
            }
        }
    });

    Ok(cache_path.to_string_lossy().to_string())
}

fn parse_time_to_seconds(time_str: &str) -> Option<f64> {
    // 解析 HH:MM:SS.ms 格式
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

#[tauri::command]
pub async fn check_transcode_progress(
    app: AppHandle,
    video_path: String,
) -> Result<TranscodeProgress, String> {
    let state = app.state::<TranscodeState>();
    let jobs = state.jobs.lock().await;

    if let Some(job) = jobs.get(&video_path) {
        if job.completed && job.cache_path.exists() {
            println!("Transcode completed, ready to play");
            return Ok(TranscodeProgress {
                ready: true,
                cache_path: job.cache_path.to_string_lossy().to_string(),
            });
        }

        if job.cache_path.exists() {
            if let Ok(metadata) = fs::metadata(&job.cache_path) {
                let size = metadata.len();
                println!(
                    "Transcode in progress - size: {} bytes, completed: {}",
                    size, job.completed
                );
            }
        }
    }

    Ok(TranscodeProgress {
        ready: false,
        cache_path: String::new(),
    })
}

#[derive(serde::Serialize)]
pub struct TranscodeProgress {
    ready: bool,
    cache_path: String,
}

#[tauri::command]
pub async fn stop_transcode(app: AppHandle, video_path: String) -> Result<(), String> {
    let state = app.state::<TranscodeState>();
    let mut jobs = state.jobs.lock().await;
    jobs.remove(&video_path);
    Ok(())
}

pub fn init_transcode_state(app: &mut tauri::App) {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| PathBuf::from(".cache"))
        .join("transcode");

    app.manage(TranscodeState::new(cache_dir));
}

#[cfg(test)]
mod tests {
    use super::evaluate_playback_compat;

    #[test]
    fn h264_in_mkv_needs_transcode() {
        let (needs, reason) = evaluate_playback_compat("matroska", "h264", Some("aac"));
        assert!(needs);
        assert!(reason.unwrap().contains("容器格式"));
    }

    #[test]
    fn h264_aac_mp4_can_play_directly() {
        let (needs, _) = evaluate_playback_compat(
            "mov,mp4,m4v,3gp,3g2,mj2",
            "h264",
            Some("aac"),
        );
        assert!(!needs);
    }

    #[test]
    fn mp4_with_ac3_needs_transcode() {
        let (needs, reason) = evaluate_playback_compat(
            "mov,mp4,m4v,3gp,3g2,mj2",
            "h264",
            Some("ac3"),
        );
        assert!(needs);
        assert!(reason.unwrap().contains("音频编码"));
    }

    #[test]
    fn webm_vp8_can_play_directly() {
        let (needs, _) = evaluate_playback_compat("matroska,webm", "vp8", Some("opus"));
        assert!(!needs);
    }
}
