use crate::ffmpeg::resolve_ffmpeg;
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
use tokio::sync::Mutex;

static BURN_JOB_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BurnMode {
    HardSubMp4,
    SoftSubMkv,
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
    pub font_dir: Option<String>,
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

fn escape_ass_filter_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'")
}

fn build_ass_filter(ass_path: &str, font_dir: Option<&str>) -> String {
    let mut filter = format!("ass=filename='{}'", escape_ass_filter_value(ass_path));
    if let Some(font_dir) = font_dir.map(str::trim).filter(|v| !v.is_empty()) {
        filter.push_str(&format!(":fontsdir='{}'", escape_ass_filter_value(font_dir)));
    }
    filter
}

fn build_hard_sub_args(
    video_path: &str,
    ass_path: &str,
    output_path: &Path,
    crf: Option<u8>,
    preset: Option<&str>,
    font_dir: Option<&str>,
) -> Vec<String> {
    vec![
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
        "libx264".into(),
        "-preset".into(),
        normalize_preset(preset),
        "-crf".into(),
        normalize_crf(crf),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-progress".into(),
        "pipe:2".into(),
        output_path.to_string_lossy().into_owned(),
    ]
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
    matches!(
        snapshot.status,
        BurnStatus::Pending | BurnStatus::Running
    )
}

fn build_burn_args(args: &StartBurnArgs, output_path: &Path) -> Vec<String> {
    match args.mode {
        BurnMode::HardSubMp4 => build_hard_sub_args(
            &args.video_path,
            &args.ass_path,
            output_path,
            args.crf,
            args.preset.as_deref(),
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
        let progress = (*duration_ms > 0)
            .then(|| (processed as f64 / *duration_ms as f64).clamp(0.0, 1.0));
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

        let ffmpeg_args = build_burn_args(&args, &output_path);
        let mut child = Command::new(&ffmpeg)
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
        assert_eq!(parse_progress_out_time_ms("out_time_ms=12345000"), Some(12345));
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
            Some("/tmp/fonts"),
        );
        assert!(args.windows(2).any(|w| {
            w == [
                "-vf",
                "ass=filename='/tmp/subs.ass':fontsdir='/tmp/fonts'"
            ]
        }));
        assert!(args.windows(2).any(|w| w == ["-crf", "23"]));
        assert!(args.windows(2).any(|w| w == ["-preset", "fast"]));
        assert!(args.windows(2).any(|w| w == ["-progress", "pipe:2"]));
    }

    #[test]
    fn builds_soft_sub_mkv_args_with_ass_subtitle_track() {
        let output = PathBuf::from("/tmp/out.mkv");
        let args = build_soft_sub_args("/tmp/in.mp4", "/tmp/subs.ass", &output);
        assert!(args.windows(2).any(|w| w == ["-c:s", "ass"]));
        assert!(args.windows(2).any(|w| w == ["-metadata:s:s:0", "language=jpn"]));
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
