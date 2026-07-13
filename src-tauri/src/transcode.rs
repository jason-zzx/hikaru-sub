use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::dependencies::work_cache_dir;
use crate::ffmpeg::{resolve_ffmpeg, resolve_ffprobe};
use crate::process::hidden_command;
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
    /// FFmpeg/rename 失败后置位；前端据此停止轮询，而不是无限「正在转码」
    failed: bool,
    error: Option<String>,
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
    let output = hidden_command(ffprobe)
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
    let output = hidden_command(ffprobe)
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
    // 半成品/损坏缓存常见于并发写入；过小直接判无效
    if metadata.len() < 10240 {
        return false;
    }

    let output = hidden_command(ffprobe)
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
            // ffprobe 对损坏流常把错误打到 stderr；有 NAL/decode 类错误则视为无效
            let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
            if stderr.contains("invalid nal")
                || stderr.contains("error splitting")
                || stderr.contains("corrupt")
                || stderr.contains("truncated")
            {
                return false;
            }
            let codec = String::from_utf8_lossy(&output.stdout).trim().to_string();
            format.is_valid_video_codec(&codec)
        }
        _ => false,
    }
}

/// 转码临时路径必须仍以 `.mp4` 结尾：FFmpeg 按扩展名选 muxer，
/// `xxx.mp4.tmp` 会失败；用 `xxx.tmp.mp4`。
fn proxy_temp_cache_path(cache_path: &Path, format: ProxyVideoFormat) -> PathBuf {
    let stem = cache_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("proxy");
    cache_path.with_file_name(format!("{stem}.tmp.{}", format.extension()))
}

/// Windows 上目标已存在时 `rename` 会失败；先删再 rename。
fn promote_temp_to_final(temp_path: &Path, final_path: &Path) -> Result<(), String> {
    if final_path.exists() {
        fs::remove_file(final_path).map_err(|e| {
            format!(
                "无法覆盖旧代理缓存 {}: {}",
                final_path.display(),
                e
            )
        })?;
    }
    fs::rename(temp_path, final_path).map_err(|e| {
        format!(
            "无法将临时文件提升为代理缓存 {} -> {}: {}",
            temp_path.display(),
            final_path.display(),
            e
        )
    })
}

fn mark_job_failed(
    jobs: &Arc<Mutex<HashMap<String, TranscodeJob>>>,
    video_path: &str,
    error: impl Into<String>,
) {
    if let Ok(mut jobs) = jobs.lock() {
        if let Some(job) = jobs.get_mut(video_path) {
            job.failed = true;
            job.completed = false;
            job.error = Some(error.into());
        }
    }
}

