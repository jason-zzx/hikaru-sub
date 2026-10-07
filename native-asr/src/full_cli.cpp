#include "full_cli.hpp"
#include "qwen_cli.hpp"
#include "wav_audio.hpp"
#include <nlohmann/json.hpp>

#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <algorithm>
#include <chrono>
#include <map>
#include <regex>
#include <set>

namespace hikaru_asr::full_cli {
namespace fs = std::filesystem;
using Json = nlohmann::json;
void require(bool ok, const char* code) {
  if (!ok) throw Error(code);
}
struct Handle {
  HANDLE value = INVALID_HANDLE_VALUE;
  explicit Handle(HANDLE v = INVALID_HANDLE_VALUE) : value(v) {}
  ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
};

// nlohmann validates every UTF-8 string (including escaped surrogates). Use the
// Windows Unicode conversion, not a second UTF-8 decoder or the old timeline policy.
std::wstring wide(const std::string& text) {
  if (text.empty()) return {};
  const int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(),
                                  static_cast<int>(text.size()), nullptr, 0);
  require(n > 0);
  std::wstring out(n, L'\0');
  require(MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(),
                            static_cast<int>(text.size()), out.data(), n) == n);
  return out;
}
std::wstring compact(const std::string& text) {
  auto value = wide(text);
  // Unicode White_Space plus Python's four information separators, matching the
  // accepted same-run validator. No punctuation/normalization/text repair.
  value.erase(std::remove_if(value.begin(), value.end(), [](wchar_t c) {
    return (c >= 9 && c <= 13) || (c >= 0x1c && c <= 0x20) || c == 0x85
        || c == 0xa0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200a)
        || c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000;
  }), value.end());
  return value;
}
std::int64_t integer(const Json& v) {
  require(v.is_number_integer() && (!v.is_number_unsigned()
          || v.get<std::uint64_t>() <= INT64_MAX));
  return v.get<std::int64_t>();
}
std::string text(const Json& v) {
  require(v.is_string());
  return v.get<std::string>();
}

