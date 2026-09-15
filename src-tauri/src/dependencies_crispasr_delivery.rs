//! Same dependency jobs/HTTP/hash/staging surfaces; independent artifact and root.
use super::*;
const PENDING: &str = "CrispASR CUDA 运行时缺失、损坏或设备探测失败；下载源尚未发布，可使用 CPU";

pub(in crate::dependencies) fn managed_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("asr-runtime/crispasr/cuda"))
}
pub(in crate::dependencies) fn download_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(downloads_dir(app)?.join("crispasr-cuda"))
}
fn source_matches(source: Option<&RuntimeDependencyBinarySource>, artifact: &ArtifactLock) -> bool {
    let Some(archive) = &artifact.archive else {
        return false;
    };
    source.is_some_and(|source| {
        source.archive == RuntimeDependencyArchive::Zip
            && source.size_bytes == archive.size_bytes
            && source.sha256 == archive.sha256
            && source.strip_prefix.is_none()
            && source.url.starts_with("https://")
    })
}
fn published(lock: &ProductLock, sources: &RuntimeDependencyPlatformSources) -> bool {
    lock.product_enablement_allowed
        && lock.external_stable_asset_published
        && lock.cuda.as_ref().is_some_and(|artifact| {
            source_matches(sources.official.crispasr_cuda.as_ref(), artifact)
                && source_matches(sources.china.crispasr_cuda.as_ref(), artifact)
        })
}

pub(in crate::dependencies) fn items(
    app: &AppHandle,
) -> Result<Vec<RuntimeDependencyItem>, String> {
    let lock: ProductLock = serde_json::from_str(LOCK_JSON).map_err(|_| UNAVAILABLE)?;
    let resources = app.path().resource_dir().map_err(|_| UNAVAILABLE)?;
    let deps = deps_dir(app)?;
    let download_available = platform_sources().is_ok_and(|sources| published(&lock, &sources));
    items_at(
        &resources,
        &deps,
        &lock,
        download_available,
        cuda_probe::probe,
    )
}

fn items_at(
    resources: &Path,
    deps: &Path,
    lock: &ProductLock,
    download_available: bool,
    probe: impl Fn(&Path) -> Result<(), String>,
) -> Result<Vec<RuntimeDependencyItem>, String> {
    let mut result = Vec::new();
    for device in ["cpu", "cuda"] {
        let artifact = if device == "cpu" {
            lock.cpu.as_ref()
        } else {
            lock.cuda.as_ref()
        };
        let root = runtime_root(&resources, &deps, device)?;
        let verified = verify_at(resources, deps, device, lock);
        let ready = verified.is_ok() && (device == "cpu" || probe(&root).is_ok());
        result.push(RuntimeDependencyItem {
            kind: if device == "cpu" {
                RuntimeDependencyKind::CrispasrCpu
            } else {
                RuntimeDependencyKind::CrispasrCuda
            },
            status: if ready {
                RuntimeDependencyStatus::Available
            } else {
                RuntimeDependencyStatus::Missing
            },
            source: Some(
                if device == "cpu" {
                    "builtIn"
                } else {
                    "managed"
                }
                .into(),
            ),
            path: Some(root.display().to_string()),
            version: verified.ok().map(|runtime| runtime.artifact_id),
            managed: device == "cuda",
            expected_download_bytes: if device == "cuda" && download_available && !ready {
                artifact
                    .and_then(|a| a.archive.as_ref())
                    .map(|a| a.size_bytes)
            } else {
                None
            },
            reason: if !ready && device == "cuda" && !download_available {
                Some(PENDING.into())
            } else if !ready {
                Some("CrispASR 运行时缺失、损坏或设备探测失败".into())
            } else {
                None
            },
        });
    }
    Ok(result)
}

