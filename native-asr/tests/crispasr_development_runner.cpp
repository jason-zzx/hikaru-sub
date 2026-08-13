#include "crispasr_backend.hpp"

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

std::string digest_hex(const unsigned char* digest, std::size_t size) {
  std::ostringstream output;
  for (std::size_t index = 0; index < size; ++index) {
    output << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(digest[index]);
  }
  return output.str();
}

std::string sha256_file(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  check(static_cast<bool>(input), "cannot hash input");
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  ULONG object_length = 0;
  ULONG returned = 0;
  check(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0, "SHA-256 provider failed");
  check(BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&object_length), sizeof(object_length), &returned, 0) == 0,
        "SHA-256 property failed");
  std::vector<unsigned char> object(object_length);
  check(BCryptCreateHash(algorithm, &hash, object.data(), object_length, nullptr, 0, 0) == 0, "SHA-256 create failed");
  std::vector<unsigned char> buffer(1 << 20);
  while (input) {
    input.read(reinterpret_cast<char*>(buffer.data()), static_cast<std::streamsize>(buffer.size()));
    if (input.gcount() > 0) check(BCryptHashData(hash, buffer.data(), static_cast<ULONG>(input.gcount()), 0) == 0, "SHA-256 update failed");
  }
  std::array<unsigned char, 32> digest{};
  check(BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) == 0, "SHA-256 finish failed");
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  return digest_hex(digest.data(), digest.size());
}

Json file_identity(const fs::path& path) {
  return Json{{"sizeBytes", fs::file_size(path)}, {"sha256", sha256_file(path)}};
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
                          {"relativePath", relative.generic_u8string()}, {"identity", file_identity(path)}});
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

std::string sha256_text(const std::string& value) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  std::array<unsigned char, 32> digest{};
  check(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0, "SHA-256 provider failed");
  check(BCryptHash(algorithm, nullptr, 0, reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())),
                   static_cast<ULONG>(value.size()), digest.data(), static_cast<ULONG>(digest.size())) == 0,
        "SHA-256 failed");
  BCryptCloseAlgorithmProvider(algorithm, 0);
  return digest_hex(digest.data(), digest.size());
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

