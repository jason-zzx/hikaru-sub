//! Stable ASR commands with one internal legacy/Native MVP route policy.
//!
//! Product/default routing remains the Python HTTP sidecar until T18. The Native branch
//! consumes the bundled CPU worker and exact managed model without changing public IPC.

use crate::asr_models::{
    known_native_asr_engines, ModelDownloadSnapshot, NativeAsrModelDisposition,
    NativeAsrModelManager, NativeAsrModelOrigin, NativeAsrModelStatus,
};
use crate::asr_worker::{native_job_id, ActiveJobGate, NativeAsrHost, ResolvedNativeLaunch};
use crate::dependencies::{
    effective_asr_service_dir, effective_source_profile, ensure_runtime_deps_writable_or_elevate,
    managed_asr_service_dir, managed_model_cache_dir, resolve_native_asr_cpu_runtime,
    work_cache_dir, RuntimeDependencySourceProfile,
};
use crate::process::{hidden_command, terminate_process_tree};
use crate::settings::{load_settings, AppSettings};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(debug_assertions)]
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

/// 正在运行的 sidecar 句柄。
pub struct Sidecar {
    base_url: String,
    child: Child,
    pid: u32,
    env: Vec<(String, String)>,
}

impl Sidecar {
    fn kill(&mut self) {
        terminate_process_tree(self.pid);
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                _ => break,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AsrRoutePolicy {
    Legacy,
    NativeMvp,
}

impl AsrRoutePolicy {
    fn uses_native(self) -> bool {
        self == Self::NativeMvp
    }
}

fn default_route_policy(has_debug_native_host: bool) -> AsrRoutePolicy {
    if has_debug_native_host {
        AsrRoutePolicy::NativeMvp
    } else {
        AsrRoutePolicy::Legacy
    }
}

/// 受 Tauri 托管的全局 ASR 状态；legacy/native 共用一个活跃任务槽。
pub struct AsrState {
    sidecar: Mutex<Option<Sidecar>>,
    job_base_urls: Mutex<HashMap<String, String>>,
    job_recovery_paths: Mutex<HashMap<String, PathBuf>>,
    active_job: Arc<ActiveJobGate>,
    route_policy: AsrRoutePolicy,
    pub(crate) native_models: NativeAsrModelManager,
    native_host: StdMutex<Option<NativeAsrHost>>,
}

impl Default for AsrState {
    fn default() -> Self {
        let active_job = Arc::new(ActiveJobGate::default());
        let native_host = debug_native_host(Arc::clone(&active_job));
        let route_policy = default_route_policy(native_host.is_some());
        Self {
            sidecar: Mutex::new(None),
            job_base_urls: Mutex::new(HashMap::new()),
            job_recovery_paths: Mutex::new(HashMap::new()),
            active_job,
            route_policy,
            native_models: NativeAsrModelManager::default(),
            native_host: StdMutex::new(native_host),
        }
    }
}

impl AsrState {
    fn native_host(&self) -> Result<Option<NativeAsrHost>, String> {
        self.native_host
            .lock()
            .map(|host| host.clone())
            .map_err(|_| "native ASR host 状态已损坏".to_string())
    }

    fn install_native_host(&self, host: NativeAsrHost) -> Result<NativeAsrHost, String> {
        let mut current = self
            .native_host
            .lock()
            .map_err(|_| "native ASR host 状态已损坏".to_string())?;
        Ok(current.get_or_insert(host).clone())
    }

    pub fn shutdown(&self) {
        if let Ok(Some(host)) = self.native_host() {
            host.shutdown();
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match self.sidecar.try_lock() {
                Ok(mut guard) => {
                    if let Some(mut sidecar) = guard.take() {
                        sidecar.kill();
                    }
                    break;
                }
                Err(_) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }
        self.active_job.clear();
    }
}

#[cfg(debug_assertions)]
fn debug_native_host(active_job: Arc<ActiveJobGate>) -> Option<NativeAsrHost> {
    let executable = std::env::var_os("HIKARU_ASR_FAKE_WORKER")?;
    let scenario =
        std::env::var_os("HIKARU_ASR_FAKE_SCENARIO").unwrap_or_else(|| OsString::from("success"));
    match NativeAsrHost::new(
        PathBuf::from(executable),
        vec![OsString::from("--scenario"), scenario],
        active_job,
    ) {
        Ok(host) => Some(host),
        Err(error) => {
            eprintln!("[asr] ignoring invalid debug native worker override: {error}");
            None
        }
    }
}

#[cfg(not(debug_assertions))]
fn debug_native_host(_active_job: Arc<ActiveJobGate>) -> Option<NativeAsrHost> {
    None
}

async fn packaged_native_host(app: &AppHandle, state: &AsrState) -> Result<NativeAsrHost, String> {
    if let Some(host) = state.native_host()? {
        return Ok(host);
    }
    let app = app.clone();
    let active_job = Arc::clone(&state.active_job);
    let host = tauri::async_runtime::spawn_blocking(move || {
        let runtime = resolve_native_asr_cpu_runtime(&app)?;
        NativeAsrHost::new(runtime.worker, Vec::new(), active_job)
    })
    .await
    .map_err(|error| format!("解析 Native ASR CPU 运行时失败：{error}"))??;
    state.install_native_host(host)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicAsrModelStatus {
    engine: String,
    model: String,
    available: bool,
    downloaded: bool,
    disposition: NativeAsrModelDisposition,
    backend: Option<String>,
    revision: Option<String>,
    origin: Option<NativeAsrModelOrigin>,
    reason: Option<String>,
}

fn public_asr_model_status(status: NativeAsrModelStatus) -> PublicAsrModelStatus {
    let (available, downloaded, reason) = match status.disposition {
        NativeAsrModelDisposition::Ready => (true, true, None),
        NativeAsrModelDisposition::SupportedMissing => (true, false, Some("需要下载模型".into())),
        NativeAsrModelDisposition::PostMvpUnavailable => {
            (false, false, Some("该模型将在后续版本支持".into()))
        }
        NativeAsrModelDisposition::Unsupported => (false, false, Some("不支持该引擎或模型".into())),
    };
    PublicAsrModelStatus {
        engine: status.engine,
        model: status.model,
        available,
        downloaded,
        disposition: status.disposition,
        backend: status.backend,
        revision: status.revision,
        origin: status.origin,
        reason,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicModelDownloadSnapshot {
    id: String,
    status: crate::asr_models::ModelDownloadJobStatus,
    progress: f64,
    downloaded_bytes: u64,
    total_bytes: u64,
    error: Option<String>,
    hf_endpoint: String,
    revision: String,
    resolved_path: Option<String>,
}

fn public_model_download_snapshot(snapshot: ModelDownloadSnapshot) -> PublicModelDownloadSnapshot {
    PublicModelDownloadSnapshot {
        id: snapshot.id,
        status: snapshot.status,
        progress: snapshot.progress.unwrap_or(0.0),
        downloaded_bytes: snapshot.downloaded_bytes,
        total_bytes: snapshot.total_bytes,
        error: snapshot.error,
        hf_endpoint: snapshot.source_endpoint,
        revision: snapshot.revision,
        resolved_path: snapshot.resolved_path,
    }
}

#[derive(Deserialize)]
struct ReadyLine {
    event: String,
    port: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VadConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) threshold: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) min_speech_duration_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) min_silence_duration_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) speech_pad_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) max_segment_duration_ms: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAsrArgs {
    audio_path: String,
    engine: String,
    model: String,
    device: String,
    language: Option<String>,
    output_ass_path: Option<String>,
    #[serde(default)]
    use_vad: bool,
    #[serde(default)]
    vad_config: Option<VadConfig>,
}

fn validate_start_asr_args(args: &StartAsrArgs) -> Result<(), String> {
    if args
        .output_ass_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return Err("缺少转录字幕输出路径".into());
    }
    Ok(())
}

fn validate_native_mvp_request(args: &StartAsrArgs) -> Result<(), String> {
    if args.engine != "faster-whisper" || args.model != "large-v3" {
        return Err("当前 Native MVP 仅支持 faster-whisper/large-v3".into());
    }
    if !matches!(args.device.as_str(), "auto" | "cpu") {
        return Err(format!(
            "当前 Native MVP 不支持设备：{}（仅支持 auto/cpu）",
            args.device
        ));
    }
    if args.use_vad {
        return Err("[vad_not_built] 内置 Native ASR CPU 运行时未包含 VAD".into());
    }
    if args
        .language
        .as_deref()
        .is_some_and(|language| language != "ja")
    {
        return Err("当前 Native MVP 仅支持日语源语言".into());
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn resolve_debug_native_launch(
    args: StartAsrArgs,
    job_id: String,
    cache_root: PathBuf,
) -> Result<ResolvedNativeLaunch, String> {
    let model_path = std::env::var_os("HIKARU_ASR_FAKE_MODEL_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&args.model));
    let mut models = vec![("model".into(), model_path)];
    if args.engine == "qwen3-asr" {
        let aligner = std::env::var_os("HIKARU_ASR_FAKE_ALIGNER_PATH")
            .map(PathBuf::from)
            .ok_or_else(|| {
                "qwen3-asr debug native route 缺少 HIKARU_ASR_FAKE_ALIGNER_PATH".to_string()
            })?;
        models.push(("aligner".into(), aligner));
    }
    ResolvedNativeLaunch::resolve(
        job_id,
        args.engine,
        models,
        "cpu".into(),
        args.language.unwrap_or_else(|| "ja".into()),
        PathBuf::from(args.audio_path),
        PathBuf::from(
            args.output_ass_path
                .expect("outputAssPath was validated before native resolution"),
        ),
        &cache_root,
        args.use_vad,
        args.vad_config,
    )
}

/// 解析 asr-service 目录（含 main.py）：设置 → 有效目录（debug 仓库 / release deps）→ 资源 → cwd。
fn resolve_service_dir(app: &AppHandle, settings: &AppSettings) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = settings
        .asr_service_path
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        candidates.push(PathBuf::from(p));
    }
    if let Ok(effective) = effective_asr_service_dir(app, settings.asr_service_path.as_deref()) {
        candidates.push(effective);
    }
    if let Ok(managed) = managed_asr_service_dir(app) {
        candidates.push(managed);
    }
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("asr-service"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("asr-service"));
        candidates.push(cwd.join("..").join("asr-service"));
    }
    for dir in candidates {
        if dir.join("main.py").is_file() {
            return Ok(dir);
        }
    }
    Err("未找到 asr-service（main.py）。请在设置中配置「ASR 服务目录」。".into())
}

/// 候选 Python 解释器：设置优先 → 服务目录下虚拟环境 → 按平台回退到系统解释器。
fn python_candidates(settings: &AppSettings, dir: &Path) -> Vec<String> {
    let mut v = Vec::new();
    if let Some(p) = settings
        .python_path
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        v.push(p.clone());
    }
    // 本地开发常见：在 asr-service 下创建 .venv / venv 并安装依赖。
    // 优先使用其中的解释器，否则系统 python 读不到这些依赖。
    for venv in ["venv", ".venv"] {
        let py = if cfg!(windows) {
            dir.join(venv).join("Scripts").join("python.exe")
        } else {
            dir.join(venv).join("bin").join("python")
        };
        if py.is_file() {
            v.push(py.to_string_lossy().into_owned());
        }
    }
    if cfg!(windows) {
        v.push("python".into());
        v.push("py".into());
    } else {
        v.push("python3".into());
        v.push("python".into());
    }
    v
}

