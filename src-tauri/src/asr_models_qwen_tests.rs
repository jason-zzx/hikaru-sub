// Included only by asr_models::tests; all downloads use tiny synthetic bytes.
fn qwen_fixture() -> (ManifestModel, Vec<(&'static str, &'static [u8])>) {
    let mut model = find_model(
        &load_manifest().unwrap(),
        "qwen3-asr",
        "Qwen/Qwen3-ASR-1.7B",
    )
    .unwrap()
    .clone();
    let bytes = vec![
        ("qwen3-asr-1.7b-q4_k.gguf", b"synthetic-asr".as_slice()),
        (
            "qwen3-forced-aligner-0.6b-q4_k.gguf",
            b"synthetic-aligner".as_slice(),
        ),
        ("ggml-silero-v6.2.0.bin", b"synthetic-vad".as_slice()),
    ];
    for (file, (_, bytes)) in model
        .files
        .iter_mut()
        .chain(model.required_vad.iter_mut())
        .zip(&bytes)
    {
        file.size_bytes = bytes.len() as u64;
        file.sha256 = hash(bytes);
    }
    model.revision = pair_revision(&model.files).unwrap();
    (model, bytes)
}

fn qwen_install(roots: &ManagedModelRoots, model: &ManifestModel, files: &[(&str, &[u8])]) {
    write_model(&direct_path(roots, model), &files[..2]);
    write_model(&direct_path(roots, &vad_model(model).unwrap()), &files[2..]);
}

fn qwen_http(server: &MockServer, model: &ManifestModel, files: &[(&str, &[u8])]) {
    for (file, (_, bytes)) in model
        .files
        .iter()
        .chain(model.required_vad.iter())
        .zip(files)
    {
        let url = file_url(&server.base_url(), model, file);
        let path = url.strip_prefix(&server.base_url()).unwrap();
        server.mock(|when, then| {
            when.method(GET).path(path);
            then.status(200).body(bytes.to_vec());
        });
    }
}

#[tokio::test]
async fn qwen_public_metadata_allows_download_and_reports_exact_missing_readiness() {
    let manifest = load_manifest().unwrap();
    let model = find_model(&manifest, "qwen3-asr", "Qwen/Qwen3-ASR-1.7B").unwrap();
    assert!(!model.post_mvp_unavailable);
    assert_eq!(model.revision, pair_revision(&model.files).unwrap());
    assert_eq!(model_total(model), 2_020_801_514);
    for (file, revision, repository, size, sha, license) in [
        (
            &model.files[0],
            "674df5d44b50a63e7102a18895ed20e3f91de301",
            "cstr/qwen3-asr-1.7b-GGUF",
            1490915200,
            "ec197cef7ccc589fdcae1becc3f4a3de119d0a41e790b898b519b1a048dad8d4",
            "Apache-2.0",
        ),
        (
            &model.files[1],
            "1ec5110602ccab18c878ddebedab0891e290a95c",
            "cstr/qwen3-forced-aligner-0.6b-GGUF",
            529001216,
            "a7bb4cbeacc6414f11a5d23dc7661a51a941a71e6d559dc7b408b52473f2ae84",
            "Apache-2.0",
        ),
        (
            model.required_vad.as_ref().unwrap(),
            "9ffd54a1e1ee413ddf265af9913beaf518d1639b",
            "ggml-org/whisper-vad",
            885098,
            "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987",
            "MIT",
        ),
    ] {
        let source = file.source.as_ref().unwrap();
        assert_eq!(
            (
                &source.revision[..],
                &source.repository[..],
                file.size_bytes,
                &file.sha256[..],
                &source.license.spdx[..]
            ),
            (revision, repository, size, sha, license)
        );
        for endpoint in [OFFICIAL_ENDPOINT, "https://hf-mirror.com"] {
            assert_eq!(
                file_url(endpoint, model, file),
                format!("{endpoint}/{repository}/resolve/{revision}/{}", file.path)
            );
        }
    }
    assert_eq!(
        downloadable_entry(&manifest, &model.engine, &model.model).unwrap(),
        model
    );
    let dir = tempdir().unwrap();
    let roots = ManagedModelRoots::below(dir.path());
    let manager = NativeAsrModelManager::default();
    assert_eq!(
        manager
            .status_with_roots(roots, &model.engine, &model.model)
            .await
            .unwrap()
            .disposition,
        NativeAsrModelDisposition::SupportedMissing
    );
    assert!(known_native_asr_engines().unwrap().contains(&(
        "qwen3-asr".into(),
        true,
        Some("crispasr".into())
    )));
}

