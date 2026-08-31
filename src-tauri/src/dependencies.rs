use crate::asr_models::{
    is_link_like, NativeAsrModelDisposition, NativeAsrModelOrigin, NativeAsrModelStatus,
};
use crate::process::hidden_command;
use crate::settings::{load_settings, AppSettings, RuntimeDependencySourceMode};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

const LOG_TAIL_LIMIT: usize = 200;
const MANIFEST_JSON: &str = include_str!("../resources/runtime-dependency-sources.json");
const NATIVE_ASR_CUDA_LOCK_JSON: &str =
    include_str!("../../native-asr/runtime/windows-x64-cuda-lock.json");
const NATIVE_ASR_CPU_ARTIFACT_ID: &str = "hikaru-asr-windows-x64-cpu-v3";
const NATIVE_ASR_CPU_RESOURCE_PATH: [&str; 3] = ["native-asr", "windows-x64", "cpu"];
const NATIVE_ASR_CPU_WORKER: &str = "hikaru-asr-worker.exe";
const NATIVE_ASR_CUDA_ARTIFACT_ID: &str = "hikaru-asr-windows-x64-cuda-v1";
const NATIVE_ASR_CUDA_REQUIRED_ENTRIES: &[&str] = &[
    NATIVE_ASR_CPU_WORKER,
    "ctranslate2.dll",
    "hikaru_asr_tokenizer.dll",
    "cublas64_12.dll",
    "cublasLt64_12.dll",
    "msvcp140.dll",
    "vcomp140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "cuda-fatbin.json",
    "licenses/NVIDIA-CUDA-Toolkit-12.9-License.txt",
    "licenses/NVIDIA-CUDA-Runtime.txt",
    "licenses/THIRD-PARTY-NOTICES.json",
    "runtime-manifest.json",
    "SHA256SUMS",
];
const NATIVE_ASR_CPU_REQUIRED_ENTRIES: &[&str] = &[
    NATIVE_ASR_CPU_WORKER,
    "ctranslate2.dll",
    "hikaru_asr_tokenizer.dll",
    "msvcp140.dll",
    "vcomp140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "runtime-manifest.json",
    "SHA256SUMS",
];

