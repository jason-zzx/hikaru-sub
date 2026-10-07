//! Native ASR model delivery used by the production model commands and inference route.

#![allow(dead_code)]

use crate::asr_worker::native_job_id;
use crate::dependencies::{
    effective_source_profile, ensure_runtime_deps_writable_or_elevate,
    managed_ctranslate2_model_dir, managed_downloads_dir, managed_model_cache_dir,
    managed_models_dir, RuntimeDependencySourceId, RuntimeDependencySourceProfile,
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
use tokio::sync::{Mutex, OwnedRwLockWriteGuard, RwLock};

const MANIFEST_JSON: &str = include_str!("../resources/native-asr-models.json");
const OFFICIAL_ENDPOINT: &str = "https://huggingface.co";
const REQUIRED_ROLES: [&str; 4] = ["model-config", "model-weights", "tokenizer", "vocabulary"];
const POST_MVP_MODELS: [(&str, &str); 1] = [("parakeet", "nvidia/parakeet-tdt_ctc-0.6b-ja")];

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
    #[serde(default)]
    post_mvp_unavailable: bool,
    #[serde(default)]
    required_vad: Option<ManifestFile>,
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
    #[serde(default)]
    source: Option<ModelSource>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
struct ModelSource {
    repository: String,
    revision: String,
    license: ModelLicense,
}

#[derive(Debug, Clone)]
struct ManagedModelRoots {
    direct: PathBuf,
    crispasr: PathBuf,
    shared: PathBuf,
    legacy_huggingface: PathBuf,
    downloads: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ReadyCacheKey {
    direct_root: PathBuf,
    legacy_root: PathBuf,
    crispasr_root: PathBuf,
    shared_root: PathBuf,
    model: ManifestModel,
}

impl ReadyCacheKey {
    fn new(roots: &ManagedModelRoots, model: &ManifestModel) -> Self {
        Self {
            direct_root: roots.direct.clone(),
            legacy_root: roots.legacy_huggingface.clone(),
            crispasr_root: roots.crispasr.clone(),
            shared_root: roots.shared.clone(),
            model: model.clone(),
        }
    }
}

#[cfg(test)]
pub(crate) async fn resolve_full_cli_delivery_test_model(
    deps: &Path,
    engine: &str,
    model: &str,
    inputs: &[PathBuf],
) -> ResolvedNativeAsrModel {
    let roots = ManagedModelRoots::below(deps);
    let entry = find_model(&load_manifest().unwrap(), engine, model)
        .unwrap()
        .clone();
    // Private managed-path evidence, never an availability override. Production
    // status/download/resolve still reject a post-MVP entry before reaching here.
    assert_eq!(
        inputs.len(),
        entry.files.len() + usize::from(entry.required_vad.is_some())
    );
    for ((model, file), input) in entry
        .files
        .iter()
        .map(|f| (entry.clone(), f))
        .chain(
            entry
                .required_vad
                .iter()
                .map(|f| (vad_model(&entry).unwrap(), f)),
        )
        .zip(inputs)
    {
        assert_eq!(fs::metadata(input).unwrap().len(), file.size_bytes);
        assert_eq!(sha256_file(input).unwrap(), file.sha256);
        let root = download_path(&roots, &model).join("parts");
        fs::create_dir_all(&root).unwrap();
        fs::hard_link(input, root.join(format!("{}.part", file.path))).unwrap();
    }
    let manager = NativeAsrModelManager::default();
    let id = manager
        .start_download_for_model(entry.clone(), roots.clone(), "http://127.0.0.1:1".into())
        .await
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(90);
    loop {
        let snapshot = manager.job_snapshot(&id).await.unwrap();
        if snapshot.status != ModelDownloadJobStatus::Running {
            assert_eq!(
                snapshot.status,
                ModelDownloadJobStatus::Completed,
                "{:?}",
                snapshot.error
            );
            assert_eq!(snapshot.downloaded_bytes, model_total(&entry));
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let model = manager
        .resolve_entry_with_roots(roots.clone(), entry.clone())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        manager
            .resolve_entry_with_roots(roots, entry)
            .await
            .unwrap()
            .unwrap()
            .roles,
        model.roles
    );
    model
}

impl ManagedModelRoots {
    fn from_app(app: &AppHandle) -> Result<Self, String> {
        Ok(Self {
            direct: managed_ctranslate2_model_dir(app)?,
            crispasr: managed_models_dir(app)?.join("crispasr"),
            shared: managed_models_dir(app)?.join("shared"),
            legacy_huggingface: managed_model_cache_dir(app)?,
            downloads: managed_downloads_dir(app)?.join("native-asr-models"),
        })
    }

    #[cfg(test)]
    fn below(deps: &Path) -> Self {
        Self {
            direct: deps.join("models").join("ctranslate2"),
            crispasr: deps.join("models").join("crispasr"),
            shared: deps.join("models").join("shared"),
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
    pub roles: Vec<(String, PathBuf)>,
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
    entry: ManifestModel,
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
    // Serialize readiness hashing across pages; waiters recheck the successful cache.
    verification: Arc<Mutex<()>>,
    // Checks/downloads share access; explicit cleanup cannot race a cache seed or publication.
    storage: Arc<RwLock<()>>,
    // One shared CPU asset. Serializing only its publication preserves other model jobs.
    vad_download: Arc<Mutex<()>>,
}

impl NativeAsrModelManager {
    pub(crate) fn begin_storage_cleanup(&self) -> Result<OwnedRwLockWriteGuard<()>, String> {
        let guard = self
            .storage
            .clone()
            .try_write_owned()
            .map_err(|_| "模型检查或下载正在进行，暂不可清理".to_string())?;
        self.ready_cache
            .lock()
            .map_err(|_| "模型验证缓存已损坏".to_string())?
            .clear();
        Ok(guard)
    }

    pub(crate) async fn status(
        &self,
        app: &AppHandle,
        engine: &str,
        model: &str,
        use_vad: bool,
    ) -> Result<NativeAsrModelStatus, String> {
        self.status_with_roots(ManagedModelRoots::from_app(app)?, engine, model, use_vad)
            .await
    }

    async fn status_with_roots(
        &self,
        roots: ManagedModelRoots,
        engine: &str,
        model: &str,
        use_vad: bool,
    ) -> Result<NativeAsrModelStatus, String> {
        let manifest = load_manifest()?;
        let Some(entry) = find_model(&manifest, engine, model) else {
            return Ok(unavailable_status(engine, model));
        };
        if !model_supported(entry) {
            return Ok(unavailable_status(engine, model));
        }
        let entry = effective_entry(&manifest, entry, use_vad)?;
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
        use_vad: bool,
    ) -> Result<Option<ResolvedNativeAsrModel>, String> {
        let manifest = load_manifest()?;
        let Some(entry) = find_model(&manifest, engine, model).cloned() else {
            return Ok(None);
        };
        if !model_supported(&entry) {
            return Ok(None);
        }
        let entry = effective_entry(&manifest, &entry, use_vad)?;
        let roots = ManagedModelRoots::from_app(app)?;
        self.resolve_entry_with_roots(roots, entry).await
    }

    async fn resolve_entry_with_roots(
        &self,
        roots: ManagedModelRoots,
        entry: ManifestModel,
    ) -> Result<Option<ResolvedNativeAsrModel>, String> {
        let _verification = self.verification.lock().await;
        let _storage = self.storage.read().await;
        let key = ReadyCacheKey::new(&roots, &entry);
        let cached = self
            .ready_cache
            .lock()
            .map_err(|_| "Native ASR 模型验证缓存已损坏".to_string())?
            .get(&key)
            .cloned();
        if let Some(mut resolved) = cached {
            // The small required VAD is always hashed, including cache hits. Pair cache
            // remains process-local like CT2; cleanup holds the exclusive storage lease.
            let check_roots = roots.clone();
            let check_entry = entry.clone();
            let dependency = tauri::async_runtime::spawn_blocking(move || {
                verified_vad(&check_roots, &check_entry)
            })
            .await
            .map_err(|_| "模型依赖校验任务失败".to_string())??;
            if let Some(vad) = dependency {
                resolved.roles.retain(|(role, _)| role != "vad");
                resolved.roles.push(("vad".into(), vad));
            } else if entry.required_vad.is_some() {
                self.ready_cache
                    .lock()
                    .map_err(|_| "模型验证缓存已损坏".to_string())?
                    .remove(&key);
                return Ok(None);
            }
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
        use_vad: bool,
    ) -> Result<String, String> {
        let manifest = load_manifest()?;
        let entry = effective_entry(
            &manifest,
            downloadable_entry(&manifest, engine, model)?,
            use_vad,
        )?;
        ensure_runtime_deps_writable_or_elevate(app)?;
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
        let storage = self.storage.clone().read_owned().await;
        let total_bytes = model_total(&entry);
        let mut state = self.state.lock().await;
        if let Some(job_id) = state.active_by_model.get(&logical_id) {
            let job = state.jobs[job_id]
                .lock()
                .map_err(|_| "模型下载状态已损坏".to_string())?;
            if job.entry != entry {
                return Err("该模型正在下载不同的依赖，请完成后重试".into());
            }
            return Ok(job_id.clone());
        }
        let id = native_job_id();
        let job = Arc::new(StdMutex::new(ModelDownloadJob {
            entry: entry.clone(),
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
            let result = run_download(
                &entry,
                &roots,
                &endpoint,
                &terminal_id,
                &job,
                &manager.vad_download,
            )
            .await
            .and_then(|ready| {
                manager.remember_ready(&roots, &entry, ready.clone())?;
                Ok(ready)
            });
            let mut state = manager.state.lock().await;
            if state.active_by_model.get(&logical_id) == Some(&terminal_id) {
                state.active_by_model.remove(&logical_id);
            }
            // Terminal polling must not observe a completed/failed job still owning
            // its storage lease. State lock prevents a new same-model job until then.
            drop(storage);
            if let Ok(mut guard) = job.lock() {
                match result {
                    Ok(ready) => {
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
    let mut shared_vad = None;
    for model in &manifest.models {
        for (name, value) in [
            ("logicalId", model.logical_id.as_str()),
            ("engine", model.engine.as_str()),
            ("model", model.model.as_str()),
            ("backend", model.backend.as_str()),
            ("format", model.format.as_str()),
            ("license.spdx", model.license.spdx.as_str()),
            ("license.attribution", model.license.attribution.as_str()),
            ("license.source", model.license.source.as_str()),
        ] {
            validate_text(name, value)?;
        }
        validate_segment("engine", &model.engine)?;
        validate_model_id(&model.model)?;
        let crispasr = model.backend == "crispasr";
        let qwen = crispasr && model.engine == "qwen3-asr";
        if !qwen {
            validate_repository(&model.repository)?;
        }
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
        if if qwen {
            model.revision != pair_revision(&model.files)?
        } else {
            !is_lower_hex(&model.revision, 40)
        } {
            return Err(format!(
                "模型 revision 与固定来源身份不匹配：{}",
                model.logical_id
            ));
        }
        if model.files.is_empty() {
            return Err(format!("模型缺少文件清单：{}", model.logical_id));
        }
        let mut roles = HashSet::new();
        let mut paths = HashSet::new();
        for file in &model.files {
            validate_asset(file)?;
            if !roles.insert(file.role.clone()) || !paths.insert(file.path.to_ascii_lowercase()) {
                return Err(format!("模型文件 role/path 重复：{}", file.path));
            }
        }
        if qwen {
            if model.engine != "qwen3-asr"
                || model.model != "Qwen/Qwen3-ASR-1.7B"
                || model.format != "gguf"
                || !model.repository.is_empty()
                || roles != HashSet::from(["model".to_string(), "aligner".to_string()])
                || model.files.iter().any(|file| {
                    file.source.is_none()
                        || file.path
                            != match file.role.as_str() {
                                "model" => "qwen3-asr-1.7b-q4_k.gguf",
                                "aligner" => "qwen3-forced-aligner-0.6b-q4_k.gguf",
                                _ => "",
                            }
                })
            {
                return Err("Qwen pair 身份或角色无效".into());
            }
        } else if crispasr {
            let valid = match model.engine.as_str() {
                "parakeet" => {
                    model.model == "nvidia/parakeet-tdt_ctc-0.6b-ja"
                        && model.repository == "cstr/parakeet-tdt-0.6b-ja-GGUF"
                        && model.license.spdx == "CC-BY-4.0"
                        && model.files[0].path == "parakeet-tdt-0.6b-ja.gguf"
                }
                "reazonspeech-nemo" => {
                    model.model == "reazon-research/reazonspeech-nemo-v2"
                        && model.repository == "cstr/reazonspeech-nemo-v2-GGUF"
                        && model.license.spdx == "Apache-2.0"
                        && model.files[0].path == "reazonspeech-nemo-v2-q8_0.gguf"
                }
                _ => false,
            };
            if !valid
                || model.format != "gguf"
                || roles != HashSet::from(["model".to_string()])
                || model.files.len() != 1
                || model.files[0].source.is_some()
            {
                return Err("Parakeet-family 日语模型身份或角色无效".into());
            }
        } else {
            if model.backend != "ctranslate2"
                || model.format != "ctranslate2"
                || model.required_vad.is_some()
                || model.files.iter().any(|file| file.source.is_some())
            {
                return Err("CTranslate2 模型身份或依赖无效".into());
            }
            for role in REQUIRED_ROLES {
                if !roles.contains(role) {
                    return Err(format!("模型缺少必需文件角色：{role}"));
                }
            }
        }
        if crispasr {
            let vad = model
                .required_vad
                .as_ref()
                .ok_or("Native 模型缺少必需 CPU VAD")?;
            validate_asset(vad)?;
            if vad.role != "vad" || vad.path != "ggml-silero-v6.2.0.bin" || vad.source.is_none() {
                return Err("Native CPU VAD 身份无效".into());
            }
            if shared_vad.is_some_and(|previous| previous != vad) {
                return Err("共享 CPU VAD 身份不一致".into());
            }
            shared_vad = Some(vad);
        }
        if model.engine == "kotoba-faster-whisper"
            && !model
                .files
                .iter()
                .any(|file| file.role == "preprocessor" && file.path == "preprocessor_config.json")
        {
            return Err("Kotoba 模型缺少 preprocessor_config.json".into());
        }
    }
    Ok(())
}

fn validate_asset(file: &ManifestFile) -> Result<(), String> {
    validate_text("file.role", &file.role)?;
    validate_relative_file_path(&file.path)?;
    if file.size_bytes == 0 || !is_lower_hex(&file.sha256, 64) {
        return Err("模型资产大小或哈希无效".into());
    }
    if let Some(source) = &file.source {
        validate_repository(&source.repository)?;
        if !is_lower_hex(&source.revision, 40) {
            return Err("模型资产 revision 无效".into());
        }
        validate_text("license.spdx", &source.license.spdx)?;
        validate_text("license.attribution", &source.license.attribution)?;
        validate_text("license.source", &source.license.source)?;
    }
    Ok(())
}

// Not an upstream commit: this immutable pair identity binds BOTH sources and bytes.
fn pair_revision(files: &[ManifestFile]) -> Result<String, String> {
    let mut hash = Sha256::new();
    let mut ordered: Vec<_> = files.iter().collect();
    ordered.sort_by_key(|file| &file.role);
    for file in ordered {
        validate_asset(file)?;
        let source = file.source.as_ref().ok_or("pair 文件缺少 source")?;
        hash.update(format!(
            "{}\n{}\n{}\n{}\n{}\n{}\n",
            file.role, source.repository, source.revision, file.path, file.size_bytes, file.sha256
        ));
    }
    Ok(format!("pair-{:x}", hash.finalize()))
}

fn validate_text(name: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.bytes().any(|byte| byte < 0x20 || byte == 0x7f) {
        return Err(format!("模型清单字段无效：{name}"));
    }
    Ok(())
}

pub(crate) fn validate_segment(name: &str, value: &str) -> Result<(), String> {
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

fn validate_model_id(model: &str) -> Result<(), String> {
    if !model.contains('/') {
        return validate_segment("model", model);
    }
    let parts: Vec<_> = model.split('/').collect();
    if parts.len() != 2 {
        return Err("模型 ID 必须是安全名称或 owner/name".into());
    }
    validate_segment("model.owner", parts[0])?;
    validate_segment("model.name", parts[1])
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

fn model_supported(entry: &ManifestModel) -> bool {
    !entry.post_mvp_unavailable
        && (entry.backend != "crispasr"
            || crate::dependencies::crispasr_supports_engine(&entry.engine))
}

fn downloadable_entry<'a>(
    manifest: &'a ModelManifest,
    engine: &str,
    model: &str,
) -> Result<&'a ManifestModel, String> {
    let entry = find_model(manifest, engine, model).ok_or("当前 Native ASR 路线不提供该模型")?;
    if !model_supported(entry) {
        return Err("该模型将在后续版本支持".into());
    }
    Ok(entry)
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

pub(crate) fn known_native_asr_engines() -> Result<Vec<(String, bool, Option<String>)>, String> {
    let manifest = load_manifest()?;
    let mut engines = Vec::new();
    for model in manifest.models {
        if !engines.iter().any(|(engine, _, _)| engine == &model.engine) {
            let supported = model_supported(&model);
            engines.push((model.engine, supported, Some(model.backend)));
        }
    }
    for (engine, _) in POST_MVP_MODELS {
        if !engines.iter().any(|(known, _, _)| known == engine) {
            engines.push((engine.to_string(), false, None));
        }
    }
    Ok(engines)
}

fn direct_root<'a>(roots: &'a ManagedModelRoots, model: &ManifestModel) -> &'a Path {
    match model.backend.as_str() {
        "crispasr" => &roots.crispasr,
        "shared" => &roots.shared,
        _ => &roots.direct,
    }
}

fn direct_path(roots: &ManagedModelRoots, model: &ManifestModel) -> PathBuf {
    direct_root(roots, model)
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

// The validated manifest already enforces one exact shared Silero identity.
fn effective_entry(
    manifest: &ModelManifest,
    model: &ManifestModel,
    use_vad: bool,
) -> Result<ManifestModel, String> {
    let mut entry = model.clone();
    if use_vad && entry.backend == "ctranslate2" {
        entry.required_vad = Some(
            manifest
                .models
                .iter()
                .find_map(|entry| entry.required_vad.clone())
                .ok_or("共享 CPU VAD 模型未配置")?,
        );
    }
    Ok(entry)
}

fn vad_model(model: &ManifestModel) -> Option<ManifestModel> {
    let file = model.required_vad.as_ref()?;
    let source = file.source.as_ref()?;
    Some(ManifestModel {
        logical_id: "silero/vad".into(),
        engine: "silero".into(),
        model: "vad".into(),
        backend: "shared".into(),
        format: "ggml".into(),
        repository: source.repository.clone(),
        revision: source.revision.clone(),
        license: source.license.clone(),
        files: vec![file.clone()],
        post_mvp_unavailable: true,
        required_vad: None,
    })
}

fn verified_vad(
    roots: &ManagedModelRoots,
    model: &ManifestModel,
) -> Result<Option<PathBuf>, String> {
    let Some(vad) = vad_model(model) else {
        return Ok(None);
    };
    let path = direct_path(roots, &vad);
    Ok(verify_direct_install(&path, &vad, roots)
        .ok()
        .map(|_| path.join(&vad.files[0].path)))
}

fn resolve_sync(
    roots: &ManagedModelRoots,
    model: &ManifestModel,
) -> Result<Option<ResolvedNativeAsrModel>, String> {
    let vad = verified_vad(roots, model)?;
    if model.required_vad.is_some() && vad.is_none() {
        return Ok(None);
    }
    let direct = direct_path(roots, model);
    if verify_direct_install(&direct, model, roots).is_ok() {
        let mut ready = resolved(model, direct, NativeAsrModelOrigin::DirectInstall);
        if let Some(vad) = vad {
            ready.roles.push(("vad".into(), vad));
        }
        return Ok(Some(ready));
    }
    if model.backend != "ctranslate2" {
        return Ok(None);
    }
    let legacy = legacy_path(roots, model);
    if verify_directory(&legacy, model, VerificationMode::Legacy, roots).is_ok() {
        let mut ready = resolved(
            model,
            legacy,
            NativeAsrModelOrigin::LegacyHuggingFaceSnapshot,
        );
        if let Some(vad) = vad {
            ready.roles.push(("vad".into(), vad));
        }
        return Ok(Some(ready));
    }
    Ok(None)
}

fn verify_direct_install(
    directory: &Path,
    model: &ManifestModel,
    roots: &ManagedModelRoots,
) -> Result<(), String> {
    let direct_root = direct_root(roots, model);
    verify_plain_ancestors(directory)?;
    let root_metadata = fs::symlink_metadata(direct_root)
        .map_err(|_| "受管 CTranslate2 根目录不可用".to_string())?;
    if is_link_like(&root_metadata) || !root_metadata.is_dir() {
        return Err("受管 CTranslate2 根目录类型无效".into());
    }
    let root = direct_root
        .canonicalize()
        .map_err(|_| "受管 CTranslate2 根目录不可用".to_string())?;
    let candidate = directory
        .canonicalize()
        .map_err(|_| "CTranslate2 模型目录不可用".to_string())?;
    if candidate == root || !candidate.starts_with(&root) {
        return Err("CTranslate2 模型目录越出受管根目录".into());
    }
    let mut current = direct_root.to_path_buf();
    let relative = directory
        .strip_prefix(direct_root)
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
        roles: if model.backend == "ctranslate2" {
            vec![("model".into(), path.clone())]
        } else {
            model
                .files
                .iter()
                .map(|file| (file.role.clone(), path.join(&file.path)))
                .collect()
        },
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
    if !matches!(
        endpoint.trim_end_matches('/'),
        OFFICIAL_ENDPOINT | "https://hf-mirror.com"
    ) || parsed.scheme() != "https"
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
        file.source
            .as_ref()
            .map_or(&model.repository, |source| &source.repository),
        file.source
            .as_ref()
            .map_or(&model.revision, |source| &source.revision),
        file.path
    )
}

fn model_total(model: &ManifestModel) -> u64 {
    model.files.iter().map(|file| file.size_bytes).sum::<u64>()
        + model
            .required_vad
            .as_ref()
            .map_or(0, |file| file.size_bytes)
}

async fn run_download(
    model: &ManifestModel,
    roots: &ManagedModelRoots,
    endpoint: &str,
    job_id: &str,
    job: &Arc<StdMutex<ModelDownloadJob>>,
    vad_lock: &Mutex<()>,
) -> Result<ResolvedNativeAsrModel, String> {
    // Reuse the exact existing staging/Range/hash/publish path for the pair and
    // the single shared asset; only the logical completion includes both.
    let mut pair = model.clone();
    pair.required_vad = None;
    run_asset_download(&pair, roots, endpoint, job_id, job, 0).await?;
    if let Some(vad) = vad_model(model) {
        let _vad = vad_lock.lock().await;
        let completed = model.files.iter().map(|file| file.size_bytes).sum();
        run_asset_download(&vad, roots, endpoint, job_id, job, completed).await?;
    }
    let roots = roots.clone();
    let model = model.clone();
    tauri::async_runtime::spawn_blocking(move || resolve_sync(&roots, &model))
        .await
        .map_err(|_| "模型最终校验任务失败".to_string())??
        .ok_or_else(|| "模型或必需依赖校验失败".into())
}

async fn run_asset_download(
    model: &ManifestModel,
    roots: &ManagedModelRoots,
    endpoint: &str,
    job_id: &str,
    job: &Arc<StdMutex<ModelDownloadJob>>,
    progress_base: u64,
) -> Result<ResolvedNativeAsrModel, String> {
    let resolve_roots = roots.clone();
    let resolve_model = model.clone();
    if let Some(ready) =
        tauri::async_runtime::spawn_blocking(move || resolve_sync(&resolve_roots, &resolve_model))
            .await
            .map_err(|error| format!("模型校验任务失败：{error}"))??
    {
        update_progress(job, progress_base + model_total(model), snapshot_total(job));
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
        let mut completed = progress_base;
        for file in &model.files {
            let part = parts.join(format!("{}.part", file.path));
            // Repair can reuse an exact intact role without re-downloading gigabytes.
            // Never mutate the previous pair; the replacement still verifies as a unit.
            if model.backend != "ctranslate2" {
                let source = direct_path(roots, model).join(&file.path);
                let target = part.clone();
                let expected = file.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if verify_file(&source, &expected).is_ok() {
                        if path_entry_exists(&target) {
                            verify_plain_ancestors(&target)?;
                        }
                        fs::copy(&source, &target)
                            .map_err(|_| "无法复用已验证模型文件".to_string())?;
                    }
                    Ok::<_, String>(())
                })
                .await
                .map_err(|_| "模型修复任务失败".to_string())??;
            }
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
            update_progress(job, completed, snapshot_total(job));
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
    verify_plain_ancestors(path)?;
    let metadata =
        fs::symlink_metadata(path).map_err(|_| format!("模型文件缺失：{}", expected.path))?;
    if is_link_like(&metadata) || !metadata.is_file() || metadata.len() != expected.size_bytes {
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
    verify_plain_ancestors(stage)?;
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

pub(crate) fn verify_plain_ancestors(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        let metadata = fs::symlink_metadata(ancestor).map_err(|_| "受管路径不可用".to_string())?;
        if is_link_like(&metadata) {
            return Err("受管路径不得包含 symlink/reparse point".into());
        }
    }
    Ok(())
}

pub(crate) fn ensure_plain_directory(path: &Path) -> Result<(), String> {
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
                if let Err(error) = fs::create_dir(&current) {
                    if error.kind() != std::io::ErrorKind::AlreadyExists {
                        return Err(format!("无法创建受管目录：{error}"));
                    }
                }
                let metadata = fs::symlink_metadata(&current)
                    .map_err(|error| format!("无法检查并发创建的受管目录：{error}"))?;
                if is_link_like(&metadata) || !metadata.is_dir() {
                    return Err("并发创建的受管目录类型无效".into());
                }
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
    // reqwest/filesystem errors may contain URLs, credentials or local paths.
    if error.contains("网络") {
        "模型下载网络失败，请重试"
    } else if error.contains("哈希") || error.contains("校验") {
        "模型文件校验失败，请重试修复"
    } else {
        "模型下载或发布失败，请重试"
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::Method::GET;
    use httpmock::MockServer;
    use tempfile::tempdir;

    include!("asr_models_qwen_tests.rs");
    include!("asr_models_parakeet_tests.rs");

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
            post_mvp_unavailable: false,
            required_vad: None,
            files: files
                .iter()
                .map(|(role, path, bytes)| ManifestFile {
                    role: (*role).into(),
                    path: (*path).into(),
                    size_bytes: bytes.len() as u64,
                    sha256: hash(bytes),
                    source: None,
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

    fn complete_kotoba_fixture() -> (ManifestModel, Vec<(&'static str, &'static [u8])>) {
        let (mut model, mut bytes) = complete_fixture();
        let preprocessor = ("preprocessor_config.json", b"preprocessor".as_slice());
        model.files.push(ManifestFile {
            role: "preprocessor".into(),
            path: preprocessor.0.into(),
            size_bytes: preprocessor.1.len() as u64,
            sha256: hash(preprocessor.1),
            source: None,
        });
        model.logical_id = "kotoba-faster-whisper/kotoba-tech/kotoba-whisper-v2.0-faster".into();
        model.engine = "kotoba-faster-whisper".into();
        model.model = "kotoba-tech/kotoba-whisper-v2.0-faster".into();
        model.repository = "kotoba-tech/kotoba-whisper-v2.0-faster".into();
        bytes.push(preprocessor);
        (model, bytes)
    }

    fn renamed_fixture(
        mut model: ManifestModel,
        name: &str,
        repository: &str,
        revision_char: char,
    ) -> ManifestModel {
        model.logical_id = format!("faster-whisper/{name}");
        model.model = name.into();
        model.repository = repository.into();
        model.revision = revision_char.to_string().repeat(40);
        model
    }

    fn write_model(directory: &Path, files: &[(&str, &[u8])]) {
        fs::create_dir_all(directory).unwrap();
        for (path, bytes) in files {
            fs::write(directory.join(path), bytes).unwrap();
        }
    }

    #[test]
    fn manifest_content_is_exactly_frozen() {
        let mut manifest: serde_json::Value = serde_json::from_str(MANIFEST_JSON).unwrap();
        manifest["models"]
            .as_array_mut()
            .unwrap()
            .retain(|row| row["backend"] == "ctranslate2");
        assert_eq!(
            hash(&serde_json::to_vec(&manifest).unwrap()),
            "49a53cc898f66f82bfd946191ee92c13cb2faa06db821068ba5981e39b85694c"
        );
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
        let mut value: serde_json::Value = serde_json::from_str(&valid).unwrap();
        let kotoba = value["models"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|model| model["engine"] == "kotoba-faster-whisper")
            .unwrap();
        kotoba["files"]
            .as_array_mut()
            .unwrap()
            .retain(|file| file["role"] != "preprocessor");
        assert!(parse_manifest(&value.to_string()).is_err());
        for unsafe_model in [
            "owner/name/extra",
            "owner//name",
            "owner\\name",
            "/name",
            "owner/",
            "C:/name",
            "../name",
            "owner/..",
            "CON/name",
            "owner/NUL",
            "owner/name.",
        ] {
            let mut value: serde_json::Value = serde_json::from_str(&valid).unwrap();
            value["models"][0]["model"] = unsafe_model.into();
            value["models"][0]["logicalId"] = format!("faster-whisper/{unsafe_model}").into();
            assert!(parse_manifest(&value.to_string()).is_err());
        }
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

        let manifest = load_manifest().unwrap();
        let kotoba = find_model(
            &manifest,
            "kotoba-faster-whisper",
            "kotoba-tech/kotoba-whisper-v2.0-faster",
        )
        .unwrap();
        assert!(direct_path(&roots, kotoba).ends_with(format!(
            "kotoba-faster-whisper/kotoba-tech/kotoba-whisper-v2.0-faster/{}",
            kotoba.revision
        )));
        assert!(download_path(&roots, kotoba).ends_with(format!(
            "native-asr-models/kotoba-faster-whisper/kotoba-tech/kotoba-whisper-v2.0-faster/{}",
            kotoba.revision
        )));
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
    async fn optional_vad_effective_entry_direct_legacy_and_cache_are_request_scoped() {
        let manifest = load_manifest().unwrap();
        for entry in &manifest.models {
            assert_eq!(effective_entry(&manifest, entry, false).unwrap(), *entry);
            let enabled = effective_entry(&manifest, entry, true).unwrap();
            if entry.backend == "ctranslate2" {
                assert!(entry.required_vad.is_none());
                assert_eq!(
                    enabled.required_vad,
                    manifest.models.iter().find_map(|m| m.required_vad.clone())
                );
            } else {
                assert_eq!(enabled, *entry);
            }
        }
        for legacy in [false, true] {
            let dir = tempdir().unwrap();
            let roots = ManagedModelRoots::below(dir.path());
            let (off, files) = complete_fixture();
            let (qwen, vad_files) = qwen_fixture();
            let mut on = off.clone();
            on.required_vad = qwen.required_vad;
            let model_path = if legacy {
                legacy_path(&roots, &off)
            } else {
                direct_path(&roots, &off)
            };
            write_model(&model_path, &files);
            let manager = NativeAsrModelManager::default();
            assert_eq!(
                manager
                    .resolve_entry_with_roots(roots.clone(), off.clone())
                    .await
                    .unwrap()
                    .unwrap()
                    .roles
                    .len(),
                1
            );
            assert!(manager
                .resolve_entry_with_roots(roots.clone(), on.clone())
                .await
                .unwrap()
                .is_none());
            let vad = vad_model(&on).unwrap();
            write_model(&direct_path(&roots, &vad), &vad_files[2..]);
            let ready = manager
                .resolve_entry_with_roots(roots.clone(), on.clone())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                ready.roles.iter().map(|r| r.0.as_str()).collect::<Vec<_>>(),
                ["model", "vad"]
            );
            assert_eq!(
                ready.origin,
                if legacy {
                    NativeAsrModelOrigin::LegacyHuggingFaceSnapshot
                } else {
                    NativeAsrModelOrigin::DirectInstall
                }
            );
            fs::write(&ready.roles[1].1, b"corrupt-vad").unwrap();
            assert!(manager
                .resolve_entry_with_roots(roots.clone(), on.clone())
                .await
                .unwrap()
                .is_none());
            assert_eq!(
                manager
                    .resolve_entry_with_roots(roots.clone(), off)
                    .await
                    .unwrap()
                    .unwrap()
                    .roles
                    .len(),
                1
            );
            let parts = download_path(&roots, &vad).join("parts");
            fs::create_dir_all(&parts).unwrap();
            fs::write(
                parts.join(format!("{}.part", vad.files[0].path)),
                vad_files[2].1,
            )
            .unwrap();
            let repair = manager
                .start_download_for_model(on.clone(), roots.clone(), "http://127.0.0.1:1".into())
                .await
                .unwrap();
            assert_eq!(
                wait_terminal(&manager, &repair).await.status,
                ModelDownloadJobStatus::Completed
            );
            assert_eq!(
                manager
                    .resolve_entry_with_roots(roots, on)
                    .await
                    .unwrap()
                    .unwrap()
                    .roles
                    .len(),
                2
            );
        }
    }

    #[tokio::test]
    async fn optional_vad_download_conflicts_resume_and_offline_legacy_reuse() {
        for first_use_vad in [false, true] {
            let server = MockServer::start_async().await;
            let dir = tempdir().unwrap();
            let roots = ManagedModelRoots::below(dir.path());
            let (off, files) = complete_fixture();
            let (qwen, vad_files) = qwen_fixture();
            let mut on = off.clone();
            on.required_vad = qwen.required_vad;
            let vad = vad_model(&on).unwrap();
            // Exact main model stays read-only in the legacy cache; only Silero is acquired.
            write_model(&legacy_path(&roots, &off), &files);
            let parts = download_path(&roots, &vad).join("parts");
            fs::create_dir_all(&parts).unwrap();
            let bytes = vad_files[2].1;
            fs::write(
                parts.join(format!("{}.part", vad.files[0].path)),
                &bytes[..3],
            )
            .unwrap();
            let url = file_url(&server.base_url(), &vad, &vad.files[0]);
            let mock = server.mock(|when, then| {
                when.method(GET)
                    .path(url.strip_prefix(&server.base_url()).unwrap())
                    .header("range", "bytes=3-");
                then.status(206)
                    .header(
                        "content-range",
                        format!("bytes 3-{}/{}", bytes.len() - 1, bytes.len()),
                    )
                    .body(bytes[3..].to_vec());
            });
            let manager = NativeAsrModelManager::default();
            let first_entry = if first_use_vad { &on } else { &off };
            let conflicting = if first_use_vad { &off } else { &on };
            let first = manager
                .start_download_for_model(first_entry.clone(), roots.clone(), server.base_url())
                .await
                .unwrap();
            assert_eq!(
                manager
                    .start_download_for_model(first_entry.clone(), roots.clone(), server.base_url())
                    .await
                    .unwrap(),
                first
            );
            assert!(manager
                .start_download_for_model(conflicting.clone(), roots.clone(), server.base_url())
                .await
                .unwrap_err()
                .contains("依赖"));
            assert_eq!(
                wait_terminal(&manager, &first).await.status,
                ModelDownloadJobStatus::Completed
            );
            if !first_use_vad {
                assert!(manager
                    .resolve_entry_with_roots(roots.clone(), on.clone())
                    .await
                    .unwrap()
                    .is_none());
                let id = manager
                    .start_download_for_model(on.clone(), roots.clone(), server.base_url())
                    .await
                    .unwrap();
                assert_eq!(
                    wait_terminal(&manager, &id).await.status,
                    ModelDownloadJobStatus::Completed
                );
            }
            mock.assert_hits(1);
            let ready = manager
                .resolve_entry_with_roots(roots.clone(), on.clone())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                ready.origin,
                NativeAsrModelOrigin::LegacyHuggingFaceSnapshot
            );
            assert_eq!(ready.roles.len(), 2);
            assert!(!direct_path(&roots, &off).exists());
            let offline = manager
                .start_download_for_model(on.clone(), roots.clone(), "http://127.0.0.1:1".into())
                .await
                .unwrap();
            let done = wait_terminal(&manager, &offline).await;
            assert_eq!(done.status, ModelDownloadJobStatus::Completed);
            assert_eq!(done.downloaded_bytes, model_total(&on));
            assert!(manager
                .resolve_entry_with_roots(roots.clone(), off)
                .await
                .unwrap()
                .is_some());
            for endpoint in [OFFICIAL_ENDPOINT, "https://hf-mirror.com"] {
                assert!(file_url(endpoint, &on, on.required_vad.as_ref().unwrap())
                    .starts_with(&format!("{endpoint}/ggml-org/whisper-vad/resolve/")));
            }
        }
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

    #[test]
    fn kotoba_readiness_requires_exact_preprocessor_for_direct_and_legacy_paths() {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_kotoba_fixture();
        let direct = direct_path(&roots, &model);
        write_model(&direct, &files);
        let resolved = resolve_sync(&roots, &model).unwrap().unwrap();
        assert_eq!(resolved.origin, NativeAsrModelOrigin::DirectInstall);

        fs::remove_file(direct.join("preprocessor_config.json")).unwrap();
        assert!(resolve_sync(&roots, &model).unwrap().is_none());
        fs::write(direct.join("preprocessor_config.json"), b"wrongcontent").unwrap();
        assert!(resolve_sync(&roots, &model).unwrap().is_none());

        fs::remove_dir_all(&direct).unwrap();
        let legacy = legacy_path(&roots, &model);
        write_model(&legacy, &files);
        let resolved = resolve_sync(&roots, &model).unwrap().unwrap();
        assert_eq!(
            resolved.origin,
            NativeAsrModelOrigin::LegacyHuggingFaceSnapshot
        );
        fs::remove_file(legacy.join("preprocessor_config.json")).unwrap();
        assert!(resolve_sync(&roots, &model).unwrap().is_none());
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
    #[ignore = "manual read-only profile of the installed default model"]
    async fn dependency_probe_profile_default_model() {
        let deps = PathBuf::from(std::env::var_os("HIKARU_PROFILE_DEPS").expect("deps root"));
        let roots = ManagedModelRoots::below(&deps);
        let manager = NativeAsrModelManager::default();
        for pass in ["cold", "cached"] {
            let start = std::time::Instant::now();
            let status = manager
                .status_with_roots(roots.clone(), "faster-whisper", "large-v3", false)
                .await
                .unwrap();
            assert_eq!(status.disposition, NativeAsrModelDisposition::Ready);
            eprintln!("Default model {pass} verification: {:?}", start.elapsed());
        }
    }

    #[tokio::test]
    async fn concurrent_readiness_waits_before_hashing_and_reuses_verified_result() {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = complete_fixture();
        write_model(&direct_path(&roots, &model), &files);
        let manager = NativeAsrModelManager::default();
        let gate = manager.verification.lock().await;
        let check = manager.resolve_entry_with_roots(roots.clone(), model.clone());
        tokio::pin!(check);
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut check)
            .await
            .is_err());
        assert!(manager.ready_cache.lock().unwrap().is_empty());
        // Another page may have completed verification while this caller waited.
        let ready = resolve_sync(&roots, &model).unwrap().unwrap();
        manager.remember_ready(&roots, &model, ready).unwrap();
        fs::remove_file(direct_path(&roots, &model).join("model.bin")).unwrap();
        drop(gate);
        assert!(check.await.unwrap().is_some());
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
    fn manifest_backed_engines_follow_embedded_runtime_capabilities() {
        let manifest = load_manifest().unwrap();
        for model in [
            "tiny",
            "base",
            "small",
            "medium",
            "large-v2",
            "large-v3",
            "large-v3-turbo",
        ] {
            assert!(find_model(&manifest, "faster-whisper", model).is_some());
        }
        let kotoba = find_model(
            &manifest,
            "kotoba-faster-whisper",
            "kotoba-tech/kotoba-whisper-v2.0-faster",
        )
        .unwrap();
        assert_eq!(kotoba.files.len(), 5);
        assert!(kotoba
            .files
            .iter()
            .any(|file| file.role == "preprocessor" && file.path == "preprocessor_config.json"));

        let engines = known_native_asr_engines().unwrap();
        assert!(engines.contains(&("faster-whisper".into(), true, Some("ctranslate2".into()))));
        assert!(engines.contains(&(
            "kotoba-faster-whisper".into(),
            true,
            Some("ctranslate2".into())
        )));
        assert!(engines.contains(&("qwen3-asr".into(), true, Some("crispasr".into()))));
        assert!(engines.contains(&(
            "parakeet".into(),
            crate::dependencies::crispasr_supports_engine("parakeet"),
            Some("crispasr".into())
        )));
        let reazon = find_model(
            &manifest,
            "reazonspeech-nemo",
            "reazon-research/reazonspeech-nemo-v2",
        )
        .unwrap();
        assert!(!reazon.post_mvp_unavailable);
        let reazon_supported = crate::dependencies::crispasr_supports_engine("reazonspeech-nemo");
        assert_eq!(model_supported(reazon), reazon_supported);
        assert_eq!(
            downloadable_entry(
                &manifest,
                "reazonspeech-nemo",
                "reazon-research/reazonspeech-nemo-v2"
            )
            .is_ok(),
            reazon_supported
        );
        assert!(engines.contains(&(
            "reazonspeech-nemo".into(),
            reazon_supported,
            Some("crispasr".into())
        )));
        assert_eq!(
            unavailable_status("reazonspeech-nemo", "reazon-research/reazonspeech-nemo-v2")
                .disposition,
            NativeAsrModelDisposition::Unsupported
        );
        assert_eq!(
            unavailable_status("parakeet", "nvidia/parakeet-tdt_ctc-0.6b-ja").disposition,
            NativeAsrModelDisposition::PostMvpUnavailable
        );
        assert_eq!(
            unavailable_status("other", "thing").disposition,
            NativeAsrModelDisposition::Unsupported
        );
    }

    #[tokio::test]
    async fn reazonspeech_status_is_gated_by_embedded_runtime_before_storage_readiness() {
        let dir = tempdir().unwrap();
        let status = NativeAsrModelManager::default()
            .status_with_roots(
                ManagedModelRoots::below(dir.path()),
                "reazonspeech-nemo",
                "reazon-research/reazonspeech-nemo-v2",
                false,
            )
            .await
            .unwrap();
        if crate::dependencies::crispasr_supports_engine("reazonspeech-nemo") {
            assert_eq!(
                status.disposition,
                NativeAsrModelDisposition::SupportedMissing
            );
            assert_eq!(status.backend.as_deref(), Some("crispasr"));
            assert_eq!(
                status.revision.as_deref(),
                Some("22799a5919ea26e3c5293fe0e68846fe7918a234")
            );
        } else {
            assert_eq!(status.disposition, NativeAsrModelDisposition::Unsupported);
            assert!(status.backend.is_none());
            assert!(status.revision.is_none());
        }
        assert!(status.resolved_path.is_none());
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

    #[test]
    fn readiness_and_managed_paths_are_isolated_across_models_and_vocabulary_forms() {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (turbo, turbo_files) = complete_fixture();
        let tiny_files = vec![
            ("config.json", b"tiny-config".as_slice()),
            ("model.bin", b"tiny-weights".as_slice()),
            ("tokenizer.json", b"tiny-tokenizer".as_slice()),
            ("vocabulary.txt", b"tiny-vocabulary".as_slice()),
        ];
        let tiny = renamed_fixture(
            fixture_model(&[
                ("model-config", tiny_files[0].0, tiny_files[0].1),
                ("model-weights", tiny_files[1].0, tiny_files[1].1),
                ("tokenizer", tiny_files[2].0, tiny_files[2].1),
                ("vocabulary", tiny_files[3].0, tiny_files[3].1),
            ]),
            "tiny",
            "test/tiny",
            'b',
        );
        let turbo = renamed_fixture(turbo, "large-v3-turbo", "test/turbo", 'c');

        write_model(&direct_path(&roots, &tiny), &tiny_files);
        write_model(&legacy_path(&roots, &turbo), &turbo_files);
        assert_eq!(
            resolve_sync(&roots, &tiny).unwrap().unwrap().origin,
            NativeAsrModelOrigin::DirectInstall
        );
        assert_eq!(
            resolve_sync(&roots, &turbo).unwrap().unwrap().origin,
            NativeAsrModelOrigin::LegacyHuggingFaceSnapshot
        );

        fs::write(direct_path(&roots, &tiny).join("model.bin"), b"broken").unwrap();
        assert!(resolve_sync(&roots, &tiny).unwrap().is_none());
        assert!(resolve_sync(&roots, &turbo).unwrap().is_some());

        let manifest = load_manifest().unwrap();
        let direct_paths: HashSet<_> = manifest
            .models
            .iter()
            .map(|model| direct_path(&roots, model))
            .collect();
        let download_paths: HashSet<_> = manifest
            .models
            .iter()
            .map(|model| download_path(&roots, model))
            .collect();
        assert_eq!(direct_paths.len(), manifest.models.len());
        assert_eq!(download_paths.len(), manifest.models.len());
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

    #[tokio::test]
    async fn different_models_use_independent_download_jobs_and_terminal_identity() {
        let server = MockServer::start_async().await;
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (base, files) = complete_fixture();
        let base = renamed_fixture(base, "base", "test/base", 'b');
        let (small, _) = complete_fixture();
        let small = renamed_fixture(small, "small", "test/small", 'c');
        for model in [&base, &small] {
            for (path, bytes) in &files {
                server.mock(|when, then| {
                    when.method(GET).path(format!(
                        "/{}/resolve/{}/{}",
                        model.repository, model.revision, path
                    ));
                    then.status(200).body(bytes.to_vec());
                });
            }
        }

        let manager = NativeAsrModelManager::default();
        let base_id = manager
            .start_download_for_model(base.clone(), roots.clone(), server.base_url())
            .await
            .unwrap();
        let small_id = manager
            .start_download_for_model(small.clone(), roots.clone(), server.base_url())
            .await
            .unwrap();
        assert_ne!(base_id, small_id);

        for (model, id) in [(&base, &base_id), (&small, &small_id)] {
            let snapshot = wait_terminal(&manager, id).await;
            assert_eq!(
                (
                    snapshot.engine.as_str(),
                    snapshot.model.as_str(),
                    snapshot.revision.as_str()
                ),
                (
                    "faster-whisper",
                    model.model.as_str(),
                    model.revision.as_str()
                )
            );
            assert_eq!(
                snapshot.status,
                ModelDownloadJobStatus::Completed,
                "{:?}",
                snapshot.error
            );
            assert!(direct_path(&roots, model).is_dir());
        }
    }
}
