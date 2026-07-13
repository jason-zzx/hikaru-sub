use crate::dependencies::work_cache_dir;
use crate::ffmpeg::{resolve_ffmpeg, resolve_ffprobe};
use crate::media_server::MediaServer;
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
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

static CLIP_JOB_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipMode {
    Soft,
    Hard,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartVideoClipArgs {
    pub video_path: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub mode: ClipMode,
    pub save_dir: Option<String>,
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSnapshot {
    pub id: String,
    pub status: ClipStatus,
    pub progress: Option<f64>,
    pub processed_ms: i64,
    pub duration_ms: i64,
    pub output_path: Option<String>,
    pub error: Option<String>,
    pub fell_back_to_hard: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractVideoFrameArgs {
    pub video_path: String,
    pub time_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractVideoFrameResult {
    pub image_path: String,
    pub image_url: String,
}

struct ClipJobInner {
    snapshot: ClipSnapshot,
    cancel_flag: Arc<AtomicBool>,
    child: Option<std::process::Child>,
    output_path: PathBuf,
}

pub struct ClipState {
    jobs: Mutex<HashMap<String, Arc<Mutex<ClipJobInner>>>>,
}

impl Default for ClipState {
    fn default() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
        }
    }
}

impl ClipState {
    /// 应用退出时终止所有运行中的 FFmpeg 子进程，避免残留切片进程。
    pub fn shutdown(&self) {
        if let Ok(jobs) = self.jobs.try_lock() {
            for job in jobs.values() {
                if let Ok(mut guard) = job.try_lock() {
                    guard.cancel_flag.store(true, Ordering::SeqCst);
                    if let Some(child) = &mut guard.child {
                        let _ = child.kill();
                    }
                }
            }
        }
    }
}

pub fn init_clip_state(app: &mut tauri::App) {
    app.manage(ClipState::default());
}

fn new_job_id() -> String {
    let n = CLIP_JOB_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("clip-{n}")
}

fn format_clip_time_token(ms: i64) -> String {
    let ms = ms.max(0);
    let total_secs = ms / 1000;
    let h = total_secs / 3600;
    let m = (total_secs % 3600) / 60;
    let s = total_secs % 60;
    // HHMMSS（秒级；小时按两位补零，超过 99 小时自然变长）
    format!("{:02}{:02}{:02}", h, m, s)
}

fn path_stem(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("video")
        .to_string()
}

pub(crate) fn default_clip_file_name(video_path: &str, start_ms: i64, end_ms: i64) -> String {
    format!(
        "{}-{}-{}.mp4",
        path_stem(video_path),
        format_clip_time_token(start_ms),
        format_clip_time_token(end_ms)
    )
}

pub(crate) fn resolve_unique_output_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("clip");
    let ext = Path::new(file_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4");
    for i in 1..10_000 {
        let next = dir.join(format!("{stem}_{i}.{ext}"));
        if !next.exists() {
            return next;
        }
    }
    dir.join(format!("{stem}_{}.{}", std::process::id(), ext))
}

#[derive(Debug, Clone)]
pub(crate) struct HardClipEncodePlan {
    pub video_codec: String,
    pub audio_codec: String,
    pub crf: Option<u8>,
    pub preset: Option<String>,
    pub video_bitrate_kbps: Option<u32>,
}

fn ms_to_ffmpeg_time(ms: i64) -> String {
    let ms = ms.max(0);
    let total_secs = ms / 1000;
    let millis = ms % 1000;
    let h = total_secs / 3600;
    let m = (total_secs % 3600) / 60;
    let s = total_secs % 60;
    format!("{h:02}:{m:02}:{s:02}.{millis:03}")
}

/// 软切：输入侧 -ss/-to + stream copy（关键帧对齐，快）
pub(crate) fn build_soft_clip_args(
    input: &str,
    output: &Path,
    start_ms: i64,
    end_ms: i64,
) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-y".into(),
        "-ss".into(),
        ms_to_ffmpeg_time(start_ms),
        "-to".into(),
        ms_to_ffmpeg_time(end_ms),
        "-i".into(),
        input.into(),
        "-c".into(),
        "copy".into(),
        "-avoid_negative_ts".into(),
        "make_zero".into(),
        "-progress".into(),
        "pipe:2".into(),
        output.to_string_lossy().into_owned(),
    ]
}

