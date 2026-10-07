// Included only inside asr_worker::tests. These inputs never select a product route.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QwenCliHostInputs {
    schema: String,
    device: String,
    worker: LocalCrispAsrPath,
    runtime: Vec<LocalCrispAsrPath>,
    model: LocalCrispAsrPath,
    aligner: LocalCrispAsrPath,
    vad: LocalCrispAsrPath,
    audio: LocalCrispAsrPath,
    evidence_dir: PathBuf,
    #[serde(default)]
    delivery_case: Option<String>,
}

fn qwen_cli_inputs() -> Option<QwenCliHostInputs> {
    let path = std::env::var_os("HIKARU_ASR_QWEN_CLI_HOST_INPUTS");
    let required = std::env::var_os("HIKARU_ASR_QWEN_CLI_HOST_REQUIRED");
    let Some(path) = path else {
        assert!(
            required.is_none(),
            "required full-CLI mode needs its own inputs"
        );
        return None;
    };
    assert_eq!(required.as_deref(), Some(std::ffi::OsStr::new("1")));
    let input: QwenCliHostInputs = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(input.schema, "qwen-full-cli-host-v1");
    assert!(matches!(input.device.as_str(), "cpu" | "cuda"));
    for locked in [
        &input.worker,
        &input.model,
        &input.aligner,
        &input.vad,
        &input.audio,
    ]
    .into_iter()
    .chain(input.runtime.iter())
    {
        reject_link_path(&locked.path).unwrap();
        assert!(locked.path.is_file());
    }
    assert!(input
        .runtime
        .iter()
        .any(|v| v.path.file_name().unwrap() == "crispasr.exe"));
    let root = input.worker.path.parent().unwrap().canonicalize().unwrap();
    let expected: HashSet<_> = [&input.worker]
        .into_iter()
        .chain(input.runtime.iter())
        .map(|v| {
            let path = v.path.canonicalize().unwrap();
            assert_eq!(path.parent(), Some(root.as_path()));
            path
        })
        .collect();
    let actual: HashSet<_> = fs::read_dir(&root)
        .unwrap()
        .map(|v| v.unwrap().path().canonicalize().unwrap())
        .collect();
    assert_eq!(actual, expected, "test runtime file closure drift");
    assert!(
        !input.evidence_dir.exists(),
        "real run evidence must be fresh"
    );
    Some(input)
}

fn qwen_launch(
    temp: &TempDir,
    id: &str,
    roles: Vec<(String, PathBuf)>,
    audio: Option<&Path>,
    device: &str,
) -> ResolvedNativeLaunch {
    full_cli_launch(temp, id, "qwen3-asr", roles, audio, device)
}

fn full_cli_launch(
    temp: &TempDir,
    id: &str,
    engine: &str,
    roles: Vec<(String, PathBuf)>,
    audio: Option<&Path>,
    device: &str,
) -> ResolvedNativeLaunch {
    let cache = temp.path().join("中文 缓存");
    let workspace = cache.join("workspace/中文 工作区");
    fs::create_dir_all(&workspace).unwrap();
    let managed = workspace.join("audio.wav");
    if let Some(audio) = audio {
        fs::copy(audio, &managed).unwrap();
    } else {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(96036u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&(16u32).to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&16000u32.to_le_bytes());
        wav.extend_from_slice(&32000u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&96000u32.to_le_bytes());
        wav.resize(96044, 0);
        fs::write(&managed, wav).unwrap();
    }
    ResolvedNativeLaunch::resolve(
        id.into(),
        engine.into(),
        roles,
        device.into(),
        "ja".into(),
        managed,
        temp.path().join("result.ass"),
        &cache,
        true,
        None,
        None,
    )
    .unwrap()
}

fn qwen_fixture_roles(temp: &TempDir, scenario: &str) -> Vec<(String, PathBuf)> {
    ["model", "aligner", "vad"]
        .into_iter()
        .map(|role| {
            let path = temp.path().join(format!("中文 {role}.bin"));
            fs::write(&path, scenario).unwrap();
            (role.into(), path)
        })
        .collect()
}

#[test]
fn qwen_cli_required_setup_cannot_skip_or_decode_generic_inputs() {
    let _guard = FAKE_WORKER_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let _required = replace_env("HIKARU_ASR_QWEN_CLI_HOST_REQUIRED", Some("1"));
    let _input = replace_env("HIKARU_ASR_QWEN_CLI_HOST_INPUTS", None);
    assert!(std::panic::catch_unwind(qwen_cli_inputs).is_err());
    assert!(serde_json::from_str::<QwenCliHostInputs>(
        r#"{"worker":"legacy.exe","device":"cpu","engine":"qwen3-asr"}"#
    )
    .is_err());
}

