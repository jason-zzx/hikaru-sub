#include "ctranslate2_whisper.hpp"
#include "wav_audio.hpp"

#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#include <intrin.h>
#include <psapi.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using Clock = std::chrono::steady_clock;
using Json = nlohmann::json;
using namespace hikaru_asr;
using namespace hikaru_asr::whisper;
namespace fs = std::filesystem;

const Clock::time_point process_started = Clock::now();

void check(bool condition, const std::string& message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

double elapsed_ms(const Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

std::string required_arg(
    const std::vector<std::string>& args,
    const std::string& name) {
  const auto iterator = std::find(args.begin(), args.end(), name);
  if (iterator == args.end() || std::next(iterator) == args.end()) {
    throw std::runtime_error("missing argument: " + name);
  }
  return *std::next(iterator);
}

void validate_closed_mode_args(
    const std::vector<std::string>& args,
    const std::string& mode,
    const std::vector<std::string>& value_args) {
  std::vector<std::string> seen;
  bool found_mode = false;
  for (std::size_t index = 0; index < args.size(); ++index) {
    const std::string& arg = args[index];
    if (arg == mode) {
      check(!found_mode, "duplicate mode argument: " + mode);
      found_mode = true;
      continue;
    }
    check(std::find(value_args.begin(), value_args.end(), arg) != value_args.end(),
          "unknown closed-mode argument: " + arg);
    check(std::find(seen.begin(), seen.end(), arg) == seen.end(),
          "duplicate closed-mode argument: " + arg);
    check(index + 1 < args.size() && args[index + 1].rfind("--", 0) != 0,
          "missing closed-mode argument value: " + arg);
    seen.push_back(arg);
    ++index;
  }
  check(found_mode, "closed mode argument is missing: " + mode);
  check(seen.size() == value_args.size(), "closed mode argument inventory is incomplete");
}

int integer_arg(
    const std::vector<std::string>& args,
    const std::string& name,
    int fallback) {
  const auto iterator = std::find(args.begin(), args.end(), name);
  if (iterator == args.end()) {
    return fallback;
  }
  const int value = std::stoi(*std::next(iterator));
  if (value <= 0) {
    throw std::runtime_error("invalid argument: " + name);
  }
  return value;
}

std::vector<std::size_t> beam_sizes_arg(const std::vector<std::string>& args) {
  std::istringstream input(required_arg(args, "--beam-sizes"));
  std::vector<std::size_t> beams;
  std::string value;
  while (std::getline(input, value, ',')) {
    const int beam = std::stoi(value);
    if (beam <= 0) {
      throw std::runtime_error("invalid beam size");
    }
    beams.push_back(static_cast<std::size_t>(beam));
  }
  const std::vector<std::size_t> initial{1, 5};
  const std::vector<std::size_t> expanded{1, 3, 5, 10};
  check(beams == initial || beams == expanded, "beam probes must be 1,5 or 1,3,5,10");
  return beams;
}

CandidateAConfig short_decode_config(std::size_t beam_size) {
  CandidateAConfig config;
  config.beam_size = beam_size;
  config.condition_on_previous_text = false;
  config.timestamp_driven_seek = true;
  return config;
}

std::vector<std::pair<std::string, CandidateAConfig>> diagnostic_matrix_configs() {
  CandidateAConfig a;
  a.beam_size = 5;
  a.condition_on_previous_text = false;
  a.timestamp_driven_seek = false;

  CandidateAConfig b = a;
  b.timestamp_driven_seek = true;

  CandidateAConfig c = b;
  c.condition_on_previous_text = true;

  CandidateAConfig d = c;
  d.beam_size = 1;

  return {{"A", a}, {"B", b}, {"C", c}, {"D", d}};
}

struct WhisperQualityDiagnosticCell {
  std::string id;
  std::string case_id;
  CandidateAConfig config;
};

std::vector<WhisperQualityDiagnosticCell> whisper_quality_diagnostic_cells() {
  std::vector<WhisperQualityDiagnosticCell> cells;
  for (std::size_t beam_size : {std::size_t{1}, std::size_t{5}}) {
    CandidateAConfig short_config = short_decode_config(beam_size);
    cells.push_back({
        "short-b" + std::to_string(beam_size) + "-off",
        "short-v1",
        short_config});
    for (bool history : {false, true}) {
      CandidateAConfig medium_config = short_config;
      medium_config.condition_on_previous_text = history;
      cells.push_back({
          "medium-b" + std::to_string(beam_size) + (history ? "-on" : "-off"),
          "medium-v1",
          medium_config});
    }
  }
  return cells;
}

WhisperQualityDiagnosticCell whisper_quality_diagnostic_cell(const std::string& id) {
  const auto cells = whisper_quality_diagnostic_cells();
  const auto found = std::find_if(cells.begin(), cells.end(), [&](const auto& cell) {
    return cell.id == id;
  });
  check(found != cells.end(), "T06R diagnostic cell is not allowed");
  return *found;
}

std::vector<WhisperQualityDiagnosticCell> whisper_quality_vad_diagnostic_cells() {
  CandidateAConfig short_config = short_decode_config(5);
  CandidateAConfig medium_config = short_config;
  medium_config.condition_on_previous_text = true;
  return {
      {"short-b5-vad", "short-v1", short_config},
      {"medium-b5-on-vad", "medium-v1", medium_config}};
}

WhisperQualityDiagnosticCell whisper_quality_vad_diagnostic_cell(const std::string& id) {
  const auto cells = whisper_quality_vad_diagnostic_cells();
  const auto found = std::find_if(cells.begin(), cells.end(), [&](const auto& cell) {
    return cell.id == id;
  });
  check(found != cells.end(), "T06R VAD diagnostic cell is not allowed");
  return *found;
}

std::vector<WhisperQualityDiagnosticCell> whisper_quality_fallback_diagnostic_cells() {
  const CandidateAConfig config = upstream_generation_fallback_config();
  return {
      {"short-b5-on-vad-fallback", "short-v1", config},
      {"medium-b5-on-vad-fallback", "medium-v1", config}};
}

WhisperQualityDiagnosticCell whisper_quality_fallback_diagnostic_cell(
    const std::string& id) {
  const auto cells = whisper_quality_fallback_diagnostic_cells();
  const auto found = std::find_if(cells.begin(), cells.end(), [&](const auto& cell) {
    return cell.id == id;
  });
  check(found != cells.end(), "T06R fallback diagnostic cell is not allowed");
  return *found;
}

#ifdef HIKARU_ASR_WHISPER_PARITY_BISECT
struct WhisperExecutionParityCell {
  std::string id;
  std::string mel_role;
  std::string runtime_role;
  std::string runtime_sha256;
};

std::vector<WhisperExecutionParityCell> whisper_execution_parity_cells() {
  constexpr const char* python_runtime =
      "60e536c0801432cde4a105aeebbca35fbf228aa3e901807b2310b02676c2f140";
  constexpr const char* native_runtime =
      "e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2";
  return {
      {"python-runtime-python-mel", "python", "python-wheel", python_runtime},
      {"python-runtime-native-mel", "native", "python-wheel", python_runtime},
      {"native-runtime-python-mel", "python", "native-no-cudnn", native_runtime},
      {"native-runtime-native-mel", "native", "native-no-cudnn", native_runtime},
  };
}

WhisperExecutionParityCell whisper_execution_parity_cell(const std::string& id) {
  const auto cells = whisper_execution_parity_cells();
  const auto found = std::find_if(cells.begin(), cells.end(), [&](const auto& cell) {
    return cell.id == id;
  });
  check(found != cells.end(), "T06D execution-parity cell is not allowed");
  return *found;
}

CandidateAConfig execution_parity_config() {
  CandidateAConfig config;
  config.beam_size = 5;
  config.condition_on_previous_text = true;
  config.timestamp_driven_seek = true;
  return config;
}
#endif

std::string digest_hex(const unsigned char* digest, std::size_t size) {
  std::ostringstream output;
  for (std::size_t index = 0; index < size; ++index) {
    output << std::hex << std::setw(2) << std::setfill('0')
           << static_cast<int>(digest[index]);
  }
  return output.str();
}

std::string read_text_file(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  check(static_cast<bool>(input), "cannot read required text file");
  return std::string(
      std::istreambuf_iterator<char>(input),
      std::istreambuf_iterator<char>());
}

std::string sha256_file(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    throw std::runtime_error("cannot hash required file");
  }
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  check(
      BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0,
      "SHA-256 provider failed");
  ULONG object_length = 0;
  ULONG returned = 0;
  check(
      BCryptGetProperty(
          algorithm,
          BCRYPT_OBJECT_LENGTH,
          reinterpret_cast<PUCHAR>(&object_length),
          sizeof(object_length),
          &returned,
          0) == 0,
      "SHA-256 object length failed");
  std::vector<unsigned char> object(object_length);
  BCRYPT_HASH_HANDLE hash = nullptr;
  check(
      BCryptCreateHash(
          algorithm,
          &hash,
          object.data(),
          object_length,
          nullptr,
          0,
          0) == 0,
      "SHA-256 hash creation failed");
  std::vector<unsigned char> buffer(1 << 20);
  while (input) {
    input.read(
        reinterpret_cast<char*>(buffer.data()),
        static_cast<std::streamsize>(buffer.size()));
    const std::streamsize count = input.gcount();
    if (count > 0) {
      check(
          BCryptHashData(hash, buffer.data(), static_cast<ULONG>(count), 0) == 0,
          "SHA-256 update failed");
    }
  }
  std::array<unsigned char, 32> digest{};
  check(
      BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) == 0,
      "SHA-256 finish failed");
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  return digest_hex(digest.data(), digest.size());
}

#ifdef HIKARU_ASR_WHISPER_PARITY_BISECT
bool is_t06d_task_local_output(const fs::path& path);

std::vector<float> read_execution_parity_mel(
    const fs::path& path,
    int mel_bins,
    const std::string& expected_sha256) {
  check(is_t06d_task_local_output(path),
        "T06D Mel must stay under research/local");
  check(mel_bins == 128,
        "T06D large-v3 contract must expose 128 Mel bins");
  const std::uintmax_t expected_size =
      static_cast<std::uintmax_t>(mel_bins * max_model_frames * sizeof(float));
  check(fs::is_regular_file(path) && fs::file_size(path) == expected_size,
        "T06D Mel shape drifted");
  check(sha256_file(path) == expected_sha256,
        "T06D Mel identity drifted");
  std::ifstream input(path, std::ios::binary);
  check(static_cast<bool>(input), "T06D Mel could not be read");
  std::vector<float> mel(static_cast<std::size_t>(mel_bins * max_model_frames));
  const std::streamsize expected_bytes =
      static_cast<std::streamsize>(mel.size() * sizeof(float));
  input.read(reinterpret_cast<char*>(mel.data()), expected_bytes);
  check(input.gcount() == expected_bytes,
        "T06D Mel read was truncated");
  return mel;
}

void write_execution_parity_mel(
    const fs::path& path,
    const std::vector<float>& mel,
    int mel_bins) {
  check(is_t06d_task_local_output(path),
        "T06D Mel output must stay under research/local");
  check(mel_bins == 128
            && mel.size() == static_cast<std::size_t>(mel_bins * max_model_frames),
        "T06D Mel output shape drifted");
  fs::create_directories(path.parent_path());
  const fs::path temporary = path.string() + ".tmp";
  std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
  output.write(
      reinterpret_cast<const char*>(mel.data()),
      static_cast<std::streamsize>(mel.size() * sizeof(float)));
  check(static_cast<bool>(output), "T06D Mel write failed");
  output.close();
  fs::remove(path);
  fs::rename(temporary, path);
}
#endif

std::string sha256_text(const std::string& text) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  check(
      BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0,
      "SHA-256 provider failed");
  ULONG object_length = 0;
  ULONG returned = 0;
  check(
      BCryptGetProperty(
          algorithm,
          BCRYPT_OBJECT_LENGTH,
          reinterpret_cast<PUCHAR>(&object_length),
          sizeof(object_length),
          &returned,
          0) == 0,
      "SHA-256 object length failed");
  std::vector<unsigned char> object(object_length);
  BCRYPT_HASH_HANDLE hash = nullptr;
  check(
      BCryptCreateHash(
          algorithm,
          &hash,
          object.data(),
          object_length,
          nullptr,
          0,
          0) == 0,
      "SHA-256 hash creation failed");
  check(
      BCryptHashData(
          hash,
          reinterpret_cast<PUCHAR>(const_cast<char*>(text.data())),
          static_cast<ULONG>(text.size()),
          0) == 0,
      "SHA-256 update failed");
  std::array<unsigned char, 32> digest{};
  check(
      BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) == 0,
      "SHA-256 finish failed");
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  return digest_hex(digest.data(), digest.size());
}

Json file_identity(const fs::path& path) {
  return Json{
      {"sizeBytes", fs::file_size(path)},
      {"sha256", sha256_file(path)}};
}

fs::path current_executable() {
  std::vector<wchar_t> buffer(32768);
  const DWORD length = GetModuleFileNameW(
      nullptr,
      buffer.data(),
      static_cast<DWORD>(buffer.size()));
  check(length > 0 && length < buffer.size(), "executable path failed");
  return fs::path(std::wstring(buffer.data(), length));
}

std::size_t peak_working_set() {
  PROCESS_MEMORY_COUNTERS counters{};
  counters.cb = sizeof(counters);
  check(
      GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters)) != 0,
      "peak working set failed");
  return counters.PeakWorkingSetSize;
}

std::string cpu_model() {
  int registers[4]{};
  __cpuid(registers, 0x80000000);
  const unsigned int maximum_leaf = static_cast<unsigned int>(registers[0]);
  if (maximum_leaf < 0x80000004) {
    return "unknown";
  }
  std::array<char, 49> brand{};
  for (unsigned int leaf = 0; leaf < 3; ++leaf) {
    __cpuid(registers, static_cast<int>(0x80000002 + leaf));
    std::memcpy(brand.data() + leaf * 16, registers, 16);
  }
  std::string value(brand.data());
  const auto first = value.find_first_not_of(' ');
  const auto last = value.find_last_not_of(' ');
  return first == std::string::npos ? "unknown" : value.substr(first, last - first + 1);
}

Json available_isa() {
  int registers[4]{};
  __cpuid(registers, 1);
  const bool sse2 = (registers[3] & (1 << 26)) != 0;
  const bool avx = (registers[2] & (1 << 28)) != 0
      && IsProcessorFeaturePresent(PF_AVX_INSTRUCTIONS_AVAILABLE) != 0;
  const bool fma = (registers[2] & (1 << 12)) != 0;
  __cpuidex(registers, 7, 0);
  const bool avx2 = (registers[1] & (1 << 5)) != 0 && avx;
  const bool avx512f = (registers[1] & (1 << 16)) != 0;
  return Json{
      {"sse2", sse2},
      {"avx", avx},
      {"avx2", avx2},
      {"fma", fma},
      {"avx512f", avx512f}};
}

Json cpu_identity() {
  SYSTEM_INFO system{};
  GetNativeSystemInfo(&system);
  check(
      system.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64,
      "CPU architecture is not Windows x64");
  return Json{
      {"architecture", "x86_64"},
      {"model", cpu_model()},
      {"logicalCores", GetActiveProcessorCount(ALL_PROCESSOR_GROUPS)},
      {"availableIsa", available_isa()}};
}

std::string lowercase(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char character) {
    return static_cast<char>(std::tolower(character));
  });
  return value;
}

Json restricted_path_policy() {
  const DWORD path_size = GetEnvironmentVariableW(L"PATH", nullptr, 0);
  check(path_size > 0, "Candidate B restricted PATH is missing");
  std::vector<wchar_t> path_buffer(path_size);
  const DWORD path_length = GetEnvironmentVariableW(
      L"PATH", path_buffer.data(), static_cast<DWORD>(path_buffer.size()));
  check(path_length > 0 && path_length < path_buffer.size(), "Candidate B restricted PATH read failed");

  std::vector<fs::path> entries;
  std::wstringstream input(std::wstring(path_buffer.data(), path_length));
  std::wstring item;
  while (std::getline(input, item, L';')) {
    check(!item.empty(), "Candidate B restricted PATH contains an empty entry");
    entries.emplace_back(item);
  }
  check(entries.size() == 2, "Candidate B restricted PATH must contain exactly two entries");

  std::array<wchar_t, 32768> system_directory_buffer{};
  const UINT system_directory_length = GetSystemDirectoryW(
      system_directory_buffer.data(), static_cast<UINT>(system_directory_buffer.size()));
  check(
      system_directory_length > 0 && system_directory_length < system_directory_buffer.size(),
      "Windows System32 path resolution failed");
  const fs::path executable_directory = fs::weakly_canonical(current_executable()).parent_path();
  const fs::path system_directory = fs::weakly_canonical(
      fs::path(std::wstring(system_directory_buffer.data(), system_directory_length)));
  check(
      fs::equivalent(entries[0], executable_directory)
          && fs::equivalent(entries[1], system_directory),
      "Candidate B restricted PATH order or identity mismatch");

  const std::string roots_identity_input =
      "measurement-executable-directory=" + executable_directory.u8string()
      + "\nwindows-system32=" + system_directory.u8string();
  return Json{
      {"name", "windows-restricted-path-v1"},
      {"restricted", true},
      {"entryCount", 2},
      {"orderedEntryRoles", Json::array({
           "measurement-executable-directory",
           "windows-system32"})},
      {"identitySha256", "439a4172b0cb5d50232784da10208261f69eea476773a2e737b3fe2293a53043"},
      {"rootIdentitySha256", sha256_text(roots_identity_input)},
      {"resolvedRoots", Json::array({
           Json{{"role", "measurement-executable-directory"}, {"canonicalPath", executable_directory.u8string()}},
           Json{{"role", "windows-system32"}, {"canonicalPath", system_directory.u8string()}}})}};
}

Json candidate_b_module_layout() {
  return Json{
      {"name", "candidate-b-module-layout-v2"},
      {"identitySha256", "a650e185dc2983b7e5af7e56f17211cf1c7bf2ab9fadb1ccebf07d04e8323994"},
      {"runnerRootRole", "measurement-executable-directory"},
      {"openmpRootRole", "windows-system32"},
      {"localModuleNames", Json::array({
           "ctranslate2.dll",
           "hikaru_asr_tokenizer.dll",
           "onnxruntime.dll",
           "onnxruntime_providers_shared.dll"})}};
}