#[test]
fn qwen_manifest_rejects_mixed_sources_missing_roles_and_unsafe_assets() {
    let (model, _) = qwen_fixture();
    let manifest = |model| ModelManifest {
        schema_version: 1,
        models: vec![model],
    };
    validate_manifest(&manifest(model.clone())).unwrap();
    for role in 0..3 {
        for mutation in 0..7 {
            let mut bad = model.clone();
            let file = if role == 2 {
                bad.required_vad.as_mut().unwrap()
            } else {
                &mut bad.files[role]
            };
            match mutation {
                0 => file.path = "../escaped.gguf".into(),
                1 => file.path = "CON.bin".into(),
                2 => file.source.as_mut().unwrap().revision = "main".into(),
                3 => file.source.as_mut().unwrap().repository = "owner/../../name".into(),
                4 => file.sha256 = "0".into(),
                5 => file.source = None,
                _ => file.path = "trailing.gguf.".into(),
            }
            assert!(
                validate_manifest(&manifest(bad)).is_err(),
                "role={role}, mutation={mutation}"
            );
        }
    }
    let mut mixed = model.clone();
    mixed.files[1].source.as_mut().unwrap().revision = "b".repeat(40);
    assert_ne!(pair_revision(&mixed.files).unwrap(), model.revision);
    assert!(validate_manifest(&manifest(mixed)).is_err());
    let mut half = model.clone();
    half.files.pop();
    assert!(validate_manifest(&manifest(half)).is_err());
    let mut absent = model.clone();
    absent.required_vad = None;
    assert!(validate_manifest(&manifest(absent)).is_err());
    let mut duplicate = model.clone();
    duplicate.files[1].path = model.files[0].path.to_uppercase();
    assert!(validate_manifest(&manifest(duplicate)).is_err());
}

#[test]
fn qwen_complete_half_corrupt_and_mixed_pairs_never_guess_roles_or_legacy_paths() {
    let dir = tempdir().unwrap();
    let roots = ManagedModelRoots::below(&dir.path().join("中文 路径"));
    let (model, files) = qwen_fixture();
    let direct = direct_path(&roots, &model);
    write_model(&direct, &files[..1]);
    assert!(resolve_sync(&roots, &model).unwrap().is_none());
    write_model(&direct, &files[..2]);
    assert!(resolve_sync(&roots, &model).unwrap().is_none());
    qwen_install(&roots, &model, &files);
    let ready = resolve_sync(&roots, &model).unwrap().unwrap();
    assert_eq!(
        ready.roles,
        vec![
            ("model".into(), direct.join(files[0].0)),
            ("aligner".into(), direct.join(files[1].0)),
            (
                "vad".into(),
                direct_path(&roots, &vad_model(&model).unwrap()).join(files[2].0)
            ),
        ]
    );
    assert!(direct.starts_with(&roots.crispasr));
    assert!(!direct.starts_with(&roots.direct));
    for (path, bytes) in &files[..2] {
        fs::write(direct.join(path), vec![b'x'; bytes.len()]).unwrap();
        assert!(resolve_sync(&roots, &model).unwrap().is_none());
        fs::write(direct.join(path), bytes).unwrap();
    }
    let mut newer = model.clone();
    newer.files[1].source.as_mut().unwrap().revision = "b".repeat(40);
    newer.revision = pair_revision(&newer.files).unwrap();
    write_model(&direct_path(&roots, &newer), &files[1..2]);
    assert!(resolve_sync(&roots, &newer).unwrap().is_none());
    assert!(resolve_sync(&roots, &model).unwrap().is_some());
    fs::remove_dir_all(&direct).unwrap();
    write_model(&legacy_path(&roots, &model), &files[..2]);
    assert!(resolve_sync(&roots, &model).unwrap().is_none());
}