#[test]
fn qwen_cli_fixture_host_results_and_recovery() {
    let _guard = FAKE_WORKER_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(worker) = std::env::var_os("HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER") else {
        return;
    };
    let worker = PathBuf::from(worker);
    assert!(worker.is_file());
    for scenario in [
        "success",
        "silence",
        "bad-json",
        "half-file",
        "nonzero",
        "after-output-nonzero",
        "no-words",
        "fallback",
        "empty",
        "duplicate",
        "unicode-invalid",
        "utf8-invalid",
        "nul-suffix",
        "nul-garbage",
        "nul-invalid-utf8",
        "nul-nested-value",
        "nul-nested-key",
        "nul-nested-token",
        "trailing-whitespace",
        "oversize",
        "text-loss",
        "zero-duration",
        "out-of-audio",
        "wrong-type",
        "wrong-units",
        "unordered",
        "no-graph",
        "wrong-device",
        "zero-middle",
        "zero-trailing",
        "zero-leading",
        "zero-leading-consecutive",
        "zero-consecutive",
        "backward-cascade",
        "zero-cascade",
        "ordinary-overlap",
        "equal-starts",
        "all-zero-same",
        "all-zero-distinct",
        "member-negative-duration",
        "member-negative-start",
        "member-negative-end",
        "member-out-of-audio",
        "member-zero-out-of-audio",
        "member-float",
        "member-bool",
        "member-unsigned-overflow",
        "member-missing",
        "member-text-type",
        "member-text-empty",
        "member-text-whitespace",
        "member-text-control",
        "member-text-nul",
        "member-text-oversize",
        "merged-text-overflow",
        "count-overflow",
        "unhelpful-words",
        "word-negative",
        "word-type",
        "word-text-empty",
        "fallback-type",
        "escaped-nul-unused",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let gate = Arc::new(ActiveJobGate::default());
        let host = NativeAsrHost::new(worker.clone(), vec![], Arc::clone(&gate)).unwrap();
        let launch = qwen_launch(
            &temp,
            scenario,
            qwen_fixture_roles(&temp, scenario),
            None,
            "cpu",
        );
        let recovery = launch.recovery_path.clone();
        let output = launch.output_ass_path.clone();
        let work = launch.cli_work_dir.clone().unwrap();
        fs::write(&output, "existing ASS must survive failure").unwrap();
        host.start(launch, gate.reserve().unwrap()).unwrap();
        let result = wait_terminal(&host, scenario);
        let expected = match scenario {
            "success" | "trailing-whitespace" | "escaped-nul-unused" => {
                vec![(0, 1000, "合成テスト。")]
            }
            "zero-middle" => vec![(0, 800, " A  日本　"), (1000, 1500, " B ")],
            "zero-trailing" => vec![(0, 800, " A  日本　")],
            "zero-leading" => vec![(100, 800, " A  日本　")],
            "zero-leading-consecutive" => vec![(100, 800, " A  日本　 B ")],
            "zero-consecutive" => vec![(0, 900, " A  日本　 B ")],
            "backward-cascade" => vec![(100, 2600, " A  日本　 B 終 ")],
            "zero-cascade" => vec![(100, 1500, " A  日本　 B ")],
            "ordinary-overlap" => vec![(0, 1500, " A "), (500, 1000, " 日本　")],
            "equal-starts" => vec![(100, 1500, " A "), (100, 500, " 日本　")],
            _ => vec![],
        };
        let good = scenario == "silence" || !expected.is_empty();
        assert_eq!(
            result["status"],
            if good { "completed" } else { "failed" },
            "{scenario}: {result}"
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&recovery).unwrap()).unwrap(),
            result
        );
        assert!(!work.exists());
        assert!(!gate.has_active());
        let trace = host.event_trace(scenario);
        assert_eq!(trace.segment_events, 0);
        assert_eq!(trace.replacement_events, usize::from(good));
        assert_eq!(
            trace.event_kinds.contains(&TestWorkerEventKind::Completed),
            good
        );
        if !expected.is_empty() {
            let ass = fs::read_to_string(&output).unwrap();
            let dialogues: Vec<_> = ass
                .lines()
                .filter(|line| line.starts_with("Dialogue:"))
                .collect();
            assert_eq!(dialogues.len(), expected.len());
            assert_eq!(result["segments"].as_array().unwrap().len(), expected.len());
            for (i, (start, end, text)) in expected.into_iter().enumerate() {
                assert_eq!(
                    result["segments"][i],
                    serde_json::json!({"startMs":start,"endMs":end,"text":text})
                );
                assert_eq!(
                    dialogues[i],
                    format!(
                        "Dialogue: 0,{},{},Primary,,0,0,0,,{}",
                        format_ass_time(start),
                        format_ass_time(end),
                        text
                    )
                );
            }
        } else {
            assert_eq!(
                fs::read_to_string(output).unwrap(),
                "existing ASS must survive failure"
            );
        }
        if !good {
            let error = result["error"].as_str().unwrap();
            assert!(
                !error.contains("private") && !error.contains("C:\\") && !error.contains("合成")
            );
        }
    }
}

