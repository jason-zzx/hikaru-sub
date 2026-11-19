//! Native ASR commands and host lifecycle routing.

use crate::asr_models::{
    known_native_asr_engines, ModelDownloadSnapshot, NativeAsrModelDisposition,
    NativeAsrModelManager, NativeAsrModelOrigin, NativeAsrModelStatus, ResolvedNativeAsrModel,
};
use crate::asr_worker::{native_job_id, ActiveJobGate, NativeAsrHost, ResolvedNativeLaunch};
use crate::dependencies::{
    native_asr_cuda_capability, resolve_crispasr_runtime, resolve_native_asr_cpu_runtime,
    resolve_native_asr_cuda_runtime, work_cache_dir, ResolvedNativeAsrCpuRuntime,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, State};

/// 受 Tauri 托管的全局 ASR 状态。
pub struct AsrState {
    active_job: Arc<ActiveJobGate>,
    pub(crate) native_models: NativeAsrModelManager,
    native_hosts: StdMutex<HashMap<String, NativeAsrHost>>,
    #[cfg(debug_assertions)]
    debug_native_host_injected: bool,
}

impl Default for AsrState {
    fn default() -> Self {
        let active_job = Arc::new(ActiveJobGate::default());
        let debug_host = debug_native_host(Arc::clone(&active_job));
        #[cfg(debug_assertions)]
        let debug_native_host_injected = debug_host.is_some();
        let mut native_hosts = HashMap::new();
        if let Some(host) = debug_host {
            native_hosts.insert("debug".into(), host);
        }
        Self {
            active_job,
            native_models: NativeAsrModelManager::default(),
            native_hosts: StdMutex::new(native_hosts),
            #[cfg(debug_assertions)]
            debug_native_host_injected,
        }
    }
}

impl AsrState {
    pub(crate) fn has_active_job(&self) -> bool {
        self.active_job.has_active()
    }

    fn native_host(&self, key: &str) -> Result<Option<NativeAsrHost>, String> {
        self.native_hosts
            .lock()
            .map(|hosts| hosts.get(key).cloned())
            .map_err(|_| "native ASR host 状态已损坏".to_string())
    }

    fn all_native_hosts(&self) -> Result<Vec<NativeAsrHost>, String> {
        self.native_hosts
            .lock()
            .map(|hosts| hosts.values().cloned().collect())
            .map_err(|_| "native ASR host 状态已损坏".to_string())
    }

    fn install_native_host(
        &self,
        key: String,
        host: NativeAsrHost,
    ) -> Result<NativeAsrHost, String> {
        let mut hosts = self
            .native_hosts
            .lock()
            .map_err(|_| "native ASR host 状态已损坏".to_string())?;
        Ok(hosts.entry(key).or_insert(host).clone())
    }

