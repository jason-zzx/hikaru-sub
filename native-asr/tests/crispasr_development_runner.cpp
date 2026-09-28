#include "crispasr_backend.hpp"
#include "parakeet_family_policy.hpp"

#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#include <psapi.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cstdlib>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using Clock = std::chrono::steady_clock;
using Json = nlohmann::json;
using namespace hikaru_asr;
using namespace hikaru_asr::crisp;
namespace fs = std::filesystem;

void check(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

std::string required_arg(const std::vector<std::string>& args, const std::string& name) {
  const auto found = std::find(args.begin(), args.end(), name);
  if (found == args.end() || std::next(found) == args.end()) throw std::runtime_error("missing argument: " + name);
  return *std::next(found);
}

std::optional<std::string> optional_arg(const std::vector<std::string>& args, const std::string& name) {
  const auto found = std::find(args.begin(), args.end(), name);
  return found == args.end() ? std::nullopt : std::optional<std::string>(*std::next(found));
}

bool is_under(const fs::path& path, const fs::path& root) {
  std::error_code error;
  const fs::path canonical_path = fs::weakly_canonical(path, error);
  if (error) return false;
  const fs::path canonical_root = fs::weakly_canonical(root, error);
  if (error) return false;
  const auto relative = canonical_path.lexically_relative(canonical_root);
  return !relative.empty() && *relative.begin() != "..";
}

bool is_under_declared_local_root(const fs::path& path, const fs::path& root) {
  const std::array<fs::path, 3> declared{
      fs::u8path(T09_LOCAL_ROOT), fs::u8path(T10_LOCAL_ROOT), fs::u8path(T10R_LOCAL_ROOT)};
  std::error_code error;
  const fs::path canonical_root = fs::weakly_canonical(root, error);
  if (error) return false;
  const bool known = std::any_of(declared.begin(), declared.end(), [&](const fs::path& candidate) {
    std::error_code candidate_error;
    return fs::weakly_canonical(candidate, candidate_error) == canonical_root && !candidate_error;
  });
  return known && is_under(path, canonical_root);
}

fs::path current_executable() {
  std::vector<wchar_t> buffer(32768);
  const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  check(length > 0 && length < buffer.size(), "executable path failed");
  return fs::path(std::wstring(buffer.data(), length));
}

Json loaded_modules(
    const fs::path& runtime_bin,
    const fs::path& runtime_root,
    const fs::path& cuda_bin,
    const fs::path& system32) {
  std::vector<HMODULE> modules(256);
  DWORD bytes = 0;
  while (EnumProcessModules(GetCurrentProcess(), modules.data(), static_cast<DWORD>(modules.size() * sizeof(HMODULE)), &bytes)
         && bytes > modules.size() * sizeof(HMODULE)) {
    modules.resize(bytes / sizeof(HMODULE));
  }
  check(bytes > 0 && bytes <= modules.size() * sizeof(HMODULE), "module inventory failed");
  Json output = Json::array();
  std::vector<wchar_t> buffer(32768);
  for (std::size_t index = 0; index < bytes / sizeof(HMODULE); ++index) {
    const DWORD length = GetModuleFileNameExW(GetCurrentProcess(), modules[index], buffer.data(), static_cast<DWORD>(buffer.size()));
    if (length == 0 || length >= buffer.size()) continue;
    const fs::path path(std::wstring(buffer.data(), length));
    std::error_code error;
    if (!fs::is_regular_file(path, error) || error) continue;
    std::string role;
    fs::path relative;
    for (const auto& [candidate_role, root] : std::array<std::pair<const char*, fs::path>, 4>{{
             {"runtime-bin", runtime_bin}, {"runtime-bin", runtime_root},
             {"cuda-bin", cuda_bin}, {"system32", system32}}}) {
      relative = fs::weakly_canonical(path, error).lexically_relative(fs::weakly_canonical(root, error));
      if (!error && !relative.empty() && *relative.begin() != "..") {
        role = candidate_role;
        break;
      }
    }
    if (role.empty()) continue;
    output.push_back(Json{{"name", path.filename().u8string()}, {"rootRole", role},
                          {"relativePath", relative.generic_u8string()}});
  }
  std::sort(output.begin(), output.end(), [](const Json& left, const Json& right) { return left["name"] < right["name"]; });
  return output;
}

Json cuda_device_identity() {
  HMODULE cuda = LoadLibraryExW(L"nvcuda.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!cuda) throw BackendError("crispasr_device_unavailable", "CUDA driver module is unavailable");
  using Init = int (*)(unsigned int);
  using DeviceGet = int (*)(int*, int);
  using DeviceName = int (*)(char*, int, int);
  using Compute = int (*)(int*, int*, int);
  using DriverVersion = int (*)(int*);
  const auto init = reinterpret_cast<Init>(GetProcAddress(cuda, "cuInit"));
  const auto device_get = reinterpret_cast<DeviceGet>(GetProcAddress(cuda, "cuDeviceGet"));
  const auto device_name = reinterpret_cast<DeviceName>(GetProcAddress(cuda, "cuDeviceGetName"));
  const auto compute = reinterpret_cast<Compute>(GetProcAddress(cuda, "cuDeviceComputeCapability"));
  const auto driver = reinterpret_cast<DriverVersion>(GetProcAddress(cuda, "cuDriverGetVersion"));
  if (!init || !device_get || !device_name || !compute || !driver || init(0) != 0) {
    FreeLibrary(cuda);
    throw BackendError("crispasr_device_unavailable", "CUDA Driver API initialization failed");
  }
  int device = 0;
  int major = 0;
  int minor = 0;
  int version = 0;
  std::array<char, 256> name{};
  if (device_get(&device, 0) != 0 || device_name(name.data(), static_cast<int>(name.size()), device) != 0
      || compute(&major, &minor, device) != 0 || driver(&version) != 0) {
    FreeLibrary(cuda);
    throw BackendError("crispasr_device_unavailable", "CUDA device 0 query failed");
  }
  FreeLibrary(cuda);
  return Json{{"index", 0}, {"name", name.data()}, {"computeCapability", std::to_string(major) + "." + std::to_string(minor)},
              {"driverApiVersion", version}};
}

bool privacy_passes(const fs::path& stderr_path, const std::vector<fs::path>& private_paths) {
  std::ifstream input(stderr_path, std::ios::binary);
  if (!input) return false;
  const std::string value((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
  const std::string lower = [&] {
    std::string copy = value;
    std::transform(copy.begin(), copy.end(), copy.begin(), [](unsigned char item) { return static_cast<char>(std::tolower(item)); });
    return copy;
  }();
  for (const char* secret : {"authorization:", "bearer ", "password=", "begin private key"}) {
    if (lower.find(secret) != std::string::npos) return false;
  }
  for (const auto& path : private_paths) {
    if (value.find(path.u8string()) != std::string::npos) return false;
  }
  return true;
}

void require_file(const fs::path& path, const char* role) {
  check(fs::is_regular_file(path), std::string(role) + " is missing");
}
void atomic_json(const fs::path& path, const Json& value) {
  fs::create_directories(path.parent_path());
  const fs::path temporary = path.string() + ".tmp";
  std::ofstream(temporary, std::ios::binary) << std::setw(2) << value << '\n';
  fs::remove(path);
  fs::rename(temporary, path);
}

Engine family_engine(const std::string& family) {
  if (family == "parakeet-family") return Engine::ReazonSpeechNemo;
  if (family == "qwen3-family") return Engine::Qwen3Asr;
  throw std::runtime_error("invalid family");
}

Engine t10_engine(const std::string& name) {
  if (name == "parakeet") return Engine::Parakeet;
  if (name == "reazonspeech-nemo") return Engine::ReazonSpeechNemo;
  throw std::runtime_error("invalid T10 engine");
}

void run_t10(const std::vector<std::string>& args) {
  const auto process_started = Clock::now();
  const std::string engine_name = required_arg(args, "--engine");
  const std::string case_id = required_arg(args, "--case");
  const std::string device_name = required_arg(args, "--device");
  const std::string run_kind = required_arg(args, "--run-kind");
  const int repeat_index = std::stoi(required_arg(args, "--repeat-index"));
  check(case_id == "short-v1" || case_id == "medium-v1" || case_id == "long-v2", "invalid T10 case");
  check(device_name == "cpu" || device_name == "cuda", "invalid T10 device");
  check(run_kind == "cold" || run_kind == "warm" || run_kind == "measured", "invalid T10 run kind");
  check(repeat_index >= 0, "invalid T10 repeat index");
  const fs::path library = fs::u8path(required_arg(args, "--library"));
  const fs::path worker = fs::u8path(required_arg(args, "--worker"));
  const fs::path model = fs::u8path(required_arg(args, "--model"));
  const fs::path audio = fs::u8path(required_arg(args, "--audio"));
  const fs::path output = fs::u8path(required_arg(args, "--output"));
  check(output.extension() == ".json"
            && is_under_declared_local_root(output, fs::u8path(T10_LOCAL_ROOT)),
        "T10 output escapes the canonical task-local ignored root");
  check(fs::is_regular_file(library) && fs::is_regular_file(worker), "T10 runtime/worker missing");
  const Engine engine = t10_engine(engine_name);
  require_file(model, engine == Engine::Parakeet ? "Parakeet model" : "Reazon model");
  const std::map<std::string, std::int64_t> cases{
      {"short-v1", 24102}, {"medium-v1", 498872}, {"long-v2", 4144235}};
  const std::int64_t declared_duration = cases.at(case_id);
  require_file(audio, "T10 audio");
  const Device device = device_name == "cuda" ? Device::Cuda : Device::Cpu;
  const fs::path runtime_bin = current_executable().parent_path();
  const fs::path runtime_root = library.parent_path();
  const fs::path cuda_bin = fs::u8path(R"(C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin)");
  const fs::path system32 = fs::path(std::getenv("SystemRoot")) / "System32";

  Json raw{
      {"schema", "hikaru-t10-parakeet-family-attempt-v1"},
      {"engine", engine_name}, {"resolvedBackend", upstream_backend(engine)},
      {"caseId", case_id}, {"device", device_name},
      {"runKind", run_kind}, {"repeatIndex", repeat_index},
      {"candidateId", engine == Engine::Parakeet ? "P1-window15s-native-word-v1" : "R1-window15s-top-level-v1"},
      {"windowDurationMs", parakeet_family::window_duration_ms}, {"overlapMs", 0},
      {"maxCueCodePoints", parakeet_family::max_cue_code_points},
      {"maxCueDurationMs", parakeet_family::max_cue_duration_ms},
      {"sourceSegments", Json::array()}, {"finalSegments", Json::array()},
      {"moduleCheckpoints", Json::array()},
      {"status", "failed"}};
  if (device == Device::Cuda) raw["cudaDevice"] = cuda_device_identity();

  const auto open_started = Clock::now();
  CrispAsrBackend backend(BackendConfig{engine, device, audio, model, std::nullopt, library});
  raw["modelOpenMs"] = std::chrono::duration<double, std::milli>(Clock::now() - open_started).count();
  check(backend.duration_ms() == declared_duration, "T10 audio duration drifted");
  raw["moduleCheckpoints"].push_back(Json{{"stage", "post-session-open"},
      {"modules", loaded_modules(runtime_bin, runtime_root, cuda_bin, system32)}});

  std::vector<parakeet_family::WindowResult> windows;
  const auto inference_started = Clock::now();
  for (std::int64_t start_ms = 0; start_ms < backend.duration_ms();) {
    const std::int64_t end_ms = std::min(
        start_ms + parakeet_family::window_duration_ms, backend.duration_ms());
    Result result;
    try {
      result = backend.transcribe_window({start_ms, end_ms});
    } catch (const BackendError& error) {
      raw["status"] = "validated-failed";
      raw["errorCode"] = error.code();
      raw["errorMessage"] = error.what();
      raw["failedWindowStartMs"] = start_ms;
      raw["failedWindowEndMs"] = end_ms;
      raw["inferenceMs"] = std::chrono::duration<double, std::milli>(Clock::now() - inference_started).count();
      raw["inferenceRtf"] = raw["inferenceMs"].get<double>() / static_cast<double>(backend.duration_ms());
      PROCESS_MEMORY_COUNTERS_EX memory{};
      memory.cb = sizeof(memory);
      check(GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&memory), sizeof(memory)),
            "T10 RSS query failed");
      raw["peakProcessRssBytes"] = memory.PeakWorkingSetSize;
      raw["runnerWallMs"] = std::chrono::duration<double, std::milli>(Clock::now() - process_started).count();
      atomic_json(output, raw);
      std::cout << Json{{"status", "validated-failed"}, {"engine", engine_name}, {"caseId", case_id},
                         {"code", error.code()}}.dump() << '\n';
      return;
    }
    Json source_segments = Json::array();
    for (const NativeSegment& segment : result.source_segments) {
      Json words = Json::array();
      for (const NativeWord& word : segment.words) {
        words.push_back(Json{{"text", word.text}, {"startMs", word.start_ms}, {"endMs", word.end_ms}});
      }
      source_segments.push_back(Json{{"text", segment.text}, {"startMs", segment.raw_start_ms},
                                      {"endMs", segment.raw_end_ms}, {"words", words}});
    }
    raw["sourceSegments"].push_back(Json{{"windowStartMs", start_ms}, {"windowEndMs", end_ms},
                                           {"segments", source_segments}});
    windows.push_back({start_ms, end_ms, std::move(result.source_segments)});
    start_ms = end_ms;
  }
  const double inference_ms = std::chrono::duration<double, std::milli>(Clock::now() - inference_started).count();
  raw["inferenceMs"] = inference_ms;
  raw["inferenceRtf"] = inference_ms / static_cast<double>(backend.duration_ms());
  raw["moduleCheckpoints"].push_back(Json{{"stage", "post-transcribe"},
      {"modules", loaded_modules(runtime_bin, runtime_root, cuda_bin, system32)}});

  const parakeet_family::PolicyResult policy =
      parakeet_family::assemble_segments(engine, windows, backend.duration_ms());
  if (!policy.error_code.empty()) {
    raw["status"] = "validated-failed";
    raw["errorCode"] = policy.error_code;
  } else {
    EventV1 replacement;
    replacement.type = EventType::SegmentsReplace;
    replacement.segments = policy.segments;
    std::string line;
    ProtocolError error;
    check(serialize_event(replacement, line, error), "T10 replacement is not protocol-serializable");
    raw["replacementBytes"] = line.size();
    for (const Segment& segment : policy.segments) {
      raw["finalSegments"].push_back(Json{{"startMs", segment.start_ms}, {"endMs", segment.end_ms}, {"text", segment.text}});
    }
    raw["status"] = "completed";
  }
  PROCESS_MEMORY_COUNTERS_EX memory{};
  memory.cb = sizeof(memory);
  check(GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&memory), sizeof(memory)),
        "T10 RSS query failed");
  raw["peakProcessRssBytes"] = memory.PeakWorkingSetSize;
  raw["runnerWallMs"] = std::chrono::duration<double, std::milli>(Clock::now() - process_started).count();
  atomic_json(output, raw);
  std::cout << Json{{"status", raw["status"]}, {"engine", engine_name}, {"caseId", case_id}}.dump() << '\n';
}

