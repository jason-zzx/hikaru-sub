use crate::ffmpeg::{resolve_ffmpeg, resolve_ffprobe};
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
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

static BURN_JOB_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BurnMode {
    HardSubMp4,
    SoftSubMkv,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum BurnVideoEncoder {
    Auto,
    LibX264,
    H264Nvenc,
    H264Qsv,
    H264Amf,
    H264Videotoolbox,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BurnStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartBurnArgs {
    pub video_path: String,
    pub ass_path: String,
    pub output_path: String,
    pub mode: BurnMode,
    pub crf: Option<u8>,
    pub preset: Option<String>,
    pub video_encoder: Option<BurnVideoEncoder>,
    pub video_bitrate_kbps: Option<u32>,
    pub font_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BurnVideoProbe {
    pub video_bitrate_kbps: Option<u32>,
    pub available_encoders: Vec<BurnVideoEncoder>,
    pub preferred_encoder: BurnVideoEncoder,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BurnSnapshot {
    pub id: String,
    pub status: BurnStatus,
    pub progress: Option<f64>,
    pub processed_ms: i64,
    pub duration_ms: i64,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

struct BurnJobInner {
    snapshot: BurnSnapshot,
    output_path: PathBuf,
    child: Option<std::process::Child>,
    cancel_flag: Arc<AtomicBool>,
}

pub struct BurnState {
    jobs: Mutex<HashMap<String, Arc<Mutex<BurnJobInner>>>>,
}

impl Default for BurnState {
    fn default() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
        }
    }
}

impl BurnState {
    /// 应用退出时终止所有运行中的 FFmpeg 子进程，避免孤儿进程
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

pub fn init_burn_state(app: &mut tauri::App) {
    app.manage(BurnState::default());
}

fn new_job_id() -> String {
    let n = BURN_JOB_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("burn-{n}")
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

pub fn parse_progress_out_time_ms(line: &str) -> Option<i64> {
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

fn normalize_preset(preset: Option<&str>) -> String {
    const ALLOWED: &[&str] = &[
        "ultrafast",
        "superfast",
        "veryfast",
        "faster",
        "fast",
        "medium",
        "slow",
        "slower",
        "veryslow",
    ];
    let value = preset.unwrap_or("veryfast").trim();
    if ALLOWED.contains(&value) {
        value.to_string()
    } else {
        "veryfast".to_string()
    }
}

fn normalize_crf(crf: Option<u8>) -> String {
    crf.unwrap_or(20).min(51).to_string()
}

const DEFAULT_HARDWARE_VIDEO_BITRATE_KBPS: u32 = 12_000;
const BURN_ENCODER_ORDER: &[BurnVideoEncoder] = &[
    BurnVideoEncoder::LibX264,
    BurnVideoEncoder::H264Nvenc,
    BurnVideoEncoder::H264Qsv,
    BurnVideoEncoder::H264Amf,
    BurnVideoEncoder::H264Videotoolbox,
];

impl BurnVideoEncoder {
    fn ffmpeg_name(self) -> Option<&'static str> {
        match self {
            BurnVideoEncoder::Auto => None,
            BurnVideoEncoder::LibX264 => Some("libx264"),
            BurnVideoEncoder::H264Nvenc => Some("h264_nvenc"),
            BurnVideoEncoder::H264Qsv => Some("h264_qsv"),
            BurnVideoEncoder::H264Amf => Some("h264_amf"),
            BurnVideoEncoder::H264Videotoolbox => Some("h264_videotoolbox"),
        }
    }

    fn from_ffmpeg_name(name: &str) -> Option<Self> {
        match name {
            "libx264" => Some(BurnVideoEncoder::LibX264),
            "h264_nvenc" => Some(BurnVideoEncoder::H264Nvenc),
            "h264_qsv" => Some(BurnVideoEncoder::H264Qsv),
            "h264_amf" => Some(BurnVideoEncoder::H264Amf),
            "h264_videotoolbox" => Some(BurnVideoEncoder::H264Videotoolbox),
            _ => None,
        }
    }

    fn is_hardware(self) -> bool {
        matches!(
            self,
            BurnVideoEncoder::H264Nvenc
                | BurnVideoEncoder::H264Qsv
                | BurnVideoEncoder::H264Amf
                | BurnVideoEncoder::H264Videotoolbox
        )
    }
}

fn current_os() -> &'static str {
    std::env::consts::OS
}

fn normalize_video_bitrate_kbps(value: Option<u32>) -> Option<u32> {
    value
        .filter(|kbps| *kbps >= 100)
        .map(|kbps| kbps.min(200_000))
}

fn parse_available_encoders(output: &str) -> Vec<BurnVideoEncoder> {
    let mut found = Vec::new();
    for line in output.lines() {
        for token in line.split_whitespace().skip(1) {
            if let Some(encoder) = BurnVideoEncoder::from_ffmpeg_name(token) {
                if !found.contains(&encoder) {
                    found.push(encoder);
                }
                break;
            }
        }
    }

    BURN_ENCODER_ORDER
        .iter()
        .copied()
        .filter(|encoder| found.contains(encoder))
        .collect()
}

fn probe_available_burn_encoders(ffmpeg: &str) -> Result<Vec<BurnVideoEncoder>, String> {
    let output = hidden_command(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|e| format!("无法探测 FFmpeg 编码器：{e}"))?;
    if !output.status.success() {
        return Err(format!(
            "FFmpeg 编码器探测失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut encoders: Vec<BurnVideoEncoder> = parse_available_encoders(&stdout)
        .into_iter()
        .filter(|encoder| {
            !encoder.is_hardware() || hardware_encoder_runtime_available(ffmpeg, *encoder)
        })
        .collect();
    if encoders.is_empty() {
        encoders.push(BurnVideoEncoder::LibX264);
    }
    Ok(encoders)
}

fn hardware_encoder_runtime_available(ffmpeg: &str, encoder: BurnVideoEncoder) -> bool {
    let Some(name) = encoder.ffmpeg_name() else {
        return false;
    };
    let output = hidden_command(ffmpeg)
        .args(hardware_encoder_probe_args(name))
        .output();
    matches!(output, Ok(out) if out.status.success())
}

fn hardware_encoder_probe_args(encoder_name: &str) -> Vec<String> {
    [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:r=1:d=0.1",
        "-frames:v",
        "1",
        "-an",
        "-c:v",
        encoder_name,
        "-f",
        "null",
        "-",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn select_auto_encoder(
    available: &[BurnVideoEncoder],
    os: &str,
    allow_hardware: bool,
) -> BurnVideoEncoder {
    let priority: &[BurnVideoEncoder] = if !allow_hardware {
        &[BurnVideoEncoder::LibX264]
    } else {
        match os {
            "windows" => &[
                BurnVideoEncoder::H264Nvenc,
                BurnVideoEncoder::H264Qsv,
                BurnVideoEncoder::H264Amf,
                BurnVideoEncoder::LibX264,
            ],
            "macos" => &[
                BurnVideoEncoder::H264Videotoolbox,
                BurnVideoEncoder::LibX264,
            ],
            "linux" => &[
                BurnVideoEncoder::H264Nvenc,
                BurnVideoEncoder::H264Qsv,
                BurnVideoEncoder::LibX264,
            ],
            _ => &[BurnVideoEncoder::LibX264],
        }
    };

    priority
        .iter()
        .copied()
        .find(|encoder| available.contains(encoder))
        .or_else(|| {
            available
                .iter()
                .copied()
                .find(|encoder| *encoder != BurnVideoEncoder::Auto)
        })
        .unwrap_or(BurnVideoEncoder::LibX264)
}

fn select_burn_encoder(
    requested: BurnVideoEncoder,
    available: &[BurnVideoEncoder],
) -> BurnVideoEncoder {
    match requested {
        BurnVideoEncoder::Auto => select_auto_encoder(available, current_os(), true),
        encoder if available.contains(&encoder) => encoder,
        _ => BurnVideoEncoder::LibX264,
    }
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

fn escape_ass_filter_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'")
}

fn build_ass_filter(ass_path: &str, font_dir: Option<&str>) -> String {
    let mut filter = format!("ass=filename='{}'", escape_ass_filter_value(ass_path));
    if let Some(font_dir) = font_dir.map(str::trim).filter(|v| !v.is_empty()) {
        filter.push_str(&format!(
            ":fontsdir='{}'",
            escape_ass_filter_value(font_dir)
        ));
    }
    filter
}

fn build_hard_sub_args(
    video_path: &str,
    ass_path: &str,
    output_path: &Path,
    crf: Option<u8>,
    preset: Option<&str>,
    video_encoder: BurnVideoEncoder,
    video_bitrate_kbps: Option<u32>,
    font_dir: Option<&str>,
) -> Vec<String> {
    let encoder = if video_encoder == BurnVideoEncoder::Auto {
        BurnVideoEncoder::LibX264
    } else {
        video_encoder
    };
    let mut args = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        video_path.into(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a?".into(),
        "-sn".into(),
        "-vf".into(),
        build_ass_filter(ass_path, font_dir),
        "-c:v".into(),
        encoder.ffmpeg_name().unwrap_or("libx264").into(),
    ];

    if encoder == BurnVideoEncoder::LibX264 {
        args.extend(["-preset".into(), normalize_preset(preset)]);
    }

    if let Some(kbps) = normalize_video_bitrate_kbps(video_bitrate_kbps) {
        args.extend(["-b:v".into(), format!("{kbps}k")]);
    } else if encoder == BurnVideoEncoder::LibX264 {
        args.extend(["-crf".into(), normalize_crf(crf)]);
    } else if encoder.is_hardware() {
        args.extend([
            "-b:v".into(),
            format!("{DEFAULT_HARDWARE_VIDEO_BITRATE_KBPS}k"),
        ]);
    }

    args.extend([
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-progress".into(),
        "pipe:2".into(),
        output_path.to_string_lossy().into_owned(),
    ]);
    args
}

fn build_soft_sub_args(video_path: &str, ass_path: &str, output_path: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        video_path.into(),
        "-i".into(),
        ass_path.into(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a?".into(),
        "-map".into(),
        "1:0".into(),
        "-c".into(),
        "copy".into(),
        "-c:s".into(),
        "ass".into(),
        "-metadata:s:s:0".into(),
        "language=jpn".into(),
        "-progress".into(),
        "pipe:2".into(),
        output_path.to_string_lossy().into_owned(),
    ]
}

fn paths_refer_to_same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn validate_output_path(
    output_path: &Path,
    video_path: &Path,
    mode: BurnMode,
) -> Result<(), String> {
    if paths_refer_to_same_file(output_path, video_path) {
        return Err("输出路径不能与源视频相同".into());
    }

    let ext = output_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match mode {
        BurnMode::HardSubMp4 if ext != "mp4" => {
            return Err("硬字幕模式输出文件须为 .mp4".into());
        }
        BurnMode::SoftSubMkv if ext != "mkv" => {
            return Err("软字幕模式输出文件须为 .mkv".into());
        }
        _ => {}
    }

    Ok(())
}

fn job_is_active(snapshot: &BurnSnapshot) -> bool {
    matches!(snapshot.status, BurnStatus::Pending | BurnStatus::Running)
}

fn build_burn_args(
    args: &StartBurnArgs,
    output_path: &Path,
    effective_encoder: BurnVideoEncoder,
) -> Vec<String> {
    match args.mode {
        BurnMode::HardSubMp4 => build_hard_sub_args(
            &args.video_path,
            &args.ass_path,
            output_path,
            args.crf,
            args.preset.as_deref(),
            effective_encoder,
            args.video_bitrate_kbps,
            args.font_dir.as_deref(),
        ),
        BurnMode::SoftSubMkv => build_soft_sub_args(&args.video_path, &args.ass_path, output_path),
    }
}

fn update_snapshot(job: &Arc<Mutex<BurnJobInner>>, update: impl FnOnce(&mut BurnSnapshot)) {
    if let Ok(mut guard) = job.try_lock() {
        update(&mut guard.snapshot);
    }
}

fn commit_snapshot(job: &Arc<Mutex<BurnJobInner>>, update: impl FnOnce(&mut BurnSnapshot)) {
    let mut guard = job.blocking_lock();
    update(&mut guard.snapshot);
}

fn handle_progress_line(
    job: &Arc<Mutex<BurnJobInner>>,
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
        let progress =
            (*duration_ms > 0).then(|| (processed as f64 / *duration_ms as f64).clamp(0.0, 1.0));
        update_snapshot(job, |snap| {
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

fn run_burn_job(
    job: Arc<Mutex<BurnJobInner>>,
    ffmpeg: String,
    args: StartBurnArgs,
    output_path: PathBuf,
) {
    let result = (|| -> Result<(), String> {
        let cancel_flag = {
            let guard = job.blocking_lock();
            if guard.cancel_flag.load(Ordering::SeqCst)
                || guard.snapshot.status == BurnStatus::Cancelled
            {
                return Ok(());
            }
            guard.cancel_flag.clone()
        };

        let effective_encoder = if args.mode == BurnMode::HardSubMp4 {
            let available = probe_available_burn_encoders(&ffmpeg)
                .unwrap_or_else(|_| vec![BurnVideoEncoder::LibX264]);
            select_burn_encoder(
                args.video_encoder.unwrap_or(BurnVideoEncoder::Auto),
                &available,
            )
        } else {
            BurnVideoEncoder::LibX264
        };
        let ffmpeg_args = build_burn_args(&args, &output_path, effective_encoder);
        let mut child = hidden_command(&ffmpeg)
            .args(&ffmpeg_args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("无法启动 FFmpeg（{ffmpeg}）：{e}"))?;

        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| "无法读取 FFmpeg 输出".to_string())?;

        {
            let mut guard = job.blocking_lock();
            guard.snapshot.status = BurnStatus::Running;
            guard.child = Some(child);
        }

        let mut tail = String::new();
        let mut buf = [0u8; 4096];
        let mut line: Vec<u8> = Vec::new();
        let mut duration_ms = 0;

        loop {
            if cancel_flag.load(Ordering::SeqCst) {
                let mut guard = job.blocking_lock();
                if let Some(child) = &mut guard.child {
                    let _ = child.kill();
                }
                break;
            }

            let n = stderr.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            for &byte in &buf[..n] {
                if byte == b'\n' || byte == b'\r' {
                    if !line.is_empty() {
                        let text = String::from_utf8_lossy(&line).into_owned();
                        handle_progress_line(&job, &text, &mut duration_ms, &mut tail);
                        line.clear();
                    }
                } else {
                    line.push(byte);
                }
            }
        }
        if !line.is_empty() {
            let text = String::from_utf8_lossy(&line).into_owned();
            handle_progress_line(&job, &text, &mut duration_ms, &mut tail);
        }

        let (cancelled, status) = {
            let mut guard = job.blocking_lock();
            let cancelled = guard.cancel_flag.load(Ordering::SeqCst)
                || guard.snapshot.status == BurnStatus::Cancelled;
            let status = if let Some(mut child) = guard.child.take() {
                child.wait().map_err(|e| e.to_string())?
            } else {
                return Err("FFmpeg 进程已丢失".into());
            };
            (cancelled, status)
        };

        if cancelled {
            let _ = fs::remove_file(&output_path);
            commit_snapshot(&job, |snap| {
                snap.status = BurnStatus::Cancelled;
                snap.error = Some("压制已取消".into());
            });
            return Ok(());
        }

        if !status.success() {
            let _ = fs::remove_file(&output_path);
            return Err(format!("FFmpeg 压制失败：{}", tail.trim()));
        }

        commit_snapshot(&job, |snap| {
            snap.status = BurnStatus::Completed;
            snap.progress = Some(1.0);
            snap.processed_ms = snap.processed_ms.max(snap.duration_ms);
            snap.output_path = Some(output_path.to_string_lossy().into_owned());
            snap.error = None;
        });
        Ok(())
    })();

    if let Err(err) = result {
        let _ = fs::remove_file(&output_path);
        commit_snapshot(&job, |snap| {
            if snap.status != BurnStatus::Cancelled {
                snap.status = BurnStatus::Failed;
                snap.error = Some(err);
            }
        });
    }
}

#[tauri::command]
pub async fn probe_burn_video(
    app: AppHandle,
    video_path: String,
) -> Result<BurnVideoProbe, String> {
    let video = PathBuf::from(&video_path);
    if !video.is_file() {
        return Err(format!("视频文件不存在: {video_path}"));
    }

    let settings = load_settings(&app).unwrap_or_default();
    let (ffmpeg, _) = resolve_ffmpeg(&app, &settings);
    let ffprobe = resolve_ffprobe(&app, &settings);

    tauri::async_runtime::spawn_blocking(move || {
        let available_encoders = probe_available_burn_encoders(&ffmpeg)
            .unwrap_or_else(|_| vec![BurnVideoEncoder::LibX264]);
        let video_bitrate_kbps = probe_video_bitrate_kbps(&ffprobe, &video_path).unwrap_or(None);
        let preferred_encoder = select_auto_encoder(&available_encoders, current_os(), true);

        Ok(BurnVideoProbe {
            video_bitrate_kbps,
            available_encoders,
            preferred_encoder,
        })
    })
    .await
    .map_err(|e| format!("探测视频导出能力失败: {e}"))?
}

#[tauri::command]
pub async fn start_burn_subtitles(app: AppHandle, args: StartBurnArgs) -> Result<String, String> {
    let video = PathBuf::from(&args.video_path);
    if !video.is_file() {
        return Err(format!("视频文件不存在: {}", args.video_path));
    }

    let ass = PathBuf::from(&args.ass_path);
    if !ass.is_file() {
        return Err(format!("字幕文件不存在: {}", args.ass_path));
    }

    let output_path = PathBuf::from(args.output_path.trim());
    if output_path.as_os_str().is_empty() {
        return Err("请选择输出路径".into());
    }
    validate_output_path(&output_path, &video, args.mode)?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建输出目录: {e}"))?;
    }

    let state = app.state::<BurnState>();
    {
        let jobs = state.jobs.lock().await;
        if jobs.values().any(|job| {
            job.try_lock()
                .map(|guard| job_is_active(&guard.snapshot))
                .unwrap_or(true)
        }) {
            return Err("已有压制任务正在运行，请等待完成或取消后再试".into());
        }
    }

    let settings = load_settings(&app).unwrap_or_default();
    let (ffmpeg, _) = resolve_ffmpeg(&app, &settings);
    let job_id = new_job_id();
    let snapshot = BurnSnapshot {
        id: job_id.clone(),
        status: BurnStatus::Pending,
        progress: None,
        processed_ms: 0,
        duration_ms: 0,
        output_path: Some(output_path.to_string_lossy().into_owned()),
        error: None,
    };

    let job = Arc::new(Mutex::new(BurnJobInner {
        snapshot,
        output_path: output_path.clone(),
        child: None,
        cancel_flag: Arc::new(AtomicBool::new(false)),
    }));

    {
        let mut jobs = state.jobs.lock().await;
        jobs.retain(|_, existing| {
            existing
                .try_lock()
                .map(|guard| job_is_active(&guard.snapshot))
                .unwrap_or(false)
        });
        jobs.insert(job_id.clone(), job.clone());
    }

    tauri::async_runtime::spawn_blocking(move || {
        run_burn_job(job, ffmpeg, args, output_path);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn get_burn_progress(app: AppHandle, job_id: String) -> Result<BurnSnapshot, String> {
    let state = app.state::<BurnState>();
    let mut jobs = state.jobs.lock().await;
    let job = jobs
        .get(&job_id)
        .ok_or_else(|| format!("压制任务不存在: {job_id}"))?;
    let snapshot = {
        let guard = job.lock().await;
        guard.snapshot.clone()
    };
    let terminal = matches!(
        snapshot.status,
        BurnStatus::Completed | BurnStatus::Failed | BurnStatus::Cancelled
    );
    if terminal {
        jobs.remove(&job_id);
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn cancel_burn(app: AppHandle, job_id: String) -> Result<(), String> {
    let state = app.state::<BurnState>();
    let job = {
        let jobs = state.jobs.lock().await;
        jobs.get(&job_id)
            .cloned()
            .ok_or_else(|| format!("压制任务不存在: {job_id}"))?
    };

    let (output_path, should_delete_output) = {
        let mut guard = job.lock().await;
        let should_delete_output = job_is_active(&guard.snapshot);
        guard.cancel_flag.store(true, Ordering::SeqCst);
        guard.snapshot.status = BurnStatus::Cancelled;
        guard.snapshot.error = Some("压制已取消".into());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_progress_out_time_microseconds_as_milliseconds() {
        assert_eq!(
            parse_progress_out_time_ms("out_time_ms=12345000"),
            Some(12345)
        );
    }

    #[test]
    fn parses_time_token() {
        assert_eq!(
            parse_time_token("frame=1 time=00:01:02.50 bitrate=1kbits/s"),
            Some(62500)
        );
    }

    #[test]
    fn builds_hard_sub_args_with_ass_filter_and_progress() {
        let output = PathBuf::from("/tmp/out.mp4");
        let args = build_hard_sub_args(
            "/tmp/in.mp4",
            "/tmp/subs.ass",
            &output,
            Some(23),
            Some("fast"),
            BurnVideoEncoder::LibX264,
            None,
            Some("/tmp/fonts"),
        );
        assert!(args
            .windows(2)
            .any(|w| { w == ["-vf", "ass=filename='/tmp/subs.ass':fontsdir='/tmp/fonts'"] }));
        assert!(args.windows(2).any(|w| w == ["-crf", "23"]));
        assert!(args.windows(2).any(|w| w == ["-preset", "fast"]));
        assert!(args.windows(2).any(|w| w == ["-progress", "pipe:2"]));
    }

    #[test]
    fn builds_hard_sub_args_with_hardware_encoder_and_video_bitrate() {
        let output = PathBuf::from("/tmp/out.mp4");
        let args = build_hard_sub_args(
            "/tmp/in.mp4",
            "/tmp/subs.ass",
            &output,
            Some(18),
            Some("medium"),
            BurnVideoEncoder::H264Nvenc,
            Some(12_000),
            None,
        );

        assert!(args.windows(2).any(|w| w == ["-c:v", "h264_nvenc"]));
        assert!(args.windows(2).any(|w| w == ["-b:v", "12000k"]));
        assert!(!args.iter().any(|arg| arg == "-crf"));
    }

    #[test]
    fn auto_encoder_prefers_available_hardware_for_platform() {
        let available = vec![
            BurnVideoEncoder::LibX264,
            BurnVideoEncoder::H264Qsv,
            BurnVideoEncoder::H264Nvenc,
        ];

        assert_eq!(
            select_auto_encoder(&available, "windows", true),
            BurnVideoEncoder::H264Nvenc
        );
    }

    #[test]
    fn parses_video_bitrate_kbps_from_ffprobe_output() {
        assert_eq!(parse_video_bitrate_kbps("8000000\n"), Some(8000));
        assert_eq!(parse_video_bitrate_kbps("N/A\n12000000\n"), Some(12000));
        assert_eq!(parse_video_bitrate_kbps("\nN/A\n"), None);
    }

    #[test]
    fn parses_available_encoders_from_ffmpeg_output() {
        let output = r#"
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder
 V..... h264_qsv             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
"#;

        assert_eq!(
            parse_available_encoders(output),
            vec![
                BurnVideoEncoder::LibX264,
                BurnVideoEncoder::H264Nvenc,
                BurnVideoEncoder::H264Qsv
            ]
        );
    }

    #[test]
    fn hardware_encoder_probe_uses_supported_frame_size() {
        let args = hardware_encoder_probe_args("h264_nvenc");

        assert!(args
            .windows(2)
            .any(|w| w == ["-i", "color=c=black:s=256x256:r=1:d=0.1"]));
        assert!(!args.iter().any(|arg| arg.contains("64x64")));
    }

    #[test]
    fn builds_soft_sub_mkv_args_with_ass_subtitle_track() {
        let output = PathBuf::from("/tmp/out.mkv");
        let args = build_soft_sub_args("/tmp/in.mp4", "/tmp/subs.ass", &output);
        assert!(args.windows(2).any(|w| w == ["-c:s", "ass"]));
        assert!(args
            .windows(2)
            .any(|w| w == ["-metadata:s:s:0", "language=jpn"]));
        assert!(args.windows(2).any(|w| w == ["-progress", "pipe:2"]));
    }

    #[test]
    fn escapes_ass_filter_values() {
        assert_eq!(
            escape_ass_filter_value("/tmp/a:b'sub.ass"),
            "/tmp/a\\:b\\'sub.ass"
        );
    }

    #[test]
    fn rejects_output_same_as_video() {
        let video = PathBuf::from("/tmp/in.mp4");
        let output = PathBuf::from("/tmp/in.mp4");
        assert!(validate_output_path(&output, &video, BurnMode::HardSubMp4).is_err());
    }

    #[test]
    fn rejects_wrong_extension_for_mode() {
        let video = PathBuf::from("/tmp/in.mp4");
        let output = PathBuf::from("/tmp/out.mkv");
        assert!(validate_output_path(&output, &video, BurnMode::HardSubMp4).is_err());
        let output = PathBuf::from("/tmp/out.mp4");
        assert!(validate_output_path(&output, &video, BurnMode::SoftSubMkv).is_err());
    }
}
