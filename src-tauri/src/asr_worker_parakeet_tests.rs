// Included only by asr_worker::tests; no product availability/configuration switch.
fn full_cli_fixture_roles(engine: &str, temp: &TempDir, scenario: &str) -> Vec<(String, PathBuf)> {
    let mut roles = qwen_fixture_roles(temp, scenario);
    if matches!(engine, "parakeet" | "reazonspeech-nemo") {
        roles.retain(|(role, _)| role != "aligner");
    }
    roles
}

#[test]
fn parakeet_cli_route_roles_and_workspace_are_explicit() {
    let temp = tempfile::tempdir().unwrap();
    let roles = full_cli_fixture_roles("parakeet", &temp, "success");
    let launch = full_cli_launch(&temp, "roles", "parakeet", roles.clone(), None, "cpu");
    assert!(launch.cli_work_dir.is_some());
    let limits = ProtocolLimits::load().unwrap();
    for invalid in [
        qwen_fixture_roles(&temp, "success"),
        vec![roles[0].clone(), roles[0].clone()],
    ] {
        assert!(validate_route("parakeet", "crispasr", "cpu", &invalid, &limits).is_err());
    }
    assert!(validate_route("parakeet", "ctranslate2", "cpu", &roles, &limits).is_err());
    assert!(validate_route("reazonspeech-nemo", "crispasr", "cpu", &roles, &limits).is_ok());
    for (device, vad, config) in [
        ("cpu", false, None),
        ("vulkan", true, None),
        (
            "cuda",
            true,
            Some(VadConfig {
                threshold: Some(0.5),
                min_speech_duration_ms: None,
                min_silence_duration_ms: None,
                speech_pad_ms: None,
                max_segment_duration_ms: None,
            }),
        ),
    ] {
        assert!(ResolvedNativeLaunch::resolve(
            "bad".into(),
            "parakeet".into(),
            roles.clone(),
            device.into(),
            "ja".into(),
            launch.audio_path.clone(),
            launch.output_ass_path.clone(),
            &temp.path().join("中文 缓存"),
            vad,
            config,
            None
        )
        .is_err());
    }
    let outside = temp.path().join("outside.wav");
    fs::copy(&launch.audio_path, &outside).unwrap();
    assert!(ResolvedNativeLaunch::resolve(
        "outside".into(),
        "parakeet".into(),
        roles,
        "cpu".into(),
        "ja".into(),
        outside,
        launch.output_ass_path,
        &temp.path().join("中文 缓存"),
        true,
        None,
        None
    )
    .is_err());
}

#[test]
fn parakeet_cli_fixture_atomic_ass_and_failure_preservation() {
    let _guard = FAKE_WORKER_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(worker) = std::env::var_os("HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER") else {
        return;
    };
    for device in ["cpu", "cuda"] {
        let temp = tempfile::tempdir().unwrap();
        let gate = Arc::new(ActiveJobGate::default());
        let host = NativeAsrHost::new(PathBuf::from(&worker), vec![], Arc::clone(&gate)).unwrap();
        for scenario in [
            "zero-middle",
            "source-control",
            "word-control",
            "source-outside",
            "wrong-backend",
            "wrong-device",
            "no-tdt",
            "after-output-nonzero",
            "silence",
            "raw-zero-overlap",
            "success",
        ] {
            let launch = full_cli_launch(
                &temp,
                scenario,
                "parakeet",
                full_cli_fixture_roles("parakeet", &temp, scenario),
                None,
                device,
            );
            let work = launch.cli_work_dir.clone().unwrap();
            let output = launch.output_ass_path.clone();
            let recovery = launch.recovery_path.clone();
            fs::write(&output, "preserve previous ASS").unwrap();
            host.start(launch, gate.reserve().unwrap()).unwrap();
            let result = wait_terminal(&host, scenario);
            let success = matches!(scenario, "success" | "raw-zero-overlap" | "silence");
            assert_eq!(
                result["status"],
                if success { "completed" } else { "failed" }
            );
            let trace = host.event_trace(scenario);
            if success {
                assert_eq!(
                    trace.event_kinds,
                    vec![
                        TestWorkerEventKind::Ready,
                        TestWorkerEventKind::SegmentsReplace,
                        TestWorkerEventKind::Completed
                    ]
                );
            } else {
                assert!(!trace
                    .event_kinds
                    .contains(&TestWorkerEventKind::SegmentsReplace));
                assert!(result["error"]
                    .as_str()
                    .unwrap()
                    .starts_with("[parakeet_cli_"));
            }
            assert_eq!(
                serde_json::from_slice::<Value>(&fs::read(recovery).unwrap()).unwrap(),
                result
            );
            let ass = fs::read_to_string(output).unwrap();
            if success && scenario != "silence" {
                assert_eq!(
                    result["segments"],
                    serde_json::json!([{"startMs":0,"endMs":1000,"text":"合成テスト。"}])
                );
                assert!(ass.contains("0:00:00.00,0:00:01.00") && ass.contains("合成テスト。"));
                assert_eq!(
                    ass.lines()
                        .filter(|line| line.starts_with("Dialogue:"))
                        .count(),
                    1
                );
            } else {
                assert_eq!(ass, "preserve previous ASS");
            }
            assert!(!work.exists() && !gate.has_active());
        }
    }
}

