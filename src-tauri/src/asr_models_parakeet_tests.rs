// Tiny delivery fixtures exercise the existing manager, never enable the product.
fn parakeet_fixture() -> (ManifestModel, Vec<(&'static str, &'static [u8])>) {
    let mut model = find_model(
        &load_manifest().unwrap(),
        "parakeet",
        "nvidia/parakeet-tdt_ctc-0.6b-ja",
    )
    .unwrap()
    .clone();
    let files = vec![
        (
            "parakeet-tdt-0.6b-ja.gguf",
            b"synthetic-parakeet".as_slice(),
        ),
        ("ggml-silero-v6.2.0.bin", b"synthetic-vad".as_slice()),
    ];
    for (file, (_, bytes)) in model
        .files
        .iter_mut()
        .chain(model.required_vad.iter_mut())
        .zip(&files)
    {
        file.size_bytes = bytes.len() as u64;
        file.sha256 = hash(bytes);
    }
    (model, files)
}

#[tokio::test]
async fn parakeet_exact_metadata_and_public_readiness_follow_build_capability() {
    let manifest = load_manifest().unwrap();
    let entry = find_model(&manifest, "parakeet", "nvidia/parakeet-tdt_ctc-0.6b-ja").unwrap();
    assert_eq!(entry.revision, "d9e3ba65a6579796389ea89e5939509ed257f972");
    assert_eq!(entry.repository, "cstr/parakeet-tdt-0.6b-ja-GGUF");
    assert_eq!(entry.files[0].path, "parakeet-tdt-0.6b-ja.gguf");
    assert_eq!(
        entry.files[0].sha256,
        "374eb0132eebaec4df77a9631cbbeb03790be48a4a517f6cc8e8bdb38fe9a584"
    );
    assert_eq!(entry.files[0].size_bytes, 1_246_932_800);
    assert_eq!(entry.license.spdx, "CC-BY-4.0");
    assert!(entry.license.attribution.contains("NeMo-to-GGUF"));
    assert_eq!(model_total(entry), 1_247_817_898);
    assert_eq!(
        entry.required_vad,
        find_model(&manifest, "qwen3-asr", "Qwen/Qwen3-ASR-1.7B")
            .unwrap()
            .required_vad
    );
    for endpoint in [OFFICIAL_ENDPOINT, "https://hf-mirror.com"] {
        assert_eq!(
            file_url(endpoint, entry, &entry.files[0]),
            format!(
                "{}/{}/resolve/{}/{}",
                endpoint, entry.repository, entry.revision, entry.files[0].path
            )
        );
    }
    assert!(!entry.post_mvp_unavailable);
    let supported = crate::dependencies::crispasr_supports_engine("parakeet");
    assert_eq!(
        downloadable_entry(&manifest, &entry.engine, &entry.model).is_ok(),
        supported
    );
    let mut disabled = entry.clone();
    disabled.post_mvp_unavailable = true;
    assert!(!model_supported(&disabled));
    let dir = tempdir().unwrap();
    assert_eq!(
        NativeAsrModelManager::default()
            .status_with_roots(
                ManagedModelRoots::below(dir.path()),
                &entry.engine,
                &entry.model
            )
            .await
            .unwrap()
            .disposition,
        if supported {
            NativeAsrModelDisposition::SupportedMissing
        } else {
            NativeAsrModelDisposition::PostMvpUnavailable
        }
    );
    for mutation in 0..6 {
        let mut bad = entry.clone();
        match mutation {
            0 => bad.files[0].role = "aligner".into(),
            1 => bad.files[0].path = "parakeet-tdt-0.6b-ja-q8_0.gguf".into(),
            2 => bad.required_vad = None,
            3 => bad.revision = "main".into(),
            4 => bad.model = "nvidia/parakeet-tdt-0.6b-v2".into(),
            _ => bad.license.spdx = "MIT".into(),
        }
        assert!(validate_manifest(&ModelManifest {
            schema_version: 1,
            models: vec![bad]
        })
        .is_err());
    }
    let mut drift = manifest.clone();
    drift
        .models
        .iter_mut()
        .find(|m| m.engine == "parakeet")
        .unwrap()
        .required_vad
        .as_mut()
        .unwrap()
        .sha256 = "a".repeat(64);
    assert!(validate_manifest(&drift).is_err());
}