#[cfg(windows)]
#[test]
fn qwen_cli_fixture_cancel_shutdown_crash_and_immediate_reopen() {
    let _guard = FAKE_WORKER_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(worker) = std::env::var_os("HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER") else {
        return;
    };
    for engine in ["qwen3-asr", "parakeet", "reazonspeech-nemo"] {
        for action in ["cancel", "shutdown", "crash"] {
            let temp = tempfile::tempdir().unwrap();
            let gate = Arc::new(ActiveJobGate::default());
            let host =
                NativeAsrHost::new(PathBuf::from(&worker), vec![], Arc::clone(&gate)).unwrap();
            let launch = full_cli_launch(
                &temp,
                action,
                engine,
                full_cli_fixture_roles(engine, &temp, "descendant"),
                None,
                "cpu",
            );
            let output = launch.output_ass_path.clone();
            let recovery = launch.recovery_path.clone();
            fs::write(&output, "preserve").unwrap();
            host.start(launch, gate.reserve().unwrap()).unwrap();
            let record = host.inner.jobs.lock().unwrap().get(action).unwrap().clone();
            let owned = record.process_job.as_ref().unwrap();
            let deadline = Instant::now() + Duration::from_secs(5);
            while owned.active().unwrap() < 3 {
                assert!(
                    Instant::now() < deadline,
                    "fixture descendant never started: {:?}",
                    host.snapshot(action, true).unwrap()
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            assert!(gate.reserve().is_err());
            let began = Instant::now();
            match action {
                "cancel" => host.cancel(action).unwrap(),
                "shutdown" => host.shutdown(),
                _ => {
                    let pid = record.inner.lock().unwrap().pid.unwrap();
                    // Kill only this test-owned worker, deliberately not /T, to prove
                    // nested kill-on-close + host ownership reap its real descendants.
                    assert!(hidden_command("taskkill")
                        .args(["/PID", &pid.to_string(), "/F"])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status()
                        .unwrap()
                        .success());
                }
            }
            let result = wait_terminal(&host, action);
            assert!(began.elapsed() < Duration::from_secs(2));
            assert_eq!(owned.active().unwrap(), 0);
            assert!(!gate.has_active());
            assert_eq!(
                result["status"],
                if action == "crash" {
                    "failed"
                } else {
                    "cancelled"
                }
            );
            assert_eq!(fs::read_to_string(&output).unwrap(), "preserve");
            assert_eq!(
                serde_json::from_slice::<Value>(&fs::read(recovery).unwrap()).unwrap(),
                result
            );
            let next = full_cli_launch(
                &temp,
                "reopen",
                engine,
                full_cli_fixture_roles(engine, &temp, "success"),
                None,
                "cpu",
            );
            host.start(next, gate.reserve().unwrap()).unwrap();
            assert_eq!(wait_terminal(&host, "reopen")["status"], "completed");
        }
    }
}

#[test]
fn qwen_cli_real_short_host_ass_roundtrip() {
    if std::env::var_os("HIKARU_ASR_QWEN_CLI_HOST_INPUTS").is_none()
        && std::env::var_os("HIKARU_ASR_QWEN_CLI_HOST_REQUIRED").is_none()
    {
        return;
    }
    let _guard = FAKE_WORKER_TEST_LOCK
        .try_lock()
        .unwrap_or_else(|e| match e {
            std::sync::TryLockError::Poisoned(e) => e.into_inner(),
            _ => panic!("model-backed host cases must run serially"),
        });
    let Some(input) = qwen_cli_inputs() else {
        return;
    };
    let temp = tempfile::tempdir().unwrap();
    let gate = Arc::new(ActiveJobGate::default());
    let host = NativeAsrHost::new(input.worker.path.clone(), vec![], Arc::clone(&gate)).unwrap();
    let roles = vec![
        ("model".into(), input.model.path.clone()),
        ("aligner".into(), input.aligner.path.clone()),
        ("vad".into(), input.vad.path.clone()),
    ];
    let launch = qwen_launch(
        &temp,
        "qwen-real-short",
        roles,
        Some(&input.audio.path),
        &input.device,
    );
    assert!(launch.audio_path.is_file());
    let recovery = launch.recovery_path.clone();
    let output = launch.output_ass_path.clone();
    let work = launch.cli_work_dir.clone().unwrap();
    let began = Instant::now();
    host.start(launch, gate.reserve().unwrap()).unwrap();
    // CPU load is not synthetic progress. The outer owned runner is responsible
    // for any manual timeout; this is a finite functional wait, not a speed gate.
    let result = wait_terminal_with_timeout(&host, "qwen-real-short", Duration::from_secs(1800));
    fs::create_dir(&input.evidence_dir).unwrap();
    fs::write(
        input.evidence_dir.join("snapshot.json"),
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .unwrap();
    fs::copy(&recovery, input.evidence_dir.join("recovery.json")).unwrap();
    assert_eq!(result["status"], "completed", "real full-CLI route failed");
    let trace = host.event_trace("qwen-real-short");
    assert_eq!(
        trace.event_kinds,
        vec![
            TestWorkerEventKind::Ready,
            TestWorkerEventKind::SegmentsReplace,
            TestWorkerEventKind::Completed
        ]
    );
    assert!(result["segmentCount"].as_u64().unwrap() > 0);
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(&recovery).unwrap()).unwrap(),
        result
    );
    let ass = fs::read_to_string(&output).unwrap();
    assert_eq!(
        ass.lines()
            .filter(|line| line.starts_with("Dialogue:"))
            .count(),
        result["segmentCount"].as_u64().unwrap() as usize
    );
    assert!(!work.exists());
    assert!(!gate.has_active());
    fs::copy(output, input.evidence_dir.join("result.ass")).unwrap();
    let summary = serde_json::json!({"device": input.device, "status":"completed", "elapsedSeconds":began.elapsed().as_secs_f64(),
        "segmentCount": result["segmentCount"], "atomicReplacement":true, "recoveryMatches":true,
        "assRows":result["segmentCount"], "privateWorkRemoved":true, "activeGateReleased":true});
    fs::write(
        input.evidence_dir.join("summary.json"),
        serde_json::to_vec_pretty(&summary).unwrap(),
    )
    .unwrap();
    println!("{}", summary);
}

#[test]
fn qwen_cli_final_manager_host_functional_case() {
    let Some(path) = std::env::var_os("HIKARU_ASR_QWEN_DELIVERY_INPUTS") else {
        assert!(std::env::var_os("HIKARU_ASR_QWEN_DELIVERY_REQUIRED").is_none());
        return;
    };
    assert_eq!(
        std::env::var("HIKARU_ASR_QWEN_DELIVERY_REQUIRED").as_deref(),
        Ok("1")
    );
    let _guard = FAKE_WORKER_TEST_LOCK
        .try_lock()
        .expect("serial model execution");
    let input: QwenCliHostInputs = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(input.schema, "qwen-full-cli-host-v1");
    assert!(matches!(input.device.as_str(), "cpu" | "cuda"));
    let case = input.delivery_case.as_deref().unwrap_or("functional");
    assert!(matches!(case, "functional" | "silence" | "cancel-reopen"));
    for locked in [
        &input.worker,
        &input.audio,
        &input.model,
        &input.aligner,
        &input.vad,
    ]
    .into_iter()
    .chain(input.runtime.iter())
    {
        reject_link_path(&locked.path).unwrap();
        assert!(locked.path.is_file());
    }
    assert!(
        !input.evidence_dir.exists(),
        "fresh real-run evidence required"
    );
    fs::create_dir(&input.evidence_dir).unwrap();
    let runtime = crate::dependencies::verify_crispasr_delivery_test_runtime(
        input.worker.path.parent().unwrap(),
        &input.device,
    )
    .unwrap();
    assert_eq!(runtime.worker, input.worker.path);
    let temp = tempfile::tempdir().unwrap();
    let model = tokio::runtime::Runtime::new().unwrap().block_on(
        crate::asr_models::resolve_full_cli_delivery_test_model(
            &temp.path().join("中文 deps"),
            "qwen3-asr",
            "Qwen/Qwen3-ASR-1.7B",
            &[
                input.model.path.clone(),
                input.aligner.path.clone(),
                input.vad.path.clone(),
            ],
        ),
    );
    let gate = Arc::new(ActiveJobGate::default());
    let host = NativeAsrHost::new_with_environment(
        runtime.worker,
        vec![],
        crate::asr::cuda_host_environment(&runtime.root).unwrap(),
        vec![
            "CUDA_PATH".into(),
            "CUDA_HOME".into(),
            "CT2_CUDA_ALLOW_FP16".into(),
        ],
        Arc::clone(&gate),
    )
    .unwrap();
    let cache = temp.path().join("中文 缓存");
    let workspace = cache.join("workspace/中文 工作区");
    fs::create_dir_all(&workspace).unwrap();
    let audio = workspace.join("audio.wav");
    fs::copy(&input.audio.path, &audio).unwrap();
    let output = temp.path().join("result.ass");
    fs::write(&output, "preserve old ASS").unwrap();
    let args = serde_json::json!({"engine":"qwen3-asr","model":"Qwen/Qwen3-ASR-1.7B",
        "device":input.device,"audioPath":audio,"outputAssPath":output,"useVad":false,"vadConfig":null});
    let make_launch = |id: &str| {
        crate::asr::qualified_native_launch(
            serde_json::from_value(args.clone()).unwrap(),
            model.clone(),
            id.into(),
            input.device.clone(),
            cache.clone(),
            None,
        )
        .unwrap()
    };
    if case == "cancel-reopen" {
        let mut cancelled = make_launch("qwen-cancel");
        let captured = Arc::new(Mutex::new(Vec::new()));
        cancelled.capture_cli_result = Some(Arc::clone(&captured));
        let recovery = cancelled.recovery_path.clone();
        let work = cancelled.cli_work_dir.clone().unwrap();
        host.start(cancelled, gate.reserve().unwrap()).unwrap();
        let record = host
            .inner
            .jobs
            .lock()
            .unwrap()
            .get("qwen-cancel")
            .unwrap()
            .clone();
        let owned = record.process_job.as_ref().unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        while owned.active().unwrap() < 2 {
            assert!(Instant::now() < deadline, "owned real CLI did not start");
            std::thread::sleep(Duration::from_millis(5));
        }
        // Observe a running owned CLI, not a cancellation before worker readiness.
        std::thread::sleep(Duration::from_secs(1));
        let active_before = owned.active().unwrap();
        assert!(
            active_before >= 2
                && host.snapshot("qwen-cancel", true).unwrap().unwrap()["durationMs"]
                    .as_u64()
                    .unwrap()
                    > 0
        );
        assert!(gate.reserve().is_err());
        let began = Instant::now();
        let first_cancel = host.cancel("qwen-cancel");
        let elapsed = began.elapsed().as_secs_f64();
        // Preserve the real first result before any assertion/retry. A controlled
        // delete failure is distinct from physical reap and must not be erased.
        let result = host.snapshot("qwen-cancel", true).unwrap().unwrap();
        let job = record.inner.lock().unwrap();
        let first_state = serde_json::json!({"error":first_cancel.as_ref().err(),
            "elapsedSeconds":elapsed,"pid":job.pid,"reaped":job.reaped,
            "workerExited":job.worker_exited,"cleanupPending":job.cleanup_pending,
            "ownedProcesses":owned.active().unwrap(),"gateActive":gate.has_active(),
            "privateWorkExists":work.exists(),"snapshot":result});
        drop(job);
        fs::write(
            input.evidence_dir.join("cancel-first-attempt.json"),
            serde_json::to_vec_pretty(&first_state).unwrap(),
        )
        .unwrap();
        fs::write(
            input.evidence_dir.join("cancel-snapshot.json"),
            serde_json::to_vec_pretty(&result).unwrap(),
        )
        .unwrap();
        fs::copy(&recovery, input.evidence_dir.join("cancel-recovery.json")).unwrap();
        fs::write(
            input.evidence_dir.join("cancel-private-cli-result.json"),
            &*captured.lock().unwrap(),
        )
        .unwrap();
        let trace = host.event_trace("qwen-cancel");
        assert!(elapsed < 2.0 && owned.active().unwrap() == 0);
        assert!(host.is_reaped("qwen-cancel") && !gate.has_active());
        assert_eq!(first_state["pid"], Value::Null);
        assert_eq!(first_state["workerExited"], true);
        assert_eq!(result["status"], "cancelled");
        assert_eq!(trace.replacement_events, 0);
        assert!(!trace.event_kinds.contains(&TestWorkerEventKind::Completed));
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&recovery).unwrap()).unwrap(),
            result
        );
        assert_eq!(fs::read_to_string(&output).unwrap(), "preserve old ASS");
        if let Err(error) = &first_cancel {
            assert_eq!(error, "无法清理 ASR 私有结果");
            assert_eq!(first_state["cleanupPending"], true);
            std::thread::sleep(Duration::from_millis(100));
        }
        // Exactly one bounded existing cleanup retry (idempotence if already clean).
        let retry_began = Instant::now();
        let retry = host.cancel("qwen-cancel");
        let retry_elapsed = retry_began.elapsed().as_secs_f64();
        let job = record.inner.lock().unwrap();
        let retry_state = serde_json::json!({"error":retry.as_ref().err(),"elapsedSeconds":retry_elapsed,
            "pid":job.pid,"reaped":job.reaped,"cleanupPending":job.cleanup_pending,
            "ownedProcesses":owned.active().unwrap(),"gateActive":gate.has_active(),
            "privateWorkExists":work.exists()});
        drop(job);
        fs::write(
            input.evidence_dir.join("cancel-cleanup-retry.json"),
            serde_json::to_vec_pretty(&retry_state).unwrap(),
        )
        .unwrap();
        retry.unwrap();
        assert!(retry_elapsed < 2.0 && !record.inner.lock().unwrap().cleanup_pending);
        fs::write(input.evidence_dir.join("cancel-summary.json"), serde_json::to_vec_pretty(&serde_json::json!({
            "device":input.device,"status":result["status"],"elapsedSeconds":elapsed,
            "ownedProcessesBefore":active_before,"ownedProcessesAfter":owned.active().unwrap(),
            "privateWorkRemoved":!work.exists(),"activeGateReleased":!gate.has_active(),
            "replacementEvents":trace.replacement_events,"completedEvents":trace.event_kinds.iter().filter(|v| **v==TestWorkerEventKind::Completed).count(),
            "firstCancelError":first_cancel.err(),"cleanupRetryPassed":true,"cleanupRetrySeconds":retry_elapsed
        })).unwrap()).unwrap();
        assert!(elapsed < 2.0 && owned.active().unwrap() == 0);
        assert!(host.is_reaped("qwen-cancel") && !gate.has_active() && !work.exists());
        assert_eq!(result["status"], "cancelled");
        assert_eq!(trace.replacement_events, 0);
        assert!(!trace.event_kinds.contains(&TestWorkerEventKind::Completed));
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(recovery).unwrap()).unwrap(),
            result
        );
        assert_eq!(fs::read_to_string(&output).unwrap(), "preserve old ASS");
    }
    // Same resolved offline models/runtime/host; reopen after physical cleanup.
    let mut launch = make_launch("qwen-final");
    let captured = Arc::new(Mutex::new(Vec::new()));
    launch.capture_cli_result = Some(Arc::clone(&captured));
    let recovery = launch.recovery_path.clone();
    let work = launch.cli_work_dir.clone().unwrap();
    let began = Instant::now();
    host.start(launch, gate.reserve().unwrap()).unwrap();
    let result = wait_terminal_with_timeout(
        &host,
        "qwen-final",
        Duration::from_secs(if case == "cancel-reopen" { 300 } else { 14400 }),
    );
    fs::write(
        input.evidence_dir.join("private-cli-result.json"),
        &*captured.lock().unwrap(),
    )
    .unwrap();
    fs::write(
        input.evidence_dir.join("snapshot.json"),
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .unwrap();
    fs::copy(&recovery, input.evidence_dir.join("recovery.json")).unwrap();
    let trace = host.event_trace("qwen-final");
    let success = result["status"] == "completed";
    let summary = serde_json::json!({"device":input.device,"status":result["status"],"error":result["error"],"elapsedSeconds":began.elapsed().as_secs_f64(),
        "segmentCount":result["segmentCount"],"privateWorkRemoved":!work.exists(),"activeGateReleased":!gate.has_active(),
        "managerResolvedRoles":true,"prelaunchProbe":if input.device=="cuda"{"passed"}else{"not-invoked"},
        "deliveryCase":case,"recoveryMatches":serde_json::from_slice::<Value>(&fs::read(&recovery).unwrap()).unwrap()==result,
        "reaped":host.is_reaped("qwen-final"),"offlineReuse":true,
        "atomicReplacement":trace.event_kinds==vec![TestWorkerEventKind::Ready,TestWorkerEventKind::SegmentsReplace,TestWorkerEventKind::Completed]});
    fs::write(
        input.evidence_dir.join("summary.json"),
        serde_json::to_vec_pretty(&summary).unwrap(),
    )
    .unwrap();
    assert!(!work.exists() && !gate.has_active());
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(recovery).unwrap()).unwrap(),
        result
    );
    if success {
        assert_eq!(
            result["segmentCount"].as_u64().unwrap() == 0,
            case == "silence"
        );
        assert_eq!(
            trace.event_kinds,
            vec![
                TestWorkerEventKind::Ready,
                TestWorkerEventKind::SegmentsReplace,
                TestWorkerEventKind::Completed
            ]
        );
        let ass = fs::read_to_string(&output).unwrap();
        assert_eq!(
            ass.lines().filter(|l| l.starts_with("Dialogue:")).count(),
            result["segmentCount"].as_u64().unwrap() as usize
        );
        for (line, segment) in ass
            .lines()
            .filter(|l| l.starts_with("Dialogue:"))
            .zip(result["segments"].as_array().unwrap())
        {
            assert_eq!(
                line,
                format!(
                    "Dialogue: 0,{},{},Primary,,0,0,0,,{}",
                    format_ass_time(segment["startMs"].as_i64().unwrap()),
                    format_ass_time(segment["endMs"].as_i64().unwrap()),
                    segment["text"].as_str().unwrap()
                )
            );
        }
        if case == "silence" {
            assert_eq!(ass, "preserve old ASS");
        }
        fs::copy(output, input.evidence_dir.join("result.ass")).unwrap();
    } else {
        assert_eq!(fs::read_to_string(output).unwrap(), "preserve old ASS");
    }
    println!("{}", summary);
    assert!(success, "structured final functional failure preserved");
}

