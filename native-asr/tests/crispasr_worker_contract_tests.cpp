#include <hikaru_asr/protocol.hpp>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

namespace {

using namespace hikaru_asr;
using Json = nlohmann::json;
namespace fs = std::filesystem;

void check(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

void write_u16(std::ostream& output, std::uint16_t value) {
  output.put(static_cast<char>(value & 0xff));
  output.put(static_cast<char>((value >> 8) & 0xff));
}

void write_u32(std::ostream& output, std::uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) {
    output.put(static_cast<char>((value >> shift) & 0xff));
  }
}

void write_wav(const fs::path& path, std::int64_t duration_ms) {
  constexpr std::uint32_t sample_rate = 16'000;
  const std::vector<std::int16_t> samples(
      static_cast<std::size_t>(duration_ms * sample_rate / 1000), 0);
  std::ofstream output(path, std::ios::binary);
  output.write("RIFF", 4);
  write_u32(output, 36 + static_cast<std::uint32_t>(samples.size() * 2));
  output.write("WAVEfmt ", 8);
  write_u32(output, 16);
  write_u16(output, 1);
  write_u16(output, 1);
  write_u32(output, sample_rate);
  write_u32(output, sample_rate * 2);
  write_u16(output, 2);
  write_u16(output, 16);
  output.write("data", 4);
  write_u32(output, static_cast<std::uint32_t>(samples.size() * 2));
  output.write(
      reinterpret_cast<const char*>(samples.data()),
      static_cast<std::streamsize>(samples.size() * 2));
}

fs::path temporary_root() {
  const fs::path root = fs::temp_directory_path()
      / ("hikaru-crispasr-worker-" + std::to_string(GetCurrentProcessId()));
  fs::remove_all(root);
  fs::create_directories(root);
  return root;
}

struct ProcessResult {
  DWORD exit_code = 0;
  std::string stdout_text;
  std::string stderr_text;
};

std::string read_pipe(HANDLE handle) {
  std::string output;
  char buffer[4096];
  DWORD count = 0;
  while (ReadFile(handle, buffer, sizeof(buffer), &count, nullptr) && count > 0) {
    output.append(buffer, buffer + count);
  }
  return output;
}

ProcessResult run_worker(const fs::path& worker, const std::string& request) {
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  HANDLE stdin_read = nullptr;
  HANDLE stdin_write = nullptr;
  HANDLE stdout_read = nullptr;
  HANDLE stdout_write = nullptr;
  HANDLE stderr_read = nullptr;
  HANDLE stderr_write = nullptr;
  check(CreatePipe(&stdin_read, &stdin_write, &security, 0), "stdin pipe failed");
  check(CreatePipe(&stdout_read, &stdout_write, &security, 0), "stdout pipe failed");
  check(CreatePipe(&stderr_read, &stderr_write, &security, 0), "stderr pipe failed");
  SetHandleInformation(stdin_write, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stderr_read, HANDLE_FLAG_INHERIT, 0);

  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = stdin_read;
  startup.hStdOutput = stdout_write;
  startup.hStdError = stderr_write;
  PROCESS_INFORMATION process{};
  std::wstring command = L"\"" + fs::absolute(worker).wstring() + L"\"";
  check(CreateProcessW(
            nullptr,
            command.data(),
            nullptr,
            nullptr,
            TRUE,
            CREATE_NO_WINDOW,
            nullptr,
            worker.parent_path().c_str(),
            &startup,
            &process),
        "worker launch failed");
  CloseHandle(stdin_read);
  CloseHandle(stdout_write);
  CloseHandle(stderr_write);

  DWORD written = 0;
  check(WriteFile(stdin_write, request.data(), static_cast<DWORD>(request.size()), &written, nullptr)
            && written == request.size(),
        "worker request write failed");
  CloseHandle(stdin_write);

  check(WaitForSingleObject(process.hProcess, 30'000) == WAIT_OBJECT_0, "worker timed out");
  ProcessResult result;
  check(GetExitCodeProcess(process.hProcess, &result.exit_code), "worker exit code failed");
  result.stdout_text = read_pipe(stdout_read);
  result.stderr_text = read_pipe(stderr_read);
  CloseHandle(stdout_read);
  CloseHandle(stderr_read);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return result;
}

Json request_json(
    const fs::path& audio,
    const fs::path& model,
    const char* engine,
    const fs::path& aligner = {},
    bool use_vad = false) {
  Json models = Json::array({Json{{"role", "model"}, {"path", model.u8string()}}});
  if (!aligner.empty()) {
    models.push_back(Json{{"role", "aligner"}, {"path", aligner.u8string()}});
  }
  return Json{{"protocolVersion", 1},
              {"jobId", "t10-worker-contract"},
              {"engine", engine},
              {"backend", "crispasr"},
              {"audioPath", audio.u8string()},
              {"modelPaths", models},
              {"device", "cpu"},
              {"language", "ja"},
              {"useVad", use_vad}};
}

std::vector<EventV1> parse_events(const std::string& output, const Json& request_json) {
  WorkerRequestV1 request;
  ProtocolError error;
  check(parse_request_line(request_json.dump(), request, error),
        "worker test request parse failed: " + error.code);
  EventSequenceState state = make_event_sequence_state(request);
  std::vector<EventV1> events;
  std::size_t start = 0;
  while (start < output.size()) {
    const std::size_t end = output.find('\n', start);
    const std::string line = output.substr(start, end == std::string::npos ? end : end - start);
    if (!line.empty()) {
      EventV1 event;
      check(parse_event_line(line, event, error), "event parse failed: " + error.code);
      check(validate_event(state, event, error), "event sequence failed: " + error.code);
      events.push_back(std::move(event));
    }
    if (end == std::string::npos) break;
    start = end + 1;
  }
  check(validate_event_eof(state, error), "event EOF failed: " + error.code);
  return events;
}

void check_success(
    const std::vector<EventV1>& events,
    std::int64_t duration_ms,
    std::int64_t second_start_ms,
    const std::vector<std::int64_t>& exact_progress = {}) {
  check(events.size() >= 4 && events.front().type == EventType::Ready
            && events.front().duration_ms == duration_ms,
        "ready missing or invalid");
  std::size_t index = 1;
  std::vector<std::int64_t> progress;
  while (index < events.size() && events[index].type == EventType::Progress) {
    progress.push_back(events[index].processed_ms);
    ++index;
  }
  check(index < events.size() && events[index].type == EventType::SegmentsReplace,
        "replacement did not follow ready/progress events");
  const EventV1& replacement = events[index++];
  check(replacement.segments.size() == 2, "replacement did not contain both windows");
  check(replacement.segments[0].start_ms == 0
            && replacement.segments[1].start_ms == second_start_ms,
        "replacement window offsets drifted");
  check(index + 1 == events.size() && events[index].type == EventType::Completed
            && events[index].duration_ms == duration_ms,
        "completed did not immediately follow the replacement");
  if (!exact_progress.empty()) {
    check(progress == exact_progress, "exact progress endpoints drifted");
  }
}

void check_post_ready_failure(
    const std::vector<EventV1>& events,
    const char* expected_code) {
  check(events.size() >= 2 && events.front().type == EventType::Ready,
        "post-ready failure did not start with ready");
  std::size_t index = 1;
  while (index < events.size() && events[index].type == EventType::Progress) ++index;
  check(index + 1 == events.size() && events[index].type == EventType::Error
            && events[index].code == expected_code,
        "post-ready failure ordering/code drifted");
}

void run_tests(
    const fs::path& worker,
    const fs::path& fake_abi,
    const fs::path& vad_identity_worker) {
  const fs::path root = temporary_root();
  const fs::path audio = root / "audio.wav";
  const fs::path parakeet_model = root / "parakeet-model.gguf";
  const fs::path reazon_model = root / "reazon-model.gguf";
  const fs::path policy_empty = root / "reazon-policy-empty.gguf";
  const fs::path oversized_text = root / "reazon-oversized-text.gguf";
  const fs::path protocol_invalid_text = root / "reazon-protocol-invalid-text.gguf";
  const fs::path protocol_oversized_replacement = root / "protocol-oversized-replacement.gguf";
  const fs::path aligner = root / "aligner.gguf";
  const fs::path vad_model = worker.parent_path() / "ggml-silero-v6.2.0.bin";
  const fs::path identity_vad_model =
      vad_identity_worker.parent_path() / "ggml-silero-v6.2.0.bin";
  write_wav(audio, 20'000);
  std::ofstream(parakeet_model) << "model";
  std::ofstream(reazon_model) << "model";
  std::ofstream(policy_empty) << "model";
  std::ofstream(oversized_text) << "model";
  std::ofstream(protocol_invalid_text) << "model";
  std::ofstream(protocol_oversized_replacement) << "model";
  std::ofstream(aligner) << "aligner";
  std::ofstream(vad_model) << "vad";
  fs::remove(identity_vad_model);
  fs::copy_file(fake_abi, worker.parent_path() / "crispasr.dll", fs::copy_options::overwrite_existing);

  {
    const Json request = request_json(audio, parakeet_model, "parakeet");
    const ProcessResult result = run_worker(worker, request.dump() + "\n");
    check(result.exit_code == 0, "Parakeet worker failed: " + result.stdout_text);
    check(result.stderr_text.empty(), "Parakeet worker wrote stderr: " + result.stderr_text);
    check_success(parse_events(result.stdout_text, request), 20'000, 15'000);
  }
  {
    SetEnvironmentVariableA("CRISPASR_PARAKEET_STREAM_THRESHOLD", "12");
    SetEnvironmentVariableA("CRISPASR_PARAKEET_STREAM_CHUNK", "2");
    SetEnvironmentVariableA("CRISPASR_SESSION_UNIFIED_DISPATCH", "1");
    const Json request = request_json(audio, reazon_model, "reazonspeech-nemo");
    const ProcessResult result = run_worker(worker, request.dump() + "\n");
    check(result.exit_code == 0, "Reazon worker failed: " + result.stdout_text);
    check(result.stderr_text.empty(), "Reazon worker wrote stderr: " + result.stderr_text);
    check_success(
        parse_events(result.stdout_text, request),
        20'000,
        12'000,
        {12'060, 20'000});
    SetEnvironmentVariableA("CRISPASR_PARAKEET_STREAM_THRESHOLD", nullptr);
    SetEnvironmentVariableA("CRISPASR_PARAKEET_STREAM_CHUNK", nullptr);
    SetEnvironmentVariableA("CRISPASR_SESSION_UNIFIED_DISPATCH", nullptr);
  }

  const auto check_policy_failure = [&](const fs::path& input_model, const char* expected_code) {
    const Json request = request_json(audio, input_model, "reazonspeech-nemo");
    const ProcessResult result = run_worker(worker, request.dump() + "\n");
    const auto events = parse_events(result.stdout_text, request);
    check(result.exit_code == 20, "policy failure exit drifted");
    check_post_ready_failure(events, expected_code);
  };
  check_policy_failure(policy_empty, "parakeet_family_invalid_input");
  check_policy_failure(oversized_text, "parakeet_family_cue_limit");

  std::vector<std::pair<std::string, std::string>> zero_vad_errors;
  for (const char* scenario : {"no-speech-like", "internal-failure-like"}) {
    SetEnvironmentVariableA("HIKARU_FAKE_CRISPASR_VAD_SCENARIO", scenario);
    const Json request = request_json(audio, reazon_model, "reazonspeech-nemo");
    const ProcessResult result = run_worker(worker, request.dump() + "\n");
    const auto events = parse_events(result.stdout_text, request);
    check(result.exit_code == 20, "zero-result VAD failure exit drifted");
    check_post_ready_failure(events, "crispasr_vad_no_result");
    zero_vad_errors.emplace_back(events.back().code, events.back().message);
  }
  SetEnvironmentVariableA("HIKARU_FAKE_CRISPASR_VAD_SCENARIO", nullptr);
  check(zero_vad_errors.size() == 2 && zero_vad_errors[0] == zero_vad_errors[1],
        "indistinguishable zero-result VAD outcomes did not emit identical errors");

  const auto check_replacement_failure = [&](
      const fs::path& input_audio,
      const fs::path& input_model,
      const char* engine,
      const char* expected_code) {
    const Json request = request_json(input_audio, input_model, engine);
    const ProcessResult result = run_worker(worker, request.dump() + "\n");
    const auto events = parse_events(result.stdout_text, request);
    check(result.exit_code == 20, "replacement protocol failure exit drifted");
    check_post_ready_failure(events, expected_code);
  };
  check_replacement_failure(
      audio,
      protocol_invalid_text,
      "reazonspeech-nemo",
      "invalid_segment");
  check_replacement_failure(
      audio,
      protocol_oversized_replacement,
      "parakeet",
      "replacement_too_large");

  {
    fs::remove(vad_model);
    const Json request = request_json(audio, reazon_model, "reazonspeech-nemo");
    const ProcessResult result = run_worker(worker, request.dump() + "\n");
    const auto events = parse_events(result.stdout_text, request);
    check(result.exit_code == 20 && events.size() == 1
              && events.front().type == EventType::Error
              && events.front().code == "crispasr_vad_model_invalid",
          "missing VAD did not fail before ready");
    std::ofstream(vad_model) << "vad";
  }

  const auto check_vad_identity_failure = [&](const char* label) {
    const Json request = request_json(audio, reazon_model, "reazonspeech-nemo");
    const ProcessResult result = run_worker(vad_identity_worker, request.dump() + "\n");
    const auto events = parse_events(result.stdout_text, request);
    check(result.exit_code == 20 && events.size() == 1
              && events.front().type == EventType::Error
              && events.front().code == "crispasr_vad_model_invalid",
          std::string("non-empty ") + label + " VAD did not fail before ready");
  };
  std::ofstream(identity_vad_model) << "vad";
  check_vad_identity_failure("wrong-size");
  {
    std::ofstream output(identity_vad_model, std::ios::binary | std::ios::trunc);
    output.seekp(885'097);
    output.put('\0');
  }
  check_vad_identity_failure("wrong-hash");

  {
    const Json request = request_json(audio, reazon_model, "reazonspeech-nemo", {}, true);
    const ProcessResult result = run_worker(worker, request.dump() + "\n");
    const auto events = parse_events(result.stdout_text, request);
    check(result.exit_code == 2 && events.size() == 1
              && events.front().type == EventType::Error
              && events.front().code == "crispasr_vad_not_implemented",
          "product useVad semantics changed");
  }

  {
    const Json request = request_json(audio, parakeet_model, "qwen3-asr", aligner);
    const ProcessResult result = run_worker(worker, request.dump() + "\n");
    const auto events = parse_events(result.stdout_text, request);
    check(result.exit_code == 20, "Qwen strict seam exit drifted");
    check_post_ready_failure(events, "qwen_timeline_policy_not_implemented");
  }

  fs::remove(vad_model);
  fs::remove(identity_vad_model);
  fs::remove_all(root);
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc != 4) throw std::runtime_error("expected worker, fake ABI, and VAD identity worker paths");
    run_tests(fs::u8path(argv[1]), fs::u8path(argv[2]), fs::u8path(argv[3]));
    std::cout << "crispasr worker contract tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "crispasr worker contract tests failed: " << error.what() << '\n';
    return 1;
  }
}