fn sidecar_hf_env(
    model_cache_dir: &Path,
    profile: &RuntimeDependencySourceProfile,
) -> Vec<(String, String)> {
    let mut env = vec![(
        "HF_HOME".into(),
        model_cache_dir.to_string_lossy().into_owned(),
    )];
    if let Some(endpoint) = profile
        .huggingface_endpoint
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        env.push(("HF_ENDPOINT".into(), endpoint.to_string()));
    }
    env
}

fn sidecar_runtime_env(
    app: &AppHandle,
    settings: &AppSettings,
) -> Result<Vec<(String, String)>, String> {
    ensure_runtime_deps_writable_or_elevate(app)?;
    let model_cache = managed_model_cache_dir(app)?;
    fs::create_dir_all(&model_cache).map_err(|e| e.to_string())?;
    let profile = effective_source_profile(settings)?;
    Ok(sidecar_hf_env(&model_cache, &profile))
}

fn sidecar_env_matches(current: &[(String, String)], desired: &[(String, String)]) -> bool {
    current.len() == desired.len()
        && desired.iter().all(|(key, value)| {
            current
                .iter()
                .any(|(current_key, current_value)| current_key == key && current_value == value)
        })
}

fn is_interpreter_missing_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("program not found")
        || message.contains("系统找不到指定的文件")
        || lower.contains("no such file or directory")
        || lower.contains("cannot find the file")
}

