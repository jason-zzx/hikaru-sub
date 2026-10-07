//! Independent CrispASR file authority and resolution. Installed runtime readiness
//! is independent of external CUDA download publication.
use super::*;
use crate::asr_models::verify_plain_ancestors;

#[path = "dependencies_crispasr_probe.rs"]
mod cuda_probe;

const LOCK_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/crispasr-runtime-lock.json"));
#[cfg(test)]
const PUBLISHED_LOCK_JSON: &str =
    include_str!("../../native-asr/runtime/crispasr-product-lock.json");
const UNAVAILABLE: &str = "[crispasr_runtime_unavailable] CrispASR 运行时缺失、损坏或不受支持";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductLock {
    schema_version: u32,
    product_enablement_allowed: bool,
    #[serde(default)]
    external_stable_asset_published: bool,
    cpu: Option<ArtifactLock>,
    cuda: Option<ArtifactLock>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactLock {
    artifact_id: String,
    #[serde(default)]
    engines: Option<Vec<String>>,
    manifest_sha256: String,
    files: Vec<NativeAsrRuntimeFile>,
    #[serde(default)]
    archive: Option<ArchiveLock>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveLock {
    size_bytes: u64,
    sha256: String,
    root: String,
}

impl ArtifactLock {
    fn engines(&self, device: &str) -> Result<Vec<String>, String> {
        let engines = self
            .engines
            .clone()
            .unwrap_or_else(|| vec!["qwen3-asr".into()]);
        if !self
            .artifact_id
            .starts_with(&format!("hikaru-asr-crispasr-windows-x64-{device}-"))
            || (engines != ["qwen3-asr"]
                && engines != ["qwen3-asr", "parakeet"]
                && engines != ["qwen3-asr", "parakeet", "reazonspeech-nemo"])
            || (engines.len() >= 2
                && !self
                    .artifact_id
                    .starts_with(&format!("hikaru-asr-crispasr-windows-x64-{device}-shared-")))
        {
            return Err(UNAVAILABLE.into());
        }
        Ok(engines)
    }
}

impl ProductLock {
    fn supports_engine(&self, engine: &str) -> bool {
        self.schema_version == 1
            && self.product_enablement_allowed
            && [("cpu", &self.cpu), ("cuda", &self.cuda)]
                .iter()
                .all(|(device, artifact)| {
                    artifact.as_ref().is_some_and(|artifact| {
                        artifact
                            .engines(device)
                            .is_ok_and(|engines| engines.iter().any(|name| name == engine))
                    })
                })
    }
}

// Model support is a build capability, not a CUDA publication or runtime-env flag.
// Listing and launch still verify the installed payload against this authority.
pub(super) fn supports_engine(engine: &str) -> bool {
    serde_json::from_str::<ProductLock>(LOCK_JSON).is_ok_and(|lock| lock.supports_engine(engine))
}

fn runtime_root(resources: &Path, deps: &Path, device: &str) -> Result<PathBuf, String> {
    match device {
        "cpu" => Ok(resources.join("native-asr/windows-x64/crispasr/cpu")),
        "cuda" => Ok(deps.join("asr-runtime/crispasr/cuda/current")),
        _ => Err(UNAVAILABLE.into()),
    }
}

fn verify_at(
    resources: &Path,
    deps: &Path,
    device: &str,
    lock: &ProductLock,
) -> Result<ResolvedNativeAsrCpuRuntime, String> {
    if lock.schema_version != 1 || !lock.product_enablement_allowed {
        return Err(UNAVAILABLE.into());
    }
    let artifact = match device {
        "cpu" => lock.cpu.as_ref(),
        "cuda" => lock.cuda.as_ref(),
        _ => None,
    }
    .ok_or(UNAVAILABLE)?;
    let root = runtime_root(resources, deps, device)?;
    verify_payload(&root, device, artifact)
}

fn verify_payload(
    root: &Path,
    device: &str,
    artifact: &ArtifactLock,
) -> Result<ResolvedNativeAsrCpuRuntime, String> {
    for path in [
        root,
        &root.join("runtime-manifest.json"),
        &root.join("SHA256SUMS"),
    ] {
        verify_plain_ancestors(path).map_err(|_| UNAVAILABLE)?;
    }
    if !artifact
        .artifact_id
        .starts_with(&format!("hikaru-asr-crispasr-windows-x64-{device}-"))
        || !is_sha256(&artifact.manifest_sha256)
        || sha256_file(&root.join("runtime-manifest.json")).map_err(|_| UNAVAILABLE)?
            != artifact.manifest_sha256
    {
        return Err(UNAVAILABLE.into());
    }
    let manifest: NativeAsrRuntimeManifest = serde_json::from_slice(
        &fs::read(root.join("runtime-manifest.json")).map_err(|_| UNAVAILABLE)?,
    )
    .map_err(|_| UNAVAILABLE)?;
    let caps = &manifest.capabilities;
    let engines = artifact.engines(device)?;
    if manifest.schema_version != 1
        || manifest.protocol_version != 1
        || manifest.artifact_id != artifact.artifact_id
        || manifest.platform != "windows-x64"
        || manifest.arch != "x64"
        || caps.backend != "crispasr"
        || caps.device != device
        || caps.engines != engines
        || !caps.vad
        || caps.vad_export && device != "cpu"
        || !caps.crispasr
        || caps.cuda != (device == "cuda")
        || caps.vulkan
        || caps.models_bundled
    {
        return Err(UNAVAILABLE.into());
    }
    let checksums = parse_runtime_checksums(&root).map_err(|_| UNAVAILABLE)?;
    let mut expected = HashSet::new();
    let mut binaries = vec![
        "hikaru-asr-worker.exe",
        "crispasr.exe",
        "msvcp140.dll",
        "vcruntime140.dll",
        "vcruntime140_1.dll",
        "vcomp140.dll",
    ];
    if device == "cuda" {
        binaries.extend(["cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"]);
    }
    for row in &artifact.files {
        if (!row.path.starts_with("licenses/") && !binaries.contains(&row.path.as_str()))
            || !safe_runtime_relative_path(&row.path)
            || row.path.contains(['\\', ':'])
            || row
                .path
                .split('/')
                .any(|part| crate::asr_models::validate_segment("runtime.file", part).is_err())
            || !expected.insert(row.path.to_ascii_lowercase())
            || row.size_bytes == 0
            || !is_sha256(&row.sha256)
            || checksums.get(&row.path) != Some(&row.sha256)
            || !manifest.files.iter().any(|file| {
                file.path == row.path
                    && file.size_bytes == row.size_bytes
                    && file.sha256 == row.sha256
            })
        {
            return Err(UNAVAILABLE.into());
        }
        let path = root.join(&row.path);
        verify_plain_ancestors(&path).map_err(|_| UNAVAILABLE)?;
        let metadata = fs::symlink_metadata(&path).map_err(|_| UNAVAILABLE)?;
        if !metadata.is_file()
            || metadata.len() != row.size_bytes
            || sha256_file(&path).map_err(|_| UNAVAILABLE)? != row.sha256
        {
            return Err(UNAVAILABLE.into());
        }
    }
    let mut actual = Vec::new();
    collect_runtime_files(&root, &root, &mut actual).map_err(|_| UNAVAILABLE)?;
    if artifact.files.len() != manifest.files.len()
        || checksums.len() != artifact.files.len()
        || actual.into_iter().collect::<HashSet<_>>()
            != artifact
                .files
                .iter()
                .map(|file| file.path.clone())
                .collect()
        || binaries
            .iter()
            .any(|path| !expected.contains(&path.to_ascii_lowercase()))
        || !expected.contains("licenses/third-party-notices.json")
    {
        return Err(UNAVAILABLE.into());
    }
    Ok(ResolvedNativeAsrCpuRuntime {
        worker: root.join("hikaru-asr-worker.exe"),
        root: root.to_path_buf(),
        artifact_id: artifact.artifact_id.clone(),
        engines,
        supports_vad: caps.vad,
        vad_cli_path: (device == "cpu" && caps.vad_export).then(|| root.join("crispasr.exe")),
    })
}

#[cfg(test)]
pub(super) fn verify_delivery_test_runtime(
    root: &Path,
    device: &str,
) -> Result<ResolvedNativeAsrCpuRuntime, String> {
    let lock: ProductLock = serde_json::from_str(LOCK_JSON).map_err(|_| UNAVAILABLE)?;
    assert!(lock.product_enablement_allowed);
    let artifact = if device == "cpu" {
        lock.cpu.as_ref()
    } else {
        lock.cuda.as_ref()
    }
    .ok_or(UNAVAILABLE)?;
    let runtime = verify_payload(root, device, artifact)?;
    if device == "cuda" {
        cuda_probe::probe(root)?;
    }
    Ok(runtime)
}

pub(super) fn resolve(
    app: &AppHandle,
    device: &str,
) -> Result<ResolvedNativeAsrCpuRuntime, String> {
    let lock: ProductLock = serde_json::from_str(LOCK_JSON).map_err(|_| UNAVAILABLE)?;
    let resources = app.path().resource_dir().map_err(|_| UNAVAILABLE)?;
    let runtime = verify_at(&resources, &deps_dir(app)?, device, &lock)?;
    if device == "cuda" {
        cuda_probe::probe(&runtime.root)?;
    }
    Ok(runtime)
}

#[path = "dependencies_crispasr_delivery.rs"]
mod delivery;
pub(super) use delivery::{download_dir, items, managed_root, prepare};

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    fn hash(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    // Instance-only synthetic authority; nothing reads an env/IPC override.
    pub(super) fn fixture(resources: &Path, deps: &Path, device: &str) -> ProductLock {
        let root = runtime_root(resources, deps, device).unwrap();
        fs::create_dir_all(root.join("licenses")).unwrap();
        let mut files = Vec::new();
        let mut checksums = String::new();
        let mut paths = vec![
            "hikaru-asr-worker.exe",
            "crispasr.exe",
            "msvcp140.dll",
            "vcruntime140.dll",
            "vcruntime140_1.dll",
            "vcomp140.dll",
            "licenses/THIRD-PARTY-NOTICES.json",
        ];
        if device == "cuda" {
            paths.extend(["cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"]);
        }
        for path in paths {
            let bytes = format!("synthetic {device} {path}");
            fs::write(root.join(path), &bytes).unwrap();
            checksums.push_str(&format!("{}  {path}\n", hash(bytes.as_bytes())));
            files.push(serde_json::json!({"path":path, "sizeBytes":bytes.len(), "sha256":hash(bytes.as_bytes())}));
        }
        fs::write(root.join("SHA256SUMS"), checksums).unwrap();
        let id = format!("hikaru-asr-crispasr-windows-x64-{device}-fixture");
        let manifest = serde_json::to_vec(&serde_json::json!({
            "schemaVersion":1, "artifactId":id, "platform":"windows-x64", "arch":"x64", "protocolVersion":1,
            "capabilities":{"backend":"crispasr","device":device,"engines":["qwen3-asr"],
                "vad":true,"crispasr":true,"cuda":device=="cuda","vulkan":false,"modelsBundled":false},
            "files":files
        })).unwrap();
        fs::write(root.join("runtime-manifest.json"), &manifest).unwrap();
        let mut value = serde_json::json!({"schemaVersion":1,"productEnablementAllowed":true,"cpu":null,"cuda":null});
        value[device] =
            serde_json::json!({"artifactId":id,"manifestSha256":hash(&manifest),"files":files});
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn build_engine_support_requires_both_devices_not_cuda_publication() {
        let published: ProductLock = serde_json::from_str(PUBLISHED_LOCK_JSON).unwrap();
        assert!(published.supports_engine("qwen3-asr"));
        assert!(published.supports_engine("parakeet"));
        assert!(published.supports_engine("reazonspeech-nemo"));
        // Retained published v1 remains valid rollback authority, not Parakeet/ReazonSpeech support.
        let mut lock: ProductLock = serde_json::from_str(include_str!(
            "../../native-asr/runtime/crispasr-product-lock-v1.json"
        ))
        .unwrap();
        assert!(lock.supports_engine("qwen3-asr"));
        assert!(!lock.supports_engine("parakeet"));
        for (device, artifact) in [
            ("cpu", lock.cpu.as_mut().unwrap()),
            ("cuda", lock.cuda.as_mut().unwrap()),
        ] {
            artifact.artifact_id =
                format!("hikaru-asr-crispasr-windows-x64-{device}-shared-fixture");
            artifact.engines = Some(vec![
                "qwen3-asr".into(),
                "parakeet".into(),
                "reazonspeech-nemo".into(),
            ]);
        }
        lock.external_stable_asset_published = false;
        assert!(lock.supports_engine("parakeet"));
        assert!(lock.supports_engine("qwen3-asr"));
        assert!(lock.supports_engine("reazonspeech-nemo"));
        lock.cuda.as_mut().unwrap().engines = None;
        assert!(!lock.supports_engine("parakeet"));
        assert!(!lock.supports_engine("reazonspeech-nemo"));
        assert!(lock.supports_engine("qwen3-asr"));
        lock.cuda = None;
        assert!(!lock.supports_engine("parakeet"));
        lock.product_enablement_allowed = false;
        assert!(!lock.supports_engine("qwen3-asr"));
    }

    #[test]
    fn enabled_authority_rejects_missing_and_wrong_runtime_bytes() {
        let dir = tempdir().unwrap();
        let resources = dir.path().join("resources");
        let deps = dir.path().join("deps");
        let lock: ProductLock = serde_json::from_str(PUBLISHED_LOCK_JSON).unwrap();
        assert!(lock.product_enablement_allowed);
        assert!(lock.external_stable_asset_published);
        assert!(lock.cpu.is_some() && lock.cuda.is_some());
        for device in ["cpu", "cuda"] {
            assert!(verify_at(&resources, &deps, device, &lock).is_err());
            fixture(&resources, &deps, device);
            assert!(verify_at(&resources, &deps, device, &lock).is_err());
        }
    }

    #[test]
    fn shared_candidate_requires_exact_capabilities_and_complete_device_closure() {
        for device in ["cpu", "cuda"] {
            let dir = tempdir().unwrap();
            let resources = dir.path().join("resources");
            let deps = dir.path().join("deps");
            let mut lock = fixture(&resources, &deps, device);
            let old_runtime = verify_at(&resources, &deps, device, &lock).unwrap();
            old_runtime.require_engine("qwen3-asr").unwrap();
            assert!(old_runtime.require_engine("parakeet").is_err());
            let root = runtime_root(&resources, &deps, device).unwrap();
            let artifact = if device == "cpu" {
                lock.cpu.as_mut().unwrap()
            } else {
                lock.cuda.as_mut().unwrap()
            };
            artifact.artifact_id =
                format!("hikaru-asr-crispasr-windows-x64-{device}-shared-fixture");
            artifact.engines = Some(vec!["qwen3-asr".into(), "parakeet".into()]);
            let manifest_path = root.join("runtime-manifest.json");
            let mut manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
            manifest["artifactId"] = artifact.artifact_id.clone().into();
            manifest["capabilities"]["engines"] = serde_json::json!(["qwen3-asr", "parakeet"]);
            let bytes = serde_json::to_vec(&manifest).unwrap();
            fs::write(&manifest_path, &bytes).unwrap();
            artifact.manifest_sha256 = hash(&bytes);
            let shared = verify_payload(&root, device, artifact).unwrap();
            shared.require_engine("qwen3-asr").unwrap();
            shared.require_engine("parakeet").unwrap();
            assert!(shared.require_engine("reazonspeech-nemo").is_err());
            for engines in [
                vec!["parakeet".into()],
                vec!["parakeet".into(), "qwen3-asr".into()],
                vec!["qwen3-asr".into()],
            ] {
                artifact.engines = Some(engines);
                assert!(verify_payload(&root, device, artifact).is_err());
            }
            artifact.engines = Some(vec!["qwen3-asr".into(), "parakeet".into()]);
            for dll in [
                "vcomp140.dll",
                if device == "cuda" {
                    "cublasLt64_12.dll"
                } else {
                    "msvcp140.dll"
                },
            ] {
                let path = root.join(dll);
                let bytes = fs::read(&path).unwrap();
                fs::remove_file(&path).unwrap();
                assert!(verify_payload(&root, device, artifact).is_err());
                fs::write(path, bytes).unwrap();
            }
            verify_payload(&root, device, artifact).unwrap();
            assert!(verify_payload(
                &root,
                if device == "cpu" { "cuda" } else { "cpu" },
                artifact
            )
            .is_err());
        }
    }

    #[test]
    fn standalone_vad_export_requires_verified_cpu_capability_and_full_closure() {
        for device in ["cpu", "cuda"] {
            let dir = tempdir().unwrap();
            let resources = dir.path().join("resources");
            let deps = dir.path().join("deps");
            let mut lock = fixture(&resources, &deps, device);
            assert!(verify_at(&resources, &deps, device, &lock)
                .unwrap()
                .vad_cli_path
                .is_none());
            let root = runtime_root(&resources, &deps, device).unwrap();
            let path = root.join("runtime-manifest.json");
            let mut manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            manifest["capabilities"]["vadExport"] = true.into();
            let bytes = serde_json::to_vec(&manifest).unwrap();
            fs::write(&path, &bytes).unwrap();
            assert!(verify_at(&resources, &deps, device, &lock).is_err());
            let artifact = if device == "cpu" {
                lock.cpu.as_mut().unwrap()
            } else {
                lock.cuda.as_mut().unwrap()
            };
            artifact.manifest_sha256 = hash(&bytes);
            if device == "cuda" {
                assert!(verify_at(&resources, &deps, device, &lock).is_err());
                continue;
            }
            let verified = verify_at(&resources, &deps, device, &lock).unwrap();
            assert_eq!(verified.vad_cli_path, Some(root.join("crispasr.exe")));
            fs::write(root.join("vcomp140.dll"), b"corrupt").unwrap();
            assert!(verify_at(&resources, &deps, device, &lock).is_err());
        }
    }

    #[test]
    fn separate_device_roots_exact_artifact_and_file_closure() {
        for mode in ["installed", "便携 路径"] {
            for device in ["cpu", "cuda"] {
                let dir = tempdir().unwrap();
                let resources = dir.path().join(mode).join("resources");
                let deps = dir.path().join(mode).join("deps");
                let lock = fixture(&resources, &deps, device);
                let runtime = verify_at(&resources, &deps, device, &lock).unwrap();
                assert_eq!(
                    runtime.root,
                    runtime_root(&resources, &deps, device).unwrap()
                );
                assert!(verify_at(
                    &resources,
                    &deps,
                    if device == "cpu" { "cuda" } else { "cpu" },
                    &lock
                )
                .is_err());
                assert!(
                    verify_at(&resources.join("other"), &deps.join("other"), device, &lock)
                        .is_err()
                );
                fs::write(runtime.root.join("ctranslate2.dll"), b"wrong tree").unwrap();
                assert!(verify_at(&resources, &deps, device, &lock).is_err());
                fs::remove_file(runtime.root.join("ctranslate2.dll")).unwrap();
                fs::write(&runtime.worker, b"corrupt").unwrap();
                assert!(verify_at(&resources, &deps, device, &lock).is_err());
                let mut lock = fixture(&resources, &deps, device);
                let artifact = if device == "cpu" {
                    lock.cpu.as_mut().unwrap()
                } else {
                    lock.cuda.as_mut().unwrap()
                };
                artifact.artifact_id = "hikaru-asr-windows-x64-cpu-v3".into();
                assert!(verify_at(&resources, &deps, device, &lock).is_err());
            }
        }
    }
}
