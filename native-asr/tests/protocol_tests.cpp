#include <hikaru_asr/protocol.hpp>

#include <nlohmann/json.hpp>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#endif

namespace {

using Json = nlohmann::json;
using namespace hikaru_asr;

void check(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

Json base_request(const std::string& engine = "faster-whisper",
                  const std::string& backend = "ctranslate2",
                  const std::string& device = "cpu") {
  return Json{{"protocolVersion", 1},
              {"jobId", "job-protocol-test"},
              {"engine", engine},
              {"backend", backend},
              {"modelPaths", Json::array({Json{{"role", "model"}, {"path", "C:\\models\\model.bin"}}})},
              {"audioPath", "C:\\audio\\input.wav"},
              {"device", device},
              {"language", "ja"},
              {"useVad", false}};
}

bool parse_request(const Json& json, WorkerRequestV1& request, ProtocolError& error) {
  return parse_request_line(json.dump(), request, error);
}

EventV1 parse_event(const std::string& line) {
  EventV1 event;
  ProtocolError error;
  check(parse_event_line(line, event, error), "event parse failed: " + error.code);
  return event;
}

void expect_request_error(const Json& value, const std::string& code) {
  WorkerRequestV1 request;
  ProtocolError error;
  check(!parse_request(value, request, error), "request unexpectedly passed");
  check(error.code == code, "unexpected request error: " + error.code + ", expected " + code);
}

void test_limits_source() {
  std::ifstream input(HIKARU_ASR_LIMITS_PATH, std::ios::binary);
  check(input.good(), "canonical limits file is missing");
  const Json json = Json::parse(input);
  check(json.at("protocolVersion") == limits::protocol_version, "protocol version drift");
  check(json.at("maxRequestLineBytes") == limits::max_request_line_bytes, "request limit drift");
  check(json.at("maxEventLineBytes") == limits::max_event_line_bytes, "event limit drift");
  check(json.at("maxJobIdBytes") == limits::max_job_id_bytes, "job limit drift");
  check(json.at("maxPathBytes") == limits::max_path_bytes, "path limit drift");
  check(json.at("maxTextBytes") == limits::max_text_bytes, "text limit drift");
  check(json.at("maxModelEntries") == limits::max_model_entries, "model count drift");
  check(json.at("maxReplacementSegments") == limits::max_replacement_segments,
        "replacement count drift");
  check(json.at("maxStderrDiagnosticBytes") == limits::max_stderr_diagnostic_bytes,
        "stderr limit drift");
}

void test_requests() {
  const struct Route {
    const char* engine;
    const char* backend;
    const char* device;
    bool aligner;
  } routes[] = {{"faster-whisper", "ctranslate2", "cpu", false},
                {"kotoba-faster-whisper", "ctranslate2", "cuda", false},
                {"parakeet", "crispasr", "vulkan", false},
                {"reazonspeech-nemo", "crispasr", "cpu", false},
                {"qwen3-asr", "crispasr", "cuda", true}};

  for (const auto& route : routes) {
    Json json = base_request(route.engine, route.backend, route.device);
    if (route.aligner) {
      json["modelPaths"].push_back(Json{{"role", "aligner"}, {"path", "C:\\models\\aligner.bin"}});
    }
    json["futureField"] = Json{{"ignored", true}};
    WorkerRequestV1 request;
    ProtocolError error;
    check(parse_request(json, request, error), std::string("valid route failed: ") + route.engine + ":" + error.code);
  }

  Json qwen = base_request("qwen3-asr", "crispasr");
  expect_request_error(qwen, "missing_model_role");
  qwen["modelPaths"].push_back(Json{{"role", "model"}, {"path", "C:\\models\\duplicate.bin"}});
  expect_request_error(qwen, "duplicate_model_role");

  Json invalid = base_request();
  invalid["modelPaths"][0]["role"] = "companion";
  expect_request_error(invalid, "unknown_model_role");
  invalid = base_request();
  invalid["audioPath"] = "relative\\audio.wav";
  expect_request_error(invalid, "invalid_local_path");
  invalid["audioPath"] = "https://example.invalid/audio.wav";
  expect_request_error(invalid, "invalid_local_path");
  invalid["audioPath"] = "\\\\.\\pipe\\hikaru-asr";
  expect_request_error(invalid, "invalid_local_path");
  invalid["audioPath"] = "C:\\audio\\input.wav:stream";
  expect_request_error(invalid, "invalid_local_path");
  invalid["audioPath"] = "C:\\audio\\*.wav";
  expect_request_error(invalid, "invalid_local_path");
  invalid = base_request();
  std::string nul_path = "C:\\audio";
  nul_path.push_back('\0');
  nul_path += "\\input.wav";
  invalid["audioPath"] = nul_path;
  expect_request_error(invalid, "invalid_local_path");
  invalid = base_request();
  invalid["device"] = "auto";
  expect_request_error(invalid, "unknown_device");
  invalid["device"] = "vulkan";
  expect_request_error(invalid, "invalid_device_for_route");
  invalid = base_request();
  invalid["backend"] = "crispasr";
  expect_request_error(invalid, "invalid_route");
  invalid = base_request();
  invalid["language"] = "en";
  expect_request_error(invalid, "invalid_language");

  Json vad = base_request();
  vad["useVad"] = true;
  vad["vadConfig"] = Json{{"threshold", 0.5},
                           {"minSpeechDurationMs", 500},
                           {"minSilenceDurationMs", 300},
                           {"speechPadMs", 400},
                           {"maxSegmentDurationMs", 25000},
                           {"futureVadField", 1}};
  WorkerRequestV1 request;
  ProtocolError error;
  check(parse_request(vad, request, error), "valid VAD failed: " + error.code);
  vad["vadConfig"]["threshold"] = 1.1;
  expect_request_error(vad, "invalid_vad_config");
  vad["vadConfig"]["threshold"] = 0.5;
  vad["vadConfig"]["maxSegmentDurationMs"] = 100;
  expect_request_error(vad, "invalid_vad_config");
  vad["vadConfig"]["maxSegmentDurationMs"] = 25000;
  vad["vadConfig"]["threshold"] = "NONFINITE";
  std::string nonfinite = vad.dump();
  const auto nonfinite_marker = nonfinite.find("\"NONFINITE\"");
  check(nonfinite_marker != std::string::npos, "non-finite fixture marker missing");
  nonfinite.replace(nonfinite_marker, std::string("\"NONFINITE\"").size(), "1e9999");
  check(!parse_request_line(nonfinite, request, error), "non-finite VAD number must fail");

  Json disabled_vad = base_request();
  disabled_vad["vadConfig"] = "ignored while disabled";
  check(parse_request(disabled_vad, request, error), "disabled VAD config must be ignored");

  Json job_boundary = base_request();
  job_boundary["jobId"] = std::string(limits::max_job_id_bytes, 'j');
  check(parse_request(job_boundary, request, error), "max jobId must pass");
  job_boundary["jobId"] = std::string(limits::max_job_id_bytes + 1, 'j');
  expect_request_error(job_boundary, "invalid_job_id");

  Json path_boundary = base_request();
  path_boundary["audioPath"] = "C:\\" + std::string(limits::max_path_bytes - 3, 'p');
  check(parse_request(path_boundary, request, error), "max path must pass");
  path_boundary["audioPath"] = "C:\\" + std::string(limits::max_path_bytes - 2, 'p');
  expect_request_error(path_boundary, "invalid_local_path");

  Json model_count = base_request();
  while (model_count["modelPaths"].size() < limits::max_model_entries + 1) {
    model_count["modelPaths"].push_back(Json{{"role", "model"}, {"path", "C:\\models\\x.bin"}});
  }
  expect_request_error(model_count, "invalid_model_paths");

  Json padded = base_request();
  padded["padding"] = "";
  std::string line = padded.dump();
  const auto marker = line.find("\"padding\":\"\"");
  check(marker != std::string::npos, "request padding marker missing");
  padded["padding"] = std::string(limits::max_request_line_bytes - line.size(), 'x');
  line = padded.dump();
  check(line.size() == limits::max_request_line_bytes, "request max-line fixture drift");
  check(parse_request_line(line, request, error), "max request line must pass");
  line.push_back(' ');
  check(!parse_request_line(line, request, error) && error.code == "request_line_too_large",
        "oversized request line must fail before parsing");

  std::string bom = "\xef\xbb\xbf" + base_request().dump();
  check(!parse_request_line(bom, request, error) && error.code == "request_bom", "request BOM must fail");
  std::string nul = base_request().dump();
  nul.insert(nul.begin() + 1, '\0');
  check(!parse_request_line(nul, request, error) && error.code == "request_contains_nul",
        "request NUL must fail");
  std::string invalid_utf8 = base_request().dump();
  const auto job_marker = invalid_utf8.find("job-protocol-test");
  check(job_marker != std::string::npos, "request UTF-8 fixture marker missing");
  invalid_utf8.replace(job_marker, 1, std::string("\xc3\x28", 2));
  check(!parse_request_line(invalid_utf8, request, error) &&
            error.code == "request_malformed_json",
        "invalid request UTF-8 must fail");
}

EventV1 ready_event(Backend backend = Backend::CTranslate2, Device device = Device::Cpu,
                    std::int64_t duration = 120000) {
  EventV1 event;
  event.type = EventType::Ready;
  event.backend = backend;
  event.device = device;
  event.duration_ms = duration;
  return event;
}

EventV1 progress_event(std::int64_t processed, std::int64_t duration = 120000) {
  EventV1 event;
  event.type = EventType::Progress;
  event.processed_ms = processed;
  event.duration_ms = duration;
  return event;
}

EventV1 segment_event(std::int64_t start, std::int64_t end, std::string text = "synthetic") {
  EventV1 event;
  event.type = EventType::Segment;
  event.segment = {start, end, std::move(text)};
  return event;
}

EventV1 completed_event(std::int64_t duration = 120000) {
  EventV1 event;
  event.type = EventType::Completed;
  event.duration_ms = duration;
  event.detected_language = "ja";
  return event;
}

EventV1 error_event() {
  EventV1 event;
  event.type = EventType::Error;
  event.code = "synthetic_failure";
  event.message = "synthetic safe message";
  return event;
}

void expect_state_error(EventSequenceState& state, const EventV1& event, const std::string& code) {
  ProtocolError error;
  check(!validate_event(state, event, error), "event unexpectedly passed state validation");
  check(error.code == code, "unexpected state error: " + error.code + ", expected " + code);
}

void test_events_and_state() {
  ProtocolError error;
  std::string line;
  EventV1 ready = ready_event();
  check(serialize_event(ready, line, error), "ready serialization failed");
  check(line == "{\"backend\":\"ctranslate2\",\"device\":\"cpu\",\"durationMs\":120000,\"event\":\"ready\",\"protocolVersion\":1}",
        "ready serialization changed");
  EventV1 parsed;
  check(parse_event_line(line, parsed, error) && parsed.type == EventType::Ready,
        "ready round trip failed");
  EventV1 japanese = segment_event(0, 1000, "こんにちは");
  check(serialize_event(japanese, line, error) && parse_event_line(line, parsed, error) &&
            parsed.segment.text == japanese.segment.text,
        "Japanese segment UTF-8 round trip failed");

  WorkerRequestV1 request;
  check(parse_request(base_request(), request, error), "state request parse failed");
  EventSequenceState state = make_event_sequence_state(request);
  check(validate_event(state, ready, error), "ready state failed");
  check(validate_event(state, segment_event(1000, 2000), error), "segment-before-progress must pass");
  check(validate_event(state, progress_event(5000), error), "progress failed");
  check(validate_event(state, progress_event(5000), error), "equal monotonic progress failed");

  EventV1 replace;
  replace.type = EventType::SegmentsReplace;
  replace.segments = {{1000, 2100, "first"}, {3000, 4000, "second"}};
  check(validate_event(state, replace, error), "replacement failed");
  check(state.last_segment_start_ms == 3000, "replacement did not update sequence atomically");

  EventV1 bad_replace = replace;
  bad_replace.segments[1].end_ms = 120001;
  expect_state_error(state, bad_replace, "segment_out_of_bounds");
  check(state.last_segment_start_ms == 3000, "invalid replacement partially mutated state");

  expect_state_error(state, progress_event(4999), "progress_regression");
  expect_state_error(state, progress_event(6000, 120001), "duration_drift");
  expect_state_error(state, ready, "duplicate_ready");
  check(validate_event(state, completed_event(), error), "completed failed");
  check(validate_event_eof(state, error), "terminal EOF failed");
  expect_state_error(state, segment_event(5000, 6000), "event_after_terminal");

  state = make_event_sequence_state(request);
  expect_state_error(state, progress_event(1), "event_before_ready");
  check(!validate_event_eof(state, error) && error.code == "missing_terminal_event",
        "incomplete EOF must fail");
  check(validate_event(state, error_event(), error), "pre-ready structured error failed");
  check(validate_event_eof(state, error), "pre-ready error EOF failed");

  state = make_event_sequence_state(request);
  expect_state_error(state, ready_event(Backend::CrispAsr), "ready_route_mismatch");

  EventV1 text = segment_event(0, 1, std::string(limits::max_text_bytes, 't'));
  check(serialize_event(text, line, error), "max segment text must serialize");
  text.segment.text.push_back('t');
  check(!serialize_event(text, line, error) && error.code == "invalid_segment",
        "oversized segment text must fail");

  EventV1 max_replace;
  max_replace.type = EventType::SegmentsReplace;
  max_replace.segments.assign(limits::max_replacement_segments, Segment{0, 1, "x"});
  check(serialize_event(max_replace, line, error), "max replacement count must serialize");
  check(line.size() < limits::max_event_line_bytes, "max replacement fixture exceeds line limit");
  max_replace.segments.push_back({0, 1, "x"});
  check(!serialize_event(max_replace, line, error) && error.code == "replacement_too_large",
        "replacement max+1 must fail");

  const std::string escaped_text(12000, '"');
  EventV1 escaped_replace;
  escaped_replace.type = EventType::SegmentsReplace;
  escaped_replace.segments.assign(400, Segment{0, 1, escaped_text});
  check(!serialize_event(escaped_replace, line, error) && error.code == "event_line_too_large",
        "escaped replacement must be bounded before aggregate serialization");

  Json padded = Json{{"backend", "ctranslate2"},
                     {"device", "cpu"},
                     {"durationMs", 120000},
                     {"event", "ready"},
                     {"padding", ""},
                     {"protocolVersion", 1}};
  line = padded.dump();
  padded["padding"] = std::string(limits::max_event_line_bytes - line.size(), 'e');
  line = padded.dump();
  check(line.size() == limits::max_event_line_bytes, "event max-line fixture drift");
  check(parse_event_line(line, parsed, error), "max event line must pass");
  line.push_back(' ');
  check(!parse_event_line(line, parsed, error) && error.code == "event_line_too_large",
        "event max+1 must fail");

  check(!parse_event_line("{not-json", parsed, error) && error.code == "event_malformed_json",
        "malformed event must fail");
  check(!parse_event_line("{\"event\":\"mystery\",\"protocolVersion\":1}", parsed, error) &&
            error.code == "unknown_event",
        "unknown event must fail");
  check(!parse_event_line("{\"event\":\"ready\",\"protocolVersion\":2}", parsed, error) &&
            error.code == "unsupported_protocol_version",
        "event version mismatch must fail");
  const std::string bom = "\xef\xbb\xbf{\"event\":\"error\",\"protocolVersion\":1}";
  check(!parse_event_line(bom, parsed, error) && error.code == "event_bom", "event BOM must fail");
  std::string nul = "{\"event\":\"error\",\"protocolVersion\":1}";
  nul.insert(nul.begin() + 1, '\0');
  check(!parse_event_line(nul, parsed, error) && error.code == "event_contains_nul",
        "event NUL must fail");
  std::string invalid_utf8 =
      "{\"endMs\":1,\"event\":\"segment\",\"protocolVersion\":1,\"startMs\":0,\"text\":\"";
  invalid_utf8 += std::string("\xc3\x28", 2) + "\"}";
  check(!parse_event_line(invalid_utf8, parsed, error) && error.code == "event_malformed_json",
        "invalid event UTF-8 must fail");
  EventV1 invalid_utf8_event = segment_event(0, 1, std::string("\xc3\x28", 2));
  check(!serialize_event(invalid_utf8_event, line, error) &&
            error.code == "event_serialization_failed",
        "invalid event UTF-8 must not serialize");
}

#ifdef _WIN32

struct ProcessResult {
  DWORD exit_code = 0;
  DWORD worker_processes_at_timeout = 0;
  bool timed_out = false;
  bool orphan_free = false;
  std::string stdout_text;
  std::string stderr_text;
};

std::wstring quote(const std::wstring& value) {
  return L"\"" + value + L"\"";
}

void read_handle(HANDLE handle, std::string& output) {
  char buffer[8192];
  DWORD count = 0;
  while (ReadFile(handle, buffer, sizeof(buffer), &count, nullptr) && count > 0) {
    output.append(buffer, buffer + count);
  }
}

ProcessResult run_worker_with_input(const std::filesystem::path& worker,
                                    const std::string& scenario, DWORD timeout_ms,
                                    const std::string& input) {
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  HANDLE stdout_read = nullptr, stdout_write = nullptr;
  HANDLE stderr_read = nullptr, stderr_write = nullptr;
  HANDLE stdin_read = nullptr, stdin_write = nullptr;
  check(CreatePipe(&stdout_read, &stdout_write, &security, 0), "stdout pipe failed");
  check(CreatePipe(&stderr_read, &stderr_write, &security, 0), "stderr pipe failed");
  check(CreatePipe(&stdin_read, &stdin_write, &security, 0), "stdin pipe failed");
  SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stderr_read, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stdin_write, HANDLE_FLAG_INHERIT, 0);

  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = stdin_read;
  startup.hStdOutput = stdout_write;
  startup.hStdError = stderr_write;
  PROCESS_INFORMATION process{};
  std::wstring command = quote(worker.wstring()) + L" --scenario " +
                         std::wstring(scenario.begin(), scenario.end());
  std::vector<wchar_t> mutable_command(command.begin(), command.end());
  mutable_command.push_back(L'\0');

  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  check(job != nullptr, "job object creation failed");
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION job_limits{};
  job_limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, &job_limits,
                                sizeof(job_limits)),
        "job object setup failed");

  check(CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, TRUE,
                       CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, nullptr, &startup, &process),
        "fake worker launch failed");
  check(AssignProcessToJobObject(job, process.hProcess), "fake worker job assignment failed");
  ResumeThread(process.hThread);

  CloseHandle(stdin_read);
  CloseHandle(stdout_write);
  CloseHandle(stderr_write);

  DWORD written = 0;
  check(WriteFile(stdin_write, input.data(), static_cast<DWORD>(input.size()), &written, nullptr) &&
            written == input.size(),
        "fake worker stdin write failed");
  CloseHandle(stdin_write);

  ProcessResult result;
  std::thread stdout_thread(read_handle, stdout_read, std::ref(result.stdout_text));
  std::thread stderr_thread(read_handle, stderr_read, std::ref(result.stderr_text));

  const DWORD wait = WaitForSingleObject(process.hProcess, timeout_ms);
  if (wait == WAIT_TIMEOUT) {
    result.timed_out = true;
    struct JobProcessIds {
      DWORD assigned;
      DWORD listed;
      ULONG_PTR ids[8];
    } process_ids{};
    check(QueryInformationJobObject(job, JobObjectBasicProcessIdList, &process_ids,
                                    sizeof(process_ids), nullptr),
          "job process list query failed");
    const std::wstring worker_path = std::filesystem::absolute(worker).wstring();
    for (DWORD index = 0; index < process_ids.listed; ++index) {
      HANDLE member = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE,
                                  static_cast<DWORD>(process_ids.ids[index]));
      if (member == nullptr) continue;
      std::vector<wchar_t> image(32768);
      DWORD image_size = static_cast<DWORD>(image.size());
      if (QueryFullProcessImageNameW(member, 0, image.data(), &image_size) &&
          CompareStringOrdinal(image.data(), static_cast<int>(image_size), worker_path.c_str(),
                               static_cast<int>(worker_path.size()), TRUE) == CSTR_EQUAL) {
        ++result.worker_processes_at_timeout;
      }
      CloseHandle(member);
    }
    check(TerminateJobObject(job, 99), "job termination failed");
    check(WaitForSingleObject(process.hProcess, 5000) == WAIT_OBJECT_0,
          "terminated worker did not exit");
  } else {
    check(wait == WAIT_OBJECT_0, "fake worker wait failed");
  }
  check(GetExitCodeProcess(process.hProcess, &result.exit_code), "exit code read failed");

  stdout_thread.join();
  stderr_thread.join();
  CloseHandle(stdout_read);
  CloseHandle(stderr_read);

  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  for (int attempt = 0; attempt < 50; ++attempt) {
    check(QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &accounting,
                                    sizeof(accounting), nullptr),
          "job accounting query failed");
    if (accounting.ActiveProcesses == 0) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
  result.orphan_free = accounting.ActiveProcesses == 0;

  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  CloseHandle(job);
  return result;
}

