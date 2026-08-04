#![cfg_attr(not(debug_assertions), allow(dead_code))]
// ponytail: T05 keeps the reviewed host compiled but unreachable in release until production routing exists.

use crate::asr::VadConfig;
use crate::process::{hidden_command, terminate_process_tree};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const LIMITS_JSON: &str = include_str!("../../native-asr/protocol-v1-limits.json");
const STDERR_LOG_RETENTION: usize = 20;
const TERMINATION_TIMEOUT: Duration = Duration::from_secs(2);
#[cfg(test)]
pub(crate) static FAKE_WORKER_TEST_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtocolLimits {
    protocol_version: u64,
    max_request_line_bytes: usize,
    max_event_line_bytes: usize,
    max_job_id_bytes: usize,
    max_path_bytes: usize,
    max_text_bytes: usize,
    max_model_entries: usize,
    max_replacement_segments: usize,
    max_stderr_diagnostic_bytes: usize,
}

impl ProtocolLimits {
    fn load() -> Result<Self, String> {
        let limits: Self = serde_json::from_str(LIMITS_JSON)
            .map_err(|error| format!("解析 native ASR protocol limits 失败：{error}"))?;
        if limits.protocol_version != 1
            || limits.max_request_line_bytes == 0
            || limits.max_event_line_bytes == 0
            || limits.max_job_id_bytes == 0
            || limits.max_path_bytes == 0
            || limits.max_text_bytes == 0
            || limits.max_model_entries == 0
            || limits.max_replacement_segments == 0
            || limits.max_stderr_diagnostic_bytes == 0
        {
            return Err("native ASR protocol limits 无效".into());
        }
        Ok(limits)
    }
}

#[derive(Default)]
pub(crate) struct ActiveJobGate {
    current: Mutex<Option<String>>,
    reservation_counter: AtomicU64,
}

impl ActiveJobGate {
    pub(crate) fn reserve(self: &Arc<Self>) -> Result<ActiveJobReservation, String> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "ASR 活跃任务状态已损坏".to_string())?;
        if current.is_some() {
            return Err("已有转录任务正在运行，请先等待完成或取消".into());
        }
        let token = format!(
            "asr-reservation-{}-{}",
            std::process::id(),
            self.reservation_counter.fetch_add(1, Ordering::Relaxed)
        );
        *current = Some(token.clone());
        Ok(ActiveJobReservation {
            gate: Arc::clone(self),
            token,
            activated: false,
        })
    }

    pub(crate) fn release(&self, job_id: &str) {
        if let Ok(mut current) = self.current.lock() {
            if current.as_deref() == Some(job_id) {
                *current = None;
            }
        }
    }

    pub(crate) fn clear(&self) {
        if let Ok(mut current) = self.current.lock() {
            *current = None;
        }
    }

    #[cfg(test)]
    pub(crate) fn current(&self) -> Option<String> {
        self.current.lock().ok().and_then(|value| value.clone())
    }
}

pub(crate) struct ActiveJobReservation {
    gate: Arc<ActiveJobGate>,
    token: String,
    activated: bool,
}

impl ActiveJobReservation {
    pub(crate) fn activate(mut self, job_id: &str) -> Result<(), String> {
        let mut current = self
            .gate
            .current
            .lock()
            .map_err(|_| "ASR 活跃任务状态已损坏".to_string())?;
        if current.as_deref() != Some(self.token.as_str()) {
            return Err("ASR 活跃任务预留已失效".into());
        }
        *current = Some(job_id.to_string());
        self.activated = true;
        Ok(())
    }
}

impl Drop for ActiveJobReservation {
    fn drop(&mut self) {
        if !self.activated {
            self.gate.release(&self.token);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedModelPath {
    role: String,
    path: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedNativeLaunch {
    job_id: String,
    engine: String,
    backend: String,
    model_paths: Vec<ResolvedModelPath>,
    device: String,
    language: String,
    audio_path: PathBuf,
    output_ass_path: PathBuf,
    recovery_path: PathBuf,
    stderr_log_path: PathBuf,
    use_vad: bool,
    vad_config: Option<VadConfig>,
}

impl ResolvedNativeLaunch {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn resolve(
        job_id: String,
        engine: String,
        model_paths: Vec<(String, PathBuf)>,
        device: String,
        language: String,
        audio_path: PathBuf,
        output_ass_path: PathBuf,
        cache_root: &Path,
        use_vad: bool,
        vad_config: Option<VadConfig>,
    ) -> Result<Self, String> {
        let limits = ProtocolLimits::load()?;
        validate_job_id(&job_id, &limits)?;
        validate_artifact_job_id(&job_id)?;
        let backend = backend_for_engine(&engine)
            .ok_or_else(|| format!("native ASR 不支持引擎：{engine}"))?
            .to_string();
        validate_route(&engine, &backend, &device, &model_paths, &limits)?;
        if language != "ja" {
            return Err("native ASR 仅接受日语源语言".into());
        }
        validate_vad(use_vad, vad_config.as_ref())?;

        fs::create_dir_all(cache_root)
            .map_err(|error| format!("无法创建 ASR 缓存根目录：{error}"))?;
        let canonical_cache = cache_root
            .canonicalize()
            .map_err(|error| format!("无法解析 ASR 缓存根目录：{error}"))?;
        let canonical_audio = canonical_existing(&audio_path, "音频")?;
        if !canonical_audio.is_file() {
            return Err("ASR 音频文件不存在".into());
        }
        if !crate::project::is_cached_audio_path(&canonical_cache, &canonical_audio)? {
            return Err("拒绝在受管 workspace 外启动 native ASR".into());
        }

        let mut resolved_models = Vec::with_capacity(model_paths.len());
        for (role, path) in model_paths {
            let canonical = canonical_existing(&path, "模型")?;
            resolved_models.push(ResolvedModelPath {
                role,
                path: protocol_path(&canonical, &limits)?,
            });
        }

        let output_ass_path = resolve_output_target(&output_ass_path)?;
        protocol_path(&output_ass_path, &limits)?;

        let audio_parent = canonical_audio
            .parent()
            .ok_or_else(|| "无法解析 ASR 音频 workspace".to_string())?;
        let recovery_dir = audio_parent.join("asr-jobs");
        fs::create_dir_all(&recovery_dir)
            .map_err(|error| format!("无法创建 ASR 恢复目录：{error}"))?;
        let canonical_recovery_dir = recovery_dir
            .canonicalize()
            .map_err(|error| format!("无法解析 ASR 恢复目录：{error}"))?;
        if canonical_recovery_dir.parent() != Some(audio_parent) {
            return Err("ASR 恢复目录越出当前 workspace".into());
        }
        let recovery_path = canonical_recovery_dir.join(format!("{job_id}.json"));
        protocol_path(&recovery_path, &limits)?;

        let stderr_dir = canonical_cache.join("asr-worker-logs");
        fs::create_dir_all(&stderr_dir)
            .map_err(|error| format!("无法创建 native ASR 日志目录：{error}"))?;
        let canonical_stderr_dir = stderr_dir
            .canonicalize()
            .map_err(|error| format!("无法解析 native ASR 日志目录：{error}"))?;
        if !canonical_stderr_dir.starts_with(&canonical_cache) {
            return Err("native ASR 日志目录越出受管缓存".into());
        }
        let stderr_log_path = canonical_stderr_dir.join(format!("{job_id}.stderr.log"));

        Ok(Self {
            job_id,
            engine,
            backend,
            model_paths: resolved_models,
            device,
            language,
            audio_path: canonical_audio,
            output_ass_path,
            recovery_path,
            stderr_log_path,
            use_vad,
            vad_config,
        })
    }
}

fn canonical_existing(path: &Path, label: &str) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!("{label}路径必须是绝对路径"));
    }
    path.canonicalize()
        .map_err(|error| format!("无法解析{label}路径：{error}"))
}

fn resolve_output_target(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("ASS 输出路径必须是绝对路径".into());
    }
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        != Some("ass".into())
    {
        return Err("ASR 输出目标必须是 .ass 文件".into());
    }
    if path.exists() {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("无法检查 ASS 输出目标：{error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("拒绝写入符号链接或非文件 ASS 输出目标".into());
        }
        return path
            .canonicalize()
            .map_err(|error| format!("无法解析 ASS 输出目标：{error}"));
    }
    let parent = path
        .parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| "ASS 输出目录不存在".to_string())?
        .canonicalize()
        .map_err(|error| format!("无法解析 ASS 输出目录：{error}"))?;
    let file_name = path
        .file_name()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "ASS 输出文件名无效".to_string())?;
    Ok(parent.join(file_name))
}

fn protocol_path(path: &Path, limits: &ProtocolLimits) -> Result<String, String> {
    let text = path
        .to_str()
        .ok_or_else(|| "路径不是有效 UTF-8".to_string())?;
    if text.len() > limits.max_path_bytes || contains_ascii_control(text) {
        return Err("路径超过 native ASR 协议限制".into());
    }
    Ok(text.to_string())
}

fn validate_job_id(job_id: &str, limits: &ProtocolLimits) -> Result<(), String> {
    if job_id.is_empty()
        || job_id.len() > limits.max_job_id_bytes
        || contains_ascii_control(job_id)
        || !job_id.bytes().any(|byte| !byte.is_ascii_whitespace())
    {
        return Err("native ASR jobId 无效".into());
    }
    Ok(())
}