#[tokio::test]
async fn qwen_cached_readiness_rechecks_required_vad_and_cleanup_invalidates_all_owned_cache() {
    let dir = tempdir().unwrap();
    let roots = ManagedModelRoots::below(dir.path());
    let (model, files) = qwen_fixture();
    qwen_install(&roots, &model, &files);
    let manager = NativeAsrModelManager::default();
    let vad = direct_path(&roots, &vad_model(&model).unwrap()).join(files[2].0);
    for corrupt in [true, false] {
        assert!(manager
            .resolve_entry_with_roots(roots.clone(), model.clone())
            .await
            .unwrap()
            .is_some());
        assert!(!manager.ready_cache.lock().unwrap().is_empty());
        if corrupt {
            fs::write(&vad, vec![b'x'; files[2].1.len()]).unwrap();
        } else {
            fs::remove_file(&vad).unwrap();
        }
        assert!(manager
            .resolve_entry_with_roots(roots.clone(), model.clone())
            .await
            .unwrap()
            .is_none());
        fs::write(&vad, files[2].1).unwrap();
    }
    assert!(manager
        .resolve_entry_with_roots(roots.clone(), model.clone())
        .await
        .unwrap()
        .is_some());
    let lease = manager.begin_storage_cleanup().unwrap();
    assert!(manager.ready_cache.lock().unwrap().is_empty());
    // The existing broad explicit asrModels action owns this root; no per-model
    // cleanup action eagerly removes the shared dependency or any sibling model.
    fs::remove_dir_all(&roots.shared).unwrap();
    drop(lease);
    assert!(manager
        .resolve_entry_with_roots(roots.clone(), model.clone())
        .await
        .unwrap()
        .is_none());
    assert!(direct_path(&roots, &model).is_dir());
    assert!(manager.begin_storage_cleanup().is_ok());
}

#[tokio::test]
async fn qwen_one_download_combines_all_roles_then_reuses_offline_without_network() {
    let server = MockServer::start_async().await;
    let dir = tempdir().unwrap();
    let roots = ManagedModelRoots::below(&dir.path().join("中文 模型"));
    let (model, files) = qwen_fixture();
    qwen_http(&server, &model, &files);
    let manager = NativeAsrModelManager::default();
    let id = manager
        .start_download_for_model(model.clone(), roots.clone(), server.base_url())
        .await
        .unwrap();
    let same = manager
        .start_download_for_model(model.clone(), roots.clone(), server.base_url())
        .await
        .unwrap();
    assert_eq!(id, same);
    let snapshot = wait_terminal(&manager, &id).await;
    assert_eq!(
        snapshot.status,
        ModelDownloadJobStatus::Completed,
        "{:?}",
        snapshot.error
    );
    assert_eq!(snapshot.total_bytes, model_total(&model));
    assert_eq!(snapshot.downloaded_bytes, snapshot.total_bytes);
    assert_eq!(snapshot.progress, Some(1.0));
    assert_eq!(snapshot.revision, model.revision);
    assert!(resolve_sync(&roots, &model).unwrap().is_some());
    let offline = NativeAsrModelManager::default();
    let id = offline
        .start_download_for_model(model.clone(), roots.clone(), "http://127.0.0.1:1".into())
        .await
        .unwrap();
    assert_eq!(
        wait_terminal(&offline, &id).await.status,
        ModelDownloadJobStatus::Completed
    );
    assert_eq!(
        manager.job_snapshot(&same).await.unwrap().status,
        ModelDownloadJobStatus::Completed
    );
}