fn is_dependency_spawn_error(message: &str) -> bool {
    message.contains("sidecar 未输出就绪端口")
        || message.contains("请检查 Python 依赖是否已安装")
        || message.contains("ModuleNotFoundError")
        || message.contains("No module named")
}

/// 多候选 sidecar 启动失败时，优先返回依赖语义错误，避免被末尾 `py` 找不到盖住。
fn select_sidecar_spawn_error(errors: &[String]) -> String {
    if errors.is_empty() {
        return "无可用的 Python 解释器".into();
    }
    if let Some(message) = errors
        .iter()
        .rev()
        .find(|message| is_dependency_spawn_error(message))
    {
        return (*message).clone();
    }
    if errors
        .iter()
        .all(|message| is_interpreter_missing_error(message))
    {
        return "未找到可用的 Python 3.11。请安装系统 Python 3.11，或先配置 ASR 引擎依赖。".into();
    }
    errors
        .last()
        .cloned()
        .unwrap_or_else(|| "无可用的 Python 解释器".into())
}

/// 启动 sidecar 并阻塞读取其就绪端口；成功后保留进程并持续排空 stdout。
fn spawn_sidecar(python: &str, dir: &Path, env: &[(String, String)]) -> Result<Sidecar, String> {
    let debug_log_path = dir.join("asr-debug.log");
    eprintln!(
        "[asr] spawning sidecar python={python} dir={} debug_log={}",
        dir.display(),
        debug_log_path.display()
    );
    let mut command = hidden_command(python);
    command
        .args(["main.py", "--host", "127.0.0.1", "--port", "0"])
        .current_dir(dir)
        .env("HIKARU_ASR_DEBUG_LOG", &debug_log_path)
        .env("HIKARU_ASR_DEBUG_DETAIL", "1")
        .env_remove("HF_ENDPOINT")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    for (key, value) in env {
        command.env(key, value);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 sidecar 失败（{python}）：{e}"))?;
    let pid = child.id();
    eprintln!("[asr] sidecar spawned pid={pid}");

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 sidecar 输出".to_string())?;
    let mut reader = BufReader::new(stdout);

    let mut base_url = None;
    let mut line = String::new();
    for _ in 0..20 {
        line.clear();
        let n = reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if n == 0 {
            break; // EOF：进程提前退出
        }
        if let Ok(ready) = serde_json::from_str::<ReadyLine>(line.trim()) {
            if ready.event == "ready" {
                base_url = Some(format!("http://127.0.0.1:{}", ready.port));
                break;
            }
        }
    }

    let base_url = match base_url {
        Some(url) => url,
        None => {
            terminate_process_tree(pid);
            let _ = child.wait();
            return Err("sidecar 未输出就绪端口（请检查 Python 依赖是否已安装）".into());
        }
    };
    eprintln!("[asr] sidecar ready pid={pid} base_url={base_url}");

    // 持续排空剩余 stdout，避免管道写满阻塞子进程
    std::thread::spawn(move || {
        let mut sink = [0u8; 1024];
        loop {
            match reader.read(&mut sink) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });

    Ok(Sidecar {
        base_url,
        child,
        pid,
        env: env.to_vec(),
    })
}

/// 确保 sidecar 在运行并返回其 base_url（必要时拉起新进程）。
async fn ensure_base_url(app: &AppHandle, state: &AsrState) -> Result<String, String> {
    let settings = load_settings(app).unwrap_or_default();
    let dir = resolve_service_dir(app, &settings)?;
    let pythons = python_candidates(&settings, &dir);
    let env = sidecar_runtime_env(app, &settings)?;
    let mut guard = state.sidecar.lock().await;

    let stale_sidecar = if let Some(sc) = guard.as_mut() {
        match sc.child.try_wait() {
            Ok(None) if sidecar_env_matches(&sc.env, &env) => {
                return Ok(sc.base_url.clone());
            }
            Ok(None) => {
                eprintln!(
                    "[asr] restarting sidecar because runtime env changed pid={} base_url={}",
                    sc.pid, sc.base_url
                );
                guard.take()
            }
            Ok(Some(status)) => {
                eprintln!(
                    "[asr] sidecar exited pid={} base_url={} status={status}",
                    sc.pid, sc.base_url
                );
                guard.take()
            }
            Err(err) => {
                eprintln!(
                    "[asr] failed to inspect sidecar pid={} base_url={} error={err}",
                    sc.pid, sc.base_url
                );
                guard.take()
            }
        }
    } else {
        None
    };
    if let Some(mut sidecar) = stale_sidecar {
        tauri::async_runtime::spawn_blocking(move || sidecar.kill())
            .await
            .map_err(|error| format!("终止旧 sidecar 失败：{error}"))?;
    }

    let sidecar = tauri::async_runtime::spawn_blocking(move || {
        let mut errors = Vec::new();
        for py in pythons {
            match spawn_sidecar(&py, &dir, &env) {
                Ok(sc) => return Ok(sc),
                Err(e) => errors.push(e),
            }
        }
        Err(select_sidecar_spawn_error(&errors))
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))??;

    let base = sidecar.base_url.clone();
    *guard = Some(sidecar);
    Ok(base)
}

pub async fn stop_sidecar(state: &AsrState) {
    let sidecar = state.sidecar.lock().await.take();
    if let Some(mut sidecar) = sidecar {
        let _ = tauri::async_runtime::spawn_blocking(move || sidecar.kill()).await;
    }
}

async fn remember_job_base_url(state: &AsrState, job_id: &str, base_url: &str) {
    state
        .job_base_urls
        .lock()
        .await
        .insert(job_id.to_string(), base_url.to_string());
}

async fn known_job_base_url(state: &AsrState, job_id: &str) -> Option<String> {
    state.job_base_urls.lock().await.get(job_id).cloned()
}

fn recovery_snapshot_path_for_audio(audio_path: &str, job_id: &str) -> Option<PathBuf> {
    Path::new(audio_path)
        .parent()
        .map(|parent| parent.join("asr-jobs").join(format!("{job_id}.json")))
}

async fn remember_job_recovery_path(state: &AsrState, job_id: &str, audio_path: &str) {
    if let Some(path) = recovery_snapshot_path_for_audio(audio_path, job_id) {
        state
            .job_recovery_paths
            .lock()
            .await
            .insert(job_id.to_string(), path);
    }
}

async fn known_job_recovery_path(state: &AsrState, job_id: &str) -> Option<PathBuf> {
    state.job_recovery_paths.lock().await.get(job_id).cloned()
}

fn read_recovery_snapshot(
    path: &Path,
    job_id: &str,
    include_segments: bool,
) -> Result<Option<serde_json::Value>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)
        .map_err(|e| format!("读取 ASR 恢复结果失败（{}）：{e}", path.display()))?;
    let mut value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("解析 ASR 恢复结果失败（{}）：{e}", path.display()))?;
    let recovered_id = value.get("id").and_then(|x| x.as_str());
    if recovered_id != Some(job_id) {
        return Ok(None);
    }
    if !include_segments {
        if let Some(obj) = value.as_object_mut() {
            obj.remove("segments");
        }
    }
    Ok(Some(value))
}