Json loaded_runtime_modules() {
  std::array<HMODULE, 1024> modules{};
  DWORD required_bytes = 0;
  check(
      EnumProcessModules(
          GetCurrentProcess(),
          modules.data(),
          static_cast<DWORD>(modules.size() * sizeof(HMODULE)),
          &required_bytes) != 0,
      "loaded module inventory failed");
  check(required_bytes <= modules.size() * sizeof(HMODULE), "loaded module inventory was truncated");
  const std::size_t count = required_bytes / sizeof(HMODULE);
  const std::string executable_name = lowercase(current_executable().filename().u8string());
  Json result = Json::array();
  for (std::size_t index = 0; index < count; ++index) {
    std::array<wchar_t, 32768> buffer{};
    const DWORD length = GetModuleFileNameExW(
        GetCurrentProcess(),
        modules[index],
        buffer.data(),
        static_cast<DWORD>(buffer.size()));
    check(length > 0 && length < buffer.size(), "loaded module path resolution failed");
    const fs::path path = fs::weakly_canonical(fs::path(std::wstring(buffer.data(), length)));
    const std::string name = path.filename().u8string();
    const std::string normalized = lowercase(name);
    if (normalized != executable_name
        && normalized != "ctranslate2.dll"
        && normalized != "hikaru_asr_tokenizer.dll"
        && normalized != "onnxruntime.dll"
        && normalized != "onnxruntime_providers_shared.dll"
        && normalized.find("vcomp") == std::string::npos
        && normalized.find("dnnl") == std::string::npos
        && normalized.find("iomp") == std::string::npos
        && normalized.find("openmp") == std::string::npos) {
      continue;
    }
    Json identity = file_identity(path);
    identity["name"] = name;
    identity["canonicalPath"] = path.u8string();
    result.push_back(std::move(identity));
  }
  std::sort(result.begin(), result.end(), [](const Json& left, const Json& right) {
    return lowercase(left.at("name").get<std::string>())
        < lowercase(right.at("name").get<std::string>());
  });
  return result;
}

const Json& loaded_module_named(const Json& modules, const std::string& name) {
  const std::string expected = lowercase(name);
  const auto iterator = std::find_if(modules.begin(), modules.end(), [&](const Json& module) {
    return lowercase(module.at("name").get<std::string>()) == expected;
  });
  check(iterator != modules.end(), "required runtime module was not actually loaded: " + name);
  return *iterator;
}

void validate_candidate_b_loaded_modules(const Json& modules) {
  const fs::path runtime_directory = fs::weakly_canonical(current_executable()).parent_path();
  std::array<wchar_t, 32768> system_directory_buffer{};
  const UINT system_directory_length = GetSystemDirectoryW(
      system_directory_buffer.data(), static_cast<UINT>(system_directory_buffer.size()));
  check(
      system_directory_length > 0 && system_directory_length < system_directory_buffer.size(),
      "Windows System32 path resolution failed");
  const fs::path system_directory = fs::weakly_canonical(
      fs::path(std::wstring(system_directory_buffer.data(), system_directory_length)));
  for (const std::string& name : {
           current_executable().filename().u8string(),
           std::string("ctranslate2.dll"),
           std::string("hikaru_asr_tokenizer.dll"),
           std::string("onnxruntime.dll")}) {
    const Json& module = loaded_module_named(modules, name);
    const fs::path path = fs::weakly_canonical(fs::u8path(module.at("canonicalPath").get<std::string>()));
    check(
        fs::equivalent(path.parent_path(), runtime_directory),
        "loaded Candidate B module escaped the measurement executable directory: " + name);
  }
  if (std::find_if(modules.begin(), modules.end(), [](const Json& module) {
        return lowercase(module.at("name").get<std::string>())
            == "onnxruntime_providers_shared.dll";
      }) != modules.end()) {
    const Json& module = loaded_module_named(modules, "onnxruntime_providers_shared.dll");
    const fs::path path = fs::weakly_canonical(fs::u8path(module.at("canonicalPath").get<std::string>()));
    check(
        fs::equivalent(path.parent_path(), runtime_directory),
        "loaded Candidate B providers sibling escaped the measurement executable directory");
  }
  for (const Json& module : modules) {
    const std::string name = lowercase(module.at("name").get<std::string>());
    if (name.find("vcomp") == 0 || name.find("openmp") == 0 || name.find("iomp") == 0) {
      const fs::path path = fs::weakly_canonical(fs::u8path(module.at("canonicalPath").get<std::string>()));
      check(
          fs::equivalent(path.parent_path(), system_directory),
          "loaded Candidate B OpenMP module escaped the locked Windows System32 root");
    }
  }
}

bool is_path_within(const fs::path& root_path, const fs::path& path) {
  const fs::path root = fs::weakly_canonical(root_path);
  const fs::path candidate = fs::weakly_canonical(
      path.is_absolute() ? path : fs::absolute(path));
  const fs::path relative = candidate.lexically_relative(root);
  if (relative.empty() || relative.is_absolute()) {
    return false;
  }
  const auto first = relative.begin();
  return first != relative.end() && *first != "..";
}

bool is_task_local_output(const fs::path& path) {
  return is_path_within(fs::path(T06_LOCAL_ROOT), path);
}

bool is_t07_task_local_output(const fs::path& path) {
  return is_path_within(fs::path(T07_LOCAL_ROOT), path);
}

bool is_t06r_task_local_output(const fs::path& path) {
  return is_path_within(fs::path(T06R_LOCAL_ROOT), path);
}

bool is_t06d_task_local_output(const fs::path& path) {
  return is_path_within(fs::path(T06D_LOCAL_ROOT), path);
}

bool is_t06r_tracked_research_file(const fs::path& path) {
  return is_path_within(fs::path(T06R_LOCAL_ROOT).parent_path(), path)
      && !is_t06r_task_local_output(path);
}

bool is_t08_task_local_output(const fs::path& path) {
  return is_path_within(fs::path(T08_LOCAL_ROOT), path);
}

std::string file_version(const fs::path& path) {
  DWORD ignored = 0;
  const DWORD size = GetFileVersionInfoSizeW(path.c_str(), &ignored);
  if (size == 0) {
    return {};
  }
  std::vector<unsigned char> buffer(size);
  check(
      GetFileVersionInfoW(path.c_str(), 0, size, buffer.data()) != 0,
      "file version read failed");
  VS_FIXEDFILEINFO* info = nullptr;
  UINT info_size = 0;
  check(
      VerQueryValueW(buffer.data(), L"\\", reinterpret_cast<void**>(&info), &info_size) != 0
          && info != nullptr
          && info_size >= sizeof(VS_FIXEDFILEINFO),
      "file version metadata failed");
  return std::to_string(HIWORD(info->dwFileVersionMS)) + "."
      + std::to_string(LOWORD(info->dwFileVersionMS)) + "."
      + std::to_string(HIWORD(info->dwFileVersionLS)) + "."
      + std::to_string(LOWORD(info->dwFileVersionLS));
}

Json cuda_development_path_policy() {
  const DWORD path_size = GetEnvironmentVariableW(L"PATH", nullptr, 0);
  check(path_size > 0, "T07 restricted PATH is missing");
  std::vector<wchar_t> path_buffer(path_size);
  const DWORD path_length = GetEnvironmentVariableW(
      L"PATH", path_buffer.data(), static_cast<DWORD>(path_buffer.size()));
  check(path_length > 0 && path_length < path_buffer.size(), "T07 restricted PATH read failed");
  std::vector<fs::path> entries;
  std::wstringstream input(std::wstring(path_buffer.data(), path_length));
  std::wstring item;
  while (std::getline(input, item, L';')) {
    check(!item.empty(), "T07 restricted PATH contains an empty entry");
    entries.push_back(fs::weakly_canonical(fs::path(item)));
  }
  check(entries.size() == 3, "T07 restricted PATH must contain exactly three entries");

  std::array<wchar_t, 32768> cuda_root_buffer{};
  const DWORD cuda_root_length = GetEnvironmentVariableW(
      L"CUDA_PATH", cuda_root_buffer.data(), static_cast<DWORD>(cuda_root_buffer.size()));
  check(cuda_root_length > 0 && cuda_root_length < cuda_root_buffer.size(), "CUDA_PATH is missing");
  std::array<wchar_t, 32768> system_buffer{};
  const UINT system_length = GetSystemDirectoryW(
      system_buffer.data(), static_cast<UINT>(system_buffer.size()));
  check(system_length > 0 && system_length < system_buffer.size(), "System32 path resolution failed");

  const fs::path runtime = fs::weakly_canonical(current_executable()).parent_path();
  const fs::path cuda_bin = fs::weakly_canonical(
      fs::path(std::wstring(cuda_root_buffer.data(), cuda_root_length)) / "bin");
  const fs::path system = fs::weakly_canonical(
      fs::path(std::wstring(system_buffer.data(), system_length)));
  check(fs::equivalent(entries[0], runtime)
            && fs::equivalent(entries[1], cuda_bin)
            && fs::equivalent(entries[2], system),
        "T07 restricted PATH order or root identity mismatch");

  const std::string identity_input =
      "task-local-runtime-bin=" + runtime.u8string()
      + "\ncuda-toolkit-12.8-bin=" + cuda_bin.u8string()
      + "\nwindows-system32=" + system.u8string();
  return Json{
      {"name", "t07-windows-cuda-restricted-path-v1"},
      {"restricted", true},
      {"entryCount", 3},
      {"orderedEntryRoles", Json::array({
           "task-local-runtime-bin",
           "cuda-toolkit-12.8-bin",
           "windows-system32"})},
      {"rootIdentitySha256", sha256_text(identity_input)},
      {"resolvedRoots", Json::array({
           Json{{"role", "task-local-runtime-bin"}, {"canonicalPath", runtime.u8string()}},
           Json{{"role", "cuda-toolkit-12.8-bin"}, {"canonicalPath", cuda_bin.u8string()}},
           Json{{"role", "windows-system32"}, {"canonicalPath", system.u8string()}}})}};
}

Json cuda_development_loaded_modules(const Json& path_policy) {
  std::array<HMODULE, 1024> modules{};
  DWORD required_bytes = 0;
  check(
      EnumProcessModules(
          GetCurrentProcess(),
          modules.data(),
          static_cast<DWORD>(modules.size() * sizeof(HMODULE)),
          &required_bytes) != 0,
      "T07 loaded module inventory failed");
  check(required_bytes <= modules.size() * sizeof(HMODULE), "T07 module inventory was truncated");
  const std::size_t count = required_bytes / sizeof(HMODULE);
  const std::string executable_name = lowercase(current_executable().filename().u8string());
  Json result = Json::array();
  for (std::size_t index = 0; index < count; ++index) {
    std::array<wchar_t, 32768> buffer{};
    const DWORD length = GetModuleFileNameExW(
        GetCurrentProcess(), modules[index], buffer.data(), static_cast<DWORD>(buffer.size()));
    check(length > 0 && length < buffer.size(), "T07 loaded module path resolution failed");
    const fs::path path = fs::weakly_canonical(fs::path(std::wstring(buffer.data(), length)));
    const std::string name = path.filename().u8string();
    const std::string normalized = lowercase(name);
    const bool relevant = normalized == executable_name
        || normalized == "ctranslate2.dll"
        || normalized == "hikaru_asr_tokenizer.dll"
        || normalized == "onnxruntime.dll"
        || normalized == "onnxruntime_providers_shared.dll"
        || normalized == "nvcuda.dll"
        || normalized.rfind("cublas", 0) == 0
        || normalized.rfind("cudart", 0) == 0
        || normalized.rfind("curand", 0) == 0
        || normalized.rfind("cufft", 0) == 0
        || normalized.rfind("cusparse", 0) == 0
        || normalized.rfind("nvrtc", 0) == 0
        || normalized.rfind("cudnn", 0) == 0
        || normalized.find("vcomp") != std::string::npos
        || normalized.find("dnnl") != std::string::npos
        || normalized.find("iomp") != std::string::npos
        || normalized.find("openmp") != std::string::npos;
    if (!relevant) {
      continue;
    }
    std::string root_role;
    for (const Json& root : path_policy.at("resolvedRoots")) {
      const fs::path root_path = fs::weakly_canonical(
          fs::u8path(root.at("canonicalPath").get<std::string>()));
      if (fs::equivalent(path.parent_path(), root_path)) {
        root_role = root.at("role").get<std::string>();
        break;
      }
    }
    check(!root_role.empty(), "T07 relevant module escaped the restricted PATH roots: " + name);
    Json identity = file_identity(path);
    identity["name"] = name;
    identity["version"] = file_version(path);
    identity["rootRole"] = root_role;
    identity["canonicalPath"] = path.u8string();
    result.push_back(std::move(identity));
  }
  std::sort(result.begin(), result.end(), [](const Json& left, const Json& right) {
    return lowercase(left.at("name").get<std::string>())
        < lowercase(right.at("name").get<std::string>());
  });
  return result;
}

Json attested_cuda_gpu(
    const Json& modules,
    const BackendExecutionAttestation& attestation) {
  check(attestation.config.device == ExecutionDevice::Cuda
            && attestation.config.compute_type == ExecutionComputeType::Float16
            && attestation.config.device_index == 0,
        "CUDA execution mapping drift");
  const auto driver_module = std::find_if(modules.begin(), modules.end(), [](const Json& module) {
    return lowercase(module.at("name").get<std::string>()) == "nvcuda.dll";
  });
  check(driver_module != modules.end(), "CUDA driver module attestation is missing");
  check(attestation.device_name == "NVIDIA GeForce RTX 3070", "GPU name drift");
  check(attestation.compute_capability_major == 8
            && attestation.compute_capability_minor == 6,
        "GPU compute capability drift");
  check(attestation.cuda_driver_api_version == 13020, "CUDA driver API version drift");
  check(driver_module->at("version") == "32.0.15.9649", "NVIDIA driver module drift");
  return Json{
      {"deviceIndex", 0},
      {"name", attestation.device_name},
      {"driverVersion", "596.49"},
      {"driverModuleVersion", driver_module->at("version")},
      {"cudaDriverApiVersion", attestation.cuda_driver_api_version},
      {"computeCapability", std::to_string(attestation.compute_capability_major) + "."
           + std::to_string(attestation.compute_capability_minor)},
      {"visibleDeviceCount", attestation.visible_device_count},
      {"float16Supported", attestation.compute_type_supported}};
}

std::vector<unsigned char> wav_pcm_data(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  check(static_cast<bool>(input), "WAV prefix authority is missing");
  std::vector<unsigned char> bytes(
      (std::istreambuf_iterator<char>(input)),
      std::istreambuf_iterator<char>());
  check(bytes.size() >= 12
            && std::memcmp(bytes.data(), "RIFF", 4) == 0
            && std::memcmp(bytes.data() + 8, "WAVE", 4) == 0,
        "WAV prefix authority is invalid");
  const auto u32 = [&](std::size_t offset) {
    check(offset + 4 <= bytes.size(), "WAV chunk length is truncated");
    return static_cast<std::uint32_t>(bytes[offset])
        | (static_cast<std::uint32_t>(bytes[offset + 1]) << 8)
        | (static_cast<std::uint32_t>(bytes[offset + 2]) << 16)
        | (static_cast<std::uint32_t>(bytes[offset + 3]) << 24);
  };
  std::size_t offset = 12;
  while (offset + 8 <= bytes.size()) {
    const std::uint32_t size = u32(offset + 4);
    const std::size_t data_offset = offset + 8;
    check(data_offset + size <= bytes.size(), "WAV chunk data is truncated");
    if (std::memcmp(bytes.data() + offset, "data", 4) == 0) {
      return std::vector<unsigned char>(
          bytes.begin() + static_cast<std::ptrdiff_t>(data_offset),
          bytes.begin() + static_cast<std::ptrdiff_t>(data_offset + size));
    }
    offset = data_offset + size + (size % 2);
  }
  throw std::runtime_error("WAV data chunk is missing");
}

void verify_wav_prefix(const fs::path& source, const fs::path& slice) {
  const std::vector<unsigned char> source_pcm = wav_pcm_data(source);
  const std::vector<unsigned char> slice_pcm = wav_pcm_data(slice);
  check(source_pcm.size() >= slice_pcm.size(), "diagnostic source is shorter than the slice");
  check(std::equal(slice_pcm.begin(), slice_pcm.end(), source_pcm.begin()),
        "diagnostic slice is not the exact source PCM prefix");
}

void write_pcm_wav(const fs::path& path, const std::vector<std::int16_t>& pcm) {
  std::ofstream output(path, std::ios::binary);
  const std::uint32_t data_size = static_cast<std::uint32_t>(
      pcm.size() * sizeof(std::int16_t));
  const auto write_u16 = [&](std::uint16_t value) {
    output.write(reinterpret_cast<const char*>(&value), sizeof(value));
  };
  const auto write_u32 = [&](std::uint32_t value) {
    output.write(reinterpret_cast<const char*>(&value), sizeof(value));
  };
  output.write("RIFF", 4);
  write_u32(36 + data_size);
  output.write("WAVEfmt ", 8);
  write_u32(16);
  write_u16(1);
  write_u16(1);
  write_u32(sample_rate);
  write_u32(sample_rate * 2);
  write_u16(2);
  write_u16(16);
  output.write("data", 4);
  write_u32(data_size);
  output.write(reinterpret_cast<const char*>(pcm.data()), data_size);
}

void expect_timestamp_error(
    const std::vector<std::size_t>& ids,
    const TokenIds& tokens,
    const std::string& expected_code,
    std::int64_t audio_duration_ms = 30000) {
  try {
    static_cast<void>(parse_timestamp_tokens(
        ids,
        tokens,
        [](const std::vector<std::uint32_t>& values) {
          return values.empty() ? std::string() : std::string("text");
        },
        0,
        std::min<std::int64_t>(30000, audio_duration_ms),
        audio_duration_ms));
    throw std::runtime_error("timestamp vector unexpectedly passed");
  } catch (const BackendError& error) {
    check(error.code() == expected_code, "unexpected timestamp error: " + error.code());
  }
}

FallbackGenerated fake_generation(
    std::string text,
    float average_log_probability,
    float no_speech_probability = 0.0f) {
  FallbackGenerated value;
  value.token_ids = {1, 2};
  value.score = average_log_probability * 1.5f;
  value.no_speech_probability = no_speech_probability;
  value.decoded_text = std::move(text);
  return value;
}

GenerationFallbackResult fake_fallback(
    const std::vector<FallbackGenerated>& attempts,
    std::vector<FallbackAttemptOptions>* observed = nullptr) {
  std::size_t index = 0;
  return run_upstream_generation_fallback(
      upstream_generation_fallback_config(),
      [&](const FallbackAttemptOptions& options) {
        check(index < attempts.size(), "fake fallback exhausted its attempts");
        if (observed) {
          observed->push_back(options);
        }
        return attempts[index++];
      });
}