#[tokio::test]
async fn qwen_each_interrupted_role_resumes_through_actual_range_helper_without_half_readiness() {
    use tokio::io::AsyncReadExt;
    for interrupted in 0..3 {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = qwen_fixture();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let served = files.clone();
        let server = tokio::spawn(async move {
            for (index, (_, bytes)) in served.iter().enumerate().take(interrupted + 1) {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0_u8; 2048];
                let _ = socket.read(&mut request).await.unwrap();
                socket
                    .write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            bytes.len()
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
                socket
                    .write_all(if index == interrupted {
                        &bytes[..3]
                    } else {
                        bytes
                    })
                    .await
                    .unwrap();
            }
        });
        let manager = NativeAsrModelManager::default();
        let id = manager
            .start_download_for_model(model.clone(), roots.clone(), format!("http://{address}"))
            .await
            .unwrap();
        let failed = wait_terminal(&manager, &id).await;
        assert_eq!(failed.status, ModelDownloadJobStatus::Failed);
        assert!(failed.progress.unwrap() < 1.0);
        assert_eq!(failed.total_bytes, model_total(&model));
        server.await.unwrap();
        assert!(resolve_sync(&roots, &model).unwrap().is_none());
        assert_eq!(direct_path(&roots, &model).exists(), interrupted == 2);
        let asset = if interrupted == 2 {
            vad_model(&model).unwrap()
        } else {
            model.clone()
        };
        let part = download_path(&roots, &asset)
            .join("parts")
            .join(format!("{}.part", files[interrupted].0));
        assert_eq!(fs::read(&part).unwrap(), b"syn");
        let retry_server = MockServer::start_async().await;
        let file = if interrupted == 2 {
            model.required_vad.as_ref().unwrap()
        } else {
            &model.files[interrupted]
        };
        let url = file_url(&retry_server.base_url(), &model, file);
        let resumed = retry_server.mock(|when, then| {
            when.method(GET)
                .path(url.strip_prefix(&retry_server.base_url()).unwrap())
                .header("range", "bytes=3-");
            then.status(206)
                .header(
                    "content-range",
                    format!("bytes 3-{}/{}", file.size_bytes - 1, file.size_bytes),
                )
                .body(files[interrupted].1[3..].to_vec());
        });
        for index in interrupted + 1..3 {
            let file = if index == 2 {
                model.required_vad.as_ref().unwrap()
            } else {
                &model.files[index]
            };
            let url = file_url(&retry_server.base_url(), &model, file);
            retry_server.mock(|when, then| {
                when.method(GET)
                    .path(url.strip_prefix(&retry_server.base_url()).unwrap());
                then.status(200).body(files[index].1.to_vec());
            });
        }
        // Fresh process-equivalent manager re-enters safe partials, not stale state.
        let retry = NativeAsrModelManager::default();
        let id = retry
            .start_download_for_model(model.clone(), roots.clone(), retry_server.base_url())
            .await
            .unwrap();
        let snapshot = wait_terminal(&retry, &id).await;
        assert_eq!(
            snapshot.status,
            ModelDownloadJobStatus::Completed,
            "role {interrupted}: {:?}",
            snapshot.error
        );
        assert_eq!(resumed.hits(), 1);
        assert_eq!(snapshot.downloaded_bytes, model_total(&model));
    }
}