#[test]
fn reazonspeech_cli_short_success_and_invalid_timeline_preserve_ass() {
    let _guard = FAKE_WORKER_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(worker) = std::env::var_os("HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER") else {
        return;
    };
    for device in ["cpu", "cuda"] {
        for scenario in ["zero-duration", "unordered", "out-of-audio", "success"] {
            let temp = tempfile::tempdir().unwrap();
            let gate = Arc::new(ActiveJobGate::default());
            let host =
                NativeAsrHost::new(PathBuf::from(&worker), vec![], Arc::clone(&gate)).unwrap();
            let job_id = format!("reazon-{device}-{scenario}");
            let launch = full_cli_launch(
                &temp,
                &job_id,
                "reazonspeech-nemo",
                full_cli_fixture_roles("reazonspeech-nemo", &temp, scenario),
                None,
                device,
            );
            let work = launch.cli_work_dir.clone().unwrap();
            let output = launch.output_ass_path.clone();
            fs::write(&output, "preserve previous ASS").unwrap();
            host.start(launch, gate.reserve().unwrap()).unwrap();
            let result = wait_terminal(&host, &job_id);
            let success = scenario == "success";
            assert_eq!(
                result["status"],
                if success { "completed" } else { "failed" },
                "{device}/{scenario}: {result}"
            );
            let trace = host.event_trace(&job_id);
            if success {
                assert_eq!(trace.replacement_events, 1);
                assert_eq!(result["segments"].as_array().unwrap().len(), 1);
                assert!(fs::read_to_string(&output)
                    .unwrap()
                    .contains("合成テスト。"));
            } else {
                assert_eq!(trace.replacement_events, 0);
                assert!(result["error"]
                    .as_str()
                    .unwrap()
                    .starts_with("[reazonspeech_cli_output_invalid]"));
                assert_eq!(
                    fs::read_to_string(&output).unwrap(),
                    "preserve previous ASS"
                );
            }
            assert!(!work.exists() && !gate.has_active());
        }
    }
}

#[cfg(windows)]
#[test]
fn parakeet_cli_reparse_roles_rejected_before_canonicalization() {
    let temp = tempfile::tempdir().unwrap();
    let launch = full_cli_launch(
        &temp,
        "link",
        "parakeet",
        full_cli_fixture_roles("parakeet", &temp, "success"),
        None,
        "cpu",
    );
    let target = temp.path().join("target");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("model.bin"), "success").unwrap();
    let link = temp.path().join("junction");
    assert!(hidden_command("cmd.exe")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(&target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap()
        .success());
    let result = ResolvedNativeLaunch::resolve(
        "bad-link".into(),
        "parakeet".into(),
        vec![
            ("model".into(), link.join("model.bin")),
            ("vad".into(), target.join("model.bin")),
        ],
        "cpu".into(),
        "ja".into(),
        launch.audio_path,
        launch.output_ass_path,
        &temp.path().join("中文 缓存"),
        true,
        None,
        None,
    );
    fs::remove_dir(link).unwrap();
    assert!(result.is_err());
    assert!(target.join("model.bin").exists());
}
