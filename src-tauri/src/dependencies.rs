use crate::process::hidden_command;
use crate::settings::{
    load_settings, save_settings, AppSettings, CustomRuntimeSourceProfile,
    RuntimeDependencySourceMode,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

const LOG_TAIL_LIMIT: usize = 200;
const MANIFEST_JSON: &str = include_str!("../resources/runtime-dependency-sources.json");

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeDependencyKind {
    Ffmpeg,
    Python311,
    AsrVenv,
    AsrModels,
    Downloads,
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
    Custom,
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
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencyProbe {
    pub items: Vec<RuntimeDependencyItem>,
    pub source_mode: RuntimeDependencySourceMode,
    pub effective_source: RuntimeDependencySourceId,
    pub recommended_source: Option<RuntimeDependencySourceId>,
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

pub fn managed_ffmpeg_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("ffmpeg").join("current"))
}

pub fn managed_python_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("python311").join("current"))
}

pub fn managed_asr_service_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("asr-service"))
}

/// 判断目录是否位于源码仓库 checkout 的 `asr-service`（与 settings 启发式对齐）。
pub fn is_source_checkout_asr_service_dir(service_dir: &Path) -> bool {
    if !service_dir.join("main.py").is_file() {
        return false;
    }
    service_dir.ancestors().any(|ancestor| {
        ancestor.join("src-tauri").join("tauri.conf.json").is_file()
            && (ancestor.join("package.json").is_file()
                || ancestor.join("pnpm-workspace.yaml").is_file())
            && ancestor.join("asr-service").join("main.py").is_file()
    })
}

fn looks_like_repo_root(dir: &Path) -> bool {
    dir.join("src-tauri").join("tauri.conf.json").is_file()
        && (dir.join("package.json").is_file() || dir.join("pnpm-workspace.yaml").is_file())
        && dir.join("asr-service").join("main.py").is_file()
}

/// 从起点向上查找仓库根；`cwd_hint` 可覆盖 `current_dir`（便于测试）。
pub fn find_source_checkout_root(
    exe_path: &Path,
    cwd_hint: Option<&Path>,
) -> Option<PathBuf> {
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
    resolve_effective_asr_service_dir(
        configured,
        &exe,
        cfg!(debug_assertions),
        None,
    )
}

pub fn managed_model_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("models").join("huggingface"))
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