#[derive(Debug, Clone)]
pub(crate) struct ResolvedNativeAsrCpuRuntime {
    pub root: PathBuf,
    pub worker: PathBuf,
    pub artifact_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeAsrCudaProductLock {
    product_enablement_allowed: bool,
    publication_gate: NativeAsrCudaPublicationGate,
    artifact: NativeAsrCudaArtifactLock,
    #[serde(default)]
    local_qualification: Option<NativeAsrCudaLocalQualification>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeAsrCudaPublicationGate {
    external_stable_asset_published: bool,
    runtime_dependency_source_row_present: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeAsrCudaArtifactLock {
    id: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeAsrCudaLocalQualification {
    machine: NativeAsrCudaQualifiedMachine,
    model_backed_module_closure: NativeAsrCudaQualifiedModelRun,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeAsrCudaQualifiedMachine {
    device_index: i32,
    device_name: String,
    compute_capability: String,
    compute_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeAsrCudaQualifiedModelRun {
    ready_device: String,
    completed: bool,
    python_or_network_fallback: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedNativeAsrCudaRuntime {
    pub root: PathBuf,
    pub worker: PathBuf,
    pub artifact_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeAsrCudaCapability {
    pub available: bool,
    #[serde(default)]
    pub download_required: bool,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub device_index: Option<i32>,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default)]
    pub visible_device_count: Option<i32>,
    #[serde(default)]
    pub compute_capability: Option<String>,
    #[serde(default)]
    pub compute_type: Option<String>,
    #[serde(default)]
    pub driver_version: Option<i32>,
    #[serde(default)]
    pub support_evidence: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeAsrRuntimeManifest {
    schema_version: u32,
    artifact_id: String,
    platform: String,
    arch: String,
    protocol_version: u32,
    capabilities: NativeAsrCapabilities,
    files: Vec<NativeAsrRuntimeFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeAsrRuntimeFile {
    path: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeAsrCapabilities {
    backend: String,
    device: String,
    engines: Vec<String>,
    vad: bool,
    crispasr: bool,
    cuda: bool,
    vulkan: bool,
    models_bundled: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeDependencyKind {
    Ffmpeg,
    NativeAsrCpu,
    NativeAsrCuda,
    Python311,
    AsrVenv,
    AsrModels,
    Downloads,
    AppCache,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeDependencyStatus {
    Available,
    Missing,
    NeedsSetup,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeDependencyJobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeDependencySourceId {
    Official,
    China,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RuntimeDependencyArchive {
    #[serde(rename = "zip")]
    Zip,
    #[serde(rename = "tar.gz")]
    TarGz,
    #[serde(rename = "tar.xz")]
    TarXz,
    #[serde(rename = "windowsInstaller")]
    WindowsInstaller,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencyBinarySource {
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub archive: RuntimeDependencyArchive,
    #[serde(default)]
    pub strip_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencySourceProfile {
    pub id: RuntimeDependencySourceId,
    pub label: String,
    pub ffmpeg: Option<RuntimeDependencyBinarySource>,
    #[serde(default)]
    pub native_asr_cuda: Option<RuntimeDependencyBinarySource>,
    pub python311: Option<RuntimeDependencyBinarySource>,
    pub pip_index_url: Option<String>,
    #[serde(default)]
    pub pip_extra_index_urls: Vec<String>,
    pub pytorch_cpu_index_url: Option<String>,
    pub pytorch_cuda_index_url: Option<String>,
    pub pytorch_cpu_find_links_url: Option<String>,
    pub pytorch_cuda_find_links_url: Option<String>,
    pub huggingface_endpoint: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeDependencySourceManifest {
    schema_version: u32,
    platforms: HashMap<String, RuntimeDependencyPlatformSources>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeDependencyPlatformSources {
    official: RuntimeDependencySourceProfile,
    china: RuntimeDependencySourceProfile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencyItem {
    pub kind: RuntimeDependencyKind,
    pub status: RuntimeDependencyStatus,
    pub path: Option<String>,
    pub source: Option<String>,
    pub version: Option<String>,
    pub managed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_download_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencyProbe {
    pub items: Vec<RuntimeDependencyItem>,
    pub source_mode: RuntimeDependencySourceMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencyStorageItem {
    pub kind: RuntimeDependencyKind,
    pub path: Option<String>,
    pub managed: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencyStorage {
    pub items: Vec<RuntimeDependencyStorageItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRuntimeDependencyArgs {
    pub kind: RuntimeDependencyKind,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub profile: Option<crate::asr_setup::AsrSetupProfile>,
    #[serde(default)]
    pub recreate: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRuntimeDependencyArgs {
    pub kind: RuntimeDependencyKind,
    /// 清理应用缓存时保留该视频相关的 workspace / 代理转码缓存。
    #[serde(default)]
    pub preserve_video_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencySnapshot {
    pub id: String,
    pub kind: RuntimeDependencyKind,
    pub status: RuntimeDependencyJobStatus,
    pub stage: String,
    pub progress: Option<f64>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub resolved_path: Option<String>,
    pub log_tail: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PythonCommand {
    pub program: String,
    pub args: Vec<String>,
}

impl PythonCommand {
    pub fn display(&self) -> String {
        if self.args.is_empty() {
            self.program.clone()
        } else {
            format!("{} {}", self.program, self.args.join(" "))
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPython {
    pub command: String,
    pub version: String,
    pub source: String,
    pub managed: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResolvedFfmpegSource {
    Settings,
    System,
    Managed,
    Missing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedFfmpeg {
    pub ffmpeg: String,
    pub ffprobe: String,
    pub source: ResolvedFfmpegSource,
}

#[derive(Default)]
pub struct RuntimeDependencyState {
    jobs: Mutex<HashMap<String, Arc<StdMutex<RuntimeDependencyJob>>>>,
}

impl RuntimeDependencyState {
    async fn has_active_kind(&self, kind: RuntimeDependencyKind) -> bool {
        self.jobs.lock().await.values().any(|job| {
            job.lock()
                .map(|job| {
                    job.kind == kind
                        && matches!(
                            job.status,
                            RuntimeDependencyJobStatus::Pending
                                | RuntimeDependencyJobStatus::Running
                        )
                })
                .unwrap_or(true)
        })
    }

    pub fn shutdown(&self) {
        if let Ok(jobs) = self.jobs.try_lock() {
            for job in jobs.values() {
                if let Ok(mut guard) = job.lock() {
                    guard.cancel_requested = true;
                    if matches!(
                        guard.status,
                        RuntimeDependencyJobStatus::Pending | RuntimeDependencyJobStatus::Running
                    ) {
                        guard.status = RuntimeDependencyJobStatus::Cancelled;
                        guard.stage = "已取消".into();
                        guard.error = Some("用户已取消运行时依赖准备".into());
                    }
                }
            }
        }
    }
}

#[derive(Debug)]
struct RuntimeDependencyJob {
    id: String,
    kind: RuntimeDependencyKind,
    status: RuntimeDependencyJobStatus,
    stage: String,
    progress: Option<f64>,
    downloaded_bytes: u64,
    total_bytes: u64,
    resolved_path: Option<String>,
    log_tail: VecDeque<String>,
    error: Option<String>,
    cancel_requested: bool,
}

impl RuntimeDependencyJob {
    fn new(id: String, kind: RuntimeDependencyKind) -> Self {
        Self {
            id,
            kind,
            status: RuntimeDependencyJobStatus::Pending,
            stage: "等待开始".into(),
            progress: Some(0.0),
            downloaded_bytes: 0,
            total_bytes: 0,
            resolved_path: None,
            log_tail: VecDeque::new(),
            error: None,
            cancel_requested: false,
        }
    }

    fn snapshot(&self) -> RuntimeDependencySnapshot {
        RuntimeDependencySnapshot {
            id: self.id.clone(),
            kind: self.kind,
            status: self.status,
            stage: self.stage.clone(),
            progress: self.progress,
            downloaded_bytes: self.downloaded_bytes,
            total_bytes: self.total_bytes,
            resolved_path: self.resolved_path.clone(),
            log_tail: self.log_tail.iter().cloned().collect(),
            error: self.error.clone(),
        }
    }
}

fn deps_dir_from_exe(exe_path: &Path) -> Result<PathBuf, String> {
    let install_dir = exe_path
        .parent()
        .ok_or_else(|| format!("无法解析 Hikaru Sub 安装目录：{}", exe_path.display()))?;
    Ok(install_dir.join("deps"))
}

fn deps_dir_for_runtime(exe_path: &Path, _app_data_dir: Option<&Path>) -> Result<PathBuf, String> {
    deps_dir_from_exe(exe_path)
}

fn deps_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let app_data_dir = app.path().app_data_dir().ok();
    deps_dir_for_runtime(&exe, app_data_dir.as_deref())
}

fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("downloads"))
}

pub(crate) fn managed_downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    downloads_dir(app)
}

pub(crate) fn managed_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("models"))
}

pub(crate) fn managed_ctranslate2_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(managed_models_dir(app)?.join("ctranslate2"))
}

pub fn managed_ffmpeg_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("ffmpeg").join("current"))
}

fn managed_native_asr_cuda_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("asr-runtime").join("cuda"))
}

pub(crate) fn managed_native_asr_cuda_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(managed_native_asr_cuda_root(app)?.join("current"))
}

fn managed_native_asr_cuda_download_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(downloads_dir(app)?.join("native-asr-cuda"))
}

pub fn managed_python_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("python311").join("current"))
}

pub fn managed_asr_service_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("asr-service"))
}

/// 判断目录是否为源码仓库 checkout 根下的 `asr-service`（与 settings 启发式对齐）。
///
/// 必须等于 `repo/asr-service`，避免把仓库树内的 `resources/asr-service`、
/// `target/*/deps/asr-service` 等误判为源码服务目录。
pub fn is_source_checkout_asr_service_dir(service_dir: &Path) -> bool {
    if !service_dir.join("main.py").is_file() {
        return false;
    }
    service_dir.ancestors().any(|ancestor| {
        looks_like_repo_root(ancestor)
            && paths_loosely_equal(service_dir, &ancestor.join("asr-service"))
    })
}

fn paths_loosely_equal(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn looks_like_repo_root(dir: &Path) -> bool {
    dir.join("src-tauri").join("tauri.conf.json").is_file()
        && (dir.join("package.json").is_file() || dir.join("pnpm-workspace.yaml").is_file())
        && dir.join("asr-service").join("main.py").is_file()
}

/// 从起点向上查找仓库根；`cwd_hint` 可覆盖 `current_dir`（便于测试）。
pub fn find_source_checkout_root(exe_path: &Path, cwd_hint: Option<&Path>) -> Option<PathBuf> {
    let mut starts = Vec::new();
    if let Some(cwd) = cwd_hint {
        starts.push(cwd.to_path_buf());
    } else if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    starts.push(exe_path.to_path_buf());
    if let Some(parent) = exe_path.parent() {
        starts.push(parent.to_path_buf());
    }

    for start in starts {
        for ancestor in start.ancestors() {
            if looks_like_repo_root(ancestor) {
                return Some(ancestor.to_path_buf());
            }
        }
    }
    None
}

/// 解析当前应使用的 ASR 服务目录（纯函数，便于单测）。
///
/// 顺序：有效配置路径 →（prefer_source_checkout 时）仓库 `asr-service` → exe 旁 `deps/asr-service`。
pub fn resolve_effective_asr_service_dir(
    configured: Option<&str>,
    exe_path: &Path,
    prefer_source_checkout: bool,
    cwd_hint: Option<&Path>,
) -> Result<PathBuf, String> {
    if let Some(path) = configured.map(str::trim).filter(|s| !s.is_empty()) {
        let dir = PathBuf::from(path);
        if dir.join("main.py").is_file() {
            return Ok(dir);
        }
    }

    if prefer_source_checkout {
        if let Some(root) = find_source_checkout_root(exe_path, cwd_hint) {
            let service = root.join("asr-service");
            if service.join("main.py").is_file() {
                return Ok(service);
            }
        }
    }

    Ok(deps_dir_from_exe(exe_path)?.join("asr-service"))
}

/// 当前运行时有效的 ASR 服务目录（debug 优先仓库，release 用安装目录 deps）。
pub fn effective_asr_service_dir(
    _app: &AppHandle,
    configured: Option<&str>,
) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    resolve_effective_asr_service_dir(configured, &exe, cfg!(debug_assertions), None)
}

pub fn managed_model_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(managed_models_dir(app)?.join("huggingface"))
}

pub fn managed_asr_venv_python_path(service_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        service_dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        service_dir.join(".venv").join("bin").join("python")
    }
}

fn deps_writability_probe_path(deps_root: &Path) -> PathBuf {
    deps_root.join(format!("hikaru-sub-write-test-{}", unique_suffix()))
}

fn ensure_deps_writable(deps_root: &Path) -> Result<(), String> {
    fs::create_dir_all(deps_root)
        .map_err(|e| format!("运行时依赖目录不可写（{}）：{e}", deps_root.display()))?;
    let probe = deps_writability_probe_path(deps_root);
    let mut file = fs::File::create(&probe)
        .map_err(|e| format!("运行时依赖目录不可写（{}）：{e}", deps_root.display()))?;
    file.write_all(b"ok")
        .map_err(|e| format!("运行时依赖目录不可写（{}）：{e}", deps_root.display()))?;
    drop(file);
    let _ = fs::remove_file(&probe);
    Ok(())
}

fn elevation_powershell_command(exe: &Path) -> String {
    format!(
        "$env:HIKARU_SUB_ELEVATION_REQUESTED='1'; Start-Process -FilePath {} -Verb RunAs",
        powershell_quote(exe)
    )
}

#[cfg(windows)]
fn restart_elevated(exe: &Path) -> Result<(), String> {
    let command = elevation_powershell_command(exe);
    let status = hidden_command("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &command,
        ])
        .status()
        .map_err(|e| format!("无法请求管理员权限启动 Hikaru Sub：{e}"))?;
    if status.success() {
        std::process::exit(0);
    }
    Err(format!(
        "无法请求管理员权限启动 Hikaru Sub：退出码 {:?}",
        status.code()
    ))
}

#[cfg(not(windows))]
fn restart_elevated(_exe: &Path) -> Result<(), String> {
    Err("当前平台暂不支持自动请求管理员权限".into())
}

pub fn ensure_runtime_deps_writable_or_elevate(app: &AppHandle) -> Result<(), String> {
    let deps = deps_dir(app)?;
    match ensure_deps_writable(&deps) {
        Ok(()) => Ok(()),
        Err(error) => {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            if cfg!(windows) && std::env::var_os("HIKARU_SUB_ELEVATION_REQUESTED").is_none() {
                restart_elevated(&exe)?;
            }
            Err(format!(
                "{error}。请以管理员身份运行 Hikaru Sub，或重新安装到当前用户可写目录。"
            ))
        }
    }
}

fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

pub fn python_version(command: &PythonCommand) -> Result<String, String> {
    let output = hidden_command(&command.program)
        .args(&command.args)
        .args([
            "-c",
            "import sys; print('.'.join(map(str, sys.version_info[:3]))); raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)",
        ])
        .output()
        .map_err(|e| format!("无法启动 Python（{}）：{e}", command.display()))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        Ok(stdout)
    } else if stdout.is_empty() {
        Err(format!("不是可用的 Python 3.11：{}", command.display()))
    } else {
        Err(format!("不是 Python 3.11：{stdout}"))
    }
}

/// Python 3.11 候选：设置路径 → 系统 →（可选）额外解释器 →（可选）受管目录。
///
/// 开发环境通常传 `extra_python_exe`（`asr-service/.venv`），不传受管 `deps/python311`；
/// 发布版传受管目录，不传仓库 venv。
pub fn python311_candidates(
    settings: &AppSettings,
    managed_python: Option<&Path>,
    extra_python_exe: Option<&Path>,
) -> Vec<PythonCommand> {
    let mut candidates = Vec::new();
    if let Some(path) = settings
        .python_path
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        candidates.push(PythonCommand {
            program: path.into(),
            args: vec![],
        });
    }
    if cfg!(windows) {
        candidates.push(PythonCommand {
            program: "py".into(),
            args: vec!["-3.11".into()],
        });
        candidates.push(PythonCommand {
            program: "python".into(),
            args: vec![],
        });
        candidates.push(PythonCommand {
            program: "python3".into(),
            args: vec![],
        });
        candidates.push(PythonCommand {
            program: "python3.11".into(),
            args: vec![],
        });
    } else {
        candidates.push(PythonCommand {
            program: "python3.11".into(),
            args: vec![],
        });
        candidates.push(PythonCommand {
            program: "python3".into(),
            args: vec![],
        });
        candidates.push(PythonCommand {
            program: "python".into(),
            args: vec![],
        });
    }
    if let Some(exe) = extra_python_exe.filter(|path| path.is_file()) {
        candidates.push(PythonCommand {
            program: exe.to_string_lossy().into_owned(),
            args: vec![],
        });
    }
    if let Some(dir) = managed_python {
        if let Some(exe) = find_managed_python_executable(dir) {
            candidates.push(PythonCommand {
                program: exe.to_string_lossy().into_owned(),
                args: vec![],
            });
        }
    }
    candidates
}

/// 开发环境：系统之后回退到仓库 `asr-service/.venv`；发布版：回退到 `deps/python311`。
pub(crate) fn python311_lookup_fallbacks(
    app: &AppHandle,
    settings: &AppSettings,
) -> (Option<PathBuf>, Option<PathBuf>) {
    if cfg!(debug_assertions) {
        let venv = effective_asr_service_dir(app, settings.asr_service_path.as_deref())
            .ok()
            .map(|service| managed_asr_venv_python_path(&service));
        (None, venv)
    } else {
        (managed_python_dir(app).ok(), None)
    }
}

#[allow(dead_code)]
pub fn resolve_python311(app: &AppHandle, settings: &AppSettings) -> Option<ResolvedPython> {
    let (managed, venv_exe) = python311_lookup_fallbacks(app, settings);
    let settings_path = settings
        .python_path
        .as_deref()
        .filter(|s| !s.trim().is_empty());
    let venv_program = venv_exe
        .as_deref()
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned());
    python311_candidates(settings, managed.as_deref(), venv_exe.as_deref())
        .into_iter()
        .find_map(|candidate| {
            let version = python_version(&candidate).ok()?;
            let managed_path = managed.as_deref().is_some_and(|dir| {
                path_is_under(Path::new(&candidate.program), dir)
                    || Path::new(&candidate.program) == dir.join("python.exe")
            });
            let venv_path = venv_program
                .as_deref()
                .is_some_and(|path| path == candidate.program);
            let source = if settings_path == Some(candidate.program.as_str()) {
                "settings"
            } else if managed_path {
                "managed"
            } else if venv_path {
                "venv"
            } else {
                "system"
            };
            Some(ResolvedPython {
                command: candidate.display(),
                version,
                source: source.into(),
                managed: managed_path,
            })
        })
}

pub fn peer_ffprobe_path(ffmpeg_path: &str) -> String {
    if ffmpeg_path.ends_with("ffmpeg.exe") {
        ffmpeg_path.replace("ffmpeg.exe", "ffprobe.exe")
    } else if ffmpeg_path.ends_with("ffmpeg") {
        ffmpeg_path.replace("ffmpeg", "ffprobe")
    } else {
        exe_name("ffprobe")
    }
}

fn command_available(program: &str) -> bool {
    hidden_command(program)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn resolve_ffmpeg_paths(app: &AppHandle, settings: &AppSettings) -> ResolvedFfmpeg {
    if let Some(path) = settings
        .ffmpeg_path
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        return ResolvedFfmpeg {
            ffmpeg: path.into(),
            ffprobe: peer_ffprobe_path(path),
            source: ResolvedFfmpegSource::Settings,
        };
    }

    let system = exe_name("ffmpeg");
    if command_available(&system) {
        return ResolvedFfmpeg {
            ffmpeg: system,
            ffprobe: exe_name("ffprobe"),
            source: ResolvedFfmpegSource::System,
        };
    }

    if let Ok(dir) = managed_ffmpeg_dir(app) {
        let ffmpeg = dir.join(exe_name("ffmpeg"));
        let ffprobe = dir.join(exe_name("ffprobe"));
        if ffmpeg.is_file() && ffprobe.is_file() {
            return ResolvedFfmpeg {
                ffmpeg: ffmpeg.to_string_lossy().into_owned(),
                ffprobe: ffprobe.to_string_lossy().into_owned(),
                source: ResolvedFfmpegSource::Managed,
            };
        }
    }

    ResolvedFfmpeg {
        ffmpeg: system,
        ffprobe: exe_name("ffprobe"),
        source: ResolvedFfmpegSource::Missing,
    }
}

fn resolve_native_asr_cpu_runtime_at(
    resource_dir: &Path,
) -> Result<ResolvedNativeAsrCpuRuntime, String> {
    let root = NATIVE_ASR_CPU_RESOURCE_PATH
        .iter()
        .fold(resource_dir.to_path_buf(), |path, segment| {
            path.join(segment)
        });
    let manifest_path = root.join("runtime-manifest.json");
    let worker = root.join(NATIVE_ASR_CPU_WORKER);
    let missing = NATIVE_ASR_CPU_REQUIRED_ENTRIES
        .iter()
        .filter(|entry| !root.join(entry).is_file())
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!(
            "Native ASR CPU 运行时资源不完整（缺少 {}）：{}",
            missing.join(", "),
            root.display()
        ));
    }
    let manifest: NativeAsrRuntimeManifest = serde_json::from_slice(
        &fs::read(&manifest_path)
            .map_err(|error| format!("无法读取 Native ASR CPU 运行时清单：{error}"))?,
    )
    .map_err(|error| format!("Native ASR CPU 运行时清单无效：{error}"))?;
    let capability_ok = manifest.capabilities.backend == "ctranslate2"
        && manifest.capabilities.device == "cpu"
        && manifest.capabilities.engines == ["faster-whisper", "kotoba-faster-whisper"]
        && !manifest.capabilities.vad
        && !manifest.capabilities.crispasr
        && !manifest.capabilities.cuda
        && !manifest.capabilities.vulkan
        && !manifest.capabilities.models_bundled;
    if manifest.schema_version != 1
        || manifest.artifact_id != NATIVE_ASR_CPU_ARTIFACT_ID
        || manifest.platform != "windows-x64"
        || manifest.arch != "x64"
        || manifest.protocol_version != 1
        || !capability_ok
    {
        return Err("Native ASR CPU 运行时身份或能力与 MVP 契约不匹配".into());
    }
    Ok(ResolvedNativeAsrCpuRuntime {
        root,
        worker,
        artifact_id: manifest.artifact_id,
    })
}

pub(crate) fn resolve_native_asr_cpu_runtime(
    app: &AppHandle,
) -> Result<ResolvedNativeAsrCpuRuntime, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法解析应用资源目录：{error}"))?;
    resolve_native_asr_cpu_runtime_at(&resource_dir)
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn parse_runtime_checksums(root: &Path) -> Result<HashMap<String, String>, String> {
    let text = fs::read_to_string(root.join("SHA256SUMS"))
        .map_err(|error| format!("无法读取 Native ASR 运行时校验表：{error}"))?;
    let mut checksums = HashMap::new();
    for line in text.lines().filter(|line| !line.is_empty()) {
        let Some((sha256, path)) = line.split_once("  ") else {
            return Err("Native ASR 运行时校验表格式无效".into());
        };
        if !is_sha256(sha256)
            || checksums
                .insert(path.to_string(), sha256.to_string())
                .is_some()
        {
            return Err("Native ASR 运行时校验表包含无效或重复条目".into());
        }
    }
    Ok(checksums)
}

fn safe_runtime_relative_path(path: &str) -> bool {
    let value = Path::new(path);
    !value.is_absolute()
        && value
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn collect_runtime_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<String>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("无法读取 Native ASR CUDA 运行时目录：{error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if is_link_like(&metadata) {
            return Err(format!(
                "Native ASR CUDA 运行时禁止链接：{}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            collect_runtime_files(root, &path, files)?;
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if relative != "runtime-manifest.json" && relative != "SHA256SUMS" {
                files.push(relative);
            }
        } else {
            return Err(format!(
                "Native ASR CUDA 运行时包含不支持的条目：{}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn verify_native_asr_cuda_runtime_at(root: &Path) -> Result<(PathBuf, PathBuf, String), String> {
    let missing = NATIVE_ASR_CUDA_REQUIRED_ENTRIES
        .iter()
        .filter(|entry| !root.join(entry).is_file())
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!(
            "Native ASR CUDA 运行时不完整（缺少 {}）：{}",
            missing.join(", "),
            root.display()
        ));
    }
    let manifest: NativeAsrRuntimeManifest = serde_json::from_slice(
        &fs::read(root.join("runtime-manifest.json"))
            .map_err(|error| format!("无法读取 Native ASR CUDA 运行时清单：{error}"))?,
    )
    .map_err(|error| format!("Native ASR CUDA 运行时清单无效：{error}"))?;
    let capability_ok = manifest.capabilities.backend == "ctranslate2"
        && manifest.capabilities.device == "cuda"
        && manifest.capabilities.engines == ["faster-whisper", "kotoba-faster-whisper"]
        && !manifest.capabilities.vad
        && !manifest.capabilities.crispasr
        && manifest.capabilities.cuda
        && !manifest.capabilities.vulkan
        && !manifest.capabilities.models_bundled;
    if manifest.schema_version != 1
        || manifest.artifact_id != NATIVE_ASR_CUDA_ARTIFACT_ID
        || manifest.platform != "windows-x64"
        || manifest.arch != "x64"
        || manifest.protocol_version != 1
        || !capability_ok
    {
        return Err("Native ASR CUDA 运行时身份或能力与发布契约不匹配".into());
    }
    let checksums = parse_runtime_checksums(root)?;
    let manifest_paths = manifest
        .files
        .iter()
        .map(|row| row.path.clone())
        .collect::<HashSet<_>>();
    let mut actual_files = Vec::new();
    collect_runtime_files(root, root, &mut actual_files)?;
    if manifest.files.len() != checksums.len()
        || manifest_paths.len() != manifest.files.len()
        || actual_files.into_iter().collect::<HashSet<_>>() != manifest_paths
    {
        return Err("Native ASR CUDA 运行时文件闭集不匹配".into());
    }
    for row in &manifest.files {
        if !safe_runtime_relative_path(&row.path)
            || checksums.get(&row.path) != Some(&row.sha256)
            || !is_sha256(&row.sha256)
        {
            return Err(format!("Native ASR CUDA 运行时文件条目无效：{}", row.path));
        }
        let path = root.join(&row.path);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("无法检查 Native ASR CUDA 运行时文件：{error}"))?;
        if is_link_like(&metadata)
            || !metadata.is_file()
            || metadata.len() != row.size_bytes
            || sha256_file(&path)? != row.sha256
        {
            return Err(format!("Native ASR CUDA 运行时文件损坏：{}", row.path));
        }
    }
    let worker = root.join(NATIVE_ASR_CPU_WORKER);
    Ok((root.to_path_buf(), worker, manifest.artifact_id))
}

fn cuda_restricted_path(root: &Path) -> Result<std::ffi::OsString, String> {
    let system_root =
        std::env::var_os("SystemRoot").ok_or_else(|| "无法解析 Windows SystemRoot".to_string())?;
    std::env::join_paths([
        root.to_path_buf(),
        PathBuf::from(system_root).join("System32"),
    ])
    .map_err(|error| format!("无法构造 Native ASR CUDA 受限 PATH：{error}"))
}

fn probe_native_asr_cuda_worker(
    root: &Path,
    worker: &Path,
) -> Result<NativeAsrCudaCapability, String> {
    let output = hidden_command(worker)
        .arg("--probe-cuda")
        .env_remove("CUDA_PATH")
        .env_remove("CUDA_HOME")
        .env_remove("CT2_CUDA_ALLOW_FP16")
        .env("PATH", cuda_restricted_path(root)?)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("无法启动 Native ASR CUDA 能力探测：{error}"))?;
    if output.stdout.len() > 16 * 1024 || output.stderr.len() > 16 * 1024 {
        return Err("Native ASR CUDA 能力探测输出超过限制".into());
    }
    let text = std::str::from_utf8(&output.stdout)
        .map_err(|_| "Native ASR CUDA 能力探测输出不是 UTF-8".to_string())?;
    if text.lines().count() != 1 {
        return Err("Native ASR CUDA 能力探测必须只输出一行 JSON".into());
    }
    serde_json::from_str(text.trim())
        .map_err(|error| format!("Native ASR CUDA 能力探测输出无效：{error}"))
}

fn native_asr_cuda_product_lock() -> Option<NativeAsrCudaProductLock> {
    serde_json::from_str(NATIVE_ASR_CUDA_LOCK_JSON).ok()
}

fn source_matches_cuda_artifact(
    source: Option<&RuntimeDependencyBinarySource>,
    artifact: &NativeAsrCudaArtifactLock,
) -> bool {
    source.is_some_and(|source| {
        source.archive == RuntimeDependencyArchive::Zip
            && source.size_bytes == artifact.size_bytes
            && source.sha256 == artifact.sha256
    })
}

fn native_asr_cuda_product_enabled() -> bool {
    let Some(lock) = native_asr_cuda_product_lock() else {
        return false;
    };
    if !lock.product_enablement_allowed
        || !lock.publication_gate.external_stable_asset_published
        || !lock.publication_gate.runtime_dependency_source_row_present
        || lock.artifact.id != NATIVE_ASR_CUDA_ARTIFACT_ID
    {
        return false;
    }
    let Ok(sources) = platform_sources() else {
        return false;
    };
    source_matches_cuda_artifact(sources.official.native_asr_cuda.as_ref(), &lock.artifact)
        || source_matches_cuda_artifact(sources.china.native_asr_cuda.as_ref(), &lock.artifact)
}

fn apply_cuda_support_evidence(capability: &mut NativeAsrCudaCapability) {
    if !capability.available {
        return;
    }
    let Some(qualification) =
        native_asr_cuda_product_lock().and_then(|lock| lock.local_qualification)
    else {
        return;
    };
    let machine = qualification.machine;
    let run = qualification.model_backed_module_closure;
    if capability.device_index == Some(machine.device_index)
        && capability.device_name.as_deref() == Some(machine.device_name.as_str())
        && capability.compute_capability.as_deref() == Some(machine.compute_capability.as_str())
        && capability.compute_type.as_deref() == Some(machine.compute_type.as_str())
        && run.ready_device == "cuda"
        && run.completed
        && !run.python_or_network_fallback
    {
        capability.support_evidence = Some("realTested".into());
    }
}

pub(crate) fn native_asr_cuda_capability(app: &AppHandle) -> NativeAsrCudaCapability {
    if !native_asr_cuda_product_enabled() {
        return NativeAsrCudaCapability {
            available: false,
            download_required: false,
            code: Some("cuda_artifact_not_qualified".into()),
            reason: Some("CUDA 运行时尚未完成最终可复现构建与发布资格".into()),
            device_index: None,
            device_name: None,
            visible_device_count: None,
            compute_capability: None,
            compute_type: None,
            driver_version: None,
            support_evidence: None,
        };
    }
    let root = match managed_native_asr_cuda_dir(app) {
        Ok(root) => root,
        Err(error) => {
            return NativeAsrCudaCapability {
                available: false,
                download_required: false,
                code: Some("cuda_pack_path_failed".into()),
                reason: Some(error),
                device_index: None,
                device_name: None,
                visible_device_count: None,
                compute_capability: None,
                compute_type: None,
                driver_version: None,
                support_evidence: None,
            }
        }
    };
    match verify_native_asr_cuda_runtime_at(&root) {
        Ok((root, worker, _)) => {
            let mut capability =
                probe_native_asr_cuda_worker(&root, &worker).unwrap_or_else(|error| {
                    NativeAsrCudaCapability {
                        available: false,
                        download_required: false,
                        code: Some("cuda_probe_failed".into()),
                        reason: Some(error),
                        device_index: None,
                        device_name: None,
                        visible_device_count: None,
                        compute_capability: None,
                        compute_type: None,
                        driver_version: None,
                        support_evidence: None,
                    }
                });
            apply_cuda_support_evidence(&mut capability);
            capability
        }
        Err(error) => NativeAsrCudaCapability {
            available: false,
            download_required: !root.exists(),
            code: Some(
                if root.exists() {
                    "cuda_pack_corrupt"
                } else {
                    "cuda_pack_missing"
                }
                .into(),
            ),
            reason: Some(if root.exists() {
                format!("CUDA 运行时损坏，请修复：{error}")
            } else {
                "CUDA 运行时尚未安装".into()
            }),
            device_index: None,
            device_name: None,
            visible_device_count: None,
            compute_capability: None,
            compute_type: None,
            driver_version: None,
            support_evidence: None,
        },
    }
}

pub(crate) fn resolve_native_asr_cuda_runtime(
    app: &AppHandle,
) -> Result<ResolvedNativeAsrCudaRuntime, String> {
    if !native_asr_cuda_product_enabled() {
        return Err("CUDA 运行时尚未完成最终可复现构建与发布资格".into());
    }
    let root = managed_native_asr_cuda_dir(app)?;
    let (root, worker, artifact_id) = verify_native_asr_cuda_runtime_at(&root)?;
    let capability = probe_native_asr_cuda_worker(&root, &worker)?;
    if !capability.available {
        return Err(capability
            .reason
            .clone()
            .unwrap_or_else(|| "Native ASR CUDA 设备当前不可用".into()));
    }
    Ok(ResolvedNativeAsrCudaRuntime {
        root,
        worker,
        artifact_id,
    })
}

fn load_source_manifest() -> Result<RuntimeDependencySourceManifest, String> {
    let manifest: RuntimeDependencySourceManifest =
        serde_json::from_str(MANIFEST_JSON).map_err(|e| e.to_string())?;
    if manifest.schema_version != 1 {
        return Err(format!(
            "不支持的运行时依赖源配置版本：{}",
            manifest.schema_version
        ));
    }
    Ok(manifest)
}

fn platform_key() -> Result<&'static str, String> {
    if cfg!(all(target_os = "windows", target_pointer_width = "64")) {
        Ok("windows-x64")
    } else {
        Err("当前平台暂未配置运行时依赖下载源".into())
    }
}

fn platform_sources() -> Result<RuntimeDependencyPlatformSources, String> {
    let manifest = load_source_manifest()?;
    let key = platform_key()?;
    manifest
        .platforms
        .get(key)
        .cloned()
        .ok_or_else(|| format!("运行时依赖源配置缺少平台：{key}"))
}

fn effective_source_id(settings: &AppSettings) -> RuntimeDependencySourceId {
    match settings.runtime_source_mode {
        RuntimeDependencySourceMode::Official => RuntimeDependencySourceId::Official,
        RuntimeDependencySourceMode::China => RuntimeDependencySourceId::China,
    }
}

pub fn effective_source_profile(
    settings: &AppSettings,
) -> Result<RuntimeDependencySourceProfile, String> {
    let sources = platform_sources()?;
    Ok(match effective_source_id(settings) {
        RuntimeDependencySourceId::Official => sources.official,
        RuntimeDependencySourceId::China => sources.china,
    })
}

fn push_log(job: &mut RuntimeDependencyJob, line: impl Into<String>) {
    job.log_tail.push_back(line.into());
    while job.log_tail.len() > LOG_TAIL_LIMIT {
        job.log_tail.pop_front();
    }
}

fn set_stage(job: &Arc<StdMutex<RuntimeDependencyJob>>, stage: &str, progress: Option<f64>) {
    if let Ok(mut guard) = job.lock() {
        guard.stage = stage.to_string();
        guard.progress = progress;
        if guard.status == RuntimeDependencyJobStatus::Pending {
            guard.status = RuntimeDependencyJobStatus::Running;
        }
        push_log(&mut guard, format!("==> {stage}"));
    }
}

fn finish_job(
    job: &Arc<StdMutex<RuntimeDependencyJob>>,
    status: RuntimeDependencyJobStatus,
    resolved_path: Option<String>,
    error: Option<String>,
) {
    if let Ok(mut guard) = job.lock() {
        if guard.status == RuntimeDependencyJobStatus::Cancelled
            && status != RuntimeDependencyJobStatus::Cancelled
        {
            return;
        }
        guard.status = status;
        guard.error = error;
        if let Some(path) = resolved_path {
            guard.resolved_path = Some(path);
        }
        if status == RuntimeDependencyJobStatus::Completed {
            guard.stage = "完成".into();
            guard.progress = Some(1.0);
        }
    }
}

fn is_cancelled(job: &Arc<StdMutex<RuntimeDependencyJob>>) -> bool {
    job.lock()
        .map(|guard| {
            guard.cancel_requested || guard.status == RuntimeDependencyJobStatus::Cancelled
        })
        .unwrap_or(true)
}

fn ensure_job_not_cancelled(job: &Arc<StdMutex<RuntimeDependencyJob>>) -> Result<(), String> {
    if is_cancelled(job) {
        Err("用户已取消运行时依赖准备".into())
    } else {
        Ok(())
    }
}

fn update_download_progress(
    job: &Arc<StdMutex<RuntimeDependencyJob>>,
    downloaded: u64,
    total: u64,
) {
    if let Ok(mut guard) = job.lock() {
        guard.downloaded_bytes = downloaded;
        guard.total_bytes = total;
        guard.progress = if total > 0 {
            Some((downloaded as f64 / total as f64).clamp(0.0, 0.95))
        } else {
            None
        };
    }
}

fn log_binary_download_start(
    job: &Arc<StdMutex<RuntimeDependencyJob>>,
    source: &RuntimeDependencyBinarySource,
    target: &Path,
) {
    if let Ok(mut guard) = job.lock() {
        push_log(&mut guard, format!("下载地址：{}", source.url));
        push_log(&mut guard, format!("保存位置：{}", target.display()));
    }
}

fn dependency_job_id(kind: RuntimeDependencyKind) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("runtime-{kind:?}-{millis}")
}

fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn download_binary_source_to_dir(
    dir: PathBuf,
    job: &Arc<StdMutex<RuntimeDependencyJob>>,
    source: &RuntimeDependencyBinarySource,
    file_name: &str,
) -> Result<PathBuf, String> {
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(file_name);
    let partial = dir.join(format!("{file_name}.part"));
    if partial.exists() {
        fs::remove_file(&partial).map_err(|e| e.to_string())?;
    }

    log_binary_download_start(job, source, &target);
    set_stage(job, "下载安装包", Some(0.05));
    let response = reqwest::get(&source.url)
        .await
        .map_err(|e| format!("下载失败（{}）：{e}", source.url))?;
    if !response.status().is_success() {
        return Err(format!(
            "下载失败（{}）：HTTP {}",
            source.url,
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(source.size_bytes);
    let mut stream = response.bytes_stream();
    let mut file = fs::File::create(&partial).map_err(|e| e.to_string())?;
    let mut downloaded = 0u64;
    while let Some(chunk) = stream.next().await {
        if is_cancelled(job) {
            let _ = fs::remove_file(&partial);
            return Err("用户已取消运行时依赖准备".into());
        }
        let chunk = chunk.map_err(|e| format!("下载失败：{e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        update_download_progress(job, downloaded, total);
    }
    drop(file);
    fs::rename(&partial, &target).map_err(|e| e.to_string())?;

    set_stage(job, "校验安装包", Some(0.20));
    let actual = sha256_file(&target)?;
    if actual != source.sha256 {
        let _ = fs::remove_file(&target);
        return Err(format!(
            "运行时依赖校验失败：期望 {}，实际 {}",
            source.sha256, actual
        ));
    }
    Ok(target)
}

async fn download_binary_source(
    app: &AppHandle,
    job: &Arc<StdMutex<RuntimeDependencyJob>>,
    source: &RuntimeDependencyBinarySource,
    file_name: &str,
) -> Result<PathBuf, String> {
    download_binary_source_to_dir(downloads_dir(app)?, job, source, file_name).await
}

fn powershell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

fn extract_archive(
    source: &Path,
    target: &Path,
    archive: RuntimeDependencyArchive,
) -> Result<(), String> {
    if target.exists() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(target).map_err(|e| e.to_string())?;

    match archive {
        RuntimeDependencyArchive::Zip if cfg!(windows) => {
            let command = format!(
                "Expand-Archive -LiteralPath {} -DestinationPath {} -Force",
                powershell_quote(source),
                powershell_quote(target)
            );
            let status = hidden_command("powershell")
                .args([
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    &command,
                ])
                .status()
                .map_err(|e| format!("解压 ZIP 失败：{e}"))?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("解压 ZIP 失败：退出码 {:?}", status.code()))
            }
        }
        RuntimeDependencyArchive::Zip => {
            let status = hidden_command("unzip")
                .arg("-q")
                .arg(source)
                .arg("-d")
                .arg(target)
                .status()
                .map_err(|e| format!("解压 ZIP 失败：{e}"))?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("解压 ZIP 失败：退出码 {:?}", status.code()))
            }
        }
        RuntimeDependencyArchive::TarGz | RuntimeDependencyArchive::TarXz => {
            let status = hidden_command("tar")
                .arg("-xf")
                .arg(source)
                .arg("-C")
                .arg(target)
                .status()
                .map_err(|e| format!("解压归档失败：{e}"))?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("解压归档失败：退出码 {:?}", status.code()))
            }
        }
        RuntimeDependencyArchive::WindowsInstaller => {
            Err("Windows installer 不能通过归档解压安装".into())
        }
    }
}

fn python_runtime_download_file_name(archive: RuntimeDependencyArchive) -> &'static str {
    match archive {
        RuntimeDependencyArchive::Zip => "python311-runtime.zip",
        RuntimeDependencyArchive::TarGz => "python311-runtime.tar.gz",
        RuntimeDependencyArchive::TarXz => "python311-runtime.tar.xz",
        RuntimeDependencyArchive::WindowsInstaller => "python311-runtime.exe",
    }
}

fn archive_payload_root(root: &Path, strip_prefix: Option<&str>) -> Result<PathBuf, String> {
    let Some(prefix) = strip_prefix else {
        return Ok(root.to_path_buf());
    };
    let prefix_path = Path::new(prefix);
    let safe_prefix = !prefix_path.is_absolute()
        && prefix_path
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
    if !safe_prefix {
        return Err(format!("归档 stripPrefix 不安全：{prefix}"));
    }

    let payload = root.join(prefix_path);
    if payload.is_dir() {
        Ok(payload)
    } else {
        Err(format!(
            "归档中未找到 stripPrefix 目录：{}",
            payload.display()
        ))
    }
}

fn find_file_by_name(root: &Path, name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(name)
        {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file_by_name(&path, name) {
                return Some(found);
            }
        }
    }
    None
}

fn find_managed_python_executable(root: &Path) -> Option<PathBuf> {
    let preferred = if cfg!(windows) {
        root.join("python.exe")
    } else {
        root.join("bin").join("python3")
    };
    if preferred.is_file() {
        return Some(preferred);
    }
    let fallback = if cfg!(windows) {
        "python.exe"
    } else {
        "python"
    };
    find_file_by_name(root, fallback)
}

async fn wait_for_usable_managed_python(root: &Path) -> Result<(PathBuf, String), String> {
    let mut last_error = None;
    for attempt in 0..30 {
        if let Some(python) = find_managed_python_executable(root) {
            let command = PythonCommand {
                program: python.to_string_lossy().into_owned(),
                args: vec![],
            };
            match python_version(&command) {
                Ok(version) => return Ok((python, version)),
                Err(error) => last_error = Some(error),
            }
        }
        if attempt < 29 {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
    Err(last_error.unwrap_or_else(|| missing_managed_python_message(root)))
}

fn directory_snapshot(root: &Path) -> String {
    let Ok(entries) = fs::read_dir(root) else {
        return "无法读取安装目录".into();
    };
    let mut names = entries
        .filter_map(Result::ok)
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.path().is_dir() {
                format!("{name}/")
            } else {
                name
            }
        })
        .collect::<Vec<_>>();
    names.sort();
    if names.is_empty() {
        "安装目录为空".into()
    } else {
        names.join(", ")
    }
}

fn missing_managed_python_message(root: &Path) -> String {
    format!(
        "Python 安装完成后未找到 python.exe（{}）。目录内容：{}",
        root.display(),
        directory_snapshot(root)
    )
}

fn python_installer_args(target: &Path, log_path: &Path) -> Vec<String> {
    let target_dir = target.to_string_lossy();
    vec![
        "/quiet".into(),
        "InstallAllUsers=0".into(),
        format!("TargetDir={target_dir}"),
        format!("DefaultJustForMeTargetDir={target_dir}"),
        "Include_pip=1".into(),
        "Include_launcher=0".into(),
        "Include_tcltk=0".into(),
        "Include_test=0".into(),
        "Include_doc=0".into(),
        "Shortcuts=0".into(),
        "PrependPath=0".into(),
        "/log".into(),
        log_path.to_string_lossy().into_owned(),
    ]
}

fn cleanup_stale_current_temp_dirs(target: &Path) {
    let Some(parent) = target.parent() else {
        return;
    };
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() && name.starts_with("current.") {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn replace_dir_with_temp(temp: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        fs::remove_dir_all(target)
            .map_err(|e| format!("清理旧目录失败（{}）：{e}", target.display()))?;
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(temp, target).map_err(|e| {
        format!(
            "移动目录失败（{} -> {}）：{e}",
            temp.display(),
            target.display()
        )
    })
}

async fn prepare_ffmpeg(
    app: &AppHandle,
    job: &Arc<StdMutex<RuntimeDependencyJob>>,
    profile: &RuntimeDependencySourceProfile,
) -> Result<String, String> {
    let source = profile
        .ffmpeg
        .as_ref()
        .ok_or_else(|| "当前下载源没有 FFmpeg 配置".to_string())?;
    let archive = download_binary_source(app, job, source, "ffmpeg-runtime.zip").await?;
    let extract = downloads_dir(app)?.join(format!("ffmpeg-extract-{}", unique_suffix()));
    set_stage(job, "解压 FFmpeg", Some(0.35));
    extract_archive(&archive, &extract, source.archive)?;

    set_stage(job, "安装 FFmpeg", Some(0.70));
    let ffmpeg = find_file_by_name(&extract, &exe_name("ffmpeg"))
        .ok_or_else(|| "FFmpeg 归档中未找到 ffmpeg 可执行文件".to_string())?;
    let ffprobe = find_file_by_name(&extract, &exe_name("ffprobe"))
        .ok_or_else(|| "FFmpeg 归档中未找到 ffprobe 可执行文件".to_string())?;

    let target = managed_ffmpeg_dir(app)?;
    let temp = target.with_file_name(format!("current.{}", unique_suffix()));
    fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
    fs::copy(&ffmpeg, temp.join(exe_name("ffmpeg"))).map_err(|e| e.to_string())?;
    fs::copy(&ffprobe, temp.join(exe_name("ffprobe"))).map_err(|e| e.to_string())?;
    replace_dir_with_temp(&temp, &target)?;
    let _ = fs::remove_dir_all(&extract);
    let _ = fs::remove_file(&archive);

    let resolved = target.join(exe_name("ffmpeg"));
    Ok(resolved.to_string_lossy().into_owned())
}

async fn prepare_native_asr_cuda(
    app: &AppHandle,
    job: &Arc<StdMutex<RuntimeDependencyJob>>,
    profile: &RuntimeDependencySourceProfile,
) -> Result<String, String> {
    if !native_asr_cuda_product_enabled() {
        return Err("CUDA 运行时尚未完成最终可复现构建与发布资格".into());
    }
    let source = profile
        .native_asr_cuda
        .as_ref()
        .ok_or_else(|| "当前下载源没有 Native ASR CUDA 运行时配置".to_string())?;
    if source.archive != RuntimeDependencyArchive::Zip {
        return Err("Native ASR CUDA 运行时必须使用 ZIP 归档".into());
    }
    let download_dir = managed_native_asr_cuda_download_dir(app)?;
    fs::create_dir_all(&download_dir).map_err(|error| error.to_string())?;
    let archive = download_binary_source_to_dir(
        download_dir.clone(),
        job,
        source,
        "native-asr-cuda-runtime.zip",
    )
    .await?;
    ensure_job_not_cancelled(job)?;
    let extract = download_dir.join(format!("extract-{}", unique_suffix()));
    let payload = extract.join("windows-x64").join("cuda");
    set_stage(job, "解压并验证 Native ASR CUDA 运行时", Some(0.45));
    let archive_for_extract = archive.clone();
    let extract_for_worker = extract.clone();
    let payload_for_worker = payload.clone();
    let archive_kind = source.archive;
    tauri::async_runtime::spawn_blocking(move || {
        extract_archive(&archive_for_extract, &extract_for_worker, archive_kind)?;
        verify_native_asr_cuda_runtime_at(&payload_for_worker).map(|_| ())
    })
    .await
    .map_err(|error| format!("解压 Native ASR CUDA 运行时任务失败：{error}"))??;
    ensure_job_not_cancelled(job)?;

    let target = managed_native_asr_cuda_dir(app)?;
    let parent = target
        .parent()
        .ok_or_else(|| "无法解析 Native ASR CUDA 运行时目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let staging = parent.join(format!("current.{}", unique_suffix()));
    let previous = parent.join(format!("previous.{}", unique_suffix()));
    fs::rename(&payload, &staging).map_err(|error| {
        format!(
            "移动 Native ASR CUDA 暂存目录失败（{} -> {}）：{error}",
            payload.display(),
            staging.display()
        )
    })?;
    if let Err(error) = ensure_job_not_cancelled(job) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    set_stage(job, "发布 Native ASR CUDA 运行时", Some(0.90));
    if target.exists() {
        fs::rename(&target, &previous)
            .map_err(|error| format!("保留上一版 Native ASR CUDA 运行时失败：{error}"))?;
    }
    if let Err(error) = fs::rename(&staging, &target) {
        if previous.exists() {
            let _ = fs::rename(&previous, &target);
        }
        return Err(format!("发布 Native ASR CUDA 运行时失败：{error}"));
    }
    if previous.exists() {
        let _ = fs::remove_dir_all(&previous);
    }
    set_stage(job, "检测 Native ASR CUDA 设备", Some(0.96));
    match probe_native_asr_cuda_worker(&target, &target.join(NATIVE_ASR_CPU_WORKER)) {
        Ok(capability) if capability.available => {
            if let Ok(mut guard) = job.lock() {
                push_log(
                    &mut guard,
                    format!(
                        "CUDA 设备已就绪：{} ({})",
                        capability
                            .device_name
                            .as_deref()
                            .unwrap_or("NVIDIA device 0"),
                        capability
                            .compute_capability
                            .as_deref()
                            .unwrap_or("unknown CC")
                    ),
                );
            }
        }
        Ok(capability) => {
            if let Ok(mut guard) = job.lock() {
                push_log(
                    &mut guard,
                    format!(
                        "CUDA pack 已安装，但当前设备不可用：{}",
                        capability
                            .reason
                            .or(capability.code)
                            .unwrap_or_else(|| "未知原因".into())
                    ),
                );
            }
        }
        Err(error) => {
            if let Ok(mut guard) = job.lock() {
                push_log(
                    &mut guard,
                    format!("CUDA pack 已安装，但能力探测失败：{error}"),
                );
            }
        }
    }
    let _ = fs::remove_dir_all(&extract);
    let _ = fs::remove_file(&archive);
    Ok(target.to_string_lossy().into_owned())
}

async fn prepare_python311(
    app: &AppHandle,
    job: &Arc<StdMutex<RuntimeDependencyJob>>,
    profile: &RuntimeDependencySourceProfile,
) -> Result<String, String> {
    if !cfg!(windows) {
        return Err("当前实现只支持在 Windows 上自动安装受管 Python 3.11".into());
    }
    let source = profile
        .python311
        .as_ref()
        .ok_or_else(|| "当前下载源没有 Python 3.11 配置".to_string())?;
    let target = managed_python_dir(app)?;
    cleanup_stale_current_temp_dirs(&target);

    if source.archive == RuntimeDependencyArchive::WindowsInstaller {
        let installer = download_binary_source(
            app,
            job,
            source,
            python_runtime_download_file_name(source.archive),
        )
        .await?;
        let temp = target.with_file_name(format!("current.{}", unique_suffix()));
        let install_log = downloads_dir(app)?.join("python311-install.log");
        if temp.exists() {
            fs::remove_dir_all(&temp).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&install_log);

        set_stage(job, "安装 Python 3.11", Some(0.45));
        if let Ok(mut guard) = job.lock() {
            push_log(&mut guard, format!("安装日志：{}", install_log.display()));
        }
        let installer_args = python_installer_args(&temp, &install_log);
        let status = hidden_command(&installer)
            .args(&installer_args)
            .status()
            .map_err(|e| format!("安装 Python 3.11 失败：{e}"))?;
        if !status.success() {
            let _ = fs::remove_dir_all(&temp);
            return Err(format!(
                "安装 Python 3.11 失败：退出码 {:?}，安装日志：{}",
                status.code(),
                install_log.display()
            ));
        }

        set_stage(job, "验证 Python 3.11", Some(0.85));
        let (python, version) = match wait_for_usable_managed_python(&temp).await {
            Ok(result) => result,
            Err(e) => {
                let message = format!(
                    "{e}。安装目录内容：{}；安装日志：{}",
                    directory_snapshot(&temp),
                    install_log.display()
                );
                let _ = fs::remove_dir_all(&temp);
                return Err(message);
            }
        };
        let relative_python = python
            .strip_prefix(&temp)
            .map(PathBuf::from)
            .map_err(|e| e.to_string())?;
        if let Ok(mut guard) = job.lock() {
            push_log(
                &mut guard,
                format!("使用 Python {version} ({})", python.display()),
            );
        }
        replace_dir_with_temp(&temp, &target)?;
        let _ = fs::remove_file(&installer);

        return Ok(target.join(relative_python).to_string_lossy().into_owned());
    }

    let archive = download_binary_source(
        app,
        job,
        source,
        python_runtime_download_file_name(source.archive),
    )
    .await?;
    let extract = downloads_dir(app)?.join(format!("python311-extract-{}", unique_suffix()));
    set_stage(job, "解压 Python 3.11", Some(0.45));
    extract_archive(&archive, &extract, source.archive)?;
    let payload = archive_payload_root(&extract, source.strip_prefix.as_deref())?;

    set_stage(job, "安装 Python 3.11", Some(0.70));
    let temp = target.with_file_name(format!("current.{}", unique_suffix()));
    if temp.exists() {
        fs::remove_dir_all(&temp).map_err(|e| e.to_string())?;
    }
    if let Some(parent) = temp.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&payload, &temp).map_err(|e| {
        format!(
            "移动 Python 运行时失败（{} -> {}）：{e}",
            payload.display(),
            temp.display()
        )
    })?;
    let _ = fs::remove_dir_all(&extract);

    set_stage(job, "验证 Python 3.11", Some(0.85));
    let (python, version) = match wait_for_usable_managed_python(&temp).await {
        Ok(result) => result,
        Err(e) => {
            let message = format!("{e}。安装目录内容：{}", directory_snapshot(&temp));
            let _ = fs::remove_dir_all(&temp);
            return Err(message);
        }
    };
    let relative_python = python
        .strip_prefix(&temp)
        .map(PathBuf::from)
        .map_err(|e| e.to_string())?;
    if let Ok(mut guard) = job.lock() {
        push_log(
            &mut guard,
            format!("使用 Python {version} ({})", python.display()),
        );
    }
    replace_dir_with_temp(&temp, &target)?;
    let _ = fs::remove_file(&archive);

    Ok(target.join(relative_python).to_string_lossy().into_owned())
}

async fn run_prepare_job(
    app: AppHandle,
    job: Arc<StdMutex<RuntimeDependencyJob>>,
    args: PrepareRuntimeDependencyArgs,
) -> Result<String, String> {
    ensure_runtime_deps_writable_or_elevate(&app)?;
    let settings = load_settings(&app).unwrap_or_default();
    let profile = effective_source_profile(&settings)?;
    if let Ok(mut guard) = job.lock() {
        push_log(&mut guard, format!("下载源：{}", profile.label));
        if let Some(engine) = args.engine.as_deref() {
            push_log(&mut guard, format!("引擎：{engine}"));
        }
        if let Some(model) = args.model.as_deref() {
            push_log(&mut guard, format!("模型：{model}"));
        }
        if let Some(profile) = args.profile {
            push_log(&mut guard, format!("配置档：{profile:?}"));
        }
        if args.recreate {
            push_log(&mut guard, "将重新创建受管依赖");
        }
    }

    match args.kind {
        RuntimeDependencyKind::Ffmpeg => prepare_ffmpeg(&app, &job, &profile).await,
        RuntimeDependencyKind::NativeAsrCpu => {
            Err("内置 Native ASR CPU 运行时不可下载或准备".into())
        }
        RuntimeDependencyKind::NativeAsrCuda => prepare_native_asr_cuda(&app, &job, &profile).await,
        RuntimeDependencyKind::Python311 => prepare_python311(&app, &job, &profile).await,
        RuntimeDependencyKind::AsrVenv => Err("ASR 引擎依赖由 ASR 一键配置流程准备".into()),
        RuntimeDependencyKind::AsrModels => Err("ASR 模型由模型管理器按具体引擎和模型下载".into()),
        RuntimeDependencyKind::Downloads => Err("下载缓存不需要准备".into()),
        RuntimeDependencyKind::AppCache => Err("应用缓存不需要准备".into()),
    }
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn command_first_line(program: &str, args: &[&str]) -> Option<String> {
    let output = hidden_command(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| {
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                return 0;
            };
            if is_link_like(&metadata) {
                0
            } else if metadata.is_dir() {
                dir_size(&path)
            } else {
                metadata.len()
            }
        })
        .sum()
}

fn normalized_components(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|component| match component {
            Component::Prefix(prefix) => Some(prefix.as_os_str().to_string_lossy().to_lowercase()),
            Component::RootDir => Some(std::path::MAIN_SEPARATOR.to_string()),
            Component::Normal(value) => Some(value.to_string_lossy().to_lowercase()),
            Component::CurDir => None,
            Component::ParentDir => Some("..".into()),
        })
        .collect()
}

fn path_is_under(child: &Path, parent: &Path) -> bool {
    let child = normalized_components(child);
    let parent = normalized_components(parent);
    child.len() >= parent.len()
        && child
            .iter()
            .zip(parent.iter())
            .all(|(left, right)| left == right)
}

fn canonical_for_guard(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn safe_remove_dir_under_deps(target: &Path, deps_root: &Path) -> Result<(), String> {
    if !target.exists() {
        return Ok(());
    }
    let deps_root = canonical_for_guard(deps_root);
    let target = target
        .canonicalize()
        .map_err(|e| format!("解析清理路径失败（{}）：{e}", target.display()))?;
    if target == deps_root || !path_is_under(&target, &deps_root) {
        return Err(format!(
            "拒绝清理受管依赖目录之外的路径：{}",
            target.display()
        ));
    }
    fs::remove_dir_all(&target).map_err(|e| format!("清理失败（{}）：{e}", target.display()))
}

/// 允许清理：exe 旁 deps 下路径，或源码仓库 `asr-service/.venv`（仅该目录）。
fn safe_remove_runtime_dependency_dir(target: &Path, deps_root: &Path) -> Result<(), String> {
    if !target.exists() {
        return Ok(());
    }
    let canonical = target
        .canonicalize()
        .map_err(|e| format!("解析清理路径失败（{}）：{e}", target.display()))?;
    if canonical.file_name().is_some_and(|name| name == ".venv") {
        if let Some(service_dir) = canonical.parent() {
            if is_source_checkout_asr_service_dir(service_dir) {
                return fs::remove_dir_all(&canonical)
                    .map_err(|e| format!("清理失败（{}）：{e}", canonical.display()));
            }
        }
    }
    safe_remove_dir_under_deps(target, deps_root)
}

fn cleanup_target_for_kind(
    app: &AppHandle,
    kind: RuntimeDependencyKind,
) -> Result<PathBuf, String> {
    match kind {
        RuntimeDependencyKind::Ffmpeg => managed_ffmpeg_dir(app),
        RuntimeDependencyKind::NativeAsrCpu => Err("内置 Native ASR CPU 运行时不可清理".into()),
        RuntimeDependencyKind::NativeAsrCuda => managed_native_asr_cuda_dir(app),
        RuntimeDependencyKind::Python311 => managed_python_dir(app),
        RuntimeDependencyKind::AsrVenv => {
            let settings = load_settings(app).unwrap_or_default();
            Ok(effective_asr_service_dir(app, settings.asr_service_path.as_deref())?.join(".venv"))
        }
        RuntimeDependencyKind::AsrModels => managed_models_dir(app),
        RuntimeDependencyKind::Downloads => downloads_dir(app),
        RuntimeDependencyKind::AppCache => work_cache_dir(app),
    }
}

/// 业务工作缓存根目录。
/// - 安装/开发：`%LOCALAPPDATA%\com.hikaru.sub\cache`
/// - portable（exe 旁有 `.portable`）：`<exe>/cache`
pub fn work_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::app_paths::work_cache_dir(app)
}

const APP_CACHE_CLEARABLE_DIRS: &[&str] = &["workspace", "transcode", "preview", "clip-frames"];

fn proxy_cache_hash_for_video_path(video_path: &str) -> String {
    format!("{:x}", md5::compute(video_path))
}

fn preserve_keys_for_video(video_path: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(raw) = video_path.map(str::trim).filter(|value| !value.is_empty()) else {
        return (None, None);
    };
    let workspace_key = crate::project::workspace_key_for_video(Path::new(raw)).ok();
    let proxy_hash = Some(proxy_cache_hash_for_video_path(raw));
    (workspace_key, proxy_hash)
}

/// 统计应用缓存可清理占用：仅 `cache/` 下 workspace/transcode/preview/clip-frames。
fn measure_app_cache_size(cache_root: &Path, preserve_video_path: Option<&str>) -> u64 {
    measure_app_cache_tree(cache_root, preserve_video_path)
}

fn measure_app_cache_tree(root: &Path, preserve_video_path: Option<&str>) -> u64 {
    let (preserve_workspace, preserve_proxy) = preserve_keys_for_video(preserve_video_path);
    APP_CACHE_CLEARABLE_DIRS
        .iter()
        .map(|name| {
            let dir = root.join(name);
            match *name {
                "workspace" => measure_workspace_cache_size(&dir, preserve_workspace.as_deref()),
                "transcode" => measure_transcode_cache_size(&dir, preserve_proxy.as_deref()),
                _ => dir_size(&dir),
            }
        })
        .sum()
}

fn measure_workspace_cache_size(workspace_root: &Path, preserve_key: Option<&str>) -> u64 {
    let Ok(entries) = fs::read_dir(workspace_root) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| {
            let path = entry.path();
            if preserve_key.is_some_and(|key| entry.file_name() == *key) {
                0
            } else if path.is_dir() {
                dir_size(&path)
            } else {
                entry.metadata().map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

fn measure_transcode_cache_size(transcode_root: &Path, preserve_hash: Option<&str>) -> u64 {
    let Ok(entries) = fs::read_dir(transcode_root) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if preserve_hash.is_some_and(|hash| name.starts_with(hash)) {
                0
            } else {
                entry.metadata().map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

fn cleanup_app_cache_dir(
    cache_root: &Path,
    preserve_video_path: Option<&str>,
) -> Result<(), String> {
    cleanup_app_cache_tree(cache_root, preserve_video_path)
}

fn cleanup_app_cache_tree(root: &Path, preserve_video_path: Option<&str>) -> Result<(), String> {
    let (preserve_workspace, preserve_proxy) = preserve_keys_for_video(preserve_video_path);
    for name in APP_CACHE_CLEARABLE_DIRS {
        let dir = root.join(name);
        if !dir.exists() {
            continue;
        }
        match *name {
            "workspace" => cleanup_workspace_cache(&dir, preserve_workspace.as_deref())?,
            "transcode" => cleanup_transcode_cache(&dir, preserve_proxy.as_deref())?,
            _ => {
                if dir.is_dir() {
                    fs::remove_dir_all(&dir)
                        .map_err(|e| format!("清理应用缓存失败（{}）：{e}", dir.display()))?;
                }
            }
        }
    }
    Ok(())
}

fn cleanup_workspace_cache(
    workspace_root: &Path,
    preserve_key: Option<&str>,
) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(workspace_root) else {
        return Ok(());
    };
    for entry in entries.filter_map(Result::ok) {
        if preserve_key.is_some_and(|key| entry.file_name() == *key) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("清理应用缓存失败（{}）：{e}", path.display()))?;
        } else {
            fs::remove_file(&path)
                .map_err(|e| format!("清理应用缓存失败（{}）：{e}", path.display()))?;
        }
    }
    Ok(())
}

fn cleanup_transcode_cache(
    transcode_root: &Path,
    preserve_hash: Option<&str>,
) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(transcode_root) else {
        return Ok(());
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if preserve_hash.is_some_and(|hash| name.starts_with(hash)) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("清理应用缓存失败（{}）：{e}", path.display()))?;
        } else {
            fs::remove_file(&path)
                .map_err(|e| format!("清理应用缓存失败（{}）：{e}", path.display()))?;
        }
    }
    Ok(())
}

fn probe_runtime_dependencies_inner(app: &AppHandle) -> Result<RuntimeDependencyProbe, String> {
    let settings = load_settings(app).unwrap_or_default();
    let source_mode = settings.runtime_source_mode.clone();
    let source_profile = effective_source_profile(&settings).ok();
    let mut items = Vec::new();

    let ffmpeg = resolve_ffmpeg_paths(app, &settings);
    let (status, path, source, managed) = match ffmpeg.source {
        ResolvedFfmpegSource::Missing => (RuntimeDependencyStatus::Missing, None, None, false),
        ResolvedFfmpegSource::Settings => (
            RuntimeDependencyStatus::Available,
            Some(ffmpeg.ffmpeg.clone()),
            Some("settings".into()),
            false,
        ),
        ResolvedFfmpegSource::System => (
            RuntimeDependencyStatus::Available,
            Some(ffmpeg.ffmpeg.clone()),
            Some("system".into()),
            false,
        ),
        ResolvedFfmpegSource::Managed => (
            RuntimeDependencyStatus::Available,
            Some(ffmpeg.ffmpeg.clone()),
            Some("managed".into()),
            true,
        ),
    };
    let ffmpeg_managed_dir = managed_ffmpeg_dir(app).ok();
    let ffmpeg_expected = source_profile
        .as_ref()
        .and_then(|profile| profile.ffmpeg.as_ref())
        .map(|source| source.size_bytes)
        .filter(|_| ffmpeg.source == ResolvedFfmpegSource::Missing);
    let ffmpeg_version = path
        .as_deref()
        .and_then(|program| command_first_line(program, &["-version"]));
    items.push(RuntimeDependencyItem {
        kind: RuntimeDependencyKind::Ffmpeg,
        status,
        path: path.or_else(|| {
            ffmpeg_managed_dir
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned())
        }),
        source,
        version: ffmpeg_version,
        managed,
        expected_download_bytes: ffmpeg_expected,
        reason: None,
    });

