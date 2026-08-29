//! Native ASR model delivery used by the production model commands and inference route.

#![allow(dead_code)]

use crate::asr_worker::native_job_id;
use crate::dependencies::{
    effective_source_profile, ensure_runtime_deps_writable_or_elevate,
    managed_ctranslate2_model_dir, managed_downloads_dir, managed_model_cache_dir,
    RuntimeDependencySourceId, RuntimeDependencySourceProfile,
};
use crate::settings::load_settings;
use futures::StreamExt;
use reqwest::header::{CONTENT_RANGE, RANGE};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

const MANIFEST_JSON: &str = include_str!("../resources/native-asr-models.json");
const OFFICIAL_ENDPOINT: &str = "https://huggingface.co";
const REQUIRED_ROLES: [&str; 4] = ["model-config", "model-weights", "tokenizer", "vocabulary"];
const POST_MVP_MODELS: [(&str, &str); 10] = [
    ("faster-whisper", "tiny"),
    ("faster-whisper", "base"),
    ("faster-whisper", "small"),
    ("faster-whisper", "medium"),
    ("faster-whisper", "large-v2"),
    ("faster-whisper", "large-v3-turbo"),
    (
        "kotoba-faster-whisper",
        "kotoba-tech/kotoba-whisper-v2.0-faster",
    ),
    ("parakeet", "nvidia/parakeet-tdt_ctc-0.6b-ja"),
    ("qwen3-asr", "Qwen/Qwen3-ASR-1.7B"),
    ("reazonspeech-nemo", "reazon-research/reazonspeech-nemo-v2"),
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelManifest {
    schema_version: u32,
    models: Vec<ManifestModel>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
struct ManifestModel {
    logical_id: String,
    engine: String,
    model: String,
    backend: String,
    format: String,
    repository: String,
    revision: String,
    license: ModelLicense,
    files: Vec<ManifestFile>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
struct ModelLicense {
    spdx: String,
    attribution: String,
    source: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    role: String,
    path: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Clone)]
struct ManagedModelRoots {
    direct: PathBuf,
    legacy_huggingface: PathBuf,
    downloads: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ReadyCacheKey {
    direct_root: PathBuf,
    legacy_root: PathBuf,
    model: ManifestModel,
}

impl ReadyCacheKey {
    fn new(roots: &ManagedModelRoots, model: &ManifestModel) -> Self {
        Self {
            direct_root: roots.direct.clone(),
            legacy_root: roots.legacy_huggingface.clone(),
            model: model.clone(),
        }
    }
}

impl ManagedModelRoots {
    fn from_app(app: &AppHandle) -> Result<Self, String> {
        Ok(Self {
            direct: managed_ctranslate2_model_dir(app)?,
            legacy_huggingface: managed_model_cache_dir(app)?,
            downloads: managed_downloads_dir(app)?.join("native-asr-models"),
        })
    }

    #[cfg(test)]
    fn below(deps: &Path) -> Self {
        Self {
            direct: deps.join("models").join("ctranslate2"),
            legacy_huggingface: deps.join("models").join("huggingface"),
            downloads: deps.join("downloads").join("native-asr-models"),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum NativeAsrModelDisposition {
    SupportedMissing,
    Ready,
    PostMvpUnavailable,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum NativeAsrModelOrigin {
    DirectInstall,
    LegacyHuggingFaceSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeAsrModelStatus {
    pub engine: String,
    pub model: String,
    pub backend: Option<String>,
    pub revision: Option<String>,
    pub disposition: NativeAsrModelDisposition,
    pub origin: Option<NativeAsrModelOrigin>,
    #[serde(skip)]
    pub resolved_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedNativeAsrModel {
    pub logical_id: String,
    pub backend: String,
    pub revision: String,
    pub path: PathBuf,
    pub origin: NativeAsrModelOrigin,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ModelDownloadJobStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelDownloadSnapshot {
    pub id: String,
    pub engine: String,
    pub model: String,
    pub revision: String,
    pub status: ModelDownloadJobStatus,
    pub progress: Option<f64>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub source_endpoint: String,
    pub resolved_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug)]
struct ModelDownloadJob {
    snapshot: ModelDownloadSnapshot,
}

#[derive(Default)]
struct ManagerState {
    jobs: HashMap<String, Arc<StdMutex<ModelDownloadJob>>>,
    active_by_model: HashMap<String, String>,
}

#[derive(Clone, Default)]
pub(crate) struct NativeAsrModelManager {
    state: Arc<Mutex<ManagerState>>,
    ready_cache: Arc<StdMutex<HashMap<ReadyCacheKey, ResolvedNativeAsrModel>>>,
}

impl NativeAsrModelManager {
    pub(crate) async fn status(
        &self,
        app: &AppHandle,
        engine: &str,
        model: &str,
    ) -> Result<NativeAsrModelStatus, String> {
        self.status_with_roots(ManagedModelRoots::from_app(app)?, engine, model)
            .await
    }

    async fn status_with_roots(
        &self,
        roots: ManagedModelRoots,
        engine: &str,
        model: &str,
    ) -> Result<NativeAsrModelStatus, String> {
        let manifest = load_manifest()?;
        let Some(entry) = find_model(&manifest, engine, model) else {
            return Ok(unavailable_status(engine, model));
        };
        let entry = entry.clone();
        let resolved = self.resolve_entry_with_roots(roots, entry.clone()).await?;
        Ok(NativeAsrModelStatus {
            engine: engine.to_string(),
            model: model.to_string(),
            backend: Some(entry.backend.clone()),
            revision: Some(entry.revision.clone()),
            disposition: if resolved.is_some() {
                NativeAsrModelDisposition::Ready
            } else {
                NativeAsrModelDisposition::SupportedMissing
            },
            origin: resolved.as_ref().map(|value| value.origin),
            resolved_path: resolved.map(|value| value.path),
        })
    }

    pub(crate) async fn resolve_ready_model(
        &self,
        app: &AppHandle,
        engine: &str,
        model: &str,
    ) -> Result<Option<ResolvedNativeAsrModel>, String> {
        let manifest = load_manifest()?;
        let Some(entry) = find_model(&manifest, engine, model).cloned() else {
            return Ok(None);
        };
        let roots = ManagedModelRoots::from_app(app)?;
        self.resolve_entry_with_roots(roots, entry).await
    }

    async fn resolve_entry_with_roots(
        &self,
        roots: ManagedModelRoots,
        entry: ManifestModel,
    ) -> Result<Option<ResolvedNativeAsrModel>, String> {
        let key = ReadyCacheKey::new(&roots, &entry);
        if let Some(resolved) = self
            .ready_cache
            .lock()
            .map_err(|_| "Native ASR 模型验证缓存已损坏".to_string())?
            .get(&key)
            .cloned()
        {
            return Ok(Some(resolved));
        }
        let verify_roots = roots.clone();
        let verify_entry = entry.clone();
        let resolved = tauri::async_runtime::spawn_blocking(move || {
            resolve_sync(&verify_roots, &verify_entry)
        })
        .await
        .map_err(|error| format!("模型校验任务失败：{error}"))??;
        if let Some(ready) = resolved.as_ref() {
            self.remember_ready(&roots, &entry, ready.clone())?;
        }
        Ok(resolved)
    }

    fn remember_ready(
        &self,
        roots: &ManagedModelRoots,
        entry: &ManifestModel,
        resolved: ResolvedNativeAsrModel,
    ) -> Result<(), String> {
        self.ready_cache
            .lock()
            .map_err(|_| "Native ASR 模型验证缓存已损坏".to_string())?
            .insert(ReadyCacheKey::new(roots, entry), resolved);
        Ok(())
    }

    pub(crate) async fn start_download(
        &self,
        app: &AppHandle,
        engine: &str,
        model: &str,
    ) -> Result<String, String> {
        ensure_runtime_deps_writable_or_elevate(app)?;
        let manifest = load_manifest()?;
        let entry = find_model(&manifest, engine, model)
            .cloned()
            .ok_or_else(|| "当前 Native MVP 不提供该模型".to_string())?;
        let settings = load_settings(app).unwrap_or_default();
        let profile = effective_source_profile(&settings)?;
        self.start_download_for_model(
            entry,
            ManagedModelRoots::from_app(app)?,
            source_endpoint(&profile)?,
        )
        .await
    }

    async fn start_download_for_model(
        &self,
        entry: ManifestModel,
        roots: ManagedModelRoots,
        endpoint: String,
    ) -> Result<String, String> {
        let logical_id = entry.logical_id.clone();
        let total_bytes = entry.files.iter().map(|file| file.size_bytes).sum();
        let mut state = self.state.lock().await;
        if let Some(job_id) = state.active_by_model.get(&logical_id) {
            return Ok(job_id.clone());
        }
        let id = native_job_id();
        let job = Arc::new(StdMutex::new(ModelDownloadJob {
            snapshot: ModelDownloadSnapshot {
                id: id.clone(),
                engine: entry.engine.clone(),
                model: entry.model.clone(),
                revision: entry.revision.clone(),
                status: ModelDownloadJobStatus::Running,
                progress: Some(0.0),
                downloaded_bytes: 0,
                total_bytes,
                source_endpoint: endpoint.clone(),
                resolved_path: None,
                error: None,
            },
        }));
        state.jobs.insert(id.clone(), Arc::clone(&job));
        state.active_by_model.insert(logical_id.clone(), id.clone());
        drop(state);

        let manager = self.clone();
        let terminal_id = id.clone();
        tauri::async_runtime::spawn(async move {
            let result = run_download(&entry, &roots, &endpoint, &terminal_id, &job).await;
            if let Ok(mut guard) = job.lock() {
                match result {
                    Ok(ready) => {
                        let _ = manager.remember_ready(&roots, &entry, ready.clone());
                        guard.snapshot.status = ModelDownloadJobStatus::Completed;
                        guard.snapshot.progress = Some(1.0);
                        guard.snapshot.downloaded_bytes = guard.snapshot.total_bytes;
                        guard.snapshot.resolved_path =
                            Some(ready.path.to_string_lossy().into_owned());
                    }
                    Err(error) => {
                        guard.snapshot.status = ModelDownloadJobStatus::Failed;
                        guard.snapshot.error = Some(sanitize_error(&error));
                    }
                }
            }
            let mut state = manager.state.lock().await;
            if state.active_by_model.get(&logical_id) == Some(&terminal_id) {
                state.active_by_model.remove(&logical_id);
            }
        });
        Ok(id)
    }

    pub(crate) async fn job_snapshot(&self, id: &str) -> Option<ModelDownloadSnapshot> {
        let state = self.state.lock().await;
        state
            .jobs
            .get(id)
            .and_then(|job| job.lock().ok().map(|guard| guard.snapshot.clone()))
    }
}

fn load_manifest() -> Result<ModelManifest, String> {
    parse_manifest(MANIFEST_JSON)
}

fn parse_manifest(json: &str) -> Result<ModelManifest, String> {
    let manifest: ModelManifest =
        serde_json::from_str(json).map_err(|error| format!("模型清单格式无效：{error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &ModelManifest) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err(format!(
            "不支持的 Native ASR 模型清单版本：{}",
            manifest.schema_version
        ));
    }
    if manifest.models.is_empty() {
        return Err("Native ASR 模型清单不能为空".into());
    }
    let mut logical_ids = HashSet::new();
    let mut identities = HashSet::new();
    for model in &manifest.models {
        for (name, value) in [
            ("logicalId", model.logical_id.as_str()),
            ("engine", model.engine.as_str()),
            ("model", model.model.as_str()),
            ("backend", model.backend.as_str()),
            ("format", model.format.as_str()),
            ("repository", model.repository.as_str()),
            ("license.spdx", model.license.spdx.as_str()),
            ("license.attribution", model.license.attribution.as_str()),
            ("license.source", model.license.source.as_str()),
        ] {
            validate_text(name, value)?;
        }
        validate_segment("engine", &model.engine)?;
        validate_segment("model", &model.model)?;
        validate_repository(&model.repository)?;
        if model.logical_id != format!("{}/{}", model.engine, model.model) {
            return Err("logicalId 必须与 engine/model 完全一致".into());
        }
        if !logical_ids.insert(model.logical_id.to_ascii_lowercase())
            || !identities.insert((
                model.engine.to_ascii_lowercase(),
                model.model.to_ascii_lowercase(),
            ))
        {
            return Err(format!("模型清单包含重复身份：{}", model.logical_id));
        }
        if !is_lower_hex(&model.revision, 40) {
            return Err(format!(
                "模型 revision 必须是 40 位小写提交哈希：{}",
                model.logical_id
            ));
        }
        if model.files.is_empty() {
            return Err(format!("模型缺少文件清单：{}", model.logical_id));
        }
        let mut roles = HashSet::new();
        let mut paths = HashSet::new();
        for file in &model.files {
            validate_text("file.role", &file.role)?;
            validate_relative_file_path(&file.path)?;
            if file.size_bytes == 0 {
                return Err(format!("模型文件大小必须大于 0：{}", file.path));
            }
            if !is_lower_hex(&file.sha256, 64) {
                return Err(format!("模型文件 SHA-256 无效：{}", file.path));
            }
            if !roles.insert(file.role.clone()) || !paths.insert(file.path.to_ascii_lowercase()) {
                return Err(format!("模型文件 role/path 重复：{}", file.path));
            }
        }
        for role in REQUIRED_ROLES {
            if !roles.contains(role) {
                return Err(format!("模型缺少必需文件角色：{role}"));
            }
        }
    }
    Ok(())
}

fn validate_text(name: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.bytes().any(|byte| byte < 0x20 || byte == 0x7f) {
        return Err(format!("模型清单字段无效：{name}"));
    }
    Ok(())
}

fn validate_segment(name: &str, value: &str) -> Result<(), String> {
    let path = Path::new(value);
    let mut components = path.components();
    if path.is_absolute()
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
        || value == "."
        || value == ".."
        || value.ends_with('.')
        || value.contains(['/', '\\', ':'])
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        || is_windows_reserved_name(value)
    {
        return Err(format!("模型清单路径段无效：{name}"));
    }
    Ok(())
}

fn is_windows_reserved_name(value: &str) -> bool {
    let stem = value.split('.').next().unwrap_or(value);
    matches!(
        stem.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn validate_repository(repository: &str) -> Result<(), String> {
    let parts: Vec<_> = repository.split('/').collect();
    if parts.len() != 2 {
        return Err("模型 repository 必须是 owner/name".into());
    }
    validate_segment("repository.owner", parts[0])?;
    validate_segment("repository.name", parts[1])
}

fn validate_relative_file_path(value: &str) -> Result<(), String> {
    validate_segment("file.path", value)
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn find_model<'a>(
    manifest: &'a ModelManifest,
    engine: &str,
    model: &str,
) -> Option<&'a ManifestModel> {
    manifest
        .models
        .iter()
        .find(|entry| entry.engine == engine && entry.model == model)
}

fn unavailable_status(engine: &str, model: &str) -> NativeAsrModelStatus {
    NativeAsrModelStatus {
        engine: engine.to_string(),
        model: model.to_string(),
        backend: None,
        revision: None,
        disposition: if POST_MVP_MODELS.contains(&(engine, model)) {
            NativeAsrModelDisposition::PostMvpUnavailable
        } else {
            NativeAsrModelDisposition::Unsupported
        },
        origin: None,
        resolved_path: None,
    }
}

pub(crate) fn known_native_asr_engines() -> Vec<&'static str> {
    let mut engines = vec!["faster-whisper"];
    for (engine, _) in POST_MVP_MODELS {
        if !engines.contains(&engine) {
            engines.push(engine);
        }
    }
    engines
}

fn direct_path(roots: &ManagedModelRoots, model: &ManifestModel) -> PathBuf {
    roots
        .direct
        .join(&model.engine)
        .join(&model.model)
        .join(&model.revision)
}

fn legacy_path(roots: &ManagedModelRoots, model: &ManifestModel) -> PathBuf {
    roots
        .legacy_huggingface
        .join("hub")
        .join(format!("models--{}", model.repository.replace('/', "--")))
        .join("snapshots")
        .join(&model.revision)
}

fn download_path(roots: &ManagedModelRoots, model: &ManifestModel) -> PathBuf {
    roots
        .downloads
        .join(&model.engine)
        .join(&model.model)
        .join(&model.revision)
}

fn resolve_sync(
    roots: &ManagedModelRoots,
    model: &ManifestModel,
) -> Result<Option<ResolvedNativeAsrModel>, String> {
    let direct = direct_path(roots, model);
    if verify_direct_install(&direct, model, roots).is_ok() {
        return Ok(Some(resolved(
            model,
            direct,
            NativeAsrModelOrigin::DirectInstall,
        )));
    }
    let legacy = legacy_path(roots, model);
    if verify_directory(&legacy, model, VerificationMode::Legacy, roots).is_ok() {
        return Ok(Some(resolved(
            model,
            legacy,
            NativeAsrModelOrigin::LegacyHuggingFaceSnapshot,
        )));
    }
    Ok(None)
}

fn verify_direct_install(
    directory: &Path,
    model: &ManifestModel,
    roots: &ManagedModelRoots,
) -> Result<(), String> {
    let root_metadata = fs::symlink_metadata(&roots.direct)
        .map_err(|_| "受管 CTranslate2 根目录不可用".to_string())?;
    if is_link_like(&root_metadata) || !root_metadata.is_dir() {
        return Err("受管 CTranslate2 根目录类型无效".into());
    }
    let root = roots
        .direct
        .canonicalize()
        .map_err(|_| "受管 CTranslate2 根目录不可用".to_string())?;
    let candidate = directory
        .canonicalize()
        .map_err(|_| "CTranslate2 模型目录不可用".to_string())?;
    if candidate == root || !candidate.starts_with(&root) {
        return Err("CTranslate2 模型目录越出受管根目录".into());
    }
    let mut current = roots.direct.clone();
    let relative = directory
        .strip_prefix(&roots.direct)
        .map_err(|_| "CTranslate2 模型路径不受管".to_string())?;
    for component in relative.components() {
        current.push(component);
        let metadata =
            fs::symlink_metadata(&current).map_err(|_| "CTranslate2 模型路径不可用".to_string())?;
        if is_link_like(&metadata) {
            return Err("CTranslate2 模型路径不得包含 symlink/reparse point".into());
        }
    }
    verify_directory(directory, model, VerificationMode::Direct, roots)
}

fn resolved(
    model: &ManifestModel,
    path: PathBuf,
    origin: NativeAsrModelOrigin,
) -> ResolvedNativeAsrModel {
    ResolvedNativeAsrModel {
        logical_id: model.logical_id.clone(),
        backend: model.backend.clone(),
        revision: model.revision.clone(),
        path,
        origin,
    }
}

#[derive(Clone, Copy)]
enum VerificationMode {
    Direct,
    Legacy,
}

fn verify_directory(
    directory: &Path,
    model: &ManifestModel,
    mode: VerificationMode,
    roots: &ManagedModelRoots,
) -> Result<(), String> {
    let legacy_root = if matches!(mode, VerificationMode::Legacy) {
        let root = roots
            .legacy_huggingface
            .canonicalize()
            .map_err(|_| "受管 Hugging Face 根目录不可用".to_string())?;
        let candidate = directory
            .canonicalize()
            .map_err(|_| "Hugging Face 快照目录不可用".to_string())?;
        if !candidate.starts_with(&root) || candidate == root {
            return Err("Hugging Face 快照越出受管根目录".into());
        }
        Some(root)
    } else {
        None
    };

    for required in &model.files {
        let path = directory.join(&required.path);
        let metadata =
            fs::symlink_metadata(&path).map_err(|_| format!("模型文件缺失：{}", required.path))?;
        match mode {
            VerificationMode::Direct => {
                if is_link_like(&metadata) || !metadata.file_type().is_file() {
                    return Err(format!("直接安装文件类型无效：{}", required.path));
                }
            }
            VerificationMode::Legacy => {
                let target = path
                    .canonicalize()
                    .map_err(|_| format!("Hugging Face 文件目标不可用：{}", required.path))?;
                if !target.starts_with(legacy_root.as_ref().expect("legacy root")) {
                    return Err(format!(
                        "Hugging Face 文件越出受管根目录：{}",
                        required.path
                    ));
                }
                if !target.is_file() {
                    return Err(format!("Hugging Face 文件类型无效：{}", required.path));
                }
            }
        }
        let actual = fs::metadata(&path).map_err(|error| error.to_string())?;
        if actual.len() != required.size_bytes {
            return Err(format!("模型文件大小不匹配：{}", required.path));
        }
        if sha256_file(&path)? != required.sha256 {
            return Err(format!("模型文件哈希不匹配：{}", required.path));
        }
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn source_endpoint(profile: &RuntimeDependencySourceProfile) -> Result<String, String> {
    let endpoint = match profile.id {
        RuntimeDependencySourceId::Official => OFFICIAL_ENDPOINT,
        RuntimeDependencySourceId::China => profile
            .huggingface_endpoint
            .as_deref()
            .ok_or_else(|| "中国大陆镜像缺少 Hugging Face endpoint".to_string())?,
    };
    validate_endpoint(endpoint)
}

fn validate_endpoint(endpoint: &str) -> Result<String, String> {
    let parsed = url::Url::parse(endpoint).map_err(|_| "Hugging Face endpoint 无效".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Hugging Face endpoint 无效".into());
    }
    Ok(endpoint.trim_end_matches('/').to_string())
}

fn file_url(endpoint: &str, model: &ManifestModel, file: &ManifestFile) -> String {
    format!(
        "{}/{}/resolve/{}/{}",
        endpoint.trim_end_matches('/'),
        model.repository,
        model.revision,
        file.path
    )
}

async fn run_download(
    model: &ManifestModel,
    roots: &ManagedModelRoots,
    endpoint: &str,
    job_id: &str,
    job: &Arc<StdMutex<ModelDownloadJob>>,
) -> Result<ResolvedNativeAsrModel, String> {
    let resolve_roots = roots.clone();
    let resolve_model = model.clone();
    if let Some(ready) =
        tauri::async_runtime::spawn_blocking(move || resolve_sync(&resolve_roots, &resolve_model))
            .await
            .map_err(|error| format!("模型校验任务失败：{error}"))??
    {
        return Ok(ready);
    }

    let namespace = download_path(roots, model);
    let parts = namespace.join("parts");
    let stage = namespace.join(format!("stage-{job_id}"));
    let prepare_parts = parts.clone();
    let prepare_stage_path = stage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        prepare_download_stage(&prepare_parts, &prepare_stage_path)
    })
    .await
    .map_err(|error| format!("模型下载目录任务失败：{error}"))??;

    let result = async {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(30 * 60))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(|error| format!("无法创建模型下载客户端：{error}"))?;
        let mut completed = 0_u64;
        for file in &model.files {
            let part = parts.join(format!("{}.part", file.path));
            download_file(
                &client,
                &file_url(endpoint, model, file),
                file,
                &part,
                completed,
                job,
            )
            .await?;
            let part_for_verify = part.clone();
            let file_for_verify = file.clone();
            tauri::async_runtime::spawn_blocking(move || {
                verify_file(&part_for_verify, &file_for_verify)
            })
            .await
            .map_err(|error| format!("模型文件校验任务失败：{error}"))??;
            let source = part.clone();
            let target = stage.join(&file.path);
            tauri::async_runtime::spawn_blocking(move || {
                fs::copy(&source, &target)
                    .map(|_| ())
                    .map_err(|error| format!("无法写入模型 staging：{error}"))
            })
            .await
            .map_err(|error| format!("模型 staging 任务失败：{error}"))??;
            completed += file.size_bytes;
            update_progress(
                job,
                completed,
                model.files.iter().map(|item| item.size_bytes).sum(),
            );
        }

        let publish_roots = roots.clone();
        let publish_model = model.clone();
        let publish_job_id = job_id.to_string();
        let publish_stage_path = stage.clone();
        let publish_namespace = namespace.clone();
        let published = tauri::async_runtime::spawn_blocking(move || {
            publish_stage(
                &publish_roots,
                &publish_model,
                &publish_stage_path,
                &publish_namespace,
                &publish_job_id,
            )
        })
        .await
        .map_err(|error| format!("模型发布任务失败：{error}"))??;

        for file in &model.files {
            let _ = tokio::fs::remove_file(parts.join(format!("{}.part", file.path))).await;
        }
        Ok(resolved(
            model,
            published,
            NativeAsrModelOrigin::DirectInstall,
        ))
    }
    .await;

    if result.is_err() {
        let failed_stage = stage.clone();
        let _ =
            tauri::async_runtime::spawn_blocking(move || remove_path_entry(&failed_stage)).await;
    }
    result
}

async fn download_file(
    client: &reqwest::Client,
    url: &str,
    expected: &ManifestFile,
    part: &Path,
    completed: u64,
    job: &Arc<StdMutex<ModelDownloadJob>>,
) -> Result<(), String> {
    let mut restarted = false;
    'download: loop {
        let mut existing = match tokio::fs::symlink_metadata(part).await {
            Ok(metadata) if is_link_like(&metadata) => {
                return Err("模型 partial 路径不得是 symlink/reparse point".into());
            }
            Ok(metadata) if !metadata.is_file() => {
                return Err("模型 partial 路径不是普通文件".into());
            }
            Ok(metadata) => metadata.len(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
            Err(error) => return Err(format!("无法检查模型 partial：{error}")),
        };
        if existing > expected.size_bytes {
            let _ = tokio::fs::remove_file(part).await;
            existing = 0;
        } else if existing == expected.size_bytes && existing > 0 {
            let path = part.to_path_buf();
            let file = expected.clone();
            let valid =
                tauri::async_runtime::spawn_blocking(move || verify_file(&path, &file).is_ok())
                    .await
                    .map_err(|error| format!("模型文件校验任务失败：{error}"))?;
            if valid {
                update_progress(job, completed + existing, snapshot_total(job));
                return Ok(());
            }
            let _ = tokio::fs::remove_file(part).await;
            existing = 0;
        }
        update_progress(job, completed + existing, snapshot_total(job));

        let mut request = client.get(url);
        if existing > 0 {
            request = request.header(RANGE, format!("bytes={existing}-"));
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("模型下载网络失败：{error}"))?;
        let status = response.status();
        let previous_existing = existing;
        let (append, response_end) = if status == StatusCode::PARTIAL_CONTENT {
            match matching_content_range_end(&response, existing, expected.size_bytes) {
                Some(end) => (existing > 0, Some(end)),
                None => {
                    if restarted {
                        return Err(format!("模型下载 range 响应无效：HTTP {}", status.as_u16()));
                    }
                    let _ = tokio::fs::remove_file(part).await;
                    restarted = true;
                    continue;
                }
            }
        } else if status == StatusCode::OK {
            (false, None)
        } else if status == StatusCode::RANGE_NOT_SATISFIABLE {
            if restarted {
                return Err(format!("模型下载 range 响应无效：HTTP {}", status.as_u16()));
            }
            let _ = tokio::fs::remove_file(part).await;
            restarted = true;
            continue;
        } else if !status.is_success() {
            return Err(format!("模型下载失败：HTTP {}", status.as_u16()));
        } else {
            (false, None)
        };

        let mut options = tokio::fs::OpenOptions::new();
        options.create(true).write(true);
        if append {
            options.append(true);
        } else {
            options.truncate(true);
            existing = 0;
            update_progress(job, completed, snapshot_total(job));
        }
        let request_start = existing;
        let mut output = options
            .open(part)
            .await
            .map_err(|error| format!("无法打开模型 partial：{error}"))?;
        let mut written = request_start;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("模型下载网络中断：{error}"))?;
            written = written.saturating_add(chunk.len() as u64);
            if written > expected.size_bytes
                || response_end.is_some_and(|end| written > end.saturating_add(1))
            {
                drop(output);
                let _ = tokio::fs::remove_file(part).await;
                if restarted {
                    return Err("模型下载 range 字节数与响应声明不匹配".into());
                }
                restarted = true;
                continue 'download;
            }
            output
                .write_all(&chunk)
                .await
                .map_err(|error| format!("写入模型 partial 失败：{error}"))?;
            update_progress(job, completed + written, snapshot_total(job));
        }
        output
            .flush()
            .await
            .map_err(|error| format!("刷新模型 partial 失败：{error}"))?;
        drop(output);
        if response_end.is_some_and(|end| written <= end) {
            if written == request_start {
                return Err("模型下载 range 响应未提供数据".into());
            }
            continue;
        }
        if written != expected.size_bytes {
            if written <= previous_existing {
                return Err(format!(
                    "模型下载大小不完整：期望 {}，实际 {written}",
                    expected.size_bytes
                ));
            }
            continue;
        }
        let path = part.to_path_buf();
        let file = expected.clone();
        let verified = tauri::async_runtime::spawn_blocking(move || verify_file(&path, &file))
            .await
            .map_err(|error| format!("模型文件校验任务失败：{error}"))?;
        if let Err(error) = verified {
            let _ = tokio::fs::remove_file(part).await;
            return Err(error);
        }
        return Ok(());
    }
}

fn matching_content_range_end(response: &reqwest::Response, start: u64, total: u64) -> Option<u64> {
    let value = response.headers().get(CONTENT_RANGE)?.to_str().ok()?;
    let value = value.strip_prefix("bytes ")?;
    let (range, reported_total) = value.split_once('/')?;
    let (reported_start, reported_end) = range.split_once('-')?;
    let reported_start = reported_start.parse::<u64>().ok()?;
    let reported_end = reported_end.parse::<u64>().ok()?;
    if reported_start == start
        && reported_total.parse::<u64>().ok() == Some(total)
        && reported_end >= reported_start
        && reported_end < total
    {
        Some(reported_end)
    } else {
        None
    }
}

fn verify_file(path: &Path, expected: &ManifestFile) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|_| format!("模型文件缺失：{}", expected.path))?;
    if !metadata.is_file() || metadata.len() != expected.size_bytes {
        return Err(format!("模型文件大小不匹配：{}", expected.path));
    }
    if sha256_file(path)? != expected.sha256 {
        return Err(format!("模型文件哈希不匹配：{}", expected.path));
    }
    Ok(())
}

fn publish_stage(
    roots: &ManagedModelRoots,
    model: &ManifestModel,
    stage: &Path,
    namespace: &Path,
    job_id: &str,
) -> Result<PathBuf, String> {
    verify_directory(stage, model, VerificationMode::Direct, roots)?;
    let final_path = direct_path(roots, model);
    if verify_direct_install(&final_path, model, roots).is_ok() {
        let _ = fs::remove_dir_all(stage);
        return Ok(final_path);
    }
    let parent = final_path
        .parent()
        .ok_or_else(|| "模型最终路径无父目录".to_string())?;
    ensure_plain_directory(parent).map_err(|error| format!("无法创建模型安装目录：{error}"))?;
    let backup = namespace.join(format!("backup-{job_id}"));
    if path_entry_exists(&backup) {
        remove_path_entry(&backup)
            .map_err(|error| format!("无法清理模型 repair backup：{error}"))?;
    }
    let had_invalid_final = path_entry_exists(&final_path);
    if had_invalid_final {
        fs::rename(&final_path, &backup)
            .map_err(|error| format!("无法保存无效模型目录：{error}"))?;
    }
    if let Err(error) = fs::rename(stage, &final_path) {
        if had_invalid_final {
            let _ = fs::rename(&backup, &final_path);
        }
        return Err(format!("无法发布模型目录：{error}"));
    }
    if let Err(error) = verify_direct_install(&final_path, model, roots) {
        let _ = remove_path_entry(&final_path);
        if had_invalid_final {
            let _ = fs::rename(&backup, &final_path);
        }
        return Err(format!("发布后的模型校验失败：{error}"));
    }
    if had_invalid_final {
        let _ = remove_path_entry(&backup);
    }
    Ok(final_path)
}

fn path_entry_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn remove_path_entry(path: &Path) -> Result<(), std::io::Error> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if is_link_like(&metadata) {
        #[cfg(windows)]
        {
            return fs::remove_dir(path).or_else(|_| fs::remove_file(path));
        }
        #[cfg(not(windows))]
        {
            return fs::remove_file(path);
        }
    }
    if metadata.is_file() {
        fs::remove_file(path)
    } else {
        fs::remove_dir_all(path)
    }
}

pub(crate) fn is_link_like(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return metadata.file_attributes() & 0x400 != 0; // FILE_ATTRIBUTE_REPARSE_POINT
    }
    #[cfg(not(windows))]
    false
}

fn prepare_download_stage(parts: &Path, stage: &Path) -> Result<(), String> {
    let namespace = parts
        .parent()
        .filter(|namespace| Some(*namespace) == stage.parent())
        .ok_or_else(|| "模型 staging 必须位于受管下载命名空间".to_string())?;
    ensure_plain_directory(parts)?;
    for entry in
        fs::read_dir(namespace).map_err(|error| format!("无法检查模型 staging：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法检查模型 staging：{error}"))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if entry.path() != stage && (name.starts_with("stage-") || name.starts_with("backup-")) {
            remove_path_entry(&entry.path())
                .map_err(|error| format!("无法清理旧模型 staging：{error}"))?;
        }
    }
    remove_path_entry(stage).map_err(|error| format!("无法清理旧模型 staging：{error}"))?;
    fs::create_dir(stage).map_err(|error| format!("无法创建模型 staging：{error}"))
}