void run_fallback_self_check() {
  check(upstream_zlib_version() == "1.3.1", "fallback zlib identity drift");
  check(std::abs(upstream_compression_ratio("hello")
                 - upstream_compression_ratio("\xe3\x80\x80hello\xc2\xa0")) < 1e-12,
        "fallback Python Unicode strip parity drift");
  check(upstream_compression_ratio(std::string(1000, 'a'))
            > upstream_compression_ratio_threshold,
        "fallback compression trigger fixture drift");

  const GenerationFallbackResult no_retry = fake_fallback({fake_generation("hello", 0.0f)});
  check(no_retry.attempts.size() == 1
            && no_retry.selected_attempt_index == 0
            && no_retry.selected_temperature == 0.0,
        "fallback no-retry selection drift");

  std::vector<FallbackAttemptOptions> options;
  const GenerationFallbackResult compression_retry = fake_fallback(
      {fake_generation(std::string(1000, 'a'), 0.0f), fake_generation("hello", 0.0f)},
      &options);
  check(compression_retry.attempts.size() == 2
            && compression_retry.attempts[0].compression_triggered
            && compression_retry.selected_attempt_index == 1
            && options[0].beam_size == 5
            && !options[0].sampling
            && options[0].num_hypotheses == 1
            && !options[0].sampling_topk
            && !options[0].sampling_temperature
            && options[1].beam_size == 1
            && options[1].sampling
            && options[1].num_hypotheses == 5
            && options[1].sampling_topk
            && *options[1].sampling_topk == 0
            && options[1].sampling_temperature
            && *options[1].sampling_temperature == 0.2,
        "fallback compression retry/options drift");

  const GenerationFallbackResult log_retry = fake_fallback(
      {fake_generation("hello", -1.1f), fake_generation("hello", 0.0f)});
  check(log_retry.attempts.size() == 2
            && log_retry.attempts[0].log_probability_triggered
            && log_retry.selected_attempt_index == 1,
        "fallback log-probability retry drift");

  const GenerationFallbackResult silence = fake_fallback(
      {fake_generation("hello", -1.1f, 0.7f)});
  check(silence.attempts.size() == 1
            && silence.attempts[0].silence_override
            && silence.selected_attempt_index == 0,
        "fallback silence override drift");
  const GenerationFallbackResult compression_silence = fake_fallback(
      {fake_generation(std::string(1000, 'a'), -1.1f, 0.7f)});
  check(compression_silence.attempts.size() == 1
            && compression_silence.attempts[0].compression_triggered
            && compression_silence.attempts[0].silence_override,
        "fallback silence did not override compression retry");
  const GenerationFallbackResult ct2_no_speech_boundary = fake_fallback(
      {fake_generation("hello", -1.1f, 0.6f)});
  check(ct2_no_speech_boundary.attempts.size() == 1
            && ct2_no_speech_boundary.attempts[0].silence_override,
        "fallback CT2-float no-speech boundary drift");
  const GenerationFallbackResult below_no_speech_boundary = fake_fallback({
      fake_generation("hello", -1.1f, std::nextafter(0.6f, 0.0f)),
      fake_generation("hello", 0.0f)});
  check(below_no_speech_boundary.attempts.size() == 2
            && !below_no_speech_boundary.attempts[0].silence_override,
        "fallback strict no-speech threshold drift");
  const GenerationFallbackResult log_probability_boundary = fake_fallback(
      {fake_generation("hello", -1.0f, 0.7f)});
  check(log_probability_boundary.attempts.size() == 1
            && !log_probability_boundary.attempts[0].log_probability_triggered
            && !log_probability_boundary.attempts[0].silence_override,
        "fallback log-probability strict threshold drift");
  FallbackGenerated float_boundary = fake_generation("hello", 0.0f);
  float_boundary.token_ids = {1, 2, 3};
  float_boundary.score = -1.3333333730697632f;
  const GenerationFallbackResult float_boundary_retry = fake_fallback(
      {float_boundary, fake_generation("hello", 0.0f)});
  check(float_boundary_retry.attempts.size() == 2
            && float_boundary_retry.attempts[0].average_log_probability < -1.0
            && float_boundary_retry.attempts[0].log_probability_triggered,
        "fallback double-precision log-probability boundary drift");

  const GenerationFallbackResult first_passing = fake_fallback({
      fake_generation(std::string(1000, 'a'), 0.0f),
      fake_generation("hello", -1.1f),
      fake_generation("hello", 0.0f)});
  check(first_passing.attempts.size() == 3
            && first_passing.selected_attempt_index == 2
            && first_passing.selected_temperature == 0.4
            && !(first_passing.selected_temperature > 0.5),
        "fallback first-passing/prompt-retain drift");

  const GenerationFallbackResult prompt_reset = fake_fallback({
      fake_generation(std::string(1000, 'a'), 0.0f),
      fake_generation(std::string(1000, 'a'), 0.0f),
      fake_generation(std::string(1000, 'a'), 0.0f),
      fake_generation("hello", 0.0f)});
  check(prompt_reset.selected_temperature == 0.6
            && prompt_reset.selected_temperature > 0.5,
        "fallback selected-temperature prompt reset drift");

  const GenerationFallbackResult all_failed = fake_fallback({
      fake_generation("hello", -1.5f),
      fake_generation("hello", -1.4f),
      fake_generation("hello", -1.3f),
      fake_generation("hello", -1.2f),
      fake_generation("hello", -1.1f),
      fake_generation("hello", -1.25f)});
  check(all_failed.attempts.size() == upstream_fallback_temperatures.size()
            && all_failed.selected_attempt_index == 4
            && all_failed.selected_temperature == 1.0
            && all_failed.selected_temperature > 0.5,
        "fallback all-failed selection/max-attempt drift");
  const GenerationFallbackResult all_failed_tie = fake_fallback({
      fake_generation("hello", -1.5f),
      fake_generation("hello", -1.4f),
      fake_generation("hello", -1.1f),
      fake_generation("hello", -1.2f),
      fake_generation("hello", -1.1f),
      fake_generation("hello", -1.25f)});
  check(all_failed_tie.selected_attempt_index == 2
            && all_failed_tie.selected_temperature == 1.0,
        "fallback all-failed tie did not select the first maximum");
  const GenerationFallbackResult below_compression_preference = fake_fallback({
      fake_generation(std::string(1000, 'a'), 0.0f),
      fake_generation("hello", -1.5f),
      fake_generation(std::string(1000, 'a'), -0.1f),
      fake_generation(std::string(1000, 'a'), -0.1f),
      fake_generation(std::string(1000, 'a'), -0.1f),
      fake_generation(std::string(1000, 'a'), -0.1f)});
  check(below_compression_preference.selected_attempt_index == 1
            && below_compression_preference.selected_temperature == 1.0,
        "fallback below-compression-threshold preference drift");
  check(std::all_of(
            all_failed.attempts.begin(),
            all_failed.attempts.end(),
            [](const FallbackAttemptTrace& attempt) {
              return attempt.aggregate_sha256.size() == 64;
            }),
        "fallback sanitized attempt identity drift");

  CandidateAConfig open_config = upstream_generation_fallback_config();
  open_config.beam_size = 1;
  try {
    static_cast<void>(run_upstream_generation_fallback(
        open_config,
        [](const FallbackAttemptOptions&) { return fake_generation("hello", 0.0f); }));
    throw std::runtime_error("fallback open config unexpectedly passed");
  } catch (const BackendError& error) {
    check(error.code() == "config_identity_mismatch",
          "fallback open-config error drift");
  }
  try {
    static_cast<void>(run_upstream_generation_fallback(
        upstream_generation_fallback_config(),
        [](const FallbackAttemptOptions&) { return FallbackGenerated{}; }));
    throw std::runtime_error("fallback empty generation unexpectedly passed");
  } catch (const BackendError& error) {
    check(error.code() == "invalid_generation",
          "fallback empty-generation error drift");
  }
}

Json fallback_attempt_json(const FallbackAttemptTrace& attempt);

void run_fallback_oracle(const std::vector<std::string>& args) {
  validate_closed_mode_args(
      args,
      "--run-whisper-fallback-oracle",
      {"--input", "--output"});
  const fs::path input_path = fs::u8path(required_arg(args, "--input"));
  const fs::path output_path = fs::u8path(required_arg(args, "--output"));
  check(is_t06r_task_local_output(input_path)
            && is_t06r_task_local_output(output_path),
        "fallback oracle files must stay under research/local");
  const Json input = Json::parse(read_text_file(input_path));
  check(input.is_object() && input.size() == 1 && input.contains("attempts")
            && input["attempts"].is_array()
            && input["attempts"].size() == upstream_fallback_temperatures.size(),
        "fallback oracle input schema drift");
  std::size_t index = 0;
  const GenerationFallbackResult result = run_upstream_generation_fallback(
      upstream_generation_fallback_config(),
      [&](const FallbackAttemptOptions&) {
        const Json& attempt = input["attempts"].at(index++);
        check(attempt.is_object()
                  && attempt.size() == 4
                  && attempt.contains("tokenIds")
                  && attempt.contains("score")
                  && attempt.contains("noSpeechProbability")
                  && attempt.contains("text"),
              "fallback oracle attempt schema drift");
        return FallbackGenerated{
            attempt.at("tokenIds").get<std::vector<std::size_t>>(),
            attempt.at("score").get<float>(),
            attempt.at("noSpeechProbability").get<float>(),
            attempt.at("text").get<std::string>()};
      });
  Json attempts = Json::array();
  for (const FallbackAttemptTrace& attempt : result.attempts) {
    attempts.push_back(fallback_attempt_json(attempt));
  }
  const Json output{
      {"schemaVersion", 1},
      {"kind", "hikaru-whisper-fallback-oracle-result"},
      {"zlibVersion", upstream_zlib_version()},
      {"attemptCount", result.attempts.size()},
      {"selectedAttemptIndex", result.selected_attempt_index},
      {"selectedTemperature", result.selected_temperature},
      {"promptReset", result.selected_temperature > 0.5f},
      {"attempts", std::move(attempts)}};
  fs::create_directories(output_path.parent_path());
  const fs::path temporary = output_path.string() + ".tmp";
  std::ofstream(temporary, std::ios::binary) << std::setw(2) << output << '\n';
  fs::remove(output_path);
  fs::rename(temporary, output_path);
}