#[cfg(windows)]
#[test]
fn qwen_cli_ass_persistence_failure_is_not_completed() {
    use std::os::windows::fs::OpenOptionsExt;
    let _guard = FAKE_WORKER_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(worker) = std::env::var_os("HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER") else {
        return;
    };
    let temp = tempfile::tempdir().unwrap();
    let gate = Arc::new(ActiveJobGate::default());
    let host = NativeAsrHost::new(PathBuf::from(worker), vec![], Arc::clone(&gate)).unwrap();
    let launch = qwen_launch(
        &temp,
        "write-failure",
        qwen_fixture_roles(&temp, "success"),
        None,
        "cpu",
    );
    let output = launch.output_ass_path.clone();
    let recovery = launch.recovery_path.clone();
    fs::write(&output, "preserve locked ASS").unwrap();
    let _locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&output)
        .unwrap();
    host.start(launch, gate.reserve().unwrap()).unwrap();
    let result = wait_terminal(&host, "write-failure");
    assert_eq!(result["status"], "failed");
    assert!(result["error"]
        .as_str()
        .unwrap()
        .contains("recovery_write_failed"));
    assert_eq!(fs::read_to_string(output).unwrap(), "preserve locked ASS");
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(recovery).unwrap()).unwrap(),
        result
    );
    assert!(!gate.has_active());
}

