Json execution_parity_runtime_files(
    const fs::path& executable,
    const std::string& runtime_role) {
  std::vector<std::string> expected{
      "ctranslate2.dll",
      "hikaru-asr-ctranslate2-tests.exe",
      "hikaru_asr_tokenizer.dll",
      "onnxruntime.dll",
      "onnxruntime_providers_shared.dll",
      "silero_vad_v6.onnx"};
  if (runtime_role == "python-wheel") {
    expected.push_back("cudnn64_9.dll");
    expected.push_back("libiomp5md.dll");
  }
  std::sort(expected.begin(), expected.end());

  Json files = Json::array();
  std::vector<std::string> actual;
  for (const fs::directory_entry& entry : fs::directory_iterator(executable.parent_path())) {
    check(entry.is_regular_file(), "T06D runtime root contains a non-file entry");
    const std::string name = entry.path().filename().u8string();
    actual.push_back(name);
    Json identity = file_identity(entry.path());
    identity["name"] = name;
    files.push_back(std::move(identity));
  }
  std::sort(actual.begin(), actual.end());
  check(actual == expected, "T06D isolated runtime file set drifted");
  std::sort(files.begin(), files.end(), [](const Json& left, const Json& right) {
    return lowercase(left.at("name").get<std::string>())
        < lowercase(right.at("name").get<std::string>());
  });
  return files;
}

void validate_execution_parity_modules(
    const Json& modules,
    const std::string& runtime_role,
    bool generation_reached) {
  const auto has_module = [&](const std::string& name) {
    return std::any_of(modules.begin(), modules.end(), [&](const Json& module) {
      return lowercase(module.at("name").get<std::string>()) == lowercase(name);
    });
  };
  check(has_module("ctranslate2.dll")
            && has_module("hikaru-asr-ctranslate2-tests.exe")
            && has_module("hikaru_asr_tokenizer.dll")
            && has_module("onnxruntime.dll")
            && has_module("nvcuda.dll"),
        "T06D required loaded module is missing");
  if (runtime_role == "python-wheel") {
    check(has_module("libiomp5md.dll") && !has_module("vcomp140.dll"),
          "T06D Python-wheel OpenMP module family drifted");
  } else {
    check(has_module("vcomp140.dll")
              && !has_module("libiomp5md.dll")
              && !has_module("cudnn64_9.dll"),
          "T06D native no-cuDNN module family drifted");
  }
  if (generation_reached) {
    check(has_module("cublas64_12.dll") && has_module("cublasLt64_12.dll"),
          "T06D generation did not load the CUDA BLAS boundary");
  }
}

void write_execution_parity_json(const fs::path& path, const Json& value) {
  check(is_t06d_task_local_output(path), "T06D JSON output must stay under research/local");
  fs::create_directories(path.parent_path());
  const fs::path temporary = path.string() + ".tmp";
  std::ofstream(temporary, std::ios::binary | std::ios::trunc) << std::setw(2) << value << '\n';
  fs::remove(path);
  fs::rename(temporary, path);
}

Json read_execution_parity_contract(const fs::path& path, const std::string& expected_sha256) {
  check(is_t06d_task_local_output(path) && fs::is_regular_file(path),
        "T06D model contract must stay under research/local");
  check(sha256_file(path) == expected_sha256, "T06D model contract hash drifted");
  Json contract = Json::parse(read_text_file(path), nullptr, false);
  check(contract.is_object()
            && contract.value("kind", "") == "hikaru-whisper-execution-parity-model-contract"
            && !contract.value("qualificationEligible", true)
            && !contract.value("promotionEligible", true)
            && contract.value("nMels", 0) == 128,
        "T06D model contract identity drifted");
  return contract;
}

void validate_execution_parity_model(const fs::path& model_path) {
  check(is_t06d_task_local_output(model_path)
            && fs::is_directory(model_path)
            && fs::is_regular_file(model_path / "model.bin")
            && sha256_file(model_path / "model.bin")
                == "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1",
        "T06D exact task-local large-v3 model identity drifted");
}

void validate_execution_parity_runtime(
    const WhisperExecutionParityCell& cell,
    const fs::path& executable) {
  const fs::path ct2 = executable.parent_path() / "ctranslate2.dll";
  check(is_t06d_task_local_output(executable)
            && fs::is_regular_file(ct2)
            && sha256_file(ct2) == cell.runtime_sha256,
        "T06D process-start CTranslate2 runtime identity drifted");
}