    let runtime_root = app.path().resource_dir().ok().map(|path| {
        NATIVE_ASR_CPU_RESOURCE_PATH
            .iter()
            .fold(path, |path, segment| path.join(segment))
    });
    let runtime = resolve_native_asr_cpu_runtime(app);
    items.push(RuntimeDependencyItem {
        kind: RuntimeDependencyKind::NativeAsrCpu,
        status: if runtime.is_ok() {
            RuntimeDependencyStatus::Available
        } else {
            RuntimeDependencyStatus::Missing
        },
        path: runtime
            .as_ref()
            .ok()
            .map(|value| value.root.to_string_lossy().into_owned())
            .or_else(|| runtime_root.map(|path| path.to_string_lossy().into_owned())),
        source: Some("builtIn".into()),
        version: runtime.ok().map(|value| value.artifact_id),
        managed: false,
        expected_download_bytes: None,
        reason: None,
    });

    let cuda_root = managed_native_asr_cuda_dir(app)?;
    let cuda_verified = verify_native_asr_cuda_runtime_at(&cuda_root);
    let (cuda_status, cuda_version, cuda_reason) = if !native_asr_cuda_product_enabled() {
        (
            RuntimeDependencyStatus::Missing,
            None,
            Some("CUDA 运行时尚未完成最终可复现构建与发布资格".into()),
        )
    } else {
        match cuda_verified {
            Ok((root, worker, artifact_id)) => match probe_native_asr_cuda_worker(&root, &worker) {
                Ok(capability) if capability.available => {
                    (RuntimeDependencyStatus::Available, Some(artifact_id), None)
                }
                Ok(capability) => (
                    RuntimeDependencyStatus::Available,
                    Some(artifact_id),
                    capability.reason.or(capability.code),
                ),
                Err(error) => (
                    RuntimeDependencyStatus::Available,
                    Some(artifact_id),
                    Some(error),
                ),
            },
            Err(error) => (RuntimeDependencyStatus::Missing, None, Some(error)),
        }
    };
    items.push(RuntimeDependencyItem {
        kind: RuntimeDependencyKind::NativeAsrCuda,
        status: cuda_status,
        path: Some(cuda_root.to_string_lossy().into_owned()),
        source: Some("managed".into()),
        version: cuda_version,
        managed: true,
        expected_download_bytes: source_profile
            .as_ref()
            .and_then(|profile| profile.native_asr_cuda.as_ref())
            .map(|source| source.size_bytes)
            .filter(|_| native_asr_cuda_product_enabled())
            .filter(|_| cuda_status != RuntimeDependencyStatus::Available),
        reason: cuda_reason,
    });