/// 硬切：解码侧精确定位 + 重编码
pub(crate) fn build_hard_clip_args(
    input: &str,
    output: &Path,
    start_ms: i64,
    end_ms: i64,
    plan: HardClipEncodePlan,
) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        input.into(),
        "-ss".into(),
        ms_to_ffmpeg_time(start_ms),
        "-to".into(),
        ms_to_ffmpeg_time(end_ms),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a?".into(),
        "-c:v".into(),
        plan.video_codec,
    ];
    if let Some(preset) = plan.preset {
        args.extend(["-preset".into(), preset]);
    }
    if let Some(kbps) = plan
        .video_bitrate_kbps
        .filter(|v| *v >= 100)
        .map(|v| v.min(200_000))
    {
        args.extend(["-b:v".into(), format!("{kbps}k")]);
    } else if let Some(crf) = plan.crf {
        args.extend(["-crf".into(), crf.to_string()]);
    }
    args.extend([
        "-c:a".into(),
        plan.audio_codec,
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-progress".into(),
        "pipe:2".into(),
        output.to_string_lossy().into_owned(),
    ]);
    args
}

/// 对齐 BurnView nearSource + burn.rs：优先源/默认码率；CRF 18 仅作无码率时的回退字段
pub(crate) fn near_source_fallback_plan(video_bitrate_kbps: Option<u32>) -> HardClipEncodePlan {
    const DEFAULT_KBPS: u32 = 12_000;
    let kbps = video_bitrate_kbps
        .filter(|v| *v >= 100)
        .map(|v| v.min(200_000))
        .unwrap_or(DEFAULT_KBPS);
    HardClipEncodePlan {
        video_codec: "libx264".into(),
        audio_codec: "aac".into(),
        crf: Some(18),
        preset: Some("medium".into()),
        video_bitrate_kbps: Some(kbps),
    }
}

pub(crate) fn validate_clip_range(
    start_ms: i64,
    end_ms: i64,
    video_duration_ms: i64,
) -> Result<(), String> {
    if start_ms < 0 || end_ms < 0 {
        return Err("切片时间不能为负数".into());
    }
    if start_ms >= end_ms {
        return Err("切片开始时间必须早于结束时间".into());
    }
    if video_duration_ms > 0 && end_ms > video_duration_ms {
        return Err("切片结束时间不能超过视频时长".into());
    }
    Ok(())
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

pub(crate) fn parse_progress_out_time_ms(line: &str) -> Option<i64> {
    let rest = line.trim().strip_prefix("out_time_ms=")?;
    rest.trim().parse::<i64>().ok().map(|us| us / 1000)
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

fn parse_video_bitrate_kbps(output: &str) -> Option<u32> {
    output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("N/A") {
                return None;
            }
            trimmed.parse::<u64>().ok()
        })
        .find(|bits| *bits > 0)
        .and_then(|bits| u32::try_from(bits / 1000).ok())
        .filter(|kbps| *kbps > 0)
}

fn probe_video_bitrate_kbps(ffprobe: &str, video_path: &str) -> Result<Option<u32>, String> {
    let output = hidden_command(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=bit_rate:format=bit_rate",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            video_path,
        ])
        .output()
        .map_err(|e| format!("执行 ffprobe 失败：{e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffprobe 失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(parse_video_bitrate_kbps(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn parse_video_duration_ms(output: &str) -> Option<i64> {
    output.lines().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("N/A") {
            return None;
        }
        trimmed
            .parse::<f64>()
            .ok()
            .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
            .map(|seconds| (seconds * 1000.0).round() as i64)
    })
}

