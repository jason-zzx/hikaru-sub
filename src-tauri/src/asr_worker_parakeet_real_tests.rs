// P2 model-backed seam only. The external runner owns model.lock, process inventory
// and the shared durable CUDA attempt/sentinel; product commands never read this key.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ParakeetCliHostInputs {
    schema: String,
    engine: String,
    device: String,
    case: String,
    worker: LockedCrispAsrPath,
    runtime: Vec<LockedCrispAsrPath>,
    model: LockedCrispAsrPath,
    aligner: Option<LockedCrispAsrPath>,
    vad: LockedCrispAsrPath,
    audio: LockedCrispAsrPath,
    evidence_dir: PathBuf,
}

#[test]
fn parakeet_cli_real_host_case() {
    let path = std::env::var_os("HIKARU_ASR_PARAKEET_CLI_HOST_INPUTS");
    let required = std::env::var_os("HIKARU_ASR_PARAKEET_CLI_HOST_REQUIRED");
    let Some(path) = path else {
        assert!(required.is_none());
        return;
    };
    assert_eq!(required.as_deref(), Some(std::ffi::OsStr::new("1")));
    let _guard = FAKE_WORKER_TEST_LOCK
        .try_lock()
        .expect("model-backed calls must be serial");
    let input: ParakeetCliHostInputs = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(input.schema, "parakeet-p2-full-cli-host-v1");
    assert!(matches!(input.device.as_str(), "cpu" | "cuda"));
    assert!(matches!(
        input.case.as_str(),
        "short"
            | "medium"
            | "long"
            | "silence"
            | "cancel"
            | "invalid-vad"
            | "invalid-model"
            | "invalid-audio"
    ));
    assert!(matches!(input.engine.as_str(), "parakeet" | "qwen3-asr"));
    assert_eq!(input.aligner.is_some(), input.engine == "qwen3-asr");
    for locked in [&input.worker, &input.model, &input.vad, &input.audio]
        .into_iter()
        .chain(input.aligner.iter())
        .chain(input.runtime.iter())
    {
        reject_link_path(&locked.path).unwrap();
        assert_eq!(fs::metadata(&locked.path).unwrap().len(), locked.size_bytes);
        assert_eq!(sha256_file_for_test(&locked.path), locked.sha256);
    }
    assert_eq!(
        input.model.sha256,
        if input.engine == "parakeet" {
            "374eb0132eebaec4df77a9631cbbeb03790be48a4a517f6cc8e8bdb38fe9a584"
        } else {
            "ec197cef7ccc589fdcae1becc3f4a3de119d0a41e790b898b519b1a048dad8d4"
        }
    );
    assert_eq!(
        input.vad.sha256,
        "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"
    );
    assert_eq!(
        input.audio.sha256,
        match input.case.as_str() {
            "medium" => "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458",
            "long" => "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e",
            _ => "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211",
        }
    );
    if let Some(aligner) = &input.aligner {
        assert_eq!(
            aligner.sha256,
            "a7bb4cbeacc6414f11a5d23dc7661a51a941a71e6d559dc7b408b52473f2ae84"
        );
    }
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
    assert_eq!(expected.len(), if input.device == "cpu" { 6 } else { 9 });
    assert_eq!(
        fs::read_dir(&root)
            .unwrap()
            .map(|v| v.unwrap().path().canonicalize().unwrap())
            .collect::<HashSet<_>>(),
        expected
    );
    fs::create_dir(&input.evidence_dir).unwrap();
    let temp = tempfile::tempdir().unwrap();
    let gate = Arc::new(ActiveJobGate::default());
    let host = NativeAsrHost::new(input.worker.path.clone(), vec![], Arc::clone(&gate)).unwrap();
    let model_id = if input.engine == "parakeet" {
        "nvidia/parakeet-tdt_ctc-0.6b-ja"
    } else {
        "Qwen/Qwen3-ASR-1.7B"
    };
    let mut inputs = vec![input.model.path.clone()];
    if let Some(aligner) = &input.aligner {
        inputs.push(aligner.path.clone());
    }
    inputs.push(input.vad.path.clone());
    let model = tokio::runtime::Runtime::new().unwrap().block_on(
        crate::asr_models::resolve_full_cli_delivery_test_model(
            &temp.path().join("中文 deps"),
            &input.engine,
            model_id,
            &inputs,
        ),
    );
    let cache = temp.path().join("中文 缓存");
    let workspace = cache.join("workspace/中文 工作区");
    fs::create_dir_all(&workspace).unwrap();
    let audio = workspace.join("audio.wav");
    fs::copy(&input.audio.path, &audio).unwrap();
    assert_eq!(sha256_file_for_test(&audio), input.audio.sha256);
    if input.case == "silence" {
        write_silent_pcm16_wav(&audio, 3_000);
    }
    if input.case == "invalid-audio" {
        fs::write(&audio, b"invalid audio").unwrap();
    }
    for (case, role) in [("invalid-vad", "vad"), ("invalid-model", "model")] {
        if input.case == case {
            let path = &model.roles.iter().find(|(r, _)| r == role).unwrap().1;
            assert!(path.starts_with(temp.path()));
            fs::write(path, b"invalid model").unwrap();
        }
    }
    let args = serde_json::json!({"engine":input.engine,"model":model_id,"device":input.device,
        "audioPath":audio,"outputAssPath":temp.path().join("result.ass"),"useVad":false,"vadConfig":null});
    let capture = Arc::new(Mutex::new(Vec::new()));
    let mut launch = crate::asr::qualified_native_launch(
        serde_json::from_value(args).unwrap(),
        model,
        "p2-real".into(),
        input.device.clone(),
        cache,
    )
    .unwrap();
    launch.capture_cli_result = Some(Arc::clone(&capture));
    let output = launch.output_ass_path.clone();
    let recovery = launch.recovery_path.clone();
    let work = launch.cli_work_dir.clone().unwrap();
    fs::write(&output, "preserve prior ASS").unwrap();
    let began = Instant::now();
    host.start(launch, gate.reserve().unwrap()).unwrap();
    let mut previous = 0;
    let mut cancelled = false;
    let mut cancel_seconds = None;
    let mut first_cancel_error = None;
    let mut last_progress = Instant::now();
    loop {
        let snapshot = host.snapshot("p2-real", true).unwrap().unwrap();
        let processed = snapshot["processedMs"].as_i64().unwrap();
        if processed > previous {
            // Actual host processed progress only, never arbitrary heartbeat text.
            eprintln!(
                "hikaru_slice: completed={} total={}",
                processed,
                snapshot["durationMs"].as_i64().unwrap()
            );
            previous = processed;
            last_progress = Instant::now();
            if input.case == "cancel" && !cancelled {
                let start = Instant::now();
                let first = host.cancel("p2-real");
                cancel_seconds = Some(start.elapsed().as_secs_f64());
                let record = host
                    .inner
                    .jobs
                    .lock()
                    .unwrap()
                    .get("p2-real")
                    .unwrap()
                    .clone();
                let job = record.inner.lock().unwrap();
                fs::write(input.evidence_dir.join("cancel-first-attempt.json"), serde_json::to_vec_pretty(&serde_json::json!({
                    "error":first.as_ref().err(),"elapsedSeconds":cancel_seconds,"pid":job.pid,"reaped":job.reaped,
                    "cleanupPending":job.cleanup_pending,"gateActive":gate.has_active(),"ownedProcesses":record.process_job.as_ref().unwrap().active().unwrap()
                })).unwrap()).unwrap();
                assert!(job.reaped && job.pid.is_none() && !gate.has_active());
                if let Err(error) = first {
                    assert_eq!(error, "无法清理 ASR 私有结果");
                    assert!(job.cleanup_pending);
                    first_cancel_error = Some(error);
                }
                drop(job);
                // Same bounded cleanup retry as Qwen; physical exit is not deletion.
                if first_cancel_error.is_some() {
                    std::thread::sleep(Duration::from_millis(100));
                }
                host.cancel("p2-real").unwrap();
                cancelled = true;
            }
        }
        if host.is_reaped("p2-real") {
            break;
        }
        assert!(
            last_progress.elapsed() < Duration::from_secs(130),
            "outer runner/worker watchdog must bound execution"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    let result = wait_terminal(&host, "p2-real");
    fs::write(
        input.evidence_dir.join("snapshot.json"),
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .unwrap();
    fs::copy(&recovery, input.evidence_dir.join("recovery.json")).unwrap();
    fs::copy(&output, input.evidence_dir.join("result.ass")).unwrap();
    fs::write(
        input.evidence_dir.join("cli-result.json"),
        &*capture.lock().unwrap(),
    )
    .unwrap();
    let trace = host.event_trace("p2-real");
    let record = host
        .inner
        .jobs
        .lock()
        .unwrap()
        .get("p2-real")
        .unwrap()
        .clone();
    assert!(record.inner.lock().unwrap().pid.is_none());
    assert_eq!(record.process_job.as_ref().unwrap().active().unwrap(), 0);
    assert!(!gate.has_active() && !work.exists());
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(recovery).unwrap()).unwrap(),
        result
    );
    let failed = input.case.starts_with("invalid-");
    let expected_status = if input.case == "cancel" {
        "cancelled"
    } else if failed {
        "failed"
    } else {
        "completed"
    };
    assert_eq!(result["status"], expected_status);
    if input.case == "cancel" || failed {
        if input.case == "cancel" {
            assert!(cancelled && cancel_seconds.unwrap() < 2.0);
        }
        assert_eq!(fs::read_to_string(output).unwrap(), "preserve prior ASS");
        assert!(!trace
            .event_kinds
            .contains(&TestWorkerEventKind::SegmentsReplace));
        if failed {
            let error = result["error"].as_str().unwrap();
            assert!(error.starts_with("[parakeet_cli_") || error.starts_with("[qwen_cli_"));
            assert!(
                !error.contains(temp.path().to_str().unwrap()) && !error.contains("invalid model")
            );
        }
    } else if input.case == "silence" {
        assert_eq!(result["segmentCount"], 0);
        assert_eq!(fs::read_to_string(output).unwrap(), "preserve prior ASS");
    } else {
        let replacement = trace
            .event_kinds
            .iter()
            .position(|v| *v == TestWorkerEventKind::SegmentsReplace)
            .unwrap();
        assert_eq!(
            &trace.event_kinds[replacement..],
            &[
                TestWorkerEventKind::SegmentsReplace,
                TestWorkerEventKind::Completed
            ]
        );
        assert!(result["segmentCount"].as_u64().unwrap() > 0);
        assert_ass_dialogues_match_replacement(&output, &result["segments"]);
        assert_eq!(
            fs::read_to_string(output)
                .unwrap()
                .lines()
                .filter(|v| v.starts_with("Dialogue:"))
                .count(),
            result["segmentCount"].as_u64().unwrap() as usize
        );
    }
    let summary = serde_json::json!({"device":input.device,"engine":input.engine,"case":input.case,
        "status":expected_status,"elapsedSeconds":began.elapsed().as_secs_f64(),"cancelSeconds":cancel_seconds,
        "segmentCount":result["segmentCount"],"activeGateReleased":true,"privateWorkRemoved":true,
        "processTreeReaped":true,"recoveryMatches":true,"priorAssPreserved":input.case=="cancel" || failed || input.case=="silence",
        "atomicReplacement":matches!(input.case.as_str(), "short" | "medium" | "long"),
        "firstCancelError":first_cancel_error,"managedExactModelAndVad":true,
        "workerSha256":input.worker.sha256});
    fs::write(
        input.evidence_dir.join("summary.json"),
        serde_json::to_vec_pretty(&summary).unwrap(),
    )
    .unwrap();
}