void run_core_tests() {
  const BackendExecutionConfig cpu_execution = cpu_execution_config();
  check(cpu_execution.device == ExecutionDevice::Cpu
            && cpu_execution.compute_type == ExecutionComputeType::Int8
            && cpu_execution.device_index == 0,
        "CPU execution mapping drift");
  const BackendExecutionConfig cuda_execution = cuda_execution_config();
  check(cuda_execution.device == ExecutionDevice::Cuda
            && cuda_execution.compute_type == ExecutionComputeType::Float16
            && cuda_execution.device_index == 0,
        "CUDA execution mapping drift");

  const CandidateAConfig production_defaults;
  check(production_defaults.timestamp_driven_seek, "production seek default drift");
  check(!production_defaults.condition_on_previous_text, "production history default drift");
  check(production_defaults.beam_size == 1, "production beam default drift");
  check(production_defaults.max_source_frames == max_model_frames,
        "production source-window default drift");
  check(!production_defaults.upstream_generation_fallback,
        "production defaults unexpectedly enabled generation fallback");
  const CandidateAConfig fallback_candidate = upstream_generation_fallback_config();
  check(fallback_candidate.beam_size == 5
            && fallback_candidate.condition_on_previous_text
            && fallback_candidate.timestamp_driven_seek
            && fallback_candidate.upstream_generation_fallback,
        "fallback candidate config drift");

  const CandidateAConfig kotoba = kotoba_config();
  check(kotoba.beam_size == 5, "Kotoba beam drift");
  check(!kotoba.condition_on_previous_text, "Kotoba history drift");
  check(kotoba.timestamp_driven_seek, "Kotoba seek drift");
  check(kotoba.max_source_frames == 1500, "Kotoba source-window drift");
  check(kotoba.max_applied_seek_frames == 0, "Kotoba K1 seek-cap drift");
  const CandidateAConfig kotoba_k2 = kotoba_k2_config();
  check(kotoba_k2.beam_size == kotoba.beam_size
            && kotoba_k2.max_source_frames == 1500
            && kotoba_k2.max_applied_seek_frames == 1000,
        "Kotoba K2 profile drift");
  check(production_defaults.max_applied_seek_frames == 0,
        "ordinary Whisper unexpectedly enabled K2 orchestration");
  check(kotoba_k2_applied_seek_frames(1500, 1500, 1000) == 1000,
        "K2 full-window stride cap drift");
  check(kotoba_k2_applied_seek_frames(800, 1500, 1000) == 800,
        "K2 shorter parsed advance drift");
  check(kotoba_k2_applied_seek_frames(1500, 700, 1000) == 700,
        "K2 final partial advance drift");
  check(kotoba_k2_applied_seek_frames(1500, 1500, 800) == 800,
        "K2 configured stride cap was not applied");
  check(kotoba_k2_owner_window_index({0, 10000}, 10000) == 1,
        "K2 exact boundary did not resolve to the later owner");
  check(kotoba_k2_owner_window_index({0, 10000, 18000}, 19000) == 2,
        "K2 owner resolution incorrectly assumed only the next window");
  check(kotoba_k2_owner_window_index({0, 10000}, 11000) == 1
            && 11000 < 12500,
        "K2 gap #3 latest-start owner no longer rejects midpoint ownership");
  check(kotoba_k2_owner_window_index({0, 10000}, 12160) == 1
            && 12160 < 12500,
        "K2 gap #6 latest-start owner no longer rejects midpoint ownership");
  try {
    static_cast<void>(kotoba_k2_applied_seek_frames(0, 1500, 1000));
    throw std::runtime_error("K2 zero advance unexpectedly passed");
  } catch (const BackendError& error) {
    check(error.code() == "invalid_generation", "K2 zero-advance error drift");
  }

  const auto segment = [](std::int64_t start, std::int64_t end, std::string text) {
    SegmentEvidence value;
    value.segment = {start, end, std::move(text)};
    value.raw_start_ms = start;
    value.raw_end_ms = end;
    return value;
  };
  const K2CommitResult gap3 = commit_kotoba_k2_window(
      {segment(1289540, 1291540, "gap3")},
      1288540,
      1298540,
      false,
      1300000,
      87,
      {});
  check(gap3.emitted.size() == 1
            && gap3.dispositions[0].owner_window_index == 87
            && gap3.dispositions[0].disposition == "emitted",
        "K2 gap #3 latest-start ownership drift");
  check(1289540 < 1291040,
        "K2 gap #3 midpoint mutation no longer demonstrates the rejected discard");
  const K2CommitResult gap6 = commit_kotoba_k2_window(
      {segment(1845700, 1847230, "gap6")},
      1843540,
      1853540,
      false,
      1860000,
      124,
      {});
  check(gap6.emitted.size() == 1 && 1845700 < 1846040,
        "K2 gap #6 latest-start/midpoint golden drift");
  const K2CommitResult boundary = commit_kotoba_k2_window(
      {segment(10000, 11000, "later")},
      0,
      10000,
      false,
      20000,
      0,
      {});
  check(boundary.emitted.empty()
            && boundary.non_owner_discarded_count == 1
            && boundary.dispositions[0].owner_window_index == 1,
        "K2 exact boundary did not belong to the later window");
  const K2CommitResult dedup = commit_kotoba_k2_window(
      {segment(1000, 2000, "same"), segment(1000, 2000, "same"),
       segment(1000, 2000, "different")},
      0,
      10000,
      false,
      20000,
      0,
      {});
  check(dedup.emitted.size() == 2
            && dedup.exact_duplicate_discarded_count == 1,
        "K2 exact-only pre-emission dedup drift");
  check(kotoba_mel_shape_supported(128), "Kotoba 128-mel readiness drift");
  check(!kotoba_mel_shape_supported(80), "Kotoba wrong-mel rejection drift");

  const auto diagnostic_configs = diagnostic_matrix_configs();
  check(diagnostic_configs.size() == 4, "diagnostic matrix size drift");
  check(
      diagnostic_configs[0].first == "A"
          && diagnostic_configs[0].second.beam_size == 5
          && !diagnostic_configs[0].second.condition_on_previous_text
          && !diagnostic_configs[0].second.timestamp_driven_seek,
      "diagnostic cell A drift");
  check(
      diagnostic_configs[1].first == "B"
          && diagnostic_configs[1].second.beam_size == 5
          && !diagnostic_configs[1].second.condition_on_previous_text
          && diagnostic_configs[1].second.timestamp_driven_seek,
      "diagnostic cell B drift");
  check(
      diagnostic_configs[2].first == "C"
          && diagnostic_configs[2].second.beam_size == 5
          && diagnostic_configs[2].second.condition_on_previous_text
          && diagnostic_configs[2].second.timestamp_driven_seek,
      "diagnostic cell C drift");
  check(
      diagnostic_configs[3].first == "D"
          && diagnostic_configs[3].second.beam_size == 1
          && diagnostic_configs[3].second.condition_on_previous_text
          && diagnostic_configs[3].second.timestamp_driven_seek,
      "diagnostic cell D drift");
  const CandidateAConfig beam_1 = short_decode_config(1);
  const CandidateAConfig beam_5 = short_decode_config(5);
  check(
      beam_1.beam_size == 1 && beam_5.beam_size == 5
          && !beam_1.condition_on_previous_text
          && !beam_5.condition_on_previous_text
          && beam_1.timestamp_driven_seek
          && beam_5.timestamp_driven_seek,
      "short beam-only probe config drift");

  const auto quality_cells = whisper_quality_diagnostic_cells();
  check(quality_cells.size() == 6, "T06R diagnostic matrix size drift");
  check(quality_cells[0].id == "short-b1-off"
            && quality_cells[0].case_id == "short-v1"
            && quality_cells[0].config.beam_size == 1
            && !quality_cells[0].config.condition_on_previous_text,
        "T06R short beam-1 cell drift");
  check(quality_cells[1].id == "medium-b1-off"
            && quality_cells[1].case_id == "medium-v1"
            && !quality_cells[1].config.condition_on_previous_text,
        "T06R medium beam-1/history-off cell drift");
  check(quality_cells[2].id == "medium-b1-on"
            && quality_cells[2].config.condition_on_previous_text,
        "T06R medium beam-1/history-on cell drift");
  check(quality_cells[3].id == "short-b5-off"
            && quality_cells[3].config.beam_size == 5,
        "T06R short beam-5 cell drift");
  check(quality_cells[4].id == "medium-b5-off"
            && !quality_cells[4].config.condition_on_previous_text,
        "T06R medium beam-5/history-off cell drift");
  check(quality_cells[5].id == "medium-b5-on"
            && quality_cells[5].config.condition_on_previous_text,
        "T06R medium beam-5/history-on cell drift");
  check(std::all_of(quality_cells.begin(), quality_cells.end(), [](const auto& cell) {
          return cell.config.timestamp_driven_seek;
        }),
        "T06R diagnostic seek policy drift");

  const auto vad_quality_cells = whisper_quality_vad_diagnostic_cells();
  check(vad_quality_cells.size() == 2,
        "T06R VAD diagnostic matrix size drift");
  check(vad_quality_cells[0].id == "short-b5-vad"
            && vad_quality_cells[0].case_id == "short-v1"
            && vad_quality_cells[0].config.beam_size == 5
            && !vad_quality_cells[0].config.condition_on_previous_text
            && vad_quality_cells[0].config.timestamp_driven_seek,
        "T06R short VAD diagnostic cell drift");
  check(vad_quality_cells[1].id == "medium-b5-on-vad"
            && vad_quality_cells[1].case_id == "medium-v1"
            && vad_quality_cells[1].config.beam_size == 5
            && vad_quality_cells[1].config.condition_on_previous_text
            && vad_quality_cells[1].config.timestamp_driven_seek,
        "T06R medium VAD diagnostic cell drift");
  const std::vector<std::string> closed_vad_value_args{
      "--cell", "--model", "--audio", "--output", "--input-lock",
      "--production-worker", "--model-id", "--model-revision",
      "--model-bin-sha256", "--repeats", "--vad-model"};
  validate_closed_mode_args(
      {"--run-whisper-quality-vad-diagnostic",
       "--cell", "short-b5-vad",
       "--model", "model",
       "--audio", "audio",
       "--output", "output",
       "--input-lock", "lock",
       "--production-worker", "worker",
       "--model-id", "model-id",
       "--model-revision", "revision",
       "--model-bin-sha256", "hash",
       "--repeats", "1",
       "--vad-model", "vad"},
      "--run-whisper-quality-vad-diagnostic",
      closed_vad_value_args);
  for (const std::vector<std::string>& invalid : {
           std::vector<std::string>{"--run-whisper-quality-vad-diagnostic", "--prompt", "x"},
           std::vector<std::string>{"--run-whisper-quality-vad-diagnostic", "--cell", "x", "--cell", "y"}}) {
    try {
      validate_closed_mode_args(
          invalid,
          "--run-whisper-quality-vad-diagnostic",
          closed_vad_value_args);
      throw std::runtime_error("T06R closed VAD CLI mutation unexpectedly passed");
    } catch (const std::runtime_error& error) {
      check(std::string(error.what()) != "T06R closed VAD CLI mutation unexpectedly passed",
            "T06R closed VAD CLI rejection drift");
    }
  }
  const auto fallback_cells = whisper_quality_fallback_diagnostic_cells();
  check(fallback_cells.size() == 2
            && fallback_cells[0].id == "short-b5-on-vad-fallback"
            && fallback_cells[0].case_id == "short-v1"
            && fallback_cells[1].id == "medium-b5-on-vad-fallback"
            && fallback_cells[1].case_id == "medium-v1"
            && std::all_of(
                fallback_cells.begin(),
                fallback_cells.end(),
                [](const WhisperQualityDiagnosticCell& cell) {
                  return cell.config.beam_size == 5
                      && cell.config.condition_on_previous_text
                      && cell.config.timestamp_driven_seek
                      && cell.config.upstream_generation_fallback;
                }),
        "T06R fallback diagnostic cells drift");
  validate_closed_mode_args(
      {"--run-whisper-quality-fallback-diagnostic",
       "--cell", "short-b5-on-vad-fallback",
       "--model", "model",
       "--audio", "audio",
       "--output", "output",
       "--input-lock", "lock",
       "--production-worker", "worker",
       "--model-id", "model-id",
       "--model-revision", "revision",
       "--model-bin-sha256", "hash",
       "--repeats", "1",
       "--vad-model", "vad"},
      "--run-whisper-quality-fallback-diagnostic",
      closed_vad_value_args);
  for (const std::vector<std::string>& invalid : {
           std::vector<std::string>{"--run-whisper-quality-fallback-diagnostic", "--temperature", "0.2"},
           std::vector<std::string>{"--run-whisper-quality-fallback-diagnostic", "--cell", "x", "--cell", "y"}}) {
    try {
      validate_closed_mode_args(
          invalid,
          "--run-whisper-quality-fallback-diagnostic",
          closed_vad_value_args);
      throw std::runtime_error("T06R closed fallback CLI mutation unexpectedly passed");
    } catch (const std::runtime_error& error) {
      check(std::string(error.what())
                != "T06R closed fallback CLI mutation unexpectedly passed",
            "T06R closed fallback CLI rejection drift");
    }
  }

  check(vad_window_samples == 512, "Candidate B VAD window drift");
  check(vad_context_samples == 64, "Candidate B VAD context drift");
  check(vad_batch_rows == 10000, "Candidate B VAD batch drift");
  check(vad_threshold == 0.5f && vad_negative_threshold == 0.35,
        "Candidate B VAD threshold drift");
  check(Json(vad_negative_threshold).dump() == "0.35",
        "Candidate B VAD config serialization drift");
  check(vad_min_silence_ms == 2000 && vad_speech_pad_ms == 400,
        "Candidate B VAD duration drift");

  std::vector<float> vad_source(vad_window_samples);
  std::iota(vad_source.begin(), vad_source.end(), 1.0f);
  const std::vector<float> vad_rows = candidate_b_vad_rows_for_test(vad_source);
  check(vad_rows.size() == 2 * (vad_window_samples + vad_context_samples),
        "Candidate B full-tail row drift");
  check(std::all_of(vad_rows.begin(), vad_rows.begin() + vad_context_samples,
                    [](float value) { return value == 0.0f; }),
        "Candidate B first-row context drift");
  check(std::equal(vad_source.begin(), vad_source.end(),
                   vad_rows.begin() + vad_context_samples),
        "Candidate B first-row PCM drift");
  check(std::equal(vad_source.end() - vad_context_samples, vad_source.end(),
                   vad_rows.begin() + vad_window_samples + vad_context_samples),
        "Candidate B previous-frame context drift");
  check(std::all_of(
            vad_rows.begin() + vad_window_samples + 2 * vad_context_samples,
            vad_rows.end(),
            [](float value) { return value == 0.0f; }),
        "Candidate B full zero-tail frame drift");

  std::vector<float> hysteresis(100, 0.0f);
  hysteresis[10] = 0.5f;
  hysteresis[11] = 0.4f;
  hysteresis[12] = 0.34f;
  hysteresis[20] = 0.5f;
  hysteresis[21] = 0.34f;
  const auto hysteresis_intervals = candidate_b_intervals_for_test(
      hysteresis,
      100 * vad_window_samples);
  check(hysteresis_intervals.size() == 1, "Candidate B hysteresis interval drift");
  check(hysteresis_intervals[0].start_sample == 0,
        "Candidate B first interval padding drift");
  check(hysteresis_intervals[0].end_sample == 21 * vad_window_samples + 6400,
        "Candidate B minimum-silence end/padding drift");

  const auto merged = candidate_b_pad_intervals_for_test(
      {{10000, 20000, 0, 0}, {25000, 30000, 0, 0}},
      40000);
  check(merged.size() == 2, "Candidate B half-gap interval count drift");
  check(merged[0].start_sample == 3600 && merged[0].end_sample == 22500,
        "Candidate B first half-gap padding drift");
  check(merged[1].start_sample == 22500 && merged[1].end_sample == 36400,
        "Candidate B second half-gap padding drift");
  check(merged[0].compressed_end_sample == 18900
            && merged[1].compressed_end_sample == 32800,
        "Candidate B compressed interval map drift");

  const std::vector<VadSpeechInterval> timestamp_map{
      {16000, 32000, 16000, 16000},
      {48000, 64000, 32000, 32000}};
  check(candidate_b_restore_time_ms_for_test(timestamp_map, 500, false) == 1500,
        "Candidate B timestamp restoration drift");
  check(candidate_b_restore_time_ms_for_test(timestamp_map, 1000, true) == 2000,
        "Candidate B exact-end restoration drift");
  check(candidate_b_restore_time_ms_for_test(timestamp_map, 1000, false) == 3000,
        "Candidate B next-interval restoration drift");
  check(candidate_b_restore_time_ms_for_test(timestamp_map, 2000, true) == 4000,
        "Candidate B source-progress restoration drift");

  const fs::path candidate_b_model = fs::path(T06_LOCAL_ROOT)
      / "candidate-b/model/silero_vad_v6.onnx";
  std::vector<float> zero_frame(vad_window_samples, 0.0f);
  const CandidateBVadResult zero_vad = candidate_b_run_vad_for_test(
      candidate_b_model,
      zero_frame);
  check(zero_vad.original_sample_count == vad_window_samples
            && zero_vad.padded_sample_count == 2 * vad_window_samples
            && zero_vad.row_count == 2
            && zero_vad.batch_count == 1,
        "Candidate B model-backed tail metadata drift");
  check(zero_vad.probabilities.size() == 2,
        "Candidate B model-backed probability count drift");
  check(std::abs(zero_vad.probabilities[0] - 0.023828625679016113f) < 1e-8f
            && std::abs(zero_vad.probabilities[1] - 0.011602133512496948f) < 1e-8f,
        "Candidate B exact zero-input probabilities drift");
  check(std::abs(zero_vad.final_h_sum - 5.475953102111816) < 1e-5
            && std::abs(zero_vad.final_c_sum - 11.97916030883789) < 1e-5,
        "Candidate B recurrent state drift");
  check(zero_vad.intervals.empty() && zero_vad.compressed_samples.empty(),
        "Candidate B zero-speech behavior drift");

  std::vector<float> batch_boundary(vad_batch_rows * vad_window_samples, 0.0f);
  const CandidateBVadResult batches_10000 = candidate_b_run_vad_for_test(
      candidate_b_model,
      batch_boundary,
      vad_batch_rows);
  const CandidateBVadResult batches_5000 = candidate_b_run_vad_for_test(
      candidate_b_model,
      batch_boundary,
      5000);
  check(batches_10000.row_count == vad_batch_rows + 1
            && batches_10000.batch_count == 2
            && batches_5000.batch_count == 3,
        "Candidate B <=10000-row batching drift");
  check(batches_10000.probabilities.size() == batches_5000.probabilities.size(),
        "Candidate B batch-split probability count drift");
  for (std::size_t index = 0; index < batches_10000.probabilities.size(); ++index) {
    check(std::abs(
              batches_10000.probabilities[index]
                  - batches_5000.probabilities[index]) < 1e-6f,
          "Candidate B recurrent carry changed across batch splits");
  }

  const fs::path candidate_b_negative_root = fs::temp_directory_path()
      / ("hikaru-asr-candidate-b-negative-" + std::to_string(GetCurrentProcessId()));
  fs::remove_all(candidate_b_negative_root);
  fs::create_directories(candidate_b_negative_root);
  const fs::path corrupt_vad = candidate_b_negative_root / "silero_vad_v6.onnx";
  fs::copy_file(candidate_b_model, corrupt_vad);
  {
    std::fstream corrupt(corrupt_vad, std::ios::binary | std::ios::in | std::ios::out);
    char byte = 0;
    corrupt.read(&byte, 1);
    byte = static_cast<char>(byte ^ 0x01);
    corrupt.seekp(0);
    corrupt.write(&byte, 1);
  }
  try {
    static_cast<void>(candidate_b_run_vad_for_test(corrupt_vad, zero_frame));
    throw std::runtime_error("Candidate B corrupt VAD unexpectedly passed");
  } catch (const BackendError& error) {
    check(error.code() == "vad_model_identity_mismatch",
          "Candidate B corrupt VAD error drift");
  }
  const fs::path wrong_schema = fs::path(T06_LOCAL_ROOT)
      / "candidate-b/sources/silero-vad-v6.0/src/silero_vad/data/silero_vad.onnx";
  try {
    static_cast<void>(candidate_b_run_vad_for_test(
        wrong_schema,
        zero_frame,
        vad_batch_rows,
        false));
    throw std::runtime_error("Candidate B wrong-schema VAD unexpectedly passed");
  } catch (const BackendError& error) {
    check(error.code() == "vad_model_schema_mismatch",
          "Candidate B schema error drift: " + error.code());
  }
  try {
    candidate_b_force_ort_run_failure_for_test(candidate_b_model);
    throw std::runtime_error("Candidate B forced ORT failure unexpectedly passed");
  } catch (const BackendError& error) {
    check(error.code() == "vad_runtime_failed",
          "Candidate B ORT run failure/no-fallback drift");
  }
  validate_candidate_b_loaded_modules(loaded_runtime_modules());
  fs::remove_all(candidate_b_negative_root);

  check(source_frame_count(120 * sample_rate) == 12000, "exact source frame count drift");
  check(source_frame_count(1) == 1, "single-sample frame count drift");
  check(source_frame_count(hop_length + 1) == 2, "partial source frame count drift");

  const TokenIds tokens{900, 901, 902, 903, 904, 1000};
  const auto decode = [](const std::vector<std::uint32_t>& ids) {
    if (ids == std::vector<std::uint32_t>{42}) return std::string(" first");
    if (ids == std::vector<std::uint32_t>{43}) return std::string(" second");
    return std::string();
  };

  const TimestampParseResult paired = parse_timestamp_tokens(
      {1000, 42, 1050}, tokens, decode, 0, 30000, 30000);
  check(paired.segments.size() == 1, "paired timestamp parsing failed");
  check(paired.segments[0].segment.start_ms == 0, "paired start drift");
  check(paired.segments[0].segment.end_ms == 1000, "paired end drift");
  check(paired.seek_advance_frames == 3000, "paired source-window seek drift");

  const TimestampParseResult consecutive = parse_timestamp_tokens(
      {1000, 42, 1050, 1050, 43, 1100}, tokens, decode, 0, 30000, 30000);
  check(consecutive.segments.size() == 2, "consecutive timestamps failed");
  check(consecutive.single_timestamp_ending, "single ending classification drift");

  const TimestampParseResult decoded_seek = parse_timestamp_tokens(
      {1000, 42, 1050, 1050, 43, 900}, tokens, decode, 0, 30000, 30000);
  check(decoded_seek.segments.size() == 1, "unfinished tail was not ignored");
  check(decoded_seek.used_decoded_seek, "decoded seek was not selected");
  check(decoded_seek.seek_advance_frames == 100, "decoded seek offset drift");

  const TimestampParseResult leading = parse_timestamp_tokens(
      {1025, 42, 1050}, tokens, decode, 0, 30000, 30000);
  check(leading.segments[0].segment.start_ms == 500, "leading silence drift");

  const TimestampParseResult final_partial = parse_timestamp_tokens(
      {2175, 42, 2250}, tokens, decode, 0, 24102, 24102);
  check(final_partial.segments[0].raw_end_ms == 25000, "raw final end drift");
  check(final_partial.segments[0].segment.end_ms == 24102, "WAV end bound drift");
  check(final_partial.segments[0].end_bounded_to_audio, "WAV end bound flag missing");

  expect_timestamp_error({2250, 42, 2300}, tokens, "timestamp_after_audio", 24102);
  expect_timestamp_error({1000, 42}, tokens, "invalid_generation");
  expect_timestamp_error({1000, 42, 2501}, tokens, "invalid_generation");

  std::vector<SegmentEvidence> duplicate_segments{
      {{0, 1000, "same"}},
      {{0, 1000, "same"}},
      {{1000, 2000, "different"}}};
  remove_exact_duplicate_segments(duplicate_segments);
  check(duplicate_segments.size() == 2, "exact duplicate removal drift");

  std::vector<float> sine(sample_rate);
  for (int index = 0; index < sample_rate; ++index) {
    sine[index] = static_cast<float>(0.25 * std::sin(
        2.0 * 3.14159265358979323846 * 1000.0 * index / sample_rate));
  }
  const auto close = [](float left, float right, float tolerance) {
    return std::abs(left - right) <= tolerance;
  };
  const std::vector<float> mel_128 = official_log_mel_for_test(sine, 128, 0, 101);
  check(close(mel_128[0], 0.573474f, 0.0005f), "official 128-mel[0] drift");
  check(
      close(mel_128[40 * max_model_frames], 1.256608f, 0.0005f),
      "official 128-mel[40] drift");
  check(
      close(mel_128[30 * max_model_frames + 10], -0.676069f, 0.0005f),
      "official 128-mel frame drift");
  const std::vector<float> mel_80 = official_log_mel_for_test(sine, 80, 0, 101);
  check(close(mel_80[0], 0.649233f, 0.0005f), "official 80-mel[0] drift");
  check(
      close(mel_80[40 * max_model_frames], 0.519009f, 0.0005f),
      "official 80-mel[40] drift");
  check(
      close(mel_80[30 * max_model_frames + 10], -0.710863f, 0.0005f),
      "official 80-mel frame drift");

  const fs::path root = fs::temp_directory_path()
      / ("hikaru-asr-ct2-tests-" + std::to_string(GetCurrentProcessId()));
  fs::remove_all(root);
  fs::create_directories(root);
  std::vector<std::int16_t> pcm(sample_rate, 0);
  write_pcm_wav(root / "one-second.wav", pcm);
  check(verified_wav_duration_ms(root / "one-second.wav") == 1000, "WAV duration drift");
  std::ofstream(root / "bad.wav") << "bad";
  try {
    static_cast<void>(verified_wav_duration_ms(root / "bad.wav"));
    throw std::runtime_error("invalid WAV unexpectedly passed");
  } catch (const BackendError& error) {
    check(error.code() == "invalid_audio", "invalid WAV error drift");
  }

  const auto write_model_fixture = [&](const fs::path& directory, const char* vocabulary) {
    fs::create_directories(directory);
    std::ofstream(directory / "config.json") << R"({"alignment_heads":[]})";
    std::ofstream(directory / "model.bin") << "model";
    std::ofstream(directory / "tokenizer.json") << "tokenizer";
    std::ofstream(directory / vocabulary) << "vocabulary";
  };
  write_model_fixture(root / "ordinary-json-vocabulary", "vocabulary.json");
  write_model_fixture(root / "ordinary-text-vocabulary", "vocabulary.txt");
  write_model_fixture(root / "kotoba", "vocabulary.json");
  std::ofstream(root / "kotoba" / "preprocessor_config.json") << R"({"feature_size":128})";
  validate_model_directory(root / "ordinary-json-vocabulary");
#ifndef HIKARU_ASR_CT2_WITH_CUDA
  try {
    CTranslate2WhisperBackend backend(
        root / "ordinary-json-vocabulary",
        {},
        std::nullopt,
        cuda_execution_config());
    throw std::runtime_error("CPU-only backend accepted CUDA execution");
  } catch (const BackendError& error) {
    check(error.code() == "cuda_not_built", "CPU-only CUDA rejection drift");
  }
#endif
  validate_model_directory(root / "ordinary-text-vocabulary");
  validate_model_directory(root / "kotoba", true);
  check(
      !fs::exists(root / "ordinary-json-vocabulary" / "preprocessor_config.json"),
      "ordinary Whisper fixture unexpectedly requires preprocessor metadata");
  try {
    validate_model_directory(root / "ordinary-json-vocabulary", true);
    throw std::runtime_error("Kotoba fixture without preprocessor unexpectedly passed");
  } catch (const BackendError& error) {
    check(error.code() == "kotoba_preprocessor_missing",
          "Kotoba missing-preprocessor error drift");
  }
  std::ofstream(root / "kotoba" / "preprocessor_config.json", std::ios::trunc);
  try {
    validate_model_directory(root / "kotoba", true);
    throw std::runtime_error("Kotoba empty preprocessor unexpectedly passed");
  } catch (const BackendError& error) {
    check(error.code() == "kotoba_preprocessor_missing",
          "Kotoba empty-preprocessor error drift");
  }
  fs::remove(root / "ordinary-text-vocabulary" / "vocabulary.txt");
  try {
    validate_model_directory(root / "ordinary-text-vocabulary");
    throw std::runtime_error("missing ordinary Whisper vocabulary unexpectedly passed");
  } catch (const BackendError& error) {
    check(error.code() == "model_not_ready", "missing vocabulary error drift");
  }
  fs::remove_all(root);
}