namespace {
void check_path(const fs::path& path, bool directory = false) {
  require(path.is_absolute(), "qwen_cli_path_not_absolute");
  for (const auto& part : path) require(part != L"." && part != L"..", "qwen_cli_path_invalid");
  // Preserve the existing path-type boundary without retaining handles during inference.
  for (auto at = path; at != at.root_path(); at = at.parent_path()) {
    const auto spelling = at.wstring();
    if (spelling.size() == 6 && spelling.rfind(L"\\\\?\\", 0) == 0 && spelling[5] == L':') break;
    const auto attributes = GetFileAttributesW(at.c_str());
    require(attributes != INVALID_FILE_ATTRIBUTES, "qwen_cli_path_open_failed");
    require(!(attributes & FILE_ATTRIBUTE_REPARSE_POINT)
        && bool(attributes & FILE_ATTRIBUTE_DIRECTORY) == (at != path || directory),
        "qwen_cli_path_attributes_invalid");
  }
}
std::wstring quote(const std::wstring& arg) {
  std::wstring out = L"\"";
  std::size_t slashes = 0;
  for (wchar_t c : arg) {
    if (c == L'\\') { ++slashes; continue; }
    out.append(c == L'"' ? 2 * slashes + 1 : slashes, L'\\');
    slashes = 0;
    out += c;
  }
  out.append(2 * slashes, L'\\');
  return out + L'"';
}
fs::path executable_root() {
  std::wstring value(32768, L'\0');
  const DWORD n = GetModuleFileNameW(nullptr, value.data(), static_cast<DWORD>(value.size()));
  require(n && n < value.size(), "qwen_cli_runtime_invalid");
  value.resize(n);
  return fs::path(value).parent_path();
}
struct Execution {
  bool error = false, vad = false, cpu_cuda = false, tdt = false, rnnt = false;
  int stage = 0;
  std::int64_t slice = 0, total = 0;
  std::set<std::string> roles;
  bool line(const std::string& value, const std::string& device, Engine engine, bool vad_only = false) {
    const auto previous_stage = stage;
    const auto previous_slice = slice;
    if (value == "hikaru_stage: parakeet_model_loaded") stage = std::max(stage, 1);
    if (value.find("hikaru_error:") != std::string::npos) error = true;
    if (value.find("ggml_cuda_init:") != std::string::npos) cpu_cuda = true;
    static const std::regex graph(R"(^hikaru_graph: role=(asr|aligner|lazy-audio|parakeet-encoder|parakeet-predictor|parakeet-joint) device=(cpu|cuda) nodes=([0-9]+) other=([0-9]+)\r?$)");
    static const std::regex vad_line(R"(^hikaru_vad: device=cpu chunks=([1-9][0-9]*) completed=1\r?$)");
    std::smatch m;
    if (value.rfind("hikaru_graph:", 0) == 0) {
      if (!std::regex_match(value, m, graph) || m[2] != device
          || m[3].str().find_first_not_of('0') == std::string::npos || m[4] != "0") error = true;
      else { roles.insert(m[1]); stage = std::max(stage, 3); }
    }
    if (value.rfind("hikaru_vad:", 0) == 0) {
      if (std::regex_match(value, vad_line)) { vad = true; stage = std::max(stage, 2); }
      else error = true;
    }
    static const std::regex tdt_line(R"(^hikaru_tdt: decoder=(cpu|cuda) host_projection=cpu frames=([1-9][0-9]*) steps=([1-9][0-9]*) completed=1$)");
    if (value.rfind("hikaru_tdt:", 0) == 0) {
      if (engine != Engine::Parakeet || !std::regex_match(value, m, tdt_line) || m[1] != device) error = true;
      else tdt = true;
    }
    static const std::regex rnnt_line(R"(^hikaru_rnnt: decoder=(cpu|cuda) host_projection=cpu frames=([1-9][0-9]*) steps=([1-9][0-9]*) completed=1$)");
    if (value.rfind("hikaru_rnnt:", 0) == 0) {
      if (engine != Engine::ReazonSpeechNemo || !std::regex_match(value, m, rnnt_line) || m[1] != device) error = true;
      else rnnt = true;
    }
    static const std::regex slice_line(R"(^hikaru_slice: completed=([0-9]+) total=([0-9]+)$)");
    static const std::regex vad_progress(R"(^hikaru_vad_progress: completed=([0-9]+) total=([0-9]+)$)");
    const bool vad_chunk = vad_only && value.rfind("hikaru_vad_progress:", 0) == 0;
    if (vad_chunk || value.rfind("hikaru_slice:", 0) == 0) {
      if (!std::regex_match(value, m, vad_chunk ? vad_progress : slice_line)) error = true;
      else {
        const auto done = std::stoll(m[1]), count = std::stoll(m[2]);
        if (done <= 0 || done > count || (total && count != total) || done < slice) error = true;
        else { slice = done; total = count; }
      }
    }
    return stage > previous_stage || slice > previous_slice;
  }
};
}  // namespace

Json document(const std::string& bytes, std::int64_t duration_ms) {
    require(duration_ms > 0 && !bytes.empty() && bytes.size() <= limits::max_event_line_bytes
        && bytes.compare(0, 3, "\xef\xbb\xbf") != 0 && bytes.find('\0') == std::string::npos);
    // nlohmann treats raw NUL as EOF. Reject it and validate the entire supplied
    // byte span, including unknown fields/suffixes, without repairing any text.
    (void)wide(bytes);
    std::vector<std::set<std::string>> keys;
    const auto callback = [&](int depth, Json::parse_event_t event, Json& parsed) {
      require(depth <= 64);
      if (event == Json::parse_event_t::object_start) keys.emplace_back();
      if (event == Json::parse_event_t::key) require(keys.back().insert(text(parsed)).second);
      if (event == Json::parse_event_t::object_end) keys.pop_back();
      return true;
    };
    return Json::parse(bytes, callback);
}