pub fn python311_candidates(
    settings: &AppSettings,
    managed_python: Option<&Path>,
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

pub fn resolve_python311(app: &AppHandle, settings: &AppSettings) -> Option<ResolvedPython> {
    let managed = managed_python_dir(app).ok();
    let settings_path = settings
        .python_path
        .as_deref()
        .filter(|s| !s.trim().is_empty());
    python311_candidates(settings, managed.as_deref())
        .into_iter()
        .find_map(|candidate| {
            let version = python_version(&candidate).ok()?;
            let managed_path = managed.as_deref().is_some_and(|dir| {
                path_is_under(Path::new(&candidate.program), dir)
                    || Path::new(&candidate.program) == dir.join("python.exe")
            });
            let source = if settings_path == Some(candidate.program.as_str()) {
                "settings"
            } else if managed_path {
                "managed"
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

fn parse_source_id(value: &str) -> Option<RuntimeDependencySourceId> {
    match value {
        "official" => Some(RuntimeDependencySourceId::Official),
        "china" => Some(RuntimeDependencySourceId::China),
        "custom" => Some(RuntimeDependencySourceId::Custom),
        _ => None,
    }
}

fn source_id_to_settings_value(id: RuntimeDependencySourceId) -> &'static str {
    match id {
        RuntimeDependencySourceId::Official => "official",
        RuntimeDependencySourceId::China => "china",
        RuntimeDependencySourceId::Custom => "custom",
    }
}

fn effective_source_id(settings: &AppSettings) -> RuntimeDependencySourceId {
    match settings.runtime_source_mode {
        RuntimeDependencySourceMode::Official => RuntimeDependencySourceId::Official,
        RuntimeDependencySourceMode::China => RuntimeDependencySourceId::China,
        RuntimeDependencySourceMode::Custom => RuntimeDependencySourceId::Custom,
        RuntimeDependencySourceMode::Auto => settings
            .runtime_recommended_profile
            .as_deref()
            .and_then(parse_source_id)
            .filter(|id| *id != RuntimeDependencySourceId::Custom)
            .unwrap_or(RuntimeDependencySourceId::Official),
    }
}

pub fn effective_source_profile(
    settings: &AppSettings,
) -> Result<RuntimeDependencySourceProfile, String> {
    let sources = platform_sources()?;
    let id = effective_source_id(settings);
    let profile = match id {
        RuntimeDependencySourceId::Official => sources.official,
        RuntimeDependencySourceId::China => sources.china,
        RuntimeDependencySourceId::Custom => {
            apply_custom_source_profile(sources.official, &settings.runtime_custom_source)
        }
    };
    Ok(profile)
}

fn apply_custom_source_profile(
    mut base: RuntimeDependencySourceProfile,
    custom: &CustomRuntimeSourceProfile,
) -> RuntimeDependencySourceProfile {
    base.id = RuntimeDependencySourceId::Custom;
    base.label = "自定义".into();
    if let (Some(source), Some(url)) = (base.ffmpeg.as_mut(), custom.ffmpeg_url.as_deref()) {
        if !url.trim().is_empty() {
            source.url = url.trim().to_string();
        }
    }
    if let (Some(source), Some(url)) = (base.python311.as_mut(), custom.python311_url.as_deref()) {
        if !url.trim().is_empty() {
            source.url = url.trim().to_string();
        }
    }
    if custom
        .pip_index_url
        .as_deref()
        .is_some_and(|url| !url.trim().is_empty())
    {
        base.pip_index_url = custom.pip_index_url.clone();
    }
    if !custom.pip_extra_index_urls.is_empty() {
        base.pip_extra_index_urls = custom.pip_extra_index_urls.clone();
    }
    if custom
        .pytorch_cpu_index_url
        .as_deref()
        .is_some_and(|url| !url.trim().is_empty())
    {
        base.pytorch_cpu_index_url = custom.pytorch_cpu_index_url.clone();
    }
    if custom
        .pytorch_cuda_index_url
        .as_deref()
        .is_some_and(|url| !url.trim().is_empty())
    {
        base.pytorch_cuda_index_url = custom.pytorch_cuda_index_url.clone();
    }
    if custom
        .pytorch_cpu_find_links_url
        .as_deref()
        .is_some_and(|url| !url.trim().is_empty())
    {
        base.pytorch_cpu_find_links_url = custom.pytorch_cpu_find_links_url.clone();
    }
    if custom
        .pytorch_cuda_find_links_url
        .as_deref()
        .is_some_and(|url| !url.trim().is_empty())
    {
        base.pytorch_cuda_find_links_url = custom.pytorch_cuda_find_links_url.clone();
    }
    if custom
        .huggingface_endpoint
        .as_deref()
        .is_some_and(|url| !url.trim().is_empty())
    {
        base.huggingface_endpoint = custom.huggingface_endpoint.clone();
    }
    base
}

fn recommended_source(settings: &AppSettings) -> Option<RuntimeDependencySourceId> {
    settings
        .runtime_recommended_profile
        .as_deref()
        .and_then(parse_source_id)
        .filter(|id| *id != RuntimeDependencySourceId::Custom)
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

async fn download_binary_source(
    app: &AppHandle,
    job: &Arc<StdMutex<RuntimeDependencyJob>>,
    source: &RuntimeDependencyBinarySource,
    file_name: &str,
) -> Result<PathBuf, String> {
    let dir = downloads_dir(app)?;
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
        RuntimeDependencyKind::Python311 => prepare_python311(&app, &job, &profile).await,
        RuntimeDependencyKind::AsrVenv => Err("ASR 引擎依赖由 ASR 一键配置流程准备".into()),
        RuntimeDependencyKind::AsrModels => Err("ASR 模型由模型管理器按具体引擎和模型下载".into()),
        RuntimeDependencyKind::Downloads => Err("下载缓存不需要准备".into()),
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
            if path.is_dir() {
                dir_size(&path)
            } else {
                entry.metadata().map(|m| m.len()).unwrap_or(0)
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
    if canonical
        .file_name()
        .is_some_and(|name| name == ".venv")
    {
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
        RuntimeDependencyKind::Python311 => managed_python_dir(app),
        RuntimeDependencyKind::AsrVenv => {
            let settings = load_settings(app).unwrap_or_default();
            Ok(effective_asr_service_dir(app, settings.asr_service_path.as_deref())?
                .join(".venv"))
        }
        RuntimeDependencyKind::AsrModels => managed_model_cache_dir(app),
        RuntimeDependencyKind::Downloads => downloads_dir(app),
    }
}

fn probe_runtime_dependencies_inner(app: &AppHandle) -> Result<RuntimeDependencyProbe, String> {
    let settings = load_settings(app).unwrap_or_default();
    let source_mode = settings.runtime_source_mode.clone();
    let effective_source = effective_source_id(&settings);
    let recommended_source = recommended_source(&settings);
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
    let ffmpeg_size = ffmpeg_managed_dir.as_deref().map_or(0, dir_size).max(
        source_profile
            .as_ref()
            .and_then(|profile| profile.ffmpeg.as_ref())
            .map(|source| source.size_bytes)
            .filter(|_| ffmpeg.source == ResolvedFfmpegSource::Missing)
            .unwrap_or(0),
    );
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
        size_bytes: ffmpeg_size,
    });

    let python = resolve_python311(app, &settings);
    let python_managed_dir = managed_python_dir(app).ok();
    let python_size = python_managed_dir.as_deref().map_or(0, dir_size).max(
        source_profile
            .as_ref()
            .and_then(|profile| profile.python311.as_ref())
            .map(|source| source.size_bytes)
            .filter(|_| python.is_none())
            .unwrap_or(0),
    );
    items.push(RuntimeDependencyItem {
        kind: RuntimeDependencyKind::Python311,
        status: if python.is_some() {
            RuntimeDependencyStatus::Available
        } else {
            RuntimeDependencyStatus::Missing
        },
        path: python
            .as_ref()
            .map(|value| value.command.clone())
            .or_else(|| {
                python_managed_dir
                    .as_ref()
                    .map(|path| path.to_string_lossy().into_owned())
            }),
        source: python.as_ref().map(|value| value.source.clone()),
        version: python.as_ref().map(|value| value.version.clone()),
        managed: python.as_ref().is_some_and(|value| value.managed),
        size_bytes: python_size,
    });

    let service = effective_asr_service_dir(app, settings.asr_service_path.as_deref())?;
    let venv_python = managed_asr_venv_python_path(&service);
    let source_checkout = is_source_checkout_asr_service_dir(&service);
    items.push(RuntimeDependencyItem {
        kind: RuntimeDependencyKind::AsrVenv,
        status: if venv_python.is_file() {
            RuntimeDependencyStatus::Available
        } else {
            RuntimeDependencyStatus::NeedsSetup
        },
        path: Some(service.to_string_lossy().into_owned()),
        source: Some(if source_checkout {
            "source".into()
        } else {
            "managed".into()
        }),
        version: None,
        managed: !source_checkout,
        size_bytes: dir_size(&service.join(".venv")),
    });

    let models = managed_model_cache_dir(app)?;
    let models_size = dir_size(&models);
    items.push(RuntimeDependencyItem {
        kind: RuntimeDependencyKind::AsrModels,
        status: if models_size > 0 {
            RuntimeDependencyStatus::Available
        } else {
            RuntimeDependencyStatus::Missing
        },
        path: Some(models.to_string_lossy().into_owned()),
        source: Some("managed".into()),
        version: None,
        managed: true,
        size_bytes: models_size,
    });

    let downloads = downloads_dir(app)?;
    let downloads_size = dir_size(&downloads);
    items.push(RuntimeDependencyItem {
        kind: RuntimeDependencyKind::Downloads,
        status: if downloads_size > 0 {
            RuntimeDependencyStatus::Available
        } else {
            RuntimeDependencyStatus::Missing
        },
        path: Some(downloads.to_string_lossy().into_owned()),
        source: Some("managed".into()),
        version: None,
        managed: true,
        size_bytes: downloads_size,
    });

    Ok(RuntimeDependencyProbe {
        items,
        source_mode,
        effective_source,
        recommended_source,
    })
}

async fn probe_profile_latency(profile: &RuntimeDependencySourceProfile) -> Option<u128> {
    let url = profile
        .python311
        .as_ref()
        .or(profile.ffmpeg.as_ref())
        .map(|source| source.url.as_str())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;
    let started = Instant::now();
    let response = client.head(url).send().await.ok()?;
    if response.status().is_success() || response.status().is_redirection() {
        Some(started.elapsed().as_millis())
    } else {
        None
    }
}

#[tauri::command]
pub async fn probe_runtime_dependencies(app: AppHandle) -> Result<RuntimeDependencyProbe, String> {
    probe_runtime_dependencies_inner(&app)
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
    state.jobs.lock().await.insert(id.clone(), Arc::clone(&job));

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
    args: CleanupRuntimeDependencyArgs,
) -> Result<(), String> {
    ensure_runtime_deps_writable_or_elevate(&app)?;
    let deps = deps_dir(&app)?;
    fs::create_dir_all(&deps).map_err(|e| e.to_string())?;
    let target = cleanup_target_for_kind(&app, args.kind)?;
    safe_remove_runtime_dependency_dir(&target, &deps)
}

#[tauri::command]
pub async fn probe_download_sources(app: AppHandle) -> Result<RuntimeDependencyProbe, String> {
    let mut settings = load_settings(&app).unwrap_or_default();
    let sources = platform_sources()?;
    let official = probe_profile_latency(&sources.official).await;
    let china = probe_profile_latency(&sources.china).await;
    let recommendation = match (official, china) {
        (Some(official), Some(china)) => {
            if china <= official {
                RuntimeDependencySourceId::China
            } else {
                RuntimeDependencySourceId::Official
            }
        }
        (None, Some(_)) => RuntimeDependencySourceId::China,
        _ => RuntimeDependencySourceId::Official,
    };
    settings.runtime_recommended_profile =
        Some(source_id_to_settings_value(recommendation).to_string());
    settings.runtime_recommendation_checked_at = Some(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_else(|_| "0".into()),
    );
    save_settings(&app, &settings)?;
    probe_runtime_dependencies_inner(&app)
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

        let candidates =
            python311_candidates(&settings, Some(Path::new("C:/managed/python311/current")));

        assert_eq!(
            candidates.first().unwrap().program,
            "C:/Python311/python.exe"
        );
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
    fn source_selection_prefers_manual_mode_over_recommendation() {
        let settings = AppSettings {
            runtime_source_mode: RuntimeDependencySourceMode::China,
            runtime_recommended_profile: Some("official".into()),
            ..Default::default()
        };

        assert_eq!(
            effective_source_id(&settings),
            RuntimeDependencySourceId::China
        );
    }

    #[test]
    fn source_selection_uses_auto_recommendation() {
        let settings = AppSettings {
            runtime_source_mode: RuntimeDependencySourceMode::Auto,
            runtime_recommended_profile: Some("china".into()),
            ..Default::default()
        };

        assert_eq!(
            effective_source_id(&settings),
            RuntimeDependencySourceId::China
        );
    }

    #[test]
    fn source_selection_falls_back_to_official() {
        let settings = AppSettings {
            runtime_source_mode: RuntimeDependencySourceMode::Auto,
            runtime_recommended_profile: None,
            ..Default::default()
        };

        assert_eq!(
            effective_source_id(&settings),
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
    fn effective_asr_service_prefers_source_checkout_in_dev() {
        let root = std::env::temp_dir().join(format!(
            "hikaru_sub_asr_effective_dev_{}",
            unique_suffix()
        ));
        create_fake_repo(&root);
        let exe = root
            .join("src-tauri")
            .join("target")
            .join("debug")
            .join("hikaru-sub.exe");
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();

        let resolved = resolve_effective_asr_service_dir(
            None,
            &exe,
            true,
            Some(&root),
        )
        .unwrap();

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

        let resolved = resolve_effective_asr_service_dir(
            None,
            &exe,
            false,
            Some(&root),
        )
        .unwrap();

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

        let resolved = resolve_effective_asr_service_dir(
            custom.to_str(),
            &exe,
            true,
            Some(&root),
        )
        .unwrap();

        assert_eq!(resolved, custom);
        let _ = std::fs::remove_dir_all(root);
    }
}