fn validate_artifact_job_id(job_id: &str) -> Result<(), String> {
    if !job_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("native ASR jobId 不能安全用于受管恢复路径".into());
    }
    Ok(())
}

fn backend_for_engine(engine: &str) -> Option<&'static str> {
    match engine {
        "faster-whisper" | "kotoba-faster-whisper" => Some("ctranslate2"),
        "parakeet" | "reazonspeech-nemo" | "qwen3-asr" => Some("crispasr"),
        _ => None,
    }
}

fn validate_route(
    engine: &str,
    backend: &str,
    device: &str,
    models: &[(String, PathBuf)],
    limits: &ProtocolLimits,
) -> Result<(), String> {
    if backend_for_engine(engine) != Some(backend) {
        return Err("native ASR engine/backend route 无效".into());
    }
    if !matches!(device, "cpu" | "cuda" | "vulkan")
        || backend == "ctranslate2" && device == "vulkan"
    {
        return Err("native ASR device 与 route 不兼容".into());
    }
    if models.is_empty() || models.len() > limits.max_model_entries {
        return Err("native ASR modelPaths 数量无效".into());
    }
    let roles: HashSet<&str> = models.iter().map(|(role, _)| role.as_str()).collect();
    if roles.len() != models.len() || !roles.contains("model") {
        return Err("native ASR model role 无效或重复".into());
    }
    if engine == "qwen3-asr" {
        if roles.len() != 2 || !roles.contains("aligner") {
            return Err("qwen3-asr 需要 model 与 aligner".into());
        }
    } else if roles.len() != 1 {
        return Err("当前 native ASR route 只接受 model role".into());
    }
    if roles
        .iter()
        .any(|role| *role != "model" && *role != "aligner")
    {
        return Err("native ASR model role 未知".into());
    }
    Ok(())
}

