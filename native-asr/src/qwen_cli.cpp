#include "qwen_cli.hpp"
#include "wav_audio.hpp"
#include <hikaru_asr/qwen_cli_identity.hpp>
#include <nlohmann/json.hpp>

#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#include <algorithm>
#include <array>
#include <fstream>
#include <map>
#include <regex>
#include <set>
#include <sstream>
#include <thread>

namespace hikaru_asr::qwen_cli {
namespace {
namespace fs = std::filesystem;
using Json = nlohmann::json;
void require(bool ok, const char* code = "qwen_cli_output_invalid") {
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

// Pin each ancestor against rename/reparse replacement for the complete child
// lifetime. File handles deny writes/deletion while the CLI reads exact inputs.
class PinnedPaths {
 public:
  ~PinnedPaths() { for (HANDLE h : handles_) CloseHandle(h); }
  void add(const fs::path& path, bool directory = false) {
    require(path.is_absolute(), "qwen_cli_path_not_absolute");
    for (const auto& part : path) {
      require(part != L"." && part != L"..", "qwen_cli_path_invalid");
    }
    // parent_path preserves extended Windows roots; joining relative_path's
    // drive component with /= would silently discard the extended prefix.
    std::vector<fs::path> ancestors;
    for (auto at = path; at != at.root_path(); at = at.parent_path()) {
      const auto spelling = at.wstring();
      if (spelling.size() == 6 && spelling.rfind(L"\\\\?\\", 0) == 0 && spelling[5] == L':') break;
      ancestors.push_back(at);
    }
    std::reverse(ancestors.begin(), ancestors.end());
    for (const auto& at : ancestors) {
      const bool dir = at != path || directory;
      HANDLE h = CreateFileW(at.c_str(), dir ? FILE_READ_ATTRIBUTES : GENERIC_READ,
          dir ? FILE_SHARE_READ | FILE_SHARE_WRITE : FILE_SHARE_READ, nullptr, OPEN_EXISTING,
          FILE_FLAG_OPEN_REPARSE_POINT | (dir ? FILE_FLAG_BACKUP_SEMANTICS : 0), nullptr);
      require(h != INVALID_HANDLE_VALUE, "qwen_cli_path_open_failed");
      handles_.push_back(h);
      BY_HANDLE_FILE_INFORMATION info{};
      require(GetFileInformationByHandle(h, &info)
          && !(info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
          && bool(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == dir,
          "qwen_cli_path_attributes_invalid");
    }
  }
 private:
  std::vector<HANDLE> handles_;
};
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
void verify_cli(const fs::path& path) {
#ifndef HIKARU_QWEN_CLI_FIXTURE
  require(fs::file_size(path) == identity::size_bytes, "qwen_cli_runtime_invalid");
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0,
          "qwen_cli_runtime_invalid");
  struct Cleanup {
    BCRYPT_ALG_HANDLE& a; BCRYPT_HASH_HANDLE& h;
    ~Cleanup() { if (h) BCryptDestroyHash(h); if (a) BCryptCloseAlgorithmProvider(a, 0); }
  } cleanup{algorithm, hash};
  require(BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0) == 0,
          "qwen_cli_runtime_invalid");
  std::ifstream input(path, std::ios::binary);
  std::array<char, 65536> buffer{};
  while (input) {
    input.read(buffer.data(), buffer.size());
    require(BCryptHashData(hash, reinterpret_cast<PUCHAR>(buffer.data()),
                          static_cast<ULONG>(input.gcount()), 0) == 0, "qwen_cli_runtime_invalid");
  }
  require(input.eof(), "qwen_cli_runtime_invalid");
  std::array<unsigned char, 32> digest{};
  require(BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) == 0,
          "qwen_cli_runtime_invalid");
  std::string hex;
  for (auto c : digest) { hex += "0123456789abcdef"[c >> 4]; hex += "0123456789abcdef"[c & 15]; }
  require(hex == identity::sha256, "qwen_cli_runtime_invalid");
#else
  (void)path;  // Only the separate fixture target accepts its tiny fake CLI.
#endif
}
struct Execution {
  bool error = false, vad = false, cpu_cuda = false;
  std::set<std::string> roles;
  void line(const std::string& value, const std::string& device) {
    if (value.find("hikaru_error:") != std::string::npos) error = true;
    if (value.find("ggml_cuda_init:") != std::string::npos) cpu_cuda = true;
    static const std::regex graph(R"(^hikaru_graph: role=(asr|aligner|lazy-audio) device=(cpu|cuda) nodes=([0-9]+) other=([0-9]+)\r?$)");
    static const std::regex vad_line(R"(^hikaru_vad: device=cpu chunks=([1-9][0-9]*) completed=1\r?$)");
    std::smatch m;
    if (value.rfind("hikaru_graph:", 0) == 0) {
      if (!std::regex_match(value, m, graph) || m[2] != device
          || m[3].str().find_first_not_of('0') == std::string::npos || m[4] != "0") error = true;
      else roles.insert(m[1]);
    }
    if (value.rfind("hikaru_vad:", 0) == 0) {
      if (std::regex_match(value, vad_line)) vad = true;
      else error = true;
    }
  }
};
}  // namespace

std::vector<Segment> parse_result(const std::string& bytes, std::int64_t duration_ms,
                                 bool& silence) {
  try {
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
    const auto root = Json::parse(bytes, callback);
    require(root.at("crispasr").at("backend") == "qwen3"
        && root.at("displayFallback").is_boolean() && root.at("displayFallback") == false
        && root.at("vadSilence").is_boolean());
    silence = root.at("vadSilence").get<bool>();
    const auto& display = root.at("displaySegments");
    const auto& source = root.at("transcription");
    require(display.is_array() && source.is_array()
        && display.size() <= limits::max_replacement_segments);
    std::vector<Segment> segments;
    std::wstring display_text, source_text;
    for (const auto& row : display) {
      Segment segment{integer(row.at("startMs")), integer(row.at("endMs")), text(row.at("text"))};
      // Validate ORIGINAL members before an envelope can conceal a defect.
      const auto content = compact(segment.text);
      require(segment.start_ms >= 0 && segment.end_ms >= segment.start_ms
          && segment.end_ms <= duration_ms && !content.empty()
          && segment.text.size() <= limits::max_text_bytes
          && std::none_of(segment.text.begin(), segment.text.end(), [](unsigned char c) {
            return c < 0x20 || c == 0x7f;
          }));
      display_text += content;
      segments.push_back(std::move(segment));
    }
    for (const auto& row : source) {
      const auto content = compact(text(row.at("text")));
      source_text += content;
      if (content.empty()) continue;
      const auto& words = row.at("words");
      require(words.is_array() && !words.empty());
      bool useful = false;
      for (const auto& word : words) {
        const auto start = integer(word.at("t0")), end = integer(word.at("t1"));
        require(start >= 0 && end >= start && end <= INT64_MAX / 10
            && integer(word.at("offsets").at("from")) == start * 10
            && integer(word.at("offsets").at("to")) == end * 10);
        require(!compact(text(word.at("text"))).empty());
        useful = useful || end > start;
      }
      require(useful);
    }
    require(display_text == source_text);
    require(silence ? source.empty() && display.empty() : !source.empty() && !display.empty());
    // Merge only contiguous zero-duration/start-reversal groups. Keep ranges
    // until grouping is finished, so a backward cascade never recopies text.
    struct Group { std::size_t first, last; Segment envelope; bool positive; };
    std::vector<Group> groups;
    for (std::size_t i = 0; i < segments.size(); ++i) {
      const auto& row = segments[i];
      Group current{i, i, {row.start_ms, row.end_ms, {}}, row.end_ms > row.start_ms};
      const auto join_previous = [&] {
        const auto& previous = groups.back();
        current.first = previous.first;
        current.envelope.start_ms = std::min(previous.envelope.start_ms, current.envelope.start_ms);
        current.envelope.end_ms = std::max(previous.envelope.end_ms, current.envelope.end_ms);
        current.positive = current.positive || previous.positive;
        groups.pop_back();
      };
      // Leading zeros stay pending until an ORIGINAL positive member arrives,
      // even when distinct zero points already give their envelope a duration.
      if (!groups.empty() && (!current.positive || !groups.back().positive)) join_previous();
      while (!groups.empty() && current.envelope.start_ms < groups.back().envelope.start_ms) join_previous();
      groups.push_back(std::move(current));
    }
    EventV1 event; event.type = EventType::SegmentsReplace;
    for (auto& group : groups) {
      require(group.positive);
      std::size_t size = 0;
      for (auto i = group.first; i <= group.last; ++i) size += segments[i].text.size();
      require(size <= limits::max_text_bytes);
      group.envelope.text.reserve(size);
      for (auto i = group.first; i <= group.last; ++i) group.envelope.text += segments[i].text;
      event.segments.push_back(std::move(group.envelope));
    }
    // Unchanged final protocol shape/time/order/aggregate and UTF-8 checks.
    EventSequenceState state;
    state.ready = true; state.duration_ms = duration_ms;
    ProtocolError error; std::string line;
    require(validate_event(state, event, error) && serialize_event(event, line, error));
    return std::move(event.segments);
  } catch (const std::exception&) { throw Error("qwen_cli_output_invalid"); }
}

std::vector<Segment> transcribe(const WorkerRequestV1& request,
                               const std::function<void(std::int64_t)>& ready) {
  require(request.engine == Engine::Qwen3Asr && request.backend == Backend::CrispAsr
      && request.device != Device::Vulkan && request.use_vad && !request.vad_config
      && request.model_paths.size() == 3, "qwen_cli_request_invalid");
  require(!request.job_id.empty() && std::all_of(request.job_id.begin(), request.job_id.end(), [](unsigned char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
  }), "qwen_cli_path_invalid");
  std::map<ModelRole, fs::path> models;
  PinnedPaths pins;
  for (const auto& model : request.model_paths) {
    const fs::path path(wide(model.path)); pins.add(path); models.emplace(model.role, path);
  }
  require(models.count(ModelRole::Model) && models.count(ModelRole::Aligner)
      && models.count(ModelRole::Vad), "qwen_cli_request_invalid");
  const fs::path audio(wide(request.audio_path)); pins.add(audio);

  const fs::path work = audio.parent_path() / "asr-jobs" / (request.job_id + "-cli");
  pins.add(work, true);
  require(fs::is_empty(work), "qwen_cli_work_not_empty");
  const auto relative_audio = audio.lexically_relative(work);
  require(!relative_audio.empty() && !relative_audio.is_absolute()
      && fs::canonical((work / relative_audio).lexically_normal()) == fs::canonical(audio), "qwen_cli_path_invalid");
  const fs::path cli = executable_root() / "crispasr.exe"; pins.add(cli); verify_cli(cli);
  const auto duration = wav::read_pcm16_mono_16khz(audio).duration_ms;
  require(duration > 0, "qwen_cli_audio_invalid");
  ready(duration);
  // A pre-created, delete-denying result cannot be replaced by a symlink.
  // The host owns private workspace cleanup after the whole process tree reaps.
  const fs::path result = work / "result.json";
  Handle output(CreateFileW(result.c_str(), GENERIC_READ,
      FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, CREATE_NEW,
      FILE_ATTRIBUTE_TEMPORARY, nullptr));
  require(output.value != INVALID_HANDLE_VALUE, "qwen_cli_result_failed");
  std::wstring command = quote(cli.wstring());
  std::vector<std::wstring> args = {L"--backend", L"qwen3", L"-m", models.at(ModelRole::Model).wstring(),
      L"-am", models.at(ModelRole::Aligner).wstring(), L"--vad", L"-vm", models.at(ModelRole::Vad).wstring(),
      L"--strict-pipeline", L"--require-vad", L"--require-word-timestamps", L"-l", L"ja",
      L"--split-on-punct", L"-ojf", L"-of", (work / "result").wstring(), L"-f", relative_audio.wstring(),
      L"--gpu-backend", wide(to_string(request.device)), L"-t", L"8", L"--cache-dir", (work / "cache").wstring()};
  if (request.device == Device::Cpu) args.push_back(L"--no-gpu");
  for (const auto& arg : args) command += L" " + quote(arg);
  wchar_t system[32768]{};
  require(GetSystemDirectoryW(system, 32768) != 0, "qwen_cli_runtime_invalid");
  const auto root = fs::path(system).parent_path().wstring();
  // No inherited PATH, model cache, loader or device knobs. All non-system DLLs
  // must be beside the pinned CLI; final artifact closure remains packaging's job.
  const std::map<std::wstring, std::wstring> env = {
      {L"HIKARU_QWEN_DEVICE", wide(to_string(request.device))},
      {L"PATH", cli.parent_path().wstring() + L";" + system},
      {L"SystemRoot", root}, {L"TEMP", work.wstring()}, {L"TMP", work.wstring()}, {L"WINDIR", root}};
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
  // Relative audio is derived from and checked against the exact pinned request.
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
      environment.data(), work.c_str(), &startup.StartupInfo, &process), "qwen_cli_process_failed");
  Handle child(process.hProcess), thread(process.hThread);
  if (!AssignProcessToJobObject(job.value, child.value) || ResumeThread(thread.value) == DWORD(-1)) {
    TerminateProcess(child.value, 20); WaitForSingleObject(child.value, INFINITE);
    throw Error("qwen_cli_process_failed");
  }
  CloseHandle(writer.value); writer.value = INVALID_HANDLE_VALUE;
  Execution execution;
  std::string line;
  char buffer[4096]; DWORD count = 0;
  while (ReadFile(reader.value, buffer, sizeof(buffer), &count, nullptr) && count) {
    for (DWORD i = 0; i < count; ++i) {
      if (buffer[i] == '\n') { execution.line(line, to_string(request.device)); line.clear(); }
      else if (line.size() < limits::max_stderr_diagnostic_bytes) line += buffer[i];
      else execution.error = true; // bounded private inspection, never log raw bytes
    }
  }
  if (!line.empty()) execution.line(line, to_string(request.device));
  WaitForSingleObject(child.value, INFINITE);
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
      && (request.device != Device::Cpu || !execution.cpu_cuda), "qwen_cli_execution_invalid");
  LARGE_INTEGER length{};
  require(GetFileSizeEx(output.value, &length) && length.QuadPart > 0
      && length.QuadPart <= static_cast<LONGLONG>(limits::max_event_line_bytes));
  std::string bytes(static_cast<std::size_t>(length.QuadPart), '\0');
  require(ReadFile(output.value, bytes.data(), static_cast<DWORD>(bytes.size()), &count, nullptr)
      && count == bytes.size());
  bool silence = false;
  auto segments = parse_result(bytes, duration, silence);
  require(silence || execution.roles == std::set<std::string>{"asr", "aligner", "lazy-audio"},
          "qwen_cli_execution_invalid");
  return segments;
}
}  // namespace hikaru_asr::qwen_cli