namespace {
struct Output {
  std::string bytes;
  Execution execution;
  std::map<ModelRole, fs::path> models;
  std::int64_t duration;
};
Output run(const WorkerRequestV1& request, bool vad_only,
                               const std::function<void(std::int64_t)>& ready,
                               const std::function<void(std::int64_t, std::int64_t)>& progress) {
  const bool parakeet = request.engine == Engine::Parakeet;
  const bool reazonspeech = request.engine == Engine::ReazonSpeechNemo;
  const bool parakeet_family = parakeet || reazonspeech;
  if (!vad_only) require((parakeet_family || request.engine == Engine::Qwen3Asr) && request.backend == Backend::CrispAsr
      && request.device != Device::Vulkan && request.use_vad && !request.vad_config
      && request.model_paths.size() == (parakeet_family ? 2 : 3), "qwen_cli_request_invalid");
  if (vad_only) require(request.backend == Backend::CTranslate2 && request.use_vad
      && request.vad_cli_path && request.model_paths.size() == 2, "vad_cli_request_invalid");
  const auto device = vad_only ? Device::Cpu : request.device;
  require(!request.job_id.empty() && std::all_of(request.job_id.begin(), request.job_id.end(), [](unsigned char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
  }), "qwen_cli_path_invalid");
  std::map<ModelRole, fs::path> models;
  for (const auto& model : request.model_paths) {
    const fs::path path(wide(model.path));
    if (!vad_only || model.role == ModelRole::Vad) check_path(path);
    models.emplace(model.role, path);
  }
  require(models.size() == request.model_paths.size() && models.count(ModelRole::Model)
      && models.count(ModelRole::Aligner) == (vad_only || parakeet_family ? 0 : 1) && models.count(ModelRole::Vad), "qwen_cli_request_invalid");
  const fs::path audio(wide(request.audio_path)); check_path(audio);

  const fs::path work = audio.parent_path() / "asr-jobs" / (request.job_id + "-cli");
  check_path(work, true);
  require(fs::is_empty(work), "qwen_cli_work_not_empty");
  const fs::path cli = vad_only ? fs::path(wide(*request.vad_cli_path)) : executable_root() / "crispasr.exe"; check_path(cli);
  // CreateProcessW limits lpCurrentDirectory even with extended spelling. The
  // CLI root is already first in DLL search order; a writable workspace
  // ancestor would add an unsafe search directory. Never relocate private data.
  const auto cwd = work.wstring().size() < MAX_PATH ? work : cli.parent_path();
  require(cwd.wstring().size() < MAX_PATH, "qwen_cli_path_invalid");
  const auto relative_audio = fs::canonical(audio).lexically_relative(fs::canonical(cwd));
  require(!relative_audio.empty() && !relative_audio.is_absolute()
      && fs::canonical((cwd / relative_audio).lexically_normal()) == fs::canonical(audio), "qwen_cli_path_invalid");
  const auto duration = wav::read_pcm16_mono_16khz(audio).duration_ms;
  require(duration > 0, "qwen_cli_audio_invalid");
  if (ready) ready(duration);
  // A pre-created, delete-denying result cannot be replaced by a symlink.
  // The host owns private workspace cleanup after the whole process tree reaps.
  const fs::path result = work / "result.json";
  Handle output(CreateFileW(result.c_str(), GENERIC_READ,
      FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, CREATE_NEW,
      FILE_ATTRIBUTE_TEMPORARY, nullptr));
  require(output.value != INVALID_HANDLE_VALUE, "qwen_cli_result_failed");
  std::wstring command = quote(cli.wstring());
  std::vector<std::wstring> args;
  if (!vad_only) args = {L"--backend", parakeet ? L"parakeet" : reazonspeech ? L"reazonspeech" : L"qwen3", L"-m", models.at(ModelRole::Model).wstring(),
      L"--vad", L"-vm", models.at(ModelRole::Vad).wstring(),
      L"--strict-pipeline", L"--require-vad", L"--require-word-timestamps", L"-l", L"ja",
      L"--split-on-punct", L"-ojf", L"-of", (work / "result").wstring(), L"-f", relative_audio.wstring(),
      L"--gpu-backend", wide(to_string(request.device)), L"-t", L"8", L"--cache-dir", (work / "cache").wstring()};
  if (!vad_only && !parakeet_family) { args.push_back(L"-am"); args.push_back(models.at(ModelRole::Aligner).wstring()); }
  if (vad_only) {
    const auto config = request.vad_config.value_or(VadConfig{});
    args = {L"--vad-export-raw", result.wstring(), L"--vad", L"-vm", models.at(ModelRole::Vad).wstring(),
        L"-f", relative_audio.wstring(), L"--gpu-backend", L"cpu", L"--strict-pipeline", L"--require-vad",
        L"-vt", wide(Json(config.threshold.value_or(0.5)).dump()),
        L"-vsd", std::to_wstring(config.min_silence_duration_ms.value_or(100)), L"-t", L"8"};
  }
  if (device == Device::Cpu) args.push_back(L"--no-gpu");
  for (const auto& arg : args) command += L" " + quote(arg);
  wchar_t system[32768]{};
  require(GetSystemDirectoryW(system, 32768) != 0, "qwen_cli_runtime_invalid");
  const auto root = fs::path(system).parent_path().wstring();
  // No inherited PATH, model cache, loader or device knobs. All non-system DLLs
  // must be beside the CLI; the host verifies the distributed file set.
  std::map<std::wstring, std::wstring> env = {
      {parakeet ? L"HIKARU_PARAKEET_DEVICE" : reazonspeech ? L"HIKARU_REAZONSPEECH_DEVICE" : L"HIKARU_QWEN_DEVICE", wide(to_string(request.device))},
      {L"PATH", cli.parent_path().wstring() + L";" + system},
      {L"SystemRoot", root}, {L"TEMP", work.wstring()}, {L"TMP", work.wstring()}, {L"WINDIR", root}};
  if (vad_only) {
    env.erase(L"HIKARU_QWEN_DEVICE");
    env[L"HIKARU_VAD_ONLY"] = L"1";
    env[L"CRISPASR_VAD_FAILOVER"] = L"0";
  }
  std::wstring environment;
  for (const auto& [key, value] : env) { environment += key + L"=" + value; environment += L'\0'; }
  environment += L'\0';
  SECURITY_ATTRIBUTES security{sizeof(security), nullptr, TRUE};
  HANDLE read_pipe = nullptr, write_pipe = nullptr;
  require(CreatePipe(&read_pipe, &write_pipe, &security, 0), "qwen_cli_process_failed");
  Handle reader(read_pipe), writer(write_pipe);
  require(SetHandleInformation(reader.value, HANDLE_FLAG_INHERIT, 0), "qwen_cli_process_failed");
  Handle null(CreateFileW(L"NUL", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                          &security, OPEN_EXISTING, 0, nullptr));
  require(null.value != INVALID_HANDLE_VALUE, "qwen_cli_process_failed");
  // Only these handles cross the boundary, never protocol stdout or job handles.
  // Relative audio is derived from and checked against the canonical request.
  // This avoids miniaudio's extended-path failure without changing the decoder.
  // Controlled-mode CLI decoding fails before any alternate decoder/subprocess.
  SIZE_T size = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
  std::vector<unsigned char> attributes(size);
  auto* list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
  require(InitializeProcThreadAttributeList(list, 1, 0, &size), "qwen_cli_process_failed");
  struct AttributeCleanup { LPPROC_THREAD_ATTRIBUTE_LIST p; ~AttributeCleanup(){ DeleteProcThreadAttributeList(p); } } ac{list};
  HANDLE inherited[] = {null.value, writer.value};
  require(UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited,
          sizeof(inherited), nullptr, nullptr), "qwen_cli_process_failed");
  STARTUPINFOEXW startup{}; startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = null.value; startup.StartupInfo.hStdOutput = null.value;
  startup.StartupInfo.hStdError = writer.value; startup.lpAttributeList = list;
  Handle job(CreateJobObjectW(nullptr, nullptr));
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limit{};
  limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  require(job.value && SetInformationJobObject(job.value, JobObjectExtendedLimitInformation,
          &limit, sizeof(limit)), "qwen_cli_process_failed");
  PROCESS_INFORMATION process{};
  require(CreateProcessW(cli.c_str(), command.data(), nullptr, nullptr, TRUE,
      CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
      environment.data(), cwd.c_str(), &startup.StartupInfo, &process), "qwen_cli_process_failed");
  Handle child(process.hProcess), thread(process.hThread);
  if (!AssignProcessToJobObject(job.value, child.value) || ResumeThread(thread.value) == DWORD(-1)) {
    TerminateProcess(child.value, 20); WaitForSingleObject(child.value, INFINITE);
    throw Error("qwen_cli_process_failed");
  }
  CloseHandle(writer.value); writer.value = INVALID_HANDLE_VALUE;
  Execution execution;
  std::string line;
  char buffer[4096]; DWORD count = 0;
  auto last_progress = std::chrono::steady_clock::now();
  std::size_t diagnostic_bytes = 0;
  const auto consume = [&] {
    const auto previous = execution.slice;
    if (execution.line(line, to_string(device), request.engine, vad_only))
      last_progress = std::chrono::steady_clock::now();
    if ((parakeet_family || vad_only) && execution.slice > previous) {
      // Slice counts cannot exceed milliseconds in the bounded PCM WAV. This
      // also bounds the integer fraction used by the protocol progress bridge.
      require(execution.total <= duration, "qwen_cli_execution_invalid");
      progress(execution.slice, execution.total);
    }
    line.clear();
  };
  // The Parakeet-family routes emit monotonic stage/slice progress in this pinned CLI.
  // Keep Qwen's accepted wait/cancel policy: graph diagnostics are execution
  // assertions, not a progress clock or a reason to impose a total-time cutoff.
  while (true) {
    require(!(parakeet_family || vad_only) || std::chrono::steady_clock::now() - last_progress < std::chrono::seconds(120),
            "qwen_cli_no_progress_timeout");
    DWORD available = 0;
    if (!PeekNamedPipe(reader.value, nullptr, 0, nullptr, &available, nullptr)) {
      require(GetLastError() == ERROR_BROKEN_PIPE, "qwen_cli_process_failed");
      if (WaitForSingleObject(child.value, 0) == WAIT_OBJECT_0) break;
    } else if (available) {
      require(ReadFile(reader.value, buffer, std::min<DWORD>(sizeof(buffer), available), &count, nullptr),
              "qwen_cli_process_failed");
      diagnostic_bytes += count;
      require(diagnostic_bytes <= 64 * 1024 * 1024, "qwen_cli_execution_invalid");
      for (DWORD i = 0; i < count; ++i) {
        if (buffer[i] == '\n' || buffer[i] == '\r') { if (!line.empty()) consume(); }
        else {
          require(line.size() < limits::max_stderr_diagnostic_bytes, "qwen_cli_execution_invalid");
          line += buffer[i];
        }
      }
      continue;
    } else if (WaitForSingleObject(child.value, 0) == WAIT_OBJECT_0) break;
    Sleep(5);
  }
  if (!line.empty()) consume();
  DWORD exit = 20;
  require(GetExitCodeProcess(child.value, &exit), "qwen_cli_process_failed");
  TerminateJobObject(job.value, 20);
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  do {
    require(QueryInformationJobObject(job.value, JobObjectBasicAccountingInformation,
            &accounting, sizeof(accounting), nullptr), "qwen_cli_process_failed");
    if (accounting.ActiveProcesses) Sleep(1);
  } while (accounting.ActiveProcesses);
  if (exit != 0) {
    switch (exit) {
      case 20: throw Error("qwen_cli_audio_failed");
      case 30: throw Error("qwen_cli_vad_failed");
      case 31: throw Error("qwen_cli_words_missing");
      case 40: throw Error("qwen_cli_device_or_model_failed");
      case 41: throw Error("qwen_cli_display_fallback");
      case 42: throw Error("qwen_cli_result_write_failed");
      default: throw Error("qwen_cli_exit_" + std::to_string(exit));
    }
  }
  require(!execution.error && execution.vad
      && (device != Device::Cpu || !execution.cpu_cuda), "qwen_cli_execution_invalid");
  LARGE_INTEGER length{};
  require(GetFileSizeEx(output.value, &length) && length.QuadPart > 0
      && length.QuadPart <= static_cast<LONGLONG>(limits::max_event_line_bytes));
  std::string bytes(static_cast<std::size_t>(length.QuadPart), '\0');
  require(ReadFile(output.value, bytes.data(), static_cast<DWORD>(bytes.size()), &count, nullptr)
      && count == bytes.size());
  if (vad_only) require(execution.roles.empty() && execution.slice > 0
      && execution.slice == execution.total, "vad_cli_execution_invalid");
  return {std::move(bytes), std::move(execution), std::move(models), duration};
}
}  // namespace

