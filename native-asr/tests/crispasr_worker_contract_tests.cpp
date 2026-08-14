#include <hikaru_asr/protocol.hpp>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
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

  check(WaitForSingleObject(process.hProcess, 10'000) == WAIT_OBJECT_0, "worker timed out");
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
    const fs::path& aligner = {}) {
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
              {"useVad", false}};
}

std::vector<EventV1> parse_events(const std::string& output) {
  std::vector<EventV1> events;
  std::size_t start = 0;
  while (start < output.size()) {
    const std::size_t end = output.find('\n', start);
    const std::string line = output.substr(start, end == std::string::npos ? end : end - start);
    if (!line.empty()) {
      EventV1 event;
      ProtocolError error;
      check(parse_event_line(line, event, error), "event parse failed: " + error.code);
      events.push_back(std::move(event));
    }
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return events;
}

void check_success(const std::vector<EventV1>& events, std::int64_t duration_ms) {
  check(!events.empty() && events.front().type == EventType::Ready, "ready missing");
  std::size_t segment_count = 0;
  std::size_t replacement_count = 0;
  std::size_t completed_count = 0;
  std::int64_t last_progress = -1;
  for (const auto& event : events) {
    if (event.type == EventType::Segment) ++segment_count;
    if (event.type == EventType::SegmentsReplace) {
      ++replacement_count;
      check(event.segments.size() == 2, "replacement did not contain both windows");
      check(event.segments[0].start_ms == 0 && event.segments[1].start_ms == 15'000,
            "replacement window offsets drifted");
    }
    if (event.type == EventType::Progress) {
      check(event.processed_ms >= last_progress, "progress regressed");
      last_progress = event.processed_ms;
    }
    if (event.type == EventType::Completed) {
      ++completed_count;
      check(event.duration_ms == duration_ms, "completed duration drifted");
    }
  }
  check(segment_count == 0, "raw preview escaped into protocol output");
  check(replacement_count == 1, "expected exactly one replacement");
  check(completed_count == 1 && events.back().type == EventType::Completed,
        "completed sequencing drifted");
}

void run_tests(const fs::path& worker, const fs::path& fake_abi) {
  const fs::path root = temporary_root();
  const fs::path audio = root / "audio.wav";
  const fs::path model = root / "model.gguf";
  const fs::path policy_empty = root / "policy-empty.gguf";
  const fs::path oversized_text = root / "oversized-text.gguf";
  const fs::path aligner = root / "aligner.gguf";
  write_wav(audio, 20'000);
  std::ofstream(model) << "model";
  std::ofstream(policy_empty) << "model";
  std::ofstream(oversized_text) << "model";
  std::ofstream(aligner) << "aligner";
  fs::copy_file(fake_abi, worker.parent_path() / "crispasr.dll", fs::copy_options::overwrite_existing);

  for (const char* engine : {"parakeet", "reazonspeech-nemo"}) {
    const ProcessResult result = run_worker(
        worker,
        request_json(audio, model, engine).dump() + "\n");
    check(
        result.exit_code == 0,
        std::string(engine) + " worker failed: exit=" + std::to_string(result.exit_code)
            + " stdout=" + result.stdout_text + " stderr=" + result.stderr_text);
    check(
        result.stderr_text.empty(),
        std::string(engine) + " wrote stderr: " + result.stderr_text);
    check_success(parse_events(result.stdout_text), 20'000);
  }

  const auto check_policy_failure = [&](const fs::path& input_model, const char* expected_code) {
    const ProcessResult result = run_worker(
        worker,
        request_json(audio, input_model, "parakeet").dump() + "\n");
    const auto events = parse_events(result.stdout_text);
    check(result.exit_code == 20 && events.size() >= 2, "policy failure exit drifted");
    check(events.front().type == EventType::Ready && events.back().type == EventType::Error,
          "policy failure was not post-ready terminal error");
    check(
        events.back().code == expected_code,
        "policy failure code drifted: code=" + events.back().code
            + " stdout=" + result.stdout_text + " stderr=" + result.stderr_text);
    for (const auto& event : events) {
      check(event.type != EventType::Segment && event.type != EventType::SegmentsReplace,
            "policy failure emitted accepted output");
    }
  };
  check_policy_failure(policy_empty, "parakeet_family_invalid_input");
  check_policy_failure(oversized_text, "parakeet_family_cue_limit");

  {
    const ProcessResult result = run_worker(
        worker,
        request_json(audio, model, "qwen3-asr", aligner).dump() + "\n");
    const auto events = parse_events(result.stdout_text);
    check(result.exit_code == 20 && !events.empty(), "Qwen strict seam exit drifted");
    check(events.back().type == EventType::Error
              && events.back().code == "qwen_timeline_policy_not_implemented",
          "Qwen strict seam drifted");
    for (const auto& event : events) {
      check(event.type != EventType::Segment && event.type != EventType::SegmentsReplace,
            "Qwen emitted accepted timing");
    }
  }

  fs::remove_all(root);
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc != 3) throw std::runtime_error("expected worker and fake ABI paths");
    run_tests(fs::u8path(argv[1]), fs::u8path(argv[2]));
    std::cout << "crispasr worker contract tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "crispasr worker contract tests failed: " << error.what() << '\n';
    return 1;
  }
}