fn probe_video_duration_ms(ffprobe: &str, video_path: &str) -> Result<i64, String> {
    let output = hidden_command(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            video_path,
        ])
        .output()
        .map_err(|e| format!("执行 ffprobe 失败：{e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffprobe 失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(parse_video_duration_ms(&String::from_utf8_lossy(&output.stdout)).unwrap_or(0))
}

fn update_snapshot(job: &Arc<Mutex<ClipJobInner>>, update: impl FnOnce(&mut ClipSnapshot)) {
    if let Ok(mut guard) = job.try_lock() {
        update(&mut guard.snapshot);
    }
}

fn commit_snapshot(job: &Arc<Mutex<ClipJobInner>>, update: impl FnOnce(&mut ClipSnapshot)) {
    let mut guard = job.blocking_lock();
    update(&mut guard.snapshot);
}

fn handle_progress_line(
    job: &Arc<Mutex<ClipJobInner>>,
    text: &str,
    duration_ms: i64,
    tail: &mut String,
) {
    let processed_ms = parse_progress_out_time_ms(text).or_else(|| parse_time_token(text));
    if let Some(processed) = processed_ms {
        let progress =
            (duration_ms > 0).then(|| (processed as f64 / duration_ms as f64).clamp(0.0, 1.0));
        update_snapshot(job, |snap| {
            snap.processed_ms = processed.max(0);
            snap.progress = progress;
        });
    }

    let trimmed = text.trim();
    if !trimmed.is_empty() {
        *tail = trimmed.to_string();
    }
}

enum ClipFfmpegResult {
    Completed,
    Cancelled,
    Failed(String),
}

fn run_ffmpeg_for_clip(
    job: &Arc<Mutex<ClipJobInner>>,
    ffmpeg: &str,
    ffmpeg_args: &[String],
    duration_ms: i64,
) -> ClipFfmpegResult {
    let cancel_flag = {
        let guard = job.blocking_lock();
        if guard.cancel_flag.load(Ordering::SeqCst)
            || guard.snapshot.status == ClipStatus::Cancelled
        {
            return ClipFfmpegResult::Cancelled;
        }
        guard.cancel_flag.clone()
    };

    let mut child = match hidden_command(ffmpeg)
        .args(ffmpeg_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => return ClipFfmpegResult::Failed(format!("无法启动 FFmpeg（{ffmpeg}）：{err}")),
    };

    let mut stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => return ClipFfmpegResult::Failed("无法读取 FFmpeg 输出".into()),
    };

    {
        let mut guard = job.blocking_lock();
        guard.snapshot.status = ClipStatus::Running;
        guard.child = Some(child);
    }

    let mut tail = String::new();
    let mut buf = [0u8; 4096];
    let mut line: Vec<u8> = Vec::new();

    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            let mut guard = job.blocking_lock();
            if let Some(child) = &mut guard.child {
                let _ = child.kill();
            }
            break;
        }

        let n = match stderr.read(&mut buf) {
            Ok(n) => n,
            Err(err) => return ClipFfmpegResult::Failed(err.to_string()),
        };
        if n == 0 {
            break;
        }
        for &byte in &buf[..n] {
            if byte == b'\n' || byte == b'\r' {
                if !line.is_empty() {
                    let text = String::from_utf8_lossy(&line).into_owned();
                    handle_progress_line(job, &text, duration_ms, &mut tail);
                    line.clear();
                }
            } else {
                line.push(byte);
            }
        }
    }

    if !line.is_empty() {
        let text = String::from_utf8_lossy(&line).into_owned();
        handle_progress_line(job, &text, duration_ms, &mut tail);
    }

    let (cancelled, status) = {
        let mut guard = job.blocking_lock();
        let cancelled = guard.cancel_flag.load(Ordering::SeqCst)
            || guard.snapshot.status == ClipStatus::Cancelled;
        let status = if let Some(mut child) = guard.child.take() {
            child.wait()
        } else {
            return ClipFfmpegResult::Failed("FFmpeg 进程已丢失".into());
        };
        (cancelled, status)
    };

    if cancelled {
        return ClipFfmpegResult::Cancelled;
    }

    match status {
        Ok(status) if status.success() => ClipFfmpegResult::Completed,
        Ok(_) => ClipFfmpegResult::Failed(format!("FFmpeg 切片失败：{}", tail.trim())),
        Err(err) => ClipFfmpegResult::Failed(err.to_string()),
    }
}