ProcessResult run_worker(const std::filesystem::path& worker, const std::string& scenario,
                         DWORD timeout_ms) {
  return run_worker_with_input(worker, scenario, timeout_ms, base_request().dump() + "\n");
}

struct OutputAnalysis {
  bool parse_ok = true;
  bool sequence_ok = true;
  bool terminal = false;
  std::string error_code;
};

OutputAnalysis analyze_output(const std::string& output) {
  WorkerRequestV1 request;
  ProtocolError error;
  check(parse_request(base_request(), request, error), "analysis request failed");
  EventSequenceState state = make_event_sequence_state(request);
  OutputAnalysis analysis;
  std::size_t start = 0;
  while (start < output.size()) {
    const auto end = output.find('\n', start);
    const std::string_view line(output.data() + start,
                                (end == std::string::npos ? output.size() : end) - start);
    EventV1 event;
    if (!parse_event_line(line, event, error)) {
      analysis.parse_ok = false;
      analysis.error_code = error.code;
      return analysis;
    }
    if (!validate_event(state, event, error)) {
      analysis.sequence_ok = false;
      analysis.error_code = error.code;
      return analysis;
    }
    if (end == std::string::npos) break;
    start = end + 1;
  }
  analysis.terminal = state.terminal;
  if (!validate_event_eof(state, error)) {
    analysis.sequence_ok = false;
    analysis.error_code = error.code;
  }
  return analysis;
}

