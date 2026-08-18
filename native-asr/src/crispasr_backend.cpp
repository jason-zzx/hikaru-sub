#include "crispasr_backend.hpp"
#include "wav_audio.hpp"

#ifndef _WIN32
#error The CrispASR backend currently supports Windows x64 only.
#endif

#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#include <psapi.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <fstream>
#include <iterator>
#include <limits>
#include <sstream>
#include <utility>

#include <hikaru_asr/crispasr_runtime_identity.hpp>

namespace hikaru_asr::crisp {
namespace {

namespace fs = std::filesystem;

struct crispasr_session;
struct crispasr_session_result;
struct crispasr_align_result;

struct CrispAsrOpenParamsV1 {
  int abi_version;
  int n_threads;
  int use_gpu;
  int verbosity;
  int flash_attn;
  int n_gpu_layers;
  int reserved[6];
};

static_assert(sizeof(CrispAsrOpenParamsV1) == 48);
static_assert(alignof(CrispAsrOpenParamsV1) == alignof(int));
static_assert(offsetof(CrispAsrOpenParamsV1, abi_version) == 0);
static_assert(offsetof(CrispAsrOpenParamsV1, n_threads) == 4);
static_assert(offsetof(CrispAsrOpenParamsV1, use_gpu) == 8);
static_assert(offsetof(CrispAsrOpenParamsV1, verbosity) == 12);
static_assert(offsetof(CrispAsrOpenParamsV1, flash_attn) == 16);
static_assert(offsetof(CrispAsrOpenParamsV1, n_gpu_layers) == 20);
static_assert(offsetof(CrispAsrOpenParamsV1, reserved) == 24);

using ProgressFn = void (*)(int, int, void*);
using SegmentFn = void (*)(const char*, std::int64_t, std::int64_t, int, void*);

struct Api {
  int (*available_backends)(char*, int) = nullptr;
  crispasr_session* (*open_with_params)(const char*, const char*, const CrispAsrOpenParamsV1*) = nullptr;
  const char* (*session_backend)(crispasr_session*) = nullptr;
  void (*set_progress_callback)(crispasr_session*, ProgressFn, void*) = nullptr;
  void (*set_segment_callback)(crispasr_session*, SegmentFn, void*) = nullptr;
  crispasr_session_result* (*transcribe_lang)(crispasr_session*, const float*, int, const char*) = nullptr;
  int (*vad_slices)(
      const char*, const float*, int, int, float, int, int, int, float, int, float**) = nullptr;
  void (*vad_free)(float*) = nullptr;
  int (*result_n_segments)(crispasr_session_result*) = nullptr;
  const char* (*result_segment_text)(crispasr_session_result*, int) = nullptr;
  std::int64_t (*result_segment_t0)(crispasr_session_result*, int) = nullptr;
  std::int64_t (*result_segment_t1)(crispasr_session_result*, int) = nullptr;
  int (*result_n_words)(crispasr_session_result*, int) = nullptr;
  const char* (*result_word_text)(crispasr_session_result*, int, int) = nullptr;
  std::int64_t (*result_word_t0)(crispasr_session_result*, int, int) = nullptr;
  std::int64_t (*result_word_t1)(crispasr_session_result*, int, int) = nullptr;
  void (*result_free)(crispasr_session_result*) = nullptr;
  crispasr_align_result* (*align_words)(const char*, const char*, const float*, int32_t, std::int64_t, int32_t) = nullptr;
  int (*align_n_words)(crispasr_align_result*) = nullptr;
  const char* (*align_word_text)(crispasr_align_result*, int) = nullptr;
  std::int64_t (*align_word_t0)(crispasr_align_result*, int) = nullptr;
  std::int64_t (*align_word_t1)(crispasr_align_result*, int) = nullptr;
  void (*align_free)(crispasr_align_result*) = nullptr;
  void (*session_close)(crispasr_session*) = nullptr;
  void (*set_gpu_backend)(const char*) = nullptr;
};

std::string digest_hex(const unsigned char* digest, std::size_t size) {
  std::ostringstream output;
  output << std::hex;
  for (std::size_t index = 0; index < size; ++index) {
    output.width(2);
    output.fill('0');
    output << static_cast<int>(digest[index]);
  }
  return output.str();
}

std::string sha256_bytes(std::string_view value) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  ULONG object_length = 0;
  ULONG returned = 0;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0
      || BCryptGetProperty(
             algorithm,
             BCRYPT_OBJECT_LENGTH,
             reinterpret_cast<PUCHAR>(&object_length),
             sizeof(object_length),
             &returned,
             0) != 0) {
    if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
    throw BackendError("hash_failed", "SHA-256 provider is unavailable");
  }
  std::vector<unsigned char> object(object_length);
  std::array<unsigned char, 32> digest{};
  const bool created = BCryptCreateHash(
      algorithm, &hash, object.data(), object_length, nullptr, 0, 0) == 0;
  const bool hashed = created
      && BCryptHashData(
             hash,
             reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())),
             static_cast<ULONG>(value.size()),
             0) == 0;
  const bool finished = hashed
      && BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) == 0;
  if (hash) BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  if (!finished) throw BackendError("hash_failed", "SHA-256 failed");
  return digest_hex(digest.data(), digest.size());
}