fn verify_output_file(output_path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(output_path).map_err(|e| format!("切片输出不存在：{e}"))?;
    if metadata.len() == 0 {
        return Err("切片输出文件为空".into());
    }
    Ok(())
}

fn mark_cancelled(job: &Arc<Mutex<ClipJobInner>>, output_path: &Path) {
    let _ = fs::remove_file(output_path);
    commit_snapshot(job, |snap| {
        snap.status = ClipStatus::Cancelled;
        snap.error = Some("切片已取消".into());
    });
}

fn mark_completed(job: &Arc<Mutex<ClipJobInner>>, output_path: &Path, duration_ms: i64) {
    commit_snapshot(job, |snap| {
        snap.status = ClipStatus::Completed;
        snap.progress = Some(1.0);
        snap.processed_ms = snap.processed_ms.max(duration_ms);
        snap.output_path = Some(output_path.to_string_lossy().into_owned());
        snap.error = None;
    });
}

fn run_hard_clip(
    job: &Arc<Mutex<ClipJobInner>>,
    ffmpeg: &str,
    ffprobe: &str,
    args: &StartVideoClipArgs,
    output_path: &Path,
    duration_ms: i64,
) -> Result<(), String> {
    let video_bitrate_kbps = probe_video_bitrate_kbps(ffprobe, &args.video_path).unwrap_or(None);
    let plan = near_source_fallback_plan(video_bitrate_kbps);
    let hard_args = build_hard_clip_args(
        &args.video_path,
        output_path,
        args.start_ms,
        args.end_ms,
        plan,
    );

    match run_ffmpeg_for_clip(job, ffmpeg, &hard_args, duration_ms) {
        ClipFfmpegResult::Completed => {
            verify_output_file(output_path)?;
            mark_completed(job, output_path, duration_ms);
            Ok(())
        }
        ClipFfmpegResult::Cancelled => {
            mark_cancelled(job, output_path);
            Ok(())
        }
        ClipFfmpegResult::Failed(err) => Err(err),
    }
}

fn run_clip_job(
    job: Arc<Mutex<ClipJobInner>>,
    ffmpeg: String,
    ffprobe: String,
    args: StartVideoClipArgs,
    output_path: PathBuf,
) {
    let result = (|| -> Result<(), String> {
        let duration_ms = args.end_ms - args.start_ms;

        if args.mode == ClipMode::Soft {
            let soft_args =
                build_soft_clip_args(&args.video_path, &output_path, args.start_ms, args.end_ms);
            match run_ffmpeg_for_clip(&job, &ffmpeg, &soft_args, duration_ms) {
                ClipFfmpegResult::Completed => match verify_output_file(&output_path) {
                    Ok(()) => {
                        mark_completed(&job, &output_path, duration_ms);
                        return Ok(());
                    }
                    Err(_) => {
                        let _ = fs::remove_file(&output_path);
                    }
                },
                ClipFfmpegResult::Cancelled => {
                    mark_cancelled(&job, &output_path);
                    return Ok(());
                }
                ClipFfmpegResult::Failed(_) => {
                    let _ = fs::remove_file(&output_path);
                }
            }

            commit_snapshot(&job, |snap| {
                if snap.status != ClipStatus::Cancelled {
                    snap.status = ClipStatus::Running;
                    snap.progress = None;
                    snap.processed_ms = 0;
                    snap.fell_back_to_hard = true;
                    snap.error = None;
                }
            });

            // 软切失败回退前若已取消，不再启动硬切
            let cancelled = {
                let guard = job.blocking_lock();
                guard.cancel_flag.load(Ordering::SeqCst)
                    || guard.snapshot.status == ClipStatus::Cancelled
            };
            if cancelled {
                mark_cancelled(&job, &output_path);
                return Ok(());
            }
        }

        run_hard_clip(&job, &ffmpeg, &ffprobe, &args, &output_path, duration_ms)
    })();

    if let Err(err) = result {
        let _ = fs::remove_file(&output_path);
        commit_snapshot(&job, |snap| {
            if snap.status != ClipStatus::Cancelled {
                snap.status = ClipStatus::Failed;
                snap.error = Some(err);
            }
        });
    }
}