fn try_recover_job_snapshot(
    recovery_path: Option<&Path>,
    job_id: &str,
    include_segments: bool,
) -> Result<Option<serde_json::Value>, String> {
    let Some(path) = recovery_path else {
        return Ok(None);
    };
    let snapshot = read_recovery_snapshot(path, job_id, include_segments)?;
    if snapshot.is_some() {
        eprintln!(
            "[asr] recovered job snapshot job_id={job_id} recovery_path={}",
            path.display()
        );
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn list_asr_engines(
    app: AppHandle,
    state: State<'_, AsrState>,
) -> Result<serde_json::Value, String> {
    if state.route_policy.uses_native() {
        let engines = known_native_asr_engines()
            .into_iter()
            .map(|name| {
                let available = name == "faster-whisper";
                serde_json::json!({
                    "name": name,
                    "available": available,
                    "backend": available.then_some("ctranslate2"),
                    "device": available.then_some("cpu"),
                    "reason": (!available).then_some("该引擎将在后续版本支持"),
                })
            })
            .collect::<Vec<_>>();
        return Ok(serde_json::json!({ "engines": engines }));
    }

    let base = ensure_base_url(&app, &state).await?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{base}/engines"))
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_asr(
    app: AppHandle,
    state: State<'_, AsrState>,
    args: StartAsrArgs,
) -> Result<String, String> {
    validate_start_asr_args(&args)?;
    let reservation = state.active_job.reserve()?;

    if state.route_policy.uses_native() {
        #[cfg(debug_assertions)]
        if std::env::var_os("HIKARU_ASR_FAKE_WORKER").is_some() {
            let host = packaged_native_host(&app, &state).await?;
            let cache_root = work_cache_dir(&app)?;
            let job_id = native_job_id();
            let launch = tauri::async_runtime::spawn_blocking(move || {
                resolve_debug_native_launch(args, job_id, cache_root)
            })
            .await
            .map_err(|error| format!("解析 native ASR 启动参数失败：{error}"))??;
            return tauri::async_runtime::spawn_blocking(move || host.start(launch, reservation))
                .await
                .map_err(|error| format!("启动 native ASR 任务失败：{error}"))?;
        }

        validate_native_mvp_request(&args)?;
        let status = state
            .native_models
            .status(&app, &args.engine, &args.model)
            .await?;
        let model_path = match status.disposition {
            NativeAsrModelDisposition::Ready => status
                .resolved_path
                .ok_or_else(|| "Native ASR 模型状态缺少已解析路径".to_string())?,
            NativeAsrModelDisposition::SupportedMissing => {
                return Err("Native ASR 模型尚未下载".into())
            }
            NativeAsrModelDisposition::PostMvpUnavailable => {
                return Err("该模型将在后续版本支持".into())
            }
            NativeAsrModelDisposition::Unsupported => {
                return Err("当前 Native MVP 不支持该引擎或模型".into())
            }
        };
        let host = packaged_native_host(&app, &state).await?;
        let cache_root = work_cache_dir(&app)?;
        let job_id = native_job_id();
        let launch = tauri::async_runtime::spawn_blocking(move || {
            ResolvedNativeLaunch::resolve(
                job_id,
                args.engine,
                vec![("model".into(), model_path)],
                "cpu".into(),
                args.language.unwrap_or_else(|| "ja".into()),
                PathBuf::from(args.audio_path),
                PathBuf::from(
                    args.output_ass_path
                        .expect("outputAssPath was validated before native resolution"),
                ),
                &cache_root,
                args.use_vad,
                args.vad_config,
            )
        })
        .await
        .map_err(|error| format!("解析 native ASR 启动参数失败：{error}"))??;
        return tauri::async_runtime::spawn_blocking(move || host.start(launch, reservation))
            .await
            .map_err(|error| format!("启动 native ASR 任务失败：{error}"))?;
    }

    let base = ensure_base_url(&app, &state).await?;
    let audio_path = args.audio_path.clone();
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "audioPath": args.audio_path,
        "engine": args.engine,
        "model": args.model,
        "device": args.device,
        "language": args.language,
        "outputAssPath": args.output_ass_path,
        "useVad": args.use_vad,
        "vadConfig": args.vad_config,
    });
    let resp = client
        .post(format!("{base}/transcribe"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("转录请求失败：HTTP {}", resp.status().as_u16()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let job_id = v
        .get("jobId")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "sidecar 响应缺少 jobId".to_string())?;
    remember_job_base_url(&state, &job_id, &base).await;
    remember_job_recovery_path(&state, &job_id, &audio_path).await;
    reservation.activate(&job_id)?;
    eprintln!("[asr] start_asr job_id={job_id} base_url={base}");
    Ok(job_id)
}

fn snapshot_is_terminal(snapshot: &serde_json::Value) -> bool {
    matches!(
        snapshot.get("status").and_then(|value| value.as_str()),
        Some("completed" | "failed" | "cancelled")
    )
}

fn release_legacy_slot_if_terminal(
    active_job: &ActiveJobGate,
    job_id: &str,
    snapshot: &serde_json::Value,
) {
    if snapshot_is_terminal(snapshot) {
        active_job.release(job_id);
    }
}

#[tauri::command]
pub async fn get_asr_progress(
    app: AppHandle,
    state: State<'_, AsrState>,
    job_id: String,
    include_segments: Option<bool>,
) -> Result<serde_json::Value, String> {
    let seg = include_segments.unwrap_or(true);
    if let Some(host) = state.native_host()? {
        if let Some(snapshot) = host.snapshot(&job_id, seg)? {
            return Ok(snapshot);
        }
    }

    let known_base = known_job_base_url(&state, &job_id).await;
    if state.route_policy.uses_native() && known_base.is_none() {
        return Err(format!("转录任务不存在（jobId={job_id}）"));
    }
    let base = match known_base {
        Some(url) => url,
        None => ensure_base_url(&app, &state).await?,
    };
    let client = reqwest::Client::new();
    let recovery_path = known_job_recovery_path(&state, &job_id).await;
    let resp = match client
        .get(format!("{base}/jobs/{job_id}"))
        .query(&[("segments", if seg { "true" } else { "false" })])
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            if let Some(snapshot) =
                try_recover_job_snapshot(recovery_path.as_deref(), &job_id, seg)?
            {
                release_legacy_slot_if_terminal(&state.active_job, &job_id, &snapshot);
                return Ok(snapshot);
            }
            return Err(format!(
                "无法连接 sidecar（jobId={job_id}, sidecar={base}）：{e}"
            ));
        }
    };
    if resp.status().as_u16() == 404 {
        if let Some(snapshot) = try_recover_job_snapshot(recovery_path.as_deref(), &job_id, seg)? {
            release_legacy_slot_if_terminal(&state.active_job, &job_id, &snapshot);
            return Ok(snapshot);
        }
        return Err(format!("转录任务不存在（jobId={job_id}, sidecar={base}）"));
    }
    let snapshot = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;
    release_legacy_slot_if_terminal(&state.active_job, &job_id, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn check_asr_model(
    app: AppHandle,
    state: State<'_, AsrState>,
    engine: String,
    model: String,
) -> Result<serde_json::Value, String> {
    if state.route_policy.uses_native() {
        let status = state.native_models.status(&app, &engine, &model).await?;
        return serde_json::to_value(public_asr_model_status(status)).map_err(|e| e.to_string());
    }

    let base = ensure_base_url(&app, &state).await?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{base}/models/status"))
        .query(&[("engine", engine.as_str()), ("model", model.as_str())])
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_asr_model(
    app: AppHandle,
    state: State<'_, AsrState>,
    engine: String,
    model: String,
) -> Result<String, String> {
    if state.route_policy.uses_native() {
        return state
            .native_models
            .start_download(&app, &engine, &model)
            .await;
    }

    let base = ensure_base_url(&app, &state).await?;
    let client = reqwest::Client::new();
    let body = serde_json::json!({ "engine": engine, "model": model });
    let resp = client
        .post(format!("{base}/models/download"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载请求失败：HTTP {}", resp.status().as_u16()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let job_id = v
        .get("jobId")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "sidecar 响应缺少 jobId".to_string())?;
    remember_job_base_url(&state, &job_id, &base).await;
    Ok(job_id)
}

#[tauri::command]
pub async fn get_model_download_progress(
    app: AppHandle,
    state: State<'_, AsrState>,
    job_id: String,
) -> Result<serde_json::Value, String> {
    if state.route_policy.uses_native() {
        let snapshot = state
            .native_models
            .job_snapshot(&job_id)
            .await
            .ok_or_else(|| "下载任务不存在".to_string())?;
        return serde_json::to_value(public_model_download_snapshot(snapshot))
            .map_err(|e| e.to_string());
    }

    let base = match known_job_base_url(&state, &job_id).await {
        Some(url) => url,
        None => ensure_base_url(&app, &state).await?,
    };
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{base}/models/download/{job_id}"))
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    if resp.status().as_u16() == 404 {
        return Err("下载任务不存在".into());
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_asr(
    app: AppHandle,
    state: State<'_, AsrState>,
    job_id: String,
) -> Result<(), String> {
    if let Some(host) = state
        .native_host()?
        .filter(|host| host.contains_job(&job_id))
    {
        return tauri::async_runtime::spawn_blocking(move || host.cancel(&job_id))
            .await
            .map_err(|error| format!("取消 native ASR 任务失败：{error}"))?;
    }

    let known_base = known_job_base_url(&state, &job_id).await;
    if state.route_policy.uses_native() && known_base.is_none() {
        return Err(format!("转录任务不存在（jobId={job_id}）"));
    }
    let base = match known_base {
        Some(url) => url,
        None => ensure_base_url(&app, &state).await?,
    };
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base}/jobs/{job_id}/cancel"))
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar（jobId={job_id}, sidecar={base}）：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("取消失败：HTTP {}", resp.status().as_u16()));
    }
    state.active_job.release(&job_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("hikaru_sub_{name}_{unique}"))
    }

    #[cfg(windows)]
    fn fake_worker_process_count(worker: &Path) -> usize {
        let name = worker.file_name().unwrap().to_string_lossy();
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

    #[test]
    fn recovery_snapshot_path_uses_audio_cache_workspace() {
        let path = recovery_snapshot_path_for_audio(
            &Path::new("cache")
                .join("workspace")
                .join("abc")
                .join("audio.wav")
                .to_string_lossy(),
            "job-123",
        )
        .unwrap();

        assert!(path.ends_with(
            Path::new("workspace")
                .join("abc")
                .join("asr-jobs")
                .join("job-123.json")
        ));
    }

    #[test]
    fn start_asr_args_require_output_ass_path() {
        let args = StartAsrArgs {
            audio_path: "cache/workspace/abc/audio.wav".into(),
            engine: "faster-whisper".into(),
            model: "large-v3".into(),
            device: "auto".into(),
            language: Some("ja".into()),
            output_ass_path: None,
            use_vad: false,
            vad_config: None,
        };

        let err = validate_start_asr_args(&args).unwrap_err();

        assert!(err.contains("缺少转录字幕输出路径"));
    }

    #[test]
    fn one_route_policy_controls_the_complete_backend_family() {
        assert!(!default_route_policy(false).uses_native());
        assert!(default_route_policy(true).uses_native());
        assert!(AsrRoutePolicy::NativeMvp.uses_native());
        assert!(!AsrRoutePolicy::Legacy.uses_native());
    }

    #[test]
    fn native_mvp_request_accepts_auto_cpu_and_rejects_unsupported_routes() {
        let args = |device: &str, use_vad: bool| StartAsrArgs {
            audio_path: "cache/workspace/abc/audio.wav".into(),
            engine: "faster-whisper".into(),
            model: "large-v3".into(),
            device: device.into(),
            language: Some("ja".into()),
            output_ass_path: Some("output.ass".into()),
            use_vad,
            vad_config: None,
        };
        assert!(validate_native_mvp_request(&args("auto", false)).is_ok());
        assert!(validate_native_mvp_request(&args("cpu", false)).is_ok());
        assert!(validate_native_mvp_request(&args("cuda", false))
            .unwrap_err()
            .contains("仅支持 auto/cpu"));
        assert!(validate_native_mvp_request(&args("cpu", true))
            .unwrap_err()
            .contains("vad_not_built"));

        let mut unsupported = args("cpu", false);
        unsupported.model = "large-v3-turbo".into();
        assert!(validate_native_mvp_request(&unsupported)
            .unwrap_err()
            .contains("仅支持 faster-whisper/large-v3"));
    }

    #[test]
    fn native_model_status_mapper_preserves_booleans_and_typed_metadata() {
        let status = |disposition| NativeAsrModelStatus {
            engine: "faster-whisper".into(),
            model: "large-v3".into(),
            backend: Some("ctranslate2".into()),
            revision: Some("revision".into()),
            disposition,
            origin: None,
            resolved_path: None,
        };
        let ready = public_asr_model_status(status(NativeAsrModelDisposition::Ready));
        assert!(ready.available && ready.downloaded && ready.reason.is_none());

        let missing = public_asr_model_status(status(NativeAsrModelDisposition::SupportedMissing));
        assert!(missing.available && !missing.downloaded);
        assert!(missing.reason.unwrap().contains("下载"));

        let deferred =
            public_asr_model_status(status(NativeAsrModelDisposition::PostMvpUnavailable));
        assert!(!deferred.available && !deferred.downloaded);
        assert!(deferred.reason.unwrap().contains("后续"));

        let unsupported = public_asr_model_status(status(NativeAsrModelDisposition::Unsupported));
        assert!(!unsupported.available && !unsupported.downloaded);
        assert!(unsupported.reason.unwrap().contains("不支持"));
    }

    #[test]
    fn read_recovery_snapshot_strips_segments_when_not_requested() {
        let dir = temp_dir("asr_recovery");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("job.json");
        fs::write(
            &path,
            r#"{
              "id": "job-1",
              "status": "completed",
              "progress": 1.0,
              "durationMs": 1200,
              "processedMs": 1200,
              "segmentCount": 1,
              "detectedLanguage": "ja",
              "error": null,
              "segments": [{"startMs": 0, "endMs": 1200, "text": "こんにちは"}]
            }"#,
        )
        .unwrap();

        let without_segments = read_recovery_snapshot(&path, "job-1", false)
            .unwrap()
            .unwrap();
        assert!(without_segments.get("segments").is_none());
        assert_eq!(without_segments["status"], "completed");

        let with_segments = read_recovery_snapshot(&path, "job-1", true)
            .unwrap()
            .unwrap();
        assert_eq!(with_segments["segments"].as_array().unwrap().len(), 1);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sidecar_hf_env_points_to_managed_model_cache_and_endpoint() {
        let cache = PathBuf::from("deps").join("models").join("huggingface");
        let profile = crate::dependencies::RuntimeDependencySourceProfile {
            id: crate::dependencies::RuntimeDependencySourceId::China,
            label: "中国大陆镜像".into(),
            ffmpeg: None,
            python311: None,
            pip_index_url: None,
            pip_extra_index_urls: Vec::new(),
            pytorch_cpu_index_url: None,
            pytorch_cuda_index_url: None,
            pytorch_cpu_find_links_url: None,
            pytorch_cuda_find_links_url: None,
            huggingface_endpoint: Some("https://hf-mirror.com".into()),
        };

        let env = sidecar_hf_env(&cache, &profile);

        assert!(env.iter().any(|(key, value)| key == "HF_HOME"
            && (value.ends_with("models\\huggingface") || value.ends_with("models/huggingface"))));
        assert!(env
            .iter()
            .any(|(key, value)| key == "HF_ENDPOINT" && value == "https://hf-mirror.com"));
    }

    #[test]
    fn sidecar_env_detects_huggingface_endpoint_changes() {
        let old_env = vec![("HF_HOME".into(), "deps/models/huggingface".into())];
        let new_env = vec![
            ("HF_HOME".into(), "deps/models/huggingface".into()),
            ("HF_ENDPOINT".into(), "https://hf-mirror.com".into()),
        ];

        assert!(!sidecar_env_matches(&old_env, &new_env));
        assert!(sidecar_env_matches(&new_env, &new_env));
    }

    #[test]
    fn sidecar_spawn_error_prefers_dependency_failure_over_program_not_found() {
        let errors = [
            "sidecar 未输出就绪端口（请检查 Python 依赖是否已安装）".to_string(),
            "启动 sidecar 失败（python）：program not found".to_string(),
            "启动 sidecar 失败（py）：program not found".to_string(),
        ];

        let selected = select_sidecar_spawn_error(&errors);
        assert!(selected.contains("请检查 Python 依赖是否已安装"));
        assert!(!selected.contains("program not found"));
    }

    #[test]
    fn sidecar_spawn_error_reports_missing_python_when_all_interpreters_missing() {
        let errors = [
            "启动 sidecar 失败（python）：program not found".to_string(),
            "启动 sidecar 失败（py）：program not found".to_string(),
        ];

        assert_eq!(
            select_sidecar_spawn_error(&errors),
            "未找到可用的 Python 3.11。请安装系统 Python 3.11，或先配置 ASR 引擎依赖。"
        );
    }

    #[cfg(windows)]
    #[test]
    fn asr_state_shutdown_terminates_legacy_sidecar_process_tree() {
        let _guard = crate::asr_worker::FAKE_WORKER_TEST_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(worker) = std::env::var_os("HIKARU_ASR_FAKE_WORKER").map(PathBuf::from) else {
            eprintln!("HIKARU_ASR_FAKE_WORKER not set; skipping legacy sidecar shutdown test");
            return;
        };
        if !worker.is_file() {
            return;
        }
        let baseline = fake_worker_process_count(&worker);
        let mut child = hidden_command(&worker)
            .args(["--scenario", "child-process-hang"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(
                br#"{"protocolVersion":1,"jobId":"legacy-shutdown","engine":"faster-whisper","backend":"ctranslate2","modelPaths":[{"role":"model","path":"C:\\managed\\model"}],"audioPath":"C:\\workspace\\audio.wav","device":"cpu","language":"ja","useVad":false}
"#,
            )
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout);
        let mut ready = String::new();
        reader.read_line(&mut ready).unwrap();
        assert!(ready.contains("\"event\":\"ready\""));
        let deadline = Instant::now() + Duration::from_secs(2);
        while fake_worker_process_count(&worker) < baseline + 2 {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(20));
        }

        let active_job = Arc::new(ActiveJobGate::default());
        active_job
            .reserve()
            .unwrap()
            .activate("legacy-shutdown")
            .unwrap();
        let state = AsrState {
            sidecar: Mutex::new(Some(Sidecar {
                base_url: "http://127.0.0.1:1".into(),
                pid: child.id(),
                child,
                env: Vec::new(),
            })),
            job_base_urls: Mutex::new(HashMap::new()),
            job_recovery_paths: Mutex::new(HashMap::new()),
            active_job: Arc::clone(&active_job),
            route_policy: AsrRoutePolicy::Legacy,
            native_models: NativeAsrModelManager::default(),
            native_host: StdMutex::new(None),
        };
        state.shutdown();
        assert!(active_job.current().is_none());
        let deadline = Instant::now() + Duration::from_secs(1);
        while fake_worker_process_count(&worker) > baseline && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(fake_worker_process_count(&worker), baseline);
    }

    #[test]
    fn legacy_active_slot_release_rules_match_start_poll_cancel_recovery_and_shutdown() {
        let gate = Arc::new(ActiveJobGate::default());

        // HTTP start failure drops the unactivated reservation.
        drop(gate.reserve().unwrap());
        assert!(gate.current().is_none());

        gate.reserve().unwrap().activate("legacy-running").unwrap();
        release_legacy_slot_if_terminal(
            &gate,
            "legacy-running",
            &serde_json::json!({"status": "running"}),
        );
        assert_eq!(gate.current().as_deref(), Some("legacy-running"));

        // Ordinary connection errors do not call the release helper.
        assert_eq!(gate.current().as_deref(), Some("legacy-running"));

        // First terminal poll releases the slot.
        release_legacy_slot_if_terminal(
            &gate,
            "legacy-running",
            &serde_json::json!({"status": "completed"}),
        );
        assert!(gate.current().is_none());

        // A terminal recovery snapshot follows the same branch.
        gate.reserve().unwrap().activate("legacy-recovery").unwrap();
        release_legacy_slot_if_terminal(
            &gate,
            "legacy-recovery",
            &serde_json::json!({"status": "failed"}),
        );
        assert!(gate.current().is_none());

        // Successful legacy cancel and shutdown release explicitly.
        gate.reserve().unwrap().activate("legacy-cancel").unwrap();
        gate.release("legacy-cancel");
        assert!(gate.current().is_none());
        gate.reserve().unwrap().activate("legacy-shutdown").unwrap();
        gate.clear();
        assert!(gate.current().is_none());
    }
}
