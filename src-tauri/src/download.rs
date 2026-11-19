use crate::ffmpeg::{
    parse_duration_line, parse_progress_out_time_ms, parse_time_token, resolve_ffmpeg,
    resolve_ffprobe,
};
use crate::hls_download::{
    build_hls_http_client, download_hls_pair_with_client,
    download_hls_single_or_master_with_client, remove_hls_temp_dir, HlsSingleDownloadResult,
};
use crate::hls_types::{
    AssembledMedia, CancellationToken, DownloadStrategy, HlsDownloadError, MediaExtensionHint,
    MediaKind, SegmentDownloadConfig,
};
use crate::process::hidden_command;
use crate::settings::load_settings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

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

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadPhase {
    Preparing,
    Downloading,
    Merging,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSnapshot {
    pub id: String,
    pub status: DownloadStatus,
    pub phase: Option<DownloadPhase>,
    pub progress: Option<f64>,
    pub processed_ms: i64,
    pub duration_ms: i64,
    pub speed_bytes_per_sec: Option<u64>,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Default)]
struct SpeedMeter {
    last_sample_at: Option<Instant>,
    last_bytes: u64,
    ema_bps: Option<f64>,
}

impl SpeedMeter {
    fn sample(&mut self, active: bool, total_bytes: u64, now: Instant) -> Option<u64> {
        if !active {
            self.last_sample_at = None;
            self.ema_bps = None;
            return None;
        }
        let Some(prev_at) = self.last_sample_at else {
            self.last_sample_at = Some(now);
            self.last_bytes = total_bytes;
            return None;
        };
        let dt = now.saturating_duration_since(prev_at).as_secs_f64();
        if dt >= 0.25 {
            let delta = total_bytes.saturating_sub(self.last_bytes) as f64;
            let inst = delta / dt;
            let smoothed = match self.ema_bps {
                Some(prev) => 0.45 * inst + 0.55 * prev,
                None => inst,
            };
            self.ema_bps = Some(smoothed);
            self.last_sample_at = Some(now);
            self.last_bytes = total_bytes;
        }
        self.ema_bps.map(|bps| bps.max(0.0).round() as u64)
    }
}

struct DownloadJobInner {
    snapshot: DownloadSnapshot,
    save_dir: PathBuf,
    stem: String,
    output_path: Option<PathBuf>,
    children: Vec<RunningChild>,
    cancel_flag: Arc<AtomicBool>,
    downloaded_bytes: Arc<AtomicU64>,
    speed_active: Arc<AtomicBool>,
    speed_meter: SpeedMeter,
}