    Ok(RuntimeDependencyProbe { items, source_mode })
}

fn native_model_dependency_item(
    models_root: &Path,
    status: NativeAsrModelStatus,
) -> RuntimeDependencyItem {
    RuntimeDependencyItem {
        kind: RuntimeDependencyKind::AsrModels,
        status: if status.disposition == NativeAsrModelDisposition::Ready {
            RuntimeDependencyStatus::Available
        } else {
            RuntimeDependencyStatus::Missing
        },
        path: Some(
            status
                .resolved_path
                .unwrap_or_else(|| models_root.to_path_buf())
                .to_string_lossy()
                .into_owned(),
        ),
        source: Some(
            match status.origin {
                Some(NativeAsrModelOrigin::DirectInstall) => "directInstall",
                Some(NativeAsrModelOrigin::LegacyHuggingFaceSnapshot) => {
                    "legacyHuggingFaceSnapshot"
                }
                None => "managed",
            }
            .into(),
        ),
        version: status.revision,
        managed: true,
        expected_download_bytes: None,
        reason: None,
    }
}

fn measure_runtime_dependency_storage_inner(
    app: &AppHandle,
    preserve_video_path: Option<&str>,
) -> Result<RuntimeDependencyStorage, String> {
    let settings = load_settings(app).unwrap_or_default();
    let kinds = [
        RuntimeDependencyKind::Ffmpeg,
        RuntimeDependencyKind::NativeAsrCuda,
        RuntimeDependencyKind::AsrModels,
        RuntimeDependencyKind::Downloads,
        RuntimeDependencyKind::AppCache,
    ];
    let mut items = Vec::with_capacity(kinds.len());
    for kind in kinds {
        let managed = match kind {
            RuntimeDependencyKind::Ffmpeg => {
                resolve_ffmpeg_paths(app, &settings).source == ResolvedFfmpegSource::Managed
            }
            RuntimeDependencyKind::NativeAsrCuda
            | RuntimeDependencyKind::AsrModels
            | RuntimeDependencyKind::Downloads
            | RuntimeDependencyKind::AppCache => true,
            RuntimeDependencyKind::NativeAsrCpu
            | RuntimeDependencyKind::Python311
            | RuntimeDependencyKind::AsrVenv => unreachable!(),
        };
        if kind == RuntimeDependencyKind::Ffmpeg && !managed {
            continue;
        }
        let target = if kind == RuntimeDependencyKind::NativeAsrCuda {
            managed_native_asr_cuda_root(app)?
        } else {
            cleanup_target_for_kind(app, kind)?
        };
        let size_bytes = if kind == RuntimeDependencyKind::AppCache {
            measure_app_cache_size(&target, preserve_video_path)
        } else if kind == RuntimeDependencyKind::NativeAsrCuda {
            dir_size(&target) + dir_size(&managed_native_asr_cuda_download_dir(app)?)
        } else {
            dir_size(&target)
        };
        items.push(RuntimeDependencyStorageItem {
            kind,
            path: Some(target.to_string_lossy().into_owned()),
            managed,
            size_bytes,
        });
    }
    Ok(RuntimeDependencyStorage { items })
}