std::string sha256_file(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    return {};
  }
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  ULONG object_length = 0;
  ULONG returned = 0;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0
      || BCryptGetProperty(
             algorithm,
             BCRYPT_OBJECT_LENGTH,
             reinterpret_cast<PUCHAR>(&object_length),
             sizeof(object_length),
             &returned,
             0) != 0) {
    if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
    return {};
  }
  std::vector<unsigned char> object(object_length);
  if (BCryptCreateHash(
          algorithm,
          &hash,
          object.data(),
          object_length,
          nullptr,
          0,
          0) != 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    return {};
  }
  std::vector<unsigned char> buffer(1 << 20);
  bool ok = true;
  while (input) {
    input.read(reinterpret_cast<char*>(buffer.data()), static_cast<std::streamsize>(buffer.size()));
    const std::streamsize count = input.gcount();
    if (count > 0
        && BCryptHashData(hash, buffer.data(), static_cast<ULONG>(count), 0) != 0) {
      ok = false;
      break;
    }
  }
  std::array<unsigned char, 32> digest{};
  if (!ok || BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) != 0) {
    ok = false;
  }
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  return ok ? digest_hex(digest.data(), digest.size()) : std::string{};
}

std::int64_t centiseconds_to_ms(std::int64_t value) {
  if (value < 0 || value > std::numeric_limits<std::int64_t>::max() / 10) {
    throw BackendError("crispasr_result_invalid", "CrispASR timing is invalid");
  }
  return value * 10;
}

std::int64_t qwen_provenance_time(std::int64_t value) noexcept {
  if (value < 0 || value > std::numeric_limits<std::int64_t>::max() / 10) return -1;
  return value * 10;
}

std::string copy_text(const char* value, const char* code) {
  if (value == nullptr) {
    throw BackendError(code, "CrispASR returned invalid text");
  }
  return value;
}

bool module_loaded(const wchar_t* file_name) {
  std::vector<HMODULE> modules(256);
  DWORD bytes = 0;
  while (EnumProcessModules(
             GetCurrentProcess(),
             modules.data(),
             static_cast<DWORD>(modules.size() * sizeof(HMODULE)),
             &bytes)
         && bytes > modules.size() * sizeof(HMODULE)) {
    modules.resize(bytes / sizeof(HMODULE));
  }
  if (bytes == 0 || bytes > modules.size() * sizeof(HMODULE)) return false;
  std::vector<wchar_t> path(32768);
  for (std::size_t index = 0; index < bytes / sizeof(HMODULE); ++index) {
    const DWORD length = GetModuleFileNameExW(
        GetCurrentProcess(), modules[index], path.data(), static_cast<DWORD>(path.size()));
    if (length == 0 || length >= path.size()) continue;
    if (_wcsicmp(fs::path(std::wstring(path.data(), length)).filename().c_str(), file_name) == 0) {
      return true;
    }
  }
  return false;
}

void require_cuda_runtime_modules() {
  for (const wchar_t* name : {L"nvcuda.dll", L"ggml-cuda.dll", L"cublas64_12.dll", L"cudart64_12.dll"}) {
    if (!module_loaded(name)) {
      throw BackendError("crispasr_device_unavailable", "CrispASR CUDA runtime invariant failed");
    }
  }
}

bool regular_nonempty(const fs::path& path) {
  std::error_code error;
  return fs::is_regular_file(path, error) && !error && fs::file_size(path, error) > 0 && !error;
}

template <typename Function>
Function load_export(HMODULE module, const char* name) {
  const auto value = reinterpret_cast<Function>(GetProcAddress(module, name));
  if (value == nullptr) {
    throw BackendError("crispasr_abi_mismatch", "Required CrispASR export is unavailable");
  }
  return value;
}