fn validate_vad(use_vad: bool, config: Option<&VadConfig>) -> Result<(), String> {
    if !use_vad {
        return Ok(());
    }
    let Some(config) = config else {
        return Ok(());
    };
    if config
        .threshold
        .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
        || config
            .min_speech_duration_ms
            .is_some_and(|value| value > 60_000)
        || config
            .min_silence_duration_ms
            .is_some_and(|value| value > 60_000)
        || config.speech_pad_ms.is_some_and(|value| value > 10_000)
        || config
            .max_segment_duration_ms
            .is_some_and(|value| !(1_000..=600_000).contains(&value))
        || matches!(
            (config.min_speech_duration_ms, config.max_segment_duration_ms),
            (Some(minimum), Some(maximum)) if maximum < minimum
        )
    {
        return Err("native ASR VAD 参数超出 protocol v1 范围".into());
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AsrJobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AsrSegment {
    pub(crate) start_ms: i64,
    pub(crate) end_ms: i64,
    pub(crate) text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AsrJobSnapshot {
    pub(crate) id: String,
    pub(crate) status: AsrJobStatus,
    pub(crate) progress: f64,
    pub(crate) duration_ms: i64,
    pub(crate) processed_ms: i64,
    pub(crate) segment_count: usize,
    pub(crate) detected_language: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) segments: Vec<AsrSegment>,
}

impl AsrJobSnapshot {
    fn to_value(&self, include_segments: bool) -> Result<Value, String> {
        let mut value = serde_json::to_value(self).map_err(|error| error.to_string())?;
        if !include_segments {
            value
                .as_object_mut()
                .expect("snapshot serialization must produce an object")
                .remove("segments");
        }
        Ok(value)
    }
}

#[derive(Debug, Clone)]
struct PendingCompleted {
    duration_ms: i64,
    detected_language: String,
}

struct NativeAsrJob {
    snapshot: AsrJobSnapshot,
    pid: Option<u32>,
    reaped: bool,
    cancel_requested: bool,
    terminal_committed: bool,
    pending_completed: Option<PendingCompleted>,
    worker_terminal_seen: bool,
    ready: bool,
    worker_processed_ms: i64,
    last_segment_start_ms: i64,
    expected_backend: String,
    expected_device: String,
    worker_error_code: Option<String>,
    max_segments: usize,
    recovery_path: PathBuf,
    output_ass_path: PathBuf,
}

struct JobRecord {
    inner: Mutex<NativeAsrJob>,
    reaped: Condvar,
}

impl JobRecord {
    fn new(launch: &ResolvedNativeLaunch, pid: u32, max_segments: usize) -> Self {
        Self {
            inner: Mutex::new(NativeAsrJob {
                snapshot: AsrJobSnapshot {
                    id: launch.job_id.clone(),
                    status: AsrJobStatus::Pending,
                    progress: 0.0,
                    duration_ms: 0,
                    processed_ms: 0,
                    segment_count: 0,
                    detected_language: None,
                    error: None,
                    segments: Vec::new(),
                },
                pid: Some(pid),
                reaped: false,
                cancel_requested: false,
                terminal_committed: false,
                pending_completed: None,
                worker_terminal_seen: false,
                ready: false,
                worker_processed_ms: 0,
                last_segment_start_ms: -1,
                expected_backend: launch.backend.clone(),
                expected_device: launch.device.clone(),
                worker_error_code: None,
                max_segments,
                recovery_path: launch.recovery_path.clone(),
                output_ass_path: launch.output_ass_path.clone(),
            }),
            reaped: Condvar::new(),
        }
    }
}

fn abort_spawned_job(
    record: &Arc<JobRecord>,
    child: &mut Child,
    recovery_path: &Path,
    failure: ProtocolFailure,
) {
    if let Ok(Some(snapshot)) = commit_failure(record, failure) {
        let _ = persist_snapshot(recovery_path, &snapshot);
    }
    terminate_process_tree(child.id());
    let _ = child.wait();
    if let Ok(mut job) = record.inner.lock() {
        job.pid = None;
        job.reaped = true;
    }
    record.reaped.notify_all();
}

#[derive(Clone)]
pub(crate) struct NativeAsrHost {
    inner: Arc<NativeHostInner>,
}

struct NativeHostInner {
    executable: PathBuf,
    worker_args: Vec<OsString>,
    limits: ProtocolLimits,
    jobs: Mutex<HashMap<String, Arc<JobRecord>>>,
    active_gate: Arc<ActiveJobGate>,
}

impl NativeAsrHost {
    pub(crate) fn new(
        executable: PathBuf,
        worker_args: Vec<OsString>,
        active_gate: Arc<ActiveJobGate>,
    ) -> Result<Self, String> {
        let executable = canonical_existing(&executable, "native ASR worker")?;
        if !executable.is_file() {
            return Err(format!(
                "native ASR worker 不存在：{}",
                executable.display()
            ));
        }
        Ok(Self {
            inner: Arc::new(NativeHostInner {
                executable,
                worker_args,
                limits: ProtocolLimits::load()?,
                jobs: Mutex::new(HashMap::new()),
                active_gate,
            }),
        })
    }

    pub(crate) fn start(
        &self,
        launch: ResolvedNativeLaunch,
        reservation: ActiveJobReservation,
    ) -> Result<String, String> {
        let request = WorkerRequestV1::from_launch(&launch, &self.inner.limits)?;
        let request_line = serde_json::to_vec(&request)
            .map_err(|error| format!("序列化 native ASR request 失败：{error}"))?;
        if request_line.len() > self.inner.limits.max_request_line_bytes {
            return Err("native ASR request 超过 protocol v1 限制".into());
        }

        let mut command = hidden_command(&self.inner.executable);
        command
            .args(&self.inner.worker_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command
            .spawn()
            .map_err(|error| format!("启动 native ASR worker 失败：{error}"))?;
        let pid = child.id();
        let record = Arc::new(JobRecord::new(
            &launch,
            pid,
            self.inner.limits.max_replacement_segments,
        ));
        self.inner
            .jobs
            .lock()
            .map_err(|_| "native ASR job store 已损坏".to_string())?
            .insert(launch.job_id.clone(), Arc::clone(&record));

        let write_result = child
            .stdin
            .take()
            .ok_or_else(|| "无法写入 native ASR worker stdin".to_string())
            .and_then(|mut stdin| {
                stdin
                    .write_all(&request_line)
                    .and_then(|_| stdin.write_all(b"\n"))
                    .and_then(|_| stdin.flush())
                    .map_err(|error| format!("写入 native ASR request 失败：{error}"))
            });
        if let Err(error) = write_result {
            abort_spawned_job(
                &record,
                &mut child,
                &launch.recovery_path,
                ProtocolFailure::new(
                    "worker_request_write_failed",
                    "Failed to write worker request",
                ),
            );
            return Err(error);
        }

        let Some(stdout) = child.stdout.take() else {
            abort_spawned_job(
                &record,
                &mut child,
                &launch.recovery_path,
                ProtocolFailure::new(
                    "worker_pipe_unavailable",
                    "Worker stdout pipe is unavailable",
                ),
            );
            return Err("无法读取 native ASR worker stdout".into());
        };
        let Some(stderr) = child.stderr.take() else {
            abort_spawned_job(
                &record,
                &mut child,
                &launch.recovery_path,
                ProtocolFailure::new(
                    "worker_pipe_unavailable",
                    "Worker stderr pipe is unavailable",
                ),
            );
            return Err("无法读取 native ASR worker stderr".into());
        };
        if let Err(error) = reservation.activate(&launch.job_id) {
            abort_spawned_job(
                &record,
                &mut child,
                &launch.recovery_path,
                ProtocolFailure::new(
                    "worker_start_cancelled",
                    "Worker start reservation was cancelled",
                ),
            );
            return Err(error);
        }

        let stderr_log_path = launch.stderr_log_path.clone();
        let stderr_limit = self.inner.limits.max_stderr_diagnostic_bytes;
        let stderr_thread = std::thread::spawn(move || {
            drain_stderr(stderr, &stderr_log_path, stderr_limit);
        });
        let host = self.clone();
        let job_id = launch.job_id.clone();
        std::thread::spawn(move || {
            host.monitor(job_id, record, child, stdout, stderr_thread);
        });
        Ok(launch.job_id)
    }

    pub(crate) fn contains_job(&self, job_id: &str) -> bool {
        self.inner
            .jobs
            .lock()
            .map(|jobs| jobs.contains_key(job_id))
            .unwrap_or(false)
    }

    pub(crate) fn snapshot(
        &self,
        job_id: &str,
        include_segments: bool,
    ) -> Result<Option<Value>, String> {
        let record = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "native ASR job store 已损坏".to_string())?
            .get(job_id)
            .cloned();
        let Some(record) = record else {
            return Ok(None);
        };
        let snapshot = record
            .inner
            .lock()
            .map_err(|_| "native ASR job 状态已损坏".to_string())?
            .snapshot
            .clone();
        snapshot.to_value(include_segments).map(Some)
    }

    pub(crate) fn cancel(&self, job_id: &str) -> Result<(), String> {
        let record = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "native ASR job store 已损坏".to_string())?
            .get(job_id)
            .cloned()
            .ok_or_else(|| format!("转录任务不存在（jobId={job_id}）"))?;

        let (pid, terminal_snapshot) = {
            let mut job = record
                .inner
                .lock()
                .map_err(|_| "native ASR job 状态已损坏".to_string())?;
            if job.terminal_committed {
                (job.pid, None)
            } else {
                job.cancel_requested = true;
                let snapshot = commit_terminal_locked(&mut job, TerminalKind::Cancelled)
                    .expect("non-terminal job must accept cancellation");
                (job.pid, Some((snapshot, job.recovery_path.clone())))
            }
        };
        if let Some((snapshot, recovery_path)) = terminal_snapshot {
            let _ = persist_snapshot(&recovery_path, &snapshot);
        }
        let Some(pid) = pid else {
            self.inner.active_gate.release(job_id);
            return Ok(());
        };
        let termination_started = Instant::now();
        terminate_process_tree(pid);

        let remaining = TERMINATION_TIMEOUT.saturating_sub(termination_started.elapsed());
        let guard = record
            .inner
            .lock()
            .map_err(|_| "native ASR job 状态已损坏".to_string())?;
        let (guard, timeout) = record
            .reaped
            .wait_timeout_while(guard, remaining, |job| !job.reaped)
            .map_err(|_| "native ASR reap 状态已损坏".to_string())?;
        if timeout.timed_out() && !guard.reaped {
            return Err("[worker_termination_timeout] native ASR worker 未在 2 秒内退出".into());
        }
        Ok(())
    }

    pub(crate) fn shutdown(&self) {
        let job_ids = self
            .inner
            .jobs
            .lock()
            .map(|jobs| jobs.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for job_id in job_ids {
            let _ = self.cancel(&job_id);
        }
    }

    fn monitor(
        &self,
        job_id: String,
        record: Arc<JobRecord>,
        mut child: Child,
        stdout: ChildStdout,
        stderr_thread: std::thread::JoinHandle<()>,
    ) {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_bounded_line(&mut reader, self.inner.limits.max_event_line_bytes) {
                Ok(Some(line)) => match parse_event_line(&line, &self.inner.limits)
                    .and_then(|event| apply_worker_event(&record, event))
                {
                    Ok(PersistAction::None) => {}
                    Ok(PersistAction::Snapshot(snapshot, path)) => {
                        if persist_snapshot(&path, &snapshot).is_err() {
                            let failure = ProtocolFailure::new(
                                "recovery_write_failed",
                                "Failed to persist ASR recovery snapshot",
                            );
                            if let Ok(Some(snapshot)) = commit_failure(&record, failure) {
                                let _ = persist_snapshot(&path, &snapshot);
                            }
                            terminate_process_tree(child.id());
                            break;
                        }
                    }
                    Err(failure) => {
                        if let Ok(Some(snapshot)) = commit_failure(&record, failure) {
                            if let Ok(job) = record.inner.lock() {
                                let _ = persist_snapshot(&job.recovery_path, &snapshot);
                            }
                        }
                        terminate_process_tree(child.id());
                        break;
                    }
                },
                Ok(None) => break,
                Err(failure) => {
                    if let Ok(Some(snapshot)) = commit_failure(&record, failure) {
                        if let Ok(job) = record.inner.lock() {
                            let _ = persist_snapshot(&job.recovery_path, &snapshot);
                        }
                    }
                    terminate_process_tree(child.id());
                    break;
                }
            }
        }

        let status = child.wait();
        let _ = stderr_thread.join();
        if let Ok(mut job) = record.inner.lock() {
            let terminal_snapshot = finalize_after_exit_locked(&mut job, status.as_ref().ok());
            let snapshot =
                terminal_snapshot.or_else(|| job.terminal_committed.then(|| job.snapshot.clone()));
            if let Some(snapshot) = snapshot {
                let _ = persist_snapshot(&job.recovery_path, &snapshot);
                if snapshot.status == AsrJobStatus::Completed && !snapshot.segments.is_empty() {
                    let _ = write_minimal_ass(&job.output_ass_path, &snapshot.segments);
                }
            }
            self.inner.active_gate.release(&job_id);
            job.pid = None;
            job.reaped = true;
        } else {
            self.inner.active_gate.release(&job_id);
        }

        record.reaped.notify_all();
    }

    #[cfg(test)]
    fn is_reaped(&self, job_id: &str) -> bool {
        self.inner
            .jobs
            .lock()
            .ok()
            .and_then(|jobs| jobs.get(job_id).cloned())
            .and_then(|record| record.inner.lock().ok().map(|job| job.reaped))
            .unwrap_or(false)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequestV1<'a> {
    protocol_version: u64,
    job_id: &'a str,
    engine: &'a str,
    backend: &'a str,
    model_paths: &'a [ResolvedModelPath],
    audio_path: String,
    device: &'a str,
    language: &'a str,
    use_vad: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    vad_config: Option<&'a VadConfig>,
}

impl<'a> WorkerRequestV1<'a> {
    fn from_launch(
        launch: &'a ResolvedNativeLaunch,
        limits: &ProtocolLimits,
    ) -> Result<Self, String> {
        Ok(Self {
            protocol_version: limits.protocol_version,
            job_id: &launch.job_id,
            engine: &launch.engine,
            backend: &launch.backend,
            model_paths: &launch.model_paths,
            audio_path: protocol_path(&launch.audio_path, limits)?,
            device: &launch.device,
            language: &launch.language,
            use_vad: launch.use_vad,
            vad_config: launch
                .use_vad
                .then_some(launch.vad_config.as_ref())
                .flatten(),
        })
    }
}

#[derive(Debug)]
struct ProtocolFailure {
    code: String,
    message: String,
}

impl ProtocolFailure {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug)]
enum WorkerEvent {
    Ready {
        backend: String,
        device: String,
        duration_ms: i64,
    },
    Progress {
        processed_ms: i64,
        duration_ms: i64,
    },
    Segment(AsrSegment),
    SegmentsReplace(Vec<AsrSegment>),
    Completed {
        duration_ms: i64,
        detected_language: String,
    },
    Error {
        code: String,
        message: String,
    },
}

#[derive(Debug)]
enum PersistAction {
    None,
    Snapshot(AsrJobSnapshot, PathBuf),
}

fn parse_event_line(line: &[u8], limits: &ProtocolLimits) -> Result<WorkerEvent, ProtocolFailure> {
    if line.len() > limits.max_event_line_bytes {
        return Err(ProtocolFailure::new(
            "event_line_too_large",
            "Worker event line exceeds the protocol limit",
        ));
    }
    if line.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err(ProtocolFailure::new(
            "event_bom",
            "Worker event must not use BOM",
        ));
    }
    if line.contains(&0) {
        return Err(ProtocolFailure::new(
            "event_contains_nul",
            "Worker event contains NUL",
        ));
    }
    if line.contains(&b'\r') || line.contains(&b'\n') {
        return Err(ProtocolFailure::new(
            "event_multiline",
            "Worker event must contain one JSON object",
        ));
    }
    let text = std::str::from_utf8(line).map_err(|_| {
        ProtocolFailure::new(
            "event_malformed_json",
            "Worker event is not valid UTF-8 JSON",
        )
    })?;
    let root: Value = serde_json::from_str(text).map_err(|_| {
        ProtocolFailure::new(
            "event_malformed_json",
            "Worker event is not valid UTF-8 JSON",
        )
    })?;
    let object = root.as_object().ok_or_else(|| {
        ProtocolFailure::new("event_invalid_shape", "Worker event JSON must be an object")
    })?;
    let version = required_i64(object, "protocolVersion")?;
    if version != limits.protocol_version as i64 {
        return Err(ProtocolFailure::new(
            "unsupported_protocol_version",
            "Worker event protocolVersion must be 1",
        ));
    }
    let event = required_string(object, "event", "missing_or_invalid_field")?;
    match event.as_str() {
        "ready" => {
            let backend = required_string(object, "backend", "invalid_ready")?;
            let device = required_string(object, "device", "invalid_ready")?;
            let duration_ms = required_i64(object, "durationMs")?;
            if !matches!(backend.as_str(), "ctranslate2" | "crispasr")
                || !matches!(device.as_str(), "cpu" | "cuda" | "vulkan")
                || duration_ms <= 0
            {
                return Err(ProtocolFailure::new(
                    "invalid_ready",
                    "Worker ready event is invalid",
                ));
            }
            Ok(WorkerEvent::Ready {
                backend,
                device,
                duration_ms,
            })
        }
        "progress" => {
            let processed_ms = required_i64(object, "processedMs")?;
            let duration_ms = required_i64(object, "durationMs")?;
            if processed_ms < 0 || duration_ms <= 0 {
                return Err(ProtocolFailure::new(
                    "invalid_progress",
                    "Worker progress values are invalid",
                ));
            }
            Ok(WorkerEvent::Progress {
                processed_ms,
                duration_ms,
            })
        }
        "segment" => Ok(WorkerEvent::Segment(parse_segment(&root, limits)?)),
        "segmentsReplace" => {
            let segments = object
                .get("segments")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    ProtocolFailure::new(
                        "replacement_too_large",
                        "segmentsReplace is missing or too large",
                    )
                })?;
            if segments.len() > limits.max_replacement_segments {
                return Err(ProtocolFailure::new(
                    "replacement_too_large",
                    "segmentsReplace exceeds the segment count limit",
                ));
            }
            let mut parsed = Vec::with_capacity(segments.len());
            let mut previous = -1;
            for value in segments {
                let segment = parse_segment(value, limits)?;
                if segment.start_ms < previous {
                    return Err(ProtocolFailure::new(
                        "invalid_segment_order",
                        "Replacement segments must be sorted by startMs",
                    ));
                }
                previous = segment.start_ms;
                parsed.push(segment);
            }
            Ok(WorkerEvent::SegmentsReplace(parsed))
        }
        "completed" => {
            let duration_ms = required_i64(object, "durationMs")?;
            let detected_language =
                required_string(object, "detectedLanguage", "missing_or_invalid_field")?;
            if duration_ms <= 0 || detected_language != "ja" {
                return Err(ProtocolFailure::new(
                    "invalid_completed",
                    "Worker completed event is invalid",
                ));
            }
            Ok(WorkerEvent::Completed {
                duration_ms,
                detected_language,
            })
        }
        "error" => {
            let code = required_string(object, "code", "missing_or_invalid_field")?;
            let message = required_string(object, "message", "missing_or_invalid_field")?;
            if code.is_empty()
                || code.len() > limits.max_job_id_bytes
                || !code
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
                || message.is_empty()
                || message.len() > limits.max_text_bytes
                || contains_ascii_control(&message)
            {
                return Err(ProtocolFailure::new(
                    "invalid_error",
                    "Worker error event is invalid",
                ));
            }
            Ok(WorkerEvent::Error { code, message })
        }
        _ => Err(ProtocolFailure::new(
            "unknown_event",
            "Worker event is not supported by protocol v1",
        )),
    }
}