#[test]
fn qwen_cli_required_role_and_workspace_are_explicit() {
    let temp = tempfile::tempdir().unwrap();
    let launch = qwen_launch(
        &temp,
        "roles",
        qwen_fixture_roles(&temp, "success"),
        None,
        "cpu",
    );
    assert!(launch.cli_work_dir.is_some());
    let roles: Vec<_> = launch
        .model_paths
        .iter()
        .map(|v| (v.role.clone(), PathBuf::from(&v.path)))
        .collect();
    assert!(ResolvedNativeLaunch::resolve(
        "bad-vad".into(),
        "qwen3-asr".into(),
        roles.clone(),
        "cpu".into(),
        "ja".into(),
        launch.audio_path.clone(),
        launch.output_ass_path.clone(),
        &temp.path().join("中文 缓存"),
        false,
        None,
        None
    )
    .is_err());
    let mut ct2 = roles;
    ct2.retain(|v| v.0 != "aligner");
    assert!(validate_route(
        "faster-whisper",
        "ctranslate2",
        "cpu",
        &ct2,
        &ProtocolLimits::load().unwrap()
    )
    .is_ok());
}

#[cfg(windows)]
#[test]
fn qwen_cli_host_rejects_reparse_role_paths_before_canonicalization() {
    let temp = tempfile::tempdir().unwrap();
    let launch = qwen_launch(
        &temp,
        "link-check",
        qwen_fixture_roles(&temp, "success"),
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
    let roles = launch
        .model_paths
        .iter()
        .map(|v| {
            (
                v.role.clone(),
                if v.role == "model" {
                    link.join("model.bin")
                } else {
                    PathBuf::from(&v.path)
                },
            )
        })
        .collect();
    assert!(ResolvedNativeLaunch::resolve(
        "bad-link".into(),
        "qwen3-asr".into(),
        roles,
        "cpu".into(),
        "ja".into(),
        launch.audio_path,
        launch.output_ass_path,
        &temp.path().join("中文 缓存"),
        true,
        None,
        None
    )
    .is_err());
    fs::remove_dir(link).unwrap();
    assert!(target.join("model.bin").is_file());
}

#[cfg(windows)]
#[test]
fn qwen_cli_locked_results_release_process_gate_and_retry_cleanup() {
    use std::os::windows::fs::OpenOptionsExt;
    let _guard = FAKE_WORKER_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(worker) = std::env::var_os("HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER") else {
        return;
    };
    for engine in ["qwen3-asr", "parakeet", "reazonspeech-nemo"] {
        for action in ["cancel", "shutdown", "crash", "finish"] {
            let temp = tempfile::tempdir().unwrap();
            let gate = Arc::new(ActiveJobGate::default());
            let host =
                NativeAsrHost::new(PathBuf::from(&worker), vec![], Arc::clone(&gate)).unwrap();
            let launch = full_cli_launch(
                &temp,
                action,
                engine,
                full_cli_fixture_roles(
                    engine,
                    &temp,
                    if action == "finish" {
                        "wait-success"
                    } else {
                        "descendant"
                    },
                ),
                None,
                "cpu",
            );
            let work = launch.cli_work_dir.clone().unwrap();
            let output = launch.output_ass_path.clone();
            let recovery = launch.recovery_path.clone();
            fs::write(&output, "preserve locked-result ASS").unwrap();
            host.start(launch, gate.reserve().unwrap()).unwrap();
            let record = host.inner.jobs.lock().unwrap().get(action).unwrap().clone();
            let owned = record.process_job.as_ref().unwrap();
            let deadline = Instant::now() + Duration::from_secs(5);
            while owned.active().unwrap() < if action == "finish" { 2 } else { 3 }
                || !work.join("result.json").is_file()
            {
                assert!(Instant::now() < deadline, "fixture did not start");
                std::thread::sleep(Duration::from_millis(5));
            }
            let held = fs::OpenOptions::new()
                .read(true)
                .share_mode(3)
                .open(work.join("result.json"))
                .unwrap();
            let began = Instant::now();
            match action {
                "cancel" => {
                    let error = host.cancel(action).unwrap_err();
                    assert!(error.contains("无法清理 ASR 私有结果"), "{error}");
                }
                "shutdown" => host.shutdown(),
                "finish" => fs::write(work.join("finish"), "").unwrap(),
                _ => {
                    let pid = record.inner.lock().unwrap().pid.unwrap();
                    assert!(hidden_command("taskkill")
                        .args(["/PID", &pid.to_string(), "/F"])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status()
                        .unwrap()
                        .success());
                }
            }
            let guard = record.inner.lock().unwrap();
            let (guard, timeout) = record
                .reaped
                .wait_timeout_while(
                    guard,
                    Duration::from_secs(2).saturating_sub(began.elapsed()),
                    |j| !j.reaped,
                )
                .unwrap();
            assert!(
                !timeout.timed_out() || guard.reaped,
                "physical reap must publish despite locked file"
            );
            assert!(guard.reaped && guard.pid.is_none() && guard.cleanup_pending);
            assert!(
                !gate.has_active(),
                "gate must release before reap notification"
            );
            drop(guard);
            assert!(began.elapsed() < Duration::from_secs(2));
            assert_eq!(owned.active().unwrap(), 0);
            assert!(work.exists(), "failed deletion is not removal");
            assert!(host
                .cancel(action)
                .unwrap_err()
                .contains("无法清理 ASR 私有结果"));
            let result = host.snapshot(action, true).unwrap().unwrap();
            assert_eq!(
                result["status"],
                if matches!(action, "cancel" | "shutdown") {
                    "cancelled"
                } else {
                    "failed"
                }
            );
            if action == "finish" {
                assert!(result["error"]
                    .as_str()
                    .unwrap()
                    .contains("worker_cleanup_failed"));
            }
            assert_eq!(
                serde_json::from_slice::<Value>(&fs::read(&recovery).unwrap()).unwrap(),
                result
            );
            assert_eq!(
                fs::read_to_string(&output).unwrap(),
                "preserve locked-result ASS"
            );
            // A real new job can finish while the old deletion remains obstructed.
            let next = full_cli_launch(
                &temp,
                "while-locked",
                engine,
                full_cli_fixture_roles(engine, &temp, "silence"),
                None,
                "cpu",
            );
            host.start(next, gate.reserve().unwrap()).unwrap();
            assert_eq!(wait_terminal(&host, "while-locked")["status"], "completed");
            assert_eq!(
                fs::read_to_string(&output).unwrap(),
                "preserve locked-result ASS"
            );
            drop(held);
            host.cancel(action).unwrap();
            assert!(!work.exists());
            assert_eq!(host.snapshot(action, true).unwrap().unwrap(), result);
            assert!(!record.inner.lock().unwrap().cleanup_pending);
            let next = full_cli_launch(
                &temp,
                "reopen",
                engine,
                full_cli_fixture_roles(engine, &temp, "success"),
                None,
                "cpu",
            );
            host.start(next, gate.reserve().unwrap()).unwrap();
            assert_eq!(wait_terminal(&host, "reopen")["status"], "completed");
        }
    }
}

#[cfg(windows)]
#[test]
fn qwen_cli_startup_abort_keeps_cleanup_retryable() {
    use std::os::windows::{fs::OpenOptionsExt, process::CommandExt};
    let _guard = FAKE_WORKER_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(worker) = std::env::var_os("HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER") else {
        return;
    };
    for mode in ["clean", "locked", "unconfirmed"] {
        let locked = mode == "locked";
        let temp = tempfile::tempdir().unwrap();
        let gate = Arc::new(ActiveJobGate::default());
        let host = NativeAsrHost::new(PathBuf::from(&worker), vec![], Arc::clone(&gate)).unwrap();
        let launch = qwen_launch(
            &temp,
            "abort",
            qwen_fixture_roles(&temp, "descendant"),
            None,
            "cpu",
        );
        let work = launch.cli_work_dir.clone().unwrap();
        fs::create_dir(&work).unwrap();
        fs::write(&launch.output_ass_path, "preserve abort ASS").unwrap();
        let mut command = hidden_command(&worker);
        command
            .creation_flags(crate::process::CREATE_NO_WINDOW | 0x4)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command.spawn().unwrap();
        let owned = Arc::new(worker_job::WorkerJob::new().unwrap());
        owned.attach_and_resume(&mut child).unwrap();
        let mut record = JobRecord::new(
            &launch,
            Some(child.id()),
            host.inner.limits.max_replacement_segments,
        );
        record.process_job = Some(owned.clone());
        let record = Arc::new(record);
        host.inner
            .jobs
            .lock()
            .unwrap()
            .insert("abort".into(), record.clone());
        gate.reserve().unwrap().activate("abort").unwrap();
        let request = WorkerRequestV1::from_launch(&launch, &host.inner.limits).unwrap();
        let mut bytes = serde_json::to_vec(&request).unwrap();
        bytes.push(b'\n');
        child.stdin.take().unwrap().write_all(&bytes).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while owned.active().unwrap() < 3 || !work.join("result.json").exists() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        let held = locked.then(|| {
            fs::OpenOptions::new()
                .read(true)
                .share_mode(3)
                .open(work.join("result.json"))
                .unwrap()
        });
        owned
            .fail_reap
            .store(mode == "unconfirmed", Ordering::Relaxed);
        let began = Instant::now();
        let cleanup = abort_spawned_job(
            &record,
            &mut child,
            &gate,
            ProtocolFailure::new(
                "worker_start_cancelled",
                "Worker start reservation was cancelled",
            ),
        );
        assert_eq!(cleanup.is_err(), mode != "clean");
        assert!(began.elapsed() < Duration::from_secs(2));
        assert_eq!(owned.active().unwrap(), 0);
        if mode == "unconfirmed" {
            let job = record.inner.lock().unwrap();
            assert!(!job.reaped && job.pid.is_some() && job.reap_retry && job.cleanup_pending);
            drop(job);
            assert!(gate.has_active() && work.exists());
            assert!(host
                .cancel("abort")
                .unwrap_err()
                .contains("worker_job_failed"));
            assert!(gate.has_active() && !host.is_reaped("abort"));
            owned.fail_reap.store(false, Ordering::Relaxed);
            host.cancel("abort").unwrap();
        }
        assert!(record.inner.lock().unwrap().reaped);
        assert!(
            !gate.has_active(),
            "confirmed abort must release active gate"
        );
        assert_eq!(work.exists(), locked);
        assert_eq!(host.cancel("abort").is_err(), locked);
        drop(held);
        host.cancel("abort").unwrap();
        assert!(!work.exists());
        let result = host.snapshot("abort", true).unwrap().unwrap();
        assert_eq!(result["status"], "failed");
        assert!(result["error"]
            .as_str()
            .unwrap()
            .contains("worker_start_cancelled"));
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&launch.recovery_path).unwrap()).unwrap(),
            result
        );
        assert_eq!(
            fs::read_to_string(&launch.output_ass_path).unwrap(),
            "preserve abort ASS"
        );
    }
}