Json execution_parity_native_parser(const TranscriptionResult& result) {
  Json timeline = Json::array();
  std::string text;
  for (const SegmentEvidence& segment : result.segments) {
    text += segment.segment.text;
    timeline.push_back(Json{{"startMs", segment.segment.start_ms}, {"endMs", segment.segment.end_ms}});
  }
  return Json{
      {"segmentCount", result.segments.size()},
      {"textSha256", sha256_text(text)},
      {"timelineSha256", sha256_text(timeline.dump())},
      {"timelineErrorCount", result.failure_code.empty() ? 0 : 1}};
}

void run_execution_parity_self_check(const std::vector<std::string>& args) {
  validate_closed_mode_args(args, "--execution-parity-self-check", {});
  const auto cells = whisper_execution_parity_cells();
  check(cells.size() == 4
            && cells[0].id == "python-runtime-python-mel"
            && cells[1].id == "python-runtime-native-mel"
            && cells[2].id == "native-runtime-python-mel"
            && cells[3].id == "native-runtime-native-mel",
        "T06D execution-parity cell order drifted");
  check(128 * max_model_frames * sizeof(float) == 1536000,
        "T06D large-v3 Mel byte contract drifted");
  const CandidateAConfig config = execution_parity_config();
  check(config.beam_size == 5 && config.condition_on_previous_text
            && config.timestamp_driven_seek && !config.upstream_generation_fallback
            && config.temperature == 0.0f,
        "T06D first-attempt config drifted");
  validate_closed_mode_args(
      {"--execution-parity-contract", "--runtime-role", "python-wheel",
       "--model", "model", "--output", "output"},
      "--execution-parity-contract", {"--runtime-role", "--model", "--output"});
  validate_closed_mode_args(
      {"--run-whisper-execution-parity", "--cell", cells[0].id,
       "--model", "model", "--mel", "mel", "--mel-sha256", std::string(64, 'a'),
       "--model-contract", "contract", "--model-contract-sha256", std::string(64, 'b'),
       "--output", "output", "--repeat-index", "1"},
      "--run-whisper-execution-parity",
      {"--cell", "--model", "--mel", "--mel-sha256", "--model-contract",
       "--model-contract-sha256", "--output", "--repeat-index"});
  std::cout << "ctranslate2 whisper execution parity tests passed\n";
}

void run_execution_parity_contract(const std::vector<std::string>& args) {
  validate_closed_mode_args(args, "--execution-parity-contract",
                            {"--runtime-role", "--model", "--output"});
  const std::string runtime_role = required_arg(args, "--runtime-role");
  check(runtime_role == "python-wheel" || runtime_role == "native-no-cudnn",
        "T06D runtime role is not allowed");
  const WhisperExecutionParityCell cell = whisper_execution_parity_cell(
      runtime_role == "python-wheel" ? "python-runtime-python-mel" : "native-runtime-native-mel");
  const fs::path model_path = fs::u8path(required_arg(args, "--model"));
  const fs::path output_path = fs::u8path(required_arg(args, "--output"));
  validate_execution_parity_model(model_path);
  const fs::path executable = current_executable();
  validate_execution_parity_runtime(cell, executable);
  const Json path_policy = cuda_development_path_policy();
  const Clock::time_point load_started = Clock::now();
  CTranslate2WhisperBackend backend(
      model_path, execution_parity_config(), std::nullopt, cuda_execution_config());
  const double load_ms = elapsed_ms(load_started);
  check(backend.mel_bins() == 128, "T06D exact large-v3 model did not report 128 Mel bins");
  const BackendExecutionAttestation attestation = backend.execution_attestation();
  Json modules = cuda_development_loaded_modules(path_policy);
  validate_execution_parity_modules(modules, runtime_role, false);
  const Json contract{
      {"schemaVersion", 1},
      {"kind", "hikaru-whisper-execution-parity-model-contract"},
      {"status", "completed"},
      {"qualificationEligible", false},
      {"promotionEligible", false},
      {"runtimeRole", runtime_role},
      {"nMels", backend.mel_bins()},
      {"shape", Json::array({backend.mel_bins(), max_model_frames})},
      {"dtype", "float32-le"},
      {"model", Json{{"id", "Systran/faster-whisper-large-v3"},
                      {"revision", "edaa852ec7e145841d8ffdb056a99866b5f0a478"},
                      {"files", model_file_identities(model_path)}}},
      {"runtime", Json{{"measurementExecutable", file_identity(executable)},
                        {"ctranslate2", file_identity(executable.parent_path() / "ctranslate2.dll")},
                        {"runtimeFiles", execution_parity_runtime_files(executable, runtime_role)},
                        {"requestedDevice", "cuda"}, {"resolvedDevice", "cuda"},
                        {"computeType", "float16"}, {"deviceIndex", 0},
                        {"ctranslate2Version", "4.8.0"}, {"pathPolicy", path_policy},
                        {"loadedModules", std::move(modules)}}},
      {"modelConstructionReached", true},
      {"generationBoundaryReached", false},
      {"loadMs", load_ms},
      {"attestedVisibleDeviceCount", attestation.visible_device_count}};
  write_execution_parity_json(output_path, contract);
  std::cout << Json{{"status", "completed"}, {"runtimeRole", runtime_role},
                    {"nMels", backend.mel_bins()}}.dump() << '\n';
}