fn required_i64(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<i64, ProtocolFailure> {
    object.get(key).and_then(Value::as_i64).ok_or_else(|| {
        ProtocolFailure::new(
            "missing_or_invalid_field",
            format!("Worker event field '{key}' must be an integer"),
        )
    })
}

fn required_string(
    object: &serde_json::Map<String, Value>,
    key: &str,
    code: &str,
) -> Result<String, ProtocolFailure> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            ProtocolFailure::new(code, format!("Worker event field '{key}' must be a string"))
        })
}

fn parse_segment(value: &Value, limits: &ProtocolLimits) -> Result<AsrSegment, ProtocolFailure> {
    let object = value.as_object().ok_or_else(|| {
        ProtocolFailure::new("invalid_segment", "Worker segment must be an object")
    })?;
    let start_ms = required_i64(object, "startMs")?;
    let end_ms = required_i64(object, "endMs")?;
    let text = required_string(object, "text", "invalid_segment")?;
    if start_ms < 0
        || end_ms <= start_ms
        || text.is_empty()
        || text.len() > limits.max_text_bytes
        || contains_ascii_control(&text)
    {
        return Err(ProtocolFailure::new(
            "invalid_segment",
            "Worker segment shape is invalid",
        ));
    }
    Ok(AsrSegment {
        start_ms,
        end_ms,
        text,
    })
}

fn apply_worker_event(
    record: &Arc<JobRecord>,
    event: WorkerEvent,
) -> Result<PersistAction, ProtocolFailure> {
    let mut job = record.inner.lock().map_err(|_| {
        ProtocolFailure::new("host_state_poisoned", "Native ASR state is unavailable")
    })?;
    if job.worker_terminal_seen {
        return Err(ProtocolFailure::new(
            "event_after_terminal",
            "Worker stdout event follows a terminal event",
        ));
    }
    if job.terminal_committed {
        return Ok(PersistAction::None);
    }

    match event {
        WorkerEvent::Error { code, message } => {
            job.worker_terminal_seen = true;
            job.worker_error_code = Some(code.clone());
            let snapshot = commit_terminal_locked(
                &mut job,
                TerminalKind::Failed(ProtocolFailure::new(code, message)),
            )
            .expect("non-terminal worker error must commit");
            Ok(PersistAction::Snapshot(snapshot, job.recovery_path.clone()))
        }
        WorkerEvent::Ready {
            backend,
            device,
            duration_ms,
        } => {
            if job.ready {
                return Err(ProtocolFailure::new(
                    "duplicate_ready",
                    "Worker ready event was repeated",
                ));
            }
            if backend != job.expected_backend || device != job.expected_device {
                return Err(ProtocolFailure::new(
                    "ready_route_mismatch",
                    "Worker ready route differs from the request",
                ));
            }
            job.ready = true;
            job.snapshot.status = AsrJobStatus::Running;
            job.snapshot.duration_ms = duration_ms;
            Ok(PersistAction::None)
        }
        WorkerEvent::Progress {
            processed_ms,
            duration_ms,
        } => {
            require_ready(&job)?;
            if duration_ms != job.snapshot.duration_ms {
                return Err(ProtocolFailure::new(
                    "duration_drift",
                    "Worker progress duration differs from ready",
                ));
            }
            if processed_ms < job.worker_processed_ms {
                return Err(ProtocolFailure::new(
                    "progress_regression",
                    "Worker processedMs regressed",
                ));
            }
            if processed_ms > duration_ms {
                return Err(ProtocolFailure::new(
                    "invalid_progress",
                    "Worker processedMs exceeds durationMs",
                ));
            }
            job.worker_processed_ms = processed_ms;
            advance_product_progress(&mut job.snapshot, processed_ms);
            Ok(PersistAction::None)
        }
        WorkerEvent::Segment(segment) => {
            require_ready(&job)?;
            if job.snapshot.segments.len() >= job.max_segments {
                return Err(ProtocolFailure::new(
                    "segment_limit_exceeded",
                    "Worker segments exceed the canonical segment count limit",
                ));
            }
            validate_segment_sequence(&job, &segment)?;
            job.last_segment_start_ms = segment.start_ms;
            let end_ms = segment.end_ms;
            job.snapshot.segments.push(segment);
            job.snapshot.segment_count = job.snapshot.segments.len();
            advance_product_progress(&mut job.snapshot, end_ms);
            Ok(PersistAction::Snapshot(
                job.snapshot.clone(),
                job.recovery_path.clone(),
            ))
        }
        WorkerEvent::SegmentsReplace(segments) => {
            require_ready(&job)?;
            for segment in &segments {
                if segment.end_ms > job.snapshot.duration_ms {
                    return Err(ProtocolFailure::new(
                        "segment_out_of_bounds",
                        "Replacement segment exceeds ready duration",
                    ));
                }
            }
            let last_start = segments
                .last()
                .map(|segment| segment.start_ms)
                .unwrap_or(-1);
            let last_end = segments
                .iter()
                .map(|segment| segment.end_ms)
                .max()
                .unwrap_or(0);
            job.snapshot.segments = segments;
            job.last_segment_start_ms = last_start;
            job.snapshot.segment_count = job.snapshot.segments.len();
            advance_product_progress(&mut job.snapshot, last_end);
            Ok(PersistAction::Snapshot(
                job.snapshot.clone(),
                job.recovery_path.clone(),
            ))
        }
        WorkerEvent::Completed {
            duration_ms,
            detected_language,
        } => {
            require_ready(&job)?;
            if duration_ms != job.snapshot.duration_ms {
                return Err(ProtocolFailure::new(
                    "duration_drift",
                    "Worker completed duration differs from ready",
                ));
            }
            job.worker_terminal_seen = true;
            job.pending_completed = Some(PendingCompleted {
                duration_ms,
                detected_language,
            });
            Ok(PersistAction::None)
        }
    }
}

fn require_ready(job: &NativeAsrJob) -> Result<(), ProtocolFailure> {
    if job.ready {
        Ok(())
    } else {
        Err(ProtocolFailure::new(
            "event_before_ready",
            "Only worker error is allowed before ready",
        ))
    }
}