#[cfg(windows)]
#[test]
fn qwen_cli_unconfirmed_monitor_exit_is_not_reaped_until_retry() {
    let _guard = FAKE_WORKER_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(worker) = std::env::var_os("HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER") else {
        return;
    };
    let temp = tempfile::tempdir().unwrap();
    let gate = Arc::new(ActiveJobGate::default());
    let host = NativeAsrHost::new(PathBuf::from(worker), vec![], Arc::clone(&gate)).unwrap();
    let launch = qwen_launch(
        &temp,
        "unconfirmed",
        qwen_fixture_roles(&temp, "descendant"),
        None,
        "cpu",
    );
    let work = launch.cli_work_dir.clone().unwrap();
    let recovery = launch.recovery_path.clone();
    let output = launch.output_ass_path.clone();
    fs::write(&output, "preserve unconfirmed ASS").unwrap();
    host.start(launch, gate.reserve().unwrap()).unwrap();
    let record = host
        .inner
        .jobs
        .lock()
        .unwrap()
        .get("unconfirmed")
        .unwrap()
        .clone();
    let owned = record.process_job.as_ref().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while owned.active().unwrap() < 3 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    owned.fail_reap.store(true, Ordering::Relaxed);
    let began = Instant::now();
    assert!(host
        .cancel("unconfirmed")
        .unwrap_err()
        .contains("worker_job_failed"));
    assert!(began.elapsed() < Duration::from_secs(2));
    assert_eq!(owned.active().unwrap(), 0);
    let job = record.inner.lock().unwrap();
    assert!(job.worker_exited && job.reap_retry && !job.reaped && job.pid.is_some());
    assert!(job.cleanup_pending && gate.has_active() && work.exists());
    drop(job);
    let result = host.snapshot("unconfirmed", true).unwrap().unwrap();
    assert_eq!(result["status"], "cancelled");
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(&recovery).unwrap()).unwrap(),
        result
    );
    owned.fail_reap.store(false, Ordering::Relaxed);
    host.cancel("unconfirmed").unwrap();
    assert!(host.is_reaped("unconfirmed") && !gate.has_active() && !work.exists());
    assert_eq!(host.snapshot("unconfirmed", true).unwrap().unwrap(), result);
    assert_eq!(
        fs::read_to_string(output).unwrap(),
        "preserve unconfirmed ASS"
    );
}