#[tokio::test]
async fn qwen_repairs_only_missing_roles_and_vad_failure_preserves_the_complete_pair() {
    let dir = tempdir().unwrap();
    let roots = ManagedModelRoots::below(dir.path());
    let (model, files) = qwen_fixture();
    qwen_install(&roots, &model, &files);
    let direct = direct_path(&roots, &model);
    fs::remove_file(direct.join(files[1].0)).unwrap();
    let server = MockServer::start_async().await;
    let url = file_url(&server.base_url(), &model, &model.files[1]);
    let repair = server.mock(|when, then| {
        when.method(GET)
            .path(url.strip_prefix(&server.base_url()).unwrap());
        then.status(200).body(files[1].1.to_vec());
    });
    let manager = NativeAsrModelManager::default();
    let id = manager
        .start_download_for_model(model.clone(), roots.clone(), server.base_url())
        .await
        .unwrap();
    let snapshot = wait_terminal(&manager, &id).await;
    assert_eq!(
        snapshot.status,
        ModelDownloadJobStatus::Completed,
        "{:?}",
        snapshot.error
    );
    assert_eq!(repair.hits(), 1); // Missing ASR/VAD mocks would reject any redundant request.
    fs::remove_dir_all(&roots.shared).unwrap();
    let retry = NativeAsrModelManager::default();
    let id = retry
        .start_download_for_model(model.clone(), roots.clone(), "http://127.0.0.1:1".into())
        .await
        .unwrap();
    assert_eq!(
        wait_terminal(&retry, &id).await.status,
        ModelDownloadJobStatus::Failed
    );
    for (name, bytes) in &files[..2] {
        assert_eq!(fs::read(direct.join(name)).unwrap(), *bytes);
    }
    assert!(retry
        .resolve_entry_with_roots(roots, model)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn qwen_storage_cleanup_is_bounded_and_shared_vad_acquisition_is_serial() {
    use tokio::io::AsyncReadExt;
    let dir = tempdir().unwrap();
    let roots = ManagedModelRoots::below(dir.path());
    let (model, files) = qwen_fixture();
    // Preverified pair: hold the actual VAD HTTP stream while two owners enter.
    write_model(&direct_path(&roots, &model), &files[..2]);
    let mut sibling = model.clone();
    sibling.model = "sibling-test-only".into();
    sibling.logical_id = "qwen3-asr/sibling-test-only".into();
    write_model(&direct_path(&roots, &sibling), &files[..2]);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let vad_bytes = files[2].1;
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 2048];
        let _ = socket.read(&mut request).await.unwrap();
        entered_tx.send(()).unwrap();
        release_rx.await.unwrap();
        socket
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    vad_bytes.len()
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        socket.write_all(vad_bytes).await.unwrap();
        // Closing this listener means a duplicate VAD request fails the sibling.
    });
    let manager = NativeAsrModelManager::default();
    let first = manager
        .start_download_for_model(model.clone(), roots.clone(), format!("http://{address}"))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(2), entered_rx)
        .await
        .unwrap()
        .unwrap();
    let second = manager
        .start_download_for_model(sibling.clone(), roots.clone(), format!("http://{address}"))
        .await
        .unwrap();
    assert_ne!(first, second);
    let start = std::time::Instant::now();
    assert!(manager
        .begin_storage_cleanup()
        .unwrap_err()
        .contains("正在进行"));
    assert!(start.elapsed() < Duration::from_millis(100));
    // Concurrent checks are not queued behind HTTP or a job-map/cache lock.
    assert!(tokio::time::timeout(
        Duration::from_secs(1),
        manager.resolve_entry_with_roots(roots.clone(), model.clone())
    )
    .await
    .unwrap()
    .unwrap()
    .is_none());
    release_tx.send(()).unwrap();
    server.await.unwrap();
    for id in [&first, &second] {
        let snapshot = wait_terminal(&manager, id).await;
        assert_eq!(
            snapshot.status,
            ModelDownloadJobStatus::Completed,
            "{:?}",
            snapshot.error
        );
        assert_eq!(snapshot.downloaded_bytes, model_total(&model));
    }
    let lease = manager.begin_storage_cleanup().unwrap();
    assert!(manager.ready_cache.lock().unwrap().is_empty());
    drop(lease);
    assert!(resolve_sync(&roots, &sibling).unwrap().is_some());
    // Explicit check lease also rejects cleanup; no read -> write upgrade.
    let check = manager.storage.read().await;
    assert!(manager.begin_storage_cleanup().is_err());
    drop(check);
    assert!(manager.begin_storage_cleanup().is_ok());
}