std::vector<Segment> transcribe(const WorkerRequestV1& request,
                               const std::function<void(std::int64_t)>& ready,
                               const std::function<void(std::int64_t, std::int64_t)>& progress) {
  auto output = run(request, false, ready, progress);
  const auto& bytes = output.bytes;
  const auto& execution = output.execution;
  const auto& models = output.models;
  const auto duration = output.duration;
  const bool parakeet = request.engine == Engine::Parakeet;
  const bool reazonspeech = request.engine == Engine::ReazonSpeechNemo;
  const bool parakeet_family = parakeet || reazonspeech;
  bool silence = false;
  auto segments = parakeet_family
      ? parakeet_cli::parse_result(bytes, duration, silence,
          reazonspeech ? models.at(ModelRole::Model).u8string() : std::string{})
      : qwen_cli::parse_result(bytes, duration, silence);
  const auto expected = !parakeet_family ? std::set<std::string>{"asr", "aligner", "lazy-audio"}
      : request.device == Device::Cpu ? std::set<std::string>{"parakeet-encoder"}
      : std::set<std::string>{"parakeet-encoder", "parakeet-predictor", "parakeet-joint"};
  const bool decoder_proved = parakeet ? execution.tdt : !reazonspeech || execution.rnnt;
  require(silence || (execution.roles == expected && decoder_proved),
          "qwen_cli_execution_invalid");
  return segments;
}
std::vector<SpeechSpan> parse_vad_result(const std::string& bytes, std::int64_t samples) {
  const auto root = document(bytes, samples);
  const auto& vad = root.at("crispasr_vad");
  require(integer(vad.at("version")) == 1 && text(vad.at("kind")) == "vad_segments"
      && integer(vad.at("sample_rate")) == 16000);
  const auto& slices = vad.at("slices");
  require(slices.is_array() && slices.size() <= limits::max_replacement_segments
      && integer(vad.at("num_slices")) == static_cast<std::int64_t>(slices.size()));
  std::vector<SpeechSpan> spans;
  std::int64_t previous = 0;
  for (const auto& slice : slices) {
    const auto start = integer(slice.at("start")), end = integer(slice.at("end"));
    require(start >= previous && start < end && end <= samples);
    spans.push_back({start, end});
    previous = end;
  }
  return spans;
}

std::vector<SpeechSpan> detect_speech(const WorkerRequestV1& request, std::int64_t samples,
                                    const std::function<void(std::int64_t, std::int64_t)>& progress) {
  return parse_vad_result(run(request, true, {}, progress).bytes, samples);
}
}  // namespace hikaru_asr::full_cli