#[cfg(windows)]
#[test]
fn qwen_cli_early_start_failures_retain_cleanup_ownership() {
    use std::os::windows::fs::OpenOptionsExt;
    let _guard = FAKE_WORKER_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(worker) = std::env::var_os("HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER") else {
        return;
    };
    for mode in ["spawn", "reservation", "pre-spawn-locked"] {
        let temp = tempfile::tempdir().unwrap();
        let gate = Arc::new(ActiveJobGate::default());
        let invalid = temp.path().join("invalid.exe");
        fs::write(&invalid, "not an executable").unwrap();
        let host = NativeAsrHost::new(
            if mode == "spawn" {
                invalid
            } else {
                PathBuf::from(&worker)
            },
            vec![],
            Arc::clone(&gate),
        )
        .unwrap();
        let launch = qwen_launch(
            &temp,
            mode,
            qwen_fixture_roles(&temp, "success"),
            None,
            "cpu",
        );
        let work = launch.cli_work_dir.clone().unwrap();
        let recovery = launch.recovery_path.clone();
        let output = launch.output_ass_path.clone();
        fs::write(&output, "preserve early ASS").unwrap();
        let reservation = gate.reserve().unwrap();
        if mode == "pre-spawn-locked" {
            // Same childless finalizer used by spawn/reservation errors; a real
            // delete-denying handle exercises its failure, not a mocked delete.
            fs::create_dir(&work).unwrap();
            fs::write(work.join("result.json"), "synthetic private output").unwrap();
            let held = fs::OpenOptions::new()
                .read(true)
                .share_mode(3)
                .open(work.join("result.json"))
                .unwrap();
            let mut record =
                JobRecord::new(&launch, None, host.inner.limits.max_replacement_segments);
            record.process_job = Some(Arc::new(worker_job::WorkerJob::new().unwrap()));
            let record = Arc::new(record);
            host.inner
                .jobs
                .lock()
                .unwrap()
                .insert(mode.into(), record.clone());
            reservation.activate(mode).unwrap();
            assert_eq!(
                finish_aborted_job(
                    &record,
                    &gate,
                    ProtocolFailure::new("worker_spawn_failed", "Failed to start ASR worker"),
                    None,
                )
                .unwrap_err(),
                "无法清理 ASR 私有结果"
            );
            assert!(host.is_reaped(mode) && !gate.has_active() && work.exists());
            assert!(host.cancel(mode).is_err());
            drop(held);
            host.cancel(mode).unwrap();
        } else {
            if mode == "reservation" {
                gate.clear();
            }
            assert!(host.start(launch, reservation).is_err());
        }
        let record = host.inner.jobs.lock().unwrap().get(mode).unwrap().clone();
        let job = record.inner.lock().unwrap();
        assert!(job.pid.is_none() && job.reaped && !job.cleanup_pending);
        assert_eq!(record.process_job.as_ref().unwrap().active().unwrap(), 0);
        assert!(!work.exists() && !gate.has_active());
        drop(job);
        let result = host.snapshot(mode, true).unwrap().unwrap();
        assert_eq!(result["status"], "failed");
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&recovery).unwrap()).unwrap(),
            result
        );
        assert_eq!(fs::read_to_string(output).unwrap(), "preserve early ASS");
        host.cancel(mode).unwrap();
        let next = qwen_launch(
            &temp,
            "reopen",
            qwen_fixture_roles(&temp, "success"),
            None,
            "cpu",
        );
        let next_host =
            NativeAsrHost::new(PathBuf::from(&worker), vec![], Arc::clone(&gate)).unwrap();
        next_host.start(next, gate.reserve().unwrap()).unwrap();
        assert_eq!(wait_terminal(&next_host, "reopen")["status"], "completed");
    }
}