#[tokio::test]
async fn parakeet_resume_atomic_readiness_repair_offline_and_shared_cleanup() {
    let dir = tempdir().unwrap();
    let roots = ManagedModelRoots::below(&dir.path().join("中文 模型"));
    let (model, files) = parakeet_fixture();
    validate_manifest(&ModelManifest {
        schema_version: 1,
        models: vec![model.clone()],
    })
    .unwrap();
    let (qwen, qwen_files) = qwen_fixture();
    qwen_install(&roots, &qwen, &qwen_files);
    let manager = NativeAsrModelManager::default();
    assert!(resolve_sync(&roots, &model).unwrap().is_none());
    let part = download_path(&roots, &model)
        .join("parts")
        .join(format!("{}.part", files[0].0));
    fs::create_dir_all(part.parent().unwrap()).unwrap();
    fs::write(&part, &files[0].1[..3]).unwrap();
    let server = MockServer::start_async().await;
    let url = file_url(&server.base_url(), &model, &model.files[0]);
    let resumed = server.mock(|when, then| {
        when.method(GET)
            .path(url.strip_prefix(&server.base_url()).unwrap())
            .header("range", "bytes=3-");
        then.status(206)
            .header(
                "content-range",
                format!("bytes 3-{}/{}", files[0].1.len() - 1, files[0].1.len()),
            )
            .body(files[0].1[3..].to_vec());
    });
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
    assert_eq!(snapshot.downloaded_bytes, model_total(&model));
    assert_eq!(resumed.hits(), 1); // no VAD HTTP mock: verified Qwen asset was reused
    let ready = resolve_sync(&roots, &model).unwrap().unwrap();
    assert_eq!(
        ready
            .roles
            .iter()
            .map(|(r, _)| r.as_str())
            .collect::<Vec<_>>(),
        ["model", "vad"]
    );
    assert_eq!(
        ready.roles[1].1,
        resolve_sync(&roots, &qwen).unwrap().unwrap().roles[2].1
    );
    assert!(ready.path.starts_with(&roots.crispasr));
    assert!(!roots.direct.exists() && !roots.legacy_huggingface.exists());
    let offline = NativeAsrModelManager::default();
    let id = offline
        .start_download_for_model(model.clone(), roots.clone(), "http://127.0.0.1:1".into())
        .await
        .unwrap();
    assert_eq!(
        wait_terminal(&offline, &id).await.status,
        ModelDownloadJobStatus::Completed
    );
    let vad = &ready.roles[1].1;
    fs::write(vad, b"corrupt-vad--").unwrap();
    assert!(offline
        .resolve_entry_with_roots(roots.clone(), model.clone())
        .await
        .unwrap()
        .is_none());
    assert!(resolve_sync(&roots, &qwen).unwrap().is_none());
    let repair = MockServer::start_async().await;
    qwen_http(&repair, &model, &files);
    let id = manager
        .start_download_for_model(model.clone(), roots.clone(), repair.base_url())
        .await
        .unwrap();
    assert_eq!(
        wait_terminal(&manager, &id).await.status,
        ModelDownloadJobStatus::Completed
    );
    fs::write(&ready.roles[0].1, vec![b'x'; files[0].1.len()]).unwrap();
    assert!(resolve_sync(&roots, &model).unwrap().is_none());
    assert!(resolve_sync(&roots, &qwen).unwrap().is_some());
    let id = manager
        .start_download_for_model(model.clone(), roots.clone(), repair.base_url())
        .await
        .unwrap();
    assert_eq!(
        wait_terminal(&manager, &id).await.status,
        ModelDownloadJobStatus::Completed
    );
    // Existing guarded storage cleanup, not a new per-model cancellation API.
    let lease = manager.begin_storage_cleanup().unwrap();
    remove_path_entry(&ready.path).unwrap();
    remove_path_entry(&download_path(&roots, &model)).unwrap();
    drop(lease);
    assert!(resolve_sync(&roots, &model).unwrap().is_none());
    assert!(resolve_sync(&roots, &qwen).unwrap().is_some());
    assert_eq!(fs::read(vad).unwrap(), files[1].1);
    assert!(manager.ready_cache.lock().unwrap().is_empty());
}