void export_execution_parity_native_mel(const std::vector<std::string>& args) {
  validate_closed_mode_args(args, "--execution-parity-native-mel",
      {"--audio", "--model", "--model-contract", "--model-contract-sha256", "--output"});
  const fs::path audio_path = fs::u8path(required_arg(args, "--audio"));
  const fs::path model_path = fs::u8path(required_arg(args, "--model"));
  const fs::path contract_path = fs::u8path(required_arg(args, "--model-contract"));
  const std::string contract_sha = required_arg(args, "--model-contract-sha256");
  const fs::path output_path = fs::u8path(required_arg(args, "--output"));
  check(is_t06d_task_local_output(audio_path) && fs::is_regular_file(audio_path)
            && sha256_file(audio_path)
                == "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211"
            && verified_wav_duration_ms(audio_path) == 24102,
        "T06D task-local short-v1 WAV identity drifted");
  validate_execution_parity_model(model_path);
  const Json contract = read_execution_parity_contract(contract_path, contract_sha);
  check(contract.value("runtimeRole", "") == "native-no-cudnn",
        "T06D native Mel requires the native model contract");
  validate_execution_parity_runtime(
      whisper_execution_parity_cell("native-runtime-native-mel"), current_executable());
  CTranslate2WhisperBackend backend(
      model_path, execution_parity_config(), std::nullopt, cuda_execution_config());
  check(backend.mel_bins() == contract.at("nMels").get<int>() && backend.mel_bins() == 128,
        "T06D native Mel model contract drifted");
  const wav::Audio audio = wav::read_pcm16_mono_16khz(audio_path);
  check(audio.samples.size() == 385637, "T06D short-v1 sample count drifted");
  const std::vector<float> mel = official_log_mel_for_test(
      audio.samples, backend.mel_bins(), 0,
      static_cast<int>(source_frame_count(audio.samples.size())));
  write_execution_parity_mel(output_path, mel, backend.mel_bins());
  std::cout << Json{{"status", "completed"}, {"producer", "native"},
                    {"shape", Json::array({backend.mel_bins(), max_model_frames})},
                    {"dtype", "float32-le"}, {"sizeBytes", fs::file_size(output_path)},
                    {"sha256", sha256_file(output_path)},
                    {"modelContractSha256", contract_sha}}.dump() << '\n';
}