Json segment_json(const SegmentEvidence& segment) {
  return Json{
      {"startMs", segment.segment.start_ms},
      {"endMs", segment.segment.end_ms},
      {"text", segment.segment.text},
      {"rawStartMs", segment.raw_start_ms},
      {"rawEndMs", segment.raw_end_ms},
      {"endBoundedToAudio", segment.end_bounded_to_audio},
      {"compressedStartMs", segment.compressed_start_ms < 0
           ? Json(nullptr)
           : Json(segment.compressed_start_ms)},
      {"compressedEndMs", segment.compressed_end_ms < 0
           ? Json(nullptr)
           : Json(segment.compressed_end_ms)},
      {"vadTimestampRestored", segment.vad_timestamp_restored},
      {"timestampStartToken", segment.timestamp_start_token},
      {"timestampEndToken", segment.timestamp_end_token},
      {"tokenIds", segment.tokens},
      {"traceSha256", segment.trace_sha256}};
}

Json k2_disposition_json(const K2SegmentDisposition& disposition) {
  return Json{
      {"startMs", disposition.segment.segment.start_ms},
      {"endMs", disposition.segment.segment.end_ms},
      {"text", disposition.segment.segment.text},
      {"tokenIds", disposition.segment.tokens},
      {"traceSha256", disposition.segment.trace_sha256},
      {"tupleSha256", disposition.tuple_sha256},
      {"ownerWindowIndex", disposition.owner_window_index},
      {"ownershipAnchor", "startMs"},
      {"disposition", disposition.disposition},
      {"duplicateTargetSha256", disposition.duplicate_target_sha256.empty()
           ? Json(nullptr)
           : Json(disposition.duplicate_target_sha256)}};
}

Json fallback_attempt_json(const FallbackAttemptTrace& attempt) {
  return Json{
      {"temperature", attempt.options.temperature},
      {"decodeMode", attempt.options.sampling ? "sampling" : "beam"},
      {"beamSize", attempt.options.beam_size},
      {"patience", attempt.options.sampling ? Json(nullptr) : Json(attempt.options.patience)},
      {"numHypotheses", attempt.options.num_hypotheses},
      {"samplingTopK", attempt.options.sampling_topk
          ? Json(*attempt.options.sampling_topk)
          : Json(nullptr)},
      {"samplingTemperature", attempt.options.sampling_temperature
          ? Json(*attempt.options.sampling_temperature)
          : Json(nullptr)},
      {"tokenIds", attempt.token_ids},
      {"score", attempt.score},
      {"averageLogProbability", attempt.average_log_probability},
      {"noSpeechProbability", attempt.no_speech_probability},
      {"decodedText", attempt.decoded_text},
      {"compressionRatio", attempt.compression_ratio},
      {"compressionTriggered", attempt.compression_triggered},
      {"logProbabilityTriggered", attempt.log_probability_triggered},
      {"silenceOverride", attempt.silence_override},
      {"aggregateSha256", attempt.aggregate_sha256}};
}

Json trace_json(const WindowTrace& trace) {
  Json value{
      {"windowOffsetMs", trace.window_offset_ms},
      {"sourceWindowDurationMs", trace.source_window_duration_ms},
      {"modelWindowDurationMs", trace.model_window_duration_ms},
      {"seekFramesBefore", trace.seek_frames_before},
      {"seekFramesAfter", trace.seek_frames_after},
      {"sourceOverlapMs", trace.source_overlap_ms},
      {"sourceProgressBeforeMs", trace.source_progress_before_ms},
      {"sourceProgressAfterMs", trace.source_progress_after_ms},
      {"vadTimestampRestored", trace.vad_timestamp_restored},
      {"promptTokenCount", trace.prompt_token_count},
      {"historyTokenCountBefore", trace.history_token_count_before},
      {"historyTokenCountAfter", trace.history_token_count_after},
      {"prefixForwardTokenCount", trace.prefix_forward_token_count},
      {"generatedTokenCount", trace.generated_token_count},
      {"featureMs", trace.feature_ms},
      {"generateMs", trace.generate_ms},
      {"generationCallCount", trace.generation_call_count},
      {"fallbackCallCount", trace.fallback_call_count},
      {"noSpeechProbability", trace.no_speech_probability},
      {"averageLogProbability", trace.average_log_probability},
      {"skippedAsNoSpeech", trace.skipped_as_no_speech},
      {"parseStatus", trace.parse_status},
      {"parseError", trace.parse_error.empty() ? Json(nullptr) : Json(trace.parse_error)},
      {"sha256", trace.sha256},
      {"tokenIds", trace.token_ids}};
  if (trace.generation_fallback_enabled) {
    Json attempts = Json::array();
    for (const FallbackAttemptTrace& attempt : trace.fallback_attempts) {
      attempts.push_back(fallback_attempt_json(attempt));
    }
    value.update(Json{
        {"generationFallbackEnabled", true},
        {"selectedAttemptIndex", trace.selected_fallback_attempt_index},
        {"selectedTemperature", trace.selected_temperature},
        {"compressionRatio", trace.compression_ratio},
        {"fallbackAttempts", std::move(attempts)}});
  }
  if (trace.k2_candidate) {
    Json dispositions = Json::array();
    for (const K2SegmentDisposition& disposition : trace.segment_dispositions) {
      dispositions.push_back(k2_disposition_json(disposition));
    }
    value.update(Json{
        {"candidateId", "kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1"},
        {"ownershipRule", "latest-start-half-open-v1"},
        {"windowIndex", trace.window_index},
        {"parsedSeekAdvanceFrames", trace.parsed_seek_advance_frames},
        {"proposedAdvanceFrames", trace.proposed_advance_frames},
        {"appliedSeekAdvanceFrames", trace.applied_seek_advance_frames},
        {"nextWindowStartMs", trace.next_window_start_ms},
        {"actualSourceOverlapFrames", trace.actual_source_overlap_frames},
        {"actualSourceOverlapMs", trace.source_overlap_ms},
        {"singleTimestampEnding", trace.single_timestamp_ending},
        {"usedDecodedSeek", trace.used_decoded_seek},
        {"ownershipStartMs", trace.ownership_start_ms},
        {"ownershipEndMs", trace.ownership_end_ms},
        {"ownershipEndExclusive", !trace.final_window},
        {"finalWindow", trace.final_window},
        {"parsedSegmentCount", trace.parsed_segment_count},
        {"ownedBeforeDedupCount", trace.owned_before_dedup_count},
        {"nonOwnerDiscardedCount", trace.non_owner_discarded_count},
        {"exactDuplicateDiscardedCount", trace.exact_duplicate_discarded_count},
        {"emittedSegmentCount", trace.emitted_segment_count},
        {"lastEmittedStartBeforeMs", trace.last_emitted_start_before_ms},
        {"lastEmittedStartAfterMs", trace.last_emitted_start_after_ms},
        {"segmentDispositions", std::move(dispositions)}});
  }
  return value;
}

Json config_json(const CandidateAConfig& config) {
  const auto exact = [](float value) {
    return std::round(static_cast<double>(value) * 1000.0) / 1000.0;
  };
  Json value{
      {"beamSize", config.beam_size},
      {"patience", exact(config.patience)},
      {"lengthPenalty", exact(config.length_penalty)},
      {"repetitionPenalty", exact(config.repetition_penalty)},
      {"noRepeatNgramSize", config.no_repeat_ngram_size},
      {"maxLength", config.max_length},
      {"temperature", exact(config.temperature)},
      {"conditionOnPreviousText", config.condition_on_previous_text},
      {"timestampDrivenSeek", config.timestamp_driven_seek},
      {"promptResetOnTemperature", exact(config.prompt_reset_on_temperature)},
      {"noSpeechThreshold", exact(config.no_speech_threshold)},
      {"logProbThreshold", exact(config.log_prob_threshold)},
      {"maxInitialTimestampIndex", config.max_initial_timestamp_index},
      {"modelWindowDurationMs", model_window_duration_ms},
      {"timestampResolutionMs", timestamp_resolution_ms},
      {"vad", false}};
  if (config.upstream_generation_fallback) {
    value.update(Json{
        {"generationFallback", "faster-whisper-v1.2.1-exact"},
        {"fallbackTemperatures", upstream_fallback_temperatures},
        {"compressionRatioThreshold", upstream_compression_ratio_threshold},
        {"samplingBestOf", upstream_sampling_best_of},
        {"samplingTopK", upstream_sampling_topk},
        {"zlibVersion", upstream_zlib_version()}});
  }
  return value;
}

Json kotoba_config_json(const CandidateAConfig& config) {
  Json value = config_json(config);
  value["maxSourceFrames"] = config.max_source_frames;
  value["maxSourceWindowDurationMs"] = config.max_source_frames * 10;
  value["language"] = "ja";
  if (config.max_applied_seek_frames > 0) {
    value["maxAppliedSeekFrames"] = config.max_applied_seek_frames;
    value["maxAppliedSeekDurationMs"] = config.max_applied_seek_frames * 10;
    value["candidateId"] = "kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1";
    value["ownershipRule"] = "latest-start-half-open-v1";
    value["overlapFloorFrames"] = config.max_source_frames - config.max_applied_seek_frames;
  }
  return value;
}

Json candidate_b_config_json(const CandidateAConfig& config) {
  Json value = config_json(config);
  value["vad"] = true;
  value["vadAlgorithm"] = "candidate-b-faster-whisper-v1.2.1-silero-v6";
  value["sampleRate"] = sample_rate;
  value["windowSamples"] = vad_window_samples;
  value["contextSamples"] = vad_context_samples;
  value["encoderBatchRows"] = vad_batch_rows;
  value["threshold"] = vad_threshold;
  value["negativeThreshold"] = vad_negative_threshold;
  value["minSpeechDurationMs"] = 0;
  value["maxSpeechDurationSeconds"] = nullptr;
  value["minSilenceDurationMs"] = vad_min_silence_ms;
  value["speechPadMs"] = vad_speech_pad_ms;
  return value;
}

Json vad_interval_json(const VadSpeechInterval& interval) {
  return Json{
      {"startSample", interval.start_sample},
      {"endSample", interval.end_sample},
      {"compressedEndSample", interval.compressed_end_sample},
      {"silenceBeforeSamples", interval.silence_before_samples}};
}

Json model_file_identities(const fs::path& model_path) {
  Json files = Json::array();
  for (const char* name : {
           "config.json",
           "model.bin",
           "preprocessor_config.json",
           "tokenizer.json",
           "vocabulary.json",
           "vocabulary.txt"}) {
    const fs::path path = model_path / name;
    if (fs::is_regular_file(path)) {
      Json identity = file_identity(path);
      identity["name"] = name;
      files.push_back(std::move(identity));
    }
  }
  return files;
}

Json runtime_file_identities(const fs::path& executable, bool include_ort = false) {
  Json files = Json::array();
  std::vector<const char*> names{"ctranslate2.dll", "hikaru_asr_tokenizer.dll"};
  if (include_ort) {
    names.push_back("onnxruntime.dll");
    names.push_back("onnxruntime_providers_shared.dll");
  }
  for (const char* name : names) {
    const fs::path path = executable.parent_path() / name;
    check(fs::is_regular_file(path), std::string("runtime DLL missing: ") + name);
    Json identity = file_identity(path);
    identity["name"] = name;
    files.push_back(std::move(identity));
  }
  return files;
}

Json diagnostic_cell(
    const std::string& id,
    const fs::path& model_path,
    const fs::path& audio_path,
    CandidateAConfig config) {
  const Clock::time_point load_started = Clock::now();
  CTranslate2WhisperBackend backend(model_path, config);
  const double load_ms = elapsed_ms(load_started);

  const Clock::time_point warmup_started = Clock::now();
  const TranscriptionResult warmup = backend.transcribe(audio_path);
  const double warmup_wall_ms = elapsed_ms(warmup_started);
  check(warmup.failure_code.empty(), "diagnostic warmup failed: " + id + ":" + warmup.failure_code);
  check(
      warmup_wall_ms > 0 && warmup_wall_ms <= 600000,
      "diagnostic warmup timing is outside the bounded 10-minute limit: " + id);

  const TranscriptionResult result = backend.transcribe(audio_path);
  check(result.failure_code.empty(), "diagnostic measured pass failed: " + id + ":" + result.failure_code);
  check(!result.traces.empty(), "diagnostic cell returned no window traces: " + id);
  check(result.duration_ms == 120000, "diagnostic measured duration drift: " + id);
  const std::size_t expected_windows = config.timestamp_driven_seek ? 5 : 4;
  check(warmup.traces.size() == expected_windows, "diagnostic warmup window count drift: " + id);
  check(result.traces.size() == expected_windows, "diagnostic measured window count drift: " + id);
  check(
      result.traces.back().seek_frames_after == source_frame_count(120 * sample_rate),
      "diagnostic measured seek did not end exactly at 120s: " + id);
  for (const WindowTrace& trace : result.traces) {
    check(trace.source_window_duration_ms > 0, "diagnostic emitted a zero-duration window: " + id);
    check(trace.window_offset_ms < 120000, "diagnostic emitted a window at/after 120s: " + id);
  }

  Json traces = Json::array();
  std::size_t generated_tokens = 0;
  std::size_t prefix_tokens = 0;
  std::int64_t overlap_ms = 0;
  std::size_t generation_calls = 0;
  std::size_t fallback_calls = 0;
  for (const WindowTrace& trace : result.traces) {
    traces.push_back(trace_json(trace));
    generated_tokens += trace.generated_token_count;
    prefix_tokens += trace.prefix_forward_token_count;
    overlap_ms += trace.source_overlap_ms;
    generation_calls += trace.generation_call_count;
    fallback_calls += trace.fallback_call_count;
  }

  check(generation_calls == expected_windows, "diagnostic measured generation count drift: " + id);

  std::size_t warmup_generated_tokens = 0;
  for (const WindowTrace& trace : warmup.traces) {
    warmup_generated_tokens += trace.generated_token_count;
  }

  return Json{
      {"id", id},
      {"status", "completed"},
      {"failureCode", nullptr},
      {"config", Json{
           {"seek", config.timestamp_driven_seek ? "timestamp-driven" : "fixed-30s"},
           {"history", config.condition_on_previous_text ? "full-official" : "off"},
           {"beamSize", config.beam_size}}},
      {"warmup", Json{
           {"excludedFromComparison", true},
           {"wallMs", warmup_wall_ms},
           {"featureMs", warmup.feature_ms},
           {"modelGenerateMs", warmup.generate_ms},
           {"inferenceMs", warmup.inference_ms},
           {"windowCount", warmup.traces.size()},
           {"generatedTokenCount", warmup_generated_tokens}}},
      {"timings", Json{
           {"loadMs", load_ms},
           {"featureMs", result.feature_ms},
           {"modelGenerateMs", result.generate_ms},
           {"inferenceMs", result.inference_ms},
           {"inferenceRtf", result.inference_ms / result.duration_ms}}},
      {"totals", Json{
           {"windowCount", result.traces.size()},
           {"segmentCount", result.segments.size()},
           {"firstWindowTraceSha256", result.traces.front().sha256},
           {"generatedTokenCount", generated_tokens},
           {"prefixForwardTokenCount", prefix_tokens},
           {"sourceOverlapMs", overlap_ms},
           {"generationCallCount", generation_calls},
           {"fallbackCallCount", fallback_calls}}},
      {"threads", Json{
           {"resolvedIntraThreads", backend.resolved_intra_threads()},
           {"resolvedInterThreads", backend.resolved_inter_threads()}}},
      {"windows", std::move(traces)}};
}