    pub fn shutdown(&self) {
        if let Ok(hosts) = self.native_hosts.lock() {
            for host in hosts.values() {
                host.shutdown();
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequestedNativeDevice {
    Auto,
    Cpu,
    Cuda,
}

impl RequestedNativeDevice {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "auto" => Ok(Self::Auto),
            "cpu" => Ok(Self::Cpu),
            "cuda" => Ok(Self::Cuda),
            _ => Err(format!("当前 Native ASR 路线不支持设备：{value}")),
        }
    }
}

const AUTO_CUDA_FALLBACK_NOTICE: &str = "CUDA 启动前检查未通过，已改用 CPU 转录。";

struct ResolvedNativeExecution {
    host: NativeAsrHost,
    device: &'static str,
    notice: Option<String>,
    vad_cli_path: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAsrResult {
    job_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    notice: Option<String>,
}

fn prelaunch_fallback_notice(
    requested: RequestedNativeDevice,
    cuda_resolution_failed: bool,
) -> Option<String> {
    (requested == RequestedNativeDevice::Auto && cuda_resolution_failed)
        .then(|| AUTO_CUDA_FALLBACK_NOTICE.to_string())
}

pub(crate) fn cuda_host_environment(root: &Path) -> Result<Vec<(OsString, OsString)>, String> {
    let system_root =
        std::env::var_os("SystemRoot").ok_or_else(|| "无法解析 Windows SystemRoot".to_string())?;
    let path = std::env::join_paths([
        root.to_path_buf(),
        PathBuf::from(system_root).join("System32"),
    ])
    .map_err(|error| format!("无法构造 Native ASR CUDA 受限 PATH：{error}"))?;
    Ok(vec![(OsString::from("PATH"), path)])
}

fn select_native_runtime(
    backend: &str,
    engine: &str,
    requested: RequestedNativeDevice,
    mut resolve: impl FnMut(&str, &str) -> Result<ResolvedNativeAsrCpuRuntime, String>,
) -> Result<(ResolvedNativeAsrCpuRuntime, &'static str, Option<String>), String> {
    if !matches!(backend, "ctranslate2" | "crispasr") {
        return Err("Native ASR backend 不受支持".into());
    }
    let mut resolve_device = |device| {
        let runtime = resolve(backend, device)?;
        runtime.require_engine(engine)?;
        Ok(runtime)
    };
    if requested != RequestedNativeDevice::Cpu {
        match resolve_device("cuda") {
            Ok(runtime) => return Ok((runtime, "cuda", None)),
            Err(error) if requested == RequestedNativeDevice::Cuda => return Err(error),
            Err(_) => {
                return Ok((
                    resolve_device("cpu")?,
                    "cpu",
                    prelaunch_fallback_notice(requested, true),
                ))
            }
        }
    }
    Ok((resolve_device("cpu")?, "cpu", None))
}

fn resolve_optional_vad_cli(
    backend: &str,
    use_vad: bool,
    supports_vad: bool,
    resolve_cpu: impl FnOnce() -> Result<ResolvedNativeAsrCpuRuntime, String>,
) -> Result<Option<PathBuf>, String> {
    if backend != "ctranslate2" || !use_vad {
        return Ok(None);
    }
    if !supports_vad {
        return Err("[vad_not_built] 当前运行环境不支持 VAD 预处理".into());
    }
    resolve_cpu()?
        .vad_cli_path
        .map(Some)
        .ok_or_else(|| "[vad_not_built] 内置语音检测组件不支持独立语音检测".to_string())
}

fn native_host_key(backend: &str, artifact: &str, device: &str) -> String {
    format!("{backend}:{artifact}:{device}")
}

async fn resolve_native_execution(
    app: &AppHandle,
    state: &AsrState,
    backend: &str,
    engine: &str,
    requested: RequestedNativeDevice,
    use_vad: bool,
) -> Result<ResolvedNativeExecution, String> {
    let vad_app = app.clone();
    let app = app.clone();
    let selected_backend = backend.to_string();
    let selected_engine = engine.to_string();
    let (runtime, device, notice) = tauri::async_runtime::spawn_blocking(move || {
        select_native_runtime(
            &selected_backend,
            &selected_engine,
            requested,
            |backend, device| {
                match (backend, device) {
                    ("ctranslate2", "cpu") => resolve_native_asr_cpu_runtime(&app),
                    ("ctranslate2", "cuda") => {
                        resolve_native_asr_cuda_runtime(&app).map(|runtime| {
                            ResolvedNativeAsrCpuRuntime {
                                root: runtime.root,
                                worker: runtime.worker,
                                artifact_id: runtime.artifact_id,
                                supports_vad: runtime.supports_vad,
                                vad_cli_path: None,
                                // CT2 CUDA verification requires exactly these two engines.
                                engines: vec![
                                    "faster-whisper".into(),
                                    "kotoba-faster-whisper".into(),
                                ],
                            }
                        })
                    }
                    ("crispasr", device) => resolve_crispasr_runtime(&app, device),
                    _ => Err("Native ASR runtime 不受支持".into()),
                }
            },
        )
    })
    .await
    .map_err(|_| "解析 Native ASR 运行时失败".to_string())??;
    let supports_vad = runtime.supports_vad;
    let selected_backend = backend.to_string();
    let vad_cli_path = tauri::async_runtime::spawn_blocking(move || {
        resolve_optional_vad_cli(&selected_backend, use_vad, supports_vad, || {
            resolve_crispasr_runtime(&vad_app, "cpu")
        })
    })
    .await
    .map_err(|_| "解析 CPU VAD 运行时失败".to_string())??;
    let key = native_host_key(backend, &runtime.artifact_id, device);
    if let Some(host) = state.native_host(&key)? {
        return Ok(ResolvedNativeExecution {
            host,
            device,
            notice,
            vad_cli_path,
        });
    }
    let active_job = Arc::clone(&state.active_job);
    let host = if device == "cuda" || backend == "crispasr" {
        NativeAsrHost::new_with_environment(
            runtime.worker,
            Vec::new(),
            cuda_host_environment(&runtime.root)?,
            vec![
                OsString::from("CUDA_PATH"),
                OsString::from("CUDA_HOME"),
                OsString::from("CT2_CUDA_ALLOW_FP16"),
            ],
            active_job,
        )?
    } else {
        NativeAsrHost::new(runtime.worker, Vec::new(), active_job)?
    };
    Ok(ResolvedNativeExecution {
        host: state.install_native_host(key, host)?,
        device,
        notice,
        vad_cli_path,
    })
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

fn validate_native_request(args: &StartAsrArgs) -> Result<(), String> {
    RequestedNativeDevice::parse(&args.device)?;
    if matches!(
        args.engine.as_str(),
        "qwen3-asr" | "parakeet" | "reazonspeech-nemo"
    ) {
        if args.vad_config.is_some() {
            return Err("该模型使用固定默认 CPU VAD，不接受自定义配置".into());
        }
    } else if args.use_vad {
        crate::asr_worker::validate_optional_vad(args.vad_config.as_ref())?;
    }
    if args
        .language
        .as_deref()
        .is_some_and(|language| language != "ja")
    {
        return Err("当前 Native ASR CPU 路线仅支持日语源语言".into());
    }
    Ok(())
}

pub(crate) fn qualified_native_launch(
    args: StartAsrArgs,
    model: ResolvedNativeAsrModel,
    job_id: String,
    device: String,
    cache_root: PathBuf,
    vad_cli_path: Option<PathBuf>,
) -> Result<ResolvedNativeLaunch, String> {
    validate_native_request(&args)?;
    if model.logical_id != format!("{}/{}", args.engine, args.model)
        || model.backend
            != if matches!(
                args.engine.as_str(),
                "qwen3-asr" | "parakeet" | "reazonspeech-nemo"
            ) {
                "crispasr"
            } else {
                "ctranslate2"
            }
    {
        return Err("Native ASR 已验证模型与请求身份不一致".into());
    }
    let full_cli = matches!(
        args.engine.as_str(),
        "qwen3-asr" | "parakeet" | "reazonspeech-nemo"
    );
    let mut roles: Vec<_> = model.roles.iter().map(|(role, _)| role.as_str()).collect();
    roles.sort_unstable();
    if roles
        != match args.engine.as_str() {
            "qwen3-asr" => vec!["aligner", "model", "vad"],
            "parakeet" | "reazonspeech-nemo" => vec!["model", "vad"],
            _ if args.use_vad => vec!["model", "vad"],
            _ => vec!["model"],
        }
    {
        return Err("Native ASR 已验证模型角色不完整".into());
    }
    ResolvedNativeLaunch::resolve(
        job_id,
        args.engine,
        model.roles,
        device,
        args.language.unwrap_or_else(|| "ja".into()),
        PathBuf::from(args.audio_path),
        PathBuf::from(args.output_ass_path.ok_or("缺少转录字幕输出路径")?),
        &cache_root,
        full_cli || args.use_vad,
        if full_cli { None } else { args.vad_config },
        vad_cli_path,
    )
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
        None,
    )
}

fn public_cuda_capability(
    capability: crate::dependencies::NativeAsrCudaCapability,
) -> serde_json::Value {
    let mut value = serde_json::to_value(capability).unwrap_or_else(|_| {
        serde_json::json!({
            "available": false,
            "downloadRequired": false,
            "code": "cuda_capability_serialization_failed",
            "reason": "CUDA 能力状态序列化失败"
        })
    });
    if let Some(object) = value.as_object_mut() {
        object.insert("device".into(), serde_json::Value::String("cuda".into()));
    }
    value
}

fn optional_vad_capability(
    worker_supported: bool,
    cpu_export_available: bool,
) -> serde_json::Value {
    let reason = if !worker_supported {
        Some("当前运行环境不支持 VAD 预处理")
    } else if !cpu_export_available {
        Some("内置语音检测组件缺失或损坏")
    } else {
        None
    };
    serde_json::json!({"available":reason.is_none(), "reason":reason})
}

fn public_native_engine(
    name: String,
    supported: bool,
    backend: Option<String>,
    cpu_available: bool,
    cuda_capability: serde_json::Value,
) -> serde_json::Value {
    let available = supported && cpu_available;
    serde_json::json!({
        "name":name, "available":available, "backend":backend,
        "device":available.then_some("cpu"),
        "devices":supported.then(|| serde_json::json!([
            {"device":"cpu", "available":cpu_available,
                "reason":(!cpu_available).then_some("内置 CPU 运行依赖缺失或损坏")},
            cuda_capability
        ])),
        "reason":(!supported).then_some("该引擎将在后续版本支持")
            .or_else(|| (!cpu_available).then_some("内置 CPU 运行依赖缺失或损坏")),
    })
}

#[tauri::command]
pub async fn list_asr_engines(app: AppHandle) -> Result<serde_json::Value, String> {
    let probe_app = app.clone();
    let engines = tauri::async_runtime::spawn_blocking(move || {
        let cpu = resolve_native_asr_cpu_runtime(&probe_app);
        let cpu_available = cpu.is_ok();
        let cpu_vad = cpu.as_ref().is_ok_and(|runtime| runtime.supports_vad);
        let cuda = native_asr_cuda_capability(&probe_app);
        let cuda_vad = cuda.available && cuda.supports_vad;
        let cpu_export = (cpu_vad || cuda_vad)
            && resolve_crispasr_runtime(&probe_app, "cpu")
                .is_ok_and(|runtime| runtime.vad_cli_path.is_some());
        let cuda_capability = public_cuda_capability(cuda);
        let crispasr = crate::dependencies::crispasr_engine_capabilities(&probe_app);
        known_native_asr_engines()?
            .into_iter()
            .map(|(name, supported, backend)| {
                let (cpu, cuda) = if backend.as_deref() == Some("ctranslate2") {
                    (cpu_available, cuda_capability.clone())
                } else if supported && backend.as_deref() == Some("crispasr") {
                    crispasr
                        .get(&name)
                        .cloned()
                        .unwrap_or((false, serde_json::Value::Null))
                } else {
                    (false, serde_json::Value::Null)
                };
                let optional = backend.as_deref() == Some("ctranslate2");
                let mut value = public_native_engine(name, supported, backend, cpu, cuda);
                if optional {
                    if let Some(devices) = value["devices"].as_array_mut() {
                        devices[0]["optionalVad"] =
                            optional_vad_capability(cpu_vad, cpu_export);
                        devices[1]["optionalVad"] =
                            optional_vad_capability(cuda_vad, cpu_export);
                    }
                }
                Ok(value)
            })
            .collect::<Result<Vec<_>, String>>()
    })
    .await
    .map_err(|_| "探测 Native ASR 运行时失败".to_string())??;
    Ok(serde_json::json!({ "engines": engines }))
}

#[tauri::command]
pub async fn start_asr(
    app: AppHandle,
    state: State<'_, AsrState>,
    args: StartAsrArgs,
) -> Result<StartAsrResult, String> {
    validate_start_asr_args(&args)?;
    let reservation = state.active_job.reserve()?;

    #[cfg(debug_assertions)]
    if state.debug_native_host_injected
        && matches!(
            args.engine.as_str(),
            "faster-whisper" | "kotoba-faster-whisper"
        )
    {
        let host = state
            .native_host("debug")?
            .ok_or_else(|| "debug native ASR host 未安装".to_string())?;
        let cache_root = work_cache_dir(&app)?;
        let job_id = native_job_id();
        let launch = tauri::async_runtime::spawn_blocking(move || {
            resolve_debug_native_launch(args, job_id, cache_root)
        })
        .await
        .map_err(|error| format!("解析 native ASR 启动参数失败：{error}"))??;
        let job_id =
            tauri::async_runtime::spawn_blocking(move || host.start(launch, reservation))
                .await
                .map_err(|error| format!("启动 native ASR 任务失败：{error}"))??;
        return Ok(StartAsrResult {
            job_id,
            notice: None,
        });
    }

    validate_native_request(&args)?;
    let status = state
        .native_models
        .status(&app, &args.engine, &args.model, args.use_vad)
        .await?;
    match status.disposition {
        NativeAsrModelDisposition::Ready => {}
        NativeAsrModelDisposition::SupportedMissing => {
            return Err("Native ASR 模型尚未下载".into())
        }
        NativeAsrModelDisposition::PostMvpUnavailable => {
            return Err("该模型将在后续版本支持".into())
        }
        NativeAsrModelDisposition::Unsupported => {
            return Err("当前 Native ASR 路线不支持该引擎或模型".into())
        }
    };
    let model = state
        .native_models
        .resolve_ready_model(&app, &args.engine, &args.model, args.use_vad)
        .await?
        .ok_or_else(|| "Native ASR 模型或必需依赖不可用".to_string())?;
    let requested = RequestedNativeDevice::parse(&args.device)?;
    let execution = resolve_native_execution(
        &app,
        &state,
        &model.backend,
        &args.engine,
        requested,
        args.use_vad,
    )
    .await?;
    let ResolvedNativeExecution {
        host,
        device,
        notice,
        vad_cli_path,
    } = execution;
    let resolved_device = device.to_string();
    let cache_root = work_cache_dir(&app)?;
    let job_id = native_job_id();
    let launch = tauri::async_runtime::spawn_blocking(move || {
        qualified_native_launch(
            args,
            model,
            job_id,
            resolved_device,
            cache_root,
            vad_cli_path,
        )
    })
    .await
    .map_err(|error| format!("解析 native ASR 启动参数失败：{error}"))??;
    let job_id = tauri::async_runtime::spawn_blocking(move || host.start(launch, reservation))
        .await
        .map_err(|error| format!("启动 native ASR 任务失败：{error}"))??;
    Ok(StartAsrResult { job_id, notice })
}

#[tauri::command]
pub async fn get_asr_progress(
    state: State<'_, AsrState>,
    job_id: String,
    include_segments: Option<bool>,
) -> Result<serde_json::Value, String> {
    let seg = include_segments.unwrap_or(true);
    for host in state.all_native_hosts()? {
        if let Some(snapshot) = host.snapshot(&job_id, seg)? {
            return Ok(snapshot);
        }
    }
    Err(format!("转录任务不存在（jobId={job_id}）"))
}

#[tauri::command]
pub async fn check_asr_model(
    app: AppHandle,
    state: State<'_, AsrState>,
    engine: String,
    model: String,
    use_vad: Option<bool>,
) -> Result<serde_json::Value, String> {
    let status = state
        .native_models
        .status(&app, &engine, &model, use_vad.unwrap_or(false))
        .await?;
    serde_json::to_value(public_asr_model_status(status)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_asr_model(
    app: AppHandle,
    state: State<'_, AsrState>,
    engine: String,
    model: String,
    use_vad: Option<bool>,
) -> Result<String, String> {
    state
        .native_models
        .start_download(&app, &engine, &model, use_vad.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn get_model_download_progress(
    state: State<'_, AsrState>,
    job_id: String,
) -> Result<serde_json::Value, String> {
    let snapshot = state
        .native_models
        .job_snapshot(&job_id)
        .await
        .ok_or_else(|| "下载任务不存在".to_string())?;
    serde_json::to_value(public_model_download_snapshot(snapshot)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_asr(state: State<'_, AsrState>, job_id: String) -> Result<(), String> {
    if let Some(host) = state
        .all_native_hosts()?
        .into_iter()
        .find(|host| host.contains_job(&job_id))
    {
        return tauri::async_runtime::spawn_blocking(move || host.cancel(&job_id))
            .await
            .map_err(|error| format!("取消 native ASR 任务失败：{error}"))?;
    }
    Err(format!("转录任务不存在（jobId={job_id}）"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
    fn public_cuda_capability_always_carries_the_cuda_device_discriminator() {
        let value = public_cuda_capability(crate::dependencies::NativeAsrCudaCapability {
            supports_vad: false,
            available: false,
            download_required: true,
            code: Some("cuda_pack_missing".into()),
            reason: Some("CUDA 运行时尚未安装".into()),
            device_index: None,
            device_name: None,
            visible_device_count: None,
            compute_capability: None,
            compute_type: None,
            driver_version: None,
            support_evidence: None,
        });
        assert_eq!(value["device"], "cuda");
        assert_eq!(value["downloadRequired"], true);
    }

    #[test]
    fn auto_cuda_prelaunch_failure_projects_one_sanitized_notice() {
        let notice = prelaunch_fallback_notice(RequestedNativeDevice::Auto, true).unwrap();

        assert_eq!(notice, AUTO_CUDA_FALLBACK_NOTICE);
        assert!(!notice.contains("C:\\"));
        assert!(!notice.contains("cuda_pack_missing"));
    }

    #[test]
    fn explicit_and_successful_resolution_paths_project_no_notice() {
        assert!(prelaunch_fallback_notice(RequestedNativeDevice::Auto, false).is_none());
        assert!(prelaunch_fallback_notice(RequestedNativeDevice::Cpu, true).is_none());
        assert!(prelaunch_fallback_notice(RequestedNativeDevice::Cuda, true).is_none());
    }

    #[test]
    fn start_asr_result_uses_camel_case_and_omits_absent_notice() {
        let without_notice = serde_json::to_value(StartAsrResult {
            job_id: "job-cpu".into(),
            notice: None,
        })
        .unwrap();
        assert_eq!(without_notice, serde_json::json!({ "jobId": "job-cpu" }));

        let with_notice = serde_json::to_value(StartAsrResult {
            job_id: "job-auto-fallback".into(),
            notice: Some(AUTO_CUDA_FALLBACK_NOTICE.into()),
        })
        .unwrap();
        assert_eq!(with_notice["jobId"], "job-auto-fallback");
        assert_eq!(with_notice["notice"], AUTO_CUDA_FALLBACK_NOTICE);
    }

    #[test]
    fn selected_engine_is_authorized_before_host_cache_or_launch() {
        for engine in ["qwen3-asr", "parakeet", "reazonspeech-nemo"] {
            for requested in [
                RequestedNativeDevice::Cpu,
                RequestedNativeDevice::Cuda,
                RequestedNativeDevice::Auto,
            ] {
                for shared_cpu in [false, true] {
                    for shared_cuda in [false, true] {
                        let mut calls = Vec::new();
                        let result =
                            select_native_runtime("crispasr", engine, requested, |_, device| {
                                calls.push(device.to_string());
                                let shared = if device == "cpu" {
                                    shared_cpu
                                } else {
                                    shared_cuda
                                };
                                Ok(ResolvedNativeAsrCpuRuntime {
                                    supports_vad: false,
                                    vad_cli_path: None,
                                    root: PathBuf::from(device),
                                    worker: PathBuf::from("worker.exe"),
                                    artifact_id: format!(
                                        "{device}-{}",
                                        if shared { "shared" } else { "qwen" }
                                    ),
                                    engines: if shared {
                                        vec![
                                            "qwen3-asr".into(),
                                            "parakeet".into(),
                                            "reazonspeech-nemo".into(),
                                        ]
                                    } else {
                                        vec!["qwen3-asr".into()]
                                    },
                                })
                            });
                        let allowed = engine == "qwen3-asr"
                            || match requested {
                                RequestedNativeDevice::Cpu => shared_cpu,
                                RequestedNativeDevice::Cuda => shared_cuda,
                                RequestedNativeDevice::Auto => shared_cpu || shared_cuda,
                            };
                        assert_eq!(result.is_ok(), allowed);
                        if requested == RequestedNativeDevice::Cpu {
                            assert_eq!(calls, ["cpu"]);
                        }
                        if requested == RequestedNativeDevice::Cuda {
                            assert_eq!(calls, ["cuda"]);
                        }
                        if let Ok((runtime, _, _)) = result {
                            runtime.require_engine(engine).unwrap();
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn backend_device_selection_is_prelaunch_only_and_never_crosses_runtime_trees() {
        for backend in ["ctranslate2", "crispasr"] {
            for requested in [
                RequestedNativeDevice::Cpu,
                RequestedNativeDevice::Cuda,
                RequestedNativeDevice::Auto,
            ] {
                for cuda_ok in [false, true] {
                    for cpu_ok in [false, true] {
                        let mut calls = Vec::new();
                        let result = select_native_runtime(
                            backend,
                            "fixture-engine",
                            requested,
                            |selected, device| {
                                calls.push((selected.to_string(), device.to_string()));
                                if if device == "cuda" { cuda_ok } else { cpu_ok } {
                                    Ok(ResolvedNativeAsrCpuRuntime {
                                        supports_vad: false,
                                        vad_cli_path: None,
                                        root: PathBuf::from(format!("{selected}/{device}")),
                                        worker: PathBuf::from(format!(
                                            "{selected}/{device}/worker.exe"
                                        )),
                                        artifact_id: "same-artifact-test".into(),
                                        engines: vec!["fixture-engine".into()],
                                    })
                                } else {
                                    Err(format!("{selected}-{device}-unavailable"))
                                }
                            },
                        );
                        let expected = match requested {
                            RequestedNativeDevice::Cpu => vec!["cpu"],
                            RequestedNativeDevice::Cuda => vec!["cuda"],
                            RequestedNativeDevice::Auto if cuda_ok => vec!["cuda"],
                            _ => vec!["cuda", "cpu"],
                        };
                        assert_eq!(
                            calls,
                            expected
                                .iter()
                                .map(|device| (backend.to_string(), device.to_string()))
                                .collect::<Vec<_>>()
                        );
                        assert_eq!(
                            result.is_ok(),
                            match requested {
                                RequestedNativeDevice::Cpu => cpu_ok,
                                RequestedNativeDevice::Cuda => cuda_ok,
                                RequestedNativeDevice::Auto => cuda_ok || cpu_ok,
                            }
                        );
                        if let Ok((runtime, device, notice)) = result {
                            assert_eq!(runtime.root, PathBuf::from(format!("{backend}/{device}")));
                            assert_eq!(
                                notice.is_some(),
                                requested == RequestedNativeDevice::Auto && !cuda_ok
                            );
                        }
                    }
                }
            }
        }
        let keys: std::collections::HashSet<_> = ["ctranslate2", "crispasr"]
            .into_iter()
            .flat_map(|backend| {
                ["cpu", "cuda"].map(|device| native_host_key(backend, "same", device))
            })
            .collect();
        assert_eq!(keys.len(), 4);
        assert_ne!(
            native_host_key("crispasr", "one", "cpu"),
            native_host_key("crispasr", "two", "cpu")
        );
    }

    #[test]
    fn qualified_qwen_launch_consumes_explicit_roles_and_forces_default_cpu_vad() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("中文 缓存");
        let workspace = cache.join("workspace/job");
        fs::create_dir_all(&workspace).unwrap();
        let audio = workspace.join("audio.wav");
        fs::write(&audio, b"synthetic").unwrap();
        let model_root = dir.path().join("模型");
        fs::create_dir_all(&model_root).unwrap();
        let roles: Vec<_> = [
            ("model", "qwen3-asr-1.7b-q4_k.gguf"),
            ("aligner", "qwen3-forced-aligner-0.6b-q4_k.gguf"),
            ("vad", "ggml-silero-v6.2.0.bin"),
        ]
        .into_iter()
        .map(|(role, name)| {
            let path = model_root.join(name);
            fs::write(&path, b"synthetic").unwrap();
            (role.into(), path)
        })
        .collect();
        let model = ResolvedNativeAsrModel {
            logical_id: "qwen3-asr/Qwen/Qwen3-ASR-1.7B".into(),
            backend: "crispasr".into(),
            revision: "synthetic-pair".into(),
            path: model_root,
            roles,
            origin: NativeAsrModelOrigin::DirectInstall,
        };
        for device in ["cpu", "cuda"] {
            let args = || StartAsrArgs {
                audio_path: audio.to_string_lossy().into_owned(),
                engine: "qwen3-asr".into(),
                model: "Qwen/Qwen3-ASR-1.7B".into(),
                device: device.into(),
                language: None,
                output_ass_path: Some(dir.path().join("result.ass").to_string_lossy().into_owned()),
                use_vad: false,
                vad_config: None,
            };
            // The existing host constructor rejects full-CLI useVad=false; success
            // here proves the product adapter overrides the legacy frontend flag.
            assert!(qualified_native_launch(
                args(),
                model.clone(),
                "qualified-test".into(),
                device.into(),
                cache.clone(),
                None
            )
            .is_ok());
            let mut half = model.clone();
            half.roles.pop();
            assert!(qualified_native_launch(
                args(),
                half,
                "qualified-test".into(),
                device.into(),
                cache.clone(),
                None
            )
            .is_err());
            let mut wrong = model.clone();
            wrong.backend = "ctranslate2".into();
            assert!(qualified_native_launch(
                args(),
                wrong,
                "qualified-test".into(),
                device.into(),
                cache.clone(),
                None
            )
            .is_err());
            let mut custom = args();
            custom.vad_config =
                Some(serde_json::from_value(serde_json::json!({"threshold":0.5})).unwrap());
            assert!(qualified_native_launch(
                custom,
                model.clone(),
                "qualified-test".into(),
                device.into(),
                cache.clone(),
                None
            )
            .is_err());
            let mut language = args();
            language.language = Some("en".into());
            assert!(qualified_native_launch(
                language,
                model.clone(),
                "qualified-test".into(),
                device.into(),
                cache.clone(),
                None
            )
            .is_err());
        }
    }

    #[test]
    fn public_qwen_engine_and_combined_progress_keep_existing_ipc_contracts() {
        let qwen = known_native_asr_engines()
            .unwrap()
            .into_iter()
            .find(|(name, _, _)| name == "qwen3-asr")
            .unwrap();
        let value = public_native_engine(
            qwen.0,
            qwen.1,
            qwen.2,
            true,
            serde_json::json!({"available":true}),
        );
        assert_eq!(value["available"], true);
        assert_eq!(value["backend"], "crispasr");
        assert_eq!(value["devices"][0]["available"], true);
        assert_eq!(value["devices"][1]["available"], true);
        let snapshot = public_model_download_snapshot(ModelDownloadSnapshot {
            id: "combined-job".into(),
            engine: "qwen3-asr".into(),
            model: "Qwen/Qwen3-ASR-1.7B".into(),
            revision: "pair-two-sources".into(),
            status: crate::asr_models::ModelDownloadJobStatus::Running,
            progress: Some(0.99),
            downloaded_bytes: 2_019_916_416,
            total_bytes: 2_020_801_514,
            source_endpoint: "https://hf-mirror.com".into(),
            resolved_path: None,
            error: None,
        });
        let value = serde_json::to_value(snapshot).unwrap();
        assert_eq!(value["totalBytes"], 2_020_801_514_u64);
        assert_eq!(value["downloadedBytes"], 2_019_916_416_u64);
        assert_eq!(value["hfEndpoint"], "https://hf-mirror.com");
        assert_eq!(value["revision"], "pair-two-sources");
        assert_eq!(value["status"], "running");
        assert!(value["resolvedPath"].is_null());
    }

    #[test]
    fn optional_vad_is_independent_of_selected_asr_device_and_never_falls_back() {
        for requested in [
            RequestedNativeDevice::Cpu,
            RequestedNativeDevice::Cuda,
            RequestedNativeDevice::Auto,
        ] {
            for cuda_available in [false, true] {
                let mut devices = Vec::new();
                let selected = select_native_runtime(
                    "ctranslate2",
                    "faster-whisper",
                    requested,
                    |_, device| {
                        devices.push(device.to_string());
                        if device == "cuda" && !cuda_available {
                            return Err("unavailable".into());
                        }
                        Ok(ResolvedNativeAsrCpuRuntime {
                            root: PathBuf::new(),
                            worker: PathBuf::new(),
                            artifact_id: device.into(),
                            engines: vec!["faster-whisper".into()],
                            supports_vad: true,
                            vad_cli_path: None,
                        })
                    },
                );
                if requested == RequestedNativeDevice::Cuda && !cuda_available {
                    assert!(selected.is_err());
                    assert_eq!(devices, ["cuda"]);
                    continue;
                }
                let (runtime, device, _) = selected.unwrap();
                assert_eq!(
                    device,
                    if requested != RequestedNativeDevice::Cpu && cuda_available {
                        "cuda"
                    } else {
                        "cpu"
                    }
                );
                if requested == RequestedNativeDevice::Cpu {
                    assert_eq!(devices, ["cpu"]);
                }
                let cpu_runtime = |export: bool| ResolvedNativeAsrCpuRuntime {
                    root: PathBuf::from("cpu-root"),
                    worker: PathBuf::new(),
                    artifact_id: "cpu".into(),
                    engines: vec!["qwen3-asr".into()],
                    supports_vad: true,
                    vad_cli_path: export.then(|| PathBuf::from("cpu-root/crispasr.exe")),
                };
                assert!(
                    resolve_optional_vad_cli("ctranslate2", false, false, || panic!(
                        "off must not probe CPU VAD"
                    ))
                    .unwrap()
                    .is_none()
                );
                for backend in ["crispasr"] {
                    assert!(resolve_optional_vad_cli(backend, true, true, || panic!(
                        "mandatory route must not run outer VAD"
                    ))
                    .unwrap()
                    .is_none());
                }
                assert!(
                    resolve_optional_vad_cli("ctranslate2", true, false, || panic!(
                        "unsupported main worker"
                    ))
                    .is_err()
                );
                assert!(resolve_optional_vad_cli(
                    "ctranslate2",
                    true,
                    runtime.supports_vad,
                    || Ok(cpu_runtime(false))
                )
                .is_err());
                assert!(resolve_optional_vad_cli(
                    "ctranslate2",
                    true,
                    runtime.supports_vad,
                    || Err("missing".into())
                )
                .is_err());
                assert_eq!(
                    resolve_optional_vad_cli("ctranslate2", true, runtime.supports_vad, || Ok(
                        cpu_runtime(true)
                    ))
                    .unwrap(),
                    Some(PathBuf::from("cpu-root/crispasr.exe"))
                );
            }
        }
        for (worker, export) in [(false, false), (true, false), (false, true), (true, true)] {
            assert_eq!(
                optional_vad_capability(worker, export)["available"],
                worker && export
            );
        }
    }

    #[test]
    fn optional_vad_validates_only_enabled_supported_parameters() {
        for config in [
            serde_json::json!({}),
            serde_json::json!({"threshold":0,"minSilenceDurationMs":0}),
            serde_json::json!({"threshold":1,"minSilenceDurationMs":60000}),
        ] {
            let config = serde_json::from_value(config).unwrap();
            assert!(crate::asr_worker::validate_optional_vad(Some(&config)).is_ok());
        }
        for config in [
            serde_json::json!({"threshold":1.1}),
            serde_json::json!({"minSilenceDurationMs":60001}),
            serde_json::json!({"speechPadMs":0}),
            serde_json::json!({"minSpeechDurationMs":250}),
            serde_json::json!({"maxSegmentDurationMs":12000}),
        ] {
            let config = serde_json::from_value(config).unwrap();
            assert!(crate::asr_worker::validate_optional_vad(Some(&config)).is_err());
            assert!(crate::asr_worker::validate_vad(false, Some(&config)).is_ok());
        }
        let args: StartAsrArgs = serde_json::from_value(serde_json::json!({"audioPath":"audio", "engine":"faster-whisper", "model":"small", "device":"cpu"})).unwrap();
        assert!(!args.use_vad);
    }

    #[test]
    fn native_request_keeps_model_support_authoritative_in_the_manifest() {
        let args = |engine: &str, device: &str, use_vad: bool| StartAsrArgs {
            audio_path: "cache/workspace/abc/audio.wav".into(),
            engine: engine.into(),
            model: "manifest-owned-model".into(),
            device: device.into(),
            language: Some("ja".into()),
            output_ass_path: Some("output.ass".into()),
            use_vad,
            vad_config: None,
        };
        assert!(validate_native_request(&args("faster-whisper", "auto", false)).is_ok());
        assert!(validate_native_request(&args("kotoba-faster-whisper", "cpu", false)).is_ok());
        assert!(validate_native_request(&args("qwen3-asr", "cpu", false)).is_ok());
        assert!(validate_native_request(&args("faster-whisper", "cuda", false)).is_ok());
        assert!(validate_native_request(&args("faster-whisper", "vulkan", false)).is_err());
        assert!(validate_native_request(&args("kotoba-faster-whisper", "cpu", true)).is_ok());
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
}