#[tokio::test]
async fn qwen_bad_hash_and_failed_jobs_release_storage_without_erasing_prior_revisions() {
    let dir = tempdir().unwrap();
    let roots = ManagedModelRoots::below(dir.path());
    let (old, files) = qwen_fixture();
    qwen_install(&roots, &old, &files);
    let mut new = old.clone();
    new.files[1].source.as_mut().unwrap().revision = "c".repeat(40);
    new.revision = pair_revision(&new.files).unwrap();
    let server = MockServer::start_async().await;
    let bad_files = vec![
        files[0],
        (files[1].0, b"corrupt--aligner!".as_slice()),
        files[2],
    ];
    qwen_http(&server, &new, &bad_files);
    let manager = NativeAsrModelManager::default();
    let id = manager
        .start_download_for_model(new.clone(), roots.clone(), server.base_url())
        .await
        .unwrap();
    assert_eq!(
        wait_terminal(&manager, &id).await.status,
        ModelDownloadJobStatus::Failed
    );
    assert!(!direct_path(&roots, &new).exists());
    assert!(resolve_sync(&roots, &old).unwrap().is_some());
    assert!(manager.begin_storage_cleanup().is_ok());
    let error = sanitize_error(
        "网络 C:\\private\\secret token=credential https://user:pass@host/transcript",
    );
    for private in ["private", "credential", "user", "transcript"] {
        assert!(!error.contains(private));
    }
}

#[cfg(windows)]
#[test]
fn qwen_atomic_publication_failure_restores_invalid_final_and_preserves_old_good_pair() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempdir().unwrap();
    let roots = ManagedModelRoots::below(dir.path());
    let (old, files) = qwen_fixture();
    qwen_install(&roots, &old, &files);
    let mut new = old.clone();
    new.files[1].source.as_mut().unwrap().revision = "d".repeat(40);
    new.revision = pair_revision(&new.files).unwrap();
    let namespace = download_path(&roots, &new);
    let stage = namespace.join("stage-locked");
    write_model(&stage, &files[..2]);
    let target = direct_path(&roots, &new);
    write_model(&target, &[("old-invalid", b"keep")]);
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(stage.join(files[0].0))
        .unwrap();
    assert!(publish_stage(&roots, &new, &stage, &namespace, "locked").is_err());
    assert_eq!(fs::read(target.join("old-invalid")).unwrap(), b"keep");
    assert!(resolve_sync(&roots, &old).unwrap().is_some());
    drop(held);
    publish_stage(&roots, &new, &stage, &namespace, "retry").unwrap();
    assert!(resolve_sync(&roots, &new).unwrap().is_some());
}

#[cfg(windows)]
#[tokio::test]
async fn qwen_reparse_pair_shared_dependency_and_part_roots_are_rejected() {
    for location in ["pair", "vad", "parts"] {
        let dir = tempdir().unwrap();
        let roots = ManagedModelRoots::below(dir.path());
        let (model, files) = qwen_fixture();
        qwen_install(&roots, &model, &files);
        let outside = dir.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        let link = match location {
            "pair" => direct_path(&roots, &model),
            "vad" => direct_path(&roots, &vad_model(&model).unwrap()),
            _ => download_path(&roots, &model).join("parts"),
        };
        if link.exists() {
            fs::rename(&link, outside.join("original")).unwrap();
        }
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        let output = crate::process::hidden_command("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(link.to_string_lossy().replace('/', "\\"))
            .arg(&outside)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{location}: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if location == "parts" {
            fs::remove_dir_all(direct_path(&roots, &model)).unwrap();
            let manager = NativeAsrModelManager::default();
            let id = manager
                .start_download_for_model(model.clone(), roots.clone(), "http://127.0.0.1:1".into())
                .await
                .unwrap();
            assert_eq!(
                wait_terminal(&manager, &id).await.status,
                ModelDownloadJobStatus::Failed
            );
        } else {
            assert!(resolve_sync(&roots, &model).unwrap().is_none());
        }
        assert_eq!(
            fs::read_dir(&outside).unwrap().count(),
            usize::from(location != "parts")
        );
        fs::remove_dir(&link).unwrap();
    }
}