fn job_is_active(snapshot: &ClipSnapshot) -> bool {
    matches!(snapshot.status, ClipStatus::Pending | ClipStatus::Running)
}

fn output_dir_for_args(args: &StartVideoClipArgs, video: &Path) -> Result<PathBuf, String> {
    if let Some(save_dir) = args
        .save_dir
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        return Ok(PathBuf::from(save_dir));
    }
    video
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "无法确定视频所在目录".to_string())
}

fn output_file_name_for_args(args: &StartVideoClipArgs) -> Result<String, String> {
    let Some(file_name) = args
        .file_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(default_clip_file_name(
            &args.video_path,
            args.start_ms,
            args.end_ms,
        ));
    };

    Path::new(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "切片文件名无效".into())
}

#[tauri::command]
pub async fn start_video_clip(app: AppHandle, args: StartVideoClipArgs) -> Result<String, String> {
    let video = PathBuf::from(&args.video_path);
    if !video.is_file() {
        return Err(format!("视频文件不存在: {}", args.video_path));
    }

    let settings = load_settings(&app).unwrap_or_default();
    let (ffmpeg, _) = resolve_ffmpeg(&app, &settings);
    let ffprobe = resolve_ffprobe(&app, &settings);
    let video_duration_ms = probe_video_duration_ms(&ffprobe, &args.video_path).unwrap_or(0);
    validate_clip_range(args.start_ms, args.end_ms, video_duration_ms)?;

    let output_dir = output_dir_for_args(&args, &video)?;
    fs::create_dir_all(&output_dir).map_err(|e| format!("无法创建输出目录: {e}"))?;
    let file_name = output_file_name_for_args(&args)?;
    let output_path = resolve_unique_output_path(&output_dir, &file_name);
    let duration_ms = args.end_ms - args.start_ms;

    let state = app.state::<ClipState>();
    let job_id = new_job_id();
    let snapshot = ClipSnapshot {
        id: job_id.clone(),
        status: ClipStatus::Pending,
        progress: None,
        processed_ms: 0,
        duration_ms,
        output_path: Some(output_path.to_string_lossy().into_owned()),
        error: None,
        fell_back_to_hard: false,
    };

    let job = Arc::new(Mutex::new(ClipJobInner {
        snapshot,
        cancel_flag: Arc::new(AtomicBool::new(false)),
        child: None,
        output_path: output_path.clone(),
    }));

    // retain + 活跃检查 + insert 必须在同一把锁内，避免并发 start 竞态
    {
        let mut jobs = state.jobs.lock().await;
        jobs.retain(|_, existing| {
            existing
                .try_lock()
                .map(|guard| job_is_active(&guard.snapshot))
                // 锁被占用时假定仍活跃，保留条目，避免误删正在跑的任务
                .unwrap_or(true)
        });
        if jobs.values().any(|existing| {
            existing
                .try_lock()
                .map(|guard| job_is_active(&guard.snapshot))
                .unwrap_or(true)
        }) {
            return Err("已有切片任务进行中".into());
        }
        jobs.insert(job_id.clone(), job.clone());
    }

    tauri::async_runtime::spawn_blocking(move || {
        run_clip_job(job, ffmpeg, ffprobe, args, output_path);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn get_video_clip_progress(
    app: AppHandle,
    job_id: String,
) -> Result<ClipSnapshot, String> {
    let state = app.state::<ClipState>();
    let mut jobs = state.jobs.lock().await;
    let job = jobs
        .get(&job_id)
        .ok_or_else(|| format!("切片任务不存在: {job_id}"))?;
    let snapshot = {
        let guard = job.lock().await;
        guard.snapshot.clone()
    };
    let terminal = matches!(
        snapshot.status,
        ClipStatus::Completed | ClipStatus::Failed | ClipStatus::Cancelled
    );
    if terminal {
        jobs.remove(&job_id);
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn cancel_video_clip(app: AppHandle, job_id: String) -> Result<(), String> {
    let state = app.state::<ClipState>();
    let job = {
        let jobs = state.jobs.lock().await;
        jobs.get(&job_id)
            .cloned()
            .ok_or_else(|| format!("切片任务不存在: {job_id}"))?
    };

    let (output_path, should_delete_output) = {
        let mut guard = job.lock().await;
        let should_delete_output = job_is_active(&guard.snapshot);
        guard.cancel_flag.store(true, Ordering::SeqCst);
        guard.snapshot.status = ClipStatus::Cancelled;
        guard.snapshot.error = Some("切片已取消".into());
        if let Some(child) = &mut guard.child {
            let _ = child.kill();
        }
        (guard.output_path.clone(), should_delete_output)
    };
    if should_delete_output {
        let _ = fs::remove_file(output_path);
    }
    Ok(())
}

fn build_frame_file_stem(time_ms: i64, nonce: u128) -> String {
    format!("clip-frame-{}-{nonce}", time_ms.max(0))
}

#[tauri::command]
pub async fn extract_video_frame(
    app: AppHandle,
    args: ExtractVideoFrameArgs,
    server: State<'_, MediaServer>,
) -> Result<ExtractVideoFrameResult, String> {
    let video = PathBuf::from(&args.video_path);
    if !video.is_file() {
        return Err(format!("视频文件不存在: {}", args.video_path));
    }

    let cache_dir = work_cache_dir(&app)
        .map_err(|e| format!("无法读取应用缓存目录: {e}"))?
        .join("clip-frames");
    fs::create_dir_all(&cache_dir).map_err(|e| format!("无法创建抽帧缓存目录: {e}"))?;

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let file_stem = build_frame_file_stem(args.time_ms, nonce);
    let image_path = cache_dir.join(format!("{file_stem}.jpg"));
    // 精确片尾常抽不到帧：略微前移；未知时长时也避免负值
    let seek_ms = args.time_ms.max(0);
    let settings = load_settings(&app).unwrap_or_default();
    let (ffmpeg, _) = resolve_ffmpeg(&app, &settings);

    let run_extract = |ss: String| -> Result<(), String> {
        let output = hidden_command(&ffmpeg)
            .arg("-hide_banner")
            .arg("-y")
            .arg("-ss")
            .arg(&ss)
            .arg("-i")
            .arg(&args.video_path)
            .arg("-frames:v")
            .arg("1")
            .arg("-an")
            .arg("-q:v")
            .arg("2")
            .arg(&image_path)
            .output()
            .map_err(|e| format!("无法启动 FFmpeg 抽帧: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "FFmpeg 抽帧失败：{}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        if !image_path.is_file()
            || fs::metadata(&image_path)
                .map(|m| m.len() == 0)
                .unwrap_or(true)
        {
            return Err("FFmpeg 抽帧未生成有效图片".into());
        }
        Ok(())
    };

    let seconds = format!("{:.3}", seek_ms as f64 / 1000.0);
    if let Err(first_err) = run_extract(seconds) {
        // 片尾失败时回退到略早的时刻再试一次
        let fallback_ms = seek_ms.saturating_sub(200);
        if fallback_ms == seek_ms {
            return Err(first_err);
        }
        let fallback_ss = format!("{:.3}", fallback_ms as f64 / 1000.0);
        run_extract(fallback_ss).map_err(|_| first_err)?;
    }

    let image_url = server.register_path(image_path.clone())?;
    Ok(ExtractVideoFrameResult {
        image_path: image_path.to_string_lossy().to_string(),
        image_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn soft_clip_args_use_stream_copy() {
        let args = build_soft_clip_args("in.mp4", Path::new("out.mp4"), 1_000, 5_000);
        assert!(args.windows(2).any(|w| w == ["-c", "copy"]));
        assert!(args.iter().any(|a| a == "-ss"));
        assert!(args.windows(2).any(|w| w == ["-progress", "pipe:2"]));
        assert!(args.contains(&"in.mp4".to_string()));
    }

    #[test]
    fn hard_clip_args_include_reencode_and_precise_times() {
        let args = build_hard_clip_args(
            "in.mp4",
            Path::new("out.mp4"),
            1_000,
            5_000,
            HardClipEncodePlan {
                video_codec: "libx264".into(),
                audio_codec: "aac".into(),
                crf: Some(18),
                preset: Some("medium".into()),
                video_bitrate_kbps: Some(12_000),
            },
        );
        assert!(args.windows(2).any(|w| w == ["-c:v", "libx264"]));
        assert!(args.windows(2).any(|w| w == ["-b:v", "12000k"]));
        assert!(!args.iter().any(|a| a == "-crf"));
        assert!(args.windows(2).any(|w| w == ["-c:a", "aac"]));
        let i_pos = args.iter().position(|a| a == "-i").unwrap();
        let ss_pos = args.iter().position(|a| a == "-ss").unwrap();
        assert!(ss_pos > i_pos);
    }

    #[test]
    fn hard_clip_args_use_crf_when_bitrate_missing() {
        let args = build_hard_clip_args(
            "in.mp4",
            Path::new("out.mp4"),
            0,
            1_000,
            HardClipEncodePlan {
                video_codec: "libx264".into(),
                audio_codec: "aac".into(),
                crf: Some(18),
                preset: Some("medium".into()),
                video_bitrate_kbps: None,
            },
        );
        assert!(args.windows(2).any(|w| w == ["-crf", "18"]));
        assert!(!args.iter().any(|a| a == "-b:v"));
    }

    #[test]
    fn near_source_fallback_plan_uses_default_bitrate() {
        let plan = near_source_fallback_plan(None);
        assert_eq!(plan.video_bitrate_kbps, Some(12_000));
    }

    #[test]
    fn default_clip_file_name_uses_safe_time_tokens() {
        // 65000ms = 0:01:05 → 000105
        // 125500ms = 0:02:05.500 → 秒级截断为 0:02:05 → 000205
        let name = default_clip_file_name("episode-01.mkv", 65_000, 125_500);
        assert_eq!(name, "episode-01-000105-000205.mp4");
    }

    #[test]
    fn resolve_unique_output_path_appends_numeric_suffix() {
        let dir = std::env::temp_dir().join(format!("hikaru-clip-name-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let first = dir.join("clip.mp4");
        std::fs::write(&first, b"x").unwrap();
        let resolved = resolve_unique_output_path(&dir, "clip.mp4");
        assert_eq!(resolved.file_name().unwrap(), "clip_1.mp4");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_clip_range_rejects_inverted() {
        assert!(validate_clip_range(5000, 1000, 10_000).is_err());
        assert!(validate_clip_range(0, 1000, 10_000).is_ok());
    }
}