fn validate_segment_sequence(
    job: &NativeAsrJob,
    segment: &AsrSegment,
) -> Result<(), ProtocolFailure> {
    if segment.end_ms > job.snapshot.duration_ms {
        return Err(ProtocolFailure::new(
            "segment_out_of_bounds",
            "Worker segment exceeds ready duration",
        ));
    }
    if segment.start_ms < job.last_segment_start_ms {
        return Err(ProtocolFailure::new(
            "invalid_segment_order",
            "Worker segment order regressed",
        ));
    }
    Ok(())
}

fn advance_product_progress(snapshot: &mut AsrJobSnapshot, processed_ms: i64) {
    snapshot.processed_ms = snapshot
        .processed_ms
        .max(processed_ms.clamp(0, snapshot.duration_ms));
    if snapshot.duration_ms > 0 {
        snapshot.progress = snapshot.processed_ms as f64 / snapshot.duration_ms as f64;
    }
}

enum TerminalKind {
    Completed(PendingCompleted),
    Failed(ProtocolFailure),
    Cancelled,
}

fn commit_terminal_locked(
    job: &mut NativeAsrJob,
    terminal: TerminalKind,
) -> Option<AsrJobSnapshot> {
    if job.terminal_committed {
        return None;
    }
    job.terminal_committed = true;
    match terminal {
        TerminalKind::Completed(completed) => {
            job.snapshot.status = AsrJobStatus::Completed;
            job.snapshot.duration_ms = completed.duration_ms;
            job.snapshot.processed_ms = completed.duration_ms;
            job.snapshot.progress = 1.0;
            job.snapshot.detected_language = Some(completed.detected_language);
            job.snapshot.error = None;
        }
        TerminalKind::Failed(failure) => {
            job.snapshot.status = AsrJobStatus::Failed;
            job.snapshot.error = Some(format!("[{}] {}", failure.code, failure.message));
            job.worker_error_code.get_or_insert(failure.code);
        }
        TerminalKind::Cancelled => {
            job.snapshot.status = AsrJobStatus::Cancelled;
            job.snapshot.error = None;
        }
    }
    Some(job.snapshot.clone())
}

fn commit_failure(
    record: &Arc<JobRecord>,
    failure: ProtocolFailure,
) -> Result<Option<AsrJobSnapshot>, String> {
    let mut job = record
        .inner
        .lock()
        .map_err(|_| "native ASR job 状态已损坏".to_string())?;
    Ok(commit_terminal_locked(
        &mut job,
        TerminalKind::Failed(failure),
    ))
}

fn finalize_after_exit_locked(
    job: &mut NativeAsrJob,
    status: Option<&ExitStatus>,
) -> Option<AsrJobSnapshot> {
    if job.terminal_committed {
        return None;
    }
    let terminal = match status {
        Some(status) if status.success() => match job.pending_completed.take() {
            Some(completed) => TerminalKind::Completed(completed),
            None => TerminalKind::Failed(ProtocolFailure::new(
                "missing_terminal_event",
                "Worker exited without completed or error",
            )),
        },
        Some(status) => TerminalKind::Failed(ProtocolFailure::new(
            "worker_abnormal_exit",
            format!(
                "Worker exited abnormally with code {}",
                status
                    .code()
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "unknown".into())
            ),
        )),
        None => TerminalKind::Failed(ProtocolFailure::new(
            "worker_wait_failed",
            "Failed to wait for native ASR worker",
        )),
    };
    commit_terminal_locked(job, terminal)
}

fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>, ProtocolFailure> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf().map_err(|_| {
            ProtocolFailure::new("worker_stdout_io", "Failed to read worker stdout")
        })?;
        if available.is_empty() {
            if line.is_empty() {
                return Ok(None);
            }
            return Err(ProtocolFailure::new(
                "event_incomplete_line",
                "Worker stdout ended before the JSONL newline",
            ));
        }
        if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
            if line.len() + newline > max_bytes {
                return Err(ProtocolFailure::new(
                    "event_line_too_large",
                    "Worker event line exceeds the protocol limit",
                ));
            }
            line.extend_from_slice(&available[..newline]);
            reader.consume(newline + 1);
            return Ok(Some(line));
        }
        if line.len() + available.len() > max_bytes {
            return Err(ProtocolFailure::new(
                "event_line_too_large",
                "Worker event line exceeds the protocol limit",
            ));
        }
        line.extend_from_slice(available);
        let consumed = available.len();
        reader.consume(consumed);
    }
}

fn persist_snapshot(path: &Path, snapshot: &AsrJobSnapshot) -> Result<(), String> {
    let text = serde_json::to_string(snapshot)
        .map_err(|error| format!("序列化 ASR 恢复快照失败：{error}"))?;
    crate::style_library::atomic_write_text(path, &text, "asr-job-recovery")
        .map_err(|error| format!("保存 ASR 恢复快照失败：{error}"))
}

fn write_minimal_ass(path: &Path, segments: &[AsrSegment]) -> Result<(), String> {
    let mut text = String::from(
        "[Script Info]\nTitle: Hikaru Sub\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Primary,Noto Sans SC,54,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
    );
    for segment in segments {
        let body = segment
            .text
            .replace("\r\n", "\\N")
            .replace(['\r', '\n'], "\\N");
        text.push_str(&format!(
            "Dialogue: 0,{},{},Primary,,0,0,0,,{}\n",
            format_ass_time(segment.start_ms),
            format_ass_time(segment.end_ms),
            body
        ));
    }
    crate::style_library::atomic_write_text(path, &text, "asr-recovery-ass")
        .map_err(|error| format!("保存最小 ASR ASS 失败：{error}"))
}

fn format_ass_time(milliseconds: i64) -> String {
    let centiseconds = milliseconds.max(0).saturating_add(5) / 10;
    let hours = centiseconds / 360_000;
    let minutes = centiseconds % 360_000 / 6_000;
    let seconds = centiseconds % 6_000 / 100;
    let fraction = centiseconds % 100;
    format!("{hours}:{minutes:02}:{seconds:02}.{fraction:02}")
}

fn drain_stderr<R: Read>(mut stderr: R, path: &Path, limit: usize) {
    let mut retained = Vec::with_capacity(limit.min(8 * 1024));
    let mut buffer = [0u8; 4096];
    loop {
        match stderr.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                let remaining = limit.saturating_sub(retained.len());
                retained.extend_from_slice(&buffer[..read.min(remaining)]);
            }
        }
    }
    if retained.is_empty() {
        return;
    }
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if fs::write(path, retained).is_ok() {
        prune_stderr_logs(path.parent().unwrap_or_else(|| Path::new(".")));
    }
}

fn prune_stderr_logs(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut files = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let modified = entry.metadata().ok()?.modified().ok()?;
            path.extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("log"))
                .then_some((modified, path))
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|(modified, _)| *modified);
    let remove_count = files.len().saturating_sub(STDERR_LOG_RETENTION);
    for (_, path) in files.into_iter().take(remove_count) {
        let _ = fs::remove_file(path);
    }
}

fn contains_ascii_control(text: &str) -> bool {
    text.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
}

