use crate::ffmpeg::{resolve_ffmpeg, resolve_ffprobe};
use crate::hls_download::{
    build_hls_http_client, download_hls_media_with_client, hls_temp_root, remove_hls_temp_dir,
};
use crate::hls_types::{
    CancellationToken, DownloadStrategy, HlsDownloadError, HlsDownloadRequest, MediaKind,
    SegmentDownloadConfig,
};
use crate::settings::load_settings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::{Mutex, Semaphore};

static JOB_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadMode {
    Single,
    Separate,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeDownloadMediaArgs {
    pub mode: DownloadMode,
    pub video_url: String,
    pub audio_url: Option<String>,
    pub headers: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadMediaProbe {
    pub has_video: bool,
    pub has_audio: bool,
    pub extension: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartVideoDownloadArgs {
    pub mode: DownloadMode,
    pub name: String,
    pub video_url: String,
    pub audio_url: Option<String>,
    pub headers: Option<String>,
    pub save_dir: Option<String>,
    pub strategy: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSnapshot {
    pub id: String,
    pub status: DownloadStatus,
    pub progress: Option<f64>,
    pub processed_ms: i64,
    pub duration_ms: i64,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

struct DownloadJobInner {
    snapshot: DownloadSnapshot,
    output_path: PathBuf,
    children: Vec<RunningChild>,
    cancel_flag: Arc<AtomicBool>,
    temp_dirs: Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DownloadInputKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChildKind {
    Single,
    Video,
    Audio,
    Merge,
}

struct RunningChild {
    kind: ChildKind,
    child: std::process::Child,
}

#[derive(Debug, Clone, Copy, Default)]
struct InputProgress {
    processed_ms: i64,
    duration_ms: i64,
    done: bool,
}

pub struct DownloadState {
    jobs: Mutex<HashMap<String, Arc<Mutex<DownloadJobInner>>>>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
        }
    }
}

pub fn init_download_state(app: &mut tauri::App) {
    app.manage(DownloadState::default());
}

fn new_job_id() -> String {
    let n = JOB_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("dl-{n}")
}

/// 解析用户输入的 header 文本为 FFmpeg 所需的 CRLF 块。
pub fn parse_headers(input: &str) -> Result<String, String> {
    let mut lines = Vec::new();
    for raw in input.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if !line.contains(':') {
            return Err(format!("请求头格式无效（需包含冒号）：{line}"));
        }
        lines.push(line.to_string());
    }
    Ok(lines.join("\r\n"))
}

/// 从下载名称提取文件名主干（去掉已有扩展名）。
pub fn filename_stem(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let path = Path::new(trimmed);
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(trimmed)
        .to_string()
}

/// 在目标目录生成不冲突的输出路径。
pub fn unique_output_path(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let ext = extension.trim_start_matches('.');
    let mut candidate = dir.join(format!("{stem}.{ext}"));
    if !candidate.exists() {
        return candidate;
    }
    let mut index = 1;
    loop {
        candidate = dir.join(format!("{stem} ({index}).{ext}"));
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

/// 根据流探测结果推断输出扩展名。
pub fn infer_extension(mode: DownloadMode, has_video: bool, has_audio: bool) -> Result<String, String> {
    match mode {
        DownloadMode::Single => {
            if has_video {
                Ok("mp4".into())
            } else if has_audio {
                Ok("m4a".into())
            } else {
                Err("未检测到可用的音频或视频流".into())
            }
        }
        DownloadMode::Separate => {
            if !has_video {
                return Err("视频 URL 未检测到视频流".into());
            }
            if !has_audio {
                return Err("音频 URL 未检测到音频流".into());
            }
            Ok("mp4".into())
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct UrlStreamInfo {
    has_video: bool,
    has_audio: bool,
    duration_ms: i64,
}

/// 解析 ffprobe 输出的 stream codec_type 列表。
pub fn parse_stream_codec_types(stdout: &str) -> (bool, bool) {
    let mut has_video = false;
    let mut has_audio = false;
    for line in stdout.lines() {
        match line.trim() {
            "video" => has_video = true,
            "audio" => has_audio = true,
            _ => {}
        }
    }
    (has_video, has_audio)
}

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
    let mut frac3 = String::with_capacity(3);
    frac3.push_str(frac);
    while frac3.len() < 3 {
        frac3.push('0');
    }
    let ms: i64 = frac3.get(0..3)?.parse().ok()?;
    Some(((h * 60 + m) * 60 + sec) * 1000 + ms)
}

fn parse_duration_line(line: &str) -> Option<i64> {
    let idx = line.find("Duration:")?;
    let rest = &line[idx + "Duration:".len()..];
    let token = rest.split(',').next()?.trim();
    if token.starts_with("N/A") {
        return None;
    }
    parse_hhmmss_ms(token)
}

fn parse_time_token(line: &str) -> Option<i64> {
    let idx = line.find("time=")?;
    let rest = &line[idx + "time=".len()..];
    let token = rest.split_whitespace().next()?;
    if token.starts_with("N/A") {
        return None;
    }
    parse_hhmmss_ms(token)
}

/// 解析 `-progress` 输出中的 `out_time_ms=` 行。
pub fn parse_progress_out_time_ms(line: &str) -> Option<i64> {
    let trimmed = line.trim();
    let rest = trimmed.strip_prefix("out_time_ms=")?;
    rest.trim().parse().ok()
}

fn user_downloads_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var("USERPROFILE")
            .ok()
            .map(|home| PathBuf::from(home).join("Downloads"))
    } else {
        std::env::var("HOME")
            .ok()
            .map(|home| PathBuf::from(home).join("Downloads"))
    }
}

fn default_save_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = user_downloads_dir() {
        if dir.is_dir() {
            return Ok(dir);
        }
        if fs::create_dir_all(&dir).is_ok() {
            return Ok(dir);
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("downloads");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn ffprobe_header_args(headers: &str) -> Vec<String> {
    if headers.is_empty() {
        return Vec::new();
    }
    vec![
        "-headers".to_string(),
        format!("{headers}\r\n"),
    ]
}

/// CMAF/fMP4 HLS（如 Nico 的 `.cmfv` / `.cmfa`）需要放宽扩展名校验。
fn hls_compat_args() -> Vec<String> {
    vec![
        "-extension_picky".to_string(),
        "0".to_string(),
        "-allowed_extensions".to_string(),
        "ALL".to_string(),
    ]
}

fn http_stability_args() -> Vec<String> {
    vec![
        "-reconnect".to_string(),
        "1".to_string(),
        "-reconnect_streamed".to_string(),
        "1".to_string(),
        "-reconnect_on_network_error".to_string(),
        "1".to_string(),
        "-reconnect_delay_max".to_string(),
        "5".to_string(),
    ]
}

fn format_probe_error(stderr: &str) -> String {
    let trimmed = stderr.trim();
    let mut msg = format!("媒体探测失败：{trimmed}");
    if trimmed.contains("allowed_extensions")
        || trimmed.contains(".cmfv")
        || trimmed.contains(".cmfa")
    {
        msg.push_str(
            "\n提示：该源可能使用 CMAF HLS 分片（.cmfv/.cmfa）或 AES-128 加密；请确认 Cookie 有效，Nico 等站点需使用「分离音视频」模式。",
        );
    }
    msg
}

fn probe_url(ffprobe: &str, url: &str, headers: &str) -> Result<UrlStreamInfo, String> {
    let mut args = vec![
        "-hide_banner".to_string(),
        "-v".to_string(),
        "error".to_string(),
    ];
    args.extend(ffprobe_header_args(headers));
    args.extend(hls_compat_args());
    args.extend([
        "-i".to_string(),
        url.to_string(),
        "-show_entries".to_string(),
        "stream=codec_type".to_string(),
        "-show_entries".to_string(),
        "format=duration".to_string(),
        "-of".to_string(),
        "csv=p=0".to_string(),
    ]);

    let output = Command::new(ffprobe)
        .args(&args)
        .output()
        .map_err(|e| format!("无法启动 ffprobe：{e}"))?;

    if !output.status.success() {
        return Err(format_probe_error(&String::from_utf8_lossy(&output.stderr)));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().collect();
    let (has_video, has_audio) = parse_stream_codec_types(&stdout);

    let duration_ms = lines
        .iter()
        .rev()
        .find_map(|line| {
            let trimmed = line.trim();
            trimmed.parse::<f64>().ok().map(|d| (d * 1000.0) as i64)
        })
        .unwrap_or(0);

    Ok(UrlStreamInfo {
        has_video,
        has_audio,
        duration_ms,
    })
}

fn probe_media(
    ffprobe: &str,
    mode: DownloadMode,
    video_url: &str,
    audio_url: Option<&str>,
    headers: &str,
) -> Result<DownloadMediaProbe, String> {
    match mode {
        DownloadMode::Single => {
            let info = probe_url(ffprobe, video_url, headers)?;
            let extension = infer_extension(mode, info.has_video, info.has_audio)?;
            Ok(DownloadMediaProbe {
                has_video: info.has_video,
                has_audio: info.has_audio,
                extension,
                duration_ms: info.duration_ms,
            })
        }
        DownloadMode::Separate => {
            let audio_url = audio_url.ok_or_else(|| "分离模式需要提供音频 URL".to_string())?;
            let video_info = probe_url(ffprobe, video_url, headers)?;
            let audio_info = probe_url(ffprobe, audio_url, headers)?;
            let has_video = video_info.has_video;
            let has_audio = audio_info.has_audio;
            let extension = infer_extension(mode, has_video, has_audio)?;
            let duration_ms = video_info.duration_ms.max(audio_info.duration_ms);
            Ok(DownloadMediaProbe {
                has_video,
                has_audio,
                extension,
                duration_ms,
            })
        }
    }
}

fn build_single_download_args(url: &str, headers: &str, output_path: &Path) -> Vec<String> {
    let mut args = vec!["-hide_banner".to_string(), "-y".to_string()];
    args.extend(http_stability_args());
    args.extend(ffprobe_header_args(headers));
    args.extend(hls_compat_args());
    args.extend([
        "-i".to_string(),
        url.to_string(),
        "-c".to_string(),
        "copy".to_string(),
        "-bsf:a".to_string(),
        "aac_adtstoasc".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
        output_path.to_string_lossy().into_owned(),
    ]);
    args
}

fn build_input_download_args(
    kind: DownloadInputKind,
    url: &str,
    headers: &str,
    output_path: &Path,
) -> Vec<String> {
    let mut args = vec!["-hide_banner".to_string(), "-y".to_string()];
    args.extend(http_stability_args());
    args.extend(ffprobe_header_args(headers));
    args.extend(hls_compat_args());
    args.extend(["-i".to_string(), url.to_string()]);

    match kind {
        DownloadInputKind::Video => {
            args.extend([
                "-map".to_string(),
                "0:v:0".to_string(),
                "-an".to_string(),
                "-c".to_string(),
                "copy".to_string(),
            ]);
        }
        DownloadInputKind::Audio => {
            args.extend([
                "-map".to_string(),
                "0:a:0".to_string(),
                "-vn".to_string(),
                "-c".to_string(),
                "copy".to_string(),
                "-bsf:a".to_string(),
                "aac_adtstoasc".to_string(),
            ]);
        }
    }

    args.extend([
        "-progress".to_string(),
        "pipe:2".to_string(),
        output_path.to_string_lossy().into_owned(),
    ]);
    args
}

fn build_merge_args(video_path: &Path, audio_path: &Path, output_path: &Path) -> Vec<String> {
    vec![
        "-hide_banner".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        video_path.to_string_lossy().into_owned(),
        "-i".to_string(),
        audio_path.to_string_lossy().into_owned(),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "1:a:0".to_string(),
        "-c".to_string(),
        "copy".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string_lossy().into_owned(),
    ]
}

/// 单进程分离模式参数（并行下载失败时的回退参考，当前 separate 走并行路径）。
#[allow(dead_code)]
fn build_ffmpeg_args(
    mode: DownloadMode,
    video_url: &str,
    audio_url: Option<&str>,
    headers: &str,
    output_path: &Path,
) -> Vec<String> {
    match mode {
        DownloadMode::Single => build_single_download_args(video_url, headers, output_path),
        DownloadMode::Separate => {
            let audio = audio_url.unwrap_or("");
            let mut args = vec!["-hide_banner".to_string(), "-y".to_string()];
            args.extend(http_stability_args());
            args.extend(ffprobe_header_args(headers));
            args.extend(hls_compat_args());
            args.extend(["-i".to_string(), video_url.to_string()]);
            args.extend(http_stability_args());
            args.extend(ffprobe_header_args(headers));
            args.extend(hls_compat_args());
            args.extend([
                "-i".to_string(),
                audio.to_string(),
                "-map".to_string(),
                "0:v:0".to_string(),
                "-map".to_string(),
                "1:a:0".to_string(),
                "-c".to_string(),
                "copy".to_string(),
                "-bsf:a".to_string(),
                "aac_adtstoasc".to_string(),
                "-progress".to_string(),
                "pipe:2".to_string(),
                output_path.to_string_lossy().into_owned(),
            ]);
            args
        }
    }
}

fn is_job_cancelled(job: &Arc<Mutex<DownloadJobInner>>) -> bool {
    let guard = job.blocking_lock();
    guard.cancel_flag.load(Ordering::SeqCst)
        || guard.snapshot.status == DownloadStatus::Cancelled
}

fn is_job_aborted(job: &Arc<Mutex<DownloadJobInner>>) -> bool {
    matches!(
        job.blocking_lock().snapshot.status,
        DownloadStatus::Cancelled | DownloadStatus::Failed
    )
}

fn kill_all_children(job: &Arc<Mutex<DownloadJobInner>>) {
    let mut guard = job.blocking_lock();
    for entry in &mut guard.children {
        let _ = entry.child.kill();
        let _ = entry.child.wait();
    }
    guard.children.clear();
}

fn join_worker(
    handle: std::thread::JoinHandle<Result<(), String>>,
    label: &str,
) -> Result<Result<(), String>, String> {
    handle
        .join()
        .map_err(|_| format!("{label}下载线程异常退出"))
}

fn wait_parallel_download_workers(
    job: &Arc<Mutex<DownloadJobInner>>,
    video_handle: std::thread::JoinHandle<Result<(), String>>,
    audio_handle: std::thread::JoinHandle<Result<(), String>>,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn({
        let tx = tx.clone();
        move || {
            let _ = tx.send(("video", join_worker(video_handle, "视频")));
        }
    });
    std::thread::spawn(move || {
        let _ = tx.send(("audio", join_worker(audio_handle, "音频")));
    });

    let mut first_error: Option<String> = None;
    for _ in 0..2 {
        let (_label, join_result) = rx
            .recv()
            .map_err(|_| "下载线程通信失败".to_string())?;
        let worker_result = join_result?;
        if let Err(err) = worker_result {
            if first_error.is_none() {
                first_error = Some(err);
                kill_all_children(job);
            }
        }
    }

    first_error.map_or(Ok(()), Err)
}

fn register_child(
    job: &Arc<Mutex<DownloadJobInner>>,
    kind: ChildKind,
    child: std::process::Child,
) {
    let mut guard = job.blocking_lock();
    guard.children.push(RunningChild { kind, child });
    guard.snapshot.status = DownloadStatus::Running;
}

fn take_child(job: &Arc<Mutex<DownloadJobInner>>, kind: ChildKind) -> Option<std::process::Child> {
    let mut guard = job.blocking_lock();
    let index = guard.children.iter().position(|entry| entry.kind == kind)?;
    Some(guard.children.remove(index).child)
}

fn update_parallel_download_progress(
    job: &Arc<Mutex<DownloadJobInner>>,
    video: InputProgress,
    audio: InputProgress,
) {
    let duration_ms = video.duration_ms.max(audio.duration_ms);
    let processed_ms = video.processed_ms.max(audio.processed_ms);
    let video_ratio = if video.duration_ms > 0 {
        (video.processed_ms as f64 / video.duration_ms as f64).clamp(0.0, 1.0)
    } else if video.done {
        1.0
    } else {
        0.0
    };
    let audio_ratio = if audio.duration_ms > 0 {
        (audio.processed_ms as f64 / audio.duration_ms as f64).clamp(0.0, 1.0)
    } else if audio.done {
        1.0
    } else {
        0.0
    };
    let progress = if video.duration_ms > 0 || audio.duration_ms > 0 {
        Some(((video_ratio + audio_ratio) / 2.0 * 0.95).clamp(0.0, 0.95))
    } else {
        None
    };

    update_snapshot_progress(job, |snap| {
        snap.duration_ms = duration_ms;
        snap.processed_ms = processed_ms;
        snap.progress = progress;
    });
}

fn run_ffmpeg_child_collect_progress(
    job: Arc<Mutex<DownloadJobInner>>,
    kind: ChildKind,
    ffmpeg: String,
    args: Vec<String>,
    mut on_progress: impl FnMut(i64, i64) + Send + 'static,
) -> Result<(), String> {
    let mut child = Command::new(&ffmpeg)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 FFmpeg（{ffmpeg}）：{e}"))?;

    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 FFmpeg 输出".to_string())?;

    register_child(&job, kind, child);

    let mut tail = String::new();
    let mut buf = [0u8; 4096];
    let mut line: Vec<u8> = Vec::new();
    let mut duration_ms = 0;

    loop {
        let n = stderr.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        for &byte in &buf[..n] {
            if byte == b'\n' || byte == b'\r' {
                if line.is_empty() {
                    continue;
                }
                let text = String::from_utf8_lossy(&line).into_owned();
                if duration_ms == 0 {
                    if let Some(d) = parse_duration_line(&text) {
                        duration_ms = d;
                    }
                }
                if let Some(processed) =
                    parse_progress_out_time_ms(&text).or_else(|| parse_time_token(&text))
                {
                    on_progress(processed, duration_ms);
                }
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    tail = trimmed.to_string();
                }
                line.clear();
            } else {
                line.push(byte);
            }
        }
    }

    let mut child = take_child(&job, kind).ok_or_else(|| "FFmpeg 进程已丢失".to_string())?;
    let status = child.wait().map_err(|e| e.to_string())?;
    if is_job_cancelled(&job) || is_job_aborted(&job) {
        return Ok(());
    }
    if !status.success() {
        return Err(format!("FFmpeg 下载失败：{}", tail.trim()));
    }
    Ok(())
}

fn temp_download_paths(output_path: &Path) -> Result<(PathBuf, PathBuf), String> {
    let parent = output_path
        .parent()
        .ok_or_else(|| "无法解析输出目录".to_string())?;
    let stem = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "无法解析输出文件名".to_string())?;
    Ok((
        parent.join(format!("{stem}.video.part.mp4")),
        parent.join(format!("{stem}.audio.part.m4a")),
    ))
}

fn update_hls_separate_stream_progress(
    job: &Arc<Mutex<DownloadJobInner>>,
    stream: DownloadInputKind,
    done: i64,
    total: i64,
    video_progress: &Arc<std::sync::Mutex<InputProgress>>,
    audio_progress: &Arc<std::sync::Mutex<InputProgress>>,
) {
    match stream {
        DownloadInputKind::Video => {
            let mut video = video_progress.lock().unwrap();
            video.processed_ms = done;
            if total > 0 {
                video.duration_ms = total;
            }
        }
        DownloadInputKind::Audio => {
            let mut audio = audio_progress.lock().unwrap();
            audio.processed_ms = done;
            if total > 0 {
                audio.duration_ms = total;
            }
        }
    }
    let video = *video_progress.lock().unwrap();
    let audio = *audio_progress.lock().unwrap();
    update_parallel_download_progress(job, video, audio);
}

fn run_ffmpeg_strategy(
    app: AppHandle,
    job: Arc<Mutex<DownloadJobInner>>,
    ffmpeg: String,
    mode: DownloadMode,
    video_url: String,
    audio_url: Option<String>,
    headers: String,
    output_path: PathBuf,
) {
    match mode {
        DownloadMode::Single => {
            let args = build_single_download_args(&video_url, &headers, &output_path);
            run_download(app, job, ffmpeg, args);
        }
        DownloadMode::Separate => {
            if let Some(audio_url) = audio_url {
                run_separate_parallel_download(app, job, ffmpeg, video_url, audio_url, headers);
            } else {
                commit_snapshot(&job, |snap| {
                    snap.status = DownloadStatus::Failed;
                    snap.error = Some("分离模式需要提供音频 URL".into());
                });
            }
        }
    }
}

fn build_single_remux_args(input_path: &Path, output_path: &Path) -> Vec<String> {
    vec![
        "-hide_banner".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string_lossy().into_owned(),
        "-c".to_string(),
        "copy".to_string(),
        "-bsf:a".to_string(),
        "aac_adtstoasc".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string_lossy().into_owned(),
    ]
}

fn commit_snapshot(job: &Arc<Mutex<DownloadJobInner>>, update: impl FnOnce(&mut DownloadSnapshot)) {
    let mut guard = job.blocking_lock();
    update(&mut guard.snapshot);
}

async fn commit_snapshot_async(
    job: &Arc<Mutex<DownloadJobInner>>,
    update: impl FnOnce(&mut DownloadSnapshot),
) {
    let mut guard = job.lock().await;
    update(&mut guard.snapshot);
}

async fn is_job_cancelled_async(job: &Arc<Mutex<DownloadJobInner>>) -> bool {
    let guard = job.lock().await;
    guard.cancel_flag.load(Ordering::SeqCst) || guard.snapshot.status == DownloadStatus::Cancelled
}

async fn kill_all_children_async(job: &Arc<Mutex<DownloadJobInner>>) {
    let mut guard = job.lock().await;
    for entry in &mut guard.children {
        let _ = entry.child.kill();
        let _ = entry.child.wait();
    }
    guard.children.clear();
}

async fn cleanup_hls_job_temp_async(job: &Arc<Mutex<DownloadJobInner>>) {
    let guard = job.lock().await;
    for dir in &guard.temp_dirs {
        let _ = fs::remove_dir_all(dir);
    }
}

async fn run_ffmpeg_remux(
    job: Arc<Mutex<DownloadJobInner>>,
    kind: ChildKind,
    ffmpeg: String,
    args: Vec<String>,
    on_progress: impl FnMut(i64, i64) + Send + 'static,
) -> Result<(), HlsDownloadError> {
    tokio::task::spawn_blocking(move || {
        run_ffmpeg_child_collect_progress(job, kind, ffmpeg, args, on_progress)
    })
    .await
    .map_err(|_| HlsDownloadError::Operation("FFmpeg 任务异常退出".into()))?
    .map_err(HlsDownloadError::Operation)
}

async fn run_segment_strategy(
    app: AppHandle,
    job: Arc<Mutex<DownloadJobInner>>,
    ffmpeg: String,
    mode: DownloadMode,
    video_url: String,
    audio_url: Option<String>,
    headers: String,
    output_path: PathBuf,
    strategy: DownloadStrategy,
) {
    let job_id = job.lock().await.snapshot.id.clone();
    eprintln!(
        "[hikaru][download] run_segment_strategy 启动 job={job_id} mode={mode:?} strategy={strategy:?} video_url={video_url} audio={}",
        audio_url.is_some()
    );
    let output_parent = match output_path.parent() {
        Some(parent) => parent.to_path_buf(),
        None => {
            commit_snapshot_async(&job, |snap| {
                snap.status = DownloadStatus::Failed;
                snap.error = Some("无法解析输出目录".into());
            })
            .await;
            return;
        }
    };
    {
        let mut guard = job.lock().await;
        guard.temp_dirs.push(hls_temp_root(&output_parent, &job_id));
        guard.snapshot.status = DownloadStatus::Running;
    }

    let ffmpeg_for_fallback = ffmpeg.clone();
    let audio_url_for_fallback = audio_url.clone();
    let cancel = {
        let guard = job.lock().await;
        crate::hls_types::CancellationToken::new(guard.cancel_flag.clone())
    };
    let config = SegmentDownloadConfig::automatic();
    let hls_client = match build_hls_http_client(&config) {
        Ok(client) => client,
        Err(err) => {
            commit_snapshot_async(&job, |snap| {
                snap.status = DownloadStatus::Failed;
                snap.error = Some(err.message());
            })
            .await;
            return;
        }
    };

    let result: Result<(), HlsDownloadError> = async {
        match mode {
            DownloadMode::Single => {
                let temp = download_hls_media_with_client(
                    hls_client.clone(),
                    HlsDownloadRequest {
                        job_id: job_id.clone(),
                        url: video_url.clone(),
                        kind: MediaKind::Video,
                        output_path: output_parent.join("single.tmp"),
                    },
                    &headers,
                    config,
                    cancel.clone(),
                    {
                        let job = job.clone();
                        move |done, total| {
                            update_snapshot_progress(&job, |snap| {
                                snap.processed_ms = done;
                                snap.duration_ms = total;
                                snap.progress = (total > 0).then(|| {
                                    (done as f64 / total as f64 * 0.95).clamp(0.0, 0.95)
                                });
                            });
                        }
                    },
                    None,
                )
                .await?;
                if is_job_cancelled_async(&job).await {
                    return Ok(());
                }
                update_snapshot_progress(&job, |snap| {
                    snap.duration_ms = snap.duration_ms.max(temp.duration_ms);
                });
                let args = build_single_remux_args(&temp.temp_media_path, &output_path);
                run_ffmpeg_remux(
                    job.clone(),
                    ChildKind::Merge,
                    ffmpeg,
                    args,
                    {
                        let job = job.clone();
                        move |_processed, _duration| {
                            update_snapshot_progress(&job, |snap| {
                                if snap.progress.is_some() {
                                    snap.progress = Some(0.95);
                                }
                            });
                        }
                    },
                )
                .await?;
            }
            DownloadMode::Separate => {
                let audio_url = audio_url.ok_or_else(|| {
                    HlsDownloadError::Operation("分离模式需要提供音频 URL".into())
                })?;
                let video_progress = Arc::new(std::sync::Mutex::new(InputProgress::default()));
                let audio_progress = Arc::new(std::sync::Mutex::new(InputProgress::default()));
                let semaphore = Arc::new(Semaphore::new(config.concurrency));
                let video = download_hls_media_with_client(
                    hls_client.clone(),
                    HlsDownloadRequest {
                        job_id: job_id.clone(),
                        url: video_url.clone(),
                        kind: MediaKind::Video,
                        output_path: output_parent.join("video.tmp"),
                    },
                    &headers,
                    config.clone(),
                    cancel.clone(),
                    {
                        let job = job.clone();
                        let video_progress = video_progress.clone();
                        let audio_progress = audio_progress.clone();
                        move |done, total| {
                            update_hls_separate_stream_progress(
                                &job,
                                DownloadInputKind::Video,
                                done,
                                total,
                                &video_progress,
                                &audio_progress,
                            );
                        }
                    },
                    Some(semaphore.clone()),
                );
                let audio = download_hls_media_with_client(
                    hls_client,
                    HlsDownloadRequest {
                        job_id: job_id.clone(),
                        url: audio_url,
                        kind: MediaKind::Audio,
                        output_path: output_parent.join("audio.tmp"),
                    },
                    &headers,
                    config,
                    cancel,
                    {
                        let job = job.clone();
                        let video_progress = video_progress.clone();
                        let audio_progress = audio_progress.clone();
                        move |done, total| {
                            update_hls_separate_stream_progress(
                                &job,
                                DownloadInputKind::Audio,
                                done,
                                total,
                                &video_progress,
                                &audio_progress,
                            );
                        }
                    },
                    Some(semaphore),
                );
                let (video, audio) = tokio::try_join!(video, audio)?;
                if is_job_cancelled_async(&job).await {
                    return Ok(());
                }
                {
                    let mut video_state = video_progress.lock().unwrap();
                    video_state.done = true;
                    let mut audio_state = audio_progress.lock().unwrap();
                    audio_state.done = true;
                    update_parallel_download_progress(&job, *video_state, *audio_state);
                }
                update_snapshot_progress(&job, |snap| {
                    snap.duration_ms = snap
                        .duration_ms
                        .max(video.duration_ms)
                        .max(audio.duration_ms);
                });
                let args =
                    build_merge_args(&video.temp_media_path, &audio.temp_media_path, &output_path);
                run_ffmpeg_remux(
                    job.clone(),
                    ChildKind::Merge,
                    ffmpeg,
                    args,
                    |_processed, _duration| {},
                )
                .await?;
            }
        }

        Ok(())
    }
    .await;

    match &result {
        Ok(()) => eprintln!("[hikaru][download] run_segment_strategy 分片阶段完成 job={job_id}"),
        Err(err) => eprintln!(
            "[hikaru][download] run_segment_strategy 分片阶段失败 job={job_id}: {}",
            err.message()
        ),
    }

    match result {
        Ok(()) => {
            if is_job_cancelled_async(&job).await {
                cleanup_hls_job_temp_async(&job).await;
                let _ = fs::remove_file(&output_path);
                return;
            }
            cleanup_hls_job_temp_async(&job).await;
            commit_snapshot_async(&job, |snap| {
                snap.status = DownloadStatus::Completed;
                snap.progress = Some(1.0);
                snap.output_path = Some(output_path.to_string_lossy().into_owned());
                snap.error = None;
            })
            .await;
        }
        Err(err) => {
            let err_message = err.message();
            let fallback_allowed =
                strategy == DownloadStrategy::Auto && err.is_auto_fallback_eligible();
            cleanup_hls_job_temp_async(&job).await;
            remove_hls_temp_dir(&output_parent, &job_id);
            if fallback_allowed {
                let app = app.clone();
                let job = job.clone();
                tokio::task::spawn_blocking(move || {
                    run_ffmpeg_strategy(
                        app,
                        job,
                        ffmpeg_for_fallback,
                        mode,
                        video_url,
                        audio_url_for_fallback,
                        headers,
                        output_path,
                    );
                })
                .await
                .ok();
                return;
            }
            kill_all_children_async(&job).await;
            let _ = fs::remove_file(&output_path);
            commit_snapshot_async(&job, |snap| {
                if snap.status != DownloadStatus::Cancelled {
                    snap.status = DownloadStatus::Failed;
                    snap.error = Some(err_message);
                }
            })
            .await;
        }
    }
}

fn run_separate_parallel_download(
    app: AppHandle,
    job: Arc<Mutex<DownloadJobInner>>,
    ffmpeg: String,
    video_url: String,
    audio_url: String,
    headers: String,
) {
    let result = (|| -> Result<(), String> {
        let output_path = job.blocking_lock().output_path.clone();
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let (video_tmp, audio_tmp) = temp_download_paths(&output_path)?;
        let _ = fs::remove_file(&video_tmp);
        let _ = fs::remove_file(&audio_tmp);

        let video_progress = Arc::new(std::sync::Mutex::new(InputProgress::default()));
        let audio_progress = Arc::new(std::sync::Mutex::new(InputProgress::default()));

        let video_job = job.clone();
        let video_progress_for_thread = video_progress.clone();
        let audio_progress_for_video = audio_progress.clone();
        let video_args = build_input_download_args(
            DownloadInputKind::Video,
            &video_url,
            &headers,
            &video_tmp,
        );
        let video_ffmpeg = ffmpeg.clone();
        let video_handle = std::thread::spawn(move || {
            run_ffmpeg_child_collect_progress(
                video_job.clone(),
                ChildKind::Video,
                video_ffmpeg,
                video_args,
                move |processed, duration| {
                    let snapshot_pair = {
                        let mut video = video_progress_for_thread.lock().unwrap();
                        video.processed_ms = processed;
                        if duration > 0 {
                            video.duration_ms = duration;
                        }
                        let audio = *audio_progress_for_video.lock().unwrap();
                        (*video, audio)
                    };
                    update_parallel_download_progress(&video_job, snapshot_pair.0, snapshot_pair.1);
                },
            )
        });

        let audio_job = job.clone();
        let audio_progress_for_thread = audio_progress.clone();
        let video_progress_for_audio = video_progress.clone();
        let audio_args = build_input_download_args(
            DownloadInputKind::Audio,
            &audio_url,
            &headers,
            &audio_tmp,
        );
        let audio_ffmpeg = ffmpeg.clone();
        let audio_handle = std::thread::spawn(move || {
            run_ffmpeg_child_collect_progress(
                audio_job.clone(),
                ChildKind::Audio,
                audio_ffmpeg,
                audio_args,
                move |processed, duration| {
                    let snapshot_pair = {
                        let mut audio = audio_progress_for_thread.lock().unwrap();
                        audio.processed_ms = processed;
                        if duration > 0 {
                            audio.duration_ms = duration;
                        }
                        let video = *video_progress_for_audio.lock().unwrap();
                        (video, *audio)
                    };
                    update_parallel_download_progress(&audio_job, snapshot_pair.0, snapshot_pair.1);
                },
            )
        });

        wait_parallel_download_workers(&job, video_handle, audio_handle)?;
        {
            let mut video = video_progress.lock().unwrap();
            video.done = true;
            let mut audio = audio_progress.lock().unwrap();
            audio.done = true;
        }

        if is_job_cancelled(&job) {
            let _ = fs::remove_file(&video_tmp);
            let _ = fs::remove_file(&audio_tmp);
            let _ = fs::remove_file(&output_path);
            return Ok(());
        }

        update_snapshot_progress(&job, |snap| {
            if snap.progress.is_some() {
                snap.progress = Some(0.95);
            }
        });

        let merge_args = build_merge_args(&video_tmp, &audio_tmp, &output_path);
        run_ffmpeg_child_collect_progress(job.clone(), ChildKind::Merge, ffmpeg, merge_args, {
            let job_for_progress = job.clone();
            move |processed, duration| {
                update_snapshot_progress(&job_for_progress, |snap| {
                    snap.processed_ms = processed;
                    if duration > 0 {
                        snap.duration_ms = duration;
                    }
                    if snap.progress.is_some() {
                        snap.progress = Some(0.95);
                    }
                });
            }
        })?;

        if is_job_cancelled(&job) {
            let _ = fs::remove_file(&video_tmp);
            let _ = fs::remove_file(&audio_tmp);
            let _ = fs::remove_file(&output_path);
            return Ok(());
        }

        let _ = fs::remove_file(&video_tmp);
        let _ = fs::remove_file(&audio_tmp);
        commit_snapshot(&job, |snap| {
            snap.status = DownloadStatus::Completed;
            snap.progress = Some(1.0);
            snap.output_path = Some(output_path.to_string_lossy().into_owned());
            snap.error = None;
        });

        let _ = app;
        Ok(())
    })();

    if let Err(err) = result {
        kill_all_children(&job);
        let output_path = job.blocking_lock().output_path.clone();
        if let Ok((video_tmp, audio_tmp)) = temp_download_paths(&output_path) {
            let _ = fs::remove_file(video_tmp);
            let _ = fs::remove_file(audio_tmp);
        }
        let _ = fs::remove_file(output_path);
        commit_snapshot(&job, |snap| {
            if snap.status != DownloadStatus::Cancelled {
                snap.status = DownloadStatus::Failed;
                snap.error = Some(err);
            }
        });
    }
}

fn update_snapshot_progress(
    job: &Arc<Mutex<DownloadJobInner>>,
    update: impl FnOnce(&mut DownloadSnapshot),
) {
    if let Ok(mut guard) = job.try_lock() {
        update(&mut guard.snapshot);
    }
}

fn run_download(
    app: AppHandle,
    job: Arc<Mutex<DownloadJobInner>>,
    ffmpeg: String,
    args: Vec<String>,
) {
    let result = (|| -> Result<(), String> {
        let output_path = {
            let guard = job.blocking_lock();
            guard.output_path.clone()
        };

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut child = Command::new(&ffmpeg)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("无法启动 FFmpeg（{ffmpeg}）：{e}"))?;

        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| "无法读取 FFmpeg 输出".to_string())?;

        let duration_ms = {
            let mut guard = job.blocking_lock();
            guard.children.push(RunningChild {
                kind: ChildKind::Single,
                child,
            });
            guard.snapshot.status = DownloadStatus::Running;
            guard.snapshot.duration_ms
        };

        let mut tail = String::new();
        let mut buf = [0u8; 4096];
        let mut line: Vec<u8> = Vec::new();
        let mut parsed_duration_ms = duration_ms;

        loop {
            let n = stderr.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            for &byte in &buf[..n] {
                if byte == b'\n' || byte == b'\r' {
                    if line.is_empty() {
                        continue;
                    }
                    let text = String::from_utf8_lossy(&line).into_owned();
                    handle_progress_line(
                        &job,
                        &text,
                        &mut parsed_duration_ms,
                        &mut tail,
                    );
                    line.clear();
                } else {
                    line.push(byte);
                }
            }
        }
        if !line.is_empty() {
            let text = String::from_utf8_lossy(&line).into_owned();
            handle_progress_line(&job, &text, &mut parsed_duration_ms, &mut tail);
        }

        let (cancelled, status) = {
            let mut guard = job.blocking_lock();
            let cancelled = guard.snapshot.status == DownloadStatus::Cancelled;
            let status = if let Some(index) = guard
                .children
                .iter()
                .position(|entry| entry.kind == ChildKind::Single)
            {
                let mut entry = guard.children.remove(index);
                entry.child.wait().map_err(|e| e.to_string())?
            } else {
                return Err("FFmpeg 进程已丢失".into());
            };
            (cancelled, status)
        };

        if cancelled {
            let _ = fs::remove_file(&output_path);
            return Ok(());
        }

        if !status.success() {
            let _ = fs::remove_file(&output_path);
            return Err(format!("FFmpeg 下载失败：{}", tail.trim()));
        }

        commit_snapshot(&job, |snap| {
            snap.status = DownloadStatus::Completed;
            snap.progress = Some(1.0);
            snap.processed_ms = parsed_duration_ms.max(snap.duration_ms);
            snap.output_path = Some(output_path.to_string_lossy().into_owned());
            snap.error = None;
        });

        let _ = app;
        Ok(())
    })();

    if let Err(err) = result {
        kill_all_children(&job);
        let output_path = job.blocking_lock().output_path.clone();
        let _ = fs::remove_file(&output_path);
        commit_snapshot(&job, |snap| {
            if snap.status != DownloadStatus::Cancelled {
                snap.status = DownloadStatus::Failed;
                snap.error = Some(err);
            }
        });
    }
}

fn handle_progress_line(
    job: &Arc<Mutex<DownloadJobInner>>,
    text: &str,
    duration_ms: &mut i64,
    tail: &mut String,
) {
    if *duration_ms == 0 {
        if let Some(d) = parse_duration_line(text) {
            *duration_ms = d;
        }
    }

    let processed_ms = parse_progress_out_time_ms(text).or_else(|| parse_time_token(text));

    if let Some(processed) = processed_ms {
        let progress = (*duration_ms > 0)
            .then(|| (processed as f64 / *duration_ms as f64).clamp(0.0, 1.0));
        update_snapshot_progress(job, |snap| {
            snap.processed_ms = processed;
            if *duration_ms > 0 {
                snap.duration_ms = *duration_ms;
            }
            snap.progress = progress;
        });
    }

    let trimmed = text.trim();
    if !trimmed.is_empty() {
        *tail = trimmed.to_string();
    }
}

#[tauri::command]
pub async fn probe_download_media(
    app: AppHandle,
    args: ProbeDownloadMediaArgs,
) -> Result<DownloadMediaProbe, String> {
    let settings = load_settings(&app).unwrap_or_default();
    let ffprobe = resolve_ffprobe(&app, &settings);
    let headers = args
        .headers
        .as_deref()
        .map(parse_headers)
        .transpose()?
        .unwrap_or_default();
    probe_media(
        &ffprobe,
        args.mode,
        &args.video_url,
        args.audio_url.as_deref(),
        &headers,
    )
}

#[tauri::command]
pub async fn start_video_download(
    app: AppHandle,
    args: StartVideoDownloadArgs,
) -> Result<String, String> {
    let stem = filename_stem(&args.name);
    if stem.is_empty() {
        return Err("请填写下载名称".into());
    }

    let settings = load_settings(&app).unwrap_or_default();
    let ffprobe = resolve_ffprobe(&app, &settings);
    let (ffmpeg, _) = resolve_ffmpeg(&app, &settings);
    let headers = args
        .headers
        .as_deref()
        .map(parse_headers)
        .transpose()?
        .unwrap_or_default();

    let probe = probe_media(
        &ffprobe,
        args.mode,
        &args.video_url,
        args.audio_url.as_deref(),
        &headers,
    )?;

    let save_dir = match args.save_dir.as_deref() {
        Some(dir) if !dir.trim().is_empty() => {
            let path = PathBuf::from(dir);
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            path
        }
        _ => default_save_dir(&app)?,
    };

    let output_path = unique_output_path(&save_dir, &stem, &probe.extension);
    let job_id = new_job_id();
    let snapshot = DownloadSnapshot {
        id: job_id.clone(),
        status: DownloadStatus::Pending,
        progress: None,
        processed_ms: 0,
        duration_ms: probe.duration_ms,
        output_path: Some(output_path.to_string_lossy().into_owned()),
        error: None,
    };

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let job = Arc::new(Mutex::new(DownloadJobInner {
        snapshot: snapshot.clone(),
        output_path: output_path.clone(),
        children: Vec::new(),
        cancel_flag: cancel_flag.clone(),
        temp_dirs: Vec::new(),
    }));

    {
        let state = app.state::<DownloadState>();
        state.jobs.lock().await.insert(job_id.clone(), job.clone());
    }

    let app_clone = app.clone();
    let mode = args.mode;
    let video_url = args.video_url.clone();
    let strategy = DownloadStrategy::parse(args.strategy.as_deref());
    let audio_url = args.audio_url.clone();
    match strategy {
        DownloadStrategy::Ffmpeg => {
            tauri::async_runtime::spawn_blocking(move || {
                run_ffmpeg_strategy(
                    app_clone,
                    job,
                    ffmpeg,
                    mode,
                    video_url,
                    audio_url,
                    headers,
                    output_path,
                );
            });
        }
        DownloadStrategy::Auto | DownloadStrategy::Segments => {
            let supervised_job = job.clone();
            let task = tauri::async_runtime::spawn(async move {
                run_segment_strategy(
                    app_clone,
                    job,
                    ffmpeg,
                    mode,
                    video_url,
                    audio_url,
                    headers,
                    output_path,
                    strategy,
                )
                .await;
            });
            tauri::async_runtime::spawn(async move {
                if let Err(err) = task.await {
                    eprintln!("[hikaru][download] 分片下载任务异常退出: {err:?}");
                    commit_snapshot_async(&supervised_job, |snap| {
                        snap.status = DownloadStatus::Failed;
                        snap.error = Some(format!("分片下载任务异常退出: {err}"));
                    })
                    .await;
                }
            });
        }
    }

    Ok(job_id)
}

#[tauri::command]
pub async fn get_video_download_progress(
    app: AppHandle,
    job_id: String,
) -> Result<DownloadSnapshot, String> {
    let state = app.state::<DownloadState>();
    let jobs = state.jobs.lock().await;
    let job = jobs
        .get(&job_id)
        .ok_or_else(|| format!("下载任务不存在: {job_id}"))?;
    let guard = job.lock().await;
    Ok(guard.snapshot.clone())
}

#[tauri::command]
pub async fn cancel_video_download(app: AppHandle, job_id: String) -> Result<(), String> {
    let state = app.state::<DownloadState>();
    let job = {
        let jobs = state.jobs.lock().await;
        jobs.get(&job_id)
            .cloned()
            .ok_or_else(|| format!("下载任务不存在: {job_id}"))?
    };

    let (mut children, output_path, temp_dirs, job_id_for_hls) = {
        let mut guard = job.lock().await;
        CancellationToken::new(guard.cancel_flag.clone()).cancel();
        guard.snapshot.status = DownloadStatus::Cancelled;
        guard.snapshot.error = Some("下载已取消".into());
        (
            std::mem::take(&mut guard.children),
            guard.output_path.clone(),
            guard.temp_dirs.clone(),
            guard.snapshot.id.clone(),
        )
    };

    for entry in &mut children {
        let _ = entry.child.kill();
        let _ = entry.child.wait();
    }
    if let Ok((video_tmp, audio_tmp)) = temp_download_paths(&output_path) {
        let _ = fs::remove_file(video_tmp);
        let _ = fs::remove_file(audio_tmp);
    }
    for temp_dir in temp_dirs {
        let _ = fs::remove_dir_all(temp_dir);
    }
    if let Some(parent) = output_path.parent() {
        remove_hls_temp_dir(parent, &job_id_for_hls);
    }
    let _ = fs::remove_file(output_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_stem_strips_extension() {
        assert_eq!(filename_stem("episode-01.mp4"), "episode-01");
        assert_eq!(filename_stem("episode-01"), "episode-01");
        assert_eq!(filename_stem("  clip.m4a  "), "clip");
    }

    #[test]
    fn unique_output_path_adds_suffix() {
        let dir = std::env::temp_dir().join(format!("hikaru-dl-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let base = dir.join("sample.mp4");
        let _ = fs::write(&base, b"x");

        let first = unique_output_path(&dir, "sample", "mp4");
        assert_eq!(first, dir.join("sample (1).mp4"));

        let _ = fs::remove_file(&base);
        let _ = fs::remove_file(&first);
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn parse_headers_requires_colon() {
        assert!(parse_headers("Referer: https://example.com").is_ok());
        assert!(parse_headers("BadHeader").is_err());
    }

    #[test]
    fn parse_stream_codec_types_detects_streams() {
        let (video, audio) = parse_stream_codec_types("video\naudio\n");
        assert!(video);
        assert!(audio);

        let (video, audio) = parse_stream_codec_types("audio\n");
        assert!(!video);
        assert!(audio);
    }

    #[test]
    fn infer_extension_rules() {
        assert_eq!(
            infer_extension(DownloadMode::Single, true, true).unwrap(),
            "mp4"
        );
        assert_eq!(
            infer_extension(DownloadMode::Single, false, true).unwrap(),
            "m4a"
        );
        assert!(infer_extension(DownloadMode::Single, false, false).is_err());
        assert_eq!(
            infer_extension(DownloadMode::Separate, true, true).unwrap(),
            "mp4"
        );
    }

    #[test]
    fn parse_progress_out_time_ms_works() {
        assert_eq!(parse_progress_out_time_ms("out_time_ms=12345"), Some(12345));
        assert_eq!(parse_progress_out_time_ms("progress=continue"), None);
    }

    #[test]
    fn build_input_download_args_for_video_contains_one_input_and_video_map() {
        let args = build_input_download_args(
            DownloadInputKind::Video,
            "https://example.com/video.m3u8",
            "Cookie: a=b",
            Path::new("video.tmp.mp4"),
        );

        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"https://example.com/video.m3u8".to_string()));
        assert!(args.contains(&"-map".to_string()));
        assert!(args.contains(&"0:v:0".to_string()));
        assert!(args.contains(&"-an".to_string()));
        assert!(args.contains(&"-c".to_string()));
        assert!(args.contains(&"copy".to_string()));
        assert_eq!(args.iter().filter(|arg| arg.as_str() == "-i").count(), 1);
    }

    #[test]
    fn build_input_download_args_for_audio_contains_one_input_and_audio_map() {
        let args = build_input_download_args(
            DownloadInputKind::Audio,
            "https://example.com/audio.m3u8",
            "Cookie: a=b",
            Path::new("audio.tmp.m4a"),
        );

        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"https://example.com/audio.m3u8".to_string()));
        assert!(args.contains(&"-map".to_string()));
        assert!(args.contains(&"0:a:0".to_string()));
        assert!(args.contains(&"-vn".to_string()));
        assert!(args.contains(&"-bsf:a".to_string()));
        assert!(args.contains(&"aac_adtstoasc".to_string()));
        assert_eq!(args.iter().filter(|arg| arg.as_str() == "-i").count(), 1);
    }

    #[test]
    fn build_merge_args_maps_temp_video_and_audio_to_final_output() {
        let video = Path::new("video.tmp.mp4");
        let audio = Path::new("audio.tmp.m4a");
        let final_path = Path::new("final.mp4");
        let args = build_merge_args(video, audio, final_path);

        assert_eq!(args.iter().filter(|arg| arg.as_str() == "-i").count(), 2);
        assert!(args.contains(&video.to_string_lossy().into_owned()));
        assert!(args.contains(&audio.to_string_lossy().into_owned()));
        assert!(args.contains(&"-map".to_string()));
        assert!(args.contains(&"0:v:0".to_string()));
        assert!(args.contains(&"1:a:0".to_string()));
        assert!(args.contains(&"-c".to_string()));
        assert!(args.contains(&"copy".to_string()));
        assert!(args.contains(&final_path.to_string_lossy().into_owned()));
    }
}