Api bind_api(HMODULE module) {
  Api api;
#define BIND(member, name) api.member = load_export<decltype(api.member)>(module, name)
  BIND(available_backends, "crispasr_session_available_backends");
  BIND(open_with_params, "crispasr_session_open_with_params");
  BIND(session_backend, "crispasr_session_backend");
  BIND(set_progress_callback, "crispasr_session_set_progress_callback");
  BIND(set_segment_callback, "crispasr_session_set_segment_callback");
  BIND(transcribe_lang, "crispasr_session_transcribe_lang");
  BIND(vad_slices, "crispasr_vad_slices");
  BIND(vad_free, "crispasr_vad_free");
  BIND(result_n_segments, "crispasr_session_result_n_segments");
  BIND(result_segment_text, "crispasr_session_result_segment_text");
  BIND(result_segment_t0, "crispasr_session_result_segment_t0");
  BIND(result_segment_t1, "crispasr_session_result_segment_t1");
  BIND(result_n_words, "crispasr_session_result_n_words");
  BIND(result_word_text, "crispasr_session_result_word_text");
  BIND(result_word_t0, "crispasr_session_result_word_t0");
  BIND(result_word_t1, "crispasr_session_result_word_t1");
  BIND(result_free, "crispasr_session_result_free");
  BIND(align_words, "crispasr_align_words_abi");
  BIND(align_n_words, "crispasr_align_result_n_words");
  BIND(align_word_text, "crispasr_align_result_word_text");
  BIND(align_word_t0, "crispasr_align_result_word_t0");
  BIND(align_word_t1, "crispasr_align_result_word_t1");
  BIND(align_free, "crispasr_align_result_free");
  BIND(session_close, "crispasr_session_close");
  BIND(set_gpu_backend, "crispasr_set_gpu_backend");
#undef BIND
  return api;
}

struct CallbackContext {
  ProgressCallback on_progress;
  SegmentCallback on_segment;
  std::int64_t duration_ms = 0;
  std::int64_t last_progress_ms = 0;
  bool qwen = false;
  bool observe_segments = false;
  std::vector<Segment> previews;
  std::exception_ptr error;
};

void progress_callback(int processed, int, void* user_data) noexcept {
  auto& context = *static_cast<CallbackContext*>(user_data);
  try {
    if (processed < 0) {
      throw BackendError("crispasr_result_invalid", "CrispASR progress is invalid");
    }
    const std::int64_t value = std::clamp(
        static_cast<std::int64_t>(processed) * 1000 / wav::sample_rate,
        context.last_progress_ms,
        context.duration_ms);
    context.last_progress_ms = value;
    if (context.on_progress) context.on_progress(value);
  } catch (...) {
    context.error = std::current_exception();
  }
}

void segment_callback(
    const char* text,
    std::int64_t t0_cs,
    std::int64_t t1_cs,
    int,
    void* user_data) noexcept {
  auto& context = *static_cast<CallbackContext*>(user_data);
  try {
    if (context.qwen || !context.observe_segments) return;
    Segment segment;
    segment.text = copy_text(text, "crispasr_result_invalid");
    segment.start_ms = centiseconds_to_ms(t0_cs);
    segment.end_ms = centiseconds_to_ms(t1_cs);
    if (segment.text.empty() || segment.start_ms < 0 || segment.end_ms <= segment.start_ms
        || segment.end_ms > context.duration_ms
        || (!context.previews.empty() && segment.start_ms < context.previews.back().start_ms)) {
      throw BackendError("crispasr_result_invalid", "CrispASR preview segment is invalid");
    }
    context.previews.push_back(segment);
    if (context.on_segment) context.on_segment(segment);
  } catch (...) {
    context.error = std::current_exception();
  }
}

std::vector<NativeSegment> copy_source_segments(
    const Api& api,
    crispasr_session_result* result,
    std::int64_t duration_ms,
    bool qwen) {
  const int count = api.result_n_segments(result);
  if (count < 0 || static_cast<std::size_t>(count) > limits::max_replacement_segments) {
    throw BackendError("crispasr_result_invalid", "CrispASR segment count is invalid");
  }
  std::vector<NativeSegment> output;
  output.reserve(static_cast<std::size_t>(count));
  std::int64_t previous = -1;
  for (int index = 0; index < count; ++index) {
    NativeSegment segment;
    segment.text = copy_text(api.result_segment_text(result, index), "crispasr_result_invalid");
    const std::int64_t raw_start = api.result_segment_t0(result, index);
    const std::int64_t raw_end = api.result_segment_t1(result, index);
    if (qwen) {
      segment.raw_start_ms = qwen_provenance_time(raw_start);
      segment.raw_end_ms = qwen_provenance_time(raw_end);
      if (segment.text.empty()) {
        throw BackendError("crispasr_result_invalid", "Qwen source text is invalid");
      }
    } else {
      segment.raw_start_ms = centiseconds_to_ms(raw_start);
      segment.raw_end_ms = centiseconds_to_ms(raw_end);
      if (segment.text.empty() || segment.raw_start_ms < 0
          || segment.raw_end_ms <= segment.raw_start_ms
          || segment.raw_end_ms > duration_ms || segment.raw_start_ms < previous) {
        std::optional<ResultFailureDetail> detail;
        if (!segment.text.empty() && segment.raw_start_ms >= 0
            && segment.raw_end_ms == segment.raw_start_ms) {
          const std::string trace = "segmentIndex=" + std::to_string(index)
              + "\nlocalStartMs=" + std::to_string(segment.raw_start_ms)
              + "\nlocalEndMs=" + std::to_string(segment.raw_end_ms)
              + "\nwindowDurationMs=" + std::to_string(duration_ms);
          detail = ResultFailureDetail{
              "zero_duration_top_level_result",
              index,
              segment.raw_start_ms,
              segment.raw_end_ms,
              sha256_bytes(trace)};
        }
        throw BackendError(
            "crispasr_result_invalid",
            "CrispASR final result is invalid: segment=" + std::to_string(index)
                + " startMs=" + std::to_string(segment.raw_start_ms)
                + " endMs=" + std::to_string(segment.raw_end_ms)
                + " durationMs=" + std::to_string(duration_ms),
            std::move(detail));
      }
      previous = segment.raw_start_ms;
    }
    const int word_count = api.result_n_words(result, index);
    if (word_count < 0 || word_count > 1'000'000) {
      throw BackendError("crispasr_result_invalid", "CrispASR word count is invalid");
    }
    segment.words.reserve(static_cast<std::size_t>(word_count));
    for (int word_index = 0; word_index < word_count; ++word_index) {
      NativeWord word;
      word.text = copy_text(api.result_word_text(result, index, word_index), "crispasr_result_invalid");
      const std::int64_t raw_word_start = api.result_word_t0(result, index, word_index);
      const std::int64_t raw_word_end = api.result_word_t1(result, index, word_index);
      if (qwen) {
        word.start_ms = qwen_provenance_time(raw_word_start);
        word.end_ms = qwen_provenance_time(raw_word_end);
      } else {
        word.start_ms = centiseconds_to_ms(raw_word_start);
        word.end_ms = centiseconds_to_ms(raw_word_end);
        if (word.start_ms < 0 || word.end_ms < word.start_ms || word.end_ms > duration_ms) {
          throw BackendError("crispasr_result_invalid", "CrispASR native word is invalid");
        }
      }
      segment.words.push_back(std::move(word));
    }
    output.push_back(std::move(segment));
  }
  return output;
}