// Verify an exact downloaded archive before extraction. The expected SHA is the
// bundled authority, so no unverified ZIP is expanded by the existing helper.
fn publish_archive(
    archive: &Path,
    download: &Path,
    target: &Path,
    artifact: &ArtifactLock,
) -> Result<(), String> {
    let locked = artifact.archive.as_ref().ok_or(UNAVAILABLE)?;
    if locked.root != "windows-x64/crispasr/cuda/"
        || !is_sha256(&locked.sha256)
        || fs::metadata(archive).map_err(|_| UNAVAILABLE)?.len() != locked.size_bytes
        || sha256_file(archive).map_err(|_| UNAVAILABLE)? != locked.sha256
    {
        return Err(UNAVAILABLE.into());
    }
    verify_plain_ancestors(archive).map_err(|_| UNAVAILABLE)?;
    let extract = download.join(format!("extract-{}", unique_suffix()));
    extract_archive(archive, &extract, RuntimeDependencyArchive::Zip).map_err(|_| UNAVAILABLE)?;
    let payload = extract.join(&locked.root);
    verify_payload(&payload, "cuda", artifact)?;
    let parent = target.parent().ok_or(UNAVAILABLE)?;
    crate::asr_models::ensure_plain_directory(parent).map_err(|_| UNAVAILABLE)?;
    verify_plain_ancestors(parent).map_err(|_| UNAVAILABLE)?;
    if target.exists() {
        verify_plain_ancestors(target).map_err(|_| UNAVAILABLE)?;
    }
    let previous = parent.join(format!("previous-{}", unique_suffix()));
    if target.exists() {
        fs::rename(target, &previous).map_err(|_| UNAVAILABLE)?;
    }
    if fs::rename(&payload, target).is_err() {
        if previous.exists() {
            fs::rename(&previous, target).map_err(|_| UNAVAILABLE)?;
        }
        return Err(UNAVAILABLE.into());
    }
    // Retain previous files if a Windows handle prevents deletion; existing
    // explicit managed-runtime cleanup owns the parent and can retry later.
    if previous.exists() {
        let _ = fs::remove_dir_all(previous);
    }
    let _ = fs::remove_dir_all(extract);
    Ok(())
}