void run_diagnostic_matrix(const std::vector<std::string>& args) {
  const fs::path model_path = fs::u8path(required_arg(args, "--model"));
  const fs::path audio_path = fs::u8path(required_arg(args, "--audio"));
  const fs::path source_audio_path = fs::u8path(required_arg(args, "--source-audio"));
  const fs::path output_path = fs::u8path(required_arg(args, "--output"));
  const std::string model_id = required_arg(args, "--model-id");
  const std::string model_revision = required_arg(args, "--model-revision");
  const std::string expected_model_hash = required_arg(args, "--model-bin-sha256");

  check(is_task_local_output(output_path), "diagnostic output must stay under T06 research/local");
  check(is_task_local_output(audio_path), "diagnostic audio must stay under T06 research/local");
  check(fs::is_regular_file(source_audio_path), "authoritative source WAV is missing");
  check(
      sha256_file(model_path / "model.bin") == expected_model_hash,
      "model.bin does not match the locked revision");
  const std::int64_t slice_duration_ms = verified_wav_duration_ms(audio_path);
  check(slice_duration_ms == 120000, "diagnostic slice must be exactly 120000ms");

  const auto cells = diagnostic_matrix_configs();

  Json cell_results = Json::array();
  for (const auto& cell : cells) {
    cell_results.push_back(diagnostic_cell(
        cell.first,
        model_path,
        audio_path,
        cell.second));
  }

  const Json& first_a = cell_results.at(0).at("windows").at(0);
  for (std::size_t index = 1; index <= 2; ++index) {
    const Json& comparable = cell_results.at(index).at("windows").at(0);
    check(comparable.at("windowOffsetMs") == first_a.at("windowOffsetMs"), "A/B/C first-window offset differs");
    check(comparable.at("promptTokenCount") == first_a.at("promptTokenCount"), "A/B/C first-window prompt count differs");
    check(comparable.at("historyTokenCountBefore") == first_a.at("historyTokenCountBefore"), "A/B/C first-window history differs");
    check(comparable.at("generatedTokenCount") == first_a.at("generatedTokenCount"), "A/B/C first-window generated count differs");
    check(comparable.at("sha256") == first_a.at("sha256"), "A/B/C first-window generated trace differs");
  }

  const fs::path executable = current_executable();
  const Json raw{
      {"schemaVersion", 1},
      {"kind", "hikaru-ct2-whisper-cpu-rtf-diagnostic"},
      {"qualificationEligible", false},
      {"status", "completed"},
      {"source", Json{
           {"caseId", "medium-v1-first-120s-diagnostic"},
           {"authoritativeWavSha256", sha256_file(source_audio_path)},
           {"sliceSha256", sha256_file(audio_path)},
           {"sliceDurationMs", slice_duration_ms}}},
      {"model", Json{
           {"id", model_id},
           {"revision", model_revision},
           {"files", model_file_identities(model_path)}}},
      {"runtime", Json{
           {"measurementExecutable", file_identity(executable)},
           {"requiredDlls", runtime_file_identities(executable)},
           {"device", "cpu"},
           {"computeType", "int8"},
           {"ctranslate2Version", "4.8.0"},
           {"oneDnnVersion", "3.1.1"},
           {"oneDnnLinkage", "static"},
           {"openMpRuntime", "COMP"},
           {"cpuModel", cpu_model()},
           {"logicalCores", GetActiveProcessorCount(ALL_PROCESSOR_GROUPS)},
           {"availableIsa", available_isa()},
           {"loadedModules", loaded_runtime_modules()}}},
      {"cells", std::move(cell_results)},
      {"resources", Json{
           {"peakProcessRssBytes", peak_working_set()},
           {"method", "GetProcessMemoryInfo.PeakWorkingSetSize"}}}};

  fs::create_directories(output_path.parent_path());
  const fs::path temporary = output_path.string() + ".tmp";
  std::ofstream(temporary, std::ios::binary) << std::setw(2) << raw << '\n';
  fs::remove(output_path);
  fs::rename(temporary, output_path);
  std::cout << Json{
      {"status", "completed"},
      {"kind", raw["kind"]},
      {"cellCount", raw["cells"].size()}}.dump() << '\n';
}

Json short_decode_selection_row(
    const fs::path& model_path,
    const fs::path& audio_path,
    std::size_t beam_size) {
  const CandidateAConfig config = short_decode_config(beam_size);

  const Clock::time_point load_started = Clock::now();
  CTranslate2WhisperBackend backend(model_path, config);
  const double load_ms = elapsed_ms(load_started);
  const Clock::time_point sample_started = Clock::now();
  const TranscriptionResult result = backend.transcribe(audio_path);
  const double sample_wall_ms = elapsed_ms(sample_started);
  check(result.failure_code.empty(), "short decode probe failed for beam " + std::to_string(beam_size));
  check(result.duration_ms == 24102, "short decode probe duration drift");
  check(result.traces.size() == 1, "short decode probe must use exactly one source window");
  const WindowTrace& trace = result.traces.front();
  check(trace.window_offset_ms == 0, "short decode probe window offset drift");
  check(trace.source_window_duration_ms == result.duration_ms, "short decode probe source window drift");
  check(trace.model_window_duration_ms == model_window_duration_ms, "short decode probe model window drift");
  check(trace.history_token_count_before == 0 && trace.history_token_count_after == 0,
        "short decode probe retained previous text");
  check(trace.prompt_token_count == 3, "short decode probe prompt drift");
  check(trace.seek_frames_after == source_frame_count(24102 * sample_rate / 1000 + 1),
        "short decode probe seek did not reach WAV end");
  check(!result.segments.empty(), "short decode probe returned no segments");

  Json segments = Json::array();
  for (const SegmentEvidence& segment : result.segments) {
    segments.push_back(segment_json(segment));
  }
  Json traces = Json::array();
  for (const WindowTrace& item : result.traces) {
    traces.push_back(trace_json(item));
  }
  return Json{
      {"beamSize", beam_size},
      {"status", "completed"},
      {"failure", nullptr},
      {"config", config_json(config)},
      {"segments", std::move(segments)},
      {"tokenTraces", std::move(traces)},
      {"timings", Json{
           {"loadMs", load_ms},
           {"sampleWallMs", sample_wall_ms},
           {"featureMs", result.feature_ms},
           {"modelGenerateMs", result.generate_ms},
           {"inferenceMs", result.inference_ms},
           {"inferenceRtf", result.inference_ms / result.duration_ms}}},
      {"threads", Json{
           {"resolvedIntraThreads", backend.resolved_intra_threads()},
           {"resolvedInterThreads", backend.resolved_inter_threads()}}}};
}

void run_short_decode_selection(const std::vector<std::string>& args) {
  const fs::path model_path = fs::u8path(required_arg(args, "--model"));
  const fs::path audio_path = fs::u8path(required_arg(args, "--audio"));
  const fs::path output_path = fs::u8path(required_arg(args, "--output"));
  const std::string corpus_id = required_arg(args, "--corpus-id");
  const std::string manifest_sha256 = required_arg(args, "--manifest-sha256");
  const std::string ass_sha256 = required_arg(args, "--ass-sha256");
  const std::string model_id = required_arg(args, "--model-id");
  const std::string model_revision = required_arg(args, "--model-revision");
  const std::string expected_model_hash = required_arg(args, "--model-bin-sha256");
  const std::vector<std::size_t> beams = beam_sizes_arg(args);

  check(is_task_local_output(output_path), "short decode output must stay under T06 research/local");
  check(fs::is_regular_file(audio_path), "authoritative short WAV is missing");
  check(
      sha256_file(model_path / "model.bin") == expected_model_hash,
      "model.bin does not match the locked revision");
  const std::int64_t duration_ms = verified_wav_duration_ms(audio_path);
  check(duration_ms == 24102, "short decode selection requires authoritative short-v1");

  Json rows = Json::array();
  for (std::size_t beam : beams) {
    rows.push_back(short_decode_selection_row(model_path, audio_path, beam));
  }

  const fs::path executable = current_executable();
  const Json raw{
      {"schemaVersion", 1},
      {"kind", "hikaru-ct2-whisper-short-decode-selection"},
      {"qualificationEligible", false},
      {"status", "completed"},
      {"source", Json{
           {"corpusId", corpus_id},
           {"manifestSha256", manifest_sha256},
           {"caseId", "short-v1"},
           {"audioSha256", sha256_file(audio_path)},
           {"assSha256", ass_sha256},
           {"durationMs", duration_ms}}},
      {"model", Json{
           {"id", model_id},
           {"revision", model_revision},
           {"files", model_file_identities(model_path)}}},
      {"runtime", Json{
           {"measurementExecutable", file_identity(executable)},
           {"requiredDlls", runtime_file_identities(executable)},
           {"device", "cpu"},
           {"computeType", "int8"},
           {"ctranslate2Version", "4.8.0"}}},
      {"probePolicy", Json{
           {"singleDeterministicSamplePerBeam", true},
           {"onlyVariable", "beamSize"},
           {"conditionOnPreviousText", false},
           {"timestampDrivenSeek", true}}},
      {"rows", std::move(rows)},
      {"resources", Json{
           {"peakProcessRssBytes", peak_working_set()},
           {"method", "GetProcessMemoryInfo.PeakWorkingSetSize"}}}};

  fs::create_directories(output_path.parent_path());
  const fs::path temporary = output_path.string() + ".tmp";
  std::ofstream(temporary, std::ios::binary) << std::setw(2) << raw << '\n';
  fs::remove(output_path);
  fs::rename(temporary, output_path);
  std::cout << Json{
      {"status", "completed"},
      {"kind", raw["kind"]},
      {"beamCount", raw["rows"].size()}}.dump() << '\n';
}

void run_evidence(
    const std::vector<std::string>& args,
    bool selected_cpu_candidate,
    bool candidate_b = false) {
  const fs::path model_path = fs::u8path(required_arg(args, "--model"));
  const fs::path audio_path = fs::u8path(required_arg(args, "--audio"));
  const fs::path output_path = fs::u8path(required_arg(args, "--output"));
  const char* lock_arg = candidate_b
      ? "--candidate-b-lock"
      : (selected_cpu_candidate ? "--candidate-lock" : "--algorithm-lock");
  const fs::path candidate_lock = fs::u8path(required_arg(args, lock_arg));
  const fs::path production_worker = fs::u8path(required_arg(args, "--production-worker"));
  const std::string model_id = required_arg(args, "--model-id");
  const std::string model_revision = required_arg(args, "--model-revision");
  const std::string expected_model_hash = required_arg(args, "--model-bin-sha256");
  const std::string case_id = required_arg(args, "--case-id");
  const int repeats = integer_arg(args, "--repeats", 1);

  check(is_task_local_output(output_path), "raw output must stay under T06 research/local");
  check(fs::is_regular_file(candidate_lock), "candidate lock is missing");
  check(fs::is_regular_file(production_worker), "production worker is missing");
  check(
      sha256_file(model_path / "model.bin") == expected_model_hash,
      "model.bin does not match the locked revision");
  const Json path_policy = candidate_b ? restricted_path_policy() : Json(nullptr);

  CandidateAConfig config;
  if (!selected_cpu_candidate && !candidate_b) {
    config.beam_size = 5;
    config.condition_on_previous_text = true;
  }
  const fs::path executable = current_executable();
  const fs::path runtime_dir = executable.parent_path();
  const std::optional<fs::path> vad_model_path = candidate_b
      ? std::optional<fs::path>(runtime_dir / "silero_vad_v6.onnx")
      : std::nullopt;
  const Clock::time_point load_started = Clock::now();
  CTranslate2WhisperBackend backend(model_path, config, vad_model_path);
  const double load_ms = elapsed_ms(load_started);
  Json samples = Json::array();
  std::int64_t duration_ms = 0;
  bool failed = false;
  for (int repeat = 0; repeat < repeats; ++repeat) {
    std::vector<std::int64_t> progress;
    const TranscriptionResult result = backend.transcribe(
        audio_path,
        candidate_b
            ? ProgressCallback([&](std::int64_t processed_ms) {
                progress.push_back(processed_ms);
              })
            : ProgressCallback{});
    duration_ms = result.duration_ms;
    Json segments = Json::array();
    for (const SegmentEvidence& segment : result.segments) {
      segments.push_back(segment_json(segment));
    }
    Json traces = Json::array();
    for (const WindowTrace& trace : result.traces) {
      traces.push_back(trace_json(trace));
    }
    Json vad_intervals = Json::array();
    for (const VadSpeechInterval& interval : result.vad_intervals) {
      vad_intervals.push_back(vad_interval_json(interval));
    }
    if (candidate_b) {
      check(result.vad_enabled, "Candidate B evidence did not enable VAD");
      check(!progress.empty() && progress.back() == result.duration_ms,
            "Candidate B progress did not reach original WAV end");
      check(std::is_sorted(progress.begin(), progress.end()),
            "Candidate B source progress regressed");
    }
    Json sample{
        {"status", result.failure_code.empty() ? "completed" : "failed"},
        {"runKind", repeat == 0 ? "cold" : "warm"},
        {"repeatIndex", repeat + 1},
        {"segments", std::move(segments)},
        {"tokenTraces", std::move(traces)},
        {"failure", result.failure_code.empty()
             ? Json(nullptr)
             : Json{{"code", result.failure_code}}},
        {"progressMs", candidate_b ? Json(progress) : Json(nullptr)},
        {"vad", candidate_b ? Json{
             {"inferenceMs", result.vad_ms},
             {"originalSampleCount", result.original_sample_count},
             {"compressedSampleCount", result.compressed_sample_count},
             {"rowCount", result.vad_row_count},
             {"batchCount", result.vad_batch_count},
             {"intervals", std::move(vad_intervals)}} : Json(nullptr)},
        {"timings", Json{
             {"vadMs", result.vad_ms},
             {"featureMs", result.feature_ms},
             {"modelGenerateMs", result.generate_ms},
             {"inferenceMs", result.inference_ms},
             {"inferenceRtf", result.inference_ms / result.duration_ms}}}};
    if (repeat == 0) {
      const double total_ms = elapsed_ms(process_started);
      sample["timings"]["loadMs"] = load_ms;
      sample["timings"]["totalMs"] = total_ms;
      sample["timings"]["totalRtf"] = total_ms / result.duration_ms;
    }
    failed = failed || !result.failure_code.empty();
    samples.push_back(std::move(sample));
    if (failed) {
      break;
    }
  }

  Json runtime_files = Json::array();
  std::vector<const char*> runtime_names{"ctranslate2.dll", "hikaru_asr_tokenizer.dll"};
  if (candidate_b) {
    runtime_names.push_back("onnxruntime.dll");
    runtime_names.push_back("onnxruntime_providers_shared.dll");
  }
  for (const char* name : runtime_names) {
    const fs::path path = runtime_dir / name;
    check(fs::is_regular_file(path), std::string("runtime DLL missing: ") + name);
    Json identity = file_identity(path);
    identity["name"] = name;
    runtime_files.push_back(std::move(identity));
  }

  Json loaded_modules = nullptr;
  if (candidate_b) {
    loaded_modules = loaded_runtime_modules();
    validate_candidate_b_loaded_modules(loaded_modules);
  }

  Json raw{
      {"schemaVersion", 1},
      {"kind", candidate_b
           ? "hikaru-ct2-whisper-candidate-b-raw"
           : (selected_cpu_candidate
               ? "hikaru-ct2-whisper-selected-cpu-raw"
               : "hikaru-ct2-whisper-candidate-a-raw")},
      {"status", failed ? "failed" : "completed"},
      {"caseId", case_id},
      {"engine", "faster-whisper"},
      {"model", Json{
           {"id", model_id},
           {"revision", model_revision},
           {"files", model_file_identities(model_path)}}},
      {"audio", Json{
           {"sha256", sha256_file(audio_path)},
           {"durationMs", duration_ms}}},
      {"candidate", candidate_b
           ? "candidate-b-silero-v6-beam1-no-history"
           : (selected_cpu_candidate ? "selected-cpu-beam1-no-history" : "A")},
      {"config", candidate_b
           ? candidate_b_config_json(config)
           : (selected_cpu_candidate ? config_json(config) : Json{
               {"beamSize", 5},
               {"patience", 1.0},
               {"lengthPenalty", 1.0},
               {"repetitionPenalty", 1.0},
               {"noRepeatNgramSize", 0},
               {"maxLength", 448},
               {"temperature", 0.0},
               {"conditionOnPreviousText", true},
               {"promptResetOnTemperature", 0.5},
               {"noSpeechThreshold", 0.6},
               {"logProbThreshold", -1.0},
               {"maxInitialTimestampIndex", 50},
               {"modelWindowDurationMs", 30000},
               {"timestampResolutionMs", 20},
               {"vad", false}})},
      {"runtime", Json{
           {"measurementExecutable", file_identity(executable)},
           {"productionWorker", file_identity(production_worker)},
           {"requiredDlls", std::move(runtime_files)},
           {"device", "cpu"},
           {"computeType", "int8"},
           {"ctranslate2Version", "4.8.0"},
           {"onnxRuntimeVersion", candidate_b ? Json("1.28.0") : Json(nullptr)},
           {"cpu", candidate_b ? cpu_identity() : Json(nullptr)},
           {"pathPolicy", path_policy},
           {"moduleLayout", candidate_b ? candidate_b_module_layout() : Json(nullptr)},
           {"loadedModules", std::move(loaded_modules)},
           {"vadModel", candidate_b
                ? file_identity(runtime_dir / "silero_vad_v6.onnx")
                : Json(nullptr)}}},
      {"samples", std::move(samples)},
      {"resources", Json{
           {"peakProcessRssBytes", peak_working_set()},
           {"method", "GetProcessMemoryInfo.PeakWorkingSetSize"}}}};
  raw[candidate_b
          ? "candidateBLockSha256"
          : (selected_cpu_candidate ? "candidateLockSha256" : "algorithmLockSha256")] =
      sha256_file(candidate_lock);

  fs::create_directories(output_path.parent_path());
  const fs::path temporary = output_path.string() + ".tmp";
  std::ofstream(temporary, std::ios::binary) << std::setw(2) << raw << '\n';
  fs::remove(output_path);
  fs::rename(temporary, output_path);
  std::cout << Json{
      {"status", failed ? "failed" : "completed"},
      {"caseId", case_id},
      {"sampleCount", raw["samples"].size()}}.dump() << '\n';
}