std::vector<AlignmentEntry> copy_alignment(
    const Api& api,
    crispasr_align_result* result,
    std::int64_t duration_ms) {
  const int count = api.align_n_words(result);
  if (count <= 0 || count > 1'000'000) {
    throw BackendError("crispasr_alignment_invalid", "CrispASR alignment count is invalid");
  }
  std::vector<AlignmentEntry> output;
  output.reserve(static_cast<std::size_t>(count));
  for (int index = 0; index < count; ++index) {
    AlignmentEntry entry;
    entry.text = copy_text(api.align_word_text(result, index), "crispasr_alignment_invalid");
    entry.start_ms = centiseconds_to_ms(api.align_word_t0(result, index));
    entry.end_ms = centiseconds_to_ms(api.align_word_t1(result, index));
    if (entry.text.empty() || entry.start_ms < 0 || entry.end_ms < entry.start_ms) {
      throw BackendError(
          "crispasr_alignment_invalid",
          "CrispASR alignment entry is invalid: " + std::to_string(entry.start_ms)
              + "/" + std::to_string(entry.end_ms) + "/" + std::to_string(duration_ms));
    }
    output.push_back(std::move(entry));
  }
  return output;
}

std::string join_source_text(const std::vector<NativeSegment>& segments) {
  std::string output;
  for (const auto& segment : segments) output += segment.text;
  return output;
}

std::int64_t checked_offset(std::int64_t value, std::int64_t offset) {
  if (value < 0 || offset < 0 || value > std::numeric_limits<std::int64_t>::max() - offset) {
    throw BackendError("crispasr_result_invalid", "CrispASR window timing is invalid");
  }
  return value + offset;
}

std::int64_t round_half_even(double value) {
  if (!std::isfinite(value) || value < 0
      || value > static_cast<double>(std::numeric_limits<std::int64_t>::max())) {
    throw BackendError("crispasr_vad_result_invalid", "CrispASR VAD timing is invalid");
  }
  const double lower = std::floor(value);
  const double fraction = value - lower;
  std::int64_t rounded = static_cast<std::int64_t>(lower);
  if (fraction > 0.5 || (fraction == 0.5 && rounded % 2 != 0)) ++rounded;
  return rounded;
}

void configure_reazon_single_pass_environment() {
  constexpr wchar_t prefix[] = L"CRISPASR_PARAKEET_";
  LPWCH environment = GetEnvironmentStringsW();
  if (environment == nullptr) {
    throw BackendError("crispasr_strategy_invalid", "CrispASR strategy environment is unavailable");
  }
  std::vector<std::wstring> inherited;
  for (const wchar_t* cursor = environment; *cursor != L'\0';) {
    const std::wstring entry(cursor);
    cursor += entry.size() + 1;
    const std::size_t separator = entry.find(L'=');
    if (separator != std::wstring::npos
        && entry.size() >= std::size(prefix) - 1
        && _wcsnicmp(entry.c_str(), prefix, std::size(prefix) - 1) == 0) {
      inherited.push_back(entry.substr(0, separator));
    }
  }
  FreeEnvironmentStringsW(environment);
  for (const auto& name : inherited) {
    if (!SetEnvironmentVariableW(name.c_str(), nullptr)) {
      throw BackendError("crispasr_strategy_invalid", "CrispASR strategy environment could not be cleared");
    }
  }
  if (!SetEnvironmentVariableW(L"CRISPASR_PARAKEET_STREAM_THRESHOLD", L"13")
      || !SetEnvironmentVariableW(L"CRISPASR_SESSION_UNIFIED_DISPATCH", L"0")) {
    throw BackendError("crispasr_strategy_invalid", "CrispASR strategy environment could not be frozen");
  }
}