#[cfg(windows)]
#[test]
fn qwen_cli_empty_job_does_not_confirm_an_unassigned_live_worker() {
    use std::os::windows::process::CommandExt;
    let _guard = FAKE_WORKER_TEST_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(worker) = std::env::var_os("HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER") else {
        return;
    };
    let temp = tempfile::tempdir().unwrap();
    let gate = Arc::new(ActiveJobGate::default());
    let launch = qwen_launch(
        &temp,
        "unassigned",
        qwen_fixture_roles(&temp, "success"),
        None,
        "cpu",
    );
    fs::create_dir(launch.cli_work_dir.as_ref().unwrap()).unwrap();
    let mut child = hidden_command(&worker)
        .creation_flags(crate::process::CREATE_NO_WINDOW | 0x4)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut record = JobRecord::new(
        &launch,
        Some(child.id()),
        ProtocolLimits::load().unwrap().max_replacement_segments,
    );
    record.process_job = Some(Arc::new(worker_job::WorkerJob::new().unwrap()));
    let record = Arc::new(record);
    gate.reserve().unwrap().activate("unassigned").unwrap();
    assert!(child.try_wait().unwrap().is_none());
    assert_eq!(record.process_job.as_ref().unwrap().active().unwrap(), 0);
    let confirmation = reap_processes(&record, TERMINATION_TIMEOUT);
    // Always terminate our suspended test worker before assertions can unwind.
    let cleanup = abort_spawned_job(
        &record,
        &mut child,
        &gate,
        ProtocolFailure::new(
            "worker_job_failed",
            "Failed to constrain ASR worker lifetime",
        ),
    );
    assert!(confirmation.is_err());
    cleanup.unwrap();
    assert!(child.try_wait().unwrap().is_some());
    assert!(record.inner.lock().unwrap().reaped && !gate.has_active());
    assert!(!launch.cli_work_dir.as_ref().unwrap().exists());
}