void run_cuda_development_evidence(const std::vector<std::string>& args) {
  const fs::path model_path = fs::u8path(required_arg(args, "--model"));
  const fs::path audio_path = fs::u8path(required_arg(args, "--audio"));
  const fs::path output_path = fs::u8path(required_arg(args, "--output"));
  const fs::path input_lock = fs::u8path(required_arg(args, "--input-lock"));
  const fs::path production_worker = fs::u8path(required_arg(args, "--production-worker"));
  const std::string model_id = required_arg(args, "--model-id");
  const std::string model_revision = required_arg(args, "--model-revision");
  const std::string expected_model_hash = required_arg(args, "--model-bin-sha256");
  const std::string case_id = required_arg(args, "--case-id");
  const std::string requested_device = lowercase(required_arg(args, "--device"));
  const bool discovery = std::find(args.begin(), args.end(), "--module-discovery") != args.end();
  const int repeats = integer_arg(args, "--repeats", discovery ? 1 : 4);

  check(is_t07_task_local_output(output_path), "T07 raw output must stay under research/local");
  check(fs::is_regular_file(input_lock), "T07 CUDA input lock is missing");
  check(fs::is_regular_file(production_worker), "T07 production worker is missing");
  check(requested_device == "cpu" || requested_device == "cuda", "T07 device must be cpu or cuda");
  check(repeats == (discovery ? 1 : 4), "T07 evidence requires discovery=1 or measurement=4 repeats");
  check(
      sha256_file(model_path / "model.bin") == expected_model_hash
          && expected_model_hash == "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1",
      "T07 model.bin does not match locked large-v3");

  const std::int64_t expected_duration = case_id == "short-v1"
      ? 24102
      : (case_id == "medium-v1-first-120s" ? 120000 : -1);
  check(expected_duration > 0, "T07 case identity is not allowed");
  check(verified_wav_duration_ms(audio_path) == expected_duration, "T07 audio duration drift");
  const std::string expected_audio_hash = case_id == "short-v1"
      ? "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211"
      : "d7b8c62d1358eee4f7ca40596ec424e91cde6992654add5c0219cdeed3907b42";
  check(sha256_file(audio_path) == expected_audio_hash, "T07 audio identity drift");
  Json source_identity = nullptr;
  if (case_id == "medium-v1-first-120s") {
    const fs::path source_audio = fs::u8path(required_arg(args, "--source-audio"));
    check(
        sha256_file(source_audio)
            == "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458",
        "T07 diagnostic source identity drift");
    verify_wav_prefix(source_audio, audio_path);
    source_identity = Json{{"sha256", sha256_file(source_audio)}, {"pcmPrefixVerified", true}};
  }

  const Json path_policy = cuda_development_path_policy();
  const BackendExecutionConfig execution = requested_device == "cuda"
      ? cuda_execution_config()
      : cpu_execution_config();
  const Clock::time_point load_started = Clock::now();
  CTranslate2WhisperBackend backend(model_path, {}, std::nullopt, execution);
  const double load_ms = elapsed_ms(load_started);
  const BackendExecutionAttestation attestation = backend.execution_attestation();
  const std::string resolved_device = attestation.config.device == ExecutionDevice::Cuda
      ? "cuda"
      : "cpu";
  const std::string compute_type = attestation.config.compute_type == ExecutionComputeType::Float16
      ? "float16"
      : "int8";
  check(resolved_device == requested_device, "T07 resolved device differs from request");

  Json samples = Json::array();
  for (int repeat = 0; repeat < repeats; ++repeat) {
    const Clock::time_point sample_started = Clock::now();
    const TranscriptionResult result = backend.transcribe(audio_path);
    const double sample_wall_ms = elapsed_ms(sample_started);
    check(result.failure_code.empty(), "T07 completed measurement failed: " + result.failure_code);
    check(result.duration_ms == expected_duration, "T07 measured duration drift");
    check(!result.traces.empty(), "T07 completed measurement has no generation trace");
    const std::size_t generation_calls = std::accumulate(
        result.traces.begin(),
        result.traces.end(),
        std::size_t{0},
        [](std::size_t total, const WindowTrace& trace) {
          return total + trace.generation_call_count;
        });
    check(generation_calls > 0, "T07 completed measurement has no generation call");

    Json segments = Json::array();
    for (const SegmentEvidence& segment : result.segments) {
      segments.push_back(segment_json(segment));
    }
    Json traces = Json::array();
    for (const WindowTrace& trace : result.traces) {
      traces.push_back(trace_json(trace));
    }
    Json sample{
        {"status", "completed"},
        {"runKind", discovery ? "module-discovery" : (repeat == 0 ? "cold" : "warm")},
        {"repeatIndex", repeat + 1},
        {"segments", std::move(segments)},
        {"tokenTraces", std::move(traces)},
        {"generationCompleted", true},
        {"generationCallCount", generation_calls},
        {"timings", Json{
             {"loadMs", repeat == 0 ? Json(load_ms) : Json(nullptr)},
             {"sampleWallMs", sample_wall_ms},
             {"featureMs", result.feature_ms},
             {"modelGenerateMs", result.generate_ms},
             {"inferenceMs", result.inference_ms},
             {"inferenceRtf", result.inference_ms / result.duration_ms}}}};
    if (repeat == 0) {
      const double process_wall_ms = elapsed_ms(process_started);
      sample["timings"]["processWallMs"] = process_wall_ms;
      sample["timings"]["processWallRtf"] = process_wall_ms / result.duration_ms;
    }
    samples.push_back(std::move(sample));
  }

  const fs::path executable = current_executable();
  Json modules = cuda_development_loaded_modules(path_policy);
  check(std::none_of(modules.begin(), modules.end(), [](const Json& module) {
          return lowercase(module.at("name").get<std::string>()).rfind("cudnn", 0) == 0;
        }),
        "T07 no-cuDNN identity loaded an unexpected cuDNN module");
  const Json gpu = requested_device == "cuda"
      ? attested_cuda_gpu(modules, attestation)
      : Json(nullptr);

  const Json raw{
      {"schemaVersion", 1},
      {"kind", "hikaru-ct2-whisper-cuda-development-raw"},
      {"status", "completed"},
      {"qualificationEligible", false},
      {"moduleDiscovery", discovery},
      {"caseId", case_id},
      {"engine", "faster-whisper"},
      {"model", Json{
           {"id", model_id},
           {"revision", model_revision},
           {"files", model_file_identities(model_path)}}},
      {"audio", Json{
           {"sha256", expected_audio_hash},
           {"durationMs", expected_duration},
           {"source", source_identity}}},
      {"algorithm", "selected-timestamp-no-history-beam1"},
      {"config", config_json({})},
      {"inputLockSha256", sha256_file(input_lock)},
      {"runtime", Json{
           {"measurementExecutable", file_identity(executable)},
           {"productionWorker", file_identity(production_worker)},
           {"requiredDlls", runtime_file_identities(executable, true)},
           {"requestedDevice", requested_device},
           {"resolvedDevice", resolved_device},
           {"computeType", compute_type},
           {"deviceIndex", attestation.config.device_index},
           {"ctranslate2Version", "4.8.0"},
           {"cudaBuildEnabled", true},
           {"cudaDynamicLoading", true},
           {"withCudnn", false},
           {"gpu", gpu},
           {"cpu", cpu_identity()},
           {"pathPolicy", path_policy},
           {"loadedModules", std::move(modules)}}},
      {"samples", std::move(samples)},
      {"resources", Json{
           {"peakProcessRssBytes", peak_working_set()},
           {"method", "GetProcessMemoryInfo.PeakWorkingSetSize"}}}};

  fs::create_directories(output_path.parent_path());
  const fs::path temporary = output_path.string() + ".tmp";
  std::ofstream(temporary, std::ios::binary) << std::setw(2) << raw << '\n';
  fs::remove(output_path);
  fs::rename(temporary, output_path);
  std::cout << Json{
      {"status", "completed"},
      {"caseId", case_id},
      {"device", requested_device},
      {"moduleDiscovery", discovery},
      {"sampleCount", repeats}}.dump() << '\n';
}

#ifdef HIKARU_ASR_WHISPER_PARITY_BISECT
#include "whisper_execution_parity_discovery.inc"
#endif

void run_whisper_quality_evidence(
    const std::vector<std::string>& args,
    bool diagnostic,
    bool vad_diagnostic = false,
    bool fallback_diagnostic = false) {
  const bool selection_diagnostic = diagnostic || vad_diagnostic || fallback_diagnostic;
  const bool exact_vad = vad_diagnostic || fallback_diagnostic;
  check(static_cast<int>(diagnostic) + static_cast<int>(vad_diagnostic)
            + static_cast<int>(fallback_diagnostic) <= 1,
        "T06R diagnostic modes are mutually exclusive");
  if (exact_vad) {
    validate_closed_mode_args(
        args,
        fallback_diagnostic
            ? "--run-whisper-quality-fallback-diagnostic"
            : "--run-whisper-quality-vad-diagnostic",
        {"--cell", "--model", "--audio", "--output", "--input-lock",
         "--production-worker", "--model-id", "--model-revision",
         "--model-bin-sha256", "--repeats", "--vad-model"});
  }
  const fs::path model_path = fs::u8path(required_arg(args, "--model"));
  const fs::path audio_path = fs::u8path(required_arg(args, "--audio"));
  const fs::path output_path = fs::u8path(required_arg(args, "--output"));
  const fs::path input_lock = fs::u8path(required_arg(args, "--input-lock"));
  const fs::path production_worker = fs::u8path(required_arg(args, "--production-worker"));
  const std::string model_id = required_arg(args, "--model-id");
  const std::string model_revision = required_arg(args, "--model-revision");
  const std::string expected_model_hash = required_arg(args, "--model-bin-sha256");

  check(is_t06r_task_local_output(output_path),
        "T06R raw output must stay under research/local");
  check(fs::is_regular_file(input_lock), "T06R input lock is missing");
  check(!exact_vad || is_t06r_tracked_research_file(input_lock),
        "T06R exact-VAD diagnostic lock must be a tracked research file");
  check(fs::is_regular_file(production_worker), "T06R production worker is missing");

  const bool large_v3 = model_id == "Systran/faster-whisper-large-v3"
      && model_revision == "edaa852ec7e145841d8ffdb056a99866b5f0a478"
      && expected_model_hash == "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1";
  const bool large_v2 = model_id == "Systran/faster-whisper-large-v2"
      && model_revision == "f0fe81560cb8b68660e564f55dd99207059c092e"
      && expected_model_hash == "bf2a9746382e1aa7ffff6b3a0d137ed9edbd9670c3b87e5d35f5e85e70d0333a";
  check(large_v3 || (!selection_diagnostic && large_v2),
        "T06R model identity is not an allowed anchor");
  check(sha256_file(model_path / "model.bin") == expected_model_hash,
        "T06R model.bin identity drift");

  CandidateAConfig config;
  std::string case_id;
  std::string candidate_id;
  if (selection_diagnostic) {
    const std::string cell_id = required_arg(args, "--cell");
    const WhisperQualityDiagnosticCell cell = fallback_diagnostic
        ? whisper_quality_fallback_diagnostic_cell(cell_id)
        : (vad_diagnostic
            ? whisper_quality_vad_diagnostic_cell(cell_id)
            : whisper_quality_diagnostic_cell(cell_id));
    config = cell.config;
    case_id = cell.case_id;
    candidate_id = cell.id;
  } else {
    case_id = required_arg(args, "--case-id");
    candidate_id = "ordinary-whisper-b" + std::to_string(config.beam_size)
        + (config.condition_on_previous_text ? "-history" : "-no-history");
  }

  const std::map<std::string, std::pair<std::int64_t, std::string>> expected_cases{
      {"short-v1", {24102, "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211"}},
      {"medium-v1", {498872, "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458"}},
      {"long-v2", {4144235, "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e"}},
  };
  const auto expected_case = expected_cases.find(case_id);
  check(expected_case != expected_cases.end(), "T06R case identity is not allowed");
  if (selection_diagnostic) {
    check(case_id != "long-v2", "T06R diagnostics do not allow long-v2");
  }
  check(verified_wav_duration_ms(audio_path) == expected_case->second.first
            && sha256_file(audio_path) == expected_case->second.second,
        "T06R authoritative audio identity drift");

  const int expected_repeats = selection_diagnostic ? 1 : (case_id == "short-v1" ? 4 : 1);
  const int repeats = integer_arg(args, "--repeats", expected_repeats);
  check(repeats == expected_repeats, "T06R sample count drift");

  std::optional<fs::path> vad_model_path;
  if (exact_vad) {
    const fs::path path = fs::u8path(required_arg(args, "--vad-model"));
    check(is_t06r_task_local_output(path) && fs::is_regular_file(path),
          "T06R VAD asset must stay under research/local");
    check(fs::file_size(path) == 1245151
              && sha256_file(path)
                  == "4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2",
          "T06R exact Silero V6 asset identity drift");
    vad_model_path = path;
  }

  const Json path_policy = cuda_development_path_policy();
  const fs::path executable = current_executable();
  if (exact_vad) {
    const std::string lock_text = read_text_file(input_lock);
    const auto require_locked_hash = [&](const std::string& hash, const std::string& label) {
      check(lock_text.find(hash) != std::string::npos,
            "T06R VAD diagnostic lock does not freeze " + label);
    };
    require_locked_hash(expected_case->second.second, "audio");
    require_locked_hash(sha256_file(executable), "measurement executable");
    require_locked_hash(sha256_file(production_worker), "production worker");
    require_locked_hash(path_policy.at("rootIdentitySha256").get<std::string>(),
                        "restricted PATH root identity");
    for (const Json& file : model_file_identities(model_path)) {
      require_locked_hash(file.at("sha256").get<std::string>(),
                          "model file " + file.at("name").get<std::string>());
    }
    for (const Json& file : runtime_file_identities(executable, true)) {
      require_locked_hash(file.at("sha256").get<std::string>(),
                          "runtime file " + file.at("name").get<std::string>());
    }
    require_locked_hash(sha256_file(*vad_model_path), "exact Silero V6 model");
    if (fallback_diagnostic) {
      require_locked_hash(
          "9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23",
          "exact zlib 1.3.1 archive");
      require_locked_hash(
          "5d5ffb00018561d3d529b2c72e1d9f5fff055bea725f3cccc7c6c67f5cc8ffe4",
          "faster-whisper 1.2.1 source oracle");
      check(lock_text.find("upstream-generation-fallback-parity-v1") != std::string::npos
                && lock_text.find("short-b5-on-vad-fallback") != std::string::npos
                && lock_text.find("medium-b5-on-vad-fallback") != std::string::npos
                && lock_text.find("does not authorize acquisition") != std::string::npos,
            "T06R fallback diagnostic lock scope is incomplete");
    }
  }
  const Clock::time_point load_started = Clock::now();
  CTranslate2WhisperBackend backend(
      model_path,
      config,
      vad_model_path,
      cuda_execution_config());
  const double load_ms = elapsed_ms(load_started);
  const BackendExecutionAttestation attestation = backend.execution_attestation();
  check(attestation.config.device == ExecutionDevice::Cuda
            && attestation.config.compute_type == ExecutionComputeType::Float16
            && attestation.config.device_index == 0,
        "T06R CUDA execution mapping drift");

  Json samples = Json::array();
  bool failed = false;
  for (int repeat = 0; repeat < repeats; ++repeat) {
    std::vector<std::int64_t> progress;
    const Clock::time_point sample_started = Clock::now();
    const TranscriptionResult result = backend.transcribe(
        audio_path,
        exact_vad
            ? ProgressCallback([&](std::int64_t processed_ms) {
                progress.push_back(processed_ms);
              })
            : ProgressCallback{});
    const double sample_wall_ms = elapsed_ms(sample_started);
    check(result.duration_ms == expected_case->second.first,
          "T06R measured duration drift");
    if (exact_vad) {
      check(result.vad_enabled, "T06R exact-VAD diagnostic did not enable VAD");
      check(std::is_sorted(progress.begin(), progress.end()),
            "T06R VAD diagnostic source progress regressed");
      if (result.failure_code.empty()) {
        check(!progress.empty() && progress.back() == result.duration_ms,
              "T06R VAD diagnostic progress did not reach WAV end");
      }
    }

    Json segments = Json::array();
    for (const SegmentEvidence& segment : result.segments) {
      segments.push_back(segment_json(segment));
    }
    Json traces = Json::array();
    std::size_t generation_calls = 0;
    for (const WindowTrace& trace : result.traces) {
      traces.push_back(trace_json(trace));
      generation_calls += trace.generation_call_count;
    }
    check(!result.traces.empty(), "T06R sample has no complete trace");
    if (result.failure_code.empty()) {
      check(generation_calls > 0, "T06R completed sample has no generation call");
    }

    Json vad_intervals = Json::array();
    if (exact_vad) {
      for (const VadSpeechInterval& interval : result.vad_intervals) {
        vad_intervals.push_back(vad_interval_json(interval));
      }
      check(result.original_sample_count > 0
                && result.compressed_sample_count > 0
                && result.compressed_sample_count <= result.original_sample_count
                && !result.vad_intervals.empty(),
            "T06R VAD diagnostic compression provenance is incomplete");
    }

    Json timings{
        {"loadMs", repeat == 0 ? Json(load_ms) : Json(nullptr)},
        {"sampleWallMs", sample_wall_ms},
        {"featureMs", result.feature_ms},
        {"modelGenerateMs", result.generate_ms},
        {"inferenceMs", result.inference_ms},
        {"inferenceRtf", result.inference_ms / result.duration_ms}};
    if (exact_vad) {
      timings["vadMs"] = result.vad_ms;
    }
    if (repeat == 0) {
      const double process_wall_ms = elapsed_ms(process_started);
      timings["processWallMs"] = process_wall_ms;
      timings["processWallRtf"] = process_wall_ms / result.duration_ms;
    }

    const bool sample_failed = !result.failure_code.empty();
    Json sample{
        {"status", sample_failed ? "failed" : "completed"},
        {"runKind", fallback_diagnostic
             ? "fallback-diagnostic"
             : (vad_diagnostic
                 ? "vad-diagnostic"
                 : (diagnostic ? "diagnostic" : (repeat == 0 ? "cold" : "warm")))},
        {"repeatIndex", repeat + 1},
        {"segments", std::move(segments)},
        {"tokenTraces", std::move(traces)},
        {"generationCompleted", !sample_failed},
        {"generationCallCount", generation_calls},
        {"failure", sample_failed ? Json{{"code", result.failure_code}} : Json(nullptr)},
        {"timings", std::move(timings)}};
    if (exact_vad) {
      sample["progressMs"] = std::move(progress);
      sample["vad"] = Json{
          {"inferenceMs", result.vad_ms},
          {"originalSampleCount", result.original_sample_count},
          {"compressedSampleCount", result.compressed_sample_count},
          {"rowCount", result.vad_row_count},
          {"batchCount", result.vad_batch_count},
          {"intervals", std::move(vad_intervals)}};
    }
    samples.push_back(std::move(sample));
    if (sample_failed) {
      failed = true;
      break;
    }
  }

  Json modules = cuda_development_loaded_modules(path_policy);
  check(std::none_of(modules.begin(), modules.end(), [](const Json& module) {
          return lowercase(module.at("name").get<std::string>()).rfind("cudnn", 0) == 0;
        }),
        "T06R no-cuDNN identity loaded an unexpected cuDNN module");
  if (exact_vad) {
    const Json& ort = loaded_module_named(modules, "onnxruntime.dll");
    check(ort.at("rootRole") == "task-local-runtime-bin",
          "T06R VAD diagnostic ORT escaped the task-local runtime root");
  }
  const Json gpu = attested_cuda_gpu(modules, attestation);
  Json config_identity = exact_vad
      ? candidate_b_config_json(config)
      : config_json(config);
  if (exact_vad) {
    config_identity["vadAlgorithm"] = "faster-whisper-v1.2.1-silero-v6-exact";
  }

  const Json raw{
      {"schemaVersion", 1},
      {"kind", fallback_diagnostic
           ? "hikaru-ct2-whisper-gpu-quality-fallback-diagnostic-raw"
           : (vad_diagnostic
               ? "hikaru-ct2-whisper-gpu-quality-vad-diagnostic-raw"
               : (diagnostic
                   ? "hikaru-ct2-whisper-gpu-quality-diagnostic-raw"
                   : "hikaru-ct2-whisper-gpu-quality-candidate-raw"))},
      {"status", failed ? "failed" : "completed"},
      {"qualificationEligible", !selection_diagnostic},
      {"comparisonProfile", "native-gpu-authoritative-v1"},
      {"candidateId", candidate_id},
      {"diagnosticCell", selection_diagnostic ? Json(candidate_id) : Json(nullptr)},
      {"caseId", case_id},
      {"engine", "faster-whisper"},
      {"model", Json{
           {"id", model_id},
           {"revision", model_revision},
           {"files", model_file_identities(model_path)}}},
      {"audio", Json{
           {"sha256", expected_case->second.second},
           {"durationMs", expected_case->second.first}}},
      {"algorithm", fallback_diagnostic
           ? "upstream-generation-fallback-parity-v1"
           : (vad_diagnostic
               ? "ordinary-whisper-timestamp-driven-silero-v6"
               : "ordinary-whisper-timestamp-driven")},
      {"config", std::move(config_identity)},
      {"inputLockSha256", sha256_file(input_lock)},
      {"runtime", Json{
           {"measurementExecutable", file_identity(executable)},
           {"productionWorker", file_identity(production_worker)},
           {"requiredDlls", runtime_file_identities(executable, true)},
           {"requestedDevice", "cuda"},
           {"resolvedDevice", "cuda"},
           {"computeType", "float16"},
           {"deviceIndex", 0},
           {"ctranslate2Version", "4.8.0"},
           {"onnxRuntimeVersion", exact_vad ? Json("1.28.0") : Json(nullptr)},
           {"vadModel", exact_vad ? file_identity(*vad_model_path) : Json(nullptr)},
           {"cudaBuildEnabled", true},
           {"cudaDynamicLoading", true},
           {"withCudnn", false},
           {"gpu", gpu},
           {"cpu", cpu_identity()},
           {"pathPolicy", path_policy},
           {"loadedModules", std::move(modules)}}},
      {"samples", std::move(samples)},
      {"resources", Json{
           {"peakProcessRssBytes", peak_working_set()},
           {"method", "GetProcessMemoryInfo.PeakWorkingSetSize"}}}};

  fs::create_directories(output_path.parent_path());
  const fs::path temporary = output_path.string() + ".tmp";
  std::ofstream(temporary, std::ios::binary) << std::setw(2) << raw << '\n';
  fs::remove(output_path);
  fs::rename(temporary, output_path);
  std::cout << Json{
      {"status", failed ? "failed" : "completed"},
      {"caseId", case_id},
      {"candidateId", candidate_id},
      {"sampleCount", raw["samples"].size()}}.dump() << '\n';
}

