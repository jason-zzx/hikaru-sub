// Model-backed test seam only. The external runner owns model.lock and process inventory;
// product commands never read this key.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ParakeetCliHostInputs {
    schema: String,
    engine: String,
    device: String,
    case: String,
    worker: LocalCrispAsrPath,
    runtime: Vec<LocalCrispAsrPath>,
    model: LocalCrispAsrPath,
    aligner: Option<LocalCrispAsrPath>,
    vad: LocalCrispAsrPath,
    audio: LocalCrispAsrPath,
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
    assert!(matches!(
        input.engine.as_str(),
        "parakeet" | "reazonspeech-nemo" | "qwen3-asr"
    ));
    assert!(
        !(input.engine == "qwen3-asr" && input.case == "cancel"),
        "use qwen_cli_final_manager_host_functional_case with deliveryCase=cancel-reopen for Qwen cancellation"
    );
    assert_eq!(input.aligner.is_some(), input.engine == "qwen3-asr");
    for locked in [&input.worker, &input.model, &input.vad, &input.audio]
        .into_iter()
        .chain(input.aligner.iter())
        .chain(input.runtime.iter())
    {
        reject_link_path(&locked.path).unwrap();
        assert!(locked.path.is_file());
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
    let model_id = match input.engine.as_str() {
        "parakeet" => "nvidia/parakeet-tdt_ctc-0.6b-ja",
        "reazonspeech-nemo" => "reazon-research/reazonspeech-nemo-v2",
        _ => "Qwen/Qwen3-ASR-1.7B",
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
    assert!(audio.is_file());
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
        "workerPath":input.worker.path});
    fs::write(
        input.evidence_dir.join("summary.json"),
        serde_json::to_vec_pretty(&summary).unwrap(),
    )
    .unwrap();
}