void run_execution_parity_evidence(const std::vector<std::string>& args) {
  validate_closed_mode_args(args, "--run-whisper-execution-parity",
      {"--cell", "--model", "--mel", "--mel-sha256", "--model-contract",
       "--model-contract-sha256", "--output", "--repeat-index"});
  const WhisperExecutionParityCell cell = whisper_execution_parity_cell(required_arg(args, "--cell"));
  const fs::path model_path = fs::u8path(required_arg(args, "--model"));
  const fs::path mel_path = fs::u8path(required_arg(args, "--mel"));
  const std::string mel_sha = required_arg(args, "--mel-sha256");
  const fs::path contract_path = fs::u8path(required_arg(args, "--model-contract"));
  const std::string contract_sha = required_arg(args, "--model-contract-sha256");
  const fs::path output_path = fs::u8path(required_arg(args, "--output"));
  const int repeat_index = integer_arg(args, "--repeat-index", 1);
  check(repeat_index == 1 || repeat_index == 2, "T06D repeat index must be 1 or 2");
  validate_execution_parity_model(model_path);
  const fs::path executable = current_executable();
  validate_execution_parity_runtime(cell, executable);
  const Json contract = read_execution_parity_contract(contract_path, contract_sha);
  check(contract.value("runtimeRole", "") == cell.runtime_role,
        "T06D cell/runtime contract mapping drifted");
  const int mel_bins = contract.at("nMels").get<int>();
  std::vector<float> mel = read_execution_parity_mel(mel_path, mel_bins, mel_sha);
  const Json path_policy = cuda_development_path_policy();
  const Clock::time_point load_started = Clock::now();
  CTranslate2WhisperBackend backend(
      model_path, execution_parity_config(), std::nullopt, cuda_execution_config());
  const double load_ms = elapsed_ms(load_started);
  check(backend.mel_bins() == mel_bins && backend.mel_bins() == 128,
        "T06D generation model contract drifted");
  const Clock::time_point started = Clock::now();
  const TranscriptionResult result = backend.transcribe_precomputed_mel_for_test(
      std::move(mel), 385637, 24102);
  const double wall_ms = elapsed_ms(started);
  check(result.failure_code.empty() && result.traces.size() == 1
            && result.traces.front().generation_call_count == 1
            && result.traces.front().fallback_call_count == 0,
        "T06D generation did not reach the exact single-window boundary");
  Json segments = Json::array();
  for (const SegmentEvidence& segment : result.segments) segments.push_back(segment_json(segment));
  Json traces = Json::array();
  for (const WindowTrace& trace : result.traces) traces.push_back(trace_json(trace));
  Json modules = cuda_development_loaded_modules(path_policy);
  validate_execution_parity_modules(modules, cell.runtime_role, true);
  Json parity_config = config_json(execution_parity_config());
  parity_config["vad"] = false;
  parity_config["language"] = "ja";
  parity_config["sampleRate"] = sample_rate;
  const Json raw{
      {"schemaVersion", 1}, {"kind", "hikaru-whisper-execution-parity-raw"},
      {"status", "completed"}, {"qualificationEligible", false},
      {"promotionEligible", false}, {"cellId", cell.id},
      {"repeatIndex", repeat_index}, {"caseId", "short-v1"},
      {"modelContractSha256", contract_sha}, {"nMels", mel_bins},
      {"mel", Json{{"producer", cell.mel_role},
                    {"shape", Json::array({mel_bins, max_model_frames})},
                    {"dtype", "float32-le"},
                    {"sizeBytes", mel_bins * max_model_frames * sizeof(float)},
                    {"sha256", mel_sha}}},
      {"audio", Json{{"wavSha256", "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211"},
                      {"waveformSha256", "2cbf22e7635a41cf751401525e4358c19f2d452ae99c0ced78f65b6e9327e1c2"},
                      {"sampleCount", 385637}, {"durationMs", 24102}}},
      {"config", std::move(parity_config)},
      {"decodeIdentity", Json{
           {"promptTokenIds", Json::array({50258, 50266, 50360})},
           {"promptSha256", "908b1562c473b2889d6ac86c6e011ec4c681f6e78c971f0d8e73424057a42ba0"},
           {"suppressedTokenCount", 88},
           {"suppressedTokenIdsSha256", "f726fbe0a6dca45caa2028ac3584464684710a51040e1d1da176271c22184a6c"},
           {"beginSuppressedTokenIds", Json::array({220, 50257})},
           {"beginSuppressedTokenIdsSha256", "5361010e57b1f08ec8360f097ea3063cf72e41f048203f694631e36bdd569a98"},
           {"parser", "native-timestamp-parser-v1"},
           {"generation", "temperature-0-first-attempt"}}},
      {"selectedTemperature", 0.0},
      {"generationCallCount", 1},
      {"fallbackCallCount", 0},
      {"fallbackTriggerSequence", Json::array()},
      {"runtime", Json{{"role", cell.runtime_role},
                        {"measurementExecutable", file_identity(executable)},
                        {"ctranslate2", file_identity(executable.parent_path() / "ctranslate2.dll")},
                        {"runtimeFiles", execution_parity_runtime_files(executable, cell.runtime_role)},
                        {"pathPolicy", path_policy}, {"loadedModules", std::move(modules)},
                        {"generationBoundaryReached", true}}},
      {"segments", std::move(segments)}, {"tokenTraces", std::move(traces)},
      {"nativeParser", execution_parity_native_parser(result)},
      {"timings", Json{{"loadMs", load_ms}, {"sampleWallMs", wall_ms},
                        {"modelGenerateMs", result.generate_ms},
                        {"inferenceMs", result.inference_ms}}},
      {"resources", Json{{"peakProcessRssBytes", peak_working_set()},
                          {"method", "GetProcessMemoryInfo.PeakWorkingSetSize"}}}};
  write_execution_parity_json(output_path, raw);
  std::cout << Json{{"status", "completed"}, {"cellId", cell.id},
                    {"repeatIndex", repeat_index}, {"nMels", mel_bins}}.dump() << '\n';
}