#[tauri::command]
pub async fn probe_runtime_dependencies(
    app: AppHandle,
    asr_state: State<'_, crate::asr::AsrState>,
) -> Result<RuntimeDependencyProbe, String> {
    let probe_app = app.clone();
    let mut probe =
        tauri::async_runtime::spawn_blocking(move || probe_runtime_dependencies_inner(&probe_app))
            .await
            .map_err(|e| format!("探测运行时依赖失败：{e}"))??;
    let model_status = asr_state
        .native_models
        .status(&app, "faster-whisper", "large-v3")
        .await?;
    probe.items.push(native_model_dependency_item(
        &managed_models_dir(&app)?,
        model_status,
    ));
    Ok(probe)
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MeasureRuntimeDependencyStorageArgs {
    #[serde(default)]
    pub preserve_video_path: Option<String>,
}

#[tauri::command]
pub async fn measure_runtime_dependency_storage(
    app: AppHandle,
    args: MeasureRuntimeDependencyStorageArgs,
) -> Result<RuntimeDependencyStorage, String> {
    let preserve = args
        .preserve_video_path
        .filter(|value| !value.trim().is_empty());
    tauri::async_runtime::spawn_blocking(move || {
        measure_runtime_dependency_storage_inner(&app, preserve.as_deref())
    })
    .await
    .map_err(|e| format!("计算依赖占用失败：{e}"))?
}

#[tauri::command]
pub async fn prepare_runtime_dependency(
    app: AppHandle,
    state: State<'_, RuntimeDependencyState>,
    args: PrepareRuntimeDependencyArgs,
) -> Result<String, String> {
    let id = dependency_job_id(args.kind);
    let job = Arc::new(StdMutex::new(RuntimeDependencyJob::new(
        id.clone(),
        args.kind,
    )));
    {
        let mut jobs = state.jobs.lock().await;
        let duplicate_active = jobs.values().any(|existing| {
            existing
                .lock()
                .map(|existing| {
                    existing.kind == args.kind
                        && matches!(
                            existing.status,
                            RuntimeDependencyJobStatus::Pending
                                | RuntimeDependencyJobStatus::Running
                        )
                })
                .unwrap_or(true)
        });
        if duplicate_active {
            return Err("同类运行时依赖准备任务正在进行".into());
        }
        jobs.insert(id.clone(), Arc::clone(&job));
    }

    tauri::async_runtime::spawn(async move {
        let result = run_prepare_job(app, Arc::clone(&job), args).await;
        match result {
            Ok(path) => finish_job(
                &job,
                RuntimeDependencyJobStatus::Completed,
                Some(path),
                None,
            ),
            Err(error) => {
                if is_cancelled(&job) {
                    finish_job(
                        &job,
                        RuntimeDependencyJobStatus::Cancelled,
                        None,
                        Some(error),
                    );
                } else {
                    finish_job(&job, RuntimeDependencyJobStatus::Failed, None, Some(error));
                }
            }
        }
    });

    Ok(id)
}

#[tauri::command]
pub async fn get_runtime_dependency_progress(
    state: State<'_, RuntimeDependencyState>,
    job_id: String,
) -> Result<RuntimeDependencySnapshot, String> {
    let jobs = state.jobs.lock().await;
    let job = jobs
        .get(&job_id)
        .ok_or_else(|| "运行时依赖任务不存在".to_string())?;
    let guard = job
        .lock()
        .map_err(|_| "运行时依赖任务状态已损坏".to_string())?;
    Ok(guard.snapshot())
}

#[tauri::command]
pub async fn cancel_runtime_dependency(
    state: State<'_, RuntimeDependencyState>,
    job_id: String,
) -> Result<(), String> {
    let jobs = state.jobs.lock().await;
    let job = jobs
        .get(&job_id)
        .ok_or_else(|| "运行时依赖任务不存在".to_string())?;
    let mut guard = job
        .lock()
        .map_err(|_| "运行时依赖任务状态已损坏".to_string())?;
    guard.cancel_requested = true;
    guard.status = RuntimeDependencyJobStatus::Cancelled;
    guard.progress = None;
    guard.stage = "已取消".into();
    guard.error = Some("用户已取消运行时依赖准备".into());
    Ok(())
}

#[tauri::command]
pub async fn cleanup_runtime_dependency(
    app: AppHandle,
    state: State<'_, RuntimeDependencyState>,
    asr_state: State<'_, crate::asr::AsrState>,
    args: CleanupRuntimeDependencyArgs,
) -> Result<(), String> {
    if args.kind == RuntimeDependencyKind::NativeAsrCpu {
        return Err("内置 Native ASR CPU 运行时不可清理".into());
    }
    if args.kind == RuntimeDependencyKind::NativeAsrCuda
        && (asr_state.has_active_job()
            || state
                .has_active_kind(RuntimeDependencyKind::NativeAsrCuda)
                .await)
    {
        return Err("CUDA 转录或 CUDA 运行时任务正在进行，暂不可清理".into());
    }
    if args.kind == RuntimeDependencyKind::AppCache {
        let preserve = args.preserve_video_path;
        return tauri::async_runtime::spawn_blocking(move || {
            let cache_root = work_cache_dir(&app)?;
            fs::create_dir_all(&cache_root).map_err(|e| e.to_string())?;
            cleanup_app_cache_dir(&cache_root, preserve.as_deref())
        })
        .await
        .map_err(|e| format!("清理应用缓存失败：{e}"))?;
    }

    // 可能触发提权重启，放在阻塞扫盘之前。
    ensure_runtime_deps_writable_or_elevate(&app)?;
    let kind = args.kind;
    tauri::async_runtime::spawn_blocking(move || {
        let deps = deps_dir(&app)?;
        fs::create_dir_all(&deps).map_err(|e| e.to_string())?;
        if kind == RuntimeDependencyKind::NativeAsrCuda {
            safe_remove_runtime_dependency_dir(&managed_native_asr_cuda_root(&app)?, &deps)?;
            return safe_remove_runtime_dependency_dir(
                &managed_native_asr_cuda_download_dir(&app)?,
                &deps,
            );
        }
        let target = cleanup_target_for_kind(&app, kind)?;
        safe_remove_runtime_dependency_dir(&target, &deps)
    })
    .await
    .map_err(|e| format!("清理运行时依赖失败：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::AppSettings;
    use std::path::{Path, PathBuf};

    #[test]
    fn python311_candidates_put_user_path_first() {
        let settings = AppSettings {
            python_path: Some("C:/Python311/python.exe".into()),
            ..Default::default()
        };

        let candidates = python311_candidates(
            &settings,
            Some(Path::new("C:/managed/python311/current")),
            None,
        );

        assert_eq!(
            candidates.first().unwrap().program,
            "C:/Python311/python.exe"
        );
    }

    #[test]
    fn python311_candidates_put_extra_exe_after_system() {
        let settings = AppSettings::default();
        let temp = tempfile::tempdir().unwrap();
        let exe = if cfg!(windows) {
            temp.path().join("python.exe")
        } else {
            temp.path().join("python")
        };
        std::fs::write(&exe, "").unwrap();

        let candidates = python311_candidates(&settings, None, Some(&exe));
        let last = candidates.last().unwrap();
        assert_eq!(last.program, exe.to_string_lossy());
        assert!(candidates.iter().any(|cmd| {
            cmd.program == "python" || cmd.program == "python3" || cmd.program == "py"
        }));
    }

    #[test]
    fn dependency_paths_live_under_install_dir() {
        let exe = PathBuf::from("C:/Users/example/AppData/Local/Programs/hikaru-sub")
            .join("hikaru-sub.exe");
        let deps = deps_dir_from_exe(&exe).unwrap();

        assert_eq!(
            deps,
            PathBuf::from("C:/Users/example/AppData/Local/Programs/hikaru-sub").join("deps")
        );
        assert!(deps
            .join("python311")
            .join("current")
            .ends_with(Path::new("deps").join("python311").join("current")));
    }

    fn write_native_runtime(resource_dir: &Path, artifact_id: &str) -> PathBuf {
        write_native_runtime_with_engines(
            resource_dir,
            artifact_id,
            &["faster-whisper", "kotoba-faster-whisper"],
        )
    }

    fn write_native_runtime_with_engines(
        resource_dir: &Path,
        artifact_id: &str,
        engines: &[&str],
    ) -> PathBuf {
        let root = NATIVE_ASR_CPU_RESOURCE_PATH
            .iter()
            .fold(resource_dir.to_path_buf(), |path, segment| {
                path.join(segment)
            });
        fs::create_dir_all(&root).unwrap();
        for entry in NATIVE_ASR_CPU_REQUIRED_ENTRIES {
            let path = root.join(entry);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, b"runtime").unwrap();
        }
        fs::write(root.join("SHA256SUMS"), b"checksums").unwrap();
        fs::write(
            root.join("runtime-manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1,
                "artifactId": artifact_id,
                "platform": "windows-x64",
                "arch": "x64",
                "protocolVersion": 1,
                "capabilities": {
                    "backend": "ctranslate2",
                    "device": "cpu",
                    "engines": engines,
                    "vad": false,
                    "crispasr": false,
                    "cuda": false,
                    "vulkan": false,
                    "modelsBundled": false
                },
                "files": []
            }))
            .unwrap(),
        )
        .unwrap();
        root
    }

    fn write_native_cuda_runtime(root: &Path) {
        fs::create_dir_all(root).unwrap();
        let mut files = Vec::new();
        for entry in NATIVE_ASR_CUDA_REQUIRED_ENTRIES
            .iter()
            .copied()
            .filter(|entry| *entry != "runtime-manifest.json" && *entry != "SHA256SUMS")
        {
            let path = root.join(entry);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&path, format!("runtime:{entry}")).unwrap();
            files.push(serde_json::json!({
                "path": entry.replace('\\', "/"),
                "sizeBytes": fs::metadata(&path).unwrap().len(),
                "sha256": sha256_file(&path).unwrap()
            }));
        }
        files.sort_by(|left, right| {
            left["path"]
                .as_str()
                .unwrap()
                .cmp(right["path"].as_str().unwrap())
        });
        let sums = files
            .iter()
            .map(|row| {
                format!(
                    "{}  {}",
                    row["sha256"].as_str().unwrap(),
                    row["path"].as_str().unwrap()
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(root.join("SHA256SUMS"), format!("{sums}\n")).unwrap();
        fs::write(
            root.join("runtime-manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1,
                "artifactId": NATIVE_ASR_CUDA_ARTIFACT_ID,
                "platform": "windows-x64",
                "arch": "x64",
                "protocolVersion": 1,
                "capabilities": {
                    "backend": "ctranslate2",
                    "device": "cuda",
                    "engines": ["faster-whisper", "kotoba-faster-whisper"],
                    "vad": false,
                    "crispasr": false,
                    "cuda": true,
                    "vulkan": false,
                    "modelsBundled": false
                },
                "files": files
            }))
            .unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn native_cuda_product_gate_stays_closed_until_publication_and_source_agree() {
        let lock = native_asr_cuda_product_lock().unwrap();
        assert!(!lock.product_enablement_allowed);
        assert!(!lock.publication_gate.external_stable_asset_published);
        assert!(!lock.publication_gate.runtime_dependency_source_row_present);
        assert!(!native_asr_cuda_product_enabled());
        assert!(NATIVE_ASR_CUDA_REQUIRED_ENTRIES
            .contains(&"licenses/NVIDIA-CUDA-Toolkit-12.9-License.txt"));
        assert!(!NATIVE_ASR_CUDA_REQUIRED_ENTRIES
            .contains(&"licenses/NVIDIA-CUDA-Toolkit-12.8-License.txt"));
    }

    #[test]
    fn exact_rtx_3070_capability_is_labeled_real_tested_from_the_artifact_lock() {
        let mut capability = NativeAsrCudaCapability {
            available: true,
            download_required: false,
            code: None,
            reason: None,
            device_index: Some(0),
            device_name: Some("NVIDIA GeForce RTX 3070".into()),
            visible_device_count: Some(1),
            compute_capability: Some("8.6".into()),
            compute_type: Some("float16".into()),
            driver_version: Some(13020),
            support_evidence: Some("theoretical".into()),
        };
        apply_cuda_support_evidence(&mut capability);
        assert_eq!(capability.support_evidence.as_deref(), Some("realTested"));

        capability.device_name = Some("NVIDIA GeForce RTX 4070".into());
        capability.support_evidence = Some("theoretical".into());
        apply_cuda_support_evidence(&mut capability);
        assert_eq!(capability.support_evidence.as_deref(), Some("theoretical"));
    }

    #[test]
    fn native_cuda_runtime_verifies_exact_closed_tree_and_rejects_tampering() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("current");
        write_native_cuda_runtime(&root);
        let verified = verify_native_asr_cuda_runtime_at(&root).unwrap();
        assert_eq!(verified.0, root);
        assert_eq!(verified.2, NATIVE_ASR_CUDA_ARTIFACT_ID);

        fs::write(root.join("cublas64_12.dll"), b"tampered").unwrap();
        assert!(verify_native_asr_cuda_runtime_at(&root)
            .unwrap_err()
            .contains("损坏"));

        write_native_cuda_runtime(&root);
        fs::write(root.join("unexpected.dll"), b"unexpected").unwrap();
        assert!(verify_native_asr_cuda_runtime_at(&root)
            .unwrap_err()
            .contains("闭集"));
    }

    #[test]
    fn native_cpu_runtime_resolves_same_locked_layout_for_installed_and_portable_resources() {
        for mode in ["installed", "portable"] {
            let temp = tempfile::tempdir().unwrap();
            let resource_dir = temp.path().join(mode).join("resources");
            let expected_root = write_native_runtime(&resource_dir, NATIVE_ASR_CPU_ARTIFACT_ID);

            let runtime = resolve_native_asr_cpu_runtime_at(&resource_dir).unwrap();

            assert_eq!(runtime.root, expected_root);
            assert_eq!(runtime.worker, expected_root.join(NATIVE_ASR_CPU_WORKER));
            assert_eq!(runtime.artifact_id, NATIVE_ASR_CPU_ARTIFACT_ID);
        }
    }

    #[test]
    fn native_cpu_runtime_rejects_missing_or_wrong_identity() {
        let temp = tempfile::tempdir().unwrap();
        let resource_dir = temp.path().join("resources");
        assert!(resolve_native_asr_cpu_runtime_at(&resource_dir).is_err());

        write_native_runtime(&resource_dir, "wrong-artifact");
        let error = resolve_native_asr_cpu_runtime_at(&resource_dir).unwrap_err();
        assert!(error.contains("身份或能力"));

        for engines in [
            vec!["faster-whisper"],
            vec!["kotoba-faster-whisper", "faster-whisper"],
            vec!["faster-whisper", "kotoba-faster-whisper", "qwen3-asr"],
        ] {
            let temp = tempfile::tempdir().unwrap();
            let resource_dir = temp.path().join("resources");
            write_native_runtime_with_engines(&resource_dir, NATIVE_ASR_CPU_ARTIFACT_ID, &engines);
            let error = resolve_native_asr_cpu_runtime_at(&resource_dir).unwrap_err();
            assert!(error.contains("身份或能力"));
        }
    }

    #[test]
    fn native_model_dependency_item_maps_exact_readiness_without_python_kinds() {
        let root = PathBuf::from("deps").join("models");
        let ready = native_model_dependency_item(
            &root,
            NativeAsrModelStatus {
                engine: "faster-whisper".into(),
                model: "large-v3".into(),
                backend: Some("ctranslate2".into()),
                revision: Some("revision".into()),
                disposition: NativeAsrModelDisposition::Ready,
                origin: Some(NativeAsrModelOrigin::DirectInstall),
                resolved_path: Some(root.join("ctranslate2").join("large-v3")),
            },
        );
        assert_eq!(ready.kind, RuntimeDependencyKind::AsrModels);
        assert_eq!(ready.status, RuntimeDependencyStatus::Available);
        assert_eq!(ready.source.as_deref(), Some("directInstall"));
        assert_eq!(ready.version.as_deref(), Some("revision"));

        let emitted = [
            RuntimeDependencyKind::Ffmpeg,
            RuntimeDependencyKind::NativeAsrCpu,
            ready.kind,
        ];
        assert!(!emitted.contains(&RuntimeDependencyKind::Python311));
        assert!(!emitted.contains(&RuntimeDependencyKind::AsrVenv));
    }

    #[test]
    fn dependency_paths_ignore_app_data_even_for_debug_builds() {
        let exe = PathBuf::from("C:/Users/example/AppData/Local/Programs/hikaru-sub")
            .join("hikaru-sub.exe");
        let app_data = PathBuf::from("C:/Users/example/AppData/Roaming/com.hikaru.sub");
        let deps = deps_dir_for_runtime(&exe, Some(&app_data)).unwrap();

        assert_eq!(
            deps,
            PathBuf::from("C:/Users/example/AppData/Local/Programs/hikaru-sub").join("deps")
        );
        assert!(!deps.starts_with(app_data));
    }

    #[test]
    fn ffmpeg_probe_replaces_peer_ffprobe_name() {
        assert_eq!(
            peer_ffprobe_path("C:/tools/ffmpeg.exe"),
            "C:/tools/ffprobe.exe"
        );
        assert_eq!(peer_ffprobe_path("/opt/bin/ffmpeg"), "/opt/bin/ffprobe");
    }

    #[test]
    fn dir_size_sums_nested_files() {
        let temp = tempfile::tempdir().unwrap();
        let nested = temp.path().join("a").join("b");
        fs::create_dir_all(&nested).unwrap();
        fs::write(temp.path().join("root.bin"), [1u8; 10]).unwrap();
        fs::write(nested.join("leaf.bin"), [1u8; 7]).unwrap();

        assert_eq!(dir_size(temp.path()), 17);
        assert_eq!(dir_size(&temp.path().join("missing")), 0);
    }

    #[test]
    fn app_cache_measure_skips_webview_and_preserves_current_video() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("EBWebView").join("Default")).unwrap();
        fs::write(
            root.join("EBWebView").join("Default").join("big.bin"),
            [1u8; 100],
        )
        .unwrap();
        fs::create_dir_all(root.join("preview")).unwrap();
        fs::write(root.join("preview").join("a.png"), [1u8; 7]).unwrap();
        fs::create_dir_all(root.join("workspace").join("keep")).unwrap();
        fs::write(
            root.join("workspace").join("keep").join("audio.wav"),
            [1u8; 11],
        )
        .unwrap();
        fs::create_dir_all(root.join("workspace").join("drop")).unwrap();
        fs::write(
            root.join("workspace").join("drop").join("audio.wav"),
            [1u8; 13],
        )
        .unwrap();
        fs::create_dir_all(root.join("transcode")).unwrap();
        fs::write(root.join("transcode").join("abcd.mp4"), [1u8; 17]).unwrap();
        fs::write(root.join("transcode").join("ffff.mp4"), [1u8; 19]).unwrap();

        // 直接指定 preserve keys 行为：通过临时视频路径不可用时，测 preview+全部 workspace+transcode
        let without_preserve = measure_app_cache_size(root, None);
        assert_eq!(without_preserve, 7 + 11 + 13 + 17 + 19);

        // 伪造 preserve：用 cleanup/measure 的子函数验证
        assert_eq!(
            measure_workspace_cache_size(&root.join("workspace"), Some("keep")),
            13
        );
        assert_eq!(
            measure_transcode_cache_size(&root.join("transcode"), Some("abcd")),
            19
        );
    }

    #[test]
    fn app_cache_measure_only_counts_cache_subdir() {
        let temp = tempfile::tempdir().unwrap();
        let app_root = temp.path();
        let cache_root = app_root.join("cache");
        fs::create_dir_all(cache_root.join("preview")).unwrap();
        fs::write(cache_root.join("preview").join("a.png"), [1u8; 5]).unwrap();
        fs::create_dir_all(app_root.join("EBWebView")).unwrap();
        fs::write(app_root.join("EBWebView").join("x.bin"), [1u8; 50]).unwrap();
        // 旧版路径残留：不计入占用，也不由应用缓存清理
        fs::create_dir_all(app_root.join("clip-frames")).unwrap();
        fs::write(app_root.join("clip-frames").join("a.jpg"), [1u8; 9]).unwrap();

        assert_eq!(measure_app_cache_size(&cache_root, None), 5);

        cleanup_app_cache_dir(&cache_root, None).unwrap();
        assert!(!cache_root.join("preview").exists());
        assert!(app_root.join("clip-frames").join("a.jpg").is_file());
        assert!(app_root.join("EBWebView").join("x.bin").is_file());
    }

    #[test]
    fn cleanup_rejects_paths_outside_deps() {
        let deps = PathBuf::from("C:/Users/example/AppData/Local/Programs/hikaru-sub/deps");
        let outside = PathBuf::from("C:/Users/example/Documents");

        assert!(!path_is_under(&outside, &deps));
    }

    #[test]
    fn writability_probe_path_stays_under_deps() {
        let deps = PathBuf::from("C:/Users/example/AppData/Local/Programs/hikaru-sub/deps");
        let probe = deps_writability_probe_path(&deps);

        assert!(path_is_under(&probe, &deps));
        assert!(probe
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("hikaru-sub-write-test-"));
    }

    #[test]
    fn elevation_command_restarts_current_executable_with_runas() {
        let exe = PathBuf::from("C:/Program Files/hikaru-sub/hikaru-sub.exe");
        let command = elevation_powershell_command(&exe);

        assert!(command.contains("Start-Process"));
        assert!(command.contains("-Verb RunAs"));
        assert!(command.contains("C:/Program Files/hikaru-sub/hikaru-sub.exe"));
    }

    #[test]
    fn source_selection_uses_runtime_source_mode() {
        let china = AppSettings {
            runtime_source_mode: RuntimeDependencySourceMode::China,
            ..Default::default()
        };
        assert_eq!(
            effective_source_id(&china),
            RuntimeDependencySourceId::China
        );

        let official = AppSettings {
            runtime_source_mode: RuntimeDependencySourceMode::Official,
            ..Default::default()
        };
        assert_eq!(
            effective_source_id(&official),
            RuntimeDependencySourceId::Official
        );
    }

    #[test]
    fn sha256_file_hashes_known_content() {
        let path = std::env::temp_dir().join(format!("hikaru_sub_sha256_{}.txt", unique_suffix()));
        std::fs::write(&path, b"abc").unwrap();

        let hash = sha256_file(&path).unwrap();

        assert_eq!(
            hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn binary_download_logs_source_url_and_target_file() {
        let job = Arc::new(StdMutex::new(RuntimeDependencyJob::new(
            "job-1".into(),
            RuntimeDependencyKind::Ffmpeg,
        )));
        let source = RuntimeDependencyBinarySource {
            url: "https://mirror.example/ffmpeg.zip".into(),
            sha256: "checksum".into(),
            size_bytes: 42,
            archive: RuntimeDependencyArchive::Zip,
            strip_prefix: None,
        };
        let target = PathBuf::from("C:/install/hikaru-sub/deps/downloads/ffmpeg-runtime.zip");

        log_binary_download_start(&job, &source, &target);

        let snapshot = job.lock().unwrap().snapshot();
        assert!(snapshot
            .log_tail
            .iter()
            .any(|line| line == "下载地址：https://mirror.example/ffmpeg.zip"));
        assert!(snapshot.log_tail.iter().any(|line| {
            line.contains("保存位置：")
                && line.contains("C:/install/hikaru-sub/deps/downloads/ffmpeg-runtime.zip")
        }));
    }

    #[test]
    fn managed_python_verification_finds_nested_python_executable() {
        let root =
            std::env::temp_dir().join(format!("hikaru_sub_python_install_{}", unique_suffix()));
        let nested = root.join("Python311");
        std::fs::create_dir_all(&nested).unwrap();
        let python = nested.join(exe_name("python"));
        std::fs::write(&python, b"").unwrap();

        let found = find_managed_python_executable(&root).unwrap();

        assert_eq!(found, python);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn managed_python_missing_message_includes_install_directory_snapshot() {
        let root =
            std::env::temp_dir().join(format!("hikaru_sub_python_missing_{}", unique_suffix()));
        std::fs::create_dir_all(root.join("logs")).unwrap();
        std::fs::write(root.join("install.log"), b"").unwrap();

        let message = missing_managed_python_message(&root);

        assert!(message.contains("Python 安装完成后未找到 python.exe"));
        assert!(message.contains("install.log"));
        assert!(message.contains("logs/"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn python_installer_args_pin_target_dir_and_log_path() {
        let target = PathBuf::from("F:/Hikaru Sub/deps/python311/current.temp");
        let log = PathBuf::from("F:/Hikaru Sub/deps/downloads/python311-install.log");

        let args = python_installer_args(&target, &log);

        assert!(args.contains(&"TargetDir=F:/Hikaru Sub/deps/python311/current.temp".into()));
        assert!(args.contains(
            &"DefaultJustForMeTargetDir=F:/Hikaru Sub/deps/python311/current.temp".into()
        ));
        assert!(args.contains(&"/log".into()));
        assert!(args.contains(&"F:/Hikaru Sub/deps/downloads/python311-install.log".into()));
    }

    #[test]
    fn python_runtime_download_name_matches_archive_type() {
        assert_eq!(
            python_runtime_download_file_name(RuntimeDependencyArchive::TarGz),
            "python311-runtime.tar.gz"
        );
        assert_eq!(
            python_runtime_download_file_name(RuntimeDependencyArchive::Zip),
            "python311-runtime.zip"
        );
    }

    #[test]
    fn archive_payload_root_uses_declared_strip_prefix() {
        let root =
            std::env::temp_dir().join(format!("hikaru_sub_python_archive_{}", unique_suffix()));
        std::fs::create_dir_all(root.join("python")).unwrap();
        std::fs::write(root.join("python").join(exe_name("python")), b"").unwrap();

        let payload = archive_payload_root(&root, Some("python")).unwrap();

        assert_eq!(payload, root.join("python"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn python_prepare_cleans_stale_current_temp_dirs_only() {
        let root =
            std::env::temp_dir().join(format!("hikaru_sub_python_stale_{}", unique_suffix()));
        let target = root.join("current");
        let stale = root.join("current.123");
        let unrelated = root.join("other.123");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::create_dir_all(&stale).unwrap();
        std::fs::create_dir_all(&unrelated).unwrap();

        cleanup_stale_current_temp_dirs(&target);

        assert!(target.exists());
        assert!(!stale.exists());
        assert!(unrelated.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn managed_venv_python_uses_platform_layout() {
        let service = PathBuf::from("deps").join("asr-service");
        let path = managed_asr_venv_python_path(&service);

        if cfg!(windows) {
            assert!(path.ends_with(Path::new(".venv").join("Scripts").join("python.exe")));
        } else {
            assert!(path.ends_with(Path::new(".venv").join("bin").join("python")));
        }
    }

    fn create_fake_repo(root: &Path) {
        std::fs::create_dir_all(root.join("src-tauri")).unwrap();
        std::fs::create_dir_all(root.join("asr-service")).unwrap();
        std::fs::write(root.join("src-tauri").join("tauri.conf.json"), "{}").unwrap();
        std::fs::write(root.join("package.json"), "{}").unwrap();
        std::fs::write(root.join("asr-service").join("main.py"), "").unwrap();
    }

    #[test]
    fn source_checkout_asr_service_requires_exact_repo_asr_service_path() {
        let root =
            std::env::temp_dir().join(format!("hikaru_sub_asr_checkout_exact_{}", unique_suffix()));
        create_fake_repo(&root);

        let service = root.join("asr-service");
        assert!(is_source_checkout_asr_service_dir(&service));

        let resources = root.join("src-tauri").join("resources").join("asr-service");
        std::fs::create_dir_all(&resources).unwrap();
        std::fs::write(resources.join("main.py"), "").unwrap();
        assert!(!is_source_checkout_asr_service_dir(&resources));

        let managed = root
            .join("src-tauri")
            .join("target")
            .join("debug")
            .join("deps")
            .join("asr-service");
        std::fs::create_dir_all(&managed).unwrap();
        std::fs::write(managed.join("main.py"), "").unwrap();
        assert!(!is_source_checkout_asr_service_dir(&managed));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn effective_asr_service_prefers_source_checkout_in_dev() {
        let root =
            std::env::temp_dir().join(format!("hikaru_sub_asr_effective_dev_{}", unique_suffix()));
        create_fake_repo(&root);
        let exe = root
            .join("src-tauri")
            .join("target")
            .join("debug")
            .join("hikaru-sub.exe");
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();

        let resolved = resolve_effective_asr_service_dir(None, &exe, true, Some(&root)).unwrap();

        assert_eq!(resolved, root.join("asr-service"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn effective_asr_service_uses_exe_deps_when_not_preferring_checkout() {
        let root = std::env::temp_dir().join(format!(
            "hikaru_sub_asr_effective_release_{}",
            unique_suffix()
        ));
        create_fake_repo(&root);
        let install = root.join("install");
        let exe = install.join("hikaru-sub.exe");
        std::fs::create_dir_all(&install).unwrap();

        let resolved = resolve_effective_asr_service_dir(None, &exe, false, Some(&root)).unwrap();

        assert_eq!(resolved, install.join("deps").join("asr-service"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn effective_asr_service_honors_configured_path() {
        let root = std::env::temp_dir().join(format!(
            "hikaru_sub_asr_effective_configured_{}",
            unique_suffix()
        ));
        create_fake_repo(&root);
        let custom = root.join("custom-asr");
        std::fs::create_dir_all(&custom).unwrap();
        std::fs::write(custom.join("main.py"), "").unwrap();
        let exe = root
            .join("src-tauri")
            .join("target")
            .join("debug")
            .join("hikaru-sub.exe");
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();

        let resolved =
            resolve_effective_asr_service_dir(custom.to_str(), &exe, true, Some(&root)).unwrap();

        assert_eq!(resolved, custom);
        let _ = std::fs::remove_dir_all(root);
    }
}