void translate_window_result(
    Result& result,
    AudioWindow window,
    std::int64_t audio_duration_ms) {
  std::int64_t previous_segment_start = -1;
  for (auto& segment : result.source_segments) {
    segment.raw_start_ms = checked_offset(segment.raw_start_ms, window.start_ms);
    segment.raw_end_ms = checked_offset(segment.raw_end_ms, window.start_ms);
    if (segment.raw_start_ms < window.start_ms || segment.raw_end_ms <= segment.raw_start_ms
        || segment.raw_end_ms > window.end_ms || segment.raw_end_ms > audio_duration_ms
        || segment.raw_start_ms < previous_segment_start) {
      throw BackendError("crispasr_result_invalid", "CrispASR window segment is invalid");
    }
    previous_segment_start = segment.raw_start_ms;
    std::int64_t previous_word_start = -1;
    for (auto& word : segment.words) {
      word.start_ms = checked_offset(word.start_ms, window.start_ms);
      word.end_ms = checked_offset(word.end_ms, window.start_ms);
      if (word.start_ms < window.start_ms || word.end_ms < word.start_ms
          || word.end_ms > window.end_ms || word.end_ms > audio_duration_ms
          || word.start_ms < previous_word_start) {
        throw BackendError("crispasr_result_invalid", "CrispASR window word is invalid");
      }
      previous_word_start = word.start_ms;
    }
  }
}

}  // namespace

std::string sha256_text(std::string_view text) {
  return sha256_bytes(text);
}

BackendError::BackendError(
    std::string code,
    std::string message,
    std::optional<ResultFailureDetail> result_failure)
    : std::runtime_error(std::move(message)),
      code_(std::move(code)),
      result_failure_(std::move(result_failure)) {}

const std::string& BackendError::code() const noexcept {
  return code_;
}

const std::optional<ResultFailureDetail>& BackendError::result_failure() const noexcept {
  return result_failure_;
}

bool runtime_identity_matches(
    const fs::path& path,
    std::uintmax_t expected_size,
    const std::string& expected_sha256) {
  std::error_code error;
  return fs::is_regular_file(path, error) && !error
      && fs::file_size(path, error) == expected_size && !error
      && sha256_file(path) == expected_sha256;
}

bool reazon_vad_identity_matches(const fs::path& path) {
  return runtime_identity_matches(
      path,
      885'098,
      "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987");
}

bool reazon_vad_identity_permitted(const fs::path& path) {
#ifdef HIKARU_ASR_CRISPASR_TEST_VAD_IDENTITY_BYPASS
  return regular_nonempty(path);
#else
  return reazon_vad_identity_matches(path);
#endif
}

fs::path upstream_compatible_path(const fs::path& path) {
  std::string value = path.u8string();
  if (value.rfind(R"(\\?\UNC\)", 0) == 0) {
    value = R"(\\)" + value.substr(8);
  } else if (value.rfind(R"(\\?\)", 0) == 0) {
    value.erase(0, 4);
  }
  return fs::u8path(value);
}

const char* upstream_backend(Engine engine) {
  switch (engine) {
    case Engine::Parakeet:
    case Engine::ReazonSpeechNemo:
      return "parakeet";
    case Engine::Qwen3Asr:
      return "qwen3";
    default:
      throw BackendError("crispasr_backend_unavailable", "Engine is not a CrispASR route");
  }
}