void check_pre_ready_error(const ProcessResult& result, const std::string& expected_code) {
  check(!result.timed_out && result.exit_code == 2, "request rejection exit drift");
  check(result.orphan_free, "request rejection left a process");
  check(result.stderr_text.empty(), "request rejection unexpectedly wrote stderr");
  check(!result.stdout_text.empty() && result.stdout_text.back() == '\n',
        "request rejection did not emit one JSONL event");
  const std::string line = result.stdout_text.substr(0, result.stdout_text.size() - 1);
  check(line.find('\n') == std::string::npos, "request rejection emitted multiple events");
  EventV1 event = parse_event(line);
  check(event.type == EventType::Error && event.code == expected_code,
        "request rejection code drift: " + event.code);
}

void test_fake_contract(const std::filesystem::path& worker) {
  check(std::filesystem::is_regular_file(worker), "fake worker discovery path is invalid");
  const struct Case {
    const char* scenario;
    DWORD exit_code;
    const char* protocol_error;
    bool complete;
  } cases[] = {{"success", 0, "", true},
               {"segments-replace", 0, "", true},
               {"structured-error", 20, "", true},
               {"malformed-json", 0, "event_malformed_json", false},
               {"unknown-event", 0, "unknown_event", false},
               {"version-mismatch", 0, "unsupported_protocol_version", false},
               {"invalid-transition", 0, "event_before_ready", false},
               {"invalid-segment", 0, "invalid_segment", false},
               {"duration-drift", 0, "duration_drift", false},
               {"oversized-line", 0, "event_line_too_large", false},
               {"crash-before-ready", 70, "missing_terminal_event", false},
               {"crash-after-progress", 71, "missing_terminal_event", false},
               {"zero-exit-without-terminal", 0, "missing_terminal_event", false},
               {"completed-then-nonzero", 72, "", true},
               {"stderr-diagnostics", 0, "", true}};

  for (const auto& item : cases) {
    const ProcessResult first = run_worker(worker, item.scenario, 5000);
    const ProcessResult second = run_worker(worker, item.scenario, 5000);
    check(!first.timed_out && !second.timed_out, std::string(item.scenario) + " timed out");
    check(first.orphan_free && second.orphan_free, std::string(item.scenario) + " left a process");
    check(first.exit_code == item.exit_code && second.exit_code == item.exit_code,
          std::string(item.scenario) + " exit code drift");
    check(first.stdout_text == second.stdout_text && first.stderr_text == second.stderr_text,
          std::string(item.scenario) + " output is not deterministic");

    const OutputAnalysis analysis = analyze_output(first.stdout_text);
    check(analysis.terminal == item.complete, std::string(item.scenario) + " terminal classification drift");
    if (*item.protocol_error) {
      check(analysis.error_code == item.protocol_error,
            std::string(item.scenario) + " protocol error drift: " + analysis.error_code);
    } else {
      check(analysis.parse_ok && analysis.sequence_ok,
            std::string(item.scenario) + " valid output failed: " + analysis.error_code);
    }
    if (std::string(item.scenario) == "stderr-diagnostics") {
      check(first.stderr_text == std::string(limits::max_stderr_diagnostic_bytes, 'D'),
            "stderr diagnostics boundary drift");
    } else {
      check(first.stderr_text.empty(), std::string(item.scenario) + " unexpectedly wrote stderr");
    }
  }

  Json qwen = base_request("qwen3-asr", "crispasr");
  check_pre_ready_error(run_worker_with_input(worker, "success", 5000, qwen.dump() + "\n"),
                        "missing_model_role");
  check_pre_ready_error(run_worker_with_input(worker, "success", 5000, ""),
                        "missing_request");
  check_pre_ready_error(run_worker_with_input(worker, "success", 5000, "{not-json\n"),
                        "request_malformed_json");
  check_pre_ready_error(run_worker_with_input(worker, "success", 5000,
                                               base_request().dump() + "\n{}\n"),
                        "request_extra_line");
  check_pre_ready_error(run_worker_with_input(
                            worker, "success", 5000,
                            std::string(limits::max_request_line_bytes + 1, 'x') + "\n"),
                        "request_line_too_large");
}