fn ensure_plain_directory(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir | Component::CurDir) {
            return Err("受管目录包含非规范路径组件".into());
        }
        current.push(component.as_os_str());
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if is_link_like(&metadata) => {
                return Err("受管目录路径不得包含 symlink/reparse point".into());
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err("受管目录路径包含非目录项".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(|error| format!("无法创建受管目录：{error}"))?;
            }
            Err(error) => return Err(format!("无法检查受管目录：{error}")),
        }
    }
    Ok(())
}

fn snapshot_total(job: &Arc<StdMutex<ModelDownloadJob>>) -> u64 {
    job.lock()
        .map(|guard| guard.snapshot.total_bytes)
        .unwrap_or(0)
}

fn update_progress(job: &Arc<StdMutex<ModelDownloadJob>>, downloaded: u64, total: u64) {
    if let Ok(mut guard) = job.lock() {
        guard.snapshot.downloaded_bytes = downloaded.min(total);
        guard.snapshot.progress = if total == 0 {
            None
        } else {
            Some((downloaded as f64 / total as f64).clamp(0.0, 0.99))
        };
    }
}

fn sanitize_error(error: &str) -> String {
    let compact: String = error
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .take(500)
        .collect();
    compact.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::Method::GET;
    use httpmock::MockServer;
    use tempfile::tempdir;

    fn hash(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn fixture_model(files: &[(&str, &str, &[u8])]) -> ManifestModel {
        ManifestModel {
            logical_id: "faster-whisper/large-v3".into(),
            engine: "faster-whisper".into(),
            model: "large-v3".into(),
            backend: "ctranslate2".into(),
            format: "ctranslate2".into(),
            repository: "test/model".into(),
            revision: "a".repeat(40),
            license: ModelLicense {
                spdx: "MIT".into(),
                attribution: "test conversion".into(),
                source: "https://example.test/model".into(),
            },
            files: files
                .iter()
                .map(|(role, path, bytes)| ManifestFile {
                    role: (*role).into(),
                    path: (*path).into(),
                    size_bytes: bytes.len() as u64,
                    sha256: hash(bytes),
                })
                .collect(),
        }
    }

    fn complete_fixture() -> (ManifestModel, Vec<(&'static str, &'static [u8])>) {
        let bytes = vec![
            ("config.json", b"config".as_slice()),
            ("model.bin", b"weights".as_slice()),
            ("tokenizer.json", b"tokenizer".as_slice()),
            ("vocabulary.json", b"vocabulary".as_slice()),
        ];
        let model = fixture_model(&[
            ("model-config", bytes[0].0, bytes[0].1),
            ("model-weights", bytes[1].0, bytes[1].1),
            ("tokenizer", bytes[2].0, bytes[2].1),
            ("vocabulary", bytes[3].0, bytes[3].1),
        ]);
        (model, bytes)
    }

    fn write_model(directory: &Path, files: &[(&str, &[u8])]) {
        fs::create_dir_all(directory).unwrap();
        for (path, bytes) in files {
            fs::write(directory.join(path), bytes).unwrap();
        }
    }

    #[test]
    fn manifest_frozen_identity_and_four_file_closure_are_exact() {
        let manifest = load_manifest().unwrap();
        assert_eq!(manifest.models.len(), 1);
        let model = &manifest.models[0];
        assert_eq!(model.logical_id, "faster-whisper/large-v3");
        assert_eq!(model.repository, "Systran/faster-whisper-large-v3");
        assert_eq!(model.revision, "edaa852ec7e145841d8ffdb056a99866b5f0a478");
        assert_eq!(model.backend, "ctranslate2");
        assert_eq!(model.format, "ctranslate2");
        assert_eq!(model.license.spdx, "MIT");
        assert_eq!(
            model.license.attribution,
            "Systran conversion of openai/whisper-large-v3"
        );
        assert_eq!(
            model.license.source,
            "https://huggingface.co/Systran/faster-whisper-large-v3/tree/edaa852ec7e145841d8ffdb056a99866b5f0a478"
        );
        let expected = [
            (
                "model-config",
                "config.json",
                2_394,
                "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9",
            ),
            (
                "model-weights",
                "model.bin",
                3_087_284_237,
                "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1",
            ),
            (
                "tokenizer",
                "tokenizer.json",
                2_480_617,
                "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca",
            ),
            (
                "vocabulary",
                "vocabulary.json",
                1_068_114,
                "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1",
            ),
        ];
        assert_eq!(model.files.len(), expected.len());
        for (file, expected) in model.files.iter().zip(expected) {
            assert_eq!(
                (
                    file.role.as_str(),
                    file.path.as_str(),
                    file.size_bytes,
                    file.sha256.as_str(),
                ),
                expected
            );
        }
        assert!(!model
            .files
            .iter()
            .any(|file| file.path == "preprocessor_config.json"));
    }

    #[test]
    fn manifest_validation_rejects_schema_duplicates_paths_hashes_and_missing_roles() {
        let valid = MANIFEST_JSON.to_string();
        assert!(
            parse_manifest(&valid.replace("\"schemaVersion\": 1", "\"schemaVersion\": 2")).is_err()
        );
        let mut value: serde_json::Value = serde_json::from_str(&valid).unwrap();
        let row = value["models"][0].clone();
        value["models"].as_array_mut().unwrap().push(row);
        assert!(parse_manifest(&value.to_string()).is_err());
        let mut value: serde_json::Value = serde_json::from_str(&valid).unwrap();
        let mut case_collision = value["models"][0].clone();
        case_collision["logicalId"] = "FASTER-WHISPER/large-v3".into();
        case_collision["engine"] = "FASTER-WHISPER".into();
        value["models"].as_array_mut().unwrap().push(case_collision);
        assert!(parse_manifest(&value.to_string()).is_err());
        let mut value: serde_json::Value = serde_json::from_str(&valid).unwrap();
        value["models"][0]["files"][0]["path"] = "../config.json".into();
        assert!(parse_manifest(&value.to_string()).is_err());
        let mut value: serde_json::Value = serde_json::from_str(&valid).unwrap();
        value["models"][0]["files"][0]["path"] = "config.json?download=1".into();
        assert!(parse_manifest(&value.to_string()).is_err());
        for unsafe_windows_path in ["CON.json", "config.json."] {
            let mut value: serde_json::Value = serde_json::from_str(&valid).unwrap();
            value["models"][0]["files"][0]["path"] = unsafe_windows_path.into();
            assert!(parse_manifest(&value.to_string()).is_err());
        }
        let mut value: serde_json::Value = serde_json::from_str(&valid).unwrap();
        let mut duplicate_path = value["models"][0]["files"][0].clone();
        duplicate_path["role"] = "extra".into();
        duplicate_path["path"] = "CONFIG.JSON".into();
        value["models"][0]["files"]
            .as_array_mut()
            .unwrap()
            .push(duplicate_path);
        assert!(parse_manifest(&value.to_string()).is_err());
        let mut value: serde_json::Value = serde_json::from_str(&valid).unwrap();
        value["models"][0]["files"][0]["sha256"] = "BAD".into();
        assert!(parse_manifest(&value.to_string()).is_err());
        let mut value: serde_json::Value = serde_json::from_str(&valid).unwrap();
        value["models"][0]["files"]
            .as_array_mut()
            .unwrap()
            .remove(0);
        assert!(parse_manifest(&value.to_string()).is_err());
    }

    #[test]
    fn manifest_paths_stay_under_expected_roots_and_urls_are_deterministic() {
        let (model, _) = complete_fixture();
        let roots = ManagedModelRoots::below(Path::new("C:/Hikaru Sub/deps"));
        assert!(direct_path(&roots, &model)
            .ends_with(format!("faster-whisper/large-v3/{}", model.revision)));
        assert!(legacy_path(&roots, &model).ends_with(format!(
            "hub/models--test--model/snapshots/{}",
            model.revision
        )));
        assert!(download_path(&roots, &model).ends_with(format!(
            "native-asr-models/faster-whisper/large-v3/{}",
            model.revision
        )));
        assert_eq!(
            file_url(OFFICIAL_ENDPOINT, &model, &model.files[0]),
            format!(
                "https://huggingface.co/test/model/resolve/{}/config.json",
                model.revision
            )
        );
        assert_eq!(
            file_url("https://hf-mirror.com/", &model, &model.files[0]),
            format!(
                "https://hf-mirror.com/test/model/resolve/{}/config.json",
                model.revision
            )
        );
    }

    #[test]
    fn manifest_source_profiles_select_official_and_china_endpoints() {
        let official: RuntimeDependencySourceProfile = serde_json::from_value(serde_json::json!({
            "id": "official", "label": "official", "ffmpeg": null, "python311": null,
            "pipIndexUrl": null, "pipExtraIndexUrls": [], "pytorchCpuIndexUrl": null,
            "pytorchCudaIndexUrl": null, "pytorchCpuFindLinksUrl": null,
            "pytorchCudaFindLinksUrl": null, "huggingfaceEndpoint": "https://ignored.example"
        }))
        .unwrap();
        let china: RuntimeDependencySourceProfile = serde_json::from_value(serde_json::json!({
            "id": "china", "label": "china", "ffmpeg": null, "python311": null,
            "pipIndexUrl": null, "pipExtraIndexUrls": [], "pytorchCpuIndexUrl": null,
            "pytorchCudaIndexUrl": null, "pytorchCpuFindLinksUrl": null,
            "pytorchCudaFindLinksUrl": null, "huggingfaceEndpoint": "https://hf-mirror.com"
        }))
        .unwrap();
        assert_eq!(source_endpoint(&official).unwrap(), OFFICIAL_ENDPOINT);
        assert_eq!(source_endpoint(&china).unwrap(), "https://hf-mirror.com");
        let mut insecure = china;
        insecure.huggingface_endpoint = Some("http://hf-mirror.example".into());
        assert!(source_endpoint(&insecure).is_err());
    }

    #[tokio::test]
    async fn readiness_prefers_exact_direct_then_exact_legacy() {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        let legacy = legacy_path(&roots, &model);
        write_model(&legacy, &files);
        let resolved = resolve_sync(&roots, &model).unwrap().unwrap();
        assert_eq!(
            resolved.origin,
            NativeAsrModelOrigin::LegacyHuggingFaceSnapshot
        );
        let direct = direct_path(&roots, &model);
        write_model(&direct, &files);
        let resolved = resolve_sync(&roots, &model).unwrap().unwrap();
        assert_eq!(resolved.origin, NativeAsrModelOrigin::DirectInstall);
    }

    #[tokio::test]
    async fn verified_ready_resolution_is_reused_only_within_the_same_manager() {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        let direct = direct_path(&roots, &model);
        write_model(&direct, &files);
        let manager = NativeAsrModelManager::default();

        assert!(manager
            .resolve_entry_with_roots(roots.clone(), model.clone())
            .await
            .unwrap()
            .is_some());
        fs::remove_file(direct.join("model.bin")).unwrap();
        assert!(manager
            .resolve_entry_with_roots(roots.clone(), model.clone())
            .await
            .unwrap()
            .is_some());
        assert!(NativeAsrModelManager::default()
            .resolve_entry_with_roots(roots, model)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn ready_cache_is_scoped_to_roots_and_exact_model_identity() {
        let first_dir = tempdir().unwrap();
        let first_roots = ManagedModelRoots::below(first_dir.path());
        let (model, files) = complete_fixture();
        write_model(&direct_path(&first_roots, &model), &files);
        let manager = NativeAsrModelManager::default();
        assert!(manager
            .resolve_entry_with_roots(first_roots.clone(), model.clone())
            .await
            .unwrap()
            .is_some());

        let second_dir = tempdir().unwrap();
        let second_roots = ManagedModelRoots::below(second_dir.path());
        assert!(manager
            .resolve_entry_with_roots(second_roots, model.clone())
            .await
            .unwrap()
            .is_none());

        let mut other_model = model.clone();
        other_model.logical_id = "faster-whisper/other-model".into();
        other_model.model = "other-model".into();
        assert!(manager
            .resolve_entry_with_roots(first_roots.clone(), other_model)
            .await
            .unwrap()
            .is_none());

        let mut other_file_identity = model;
        other_file_identity.files[0].sha256 = "0".repeat(64);
        assert!(manager
            .resolve_entry_with_roots(first_roots, other_file_identity)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn missing_and_corrupt_resolutions_are_not_cached() {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        let manager = NativeAsrModelManager::default();

        assert!(manager
            .resolve_entry_with_roots(roots.clone(), model.clone())
            .await
            .unwrap()
            .is_none());
        let direct = direct_path(&roots, &model);
        write_model(&direct, &files);
        fs::write(direct.join("model.bin"), b"corrupt").unwrap();
        assert!(manager
            .resolve_entry_with_roots(roots.clone(), model.clone())
            .await
            .unwrap()
            .is_none());
        fs::write(direct.join("model.bin"), b"weights").unwrap();
        assert!(manager
            .resolve_entry_with_roots(roots, model)
            .await
            .unwrap()
            .is_some());
    }

    #[test]
    fn readiness_fails_closed_for_missing_wrong_size_hash_and_revision() {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        let direct = direct_path(&roots, &model);
        write_model(&direct, &files[..3]);
        assert!(resolve_sync(&roots, &model).unwrap().is_none());
        fs::write(direct.join("vocabulary.json"), b"wrong-size").unwrap();
        assert!(resolve_sync(&roots, &model).unwrap().is_none());
        fs::write(direct.join("vocabulary.json"), b"vocabulory").unwrap();
        assert!(resolve_sync(&roots, &model).unwrap().is_none());
        write_model(
            &legacy_path(&roots, &model).with_file_name("wrong-revision"),
            &files,
        );
        assert!(resolve_sync(&roots, &model).unwrap().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn readiness_rejects_direct_symlink_and_escaped_legacy_symlink() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        let outside = dir.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("config.json"), files[0].1).unwrap();
        let direct = direct_path(&roots, &model);
        write_model(&direct, &files);
        fs::remove_file(direct.join("config.json")).unwrap();
        symlink(outside.join("config.json"), direct.join("config.json")).unwrap();
        assert!(resolve_sync(&roots, &model).unwrap().is_none());
        fs::remove_dir_all(&direct).unwrap();
        let legacy = legacy_path(&roots, &model);
        write_model(&legacy, &files);
        fs::remove_file(legacy.join("config.json")).unwrap();
        symlink(outside.join("config.json"), legacy.join("config.json")).unwrap();
        assert!(resolve_sync(&roots, &model).unwrap().is_none());

        let escaped_dir = tempdir().unwrap();
        let escaped_roots = ManagedModelRoots::below(escaped_dir.path());
        let escaped_target = escaped_dir.path().join("direct-outside");
        fs::create_dir_all(escaped_roots.direct.parent().unwrap()).unwrap();
        symlink(&escaped_target, &escaped_roots.direct).unwrap();
        write_model(&direct_path(&escaped_roots, &model), &files);
        assert!(resolve_sync(&escaped_roots, &model).unwrap().is_none());
    }

    #[test]
    fn readiness_distinguishes_post_mvp_and_unknown() {
        assert_eq!(
            unavailable_status("faster-whisper", "small").disposition,
            NativeAsrModelDisposition::PostMvpUnavailable
        );
        assert_eq!(
            unavailable_status("other", "thing").disposition,
            NativeAsrModelDisposition::Unsupported
        );
    }

    async fn wait_terminal(manager: &NativeAsrModelManager, id: &str) -> ModelDownloadSnapshot {
        for _ in 0..200 {
            let snapshot = manager.job_snapshot(id).await.unwrap();
            if snapshot.status != ModelDownloadJobStatus::Running {
                return snapshot;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("job did not finish");
    }

    fn mock_all(server: &MockServer, model: &ManifestModel, files: &[(&str, &[u8])]) {
        for (path, bytes) in files {
            let route = format!("/test/model/resolve/{}/{}", model.revision, path);
            server.mock(|when, then| {
                when.method(GET).path(route.clone());
                then.status(200).body(bytes.to_vec());
            });
        }
    }

    #[tokio::test]
    async fn download_fresh_files_stages_verifies_and_publishes() {
        let server = MockServer::start_async().await;
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        mock_all(&server, &model, &files);
        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model.clone(), roots.clone(), server.base_url())
            .await
            .unwrap();
        let snapshot = wait_terminal(&manager, &id).await;
        assert_eq!(snapshot.status, ModelDownloadJobStatus::Completed);
        let direct = direct_path(&roots, &model);
        verify_directory(&direct, &model, VerificationMode::Direct, &roots).unwrap();
        fs::remove_file(direct.join("model.bin")).unwrap();
        assert!(manager
            .resolve_entry_with_roots(roots.clone(), model.clone())
            .await
            .unwrap()
            .is_some());
        assert!(NativeAsrModelManager::default()
            .resolve_entry_with_roots(roots, model)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn already_verified_legacy_download_request_preserves_cached_origin() {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        let legacy = legacy_path(&roots, &model);
        write_model(&legacy, &files);
        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model.clone(), roots.clone(), OFFICIAL_ENDPOINT.into())
            .await
            .unwrap();
        assert_eq!(
            wait_terminal(&manager, &id).await.status,
            ModelDownloadJobStatus::Completed
        );
        fs::remove_file(legacy.join("model.bin")).unwrap();
        let cached = manager
            .resolve_entry_with_roots(roots.clone(), model.clone())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            cached.origin,
            NativeAsrModelOrigin::LegacyHuggingFaceSnapshot
        );
        assert!(NativeAsrModelManager::default()
            .resolve_entry_with_roots(roots, model)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn download_resumes_matching_range_and_restarts_ignored_range() {
        let server = MockServer::start_async().await;
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let model = fixture_model(&[
            ("model-config", "config.json", b"abcdef"),
            ("model-weights", "model.bin", b"w"),
            ("tokenizer", "tokenizer.json", b"t"),
            ("vocabulary", "vocabulary.json", b"v"),
        ]);
        let namespace = download_path(&roots, &model).join("parts");
        fs::create_dir_all(&namespace).unwrap();
        fs::write(namespace.join("config.json.part"), b"abc").unwrap();
        let resumed = server.mock(|when, then| {
            when.method(GET)
                .path(format!(
                    "/test/model/resolve/{}/config.json",
                    model.revision
                ))
                .header("range", "bytes=3-");
            then.status(206)
                .header("content-range", "bytes 3-5/6")
                .body("def");
        });
        for (path, body) in [
            ("model.bin", "w"),
            ("tokenizer.json", "t"),
            ("vocabulary.json", "v"),
        ] {
            server.mock(|when, then| {
                when.method(GET)
                    .path(format!("/test/model/resolve/{}/{}", model.revision, path));
                then.status(200).body(body);
            });
        }
        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model.clone(), roots.clone(), server.base_url())
            .await
            .unwrap();
        assert_eq!(
            wait_terminal(&manager, &id).await.status,
            ModelDownloadJobStatus::Completed
        );
        assert_eq!(resumed.hits(), 1);

        let server2 = MockServer::start_async().await;
        let dir2 = tempdir().unwrap();
        let roots2 = ManagedModelRoots::below(dir2.path());
        let parts2 = download_path(&roots2, &model).join("parts");
        fs::create_dir_all(&parts2).unwrap();
        fs::write(parts2.join("config.json.part"), b"abc").unwrap();
        let ignored = server2.mock(|when, then| {
            when.method(GET)
                .path(format!(
                    "/test/model/resolve/{}/config.json",
                    model.revision
                ))
                .header("range", "bytes=3-");
            then.status(200).body("abcdef");
        });
        for (path, body) in [
            ("model.bin", "w"),
            ("tokenizer.json", "t"),
            ("vocabulary.json", "v"),
        ] {
            server2.mock(|when, then| {
                when.method(GET)
                    .path(format!("/test/model/resolve/{}/{}", model.revision, path));
                then.status(200).body(body);
            });
        }
        let manager2 = NativeAsrModelManager::default();
        let id2 = manager2
            .start_download_for_model(model.clone(), roots2.clone(), server2.base_url())
            .await
            .unwrap();
        assert_eq!(
            wait_terminal(&manager2, &id2).await.status,
            ModelDownloadJobStatus::Completed
        );
        assert!(ignored.hits() >= 1);
    }

    #[tokio::test]
    async fn download_accepts_multiple_valid_range_segments() {
        let server = MockServer::start_async().await;
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let model = fixture_model(&[
            ("model-config", "config.json", b"abcdef"),
            ("model-weights", "model.bin", b"w"),
            ("tokenizer", "tokenizer.json", b"t"),
            ("vocabulary", "vocabulary.json", b"v"),
        ]);
        let parts = download_path(&roots, &model).join("parts");
        fs::create_dir_all(&parts).unwrap();
        fs::write(parts.join("config.json.part"), b"abc").unwrap();
        let first = server.mock(|when, then| {
            when.method(GET)
                .path(format!(
                    "/test/model/resolve/{}/config.json",
                    model.revision
                ))
                .header("range", "bytes=3-");
            then.status(206)
                .header("content-range", "bytes 3-4/6")
                .body("de");
        });
        let second = server.mock(|when, then| {
            when.method(GET)
                .path(format!(
                    "/test/model/resolve/{}/config.json",
                    model.revision
                ))
                .header("range", "bytes=5-");
            then.status(206)
                .header("content-range", "bytes 5-5/6")
                .body("f");
        });
        for (path, body) in [
            ("model.bin", "w"),
            ("tokenizer.json", "t"),
            ("vocabulary.json", "v"),
        ] {
            server.mock(|when, then| {
                when.method(GET)
                    .path(format!("/test/model/resolve/{}/{}", model.revision, path));
                then.status(200).body(body);
            });
        }
        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model, roots, server.base_url())
            .await
            .unwrap();
        assert_eq!(
            wait_terminal(&manager, &id).await.status,
            ModelDownloadJobStatus::Completed
        );
        assert_eq!(first.hits(), 1);
        assert_eq!(second.hits(), 1);
    }

    #[tokio::test]
    async fn download_restarts_oversized_partial() {
        let server = MockServer::start_async().await;
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        let part = download_path(&roots, &model).join("parts/config.json.part");
        fs::create_dir_all(part.parent().unwrap()).unwrap();
        fs::write(&part, b"oversized").unwrap();
        mock_all(&server, &model, &files);

        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model, roots, server.base_url())
            .await
            .unwrap();
        assert_eq!(
            wait_terminal(&manager, &id).await.status,
            ModelDownloadJobStatus::Completed
        );
    }

    #[tokio::test]
    async fn download_restarts_after_range_not_satisfiable() {
        use tokio::io::AsyncReadExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for (index, body) in [b"".as_slice(), b"abcdef", b"w", b"t", b"v"]
                .into_iter()
                .enumerate()
            {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0_u8; 2048];
                let read = socket.read(&mut request).await.unwrap();
                let request = String::from_utf8_lossy(&request[..read]);
                if index == 0 {
                    assert!(request.to_ascii_lowercase().contains("range: bytes=3-"));
                    socket
                        .write_all(
                            b"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        )
                        .await
                        .unwrap();
                } else {
                    socket
                        .write_all(
                            format!(
                                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                body.len()
                            )
                            .as_bytes(),
                        )
                        .await
                        .unwrap();
                    socket.write_all(body).await.unwrap();
                }
            }
        });
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let model = fixture_model(&[
            ("model-config", "config.json", b"abcdef"),
            ("model-weights", "model.bin", b"w"),
            ("tokenizer", "tokenizer.json", b"t"),
            ("vocabulary", "vocabulary.json", b"v"),
        ]);
        let part = download_path(&roots, &model).join("parts/config.json.part");
        fs::create_dir_all(part.parent().unwrap()).unwrap();
        fs::write(part, b"abc").unwrap();
        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model, roots, format!("http://{address}"))
            .await
            .unwrap();
        assert_eq!(
            wait_terminal(&manager, &id).await.status,
            ModelDownloadJobStatus::Completed
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn download_bad_range_restarts_and_network_failure_preserves_partial() {
        let model = fixture_model(&[
            ("model-config", "config.json", b"abcdef"),
            ("model-weights", "model.bin", b"w"),
            ("tokenizer", "tokenizer.json", b"t"),
            ("vocabulary", "vocabulary.json", b"v"),
        ]);

        let bad_server = MockServer::start_async().await;
        let bad_dir = tempdir().unwrap();
        let bad_roots = ManagedModelRoots::below(bad_dir.path());
        let bad_part = download_path(&bad_roots, &model).join("parts/config.json.part");
        fs::create_dir_all(bad_part.parent().unwrap()).unwrap();
        fs::write(&bad_part, b"abc").unwrap();
        let bad_range = bad_server.mock(|when, then| {
            when.method(GET)
                .path(format!(
                    "/test/model/resolve/{}/config.json",
                    model.revision
                ))
                .header("range", "bytes=3-");
            then.status(206)
                .header("content-range", "bytes 2-5/6")
                .body("def");
        });
        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model.clone(), bad_roots, bad_server.base_url())
            .await
            .unwrap();
        assert_eq!(
            wait_terminal(&manager, &id).await.status,
            ModelDownloadJobStatus::Failed
        );
        assert_eq!(bad_range.hits(), 1);
        assert!(!bad_part.exists());

        let fail_server = MockServer::start_async().await;
        let fail_dir = tempdir().unwrap();
        let fail_roots = ManagedModelRoots::below(fail_dir.path());
        let fail_part = download_path(&fail_roots, &model).join("parts/config.json.part");
        fs::create_dir_all(fail_part.parent().unwrap()).unwrap();
        fs::write(&fail_part, b"abc").unwrap();
        fail_server.mock(|when, then| {
            when.method(GET)
                .path(format!(
                    "/test/model/resolve/{}/config.json",
                    model.revision
                ))
                .header("range", "bytes=3-");
            then.status(503);
        });
        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model.clone(), fail_roots.clone(), fail_server.base_url())
            .await
            .unwrap();
        assert_eq!(
            wait_terminal(&manager, &id).await.status,
            ModelDownloadJobStatus::Failed
        );
        assert_eq!(fs::read(fail_part).unwrap(), b"abc");
        assert!(!download_path(&fail_roots, &model)
            .join(format!("stage-{id}"))
            .exists());
    }

    #[tokio::test]
    async fn download_stream_interruption_preserves_received_partial() {
        use tokio::io::AsyncReadExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = socket.read(&mut request).await;
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabc")
                .await
                .unwrap();
        });
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let model = fixture_model(&[
            ("model-config", "config.json", b"abcdef"),
            ("model-weights", "model.bin", b"w"),
            ("tokenizer", "tokenizer.json", b"t"),
            ("vocabulary", "vocabulary.json", b"v"),
        ]);
        let part = download_path(&roots, &model).join("parts/config.json.part");
        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model, roots, format!("http://{address}"))
            .await
            .unwrap();
        assert_eq!(
            wait_terminal(&manager, &id).await.status,
            ModelDownloadJobStatus::Failed
        );
        server.await.unwrap();
        assert_eq!(fs::read(part).unwrap(), b"abc");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn download_rejects_symlinked_parts_namespace_without_touching_target() {
        use std::os::unix::fs::symlink;
        let server = MockServer::start_async().await;
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, _) = complete_fixture();
        let namespace = download_path(&roots, &model);
        let outside = dir.path().join("outside-downloads");
        fs::create_dir_all(&namespace).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, namespace.join("parts")).unwrap();

        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model, roots, server.base_url())
            .await
            .unwrap();
        assert_eq!(
            wait_terminal(&manager, &id).await.status,
            ModelDownloadJobStatus::Failed
        );
        assert!(fs::read_dir(outside).unwrap().next().is_none());
    }

    #[tokio::test]
    async fn download_bad_hash_fails_without_publishing_and_deletes_corrupt_complete_part() {
        let server = MockServer::start_async().await;
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        for (path, bytes) in &files {
            let body = if *path == "model.bin" {
                b"corrupi".as_slice()
            } else {
                *bytes
            };
            server.mock(|when, then| {
                when.method(GET)
                    .path(format!("/test/model/resolve/{}/{}", model.revision, path));
                then.status(200).body(body.to_vec());
            });
        }
        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model.clone(), roots.clone(), server.base_url())
            .await
            .unwrap();
        let snapshot = wait_terminal(&manager, &id).await;
        assert_eq!(snapshot.status, ModelDownloadJobStatus::Failed);
        assert!(!direct_path(&roots, &model).exists());
        assert!(!download_path(&roots, &model)
            .join("parts/model.bin.part")
            .exists());
    }

    #[test]
    fn publication_preserves_valid_final_and_repairs_invalid_only_after_stage_verifies() {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        let final_path = direct_path(&roots, &model);
        write_model(&final_path, &files);
        let namespace = download_path(&roots, &model);
        let stage = namespace.join("stage-test");
        write_model(&stage, &files[..3]);
        assert!(publish_stage(&roots, &model, &stage, &namespace, "test").is_err());
        verify_direct_install(&final_path, &model, &roots).unwrap();

        fs::remove_dir_all(&final_path).unwrap();
        write_model(&final_path, &[("broken", b"broken")]);
        fs::remove_dir_all(&stage).ok();
        write_model(&stage, &files);
        publish_stage(&roots, &model, &stage, &namespace, "repair").unwrap();
        verify_direct_install(&final_path, &model, &roots).unwrap();
    }

    #[test]
    fn download_stage_preparation_cleans_only_managed_stale_entries() {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, _) = complete_fixture();
        let namespace = download_path(&roots, &model);
        let parts = namespace.join("parts");
        let stage = namespace.join("stage-current");
        fs::create_dir_all(namespace.join("stage-stale")).unwrap();
        fs::create_dir_all(namespace.join("backup-stale")).unwrap();
        fs::create_dir_all(namespace.join("keep-me")).unwrap();

        prepare_download_stage(&parts, &stage).unwrap();

        assert!(parts.is_dir());
        assert!(stage.is_dir());
        assert!(!namespace.join("stage-stale").exists());
        assert!(!namespace.join("backup-stale").exists());
        assert!(namespace.join("keep-me").is_dir());
    }

    #[tokio::test]
    async fn coalesces_same_model_download_and_retains_terminal_snapshot() {
        let server = MockServer::start_async().await;
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        let mocks: Vec<_> = files
            .iter()
            .map(|(path, bytes)| {
                let route = format!("/test/model/resolve/{}/{}", model.revision, path);
                server.mock(|when, then| {
                    when.method(GET).path(route);
                    then.status(200).body(bytes.to_vec());
                })
            })
            .collect();
        let manager = NativeAsrModelManager::default();
        let first = manager
            .start_download_for_model(model.clone(), roots.clone(), server.base_url())
            .await
            .unwrap();
        let second = manager
            .start_download_for_model(model, roots, server.base_url())
            .await
            .unwrap();
        assert_eq!(first, second);
        let snapshot = wait_terminal(&manager, &first).await;
        assert_eq!(snapshot.status, ModelDownloadJobStatus::Completed);
        assert_eq!(
            manager.job_snapshot(&first).await.unwrap().status,
            ModelDownloadJobStatus::Completed
        );
        assert_eq!(mocks.iter().map(|mock| mock.hits()).sum::<usize>(), 4);
    }
}