impl DownloadJobInner {
    fn lock_output_path(&mut self, ext: &str) -> PathBuf {
        let path = unique_output_path(&self.save_dir, &self.stem, ext);
        self.output_path = Some(path.clone());
        self.snapshot.output_path = Some(path.to_string_lossy().into_owned());
        path
    }
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
pub fn infer_extension(
    mode: DownloadMode,
    has_video: bool,
    has_audio: bool,
) -> Result<String, String> {
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

/// 解析 `-progress` 输出中的 `total_size=` 行（字节数）。
pub fn parse_progress_total_size(line: &str) -> Option<u64> {
    let trimmed = line.trim();
    let rest = trimmed.strip_prefix("total_size=")?;
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
    let dir = crate::app_paths::app_data_dir(app)?.join("downloads");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn ffprobe_header_args(headers: &str) -> Vec<String> {
    if headers.is_empty() {
        return Vec::new();
    }
    vec!["-headers".to_string(), format!("{headers}\r\n")]
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

    let output = hidden_command(ffprobe)
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
    guard.cancel_flag.load(Ordering::SeqCst) || guard.snapshot.status == DownloadStatus::Cancelled
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
        let (_label, join_result) = rx.recv().map_err(|_| "下载线程通信失败".to_string())?;
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

fn register_child(job: &Arc<Mutex<DownloadJobInner>>, kind: ChildKind, child: std::process::Child) {
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
    total_size_target: Option<Arc<AtomicU64>>,
    mut on_progress: impl FnMut(i64, i64) + Send + 'static,
) -> Result<(), String> {
    let mut child = hidden_command(&ffmpeg)
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
                if let Some(target) = total_size_target.as_ref() {
                    if let Some(size) = parse_progress_total_size(&text) {
                        target.store(size, Ordering::Relaxed);
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

fn probe_local_media_streams(ffprobe: &str, path: &Path) -> Option<(bool, bool)> {
    let output = hidden_command(ffprobe)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Some(parse_stream_codec_types(&stdout))
}

#[allow(clippy::too_many_arguments)]
fn run_ffmpeg_strategy(
    app: AppHandle,
    job: Arc<Mutex<DownloadJobInner>>,
    ffmpeg: String,
    ffprobe: String,
    mode: DownloadMode,
    video_url: String,
    audio_url: Option<String>,
    headers: String,
) {
    if is_job_cancelled(&job) {
        return;
    }

    let probe = match probe_media(&ffprobe, mode, &video_url, audio_url.as_deref(), &headers) {
        Ok(probe) => probe,
        Err(err) => {
            commit_snapshot(&job, |snap| {
                if snap.status != DownloadStatus::Cancelled {
                    snap.status = DownloadStatus::Failed;
                    snap.phase = None;
                    snap.speed_bytes_per_sec = None;
                    snap.error = Some(err);
                }
            });
            return;
        }
    };

    if is_job_cancelled(&job) {
        return;
    }

    let output_path = {
        let mut guard = job.blocking_lock();
        let path = guard.lock_output_path(&probe.extension);
        guard.downloaded_bytes.store(0, Ordering::Relaxed);
        guard.speed_active.store(true, Ordering::Relaxed);
        guard.speed_meter = SpeedMeter::default();
        guard.snapshot.phase = Some(DownloadPhase::Downloading);
        if probe.duration_ms > 0 {
            guard.snapshot.duration_ms = guard.snapshot.duration_ms.max(probe.duration_ms);
        }
        path
    };

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
                    snap.phase = None;
                    snap.speed_bytes_per_sec = None;
                    snap.error = Some("分离模式需要提供音频 URL".into());
                });
            }
        }
    }
}

fn extend_assembled_input_args(args: &mut Vec<String>, media: &AssembledMedia) {
    match media {
        AssembledMedia::SingleFile(path) => {
            args.extend(["-i".to_string(), path.to_string_lossy().into_owned()]);
        }
        AssembledMedia::ConcatList(concat_path) => {
            args.extend([
                "-f".to_string(),
                "concat".to_string(),
                "-safe".to_string(),
                "0".to_string(),
                "-i".to_string(),
                concat_path.to_string_lossy().into_owned(),
            ]);
        }
    }
}

fn build_single_remux_args(
    media: &AssembledMedia,
    output_path: &Path,
    use_adtstoasc: bool,
) -> Vec<String> {
    let mut args = vec!["-hide_banner".to_string(), "-y".to_string()];
    extend_assembled_input_args(&mut args, media);
    args.extend(["-c".to_string(), "copy".to_string()]);
    if use_adtstoasc {
        args.extend(["-bsf:a".to_string(), "aac_adtstoasc".to_string()]);
    }
    args.extend([
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string_lossy().into_owned(),
    ]);
    args
}

fn build_assembled_merge_args(
    video: &AssembledMedia,
    audio: &AssembledMedia,
    audio_use_adtstoasc: bool,
    output_path: &Path,
) -> Vec<String> {
    let mut args = vec!["-hide_banner".to_string(), "-y".to_string()];
    extend_assembled_input_args(&mut args, video);
    extend_assembled_input_args(&mut args, audio);
    args.extend([
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "1:a:0".to_string(),
        "-c".to_string(),
        "copy".to_string(),
    ]);
    if audio_use_adtstoasc {
        args.extend(["-bsf:a".to_string(), "aac_adtstoasc".to_string()]);
    }
    args.extend([
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string_lossy().into_owned(),
    ]);
    args
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
    let (save_dir, job_id) = {
        let guard = job.lock().await;
        (guard.save_dir.clone(), guard.snapshot.id.clone())
    };
    remove_hls_temp_dir(&save_dir, &job_id);
}

async fn run_ffmpeg_remux(
    job: Arc<Mutex<DownloadJobInner>>,
    kind: ChildKind,
    ffmpeg: String,
    args: Vec<String>,
    fallback_on_error: bool,
    on_progress: impl FnMut(i64, i64) + Send + 'static,
) -> Result<(), HlsDownloadError> {
    let result = tokio::task::spawn_blocking(move || {
        run_ffmpeg_child_collect_progress(job, kind, ffmpeg, args, None, on_progress)
    })
    .await
    .map_err(|_| HlsDownloadError::Operation("FFmpeg 任务异常退出".into()))?;

    result.map_err(|err| {
        if fallback_on_error {
            HlsDownloadError::RemuxFallback(err)
        } else {
            HlsDownloadError::Operation(err)
        }
    })
}

async fn resolve_single_output_extension(
    ffprobe: &str,
    probe_path: &Path,
    hint: MediaExtensionHint,
) -> String {
    if hint == MediaExtensionHint::M4a {
        return "m4a".to_string();
    }
    let ffprobe = ffprobe.to_string();
    let probe_path = probe_path.to_path_buf();
    let probed = tokio::task::spawn_blocking(move || probe_local_media_streams(&ffprobe, &probe_path))
        .await
        .ok()
        .flatten();
    match probed {
        Some((false, true)) => "m4a".to_string(),
        _ => "mp4".to_string(),
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_segment_strategy(
    app: AppHandle,
    job: Arc<Mutex<DownloadJobInner>>,
    ffmpeg: String,
    ffprobe: String,
    mode: DownloadMode,
    video_url: String,
    audio_url: Option<String>,
    headers: String,
    strategy: DownloadStrategy,
) {
    let (job_id, output_parent, downloaded_bytes, speed_active) = {
        let mut guard = job.lock().await;
        guard.snapshot.status = DownloadStatus::Running;
        guard.snapshot.phase = Some(DownloadPhase::Downloading);
        guard.downloaded_bytes.store(0, Ordering::Relaxed);
        guard.speed_active.store(true, Ordering::Relaxed);
        (
            guard.snapshot.id.clone(),
            guard.save_dir.clone(),
            guard.downloaded_bytes.clone(),
            guard.speed_active.clone(),
        )
    };
    eprintln!(
        "[hikaru][download] run_segment_strategy 启动 job={job_id} mode={mode:?} strategy={strategy:?} video_url={video_url} audio={}",
        audio_url.is_some()
    );

    let ffmpeg_for_fallback = ffmpeg.clone();
    let ffprobe_for_fallback = ffprobe.clone();
    let audio_url_for_fallback = audio_url.clone();
    let cancel = {
        let guard = job.lock().await;
        crate::hls_types::CancellationToken::new(guard.cancel_flag.clone())
    };
    let config = SegmentDownloadConfig::automatic();
    let hls_client = match build_hls_http_client(&config) {
        Ok(client) => client,
        Err(err) => {
            speed_active.store(false, Ordering::Relaxed);
            commit_snapshot_async(&job, |snap| {
                snap.status = DownloadStatus::Failed;
                snap.phase = None;
                snap.speed_bytes_per_sec = None;
                snap.error = Some(err.message());
            })
            .await;
            return;
        }
    };

    let mark_merging = {
        let job = job.clone();
        let speed_active = speed_active.clone();
        Arc::new(move || {
            speed_active.store(false, Ordering::Relaxed);
            update_snapshot_progress(&job, |snap| {
                snap.phase = Some(DownloadPhase::Merging);
                snap.speed_bytes_per_sec = None;
            });
        })
    };

    let result: Result<(), HlsDownloadError> = async {
        let video_progress = Arc::new(std::sync::Mutex::new(InputProgress::default()));
        let audio_progress = Arc::new(std::sync::Mutex::new(InputProgress::default()));
        let on_pair_progress = {
            let job = job.clone();
            let video_progress = video_progress.clone();
            let audio_progress = audio_progress.clone();
            move |kind: MediaKind, done: i64, total: i64| {
                let stream = match kind {
                    MediaKind::Video => DownloadInputKind::Video,
                    MediaKind::Audio => DownloadInputKind::Audio,
                };
                update_hls_separate_stream_progress(
                    &job,
                    stream,
                    done,
                    total,
                    &video_progress,
                    &audio_progress,
                );
            }
        };

        let outcome = match mode {
            DownloadMode::Single => {
                download_hls_single_or_master_with_client(
                    hls_client,
                    job_id.clone(),
                    video_url.clone(),
                    output_parent,
                    &headers,
                    config,
                    cancel,
                    {
                        let job = job.clone();
                        move |done, total| {
                            update_snapshot_progress(&job, |snap| {
                                snap.processed_ms = done;
                                snap.duration_ms = total;
                                snap.progress = (total > 0)
                                    .then(|| (done as f64 / total as f64 * 0.95).clamp(0.0, 0.95));
                            });
                        }
                    },
                    on_pair_progress,
                    Some(downloaded_bytes),
                    Some(mark_merging),
                )
                .await?
            }
            DownloadMode::Separate => {
                let audio_url = audio_url.ok_or_else(|| {
                    HlsDownloadError::Operation("分离模式需要提供音频 URL".into())
                })?;
                let (video, audio) = download_hls_pair_with_client(
                    hls_client,
                    job_id.clone(),
                    video_url.clone(),
                    audio_url,
                    output_parent,
                    &headers,
                    config,
                    cancel,
                    on_pair_progress,
                    Some(downloaded_bytes),
                    Some(mark_merging),
                )
                .await?;
                HlsSingleDownloadResult::MuxedPair { video, audio }
            }
        };

        speed_active.store(false, Ordering::Relaxed);
        commit_snapshot_async(&job, |snap| {
            snap.phase = Some(DownloadPhase::Merging);
            snap.speed_bytes_per_sec = None;
        })
        .await;
        if is_job_cancelled_async(&job).await {
            return Ok(());
        }

        match outcome {
            HlsSingleDownloadResult::Single(temp) => {
                update_snapshot_progress(&job, |snap| {
                    snap.duration_ms = snap.duration_ms.max(temp.duration_ms);
                });
                let ext = resolve_single_output_extension(
                    &ffprobe,
                    &temp.probe_path,
                    temp.extension_hint,
                )
                .await;
                let output_path = job.lock().await.lock_output_path(&ext);
                let fallback_on_error = matches!(temp.media, AssembledMedia::ConcatList(_));
                let args = build_single_remux_args(
                    &temp.media,
                    &output_path,
                    temp.extension_hint == MediaExtensionHint::Ts,
                );
                run_ffmpeg_remux(
                    job.clone(),
                    ChildKind::Merge,
                    ffmpeg,
                    args,
                    fallback_on_error,
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
            HlsSingleDownloadResult::MuxedPair { video, audio } => {
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
                let output_path = job.lock().await.lock_output_path("mp4");
                let fallback_on_error = matches!(video.media, AssembledMedia::ConcatList(_))
                    || matches!(audio.media, AssembledMedia::ConcatList(_));
                let args = build_assembled_merge_args(
                    &video.media,
                    &audio.media,
                    audio.extension_hint == MediaExtensionHint::Ts,
                    &output_path,
                );
                run_ffmpeg_remux(
                    job.clone(),
                    ChildKind::Merge,
                    ffmpeg,
                    args,
                    fallback_on_error,
                    |_processed, _duration| {},
                )
                .await?;
            }
        }

        Ok(())
    }
    .await;

    speed_active.store(false, Ordering::Relaxed);
    match &result {
        Ok(()) => eprintln!("[hikaru][download] run_segment_strategy 分片阶段完成 job={job_id}"),
        Err(err) => eprintln!(
            "[hikaru][download] run_segment_strategy 分片阶段失败 job={job_id}: {}",
            err.message()
        ),
    }

    let current_output_path = { job.lock().await.output_path.clone() };
    match result {
        Ok(()) => {
            if is_job_cancelled_async(&job).await {
                cleanup_hls_job_temp_async(&job).await;
                if let Some(path) = current_output_path {
                    let _ = fs::remove_file(path);
                }
                return;
            }
            cleanup_hls_job_temp_async(&job).await;
            commit_snapshot_async(&job, |snap| {
                snap.status = DownloadStatus::Completed;
                snap.phase = None;
                snap.progress = Some(1.0);
                snap.speed_bytes_per_sec = None;
                snap.output_path = current_output_path.map(|p| p.to_string_lossy().into_owned());
                snap.error = None;
            })
            .await;
        }
        Err(err) => {
            let err_message = err.message();
            let fallback_allowed =
                strategy == DownloadStrategy::Auto && err.is_auto_fallback_eligible();
            cleanup_hls_job_temp_async(&job).await;
            if let Some(path) = current_output_path {
                let _ = fs::remove_file(path);
            }
            if fallback_allowed {
                eprintln!(
                    "[hikaru][download] 回退至 FFmpeg 兼容模式 job={job_id}: {err_message}"
                );
                {
                    let mut guard = job.lock().await;
                    guard.output_path = None;
                    guard.snapshot.phase = Some(DownloadPhase::Preparing);
                    guard.snapshot.output_path = None;
                    guard.snapshot.speed_bytes_per_sec = None;
                }
                let app = app.clone();
                let job = job.clone();
                tokio::task::spawn_blocking(move || {
                    run_ffmpeg_strategy(
                        app,
                        job,
                        ffmpeg_for_fallback,
                        ffprobe_for_fallback,
                        mode,
                        video_url,
                        audio_url_for_fallback,
                        headers,
                    );
                })
                .await
                .ok();
                return;
            }
            kill_all_children_async(&job).await;
            commit_snapshot_async(&job, |snap| {
                if snap.status != DownloadStatus::Cancelled {
                    snap.status = DownloadStatus::Failed;
                    snap.phase = None;
                    snap.speed_bytes_per_sec = None;
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
        let (output_path, total_downloaded_bytes, speed_active) = {
            let guard = job.blocking_lock();
            (
                guard
                    .output_path
                    .clone()
                    .ok_or_else(|| "缺少输出文件路径".to_string())?,
                guard.downloaded_bytes.clone(),
                guard.speed_active.clone(),
            )
        };
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let (video_tmp, audio_tmp) = temp_download_paths(&output_path)?;
        let _ = fs::remove_file(&video_tmp);
        let _ = fs::remove_file(&audio_tmp);

        let video_progress = Arc::new(std::sync::Mutex::new(InputProgress::default()));
        let audio_progress = Arc::new(std::sync::Mutex::new(InputProgress::default()));
        let video_bytes = Arc::new(AtomicU64::new(0));
        let audio_bytes = Arc::new(AtomicU64::new(0));

        let video_job = job.clone();
        let video_progress_for_thread = video_progress.clone();
        let audio_progress_for_video = audio_progress.clone();
        let video_args =
            build_input_download_args(DownloadInputKind::Video, &video_url, &headers, &video_tmp);
        let video_ffmpeg = ffmpeg.clone();
        let video_bytes_for_thread = video_bytes.clone();
        let audio_bytes_for_video = audio_bytes.clone();
        let total_for_video = total_downloaded_bytes.clone();
        let video_handle = std::thread::spawn(move || {
            run_ffmpeg_child_collect_progress(
                video_job.clone(),
                ChildKind::Video,
                video_ffmpeg,
                video_args,
                Some(video_bytes_for_thread.clone()),
                move |processed, duration| {
                    total_for_video.store(
                        video_bytes_for_thread.load(Ordering::Relaxed)
                            + audio_bytes_for_video.load(Ordering::Relaxed),
                        Ordering::Relaxed,
                    );
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
        let audio_args =
            build_input_download_args(DownloadInputKind::Audio, &audio_url, &headers, &audio_tmp);
        let audio_ffmpeg = ffmpeg.clone();
        let audio_bytes_for_thread = audio_bytes.clone();
        let video_bytes_for_audio = video_bytes.clone();
        let total_for_audio = total_downloaded_bytes;
        let audio_handle = std::thread::spawn(move || {
            run_ffmpeg_child_collect_progress(
                audio_job.clone(),
                ChildKind::Audio,
                audio_ffmpeg,
                audio_args,
                Some(audio_bytes_for_thread.clone()),
                move |processed, duration| {
                    total_for_audio.store(
                        video_bytes_for_audio.load(Ordering::Relaxed)
                            + audio_bytes_for_thread.load(Ordering::Relaxed),
                        Ordering::Relaxed,
                    );
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
        speed_active.store(false, Ordering::Relaxed);
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
            snap.phase = Some(DownloadPhase::Merging);
            snap.speed_bytes_per_sec = None;
        });

        let merge_args = build_merge_args(&video_tmp, &audio_tmp, &output_path);
        run_ffmpeg_child_collect_progress(
            job.clone(),
            ChildKind::Merge,
            ffmpeg,
            merge_args,
            None,
            {
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
            },
        )?;

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
            snap.phase = None;
            snap.progress = Some(1.0);
            snap.speed_bytes_per_sec = None;
            snap.output_path = Some(output_path.to_string_lossy().into_owned());
            snap.error = None;
        });

        let _ = app;
        Ok(())
    })();

    if let Err(err) = result {
        kill_all_children(&job);
        let output_path = {
            let guard = job.blocking_lock();
            guard.speed_active.store(false, Ordering::Relaxed);
            guard.output_path.clone()
        };
        if let Some(output_path) = output_path {
            if let Ok((video_tmp, audio_tmp)) = temp_download_paths(&output_path) {
                let _ = fs::remove_file(video_tmp);
                let _ = fs::remove_file(audio_tmp);
            }
            let _ = fs::remove_file(output_path);
        }
        commit_snapshot(&job, |snap| {
            if snap.status != DownloadStatus::Cancelled {
                snap.status = DownloadStatus::Failed;
                snap.phase = None;
                snap.speed_bytes_per_sec = None;
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
            guard
                .output_path
                .clone()
                .ok_or_else(|| "缺少输出文件路径".to_string())?
        };

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut child = hidden_command(&ffmpeg)
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
                    handle_progress_line(&job, &text, &mut parsed_duration_ms, &mut tail);
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
            snap.phase = None;
            snap.progress = Some(1.0);
            snap.speed_bytes_per_sec = None;
            snap.processed_ms = parsed_duration_ms.max(snap.duration_ms);
            snap.output_path = Some(output_path.to_string_lossy().into_owned());
            snap.error = None;
        });

        let _ = app;
        Ok(())
    })();

    if let Err(err) = result {
        kill_all_children(&job);
        let output_path = {
            let guard = job.blocking_lock();
            guard.speed_active.store(false, Ordering::Relaxed);
            guard.output_path.clone()
        };
        if let Some(output_path) = output_path {
            let _ = fs::remove_file(output_path);
        }
        commit_snapshot(&job, |snap| {
            if snap.status != DownloadStatus::Cancelled {
                snap.status = DownloadStatus::Failed;
                snap.phase = None;
                snap.speed_bytes_per_sec = None;
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

    if let Some(total_size) = parse_progress_total_size(text) {
        if let Ok(guard) = job.try_lock() {
            guard.downloaded_bytes.store(total_size, Ordering::Relaxed);
        }
    }

    let processed_ms = parse_progress_out_time_ms(text).or_else(|| parse_time_token(text));

    if let Some(processed) = processed_ms {
        let progress =
            (*duration_ms > 0).then(|| (processed as f64 / *duration_ms as f64).clamp(0.0, 1.0));
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
    if args.mode == DownloadMode::Separate
        && args
            .audio_url
            .as_deref()
            .map(|u| u.trim().is_empty())
            .unwrap_or(true)
    {
        return Err("分离模式需要提供音频 URL".into());
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

    let save_dir = match args.save_dir.as_deref() {
        Some(dir) if !dir.trim().is_empty() => {
            let path = PathBuf::from(dir);
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            path
        }
        _ => default_save_dir(&app)?,
    };

    let job_id = new_job_id();
    let snapshot = DownloadSnapshot {
        id: job_id.clone(),
        status: DownloadStatus::Pending,
        phase: Some(DownloadPhase::Preparing),
        progress: None,
        processed_ms: 0,
        duration_ms: 0,
        speed_bytes_per_sec: None,
        output_path: None,
        error: None,
    };

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let job = Arc::new(Mutex::new(DownloadJobInner {
        snapshot,
        save_dir,
        stem,
        output_path: None,
        children: Vec::new(),
        cancel_flag,
        downloaded_bytes: Arc::new(AtomicU64::new(0)),
        speed_active: Arc::new(AtomicBool::new(false)),
        speed_meter: SpeedMeter::default(),
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
                    ffprobe,
                    mode,
                    video_url,
                    audio_url,
                    headers,
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
                    ffprobe,
                    mode,
                    video_url,
                    audio_url,
                    headers,
                    strategy,
                )
                .await;
            });
            tauri::async_runtime::spawn(async move {
                if let Err(err) = task.await {
                    eprintln!("[hikaru][download] 分片下载任务异常退出: {err:?}");
                    commit_snapshot_async(&supervised_job, |snap| {
                        snap.status = DownloadStatus::Failed;
                        snap.phase = None;
                        snap.speed_bytes_per_sec = None;
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
    let job = {
        let jobs = state.jobs.lock().await;
        jobs.get(&job_id)
            .cloned()
            .ok_or_else(|| format!("下载任务不存在: {job_id}"))?
    };
    let mut guard = job.lock().await;
    let active = guard.snapshot.status == DownloadStatus::Running
        && guard.speed_active.load(Ordering::Relaxed);
    let total_bytes = guard.downloaded_bytes.load(Ordering::Relaxed);
    let speed = guard
        .speed_meter
        .sample(active, total_bytes, Instant::now());
    guard.snapshot.speed_bytes_per_sec = speed;
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

    let (mut children, save_dir, output_path, job_id_for_hls) = {
        let mut guard = job.lock().await;
        CancellationToken::new(guard.cancel_flag.clone()).cancel();
        guard.speed_active.store(false, Ordering::Relaxed);
        guard.snapshot.status = DownloadStatus::Cancelled;
        guard.snapshot.phase = None;
        guard.snapshot.speed_bytes_per_sec = None;
        guard.snapshot.error = Some("下载已取消".into());
        (
            std::mem::take(&mut guard.children),
            guard.save_dir.clone(),
            guard.output_path.clone(),
            guard.snapshot.id.clone(),
        )
    };

    for entry in &mut children {
        let _ = entry.child.kill();
        let _ = entry.child.wait();
    }
    remove_hls_temp_dir(&save_dir, &job_id_for_hls);
    if let Some(output_path) = output_path {
        if let Ok((video_tmp, audio_tmp)) = temp_download_paths(&output_path) {
            let _ = fs::remove_file(video_tmp);
            let _ = fs::remove_file(audio_tmp);
        }
        let _ = fs::remove_file(output_path);
    }
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
        assert_eq!(parse_progress_out_time_ms("out_time_ms=12345000"), Some(12345));
        assert_eq!(parse_progress_out_time_ms("progress=continue"), None);
    }

    #[test]
    fn parse_progress_total_size_works() {
        assert_eq!(parse_progress_total_size("total_size=52428800"), Some(52428800));
        assert_eq!(parse_progress_total_size("total_size=N/A"), None);
    }

    #[test]
    fn download_phase_serializes_as_camel_case() {
        assert_eq!(
            serde_json::to_string(&DownloadPhase::Preparing).unwrap(),
            "\"preparing\""
        );
        assert_eq!(
            serde_json::to_string(&DownloadPhase::Downloading).unwrap(),
            "\"downloading\""
        );
        assert_eq!(
            serde_json::to_string(&DownloadPhase::Merging).unwrap(),
            "\"merging\""
        );
    }

    #[test]
    fn speed_meter_computes_smoothed_rate_and_resets_when_inactive() {
        let t0 = Instant::now();
        let mut meter = SpeedMeter::default();
        assert_eq!(meter.sample(true, 0, t0), None);
        // 1 second -> 50 MB
        let t1 = t0 + std::time::Duration::from_secs(1);
        assert_eq!(meter.sample(true, 50_000_000, t1), Some(50_000_000));
        // 1 more second -> 30 MB delta -> 0.45 * 30M + 0.55 * 50M = 41M
        let t2 = t1 + std::time::Duration::from_secs(1);
        assert_eq!(meter.sample(true, 80_000_000, t2), Some(41_000_000));
        // Inactive clears speed
        assert_eq!(meter.sample(false, 80_000_000, t2), None);
    }

    #[test]
    fn build_single_remux_and_assembled_merge_args_support_concat_lists() {
        let single_args = build_single_remux_args(
            &AssembledMedia::ConcatList(PathBuf::from("concat.txt")),
            Path::new("out.mp4"),
            true,
        );
        assert!(single_args.windows(2).any(|w| w == ["-f", "concat"]));
        assert!(single_args.windows(2).any(|w| w == ["-bsf:a", "aac_adtstoasc"]));

        let merge_args = build_assembled_merge_args(
            &AssembledMedia::ConcatList(PathBuf::from("v_concat.txt")),
            &AssembledMedia::SingleFile(PathBuf::from("audio.bin")),
            false,
            Path::new("merged.mp4"),
        );
        assert!(merge_args.windows(2).any(|w| w == ["-f", "concat"]));
        assert!(!merge_args.contains(&"aac_adtstoasc".to_string()));
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