void test_fake_hang(const std::filesystem::path& worker, const std::string& scenario) {
  const ProcessResult result = run_worker(worker, scenario, 400);
  check(result.timed_out, scenario + " did not expose a hang");
  check(result.exit_code == 99, scenario + " termination exit code drift");
  check(result.orphan_free, scenario + " left an orphan process");
  if (scenario == "child-process-hang") {
    check(result.worker_processes_at_timeout >= 2,
          scenario + " did not launch the child worker: " +
              std::to_string(result.worker_processes_at_timeout));
  } else {
    check(result.worker_processes_at_timeout == 1,
          scenario + " worker process count drift: " +
              std::to_string(result.worker_processes_at_timeout));
  }
  check(result.stderr_text.empty(), scenario + " unexpectedly wrote stderr");
  check(result.stdout_text ==
            "{\"backend\":\"ctranslate2\",\"device\":\"cpu\",\"durationMs\":120000,\"event\":\"ready\",\"protocolVersion\":1}\n",
        scenario + " deterministic prefix drift");
}

#endif

void run_core_tests() {
  test_limits_source();
  test_requests();
  test_events_and_state();
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc == 1) {
      run_core_tests();
    } else if (argc == 3 && std::string(argv[1]) == "--fake-contract") {
#ifdef _WIN32
      test_fake_contract(argv[2]);
#else
      throw std::runtime_error("fake process contract is currently Windows-only");
#endif
    } else if (argc == 4 && std::string(argv[1]) == "--fake-hang") {
#ifdef _WIN32
      test_fake_hang(argv[2], argv[3]);
#else
      throw std::runtime_error("fake process hang contract is currently Windows-only");
#endif
    } else {
      throw std::runtime_error("invalid protocol test arguments");
    }
    std::cout << "protocol tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "protocol tests failed: " << error.what() << '\n';
    return 1;
  }
}