void run_kotoba_evidence(const std::vector<std::string>& args, bool k2) {
  const fs::path output_path = fs::u8path(required_arg(args, "--output"));
  check(is_t08_task_local_output(output_path),
        "T08 raw output must stay under research/local");

  const fs::path model_path = fs::u8path(required_arg(args, "--model"));
  const fs::path audio_path = fs::u8path(required_arg(args, "--audio"));
  const fs::path input_lock = fs::u8path(required_arg(args, "--input-lock"));
  const fs::path production_worker = fs::u8path(required_arg(args, "--production-worker"));
  const std::string case_id = required_arg(args, "--case-id");
  const int repeats = integer_arg(args, "--repeats", case_id == "short-v1" ? 4 : 1);
  check(fs::is_regular_file(input_lock), "T08 Kotoba input lock is missing");
  check(fs::is_regular_file(production_worker), "T08 production worker is missing");
  check(repeats == (case_id == "short-v1" ? 4 : 1),
        "T08 requires short=4 repeats and medium/long=1 repeat");

  const std::map<std::string, std::pair<std::uintmax_t, std::string>> expected_model_files{
      {"config.json", {2394, "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9"}},
      {"model.bin", {1512927867, "60d2bc2e33de9d43f2745be09caefe1161acab670f6796d4a750d8d848382b36"}},
      {"preprocessor_config.json", {340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"}},
      {"tokenizer.json", {2481381, "f70c9740a90657b489cf05b0fa0605c1d497db542f11a70a8cc80a025c94c7d8"}},
      {"vocabulary.json", {1068114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"}},
  };
  const Json model_files = model_file_identities(model_path);
  check(model_files.size() == expected_model_files.size(),
        "T08 Kotoba model file set drifted");
  for (const Json& file : model_files) {
    const std::string name = file.at("name").get<std::string>();
    const auto expected = expected_model_files.find(name);
    check(expected != expected_model_files.end()
              && file.at("sizeBytes").get<std::uintmax_t>() == expected->second.first
              && file.at("sha256").get<std::string>() == expected->second.second,
          "T08 Kotoba model identity drifted: " + name);
  }
  check(model_path.filename() == "f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc"
            && model_path.parent_path().filename() == "snapshots"
            && model_path.parent_path().parent_path().filename()
                == "models--kotoba-tech--kotoba-whisper-v2.0-faster"
            && model_path.parent_path().parent_path().parent_path().filename() == "hub",
        "T08 model is not the exact pinned Hugging Face snapshot path");

  const std::map<std::string, std::pair<std::int64_t, std::string>> expected_cases{
      {"short-v1", {24102, "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211"}},
      {"medium-v1", {498872, "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458"}},
      {"long-v1", {4144235, "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e"}},
      {"long-v2", {4144235, "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e"}},
  };
  const auto expected_case = expected_cases.find(case_id);
  check(expected_case != expected_cases.end(), "T08 case identity is not allowed");
  check(verified_wav_duration_ms(audio_path) == expected_case->second.first
            && sha256_file(audio_path) == expected_case->second.second,
        "T08 authoritative audio identity drifted");

  const Json path_policy = cuda_development_path_policy();
  const CandidateAConfig config = k2 ? kotoba_k2_config() : kotoba_config();
  const Clock::time_point load_started = Clock::now();
  CTranslate2WhisperBackend backend(
      model_path,
      config,
      std::nullopt,
      cuda_execution_config(),
      true);
  const double load_ms = elapsed_ms(load_started);
  check(backend.mel_bins() == 128, "T08 Kotoba model mel shape drifted");
  const BackendExecutionAttestation attestation = backend.execution_attestation();
  check(attestation.config.device == ExecutionDevice::Cuda
            && attestation.config.compute_type == ExecutionComputeType::Float16
            && attestation.config.device_index == 0,
        "T08 CUDA execution mapping drifted");

  Json samples = Json::array();
  std::int64_t source_frames = 0;
  bool failed = false;
  for (int repeat = 0; repeat < repeats; ++repeat) {
    const Clock::time_point sample_started = Clock::now();
    std::vector<std::int64_t> progress;
    const TranscriptionResult result = backend.transcribe(
        audio_path,
        k2 ? ProgressCallback([&](std::int64_t processed_ms) {
          progress.push_back(processed_ms);
        }) : ProgressCallback{});
    const double sample_wall_ms = elapsed_ms(sample_started);
    const std::int64_t current_source_frames = source_frame_count(result.original_sample_count);
    if (source_frames == 0) {
      source_frames = current_source_frames;
    }
    check(source_frames == current_source_frames, "T08 source frame identity drifted");
    Json segments = Json::array();
    for (const SegmentEvidence& segment : result.segments) {
      segments.push_back(segment_json(segment));
    }
    Json traces = Json::array();
    std::size_t generation_calls = 0;
    std::size_t trace_index = 0;
    for (const WindowTrace& trace : result.traces) {
      check(trace.source_window_duration_ms > 0
                && trace.source_window_duration_ms <= 15000
                && trace.model_window_duration_ms == 30000
                && trace.history_token_count_before == 0
                && trace.history_token_count_after == 0,
            "T08 Kotoba window/profile trace drifted");
      if (k2) {
        const std::int64_t remaining = current_source_frames - trace.seek_frames_before;
        const std::int64_t expected_advance = std::min({
            trace.proposed_advance_frames,
            std::int64_t{1000},
            remaining});
        check(trace.k2_candidate
                  && trace.window_index == trace_index
                  && trace.applied_seek_advance_frames == expected_advance
                  && trace.seek_frames_after - trace.seek_frames_before == expected_advance
                  && trace.next_window_start_ms
                      == std::min(result.duration_ms, trace.seek_frames_after * 10)
                  && trace.ownership_start_ms == trace.seek_frames_before * 10
                  && trace.ownership_end_ms
                      == (trace.final_window ? result.duration_ms : trace.next_window_start_ms)
                  && trace.parsed_segment_count
                      == trace.non_owner_discarded_count + trace.owned_before_dedup_count
                  && trace.owned_before_dedup_count
                      == trace.exact_duplicate_discarded_count + trace.emitted_segment_count,
              "T08 K2 seek/ownership trace drifted");
        if (trace.source_window_duration_ms == 15000 && !trace.final_window) {
          check(trace.actual_source_overlap_frames >= 500,
                "T08 K2 full-window overlap floor drifted");
        }
      } else {
        check(!trace.k2_candidate, "T08 K1 unexpectedly used K2 orchestration");
      }
      generation_calls += trace.generation_call_count;
      traces.push_back(trace_json(trace));
      ++trace_index;
    }
    if (result.failure_code.empty()) {
      check(!result.segments.empty() && !result.traces.empty() && generation_calls > 0,
            "T08 completed sample has incomplete segment/trace evidence");
      check(result.traces.back().seek_frames_after
                == source_frame_count(result.original_sample_count),
            "T08 K1 trace chain did not reach WAV end");
    }
    if (k2 && result.failure_code.empty()) {
      check(!progress.empty()
                && std::is_sorted(progress.begin(), progress.end())
                && progress.back() == result.duration_ms,
            "T08 K2 ownership-frontier progress drifted");
    }
    Json sample{
        {"status", result.failure_code.empty() ? "completed" : "failed"},
        {"runKind", repeat == 0 ? "cold" : "warm"},
        {"repeatIndex", repeat + 1},
        {"segments", std::move(segments)},
        {"tokenTraces", std::move(traces)},
        {"generationCompleted", result.failure_code.empty()},
        {"generationCallCount", generation_calls},
        {"failure", result.failure_code.empty()
             ? Json(nullptr)
             : Json{{"code", result.failure_code}}},
        {"progressMs", k2 ? Json(progress) : Json(nullptr)},
        {"timings", Json{
             {"loadMs", repeat == 0 ? Json(load_ms) : Json(nullptr)},
             {"sampleWallMs", sample_wall_ms},
             {"featureMs", result.feature_ms},
             {"modelGenerateMs", result.generate_ms},
             {"inferenceMs", result.inference_ms},
             {"inferenceRtf", result.inference_ms / result.duration_ms}}}};
    if (repeat == 0) {
      const double process_wall_ms = elapsed_ms(process_started);
      sample["timings"]["processWallMs"] = process_wall_ms;
      sample["timings"]["processWallRtf"] = process_wall_ms / result.duration_ms;
    }
    failed = failed || !result.failure_code.empty();
    samples.push_back(std::move(sample));
    if (failed) {
      break;
    }
  }

  const fs::path executable = current_executable();
  Json modules = cuda_development_loaded_modules(path_policy);
  check(std::none_of(modules.begin(), modules.end(), [](const Json& module) {
          return lowercase(module.at("name").get<std::string>()).rfind("cudnn", 0) == 0;
        }),
        "T08 no-cuDNN identity loaded an unexpected cuDNN module");
  const auto driver_module = std::find_if(modules.begin(), modules.end(), [](const Json& module) {
    return lowercase(module.at("name").get<std::string>()) == "nvcuda.dll";
  });
  check(driver_module != modules.end(), "T08 CUDA driver module attestation is missing");

  const Json raw{
      {"schemaVersion", 1},
      {"kind", k2 ? "hikaru-ct2-kotoba-k2-raw" : "hikaru-ct2-kotoba-k1-raw"},
      {"status", failed ? "failed" : "completed"},
      {"caseId", case_id},
      {"engine", "kotoba-faster-whisper"},
      {"model", Json{
           {"id", "kotoba-tech/kotoba-whisper-v2.0-faster"},
           {"revision", "f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc"},
           {"files", model_files},
           {"legacyCache", Json{
                {"layout", "huggingface-immutable-snapshot"},
                {"revisionDirectoryVerified", true},
                {"usedInPlace", true}}}}},
      {"audio", Json{
           {"sha256", expected_case->second.second},
           {"durationMs", expected_case->second.first},
           {"sourceFrames", source_frames}}},
      {"candidate", k2
           ? "kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1"
           : "kotoba-k1"},
      {"config", kotoba_config_json(config)},
      {"inputLockSha256", sha256_file(input_lock)},
      {"runtime", Json{
           {"measurementExecutable", file_identity(executable)},
           {"productionWorker", file_identity(production_worker)},
           {"requiredDlls", runtime_file_identities(executable, true)},
           {"requestedDevice", "cuda"},
           {"resolvedDevice", "cuda"},
           {"computeType", "float16"},
           {"deviceIndex", 0},
           {"ctranslate2Version", "4.8.0"},
           {"cudaBuildEnabled", true},
           {"cudaDynamicLoading", true},
           {"withCudnn", false},
           {"gpu", Json{
                {"deviceIndex", 0},
                {"name", attestation.device_name},
                {"driverModuleVersion", driver_module->at("version")},
                {"cudaDriverApiVersion", attestation.cuda_driver_api_version},
                {"computeCapability", std::to_string(attestation.compute_capability_major)
                     + "." + std::to_string(attestation.compute_capability_minor)},
                {"visibleDeviceCount", attestation.visible_device_count},
                {"float16Supported", attestation.compute_type_supported}}},
           {"cpu", cpu_identity()},
           {"pathPolicy", path_policy},
           {"loadedModules", std::move(modules)}}},
      {"samples", std::move(samples)},
      {"resources", Json{
           {"peakProcessRssBytes", peak_working_set()},
           {"method", "GetProcessMemoryInfo.PeakWorkingSetSize"}}}};

  fs::create_directories(output_path.parent_path());
  const fs::path temporary = output_path.string() + ".tmp";
  std::ofstream(temporary, std::ios::binary) << std::setw(2) << raw << '\n';
  fs::remove(output_path);
  fs::rename(temporary, output_path);
  std::cout << Json{
      {"status", failed ? "failed" : "completed"},
      {"caseId", case_id},
      {"sampleCount", raw["samples"].size()}}.dump() << '\n';
}

void run_candidate_b_identity_check() {
  static_cast<void>(restricted_path_policy());
  run_core_tests();
  Json modules = loaded_runtime_modules();
  validate_candidate_b_loaded_modules(modules);
  std::cout << Json{
      {"cpu", cpu_identity()},
      {"pathPolicy", restricted_path_policy()},
      {"moduleLayout", candidate_b_module_layout()},
      {"loadedModules", std::move(modules)}}.dump() << '\n';
}

}  // namespace

int main(int argc, char** argv) {
  try {
    const std::vector<std::string> args(argv + 1, argv + argc);
    if (std::find(args.begin(), args.end(), "--candidate-b-identity-check") != args.end()) {
      run_candidate_b_identity_check();
#ifdef HIKARU_ASR_WHISPER_PARITY_BISECT
    } else if (std::find(args.begin(), args.end(), "--execution-parity-self-check") != args.end()) {
      run_execution_parity_self_check(args);
    } else if (std::find(args.begin(), args.end(), "--execution-parity-contract") != args.end()) {
      run_execution_parity_contract(args);
    } else if (std::find(args.begin(), args.end(), "--execution-parity-native-mel") != args.end()) {
      export_execution_parity_native_mel(args);
    } else if (std::find(args.begin(), args.end(), "--run-whisper-execution-parity") != args.end()) {
      run_execution_parity_evidence(args);
#endif
    } else if (std::find(args.begin(), args.end(), "--fallback-self-check") != args.end()) {
      run_fallback_self_check();
      std::cout << "ctranslate2 whisper fallback tests passed\n";
    } else if (std::find(args.begin(), args.end(), "--run-whisper-fallback-oracle") != args.end()) {
      run_fallback_oracle(args);
    } else if (args.empty() || std::find(args.begin(), args.end(), "--self-check") != args.end()) {
      run_core_tests();
      std::cout << "ctranslate2 whisper tests passed\n";
    } else if (std::find(args.begin(), args.end(), "--run-evidence") != args.end()) {
      run_evidence(args, false);
    } else if (std::find(args.begin(), args.end(), "--run-selected-evidence") != args.end()) {
      run_evidence(args, true);
    } else if (std::find(args.begin(), args.end(), "--run-candidate-b-evidence") != args.end()) {
      run_evidence(args, true, true);
    } else if (std::find(args.begin(), args.end(), "--run-cuda-development-evidence") != args.end()) {
      run_cuda_development_evidence(args);
    } else if (std::find(args.begin(), args.end(), "--run-whisper-quality-fallback-diagnostic") != args.end()) {
      run_whisper_quality_evidence(args, false, false, true);
    } else if (std::find(args.begin(), args.end(), "--run-whisper-quality-vad-diagnostic") != args.end()) {
      run_whisper_quality_evidence(args, false, true);
    } else if (std::find(args.begin(), args.end(), "--run-whisper-quality-diagnostic") != args.end()) {
      run_whisper_quality_evidence(args, true);
    } else if (std::find(args.begin(), args.end(), "--run-whisper-quality-evidence") != args.end()) {
      run_whisper_quality_evidence(args, false);
    } else if (std::find(args.begin(), args.end(), "--run-kotoba-k2-evidence") != args.end()) {
      run_kotoba_evidence(args, true);
    } else if (std::find(args.begin(), args.end(), "--run-kotoba-evidence") != args.end()) {
      run_kotoba_evidence(args, false);
    } else if (std::find(args.begin(), args.end(), "--run-cpu-rtf-diagnostic") != args.end()) {
      run_diagnostic_matrix(args);
    } else if (std::find(args.begin(), args.end(), "--run-short-decode-selection") != args.end()) {
      run_short_decode_selection(args);
    } else {
      throw std::runtime_error("invalid test arguments");
    }
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "ctranslate2 whisper tests failed: " << error.what() << '\n';
    return 1;
  }
}