pub(crate) fn native_job_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!(
        "native-{}-{nanos}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn fake_worker() -> Option<PathBuf> {
        let path = std::env::var_os("HIKARU_ASR_FAKE_WORKER").map(PathBuf::from)?;
        path.is_file().then_some(path)
    }

    struct ProductionWorkerInputs {
        worker: PathBuf,
        cpu_worker: Option<PathBuf>,
        model: PathBuf,
        audio: PathBuf,
        cancel_audio: PathBuf,
        device: String,
    }

    fn production_worker_inputs() -> Option<ProductionWorkerInputs> {
        let values = [
            std::env::var_os("HIKARU_ASR_PRODUCTION_WORKER"),
            std::env::var_os("HIKARU_ASR_CT2_MODEL_PATH"),
            std::env::var_os("HIKARU_ASR_CT2_AUDIO_PATH"),
        ];
        let optional_values = [
            std::env::var_os("HIKARU_ASR_CT2_CPU_WORKER"),
            std::env::var_os("HIKARU_ASR_CT2_CANCEL_AUDIO_PATH"),
            std::env::var_os("HIKARU_ASR_CT2_DEVICE"),
        ];
        if values.iter().all(Option::is_none) {
            assert!(
                optional_values.iter().all(Option::is_none),
                "optional CT2 test env was set without the three production-worker inputs"
            );
            return None;
        }
        let worker = PathBuf::from(values[0].clone().expect("production worker env missing"));
        let model = PathBuf::from(values[1].clone().expect("CT2 model env missing"));
        let audio = PathBuf::from(values[2].clone().expect("CT2 audio env missing"));
        let cpu_worker = optional_values[0].clone().map(PathBuf::from);
        let cancel_audio = optional_values[1]
            .clone()
            .map(PathBuf::from)
            .unwrap_or_else(|| audio.clone());
        let device = optional_values[2]
            .clone()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "cpu".into());
        assert!(
            matches!(device.as_str(), "cpu" | "cuda"),
            "CT2 test device must be cpu or cuda"
        );
        assert!(worker.is_file(), "production worker env is not a file");
        assert!(model.is_dir(), "CT2 model env is not a directory");
        assert!(audio.is_file(), "CT2 audio env is not a file");
        assert!(cancel_audio.is_file(), "CT2 cancel audio env is not a file");
        if let Some(path) = &cpu_worker {
            assert!(path.is_file(), "CT2 CPU worker env is not a file");
        }
        if device == "cuda" {
            assert!(
                cpu_worker.is_some(),
                "CUDA host tests require HIKARU_ASR_CT2_CPU_WORKER"
            );
            assert!(
                optional_values[1].is_some(),
                "CUDA host tests require HIKARU_ASR_CT2_CANCEL_AUDIO_PATH"
            );
        }
        Some(ProductionWorkerInputs {
            worker,
            cpu_worker,
            model,
            audio,
            cancel_audio,
            device,
        })
    }

    fn production_launch(
        temp: &TempDir,
        job_id: &str,
        model: PathBuf,
        source_audio: &Path,
        device: &str,
        use_vad: bool,
        vad_config: Option<VadConfig>,
    ) -> ResolvedNativeLaunch {
        let cache = temp.path().join("cache");
        let workspace = cache.join("workspace").join("job");
        let output = temp.path().join("output");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&output).unwrap();
        let audio = workspace.join("audio.wav");
        fs::copy(source_audio, &audio).unwrap();
        ResolvedNativeLaunch::resolve(
            job_id.into(),
            "faster-whisper".into(),
            vec![("model".into(), model)],
            device.into(),
            "ja".into(),
            audio,
            output.join("result.ass"),
            &cache,
            use_vad,
            vad_config,
        )
        .unwrap()
    }

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<OsString>,
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    fn restricted_cuda_path(worker: &Path) -> EnvVarGuard {
        let cuda_root = PathBuf::from(std::env::var_os("CUDA_PATH").expect("CUDA_PATH missing"));
        let system_root =
            PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot missing"));
        let entries = [
            worker
                .parent()
                .expect("worker directory missing")
                .to_path_buf(),
            cuda_root.join("bin"),
            system_root.join("System32"),
        ];
        let value = std::env::join_paths(entries).expect("restricted CUDA PATH is invalid");
        let guard = EnvVarGuard {
            key: "PATH",
            previous: std::env::var_os("PATH"),
        };
        std::env::set_var("PATH", value);
        guard
    }

    #[cfg(windows)]
    fn process_count(executable: &Path) -> usize {
        let Some(name) = executable.file_name().and_then(|value| value.to_str()) else {
            return 0;
        };
        hidden_command("tasklist")
            .args(["/FI", &format!("IMAGENAME eq {name}"), "/FO", "CSV", "/NH"])
            .output()
            .ok()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .filter(|line| {
                        line.to_ascii_lowercase()
                            .contains(&name.to_ascii_lowercase())
                    })
                    .count()
            })
            .unwrap_or(0)
    }

    fn fixture_launch(temp: &TempDir, job_id: &str) -> ResolvedNativeLaunch {
        let cache = temp.path().join("cache");
        let workspace = cache.join("workspace").join("job");
        let output = temp.path().join("output");
        let model = temp.path().join("model");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&output).unwrap();
        fs::create_dir_all(&model).unwrap();
        fs::write(workspace.join("audio.wav"), b"fake").unwrap();
        fs::write(model.join("model.bin"), b"fake").unwrap();
        ResolvedNativeLaunch::resolve(
            job_id.into(),
            "faster-whisper".into(),
            vec![("model".into(), model)],
            "cpu".into(),
            "ja".into(),
            workspace.join("audio.wav"),
            output.join("result.ass"),
            &cache,
            false,
            None,
        )
        .unwrap()
    }

    fn job_record(launch: &ResolvedNativeLaunch, pid: u32) -> JobRecord {
        JobRecord::new(
            launch,
            pid,
            ProtocolLimits::load().unwrap().max_replacement_segments,
        )
    }

    fn host_for(worker: &Path, scenario: &str, gate: Arc<ActiveJobGate>) -> NativeAsrHost {
        NativeAsrHost::new(
            worker.to_path_buf(),
            vec!["--scenario".into(), scenario.into()],
            gate,
        )
        .unwrap()
    }

    fn wait_terminal(host: &NativeAsrHost, job_id: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let snapshot = host.snapshot(job_id, true).unwrap().unwrap();
            if matches!(
                snapshot["status"].as_str(),
                Some("completed" | "failed" | "cancelled")
            ) && host.is_reaped(job_id)
            {
                return snapshot;
            }
            assert!(Instant::now() < deadline, "job {job_id} did not terminate");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn canonical_limits_are_embedded_without_a_rust_copy() {
        let limits = ProtocolLimits::load().unwrap();
        assert_eq!(limits.protocol_version, 1);
        assert_eq!(limits.max_request_line_bytes, 262_144);
        assert_eq!(limits.max_event_line_bytes, 8_388_608);
        assert_eq!(limits.max_job_id_bytes, 128);
        assert_eq!(limits.max_path_bytes, 32_767);
        assert_eq!(limits.max_text_bytes, 16_384);
        assert_eq!(limits.max_model_entries, 8);
        assert_eq!(limits.max_replacement_segments, 32_768);
        assert_eq!(limits.max_stderr_diagnostic_bytes, 65_536);
    }

    #[test]
    fn active_gate_releases_failed_reservations_and_rejects_a_second_job() {
        let gate = Arc::new(ActiveJobGate::default());
        {
            let _reservation = gate.reserve().unwrap();
            assert!(gate.reserve().is_err());
        }
        let reservation = gate.reserve().unwrap();
        reservation.activate("job-1").unwrap();
        assert_eq!(gate.current().as_deref(), Some("job-1"));
        assert!(gate.reserve().is_err());
        gate.release("job-1");
        assert!(gate.reserve().is_ok());
    }

    #[test]
    fn launch_rejects_audio_outside_managed_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let cache = temp.path().join("cache");
        let model = temp.path().join("model");
        let output = temp.path().join("output");
        fs::create_dir_all(cache.join("workspace")).unwrap();
        fs::create_dir_all(&model).unwrap();
        fs::create_dir_all(&output).unwrap();
        fs::write(temp.path().join("audio.wav"), b"fake").unwrap();
        let error = ResolvedNativeLaunch::resolve(
            "job-1".into(),
            "faster-whisper".into(),
            vec![("model".into(), model)],
            "cpu".into(),
            "ja".into(),
            temp.path().join("audio.wav"),
            output.join("result.ass"),
            &cache,
            false,
            None,
        )
        .unwrap_err();
        assert!(error.contains("workspace"));
    }

    #[test]
    fn managed_artifact_job_ids_cannot_escape_their_directories() {
        assert!(validate_artifact_job_id("native-123_safe").is_ok());
        assert!(validate_artifact_job_id("../escape").is_err());
        assert!(validate_artifact_job_id(r"..\escape").is_err());
        assert!(validate_artifact_job_id("C:escape").is_err());
    }

    #[test]
    fn pre_ready_structured_error_commits_safe_machine_code() {
        let temp = tempfile::tempdir().unwrap();
        let launch = fixture_launch(&temp, "job-pre-ready-error");
        let record = Arc::new(job_record(&launch, 1));
        apply_worker_event(
            &record,
            WorkerEvent::Error {
                code: "missing_model_role".into(),
                message: "model role is required".into(),
            },
        )
        .unwrap();
        let job = record.inner.lock().unwrap();
        assert_eq!(job.snapshot.status, AsrJobStatus::Failed);
        assert_eq!(
            job.snapshot.error.as_deref(),
            Some("[missing_model_role] model role is required")
        );
    }

    #[test]
    fn segment_progress_and_duration_stay_monotonic() {
        let temp = tempfile::tempdir().unwrap();
        let launch = fixture_launch(&temp, "job-progress");
        let record = Arc::new(job_record(&launch, 1));
        apply_worker_event(
            &record,
            WorkerEvent::Ready {
                backend: "ctranslate2".into(),
                device: "cpu".into(),
                duration_ms: 10_000,
            },
        )
        .unwrap();
        apply_worker_event(
            &record,
            WorkerEvent::Segment(AsrSegment {
                start_ms: 1_000,
                end_ms: 2_000,
                text: "segment before progress".into(),
            }),
        )
        .unwrap();
        apply_worker_event(
            &record,
            WorkerEvent::Progress {
                processed_ms: 1_000,
                duration_ms: 10_000,
            },
        )
        .unwrap();
        let regression = apply_worker_event(
            &record,
            WorkerEvent::Progress {
                processed_ms: 999,
                duration_ms: 10_000,
            },
        )
        .unwrap_err();
        assert_eq!(regression.code, "progress_regression");
        let job = record.inner.lock().unwrap();
        assert_eq!(job.snapshot.duration_ms, 10_000);
        assert_eq!(job.snapshot.processed_ms, 2_000);
    }

    #[test]
    fn invalid_replacement_does_not_mutate_existing_segments() {
        let temp = tempfile::tempdir().unwrap();
        let launch = fixture_launch(&temp, "job-replace");
        let record = Arc::new(job_record(&launch, 1));
        apply_worker_event(
            &record,
            WorkerEvent::Ready {
                backend: "ctranslate2".into(),
                device: "cpu".into(),
                duration_ms: 10_000,
            },
        )
        .unwrap();
        apply_worker_event(
            &record,
            WorkerEvent::Segment(AsrSegment {
                start_ms: 1_000,
                end_ms: 2_000,
                text: "old".into(),
            }),
        )
        .unwrap();
        let error = apply_worker_event(
            &record,
            WorkerEvent::SegmentsReplace(vec![AsrSegment {
                start_ms: 3_000,
                end_ms: 11_000,
                text: "bad".into(),
            }]),
        )
        .unwrap_err();
        assert_eq!(error.code, "segment_out_of_bounds");
        let job = record.inner.lock().unwrap();
        assert_eq!(job.snapshot.segments[0].text, "old");
    }

    #[test]
    fn appended_segments_cannot_exceed_the_canonical_count_limit() {
        let temp = tempfile::tempdir().unwrap();
        let launch = fixture_launch(&temp, "job-append-limit");
        let record = Arc::new(job_record(&launch, 1));
        apply_worker_event(
            &record,
            WorkerEvent::Ready {
                backend: "ctranslate2".into(),
                device: "cpu".into(),
                duration_ms: 10_000,
            },
        )
        .unwrap();
        let limit = ProtocolLimits::load().unwrap().max_replacement_segments;
        {
            let mut job = record.inner.lock().unwrap();
            job.snapshot.segments = vec![
                AsrSegment {
                    start_ms: 0,
                    end_ms: 1,
                    text: "bounded".into(),
                };
                limit
            ];
            job.snapshot.segment_count = limit;
            job.last_segment_start_ms = 0;
        }
        let error = apply_worker_event(
            &record,
            WorkerEvent::Segment(AsrSegment {
                start_ms: 1,
                end_ms: 2,
                text: "overflow".into(),
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, "segment_limit_exceeded");
        assert_eq!(record.inner.lock().unwrap().snapshot.segment_count, limit);
    }

    #[test]
    fn first_terminal_commit_wins_all_late_sources() {
        let temp = tempfile::tempdir().unwrap();
        let launch = fixture_launch(&temp, "job-race");
        let record = Arc::new(job_record(&launch, 1));
        {
            let mut job = record.inner.lock().unwrap();
            let cancelled = commit_terminal_locked(&mut job, TerminalKind::Cancelled).unwrap();
            assert_eq!(cancelled.status, AsrJobStatus::Cancelled);
            assert!(commit_terminal_locked(
                &mut job,
                TerminalKind::Failed(ProtocolFailure::new("late", "late failure"))
            )
            .is_none());
            assert_eq!(job.snapshot.status, AsrJobStatus::Cancelled);
        }
    }

    #[test]
    fn snapshot_omits_segments_when_not_requested() {
        let temp = tempfile::tempdir().unwrap();
        let launch = fixture_launch(&temp, "job-snapshot");
        let record = job_record(&launch, 1);
        let snapshot = record.inner.lock().unwrap().snapshot.clone();
        assert!(snapshot.to_value(false).unwrap().get("segments").is_none());
        assert!(snapshot.to_value(true).unwrap().get("segments").is_some());
    }

    #[test]
    fn fake_worker_lifecycle_matrix_preserves_snapshots_and_exit_classification() {
        let _guard = FAKE_WORKER_TEST_LOCK.lock().unwrap();
        let Some(worker) = fake_worker() else {
            eprintln!("HIKARU_ASR_FAKE_WORKER not set; skipping native fake matrix");
            return;
        };
        let cases = [
            ("success", "completed", None, 2usize),
            ("segments-replace", "completed", None, 1),
            (
                "structured-error",
                "failed",
                Some("[model_runtime_failed]"),
                1,
            ),
            (
                "malformed-json",
                "failed",
                Some("[event_malformed_json]"),
                0,
            ),
            ("unknown-event", "failed", Some("[unknown_event]"), 0),
            (
                "version-mismatch",
                "failed",
                Some("[unsupported_protocol_version]"),
                0,
            ),
            (
                "invalid-transition",
                "failed",
                Some("[event_before_ready]"),
                0,
            ),
            ("invalid-segment", "failed", Some("[invalid_segment]"), 0),
            ("duration-drift", "failed", Some("[duration_drift]"), 0),
            (
                "oversized-line",
                "failed",
                Some("[event_line_too_large]"),
                0,
            ),
            (
                "crash-before-ready",
                "failed",
                Some("[worker_abnormal_exit]"),
                0,
            ),
            (
                "crash-after-progress",
                "failed",
                Some("[worker_abnormal_exit]"),
                0,
            ),
            (
                "zero-exit-without-terminal",
                "failed",
                Some("[missing_terminal_event]"),
                0,
            ),
            (
                "completed-then-nonzero",
                "failed",
                Some("[worker_abnormal_exit]"),
                0,
            ),
            ("stderr-diagnostics", "completed", None, 0),
        ];
        for (index, (scenario, status, error_prefix, segment_count)) in cases.iter().enumerate() {
            let temp = tempfile::tempdir().unwrap();
            let job_id = format!("matrix-{index}");
            let gate = Arc::new(ActiveJobGate::default());
            let host = host_for(&worker, scenario, Arc::clone(&gate));
            let launch = fixture_launch(&temp, &job_id);
            let recovery = launch.recovery_path.clone();
            let output = launch.output_ass_path.clone();
            let stderr_log = launch.stderr_log_path.clone();
            let reservation = gate.reserve().unwrap();
            host.start(launch, reservation).unwrap();
            let snapshot = wait_terminal(&host, &job_id);
            assert_eq!(snapshot["status"], *status, "scenario {scenario}");
            assert_eq!(
                snapshot["segmentCount"], *segment_count,
                "scenario {scenario}"
            );
            match error_prefix {
                Some(prefix) => assert!(
                    snapshot["error"].as_str().unwrap().starts_with(prefix),
                    "scenario {scenario}: {}",
                    snapshot["error"]
                ),
                None => assert!(snapshot["error"].is_null(), "scenario {scenario}"),
            }
            let recovered: Value =
                serde_json::from_str(&fs::read_to_string(recovery).unwrap()).unwrap();
            assert_eq!(recovered["status"], *status, "scenario {scenario}");
            assert_eq!(
                output.exists(),
                *status == "completed" && *segment_count > 0
            );
            if *scenario == "stderr-diagnostics" {
                assert_eq!(fs::metadata(stderr_log).unwrap().len(), 65_536);
            }
            assert!(
                gate.current().is_none(),
                "scenario {scenario} leaked active slot"
            );
        }
    }

    #[test]
    fn production_worker_runs_the_selected_device_through_the_native_host() {
        let _guard = FAKE_WORKER_TEST_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(inputs) = production_worker_inputs() else {
            eprintln!("production worker/model/audio env not set; skipping real CT2 host test");
            return;
        };
        let _path = (inputs.device == "cuda").then(|| restricted_cuda_path(&inputs.worker));
        let cases = if inputs.device == "cuda" {
            vec![("production-ct2-cuda", false)]
        } else {
            vec![
                ("production-ct2-no-vad", false),
                ("production-ct2-candidate-b", true),
            ]
        };
        for (job_id, use_vad) in cases {
            let temp = tempfile::tempdir().unwrap();
            let gate = Arc::new(ActiveJobGate::default());
            let host =
                NativeAsrHost::new(inputs.worker.clone(), vec![], Arc::clone(&gate)).unwrap();
            let launch = production_launch(
                &temp,
                job_id,
                inputs.model.clone(),
                &inputs.audio,
                &inputs.device,
                use_vad,
                None,
            );
            let recovery = launch.recovery_path.clone();
            let output = launch.output_ass_path.clone();
            let stderr_log = launch.stderr_log_path.clone();
            host.start(launch, gate.reserve().unwrap()).unwrap();

            let deadline = Instant::now() + Duration::from_secs(180);
            let snapshot = loop {
                let snapshot = host.snapshot(job_id, true).unwrap().unwrap();
                if snapshot["status"] == "completed" && host.is_reaped(job_id) {
                    break snapshot;
                }
                if Instant::now() >= deadline {
                    panic!(
                        "real CT2 worker did not complete: snapshot={snapshot}; stderr={}",
                        fs::read_to_string(&stderr_log).unwrap_or_default()
                    );
                }
                std::thread::sleep(Duration::from_millis(50));
            };
            assert_eq!(snapshot["durationMs"], 24_102);
            assert_eq!(snapshot["processedMs"], 24_102);
            assert_eq!(snapshot["progress"], 1.0);
            assert!(snapshot["segmentCount"].as_u64().unwrap() > 0);
            assert!(snapshot["error"].is_null());
            let mut previous_start = -1;
            for segment in snapshot["segments"].as_array().unwrap() {
                let start = segment["startMs"].as_i64().unwrap();
                let end = segment["endMs"].as_i64().unwrap();
                assert!(start >= previous_start && start >= 0 && start < end && end <= 24_102);
                assert!(!segment["text"].as_str().unwrap().is_empty());
                previous_start = start;
            }
            assert!(recovery.is_file());
            assert!(output.is_file());
            assert!(gate.current().is_none());
        }
    }

    #[test]
    fn cpu_only_worker_rejects_cuda_before_ready_through_the_native_host() {
        let _guard = FAKE_WORKER_TEST_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(inputs) = production_worker_inputs() else {
            eprintln!(
                "production worker/model/audio env not set; skipping real CT2 CUDA error test"
            );
            return;
        };
        if inputs.device != "cuda" {
            eprintln!("CT2 test device is not cuda; skipping cuda_not_built host test");
            return;
        }
        let cpu_worker = inputs.cpu_worker.clone().unwrap();
        let _path = restricted_cuda_path(&cpu_worker);
        let temp = tempfile::tempdir().unwrap();
        let gate = Arc::new(ActiveJobGate::default());
        let host = NativeAsrHost::new(cpu_worker, vec![], Arc::clone(&gate)).unwrap();
        let launch = production_launch(
            &temp,
            "production-ct2-cuda-not-built",
            inputs.model,
            &inputs.audio,
            "cuda",
            false,
            None,
        );
        let recovery = launch.recovery_path.clone();
        let output = launch.output_ass_path.clone();
        host.start(launch, gate.reserve().unwrap()).unwrap();
        let snapshot = wait_terminal(&host, "production-ct2-cuda-not-built");
        assert_eq!(snapshot["status"], "failed");
        assert!(snapshot["error"]
            .as_str()
            .unwrap()
            .starts_with("[cuda_not_built]"));
        assert_eq!(snapshot["durationMs"], 0);
        assert!(!output.exists());
        assert!(recovery.is_file());
        assert!(gate.current().is_none());
    }

    #[test]
    fn production_worker_rejects_candidate_b_config_identity_drift() {
        let _guard = FAKE_WORKER_TEST_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(inputs) = production_worker_inputs() else {
            eprintln!("production worker/model/audio env not set; skipping real CT2 error test");
            return;
        };
        let _path = (inputs.device == "cuda").then(|| restricted_cuda_path(&inputs.worker));
        let temp = tempfile::tempdir().unwrap();
        let gate = Arc::new(ActiveJobGate::default());
        let host = NativeAsrHost::new(inputs.worker, vec![], Arc::clone(&gate)).unwrap();
        let launch = production_launch(
            &temp,
            "production-ct2-vad-error",
            inputs.model,
            &inputs.audio,
            &inputs.device,
            true,
            Some(VadConfig {
                threshold: Some(0.6),
                min_speech_duration_ms: None,
                min_silence_duration_ms: None,
                speech_pad_ms: None,
                max_segment_duration_ms: None,
            }),
        );
        let recovery = launch.recovery_path.clone();
        host.start(launch, gate.reserve().unwrap()).unwrap();
        let snapshot = wait_terminal(&host, "production-ct2-vad-error");
        assert_eq!(snapshot["status"], "failed");
        assert!(snapshot["error"]
            .as_str()
            .unwrap()
            .starts_with("[vad_config_identity_mismatch]"));
        assert!(recovery.is_file());
        assert!(gate.current().is_none());
    }

    #[test]
    fn cancelling_the_real_worker_after_ready_never_publishes_completed() {
        let _guard = FAKE_WORKER_TEST_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(inputs) = production_worker_inputs() else {
            eprintln!("production worker/model/audio env not set; skipping real CT2 cancel test");
            return;
        };
        let _path = (inputs.device == "cuda").then(|| restricted_cuda_path(&inputs.worker));
        let temp = tempfile::tempdir().unwrap();
        let gate = Arc::new(ActiveJobGate::default());
        let host = NativeAsrHost::new(inputs.worker, vec![], Arc::clone(&gate)).unwrap();
        let launch = production_launch(
            &temp,
            "production-ct2-cancel",
            inputs.model,
            &inputs.cancel_audio,
            &inputs.device,
            inputs.device == "cpu",
            None,
        );
        let output = launch.output_ass_path.clone();
        host.start(launch, gate.reserve().unwrap()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(60);
        while host
            .snapshot("production-ct2-cancel", false)
            .unwrap()
            .unwrap()["durationMs"]
            .as_i64()
            .unwrap_or(0)
            <= 0
        {
            assert!(
                Instant::now() < deadline,
                "real CT2 worker did not reach ready"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        let started = Instant::now();
        host.cancel("production-ct2-cancel").unwrap();
        assert!(started.elapsed() <= Duration::from_secs(2));
        let snapshot = wait_terminal(&host, "production-ct2-cancel");
        assert_eq!(snapshot["status"], "cancelled");
        assert!(snapshot["detectedLanguage"].is_null());
        assert!(!output.exists());
        assert!(host.is_reaped("production-ct2-cancel"));
        assert!(gate.current().is_none());
    }

    #[test]
    fn cancel_and_shutdown_reap_fake_process_trees_within_two_seconds() {
        let _guard = FAKE_WORKER_TEST_LOCK.lock().unwrap();
        let Some(worker) = fake_worker() else {
            eprintln!("HIKARU_ASR_FAKE_WORKER not set; skipping native cancel matrix");
            return;
        };
        for (index, scenario) in ["hang-after-ready", "child-process-hang"]
            .iter()
            .enumerate()
        {
            #[cfg(windows)]
            let baseline_processes = process_count(&worker);
            let temp = tempfile::tempdir().unwrap();
            let job_id = format!("cancel-{index}");
            let gate = Arc::new(ActiveJobGate::default());
            let host = host_for(&worker, scenario, Arc::clone(&gate));
            let launch = fixture_launch(&temp, &job_id);
            let recovery = launch.recovery_path.clone();
            let reservation = gate.reserve().unwrap();
            host.start(launch, reservation).unwrap();
            let deadline = Instant::now() + Duration::from_secs(2);
            while host.snapshot(&job_id, false).unwrap().unwrap()["status"] != "running" {
                assert!(Instant::now() < deadline);
                std::thread::sleep(Duration::from_millis(10));
            }
            assert!(
                gate.reserve().is_err(),
                "a second active ASR job was admitted"
            );
            #[cfg(windows)]
            {
                let expected = baseline_processes
                    + if *scenario == "child-process-hang" {
                        2
                    } else {
                        1
                    };
                while process_count(&worker) < expected {
                    assert!(
                        Instant::now() < deadline,
                        "{scenario} did not launch its process tree"
                    );
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
            let started = Instant::now();
            if *scenario == "child-process-hang" {
                host.shutdown();
            } else {
                host.cancel(&job_id).unwrap();
            }
            assert!(started.elapsed() <= Duration::from_secs(2));
            let snapshot = wait_terminal(&host, &job_id);
            assert_eq!(snapshot["status"], "cancelled");
            assert_eq!(
                serde_json::from_str::<Value>(&fs::read_to_string(recovery).unwrap()).unwrap()
                    ["status"],
                "cancelled"
            );
            assert!(gate.current().is_none());
            #[cfg(windows)]
            {
                let deadline = Instant::now() + Duration::from_secs(1);
                while process_count(&worker) > baseline_processes && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(20));
                }
                assert_eq!(
                    process_count(&worker),
                    baseline_processes,
                    "{scenario} left an orphan worker"
                );
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn cancel_reaps_a_terminal_snapshot_without_overwriting_first_winner() {
        let _guard = FAKE_WORKER_TEST_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(worker) = fake_worker() else {
            eprintln!("HIKARU_ASR_FAKE_WORKER not set; skipping terminal cleanup test");
            return;
        };
        let baseline_processes = process_count(&worker);
        let temp = tempfile::tempdir().unwrap();
        let job_id = "terminal-cleanup";
        let gate = Arc::new(ActiveJobGate::default());
        let host = host_for(&worker, "hang-after-ready", Arc::clone(&gate));
        let launch = fixture_launch(&temp, job_id);
        let recovery = launch.recovery_path.clone();
        host.start(launch, gate.reserve().unwrap()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while host.snapshot(job_id, false).unwrap().unwrap()["status"] != "running" {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        let record = host
            .inner
            .jobs
            .lock()
            .unwrap()
            .get(job_id)
            .cloned()
            .unwrap();
        let snapshot = commit_failure(
            &record,
            ProtocolFailure::new("first_failure", "First terminal wins"),
        )
        .unwrap()
        .unwrap();
        persist_snapshot(&recovery, &snapshot).unwrap();

        let started = Instant::now();
        host.cancel(job_id).unwrap();
        assert!(started.elapsed() <= TERMINATION_TIMEOUT);
        assert!(host.is_reaped(job_id));
        assert!(gate.current().is_none());
        let snapshot = host.snapshot(job_id, true).unwrap().unwrap();
        assert_eq!(snapshot["status"], "failed");
        assert_eq!(snapshot["error"], "[first_failure] First terminal wins");
        let deadline = Instant::now() + Duration::from_secs(1);
        while process_count(&worker) > baseline_processes && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(process_count(&worker), baseline_processes);
    }

    #[test]
    fn managed_stderr_logs_keep_only_the_fixed_retention_window() {
        let temp = tempfile::tempdir().unwrap();
        for index in 0..(STDERR_LOG_RETENTION + 2) {
            fs::write(
                temp.path().join(format!("job-{index}.stderr.log")),
                b"diagnostic",
            )
            .unwrap();
        }
        prune_stderr_logs(temp.path());
        assert_eq!(
            fs::read_dir(temp.path()).unwrap().count(),
            STDERR_LOG_RETENTION
        );
    }

    #[test]
    fn ass_time_rounds_to_centiseconds() {
        assert_eq!(format_ass_time(0), "0:00:00.00");
        assert_eq!(format_ass_time(1_235), "0:00:01.24");
        assert_eq!(format_ass_time(3_600_000), "1:00:00.00");
    }
}