void validate_identity(const fs::path& path, std::uintmax_t size, const char* hash, const char* role) {
  check(fs::is_regular_file(path) && fs::file_size(path) == size && sha256_file(path) == hash,
        std::string(role) + " identity drifted");
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

void run(const std::vector<std::string>& args) {
  check(std::find(args.begin(), args.end(), "--run-development-evidence") != args.end(), "invalid runner mode");
  const std::string phase = required_arg(args, "--phase");
  const std::string family = required_arg(args, "--family");
  const std::string device_name = required_arg(args, "--device");
  const std::string sample = required_arg(args, "--sample");
  check(phase == "discovery" || phase == "formal", "invalid phase");
  check(device_name == "cpu" || device_name == "cuda", "invalid device");
  check(sample == "short-v1" || sample == "medium-v1-first-120s", "invalid sample");
  const fs::path lock = fs::u8path(required_arg(args, "--input-lock"));
  const fs::path expected_lock = fs::u8path(T09_LOCAL_ROOT).parent_path() / "crispasr-development-lock.md";
  const fs::path library = fs::u8path(required_arg(args, "--library"));
  const fs::path model = fs::u8path(required_arg(args, "--model"));
  const auto aligner_arg = optional_arg(args, "--aligner");
  const std::optional<fs::path> aligner = aligner_arg ? std::optional<fs::path>(fs::u8path(*aligner_arg)) : std::nullopt;
  const fs::path audio = fs::u8path(required_arg(args, "--audio"));
  const fs::path output = fs::u8path(required_arg(args, "--output"));
  const fs::path stderr_log = fs::u8path(required_arg(args, "--stderr-log"));
  check(output.extension() == ".json", "output must be JSON");
  check(is_under(output, fs::u8path(T09_LOCAL_ROOT)), "output escapes the canonical task-local ignored root");
  check(is_under(stderr_log, fs::u8path(T09_LOCAL_ROOT)),
        "stderr log is outside the ignored root");
  if (!fs::exists(stderr_log)) {
    fs::create_directories(stderr_log.parent_path());
    std::ofstream(stderr_log, std::ios::binary);
  }
  check(fs::is_regular_file(stderr_log), "stderr log is missing");
  check(fs::is_regular_file(lock) && fs::equivalent(lock, expected_lock), "input lock path is not the tracked T09 lock");
  check(fs::is_regular_file(library), "runtime missing");
  const Engine engine = family_engine(family);
  if (family == "parakeet-family") {
    validate_identity(model, 667147072, "20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2", "Reazon model");
    check(!aligner, "parakeet family does not accept aligner");
  } else {
    validate_identity(model, 1490915200, "ec197cef7ccc589fdcae1becc3f4a3de119d0a41e790b898b519b1a048dad8d4", "Qwen model");
    check(aligner.has_value(), "Qwen aligner missing");
    validate_identity(*aligner, 529001216, "a7bb4cbeacc6414f11a5d23dc7661a51a941a71e6d559dc7b408b52473f2ae84", "Qwen aligner");
  }
  if (sample == "short-v1") {
    validate_identity(audio, 771728, "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211", "short audio");
  } else {
    validate_identity(audio, 3840044, "d7b8c62d1358eee4f7ca40596ec424e91cde6992654add5c0219cdeed3907b42", "120-second audio");
  }

  const Device device = device_name == "cuda" ? Device::Cuda : Device::Cpu;
  const fs::path runtime_bin = current_executable().parent_path();
  const fs::path worker = runtime_bin / "hikaru-asr-worker.exe";
  check(fs::is_regular_file(worker), "production worker missing beside development runner");
  const fs::path runtime_root = library.parent_path();
  const fs::path cuda_bin = fs::u8path(R"(C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin)");
  const fs::path system32 = fs::path(std::getenv("SystemRoot")) / "System32";
  const std::string path_identity = runtime_bin.u8string() + ";" + cuda_bin.u8string() + ";" + system32.u8string();
  check(privacy_passes(stderr_log, {model, aligner.value_or(model), audio}), "stderr privacy scan failed");
  Json raw{
      {"schema", "hikaru-crispasr-development-row-v1"},
      {"phase", phase}, {"family", family}, {"device", device_name}, {"sample", sample},
      {"attemptId", std::to_string(GetCurrentProcessId()) + "-" + std::to_string(Clock::now().time_since_epoch().count())},
      {"inputLock", file_identity(lock)}, {"runner", file_identity(current_executable())},
      {"worker", file_identity(worker)}, {"library", file_identity(library)},
      {"model", file_identity(model)}, {"audio", file_identity(audio)},
      {"openParams", Json{{"abiVersion", 2}, {"threads", 16}, {"useGpu", device == Device::Cuda ? 1 : 0},
                           {"verbosity", 0}, {"flashAttn", 0}, {"gpuLayers", device == Device::Cuda ? -1 : 0},
                           {"preference", device == Device::Cuda ? "cuda" : "none"}}},
      {"resolvedComputeDeviceAvailable", false},
      {"restrictedPath", Json{{"roles", Json::array({"runtime-bin", "cuda-bin", "system32"})},
                                {"sha256", sha256_text(path_identity)}}},
      {"stderr", Json{{"relativePath", fs::weakly_canonical(stderr_log).lexically_relative(fs::weakly_canonical(fs::u8path(T09_LOCAL_ROOT))).generic_u8string()},
                       {"sizeBytes", fs::file_size(stderr_log)}, {"sha256", sha256_file(stderr_log)}, {"privacyPass", true}}},
      {"generations", Json::array()}, {"moduleCheckpoints", Json::array()}};
  if (aligner) raw["aligner"] = file_identity(*aligner);
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
    run(std::vector<std::string>(argv + 1, argv + argc));
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "crispasr development runner rejected: " << error.what() << '\n';
    return 2;
  }
}