void run(const std::vector<std::string>& args) {
  check(std::find(args.begin(), args.end(), "--run-development-evidence") != args.end(), "invalid runner mode");
  const std::string phase = required_arg(args, "--phase");
  const std::string family = required_arg(args, "--family");
  const std::string device_name = required_arg(args, "--device");
  const std::string sample = required_arg(args, "--sample");
  check(phase == "discovery" || phase == "formal", "invalid phase");
  check(device_name == "cpu" || device_name == "cuda", "invalid device");
  check(sample == "short-v1" || sample == "medium-v1-first-120s", "invalid sample");
  const fs::path library = fs::u8path(required_arg(args, "--library"));
  const fs::path model = fs::u8path(required_arg(args, "--model"));
  const auto aligner_arg = optional_arg(args, "--aligner");
  const std::optional<fs::path> aligner = aligner_arg ? std::optional<fs::path>(fs::u8path(*aligner_arg)) : std::nullopt;
  const fs::path audio = fs::u8path(required_arg(args, "--audio"));
  const fs::path output = fs::u8path(required_arg(args, "--output"));
  const fs::path stderr_log = fs::u8path(required_arg(args, "--stderr-log"));
  check(output.extension() == ".json", "output must be JSON");
  check(is_under_declared_local_root(output, fs::u8path(T09_LOCAL_ROOT)),
        "output escapes the canonical task-local ignored root");
  check(is_under_declared_local_root(stderr_log, fs::u8path(T09_LOCAL_ROOT)),
        "stderr log is outside the ignored root");
  if (!fs::exists(stderr_log)) {
    fs::create_directories(stderr_log.parent_path());
    std::ofstream(stderr_log, std::ios::binary);
  }
  check(fs::is_regular_file(stderr_log), "stderr log is missing");
  check(fs::is_regular_file(library), "runtime missing");
  const Engine engine = family_engine(family);
  require_file(model, family == "parakeet-family" ? "Reazon model" : "Qwen model");
  if (family == "parakeet-family") {
    check(!aligner, "parakeet family does not accept aligner");
  } else {
    check(aligner.has_value(), "Qwen aligner missing");
    require_file(*aligner, "Qwen aligner");
  }
  require_file(audio, "audio");

  const Device device = device_name == "cuda" ? Device::Cuda : Device::Cpu;
  const fs::path runtime_bin = current_executable().parent_path();
  const fs::path worker = runtime_bin / "hikaru-asr-worker.exe";
  check(fs::is_regular_file(worker), "production worker missing beside development runner");
  const fs::path runtime_root = library.parent_path();
  const fs::path cuda_bin = fs::u8path(R"(C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin)");
  const fs::path system32 = fs::path(std::getenv("SystemRoot")) / "System32";
  check(privacy_passes(stderr_log, {model, aligner.value_or(model), audio}), "stderr privacy scan failed");
  Json raw{
      {"schema", "hikaru-crispasr-development-row-v1"},
      {"phase", phase}, {"family", family}, {"device", device_name}, {"sample", sample},
      {"attemptId", std::to_string(GetCurrentProcessId()) + "-" + std::to_string(Clock::now().time_since_epoch().count())},
      {"openParams", Json{{"abiVersion", 2}, {"threads", 16}, {"useGpu", device == Device::Cuda ? 1 : 0},
                           {"verbosity", 0}, {"flashAttn", 0}, {"gpuLayers", device == Device::Cuda ? -1 : 0},
                           {"preference", device == Device::Cuda ? "cuda" : "none"}}},
      {"resolvedComputeDeviceAvailable", false},
      {"restrictedPath", Json{{"roles", Json::array({"runtime-bin", "cuda-bin", "system32"})}}},
      {"stderr", Json{{"relativePath", fs::weakly_canonical(stderr_log).lexically_relative(fs::weakly_canonical(fs::u8path(T09_LOCAL_ROOT))).generic_u8string()},
                       {"privacyPass", true}}},
      {"generations", Json::array()}, {"moduleCheckpoints", Json::array()}};
  if (device == Device::Cuda) raw["cudaDevice"] = cuda_device_identity();

  try {
    const auto process_start = Clock::now();
    CrispAsrBackend backend(BackendConfig{engine, device, audio, model, aligner, library});
    raw["moduleCheckpoints"].push_back(Json{{"stage", "post-session-open"},
                                               {"modules", loaded_modules(runtime_bin, runtime_root, cuda_bin, system32)}});
    const int repeats = phase == "discovery" ? 1 : 4;
    for (int repeat = 0; repeat < repeats; ++repeat) {
      const auto started = Clock::now();
      const Result result = backend.transcribe();
      const double elapsed = std::chrono::duration<double, std::milli>(Clock::now() - started).count();
      const bool qwen = engine == Engine::Qwen3Asr;
      check(!result.source_segments.empty(), "source segments missing");
      check(!qwen || !result.alignment.empty(), "Qwen alignment missing");
      std::int64_t max_alignment_tail_overrun_ms = 0;
      Json alignment_ranges = Json::array();
      if (qwen) {
        for (const AlignmentEntry& entry : result.alignment) {
          max_alignment_tail_overrun_ms = std::max(
              max_alignment_tail_overrun_ms,
              std::max<std::int64_t>(0, entry.end_ms - backend.duration_ms()));
          alignment_ranges.push_back(Json::array({entry.start_ms, entry.end_ms}));
        }
      }
      raw["generations"].push_back(Json{
          {"repeatIndex", repeat}, {"temperature", repeat == 0 ? "cold" : "warm"},
          {"inferenceMs", elapsed}, {"rtf", elapsed / (sample == "short-v1" ? 24102.0 : 120000.0)},
          {"sourceSegmentCount", result.source_segments.size()}, {"alignmentEntryCount", result.alignment.size()},
          {"alignmentRanges", qwen ? alignment_ranges : Json(nullptr)},
          {"maxAlignmentTailOverrunMs", qwen ? Json(max_alignment_tail_overrun_ms) : Json(nullptr)},
          {"terminalCode", qwen ? "qwen_timeline_policy_not_implemented" : "completed"},
          {"acceptedSegmentCount", qwen ? 0 : result.source_segments.size()}});
    }
    raw["moduleCheckpoints"].push_back(Json{{"stage", engine == Engine::Qwen3Asr ? "post-alignment" : "post-transcribe"},
                                              {"modules", loaded_modules(runtime_bin, runtime_root, cuda_bin, system32)}});
    raw["processWallMs"] = std::chrono::duration<double, std::milli>(Clock::now() - process_start).count();
    raw["status"] = "completed";
    atomic_json(output, raw);
  } catch (const BackendError& error) {
    static const std::array<std::string, 6> unavailable_codes{
        "crispasr_library_load_failed", "crispasr_abi_mismatch",
        "crispasr_backend_unavailable", "crispasr_model_load_failed",
        "crispasr_alignment_failed", "crispasr_device_unavailable"};
    if (phase != "discovery"
        || std::find(unavailable_codes.begin(), unavailable_codes.end(), error.code())
            == unavailable_codes.end()) {
      throw;
    }
    raw["status"] = "unavailable";
    raw["errorCode"] = error.code();
    raw["moduleCheckpoints"].push_back(Json{{"stage", "failure"},
                                               {"modules", loaded_modules(runtime_bin, runtime_root, cuda_bin, system32)}});
    atomic_json(output, raw);
    std::cout << Json{{"status", "unavailable"}, {"family", family}, {"code", error.code()}}.dump() << '\n';
    std::exit(20);
  }
  std::cout << Json{{"status", "completed"}, {"family", family}, {"phase", phase}, {"device", device_name}}.dump() << '\n';
}

}  // namespace

int main(int argc, char** argv) {
  try {
    const std::vector<std::string> args(argv + 1, argv + argc);
    if (std::find(args.begin(), args.end(), "--run-t10-evidence") != args.end()) {
      run_t10(args);
    } else {
      run(args);
    }
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "crispasr development runner rejected: " << error.what() << '\n';
    return 2;
  }
}