pub(in crate::dependencies) async fn prepare(
    app: &AppHandle,
    job: &Arc<StdMutex<RuntimeDependencyJob>>,
    profile: &RuntimeDependencySourceProfile,
) -> Result<String, String> {
    let lock: ProductLock = serde_json::from_str(LOCK_JSON).map_err(|_| UNAVAILABLE)?;
    if !platform_sources().is_ok_and(|sources| published(&lock, &sources)) {
        return Err(PENDING.into());
    }
    let artifact = lock.cuda.ok_or(UNAVAILABLE)?;
    if !source_matches(profile.crispasr_cuda.as_ref(), &artifact) {
        return Err(UNAVAILABLE.into());
    }
    let source = profile.crispasr_cuda.as_ref().ok_or(UNAVAILABLE)?;
    let download = download_dir(app)?;
    crate::asr_models::ensure_plain_directory(&download).map_err(|_| UNAVAILABLE)?;
    for name in ["crispasr-cuda.zip", "crispasr-cuda.zip.part"] {
        if download.join(name).exists() {
            verify_plain_ancestors(&download.join(name)).map_err(|_| UNAVAILABLE)?;
        }
    }
    let cached = download.join("crispasr-cuda.zip");
    let cached_path = cached.clone();
    let expected_size = source.size_bytes;
    let expected_hash = source.sha256.clone();
    let cached_ok = tauri::async_runtime::spawn_blocking(move || {
        fs::metadata(&cached_path).is_ok_and(|m| m.is_file() && m.len() == expected_size)
            && sha256_file(&cached_path).is_ok_and(|hash| hash == expected_hash)
    })
    .await
    .map_err(|_| UNAVAILABLE)?;
    let archive = if cached_ok {
        cached
    } else {
        download_binary_source_to_dir(download.clone(), job, source, "crispasr-cuda.zip")
            .await
            .map_err(|_| UNAVAILABLE)?
    };
    ensure_job_not_cancelled(job)?;
    set_stage(job, "验证并安装 CrispASR CUDA 运行时", Some(0.5));
    let target = managed_root(app)?.join("current");
    tauri::async_runtime::spawn_blocking(move || {
        publish_archive(&archive, &download, &target, &artifact)
    })
    .await
    .map_err(|_| UNAVAILABLE)??;
    Ok("CrispASR CUDA 文件已安装；转录启动前将独立检测设备".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_readiness_and_probe_do_not_depend_on_download_publication() {
        let temp = tempfile::tempdir().unwrap();
        let resources = temp.path().join("resources");
        let deps = temp.path().join("deps");
        let mut lock = super::super::tests::fixture(&resources, &deps, "cpu");
        lock.cuda = super::super::tests::fixture(&resources, &deps, "cuda").cuda;
        assert!(!lock.external_stable_asset_published);
        assert!(!published(&lock, &platform_sources().unwrap()));
        let cuda = runtime_root(&resources, &deps, "cuda").unwrap();
        let probes = std::cell::Cell::new(0);
        let probe = |root: &Path| {
            assert_eq!(root, cuda); // CPU must never probe CUDA.
            probes.set(probes.get() + 1);
            Ok(())
        };
        let items = items_at(&resources, &deps, &lock, false, probe).unwrap();
        assert_eq!(probes.get(), 1);
        for item in &items {
            assert_eq!(item.status, RuntimeDependencyStatus::Available);
            assert!(item.reason.is_none());
            assert!(item.expected_download_bytes.is_none());
        }
        let items = items_at(&resources, &deps, &lock, false, |_| {
            Err("probe failed".into())
        })
        .unwrap();
        assert_eq!(items[0].status, RuntimeDependencyStatus::Available);
        assert_eq!(items[1].status, RuntimeDependencyStatus::Missing);
        assert!(items[1].expected_download_bytes.is_none());
        assert_eq!(items[1].reason.as_deref(), Some(PENDING));
        for missing in [false, true] {
            if missing {
                fs::remove_dir_all(&cuda).unwrap();
            } else {
                fs::write(cuda.join("crispasr.exe"), b"corrupt").unwrap();
            }
            let items = items_at(&resources, &deps, &lock, false, |_| {
                panic!("invalid files must not probe")
            })
            .unwrap();
            assert_eq!(items[0].status, RuntimeDependencyStatus::Available);
            assert_eq!(items[1].status, RuntimeDependencyStatus::Missing);
            assert!(items[1].expected_download_bytes.is_none());
            assert_eq!(items[1].reason.as_deref(), Some(PENDING));
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn synthetic_http_archive_publish_offline_repair_and_hash_rejection() {
        use httpmock::{Method::GET, MockServer};
        let temp = tempfile::tempdir().unwrap();
        let resources = temp.path().join("resources");
        let deps = temp.path().join("deps");
        let lock = super::super::tests::fixture(&resources, &deps, "cuda");
        let mut artifact = lock.cuda.unwrap();
        let payload = temp.path().join("archive/windows-x64/crispasr/cuda");
        fs::create_dir_all(payload.parent().unwrap()).unwrap();
        fs::rename(runtime_root(&resources, &deps, "cuda").unwrap(), &payload).unwrap();
        let archive = temp.path().join("fixture.zip");
        assert!(hidden_command("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Compress-Archive -LiteralPath {} -DestinationPath {}",
                    powershell_quote(&temp.path().join("archive/windows-x64")),
                    powershell_quote(&archive)
                )
            ])
            .status()
            .unwrap()
            .success());
        let bytes = fs::read(&archive).unwrap();
        artifact.archive = Some(ArchiveLock {
            size_bytes: bytes.len() as u64,
            sha256: sha256_file(&archive).unwrap(),
            root: "windows-x64/crispasr/cuda/".into(),
        });
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/runtime.zip");
            then.status(200).body(bytes.clone());
        });
        let source = RuntimeDependencyBinarySource {
            url: server.url("/runtime.zip"),
            sha256: artifact.archive.as_ref().unwrap().sha256.clone(),
            size_bytes: bytes.len() as u64,
            archive: RuntimeDependencyArchive::Zip,
            strip_prefix: None,
        };
        let download = temp.path().join("downloads");
        let job = Arc::new(StdMutex::new(RuntimeDependencyJob::new(
            "synthetic".into(),
            RuntimeDependencyKind::CrispasrCuda,
        )));
        let got = download_binary_source_to_dir(download.clone(), &job, &source, "runtime.zip")
            .await
            .unwrap();
        mock.assert_hits(1);
        let target = deps.join("asr-runtime/crispasr/cuda/current");
        publish_archive(&got, &download, &target, &artifact).unwrap();
        verify_payload(&target, "cuda", &artifact).unwrap();
        fs::write(target.join("crispasr.exe"), b"corrupt").unwrap();
        // Cached exact archive repairs offline, without touching CT2 or network.
        publish_archive(&got, &download, &target, &artifact).unwrap();
        verify_payload(&target, "cuda", &artifact).unwrap();
        mock.assert_hits(1);
        fs::write(&got, b"bad archive").unwrap();
        assert!(publish_archive(&got, &download, &target, &artifact).is_err());
        verify_payload(&target, "cuda", &artifact).unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn actual_local_frozen_archive_publication() {
        let source_profile = std::env::var("HIKARU_ASR_CRISPASR_ARCHIVE_TEST_SOURCE").ok();
        let local_archive = std::env::var_os("HIKARU_ASR_CRISPASR_ARCHIVE_TEST_ARCHIVE");
        let resources =
            std::env::var_os("HIKARU_ASR_CRISPASR_PACKAGE_TEST_RESOURCES").map(PathBuf::from);
        assert!(
            source_profile.is_none() || local_archive.is_none(),
            "choose one archive input"
        );
        let Some(path) = std::env::var_os("HIKARU_ASR_CRISPASR_ARCHIVE_TEST_ROOT") else {
            assert!(
                source_profile.is_none() && local_archive.is_none() && resources.is_none(),
                "archive source requires isolated test root"
            );
            return;
        };
        let root = PathBuf::from(path);
        assert!(!root.exists());
        fs::create_dir_all(&root).unwrap();
        let lock: ProductLock = serde_json::from_str(LOCK_JSON).unwrap();
        assert!(lock.product_enablement_allowed);
        let archive = if let Some(profile) = source_profile {
            let sources = platform_sources().unwrap();
            let source = match profile.as_str() {
                "official" => sources.official.crispasr_cuda.unwrap(),
                "china" => sources.china.crispasr_cuda.unwrap(),
                _ => panic!("archive test source must be official or china"),
            };
            assert!(source_matches(Some(&source), lock.cuda.as_ref().unwrap()));
            let job = Arc::new(StdMutex::new(RuntimeDependencyJob::new(
                "public-archive-test".into(),
                RuntimeDependencyKind::CrispasrCuda,
            )));
            tokio::time::timeout(
                std::time::Duration::from_secs(300),
                download_binary_source_to_dir(
                    root.join("downloads"),
                    &job,
                    &source,
                    "crispasr-cuda.zip",
                ),
            )
            .await
            .expect("public archive download deadline")
            .expect("public archive download failed")
        } else {
            local_archive.map(PathBuf::from).unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../native-asr/artifacts/crispasr-cuda-shared-v2.zip")
            })
        };
        let deps = resources.as_ref().unwrap_or(&root).join("deps");
        let target = deps.join("asr-runtime/crispasr/cuda/current");
        publish_archive(&archive, &root, &target, lock.cuda.as_ref().unwrap()).unwrap();
        verify_payload(&target, "cuda", lock.cuda.as_ref().unwrap()).unwrap();
        cuda_probe::probe(&target).unwrap();
        if let Some(resources) = resources {
            // Actual extracted NSIS/portable CPU plus locally installed CUDA
            // candidate. No WebView/installer interaction or model inference.
            assert_eq!(deps, resources.join("deps")); // executable-adjacent in both modes
            let prior = root.join("prior.ass");
            fs::write(&prior, b"preserve prior ASS").unwrap();
            let download_available = published(&lock, &platform_sources().unwrap());
            let ready = items_at(&resources, &deps, &lock, download_available, |_| Ok(())).unwrap();
            assert!(ready.iter().all(|item| {
                item.status == RuntimeDependencyStatus::Available
                    && item.expected_download_bytes.is_none()
            }));
            for device in ["cpu", "cuda"] {
                let runtime = verify_at(&resources, &deps, device, &lock).unwrap();
                runtime.require_engine("qwen3-asr").unwrap();
                runtime.require_engine("parakeet").unwrap();
                assert!(runtime.require_engine("reazonspeech-nemo").is_err());
                let dll = runtime.root.join("vcomp140.dll");
                let original = fs::read(&dll).unwrap();
                fs::remove_file(&dll).unwrap();
                let missing = verify_at(&resources, &deps, device, &lock);
                fs::write(&dll, vec![0; original.len()]).unwrap();
                let corrupt = verify_at(&resources, &deps, device, &lock);
                fs::write(&dll, original).unwrap();
                assert!(missing.is_err() && corrupt.is_err());
                verify_at(&resources, &deps, device, &lock).unwrap();
            }
            assert!(verify_at(&resources, &deps, "vulkan", &lock).is_err());
            let failed_device = items_at(&resources, &deps, &lock, download_available, |_| {
                Err("synthetic device failure".into())
            })
            .unwrap();
            assert_eq!(failed_device[0].status, RuntimeDependencyStatus::Available);
            assert_eq!(failed_device[1].status, RuntimeDependencyStatus::Missing);
            assert_eq!(
                failed_device[1].expected_download_bytes,
                download_available
                    .then(|| lock.cuda.as_ref().unwrap().archive.as_ref().unwrap().size_bytes)
            );
            assert_eq!(fs::read(prior).unwrap(), b"preserve prior ASS");
            fs::write(
                root.join("package-check.json"),
                serde_json::to_vec_pretty(&serde_json::json!({
                    "cpuArtifact":lock.cpu.as_ref().unwrap().artifact_id,
                    "cudaArtifact":lock.cuda.as_ref().unwrap().artifact_id,
                    "exactClosure":true,"cudaComputeProbe":true,"missingAndCorruptRejected":true,"managedRootAdjacent":true,
                    "syntheticDeviceFailureIsolated":true,"priorAssPreserved":true,
                    "externalStableAssetPublished":lock.external_stable_asset_published,
                    "downloadAvailable":download_available,"bothEnginesAuthorized":true,"manualInstallOrUi":false
                }))
                .unwrap(),
            )
            .unwrap();
        }
    }

    #[test]
    fn public_sources_match_uploaded_archive_and_reject_unpublished_or_mismatched_bytes() {
        let mut lock: ProductLock = serde_json::from_str(PUBLISHED_LOCK_JSON).unwrap();
        let mut sources = platform_sources().unwrap();
        assert!(published(&lock, &sources));
        let official = sources.official.crispasr_cuda.as_ref().unwrap();
        let china = sources.china.crispasr_cuda.as_ref().unwrap();
        assert_eq!(official.url, "https://github.com/jason-zzx/hikaru-sub/releases/download/native-asr-cuda-v1/hikaru-asr-crispasr-windows-x64-cuda-shared-v2.zip");
        assert_eq!(china.url, format!("https://ghfast.top/{}", official.url));
        assert_eq!(
            official.sha256,
            "23a3c4082a520d3c0e4698a229bd4767a7f5a10f2bc1c7d45235f379c5ee292d"
        );
        assert_eq!(official.size_bytes, 719_774_286);
        let temp = tempfile::tempdir().unwrap();
        let items = items_at(
            &temp.path().join("resources"),
            &temp.path().join("deps"),
            &lock,
            true,
            |_| panic!("missing runtime must not probe"),
        )
        .unwrap();
        assert_eq!(items[1].status, RuntimeDependencyStatus::Missing);
        assert_eq!(items[1].expected_download_bytes, Some(719_774_286));
        assert_ne!(items[1].reason.as_deref(), Some(PENDING));
        assert!(items[0].expected_download_bytes.is_none());
        lock.external_stable_asset_published = false;
        assert!(!published(&lock, &sources));
        lock.external_stable_asset_published = true;
        lock.product_enablement_allowed = false;
        assert!(!published(&lock, &sources));
        lock.product_enablement_allowed = true;
        for official in [false, true] {
            for mutation in ["missing", "size", "hash", "prefix", "http"] {
                let mut changed = sources.clone();
                let source = if official {
                    &mut changed.official.crispasr_cuda
                } else {
                    &mut changed.china.crispasr_cuda
                };
                match mutation {
                    "missing" => *source = None,
                    "size" => source.as_mut().unwrap().size_bytes += 1,
                    "hash" => source.as_mut().unwrap().sha256 = "0".repeat(64),
                    "prefix" => source.as_mut().unwrap().strip_prefix = Some("wrong".into()),
                    "http" => {
                        source.as_mut().unwrap().url = "http://example.invalid/runtime.zip".into()
                    }
                    _ => unreachable!(),
                }
                assert!(!published(&lock, &changed), "accepted {mutation}");
            }
        }
        sources.china.crispasr_cuda = None;
        assert!(!published(&lock, &sources));
    }
}