fn mark_job_completed(jobs: &Arc<Mutex<HashMap<String, TranscodeJob>>>, video_path: &str) {
    if let Ok(mut jobs) = jobs.lock() {
        if let Some(job) = jobs.get_mut(video_path) {
            job.completed = true;
            job.failed = false;
            job.error = None;
            job.progress = 100.0;
        }
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
        "-f".into(),
        "mp4".into(),
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
    let mut jobs = state
        .jobs
        .lock()
        .map_err(|_| "转码任务状态锁损坏".to_string())?;

    // 检查是否已有任务（包括进行中的任务）
    if let Some(job) = jobs.get(&video_path) {
        println!("Task already exists for: {}", video_path);
        if job.failed {
            // 允许失败后重试：清掉旧记录后继续往下走
            println!("Previous transcode failed, retrying");
            jobs.remove(&video_path);
        } else if job.completed && job.cache_path.exists() {
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
                    failed: false,
                    error: None,
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
            failed: false,
            error: None,
            progress: 0.0,
        },
    );

    // 先写到临时文件，成功后再 rename 成正式缓存，避免半成品被当成可播文件
    let temp_path = proxy_temp_cache_path(&cache_path, proxy_format);
    let _ = fs::remove_file(&temp_path);
    let output_path = temp_path.to_string_lossy().to_string();
    let final_path = cache_path.clone();
    let input_path = video_path.clone();
    let jobs_handle = state.jobs.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        println!(
            "Starting transcode ({:?}): {} -> {} (via {})",
            proxy_format, input_path, final_path.display(), output_path
        );

        // 先获取视频时长
        let duration_output = hidden_command(&ffprobe)
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

        let child = hidden_command(&ffmpeg)
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

                                        if let Ok(mut jobs) = jobs_handle.lock() {
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
                        match promote_temp_to_final(Path::new(&output_path), &final_path) {
                            Ok(()) => {
                                println!("Transcode completed: {}", final_path.display());
                                mark_job_completed(&jobs_handle, &input_path);
                                let _ = app_handle.emit(
                                    "transcode_progress",
                                    TranscodeProgressEvent { percent: 100.0 },
                                );
                            }
                            Err(e) => {
                                println!("Transcode promote failed: {}", e);
                                let _ = fs::remove_file(&output_path);
                                mark_job_failed(&jobs_handle, &input_path, e);
                            }
                        }
                    }
                    _ => {
                        println!("Transcode failed: {}", output_path);
                        let _ = fs::remove_file(&output_path);
                        mark_job_failed(
                            &jobs_handle,
                            &input_path,
                            "FFmpeg 转码失败，请检查源视频与 FFmpeg 是否可用",
                        );
                    }
                }
            }
            Err(e) => {
                println!("Failed to spawn ffmpeg: {}", e);
                let _ = fs::remove_file(&output_path);
                mark_job_failed(
                    &jobs_handle,
                    &input_path,
                    format!("无法启动 FFmpeg: {}", e),
                );
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
    let settings = load_settings(&app)?;
    let ffprobe = resolve_ffprobe(&app, &settings);
    let proxy_format = ProxyVideoFormat::for_current_platform();
    let hash = format!("{:x}", md5::compute(&video_path));
    let cache_path = proxy_cache_path(&state.cache_dir, &hash, proxy_format);

    {
        let mut jobs = state
            .jobs
            .lock()
            .map_err(|_| "转码任务状态锁损坏".to_string())?;

        if let Some(job) = jobs.get_mut(&video_path) {
            if job.failed {
                return Ok(TranscodeProgress {
                    ready: false,
                    failed: true,
                    error: job
                        .error
                        .clone()
                        .unwrap_or_else(|| "代理转码失败".to_string()),
                    cache_path: String::new(),
                });
            }

            if job.completed && job.cache_path.exists() {
                println!("Transcode completed, ready to play");
                return Ok(TranscodeProgress {
                    ready: true,
                    failed: false,
                    error: String::new(),
                    cache_path: job.cache_path.to_string_lossy().to_string(),
                });
            }

            if job.completed && !job.cache_path.exists() {
                return Ok(TranscodeProgress {
                    ready: false,
                    failed: true,
                    error: "代理缓存文件丢失，请重新打开视频以再次转码".to_string(),
                    cache_path: String::new(),
                });
            }

            // 文件已提升成功，但 completed 标记因 panic/锁失败未写入时，按有效缓存自愈
            if !job.completed && job.cache_path.exists() {
                let path = job.cache_path.clone();
                drop(jobs);
                if is_valid_proxy_cache(&ffprobe, &path, proxy_format) {
                    mark_job_completed(&state.jobs, &video_path);
                    println!("Transcode cache healed as ready: {}", path.display());
                    return Ok(TranscodeProgress {
                        ready: true,
                        failed: false,
                        error: String::new(),
                        cache_path: path.to_string_lossy().to_string(),
                    });
                }
                // 正式缓存已存在但无效：视为失败，避免永久「进行中」
                mark_job_failed(
                    &state.jobs,
                    &video_path,
                    "代理缓存无效或损坏，请重新打开视频以再次转码",
                );
                return Ok(TranscodeProgress {
                    ready: false,
                    failed: true,
                    error: "代理缓存无效或损坏，请重新打开视频以再次转码".to_string(),
                    cache_path: String::new(),
                });
            }

            return Ok(TranscodeProgress {
                ready: false,
                failed: false,
                error: String::new(),
                cache_path: String::new(),
            });
        }
    }

    // 任务记录已不存在：若正式缓存仍在且有效，视为成功；否则视为失败，避免前端无限轮询。
    if is_valid_proxy_cache(&ffprobe, &cache_path, proxy_format) {
        return Ok(TranscodeProgress {
            ready: true,
            failed: false,
            error: String::new(),
            cache_path: cache_path.to_string_lossy().to_string(),
        });
    }

    Ok(TranscodeProgress {
        ready: false,
        failed: true,
        error: "代理转码任务已中断或失败".to_string(),
        cache_path: String::new(),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeProgress {
    ready: bool,
    failed: bool,
    error: String,
    cache_path: String,
}

#[tauri::command]
pub async fn stop_transcode(app: AppHandle, video_path: String) -> Result<(), String> {
    let state = app.state::<TranscodeState>();
    let mut jobs = state
        .jobs
        .lock()
        .map_err(|_| "转码任务状态锁损坏".to_string())?;
    jobs.remove(&video_path);
    Ok(())
}

pub fn init_transcode_state(app: &mut tauri::App) {
    let cache_dir = work_cache_dir(app.handle())
        .unwrap_or_else(|_| PathBuf::from(".cache"))
        .join("transcode");

    app.manage(TranscodeState::new(cache_dir));
}

#[cfg(test)]
mod tests {
    use super::{
        evaluate_playback_compat, promote_temp_to_final, proxy_temp_cache_path, ProxyVideoFormat,
    };
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn proxy_temp_path_keeps_mp4_extension_for_ffmpeg_muxer() {
        let cache = PathBuf::from(r"C:\cache\transcode\abc123.mp4");
        let temp = proxy_temp_cache_path(&cache, ProxyVideoFormat::Mp4H264);
        assert_eq!(
            temp.file_name().and_then(|n| n.to_str()),
            Some("abc123.tmp.mp4")
        );
        assert!(temp
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("mp4")));
    }

    #[test]
    fn promote_temp_replaces_existing_final_on_windows() {
        let dir = std::env::temp_dir().join(format!(
            "hikaru-sub-transcode-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let final_path = dir.join("proxy.mp4");
        let temp_path = dir.join("proxy.tmp.mp4");
        fs::write(&final_path, b"old-final").unwrap();
        fs::write(&temp_path, b"new-temp").unwrap();

        promote_temp_to_final(&temp_path, &final_path).unwrap();

        assert!(!temp_path.exists());
        assert_eq!(fs::read(&final_path).unwrap(), b"new-temp");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hevc_mp4_needs_transcode() {
        let (needs, reason) = evaluate_playback_compat(
            "mov,mp4,m4v,3gp,3g2,mj2",
            "hevc",
            Some("aac"),
        );
        assert!(needs);
        assert!(reason.unwrap().contains("视频编码"));
    }

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