class CrispAsrBackend::Impl {
 public:
  explicit Impl(BackendConfig value) : config(std::move(value)) {
    if (!regular_nonempty(config.audio_path)) {
      throw BackendError("audio_open_failed", "WAV file could not be opened");
    }
    if (!regular_nonempty(config.model_path)) {
      throw BackendError("crispasr_model_load_failed", "CrispASR model file is unavailable");
    }
    if (config.engine == Engine::Qwen3Asr) {
      if (!config.aligner_path || !regular_nonempty(*config.aligner_path)) {
        throw BackendError("missing_model_role", "Qwen3-ASR requires a regular non-empty aligner file");
      }
    } else if (config.aligner_path) {
      throw BackendError("unexpected_model_role", "This CrispASR route does not accept an aligner");
    }
    if (config.device == Device::Vulkan) {
      throw BackendError("device_not_implemented", "T09 does not implement CrispASR Vulkan");
    }
    try {
      audio = wav::read_pcm16_mono_16khz(config.audio_path);
    } catch (const wav::AudioError& error) {
      throw BackendError(error.code(), error.what());
    }
#ifndef HIKARU_ASR_CRISPASR_TEST_RUNTIME_IDENTITY_BYPASS
    if (!runtime_identity_matches(
            config.library_path,
            runtime_identity::size_bytes,
            runtime_identity::sha256)) {
      throw BackendError("crispasr_abi_mismatch", "CrispASR runtime identity is not permitted");
    }
#endif
    module = LoadLibraryExW(
        fs::absolute(config.library_path).c_str(),
        nullptr,
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    if (module == nullptr) {
      throw BackendError("crispasr_library_load_failed", "CrispASR runtime could not be loaded");
    }
    try {
      api = bind_api(module);
      std::array<char, 1024> backends{};
      const int backend_length = api.available_backends(backends.data(), static_cast<int>(backends.size()));
      const std::string expected = upstream_backend(config.engine);
      const std::string advertised = backend_length > 0 ? std::string(backends.data()) : std::string{};
      if (advertised.find(expected) == std::string::npos) {
        throw BackendError("crispasr_backend_unavailable", "Required CrispASR logical backend is unavailable");
      }
      if (config.device == Device::Cuda) api.set_gpu_backend("cuda");
      const CrispAsrOpenParamsV1 params{
          2,
          16,
          config.device == Device::Cuda ? 1 : 0,
          0,
          0,
          config.device == Device::Cuda ? -1 : 0,
          {0, 0, 0, 0, 0, 0}};
      const std::string model = upstream_compatible_path(config.model_path).u8string();
      session = api.open_with_params(model.c_str(), expected.c_str(), &params);
      if (session == nullptr) {
        throw BackendError("crispasr_model_load_failed", "CrispASR session could not load the model");
      }
      const char* opened = api.session_backend(session);
      if (opened == nullptr || expected != opened) {
        throw BackendError("crispasr_backend_mismatch", "CrispASR opened a different logical backend");
      }
#ifndef HIKARU_ASR_CRISPASR_TEST_RUNTIME_IDENTITY_BYPASS
      if (config.device == Device::Cuda) require_cuda_runtime_modules();
#else
      if (config.device == Device::Cuda && !module_loaded(L"hikaru-asr-fake-crispasr-cuda-marker.dll")) {
        throw BackendError("crispasr_device_unavailable", "Fake CrispASR CUDA invariant failed");
      }
#endif
    } catch (...) {
      cleanup();
      throw;
    }
  }

  ~Impl() {
    cleanup();
  }

  void cleanup() noexcept {
    if (session) {
      api.session_close(session);
      session = nullptr;
    }
    if (module) {
      FreeLibrary(module);
      module = nullptr;
    }
  }

  std::vector<AudioWindow> detect_reazon_vad_windows(const fs::path& vad_model_path) {
    if (config.engine != Engine::ReazonSpeechNemo) {
      throw BackendError("crispasr_vad_not_supported", "CrispASR VAD is only valid for ReazonSpeech R2");
    }
    if (!reazon_vad_identity_permitted(vad_model_path)) {
      throw BackendError("crispasr_vad_model_invalid", "The frozen ReazonSpeech VAD asset is unavailable");
    }
    const std::string model = upstream_compatible_path(vad_model_path).u8string();
    float* raw_spans = nullptr;
    const int count = api.vad_slices(
        model.c_str(),
        audio.samples.data(),
        static_cast<int>(audio.samples.size()),
        wav::sample_rate,
        0.5f,
        250,
        100,
        30,
        static_cast<float>(reazon_vad_core_max_duration_ms) / 1000.0f,
        16,
        &raw_spans);
    struct VadFree {
      const Api& api;
      float* value;
      ~VadFree() { if (value) api.vad_free(value); }
    } free_spans{api, raw_spans};
    if (count < 0) {
      throw BackendError("crispasr_vad_failed", "CrispASR VAD failed");
    }
    if (count == 0) {
      throw BackendError(
          "crispasr_vad_no_result",
          "CrispASR VAD returned no distinguishable result");
    }
    if (raw_spans == nullptr
        || static_cast<std::size_t>(count) > limits::max_replacement_segments) {
      throw BackendError("crispasr_vad_result_invalid", "CrispASR VAD result is invalid");
    }

    std::vector<AudioWindow> windows;
    windows.reserve(static_cast<std::size_t>(count));
    std::int64_t previous_start_ms = -1;
    std::int64_t previous_end_ms = -1;
    std::int64_t two_back_end_ms = -1;
    constexpr std::int64_t samples_per_ms = wav::sample_rate / 1000;
    static_assert(wav::sample_rate % 1000 == 0);
    for (int index = 0; index < count; ++index) {
      const double start_seconds = raw_spans[index * 2];
      const double end_seconds = raw_spans[index * 2 + 1];
      if (!std::isfinite(start_seconds) || !std::isfinite(end_seconds)
          || start_seconds < 0 || end_seconds <= start_seconds) {
        throw BackendError("crispasr_vad_result_invalid", "CrispASR VAD timing is invalid");
      }
      const AudioWindow window{
          round_half_even(start_seconds * 1000.0),
          round_half_even(end_seconds * 1000.0)};
      if (window.start_ms > std::numeric_limits<std::int64_t>::max() / samples_per_ms
          || window.end_ms > std::numeric_limits<std::int64_t>::max() / samples_per_ms) {
        throw BackendError("crispasr_vad_result_invalid", "CrispASR VAD timing is invalid");
      }
      const std::int64_t start_sample = window.start_ms * samples_per_ms;
      const std::int64_t end_sample = window.end_ms * samples_per_ms;
      const std::int64_t duration_ms = window.end_ms - window.start_ms;
      if (start_sample < 0 || end_sample <= start_sample
          || end_sample > static_cast<std::int64_t>(audio.samples.size())
          || window.start_ms < 0 || window.end_ms <= window.start_ms
          || window.end_ms > audio.duration_ms
          || end_sample - start_sample > reazon_vad_max_samples
          || duration_ms > reazon_vad_padded_max_duration_ms
          || (index > 0
              && (window.start_ms <= previous_start_ms
                  || window.end_ms <= previous_end_ms
                  || previous_end_ms - window.start_ms > reazon_vad_max_adjacent_overlap_ms))
          || (index > 1 && window.start_ms < two_back_end_ms)) {
        throw BackendError("crispasr_vad_result_invalid", "CrispASR VAD window is invalid");
      }
      windows.push_back(window);
      two_back_end_ms = previous_end_ms;
      previous_start_ms = window.start_ms;
      previous_end_ms = window.end_ms;
    }
    return windows;
  }

  Result transcribe_window(
      AudioWindow window,
      const ProgressCallback& on_progress,
      const SegmentCallback& on_segment) {
    if (window.start_ms < 0 || window.end_ms <= window.start_ms
        || window.end_ms > audio.duration_ms || config.engine == Engine::Qwen3Asr) {
      throw BackendError("crispasr_window_invalid", "CrispASR audio window is invalid");
    }
    constexpr std::int64_t samples_per_ms = wav::sample_rate / 1000;
    static_assert(wav::sample_rate % 1000 == 0);
    const auto sample_for_ms = [](std::int64_t value) {
      if (value > std::numeric_limits<std::int64_t>::max() / samples_per_ms) {
        throw BackendError("crispasr_window_invalid", "CrispASR audio window overflows");
      }
      return value * samples_per_ms;
    };
    const std::int64_t start_sample = sample_for_ms(window.start_ms);
    const std::int64_t end_sample = config.engine != Engine::ReazonSpeechNemo
            && window.end_ms == audio.duration_ms
        ? static_cast<std::int64_t>(audio.samples.size())
        : sample_for_ms(window.end_ms);
    if (start_sample < 0 || end_sample <= start_sample
        || end_sample > static_cast<std::int64_t>(audio.samples.size())
        || end_sample - start_sample > std::numeric_limits<int>::max()
        || (config.engine == Engine::ReazonSpeechNemo
            && end_sample - start_sample > reazon_vad_max_samples)) {
      throw BackendError("crispasr_window_invalid", "CrispASR audio window is invalid");
    }
    if (config.engine == Engine::ReazonSpeechNemo) {
      configure_reazon_single_pass_environment();
    }
    const std::int64_t window_duration = window.end_ms - window.start_ms;
    CallbackContext context{
        on_progress
            ? ProgressCallback([&, on_progress](std::int64_t processed_ms) {
                on_progress(std::clamp(
                    checked_offset(processed_ms, window.start_ms),
                    window.start_ms,
                    window.end_ms));
              })
            : ProgressCallback{},
        on_segment
            ? SegmentCallback([&, on_segment](const Segment& source) {
                Segment translated{
                    checked_offset(source.start_ms, window.start_ms),
                    checked_offset(source.end_ms, window.start_ms),
                    source.text};
                if (translated.start_ms < window.start_ms || translated.end_ms > window.end_ms) {
                  throw BackendError("crispasr_result_invalid", "CrispASR window preview is invalid");
                }
                on_segment(translated);
              })
            : SegmentCallback{},
        window_duration,
        0,
        false,
        static_cast<bool>(on_segment),
        {},
        {}};
    api.set_progress_callback(session, progress_callback, &context);
    ++registered_callbacks;
    api.set_segment_callback(session, segment_callback, &context);
    ++registered_callbacks;

    struct ResultFree {
      const Api& api;
      crispasr_session_result* value = nullptr;
      ~ResultFree() { if (value) api.result_free(value); }
    } result_free{api};
    struct CallbackReset {
      Impl& owner;
      ~CallbackReset() {
        if (owner.registered_callbacks >= 2) owner.api.set_segment_callback(owner.session, nullptr, nullptr);
        if (owner.registered_callbacks >= 1) owner.api.set_progress_callback(owner.session, nullptr, nullptr);
        owner.registered_callbacks = 0;
      }
    } reset{*this};

    crispasr_session_result* raw_result = api.transcribe_lang(
        session,
        audio.samples.data() + start_sample,
        static_cast<int>(end_sample - start_sample),
        "ja");
    result_free.value = raw_result;
    if (context.error) std::rethrow_exception(context.error);
    if (raw_result == nullptr) {
      throw BackendError("crispasr_transcribe_failed", "CrispASR transcription failed");
    }

    Result result;
    result.source_segments = copy_source_segments(
        api,
        raw_result,
        window_duration,
        false);
    translate_window_result(result, window, audio.duration_ms);
    return result;
  }

  Result transcribe(const ProgressCallback& on_progress, const SegmentCallback& on_segment) {
    if (config.engine != Engine::Qwen3Asr) {
      return transcribe_window({0, audio.duration_ms}, on_progress, on_segment);
    }
    CallbackContext context{
        on_progress,
        on_segment,
        audio.duration_ms,
        0,
        true,
        false,
        {},
        {}};
    api.set_progress_callback(session, progress_callback, &context);
    ++registered_callbacks;
    api.set_segment_callback(session, segment_callback, &context);
    ++registered_callbacks;

    struct ResultFree {
      const Api& api;
      crispasr_session_result* value = nullptr;
      ~ResultFree() { if (value) api.result_free(value); }
    } result_free{api};
    struct AlignmentFree {
      const Api& api;
      crispasr_align_result* value = nullptr;
      ~AlignmentFree() { if (value) api.align_free(value); }
    } alignment_free{api};
    struct CallbackReset {
      Impl& owner;
      ~CallbackReset() {
        if (owner.registered_callbacks >= 2) owner.api.set_segment_callback(owner.session, nullptr, nullptr);
        if (owner.registered_callbacks >= 1) owner.api.set_progress_callback(owner.session, nullptr, nullptr);
        owner.registered_callbacks = 0;
      }
    } reset{*this};

    crispasr_session_result* raw_result = api.transcribe_lang(
        session,
        audio.samples.data(),
        static_cast<int>(audio.samples.size()),
        "ja");
    result_free.value = raw_result;
    if (context.error) std::rethrow_exception(context.error);
    if (raw_result == nullptr) {
      throw BackendError("crispasr_transcribe_failed", "CrispASR transcription failed");
    }

    Result result;
    result.source_segments = copy_source_segments(api, raw_result, audio.duration_ms, true);

    {
      const std::string transcript = join_source_text(result.source_segments);
      if (transcript.empty()) {
        throw BackendError("crispasr_alignment_failed", "Qwen3-ASR produced no text to align");
      }
      const std::string aligner = upstream_compatible_path(*config.aligner_path).u8string();
      crispasr_align_result* raw_alignment = api.align_words(
          aligner.c_str(),
          transcript.c_str(),
          audio.samples.data(),
          static_cast<int32_t>(audio.samples.size()),
          0,
          16);
      if (raw_alignment == nullptr) {
        throw BackendError("crispasr_alignment_failed", "CrispASR ForcedAligner failed");
      }
      alignment_free.value = raw_alignment;
      result.alignment = copy_alignment(api, raw_alignment, audio.duration_ms);
    }
    return result;
  }

  BackendConfig config;
  wav::Audio audio;
  HMODULE module = nullptr;
  Api api;
  crispasr_session* session = nullptr;
  int registered_callbacks = 0;
};

CrispAsrBackend::CrispAsrBackend(BackendConfig config)
    : impl_(std::make_unique<Impl>(std::move(config))) {}

CrispAsrBackend::~CrispAsrBackend() = default;

std::int64_t CrispAsrBackend::duration_ms() const {
  return impl_->audio.duration_ms;
}

Result CrispAsrBackend::transcribe(
    const ProgressCallback& on_progress,
    const SegmentCallback& on_segment) {
  return impl_->transcribe(on_progress, on_segment);
}

Result CrispAsrBackend::transcribe_window(
    AudioWindow window,
    const ProgressCallback& on_progress,
    const SegmentCallback& on_segment) {
  return impl_->transcribe_window(window, on_progress, on_segment);
}

std::vector<AudioWindow> CrispAsrBackend::detect_reazon_vad_windows(
    const fs::path& vad_model_path) {
  return impl_->detect_reazon_vad_windows(vad_model_path);
}

}  // namespace hikaru_asr::crisp
