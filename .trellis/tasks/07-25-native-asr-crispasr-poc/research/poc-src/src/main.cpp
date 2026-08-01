#include <windows.h>
#include <bcrypt.h>
#include <psapi.h>

#include <crispasr_session.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace fs = std::filesystem;
using Json = nlohmann::json;
using Clock = std::chrono::steady_clock;

// The pinned public header forward-declares this ABI struct; v0.8.22 defines
// this exact v2 layout in src/crispasr_c_api.cpp.
struct crispasr_open_params_v1 {
  int abi_version;
  int n_threads;
  int use_gpu;
  int verbosity;
  int flash_attn;
  int n_gpu_layers;
  int reserved[6];
};

namespace {
constexpr int kSampleRate = 16000;
constexpr const char* kRawKind = "hikaru-crispasr-poc-raw";
constexpr int kSchemaVersion = 3;
const Clock::time_point kProcessStarted = Clock::now();

#ifndef POC_LOCAL_ROOT
#error POC_LOCAL_ROOT is required
#endif
#ifndef CRISPASR_ROOT
#error CRISPASR_ROOT is required
#endif
#ifndef CRISPASR_SOURCE_ROOT
#error CRISPASR_SOURCE_ROOT is required
#endif

class ControlledError : public std::runtime_error {
public:
  using std::runtime_error::runtime_error;
};

double elapsed_ms(const Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

bool has_text(const std::string& value) {
  return value.find_first_not_of(" \t\r\n") != std::string::npos;
}

std::string digest_hex(const unsigned char* digest, const size_t size) {
  std::ostringstream output;
  for (size_t i = 0; i < size; ++i)
    output << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(digest[i]);
  return output.str();
}

std::string sha256_bytes(const std::vector<unsigned char>& bytes) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  DWORD object_length = 0;
  DWORD returned = 0;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0
      || BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&object_length),
                           sizeof(object_length), &returned, 0) != 0 || object_length == 0) {
    if (algorithm != nullptr) BCryptCloseAlgorithmProvider(algorithm, 0);
    throw ControlledError("sha256-bytes-provider-failed");
  }
  std::vector<unsigned char> object(object_length);
  if (BCryptCreateHash(algorithm, &hash, object.data(), object_length, nullptr, 0, 0) != 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw ControlledError("sha256-bytes-create-failed");
  }
  if (!bytes.empty()
      && BCryptHashData(hash, const_cast<PUCHAR>(bytes.data()), static_cast<ULONG>(bytes.size()), 0) != 0) {
    BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw ControlledError("sha256-bytes-data-failed");
  }
  std::array<unsigned char, 32> digest{};
  const NTSTATUS status = BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0);
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  if (status != 0) throw ControlledError("sha256-bytes-finish-failed");
  return digest_hex(digest.data(), digest.size());
}

std::string sha256_file(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input)
    throw ControlledError("sha256-file-open-failed");
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0)
    throw ControlledError("sha256-provider-failed");
  ULONG object_length = 0;
  ULONG returned = 0;
  if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&object_length),
                        sizeof(object_length), &returned, 0) != 0 || object_length == 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw ControlledError("sha256-object-length-failed");
  }
  std::vector<unsigned char> object(object_length);
  BCRYPT_HASH_HANDLE hash = nullptr;
  if (BCryptCreateHash(algorithm, &hash, object.data(), object_length, nullptr, 0, 0) != 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw ControlledError("sha256-create-failed");
  }
  std::vector<unsigned char> buffer(4 << 20);
  while (input) {
    input.read(reinterpret_cast<char*>(buffer.data()), static_cast<std::streamsize>(buffer.size()));
    const std::streamsize count = input.gcount();
    if (count > 0 && BCryptHashData(hash, buffer.data(), static_cast<ULONG>(count), 0) != 0) {
      BCryptDestroyHash(hash);
      BCryptCloseAlgorithmProvider(algorithm, 0);
      throw ControlledError("sha256-data-failed");
    }
  }
  std::array<unsigned char, 32> digest{};
  const NTSTATUS status = BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0);
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  if (status != 0)
    throw ControlledError("sha256-finish-failed");
  return digest_hex(digest.data(), digest.size());
}

Json file_identity(const fs::path& path) {
  return {{"fileName", path.filename().u8string()}, {"sizeBytes", fs::file_size(path)}, {"sha256", sha256_file(path)}};
}

Json file_observation(const fs::path& path) {
  if (path.empty())
    return {{"state", "not-supplied"}, {"fileName", nullptr}, {"sizeBytes", nullptr}, {"sha256", nullptr}};
  if (!fs::is_regular_file(path))
    return {{"state", "missing"}, {"fileName", path.filename().u8string()}, {"sizeBytes", nullptr}, {"sha256", nullptr}};
  Json value = file_identity(path);
  value["state"] = "regular-file";
  return value;
}

uint16_t read_u16(std::istream& input) {
  std::array<unsigned char, 2> b{};
  if (!input.read(reinterpret_cast<char*>(b.data()), b.size()))
    throw ControlledError("wav-truncated");
  return static_cast<uint16_t>(b[0] | (b[1] << 8));
}

uint32_t read_u32(std::istream& input) {
  std::array<unsigned char, 4> b{};
  if (!input.read(reinterpret_cast<char*>(b.data()), b.size()))
    throw ControlledError("wav-truncated");
  return static_cast<uint32_t>(b[0]) | (static_cast<uint32_t>(b[1]) << 8)
       | (static_cast<uint32_t>(b[2]) << 16) | (static_cast<uint32_t>(b[3]) << 24);
}

std::string read_fourcc(std::istream& input) {
  std::array<char, 4> value{};
  if (!input.read(value.data(), value.size()))
    throw ControlledError("wav-truncated");
  return std::string(value.data(), value.size());
}

struct WavAudio {
  std::vector<float> samples;
  int64_t duration_ms = 0;
};

WavAudio read_wav(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input)
    throw ControlledError("wav-open-failed");
  if (read_fourcc(input) != "RIFF")
    throw ControlledError("wav-not-riff");
  static_cast<void>(read_u32(input));
  if (read_fourcc(input) != "WAVE")
    throw ControlledError("wav-not-wave");
  bool fmt_ready = false;
  WavAudio audio;
  while (input && audio.samples.empty()) {
    const std::string chunk = read_fourcc(input);
    const uint32_t size = read_u32(input);
    if (chunk == "fmt ") {
      if (size < 16)
        throw ControlledError("wav-invalid-fmt");
      const uint16_t format = read_u16(input);
      const uint16_t channels = read_u16(input);
      const uint32_t sample_rate = read_u32(input);
      static_cast<void>(read_u32(input));
      static_cast<void>(read_u16(input));
      const uint16_t bits = read_u16(input);
      if (format != 1 || channels != 1 || sample_rate != kSampleRate || bits != 16)
        throw ControlledError("wav-requires-16khz-mono-pcm16");
      input.seekg(size - 16, std::ios::cur);
      fmt_ready = true;
    } else if (chunk == "data") {
      if (!fmt_ready || size == 0 || size % 2 != 0)
        throw ControlledError("wav-invalid-data");
      std::vector<int16_t> pcm(size / 2);
      if (!input.read(reinterpret_cast<char*>(pcm.data()), size))
        throw ControlledError("wav-truncated-data");
      audio.samples.resize(pcm.size());
      std::transform(pcm.begin(), pcm.end(), audio.samples.begin(), [](const int16_t value) {
        return static_cast<float>(value) / 32768.0f;
      });
    } else {
      input.seekg(size, std::ios::cur);
    }
    if (size % 2 != 0)
      input.seekg(1, std::ios::cur);
  }
  if (!fmt_ready || audio.samples.empty())
    throw ControlledError("wav-missing-required-chunk");
  audio.duration_ms = (static_cast<int64_t>(audio.samples.size()) * 1000 + kSampleRate / 2) / kSampleRate;
  return audio;
}

void validate_derived_audio(const WavAudio& derived, const WavAudio& source, const std::string& derivation) {
  const size_t one_second = kSampleRate;
  if (derivation == "prepend-2000ms-zero-pcm16") {
    if (derived.samples.size() != source.samples.size() + 2 * one_second)
      throw ControlledError("derived-audio-size-mismatch");
    if (!std::all_of(derived.samples.begin(), derived.samples.begin() + 2 * one_second,
                     [](const float value) { return value == 0.0f; })
        || !std::equal(source.samples.begin(), source.samples.end(), derived.samples.begin() + 2 * one_second))
      throw ControlledError("derived-audio-content-mismatch");
  } else if (derivation == "concat-source-1000ms-zero-source") {
    if (derived.samples.size() != source.samples.size() * 2 + one_second)
      throw ControlledError("derived-audio-size-mismatch");
    const auto middle = derived.samples.begin() + static_cast<std::ptrdiff_t>(source.samples.size());
    if (!std::equal(source.samples.begin(), source.samples.end(), derived.samples.begin())
        || !std::all_of(middle, middle + one_second, [](const float value) { return value == 0.0f; })
        || !std::equal(source.samples.begin(), source.samples.end(), middle + one_second))
      throw ControlledError("derived-audio-content-mismatch");
  } else {
    throw ControlledError("derived-audio-derivation-unsupported");
  }
}

fs::path executable_path() {
  std::vector<wchar_t> buffer(32768);
  const DWORD n = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  if (n == 0 || n >= buffer.size())
    throw ControlledError("executable-path-failed");
  return fs::path(std::wstring(buffer.data(), n));
}

bool path_is_within(const fs::path& candidate_path, const fs::path& root_path) {
  const fs::path root = fs::weakly_canonical(root_path);
  const fs::path candidate = fs::weakly_canonical(candidate_path.is_absolute() ? candidate_path : fs::absolute(candidate_path));
  const fs::path relative = candidate.lexically_relative(root);
  if (relative.empty() || relative.is_absolute())
    return false;
  return relative.begin() != relative.end() && *relative.begin() != "..";
}

bool is_task_local_output(const fs::path& path) {
  return path_is_within(path, fs::path(POC_LOCAL_ROOT));
}

void require_task_local_output(const fs::path& path) {
  if (!is_task_local_output(path))
    throw ControlledError("raw-output-must-be-under-task-research-local");
}

class Api {
public:
  Api() {
    const fs::path dll = executable_path().parent_path() / "crispasr.dll";
    _module = LoadLibraryExW(dll.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (_module == nullptr)
      throw ControlledError("crispasr-dll-load-failed:" + std::to_string(GetLastError()));
    bind(open_with_params, "crispasr_session_open_with_params");
    bind(session_backend, "crispasr_session_backend");
    bind(available_backends, "crispasr_session_available_backends");
    bind(set_progress_callback, "crispasr_session_set_progress_callback");
    bind(set_segment_callback, "crispasr_session_set_segment_callback");
    bind(set_token_callback, "crispasr_session_set_token_callback");
    bind(transcribe_lang, "crispasr_session_transcribe_lang");
    bind(result_n_segments, "crispasr_session_result_n_segments");
    bind(result_segment_text, "crispasr_session_result_segment_text");
    bind(result_segment_t0, "crispasr_session_result_segment_t0");
    bind(result_segment_t1, "crispasr_session_result_segment_t1");
    bind(result_n_words, "crispasr_session_result_n_words");
    bind(result_word_text, "crispasr_session_result_word_text");
    bind(result_word_t0, "crispasr_session_result_word_t0");
    bind(result_word_t1, "crispasr_session_result_word_t1");
    bind(result_word_p, "crispasr_session_result_word_p");
    bind(result_free, "crispasr_session_result_free");
    bind(align_words, "crispasr_align_words_abi");
    bind(align_n_words, "crispasr_align_result_n_words");
    bind(align_word_text, "crispasr_align_result_word_text");
    bind(align_word_t0, "crispasr_align_result_word_t0");
    bind(align_word_t1, "crispasr_align_result_word_t1");
    bind(align_free, "crispasr_align_result_free");
    bind(close, "crispasr_session_close");
  }

  ~Api() {
    if (_module != nullptr)
      FreeLibrary(_module);
  }
  Api(const Api&) = delete;
  Api& operator=(const Api&) = delete;

  decltype(&crispasr_session_open_with_params) open_with_params = nullptr;
  decltype(&crispasr_session_backend) session_backend = nullptr;
  decltype(&crispasr_session_available_backends) available_backends = nullptr;
  decltype(&crispasr_session_set_progress_callback) set_progress_callback = nullptr;
  decltype(&crispasr_session_set_segment_callback) set_segment_callback = nullptr;
  decltype(&crispasr_session_set_token_callback) set_token_callback = nullptr;
  decltype(&crispasr_session_transcribe_lang) transcribe_lang = nullptr;
  decltype(&crispasr_session_result_n_segments) result_n_segments = nullptr;
  decltype(&crispasr_session_result_segment_text) result_segment_text = nullptr;
  decltype(&crispasr_session_result_segment_t0) result_segment_t0 = nullptr;
  decltype(&crispasr_session_result_segment_t1) result_segment_t1 = nullptr;
  decltype(&crispasr_session_result_n_words) result_n_words = nullptr;
  decltype(&crispasr_session_result_word_text) result_word_text = nullptr;
  decltype(&crispasr_session_result_word_t0) result_word_t0 = nullptr;
  decltype(&crispasr_session_result_word_t1) result_word_t1 = nullptr;
  decltype(&crispasr_session_result_word_p) result_word_p = nullptr;
  decltype(&crispasr_session_result_free) result_free = nullptr;
  decltype(&crispasr_align_words_abi) align_words = nullptr;
  decltype(&crispasr_align_result_n_words) align_n_words = nullptr;
  decltype(&crispasr_align_result_word_text) align_word_text = nullptr;
  decltype(&crispasr_align_result_word_t0) align_word_t0 = nullptr;
  decltype(&crispasr_align_result_word_t1) align_word_t1 = nullptr;
  decltype(&crispasr_align_result_free) align_free = nullptr;
  decltype(&crispasr_session_close) close = nullptr;

private:
  template <typename T>
  void bind(T& target, const char* name) {
    target = reinterpret_cast<T>(GetProcAddress(_module, name));
    if (target == nullptr)
      throw ControlledError(std::string("missing-export:") + name);
  }
  HMODULE _module = nullptr;
};

class SessionOwner {
public:
  SessionOwner(Api& api, crispasr_session* value, int& cleanup_count)
    : _api(api), _value(value), _cleanup_count(cleanup_count) {}
  ~SessionOwner() { release(); }
  crispasr_session* get() const { return _value; }
  void release() {
    if (_value != nullptr) {
      _api.close(_value);
      _value = nullptr;
      ++_cleanup_count;
    }
  }
private:
  Api& _api;
  crispasr_session* _value;
  int& _cleanup_count;
};

class ResultOwner {
public:
  ResultOwner(Api& api, crispasr_session_result* value, int& cleanup_count)
    : _api(api), _value(value), _cleanup_count(cleanup_count) {}
  ~ResultOwner() { release(); }
  crispasr_session_result* get() const { return _value; }
  void release() {
    if (_value != nullptr) {
      _api.result_free(_value);
      _value = nullptr;
      ++_cleanup_count;
    }
  }
private:
  Api& _api;
  crispasr_session_result* _value;
  int& _cleanup_count;
};

class AlignOwner {
public:
  AlignOwner(Api& api, crispasr_align_result* value, int& cleanup_count)
    : _api(api), _value(value), _cleanup_count(cleanup_count) {}
  ~AlignOwner() { release(); }
  crispasr_align_result* get() const { return _value; }
  void release() {
    if (_value != nullptr) {
      _api.align_free(_value);
      _value = nullptr;
      ++_cleanup_count;
    }
  }
private:
  Api& _api;
  crispasr_align_result* _value;
  int& _cleanup_count;
};

struct Segment {
  int64_t start_ms = 0;
  int64_t end_ms = 0;
  std::string text;
};

struct NativeWord {
  int segment_index = 0;
  int word_index = 0;
  int64_t start_ms = 0;
  int64_t end_ms = 0;
  std::string text;
  float probability = 0.0f;
};

Json segments_json(const std::vector<Segment>& segments) {
  Json output = Json::array();
  for (const Segment& segment : segments)
    output.push_back({{"startMs", segment.start_ms}, {"endMs", segment.end_ms}, {"text", segment.text}});
  return output;
}

Json words_json(const std::vector<NativeWord>& words) {
  Json output = Json::array();
  for (const NativeWord& word : words) {
    output.push_back({{"segmentIndex", word.segment_index}, {"wordIndex", word.word_index},
                      {"startMs", word.start_ms}, {"endMs", word.end_ms}, {"text", word.text},
                      {"probability", word.probability}});
  }
  return output;
}

void validate_segments(const std::vector<Segment>& segments, const int64_t duration_ms,
                       const std::string& provenance, const bool qwen) {
  if (segments.empty())
    throw ControlledError("segments-empty");
  if (qwen && provenance != "forced-aligner")
    throw ControlledError("qwen-timestamp-provenance-ineligible");
  int64_t previous_start = -1;
  for (const Segment& segment : segments) {
    if (!has_text(segment.text) || segment.start_ms < 0 || segment.start_ms >= segment.end_ms
        || segment.end_ms > duration_ms || segment.start_ms < previous_start)
      throw ControlledError("segment-legality-failed");
    previous_start = segment.start_ms;
  }
}

Json timing_legality(const std::vector<NativeWord>& words, const int64_t duration_ms) {
  int empty = 0, negative = 0, non_positive = 0, after_end = 0, backwards = 0;
  int64_t previous_start = -1;
  std::vector<int64_t> durations;
  for (const NativeWord& word : words) {
    if (!has_text(word.text)) ++empty;
    if (word.start_ms < 0) ++negative;
    if (word.start_ms >= word.end_ms) ++non_positive;
    if (word.end_ms > duration_ms) ++after_end;
    if (word.start_ms < previous_start) ++backwards;
    previous_start = word.start_ms;
    if (word.end_ms >= word.start_ms)
      durations.push_back(word.end_ms - word.start_ms);
  }
  std::sort(durations.begin(), durations.end());
  const auto percentile = [&durations](double q) -> Json {
    if (durations.empty()) return nullptr;
    const size_t index = static_cast<size_t>((durations.size() - 1) * q);
    return durations[index];
  };
  return {{"count", words.size()}, {"emptyTextCount", empty}, {"negativeStartCount", negative},
          {"nonPositiveDurationCount", non_positive}, {"afterAudioEndCount", after_end},
          {"nonMonotonicCount", backwards}, {"durationMsMin", durations.empty() ? Json(nullptr) : Json(durations.front())},
          {"durationMsMedian", percentile(0.5)}, {"durationMsP95", percentile(0.95)},
          {"durationMsMax", durations.empty() ? Json(nullptr) : Json(durations.back())}};
}

struct CallbackContext {
  bool active = true;
  int next_order = 0;
  int late_count = 0;
  DWORD transcribe_thread = 0;
  std::vector<Json> progress;
  std::vector<Json> segment_events;
  std::vector<Json> token_events;
  std::vector<Segment> preview_segments;
};

void progress_callback(const int processed, const int total, void* user_data) {
  auto* context = static_cast<CallbackContext*>(user_data);
  if (context == nullptr) return;
  if (!context->active) { ++context->late_count; return; }
  context->progress.push_back({{"order", context->next_order++}, {"threadId", GetCurrentThreadId()},
                               {"processed", processed}, {"total", total}});
}

void segment_callback(const char* text, const int64_t t0_cs, const int64_t t1_cs,
                      const int segment_index, void* user_data) {
  auto* context = static_cast<CallbackContext*>(user_data);
  if (context == nullptr) return;
  if (!context->active) { ++context->late_count; return; }
  const std::string copied = text == nullptr ? "" : text;
  context->preview_segments.push_back({t0_cs * 10, t1_cs * 10, copied});
  context->segment_events.push_back({{"order", context->next_order++}, {"threadId", GetCurrentThreadId()},
                                      {"segmentIndex", segment_index}, {"textBytes", copied.size()},
                                      {"startMs", t0_cs * 10}, {"endMs", t1_cs * 10}});
}

void token_callback(const char* token_text, const int token_index, void* user_data) {
  auto* context = static_cast<CallbackContext*>(user_data);
  if (context == nullptr) return;
  if (!context->active) { ++context->late_count; return; }
  const size_t bytes = token_text == nullptr ? 0 : std::strlen(token_text);
  context->token_events.push_back({{"order", context->next_order++}, {"threadId", GetCurrentThreadId()},
                                    {"tokenIndex", token_index}, {"textBytes", bytes}});
}

class CallbackGuard {
public:
  CallbackGuard(Api& api, crispasr_session* session, CallbackContext& context, int& reset_count)
    : _api(api), _session(session), _context(context), _reset_count(reset_count) {
    _api.set_progress_callback(_session, progress_callback, &_context);
    _api.set_segment_callback(_session, segment_callback, &_context);
    _api.set_token_callback(_session, token_callback, &_context);
  }
  ~CallbackGuard() { reset(); }
  void reset() {
    if (_reset) return;
    _context.active = false;
    _api.set_progress_callback(_session, nullptr, nullptr); ++_reset_count;
    _api.set_segment_callback(_session, nullptr, nullptr); ++_reset_count;
    _api.set_token_callback(_session, nullptr, nullptr); ++_reset_count;
    _reset = true;
  }
private:
  Api& _api;
  crispasr_session* _session;
  CallbackContext& _context;
  int& _reset_count;
  bool _reset = false;
};

bool same_segments(const std::vector<Segment>& left, const std::vector<Segment>& right) {
  if (left.size() != right.size()) return false;
  for (size_t i = 0; i < left.size(); ++i) {
    if (left[i].start_ms != right[i].start_ms || left[i].end_ms != right[i].end_ms || left[i].text != right[i].text)
      return false;
  }
  return true;
}

Json callback_json(const CallbackContext& context, const std::vector<Segment>& final_segments,
                   const int reset_count) {
  bool monotonic = true;
  int previous = -1;
  for (const Json& event : context.progress) {
    const int processed = event.at("processed").get<int>();
    if (processed < previous) monotonic = false;
    previous = processed;
  }
  bool same_thread = true;
  const auto check_threads = [&context, &same_thread](const std::vector<Json>& events) {
    for (const Json& event : events)
      if (event.at("threadId").get<DWORD>() != context.transcribe_thread) same_thread = false;
  };
  check_threads(context.progress);
  check_threads(context.segment_events);
  check_threads(context.token_events);
  const std::string relationship = context.preview_segments.empty()
    ? "no-preview"
    : (same_segments(context.preview_segments, final_segments) ? "identical-to-final" : "preview-replaced-by-final");
  return {{"progress", context.progress}, {"segments", context.segment_events}, {"tokens", context.token_events},
          {"progressMonotonic", monotonic}, {"callbacksOnTranscribeThread", same_thread},
          {"lateCallbackCount", context.late_count}, {"previewFinalRelationship", relationship},
          {"borrowedCallbackTextCopied", true}, {"callbackResetCount", reset_count},
          {"callbackContextActiveAfterReset", context.active}};
}

struct CopiedResult {
  std::vector<Segment> segments;
  std::vector<NativeWord> words;
};

CopiedResult copy_session_result(Api& api, crispasr_session_result* result) {
  CopiedResult copied;
  const int segment_count = api.result_n_segments(result);
  if (segment_count <= 0)
    throw ControlledError("final-result-empty");
  copied.segments.reserve(segment_count);
  for (int i = 0; i < segment_count; ++i) {
    const char* borrowed = api.result_segment_text(result, i);
    copied.segments.push_back({api.result_segment_t0(result, i) * 10, api.result_segment_t1(result, i) * 10,
                               borrowed == nullptr ? "" : std::string(borrowed)});
    const int word_count = api.result_n_words(result, i);
    for (int j = 0; j < std::max(0, word_count); ++j) {
      const char* word = api.result_word_text(result, i, j);
      copied.words.push_back({i, j, api.result_word_t0(result, i, j) * 10,
                              api.result_word_t1(result, i, j) * 10,
                              word == nullptr ? "" : std::string(word), api.result_word_p(result, i, j)});
    }
  }
  return copied;
}

std::vector<Segment> copy_alignment(Api& api, crispasr_align_result* result) {
  std::vector<Segment> copied;
  const int count = api.align_n_words(result);
  if (count <= 0)
    throw ControlledError("aligner-empty");
  copied.reserve(count);
  for (int i = 0; i < count; ++i) {
    const char* borrowed = api.align_word_text(result, i);
    copied.push_back({api.align_word_t0(result, i) * 10, api.align_word_t1(result, i) * 10,
                      borrowed == nullptr ? "" : std::string(borrowed)});
  }
  return copied;
}

std::pair<uint32_t, int> decode_utf8(const std::string& text, size_t pos) {
  const unsigned char b = static_cast<unsigned char>(text[pos]);
  if (b < 0x80) return {b, 1};
  if ((b & 0xE0) == 0xC0 && pos + 1 < text.size())
    return {static_cast<uint32_t>(((b & 0x1F) << 6) | (text[pos + 1] & 0x3F)), 2};
  if ((b & 0xF0) == 0xE0 && pos + 2 < text.size())
    return {static_cast<uint32_t>(((b & 0x0F) << 12) | ((text[pos + 1] & 0x3F) << 6) | (text[pos + 2] & 0x3F)), 3};
  if ((b & 0xF8) == 0xF0 && pos + 3 < text.size())
    return {static_cast<uint32_t>(((b & 0x07) << 18) | ((text[pos + 1] & 0x3F) << 12)
           | ((text[pos + 2] & 0x3F) << 6) | (text[pos + 3] & 0x3F)), 4};
  return {b, 1};
}

bool is_cjk(const uint32_t cp) {
  // Exact v0.8.22 crispasr_aligner.cpp::is_cjk_codepoint ranges.
  return (cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF)
      || (cp >= 0x3040 && cp <= 0x309F) || (cp >= 0x30A0 && cp <= 0x30FF)
      || (cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0x3000 && cp <= 0x303F)
      || (cp >= 0xFF00 && cp <= 0xFFEF);
}

std::vector<std::string> upstream_alignment_units(const std::string& text) {
  // Kept structurally identical to pinned tokenise_words so punctuation and
  // mixed-script boundaries cannot drift from the public aligner result count.
  std::vector<std::string> output;
  std::string current;
  for (size_t i = 0; i < text.size();) {
    const auto [cp, len] = decode_utf8(text, i);
    if (cp == ' ' || cp == '\n' || cp == '\t' || cp == '\r') {
      if (!current.empty()) { output.push_back(current); current.clear(); }
    } else if (is_cjk(cp)) {
      if (!current.empty()) { output.push_back(current); current.clear(); }
      output.push_back(text.substr(i, static_cast<size_t>(len)));
    } else {
      current += text.substr(i, static_cast<size_t>(len));
    }
    i += static_cast<size_t>(len);
  }
  if (!current.empty()) output.push_back(current);
  return output;
}

size_t upstream_alignment_unit_count(const std::string& text) {
  return upstream_alignment_units(text).size();
}

std::vector<Segment> group_alignment_like_upstream(const std::vector<Segment>& source_segments,
                                                    const std::vector<Segment>& aligned) {
  std::vector<Segment> output;
  size_t word = 0;
  for (size_t i = 0; i < source_segments.size(); ++i) {
    const size_t count = upstream_alignment_unit_count(source_segments[i].text);
    if (count == 0) continue;
    if (word >= aligned.size()) break;
    size_t end = std::min(word + count, aligned.size());
    if (i + 1 == source_segments.size()) end = aligned.size();
    output.push_back({aligned[word].start_ms, aligned[end - 1].end_ms, source_segments[i].text});
    word = end;
  }
  return output;
}

Json read_json(const fs::path& path) {
  std::ifstream input(path);
  if (!input)
    throw ControlledError("json-open-failed");
  Json value;
  input >> value;
  return value;
}

void validate_file_identity(const fs::path& path, const Json& entry, const std::string& error_prefix) {
  if (!fs::is_regular_file(path)) throw ControlledError(error_prefix + "-missing");
  if (fs::file_size(path) != entry.at("sizeBytes").get<uintmax_t>())
    throw ControlledError(error_prefix + "-size-mismatch");
  if (sha256_file(path) != entry.at("sha256").get<std::string>())
    throw ControlledError(error_prefix + "-hash-mismatch");
}

const Json& model_lock_entry(const Json& lock, const std::string& engine, const std::string& role) {
  for (const Json& entry : lock.at("models"))
    if (entry.at("engine").get<std::string>() == engine && entry.at("role").get<std::string>() == role)
      return entry;
  throw ControlledError("model-lock-entry-missing:" + engine + ":" + role);
}

void validate_runtime_lock(const Json& lock) {
  if (lock.value("schemaVersion", 0) != 1 || lock.value("lockStatus", "") != "complete")
    throw ControlledError("input-lock-invalid");
  for (const Json& entry : lock.at("runtime").at("files")) {
    const std::string base = entry.at("base").get<std::string>();
    const fs::path root = base == "sdk" ? fs::path(CRISPASR_ROOT)
                        : base == "source" ? fs::path(CRISPASR_SOURCE_ROOT)
                        : throw ControlledError("runtime-lock-base-invalid");
    validate_file_identity(root / entry.at("path").get<std::string>(), entry, "runtime-lock");
  }
}

void validate_model_lock(const Json& lock, const std::string& engine, const fs::path& model,
                         const fs::path& aligner) {
  const Json& primary = model_lock_entry(lock, engine, "primary");
  if (model.filename().u8string() != primary.at("fileName").get<std::string>())
    throw ControlledError("model-lock-name-mismatch");
  validate_file_identity(model, primary, "model-lock");
  if (engine == "qwen3-asr") {
    if (aligner.empty()) throw ControlledError("aligner-required");
    const Json& companion = model_lock_entry(lock, engine, "aligner");
    if (aligner.filename().u8string() != companion.at("fileName").get<std::string>())
      throw ControlledError("aligner-lock-name-mismatch");
    validate_file_identity(aligner, companion, "aligner-lock");
  } else if (!aligner.empty()) {
    throw ControlledError("aligner-only-valid-for-qwen3");
  }
}

std::string backend_for_engine(const std::string& engine) {
  if (engine == "parakeet-ja" || engine == "reazonspeech") return "parakeet";
  if (engine == "qwen3-asr") return "qwen3";
  throw ControlledError("unsupported-engine");
}

size_t peak_working_set() {
  PROCESS_MEMORY_COUNTERS counters{};
  counters.cb = sizeof(counters);
  if (!GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters)))
    throw ControlledError("rss-measurement-failed");
  return counters.PeakWorkingSetSize;
}

std::string environment_value(const char* name) {
  char* raw = nullptr;
  size_t length = 0;
  static_cast<void>(_dupenv_s(&raw, &length, name));
  const std::string value = raw == nullptr ? "" : raw;
  std::free(raw);
  return value;
}

std::vector<fs::path> path_entries() {
  std::vector<fs::path> entries;
  std::stringstream input(environment_value("PATH"));
  std::string item;
  while (std::getline(input, item, ';'))
    if (!item.empty()) entries.emplace_back(item);
  return entries;
}

Json native_environment() {
  SYSTEM_INFO system{};
  GetNativeSystemInfo(&system);
  MEMORYSTATUSEX memory{};
  memory.dwLength = sizeof(memory);
  const bool memory_ok = GlobalMemoryStatusEx(&memory) != 0;
  char* processor = nullptr;
  size_t processor_length = 0;
  static_cast<void>(_dupenv_s(&processor, &processor_length, "PROCESSOR_IDENTIFIER"));
  const std::string cpu = processor == nullptr ? "unknown" : processor;
  std::free(processor);
  const fs::path exe_dir = executable_path().parent_path();
  const std::string system_root = environment_value("SystemRoot");
  const fs::path system32 = fs::path(system_root.empty() ? "C:\\Windows" : system_root) / "System32";
  Json categories = Json::array();
  bool restricted = true;
  for (const fs::path& entry : path_entries()) {
    std::string category = "other";
    try {
      if (fs::equivalent(entry, exe_dir)) category = "harness-directory";
      else if (fs::equivalent(entry, system32)) category = "windows-system32";
      else restricted = false;
    } catch (...) {
      restricted = false;
    }
    categories.push_back(category);
  }
  return {{"os", "Windows"},
          {"architecture", system.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64 ? "x86_64" : "unknown"},
          {"cpu", cpu}, {"logicalCores", system.dwNumberOfProcessors},
          {"totalMemoryBytes", memory_ok ? Json(memory.ullTotalPhys) : Json(nullptr)},
          {"pathPolicy", {{"restricted", restricted}, {"entryCount", categories.size()}, {"entryCategories", categories}}},
          {"relevantOverrides", {{"CRISPASR_SESSION_AUTOCHUNK", environment_value("CRISPASR_SESSION_AUTOCHUNK").empty() ? "unset" : "set"},
                                  {"CRISPASR_SESSION_UNIFIED_DISPATCH", environment_value("CRISPASR_SESSION_UNIFIED_DISPATCH").empty() ? "unset" : "set"},
                                  {"CRISPASR_ALIGN_NO_ROMANIZE", environment_value("CRISPASR_ALIGN_NO_ROMANIZE").empty() ? "unset" : "set"}}}};
}

Json loaded_local_modules() {
  std::array<HMODULE, 1024> modules{};
  DWORD needed = 0;
  if (!EnumProcessModules(GetCurrentProcess(), modules.data(), static_cast<DWORD>(sizeof(modules)), &needed))
    throw ControlledError("module-enumeration-failed");
  const fs::path exe_dir = fs::weakly_canonical(executable_path().parent_path());
  Json output = Json::array();
  const size_t count = std::min(modules.size(), static_cast<size_t>(needed / sizeof(HMODULE)));
  for (size_t i = 0; i < count; ++i) {
    std::array<wchar_t, 32768> path{};
    if (GetModuleFileNameExW(GetCurrentProcess(), modules[i], path.data(), static_cast<DWORD>(path.size())) == 0)
      continue;
    const fs::path module(path.data());
    if (fs::weakly_canonical(module).parent_path() == exe_dir)
      output.push_back(file_identity(module));
  }
  std::sort(output.begin(), output.end(), [](const Json& a, const Json& b) {
    return a.at("fileName").get<std::string>() < b.at("fileName").get<std::string>();
  });
  return output;
}

Json required_dll_identities() {
  const fs::path root = executable_path().parent_path();
  Json output = Json::array();
  for (const char* name : {"crispasr.dll", "ggml-base.dll", "ggml-cpu.dll", "ggml.dll"})
    output.push_back(file_identity(root / name));
  return output;
}

std::string required_arg(const std::vector<std::string>& args, const std::string& name) {
  const auto it = std::find(args.begin(), args.end(), name);
  if (it == args.end() || std::next(it) == args.end())
    throw ControlledError("missing-argument:" + name);
  return *std::next(it);
}

std::string optional_arg(const std::vector<std::string>& args, const std::string& name,
                         const std::string& fallback = "") {
  const auto it = std::find(args.begin(), args.end(), name);
  if (it == args.end()) return fallback;
  if (std::next(it) == args.end()) throw ControlledError("missing-argument:" + name);
  return *std::next(it);
}

int optional_positive_int(const std::vector<std::string>& args, const std::string& name, const int fallback) {
  const std::string value = optional_arg(args, name);
  if (value.empty()) return fallback;
  const int parsed = std::stoi(value);
  if (parsed <= 0) throw ControlledError("invalid-argument:" + name);
  return parsed;
}

Json role_identity(const fs::path& path, const std::string& engine, const std::string& role) {
  Json value = file_identity(path);
  value["engine"] = engine;
  value["role"] = role;
  return value;
}

Json identity_bundle(const Json& lock, const fs::path& lock_path, const std::string& engine,
                     const fs::path& model, const fs::path& aligner, const fs::path& audio,
                     const std::string& manifest_sha, const std::string& case_id,
                     const std::string& case_source, const fs::path& source_audio = {},
                     const std::string& derivation = "") {
  Json aligner_identity = nullptr;
  if (engine == "qwen3-asr" && !aligner.empty()) aligner_identity = role_identity(aligner, engine, "aligner");
  Json case_identity{{"caseId", case_id}, {"caseSource", case_source}, {"manifestSha256", manifest_sha},
                     {"audio", file_identity(audio)}};
  if (!source_audio.empty()) {
    case_identity["derivation"] = {{"id", derivation}, {"sourceCaseId", "short-v1"},
                                   {"sourceAudio", file_identity(source_audio)}};
  }
  return {{"case", case_identity},
          {"inputLock", file_identity(lock_path)},
          {"executable", file_identity(executable_path())},
          {"requiredDlls", required_dll_identities()},
          {"primaryModel", role_identity(model, engine, "primary")},
          {"alignerModel", aligner_identity},
          {"pinnedCommit", lock.at("crispasr").at("commit")}};
}

Json run_sample(Api& api, crispasr_session* session, const std::string& engine, const fs::path& aligner,
                const WavAudio& audio, const std::string& run_kind, const int repeat_index) {
  CallbackContext callback;
  callback.transcribe_thread = GetCurrentThreadId();
  int callback_reset_count = 0;
  CallbackGuard callback_guard(api, session, callback, callback_reset_count);
  int result_cleanup_count = 0;
  int align_cleanup_count = 0;
  bool result_created = false;
  bool align_created = false;
  bool copy_before_release = false;
  std::vector<Segment> native_final;
  std::vector<NativeWord> native_words;
  std::vector<Segment> raw_alignment;
  std::vector<Segment> accepted;
  std::string provenance = engine == "qwen3-asr" ? "forced-aligner" : "engine-native";
  std::string failure_code;
  double transcribe_ms = 0;
  double align_ms = 0;
  const Clock::time_point inference_started = Clock::now();
  try {
    const Clock::time_point transcribe_started = Clock::now();
    // The pinned official session route auto-selects single-pass vs long-form;
    // forcing the chunked entry point on short audio bypasses that contract.
    crispasr_session_result* raw_result = api.transcribe_lang(
      session, audio.samples.data(), static_cast<int>(audio.samples.size()), "ja");
    transcribe_ms = elapsed_ms(transcribe_started);
    if (raw_result == nullptr) throw ControlledError("transcribe-failed");
    result_created = true;
    ResultOwner result(api, raw_result, result_cleanup_count);
    CopiedResult copied = copy_session_result(api, result.get());
    native_final = std::move(copied.segments);
    native_words = std::move(copied.words);
    const std::string copied_text_guard = native_final.front().text;
    result.release();
    if (native_final.front().text != copied_text_guard || result_cleanup_count != 1)
      throw ControlledError("copy-before-result-release-failed");
    copy_before_release = true;

    if (engine == "qwen3-asr") {
      std::string transcript;
      for (const Segment& segment : native_final) {
        if (!transcript.empty()) transcript += ' ';
        transcript += segment.text;
      }
      if (!has_text(transcript)) throw ControlledError("qwen-transcript-empty");
      const Clock::time_point align_started = Clock::now();
      crispasr_align_result* raw = api.align_words(
        aligner.u8string().c_str(), transcript.c_str(), audio.samples.data(),
        static_cast<int32_t>(audio.samples.size()), 0,
        static_cast<int32_t>(std::max(1u, std::thread::hardware_concurrency())));
      align_ms = elapsed_ms(align_started);
      if (raw == nullptr) throw ControlledError("aligner-failed");
      align_created = true;
      AlignOwner owner(api, raw, align_cleanup_count);
      raw_alignment = copy_alignment(api, owner.get());
      const std::string copied_align_guard = raw_alignment.front().text;
      owner.release();
      if (raw_alignment.front().text != copied_align_guard || align_cleanup_count != 1)
        throw ControlledError("copy-before-align-release-failed");
      accepted = group_alignment_like_upstream(native_final, raw_alignment);
    } else {
      accepted = native_final;
    }
    validate_segments(accepted, audio.duration_ms, provenance, engine == "qwen3-asr");
  } catch (const std::exception& error) {
    failure_code = error.what();
    accepted.clear();
  }
  callback_guard.reset();
  const double inference_ms = elapsed_ms(inference_started);
  const bool result_exact = result_cleanup_count == (result_created ? 1 : 0);
  const bool align_exact = align_cleanup_count == (align_created ? 1 : 0);
  const bool callbacks_reset = callback_reset_count == 3 && !callback.active;
  Json sample{{"status", failure_code.empty() ? "completed" : "failed"},
              {"runKind", run_kind}, {"repeatIndex", repeat_index}, {"timestampProvenance", provenance},
              {"transcribeCall", "crispasr_session_transcribe_lang (official auto short/long routing)"},
              {"nativeFinalSegments", segments_json(native_final)}, {"sessionGetterWords", words_json(native_words)},
              {"sessionGetterWordTiming", {{"eligibleForAcceptedTimeline", engine != "qwen3-asr"},
                                            {"reason", engine == "qwen3-asr"
                                              ? "Qwen session getter timing is sentinel-only; ForcedAligner grouping is required"
                                              : "public session getter timing"},
                                            {"legality", timing_legality(native_words, audio.duration_ms)}}},
              {"rawAlignmentEntries", segments_json(raw_alignment)},
              {"alignmentUnitCount", engine == "qwen3-asr"
                ? Json([&native_final]() { size_t count = 0; for (const Segment& segment : native_final)
                    count += upstream_alignment_unit_count(segment.text); return count; }()) : Json(nullptr)},
              {"alignmentGrouping", engine == "qwen3-asr" ? "pinned-v0.8.22-upstream-segment-grouping" : "not-applicable"},
              {"segments", segments_json(accepted)}, {"callback", callback_json(callback, native_final, callback_reset_count)},
              {"cleanup", {{"resultCreated", result_created}, {"resultFreeCount", result_cleanup_count},
                            {"resultExactOnce", result_exact},
                            {"alignResultCreated", align_created}, {"alignResultFreeCount", align_cleanup_count},
                            {"alignResultExactOnce", align_exact},
                            {"callbackResetCount", callback_reset_count}, {"copyBeforeRelease", copy_before_release},
                            {"exactOnce", result_exact && align_exact && callbacks_reset}}},
              {"timings", {{"transcribeMs", transcribe_ms}, {"alignMs", align_ms},
                            {"inferenceMs", inference_ms}, {"inferenceRtf", inference_ms / audio.duration_ms}}}};
  if (!failure_code.empty())
    sample["failure"] = {{"code", failure_code}, {"acceptedTimedSegmentCount", 0}};
  return sample;
}

void write_json(const fs::path& output, const Json& value) {
  fs::create_directories(output.parent_path());
  std::ofstream stream(output);
  if (!stream) throw ControlledError("output-open-failed");
  stream << std::setw(2) << value << '\n';
}

void run_model(const std::vector<std::string>& args) {
  const fs::path output = required_arg(args, "--output");
  require_task_local_output(output);
  const fs::path lock_path = required_arg(args, "--lock");
  const fs::path model = required_arg(args, "--model");
  const fs::path aligner = optional_arg(args, "--aligner");
  const fs::path audio_path = required_arg(args, "--audio");
  const std::string engine = required_arg(args, "--engine");
  const std::string case_id = required_arg(args, "--case-id");
  const std::string manifest_sha = required_arg(args, "--manifest-sha256");
  const std::string case_source = optional_arg(args, "--case-source", "t01-authoritative");
  const fs::path source_audio_path = optional_arg(args, "--source-audio");
  const std::string derivation = optional_arg(args, "--derivation");
  const int repeats = optional_positive_int(args, "--repeats", 1);
  const Json lock = read_json(lock_path);
  validate_runtime_lock(lock);
  validate_model_lock(lock, engine, model, aligner);
  const WavAudio audio = read_wav(audio_path);
  if (case_source == "derived-obligation") {
    if (source_audio_path.empty() || derivation.empty()) throw ControlledError("derived-audio-contract-missing");
    validate_derived_audio(audio, read_wav(source_audio_path), derivation);
  } else if (!source_audio_path.empty() || !derivation.empty()) {
    throw ControlledError("derivation-only-valid-for-derived-obligation");
  }
  const Json identities = identity_bundle(lock, lock_path, engine, model, aligner, audio_path,
                                          manifest_sha, case_id, case_source, source_audio_path, derivation);

  Json samples = Json::array();
  Json failure = nullptr;
  int session_cleanup_count = 0;
  bool session_opened = false;
  double load_ms = 0;
  std::string resolved_backend;
  Json module_evidence = Json::array();
  try {
    Api api;
    crispasr_open_params_v1 params{};
    params.abi_version = 2;
    params.n_threads = static_cast<int>(std::max(1u, std::thread::hardware_concurrency()));
    params.use_gpu = 0;
    params.verbosity = 0;
    params.flash_attn = 0;
    params.n_gpu_layers = 0;
    const Clock::time_point load_started = Clock::now();
    crispasr_session* opened = api.open_with_params(model.u8string().c_str(), backend_for_engine(engine).c_str(), &params);
    load_ms = elapsed_ms(load_started);
    if (opened == nullptr) throw ControlledError("session-open-failed");
    session_opened = true;
    SessionOwner session(api, opened, session_cleanup_count);
    const char* backend = api.session_backend(session.get());
    resolved_backend = backend == nullptr ? "" : backend;
    if (resolved_backend != backend_for_engine(engine)) throw ControlledError("session-backend-mismatch");
    for (int repeat = 0; repeat < repeats; ++repeat) {
      Json sample = run_sample(api, session.get(), engine, aligner, audio,
                               repeat == 0 ? "cold" : "warm", repeat + 1);
      if (repeat == 0) {
        const double total_ms = elapsed_ms(kProcessStarted);
        sample["timings"]["loadMs"] = load_ms;
        sample["timings"]["totalMs"] = total_ms;
        sample["timings"]["totalRtf"] = total_ms / audio.duration_ms;
      }
      if (sample.value("status", "") == "failed") failure = sample.at("failure");
      samples.push_back(std::move(sample));
      if (!failure.is_null()) break;
    }
    module_evidence = loaded_local_modules();
    session.release();
  } catch (const std::exception& error) {
    failure = {{"code", error.what()}, {"acceptedTimedSegmentCount", 0}};
    if (samples.empty()) {
      const bool failed_result_created = false;
      const int failed_result_free_count = 0;
      const bool failed_align_created = false;
      const int failed_align_free_count = 0;
      const bool failed_result_exact = failed_result_free_count == (failed_result_created ? 1 : 0);
      const bool failed_align_exact = failed_align_free_count == (failed_align_created ? 1 : 0);
      samples.push_back({{"status", "failed"}, {"runKind", "cold"}, {"repeatIndex", 1},
                         {"timestampProvenance", engine == "qwen3-asr" ? "forced-aligner" : "engine-native"},
                         {"transcribeCall", "not-reached-or-failed"}, {"nativeFinalSegments", Json::array()},
                         {"sessionGetterWords", Json::array()},
                         {"sessionGetterWordTiming", {{"eligibleForAcceptedTimeline", engine != "qwen3-asr"},
                                                       {"reason", engine == "qwen3-asr"
                                                         ? "Qwen session getter timing is sentinel-only; ForcedAligner grouping is required"
                                                         : "public session getter timing"},
                                                       {"legality", timing_legality({}, audio.duration_ms)}}},
                         {"rawAlignmentEntries", Json::array()}, {"alignmentUnitCount", engine == "qwen3-asr" ? Json(0) : Json(nullptr)},
                         {"alignmentGrouping", engine == "qwen3-asr" ? "pinned-v0.8.22-upstream-segment-grouping" : "not-applicable"},
                         {"segments", Json::array()},
                         {"callback", {{"progress", Json::array()}, {"segments", Json::array()}, {"tokens", Json::array()},
                                       {"progressMonotonic", true}, {"callbacksOnTranscribeThread", true},
                                       {"lateCallbackCount", 0}, {"previewFinalRelationship", "not-reached"},
                                       {"borrowedCallbackTextCopied", true}, {"callbackResetCount", 0},
                                       {"callbackContextActiveAfterReset", false}}},
                         {"cleanup", {{"resultCreated", failed_result_created},
                                      {"resultFreeCount", failed_result_free_count}, {"resultExactOnce", failed_result_exact},
                                      {"alignResultCreated", failed_align_created},
                                      {"alignResultFreeCount", failed_align_free_count}, {"alignResultExactOnce", failed_align_exact},
                                      {"callbackResetCount", 0}, {"copyBeforeRelease", false},
                                      {"exactOnce", failed_result_exact && failed_align_exact}}},
                         {"timings", {{"loadMs", load_ms}, {"transcribeMs", 0}, {"alignMs", 0},
                                      {"inferenceMs", 0}, {"inferenceRtf", 0},
                                      {"totalMs", elapsed_ms(kProcessStarted)},
                                      {"totalRtf", elapsed_ms(kProcessStarted) / audio.duration_ms}}},
                         {"failure", failure}});
    }
  }

  const std::string status = failure.is_null() ? "completed" : "failed";
  const bool session_exact = session_cleanup_count == (session_opened ? 1 : 0);
  Json raw{{"schemaVersion", kSchemaVersion}, {"kind", kRawKind}, {"status", status},
           {"request", {{"engine", engine}, {"backendRequested", backend_for_engine(engine)},
                        {"caseId", case_id}, {"caseSource", case_source}, {"manifestSha256", manifest_sha},
                        {"modelFileName", model.filename().u8string()},
                        {"alignerFileName", aligner.empty() ? Json(nullptr) : Json(aligner.filename().u8string())},
                        {"devicePolicy", "public-open-params-v2"}}},
           {"engine", engine}, {"resolvedBackend", resolved_backend}, {"durationMs", audio.duration_ms},
           {"device", "cpu"}, {"identities", identities}, {"environment", native_environment()},
           {"runtime", {{"publicAbi", "CrispASR v0.8.22 crispasr_session.h"},
                         {"openParams", {{"abiVersion", 2},
                                         {"nThreads", static_cast<int>(std::max(1u, std::thread::hardware_concurrency()))},
                                         {"useGpu", 0}, {"flashAttn", 0}, {"nGpuLayers", 0}}},
                         {"loadedLocalModules", module_evidence},
                         {"cooperativeCancellation", "unsupported-by-pinned-public-session-abi"}}},
           {"samples", samples},
           {"lifecycle", {{"sessionOpened", session_opened}, {"sessionCloseCount", session_cleanup_count},
                           {"sessionExactOnce", session_exact}}},
           {"resources", {{"peakProcessRssBytes", peak_working_set()},
                           {"method", "GetProcessMemoryInfo.PeakWorkingSetSize"}}}};
  if (engine == "reazonspeech")
    raw["request"]["dispatchBasis"] = "pinned CLI/backend detection maps ReazonSpeech GGUF to public parakeet session backend";
  if (case_source == "derived-obligation") {
    raw["request"]["derivation"] = derivation;
    raw["request"]["sourceCaseId"] = "short-v1";
  }
  if (!failure.is_null()) raw["failure"] = failure;
  write_json(output, raw);
  std::cout << Json{{"status", status}, {"sampleCount", samples.size()},
                    {"acceptedTimedSegmentCount", samples.front().at("segments").size()}}.dump() << '\n';
  if (status != "completed") throw ControlledError(failure.at("code").get<std::string>());
}

void contract_test(const std::vector<std::string>& args) {
  const Json lock = read_json(required_arg(args, "--lock"));
  const std::string engine = required_arg(args, "--engine");
  validate_runtime_lock(lock);
  validate_model_lock(lock, engine, required_arg(args, "--model"), optional_arg(args, "--aligner"));
  std::cout << Json{{"status", "pass"}, {"engine", engine},
                    {"checks", "runtime-header-dll-model-size-sha256"}}.dump() << '\n';
}

void abi_probe() {
  Api api;
  std::array<char, 8192> backends{};
  const int count = api.available_backends(backends.data(), static_cast<int>(backends.size()));
  if (count < 0 || std::string(backends.data()).find("parakeet") == std::string::npos
      || std::string(backends.data()).find("qwen3") == std::string::npos)
    throw ControlledError("required-backends-unavailable");
  std::cout << Json{{"status", "pass"}, {"requiredExports", 25}, {"availableBackendsCsv", backends.data()},
                    {"cpuOpenExport", "crispasr_session_open_with_params"}}.dump() << '\n';
}

void invalid_model_test() {
  Api api;
  int close_count = 0;
  crispasr_open_params_v1 params{2, 1, 0, 0, 0, 0, {0, 0, 0, 0, 0, 0}};
  crispasr_session* opened = api.open_with_params("Z:\\hikaru-crispasr-does-not-exist.gguf", "parakeet", &params);
  SessionOwner owner(api, opened, close_count);
  if (opened != nullptr) throw ControlledError("invalid-model-unexpectedly-opened");
  owner.release();
  if (close_count != 0) throw ControlledError("invalid-model-cleanup-count-invalid");
  std::cout << "{\"status\":\"pass\",\"code\":\"session-open-null\"}\n";
}

void write_pcm_wav(const fs::path& path, const std::vector<int16_t>& pcm) {
  std::ofstream output(path, std::ios::binary);
  const uint32_t bytes = static_cast<uint32_t>(pcm.size() * sizeof(int16_t));
  auto u16 = [&output](const uint16_t v) { output.write(reinterpret_cast<const char*>(&v), sizeof(v)); };
  auto u32 = [&output](const uint32_t v) { output.write(reinterpret_cast<const char*>(&v), sizeof(v)); };
  output.write("RIFF", 4); u32(36 + bytes); output.write("WAVEfmt ", 8); u32(16);
  u16(1); u16(1); u32(kSampleRate); u32(kSampleRate * 2); u16(2); u16(16);
  output.write("data", 4); u32(bytes); output.write(reinterpret_cast<const char*>(pcm.data()), bytes);
}

struct EvidenceSelection {
  fs::path evidence;
  fs::path manifest;
  fs::path lock;
  fs::path model;
  fs::path aligner;
  fs::path audio;
  fs::path source_audio;
  fs::path corrupt_aligner;
  fs::path unloadable_aligner;
  std::string case_id;
  std::string case_source;
  std::string manifest_sha;
  std::string derivation;
};

EvidenceSelection evidence_selection(const std::vector<std::string>& args) {
  return {required_arg(args, "--validate-evidence"), required_arg(args, "--manifest"),
          required_arg(args, "--lock"), required_arg(args, "--model"), optional_arg(args, "--aligner"),
          required_arg(args, "--audio"), optional_arg(args, "--source-audio"),
          optional_arg(args, "--corrupt-aligner"), optional_arg(args, "--unloadable-aligner"),
          required_arg(args, "--case-id"), optional_arg(args, "--case-source", "t01-authoritative"),
          required_arg(args, "--manifest-sha256"), optional_arg(args, "--derivation")};
}

void require_identity_match(const Json& recorded, const Json& actual, const std::string& label) {
  for (const char* field : {"fileName", "sizeBytes", "sha256"})
    if (!recorded.contains(field) || recorded.at(field) != actual.at(field))
      throw ControlledError("evidence-identity-mismatch:" + label + ":" + field);
  for (const char* field : {"engine", "role"})
    if (actual.contains(field) && (!recorded.contains(field) || recorded.at(field) != actual.at(field)))
      throw ControlledError("evidence-identity-mismatch:" + label + ":" + field);
}

const Json& identity_named(const Json& identities, const std::string& name, const std::string& label) {
  for (const Json& identity : identities)
    if (identity.value("fileName", "") == name) return identity;
  throw ControlledError("evidence-identity-missing:" + label + ":" + name);
}

void validate_cpu_runtime(const Json& runtime, const Json& environment) {
  const Json& params = runtime.at("openParams");
  const int expected_threads = static_cast<int>(std::max(1u, std::thread::hardware_concurrency()));
  if (params.value("abiVersion", 0) != 2 || params.value("nThreads", 0) != expected_threads
      || params.value("useGpu", -1) != 0 || params.value("flashAttn", -1) != 0
      || params.value("nGpuLayers", -1) != 0)
    throw ControlledError("evidence-cpu-open-params-invalid");
  const Json& policy = environment.at("pathPolicy");
  if (!policy.value("restricted", false) || policy.value("entryCount", 0) != 2)
    throw ControlledError("evidence-restricted-path-invalid");
  const Json categories = policy.at("entryCategories");
  if (categories.size() != 2
      || std::count(categories.begin(), categories.end(), "harness-directory") != 1
      || std::count(categories.begin(), categories.end(), "windows-system32") != 1)
    throw ControlledError("evidence-restricted-path-categories-invalid");
}

void validate_loaded_module_identities(const Json& runtime, const Json& dlls) {
  const Json& loaded = runtime.at("loadedLocalModules");
  if (!loaded.is_array() || loaded.size() != 5)
    throw ControlledError("evidence-loaded-module-set-invalid");
  require_identity_match(identity_named(loaded, executable_path().filename().u8string(), "loaded-module"),
                         file_identity(executable_path()), "loaded-executable");
  for (const Json& dll : dlls)
    require_identity_match(identity_named(loaded, dll.at("fileName"), "loaded-module"), dll,
                           "loaded-" + dll.at("fileName").get<std::string>());
}

const Json& manifest_case(const Json& manifest, const std::string& case_id) {
  if (manifest.value("schemaVersion", 0) != 1 || !manifest.contains("cases") || !manifest.at("cases").is_array())
    throw ControlledError("selected-manifest-invalid");
  for (const Json& item : manifest.at("cases"))
    if (item.value("id", "") == case_id) return item;
  throw ControlledError("selected-manifest-case-missing:" + case_id);
}

void validate_manifest_audio(const Json& manifest, const std::string& case_id, const fs::path& audio) {
  const Json& item = manifest_case(manifest, case_id);
  if (audio.filename().u8string() != item.at("audio").get<std::string>()
      || sha256_file(audio) != item.at("audioSha256").get<std::string>())
    throw ControlledError("selected-manifest-audio-identity-mismatch");
  const WavAudio wav = read_wav(audio);
  if (wav.duration_ms != item.at("durationMs").get<int64_t>()
      || item.value("sampleRate", 0) != kSampleRate || item.value("channels", 0) != 1
      || item.value("sampleWidthBits", 0) != 16)
    throw ControlledError("selected-manifest-audio-shape-mismatch");
}

std::vector<unsigned char> canonical_pcm16_wav(const std::vector<float>& samples) {
  std::vector<unsigned char> bytes;
  bytes.reserve(44 + samples.size() * 2);
  const auto text = [&bytes](const char* value) { bytes.insert(bytes.end(), value, value + 4); };
  const auto u16 = [&bytes](const uint16_t value) {
    bytes.push_back(static_cast<unsigned char>(value));
    bytes.push_back(static_cast<unsigned char>(value >> 8));
  };
  const auto u32 = [&bytes](const uint32_t value) {
    for (int shift = 0; shift < 32; shift += 8) bytes.push_back(static_cast<unsigned char>(value >> shift));
  };
  const uint32_t data_bytes = static_cast<uint32_t>(samples.size() * 2);
  text("RIFF"); u32(36 + data_bytes); text("WAVE"); text("fmt "); u32(16);
  u16(1); u16(1); u32(kSampleRate); u32(kSampleRate * 2); u16(2); u16(16); text("data"); u32(data_bytes);
  for (const float sample : samples) {
    const int value = std::clamp(static_cast<int>(std::lround(sample * 32768.0f)), -32768, 32767);
    u16(static_cast<uint16_t>(static_cast<int16_t>(value)));
  }
  return bytes;
}

Json expected_derived_audio_identity(const WavAudio& source, const std::string& derivation,
                                     const std::string& file_name) {
  std::vector<float> derived;
  if (derivation == "prepend-2000ms-zero-pcm16") {
    derived.assign(2 * kSampleRate, 0.0f);
    derived.insert(derived.end(), source.samples.begin(), source.samples.end());
  } else if (derivation == "concat-source-1000ms-zero-source") {
    derived = source.samples;
    derived.insert(derived.end(), kSampleRate, 0.0f);
    derived.insert(derived.end(), source.samples.begin(), source.samples.end());
  } else {
    throw ControlledError("derived-audio-derivation-unsupported");
  }
  const std::vector<unsigned char> bytes = canonical_pcm16_wav(derived);
  return {{"fileName", file_name}, {"sizeBytes", bytes.size()}, {"sha256", sha256_bytes(bytes)}};
}

void validate_common_identity(const Json& identities, const Json& runtime, const Json& environment,
                              const std::string& engine, const EvidenceSelection& selected) {
  if (sha256_file(selected.manifest) != selected.manifest_sha)
    throw ControlledError("selected-manifest-hash-mismatch");
  const Json manifest = read_json(selected.manifest);
  const Json lock = read_json(selected.lock);
  validate_runtime_lock(lock);
  validate_model_lock(lock, engine, selected.model, selected.aligner);
  const Json& case_identity = identities.at("case");
  if (case_identity.value("caseId", "") != selected.case_id
      || case_identity.value("caseSource", "") != selected.case_source
      || case_identity.value("manifestSha256", "") != selected.manifest_sha)
    throw ControlledError("evidence-selected-case-identity-mismatch");
  require_identity_match(case_identity.at("audio"), file_identity(selected.audio), "selected-audio");

  if (selected.case_source == "derived-obligation") {
    if (selected.source_audio.empty() || selected.derivation.empty())
      throw ControlledError("selected-derived-audio-contract-missing");
    const std::string expected_derivation = selected.case_id == "qwen-leading-silence-v1"
      ? "prepend-2000ms-zero-pcm16"
      : selected.case_id == "qwen-boundary-v1" ? "concat-source-1000ms-zero-source" : "";
    const std::string expected_file = selected.case_id == "qwen-leading-silence-v1"
      ? "qwen-leading-silence.wav" : selected.case_id == "qwen-boundary-v1" ? "qwen-boundary.wav" : "";
    if (selected.derivation != expected_derivation || expected_file.empty()
        || selected.audio.filename().u8string() != expected_file)
      throw ControlledError("selected-derived-audio-obligation-unsupported");
    validate_manifest_audio(manifest, "short-v1", selected.source_audio);
    const WavAudio source = read_wav(selected.source_audio);
    validate_derived_audio(read_wav(selected.audio), source, selected.derivation);
    require_identity_match(file_identity(selected.audio),
                           expected_derived_audio_identity(source, selected.derivation, expected_file),
                           "deterministic-derived-audio");
    const Json& derivation = case_identity.at("derivation");
    if (derivation.value("id", "") != selected.derivation || derivation.value("sourceCaseId", "") != "short-v1")
      throw ControlledError("evidence-derived-audio-derivation-mismatch");
    require_identity_match(derivation.at("sourceAudio"), file_identity(selected.source_audio),
                           "derived-source-audio");
  } else {
    if (case_identity.contains("derivation") || !selected.source_audio.empty() || !selected.derivation.empty())
      throw ControlledError("evidence-unexpected-derived-audio-contract");
    validate_manifest_audio(manifest, selected.case_id, selected.audio);
  }

  require_identity_match(identities.at("inputLock"), file_identity(selected.lock), "input-lock");
  require_identity_match(identities.at("executable"), file_identity(executable_path()), "executable");
  const Json actual_dlls = required_dll_identities();
  const Json& recorded_dlls = identities.at("requiredDlls");
  if (!recorded_dlls.is_array() || recorded_dlls.size() != actual_dlls.size())
    throw ControlledError("evidence-required-dll-set-invalid");
  for (const Json& actual : actual_dlls) {
    const std::string name = actual.at("fileName");
    require_identity_match(identity_named(recorded_dlls, name, "required-dll"), actual, "required-" + name);
    const Json* locked = nullptr;
    for (const Json& entry : lock.at("runtime").at("files"))
      if (entry.value("base", "") == "sdk" && fs::path(entry.value("path", "")).filename().u8string() == name)
        locked = &entry;
    if (locked == nullptr) throw ControlledError("locked-required-dll-missing:" + name);
    const Json locked_identity{{"fileName", name}, {"sizeBytes", locked->at("sizeBytes")},
                               {"sha256", locked->at("sha256")}};
    require_identity_match(actual, locked_identity, "locked-" + name);
  }
  require_identity_match(identities.at("primaryModel"), role_identity(selected.model, engine, "primary"),
                         "primary-model");
  if (engine == "qwen3-asr") {
    if (selected.aligner.empty() || identities.at("alignerModel").is_null())
      throw ControlledError("evidence-qwen-aligner-identity-missing");
    require_identity_match(identities.at("alignerModel"), role_identity(selected.aligner, engine, "aligner"),
                           "aligner-model");
  } else if (!selected.aligner.empty() || !identities.at("alignerModel").is_null()) {
    throw ControlledError("evidence-non-qwen-aligner-identity-present");
  }
  if (identities.value("pinnedCommit", "") != lock.at("crispasr").at("commit"))
    throw ControlledError("evidence-pinned-commit-mismatch");
  validate_cpu_runtime(runtime, environment);
  validate_loaded_module_identities(runtime, actual_dlls);
}

void validate_cleanup(const Json& cleanup, const bool callbacks_required) {
  const bool result_created = cleanup.at("resultCreated");
  const int result_frees = cleanup.at("resultFreeCount");
  const bool align_created = cleanup.at("alignResultCreated");
  const int align_frees = cleanup.at("alignResultFreeCount");
  const bool result_exact = result_frees == (result_created ? 1 : 0);
  const bool align_exact = align_frees == (align_created ? 1 : 0);
  const bool callback_exact = !callbacks_required || cleanup.value("callbackResetCount", -1) == 3;
  if (cleanup.value("resultExactOnce", !result_exact) != result_exact
      || cleanup.value("alignResultExactOnce", !align_exact) != align_exact
      || cleanup.value("exactOnce", false) != (result_exact && align_exact && callback_exact))
    throw ControlledError("evidence-cleanup-derived-exact-once-invalid");
}

void validate_raw_evidence_json(const Json& raw, const EvidenceSelection& selected) {
  if (raw.value("kind", "") != kRawKind || raw.value("schemaVersion", 0) != kSchemaVersion)
    throw ControlledError("evidence-envelope-invalid");
  for (const char* field : {"request", "identities", "environment", "runtime", "samples", "lifecycle", "resources"})
    if (!raw.contains(field)) throw ControlledError(std::string("failed-evidence-field-missing:") + field);
  const std::string engine = raw.at("engine");
  validate_common_identity(raw.at("identities"), raw.at("runtime"), raw.at("environment"), engine, selected);
  const Json& request = raw.at("request");
  if (request.value("engine", "") != engine || request.value("caseId", "") != selected.case_id
      || request.value("caseSource", "") != selected.case_source
      || request.value("manifestSha256", "") != selected.manifest_sha)
    throw ControlledError("evidence-request-identity-mismatch");
  const int64_t duration = read_wav(selected.audio).duration_ms;
  if (raw.at("durationMs") != duration) throw ControlledError("evidence-audio-duration-mismatch");
  for (const Json& sample : raw.at("samples")) {
    for (const char* field : {"status", "segments", "nativeFinalSegments", "sessionGetterWords",
                              "sessionGetterWordTiming", "rawAlignmentEntries", "callback", "cleanup", "timings"})
      if (!sample.contains(field)) throw ControlledError(std::string("sample-trace-missing:") + field);
    const Json& callback = sample.at("callback");
    const Json& cleanup = sample.at("cleanup");
    const bool callbacks_required = raw.at("lifecycle").value("sessionOpened", false)
      && sample.value("transcribeCall", "") != "not-reached-or-failed";
    validate_cleanup(cleanup, callbacks_required);
    if (callback.value("lateCallbackCount", -1) != 0
        || (callbacks_required && (callback.value("callbackResetCount", -1) != 3
            || callback.value("callbackContextActiveAfterReset", true))))
      throw ControlledError("evidence-callback-lifecycle-invalid");
    const Json& getter_timing = sample.at("sessionGetterWordTiming");
    if (getter_timing.value("eligibleForAcceptedTimeline", engine == "qwen3-asr") != (engine != "qwen3-asr"))
      throw ControlledError("qwen-session-getter-timing-eligibility-invalid");
    if (engine == "qwen3-asr") {
      if (sample.value("timestampProvenance", "") != "forced-aligner"
          || sample.value("alignmentGrouping", "") != "pinned-v0.8.22-upstream-segment-grouping")
        throw ControlledError("qwen-forced-aligner-contract-invalid");
      size_t expected_units = 0;
      std::vector<Segment> source_segments;
      for (const Json& item : sample.at("nativeFinalSegments")) {
        const std::string text = item.at("text");
        expected_units += upstream_alignment_unit_count(text);
        source_segments.push_back({item.at("startMs"), item.at("endMs"), text});
      }
      const size_t source_units = sample.at("alignmentUnitCount").get<size_t>();
      if (source_units != expected_units
          || (!sample.at("rawAlignmentEntries").empty() && source_units != sample.at("rawAlignmentEntries").size()))
        throw ControlledError("qwen-alignment-unit-count-mismatch");
      if (sample.at("status") == "completed") {
        std::vector<Segment> aligned;
        for (const Json& item : sample.at("rawAlignmentEntries"))
          aligned.push_back({item.at("startMs"), item.at("endMs"), item.at("text")});
        if (segments_json(group_alignment_like_upstream(source_segments, aligned)) != sample.at("segments"))
          throw ControlledError("qwen-upstream-grouping-mismatch");
      }
    }
    if (sample.at("status") == "failed") {
      if (!sample.at("segments").empty() || !sample.contains("failure")
          || sample.at("failure").value("acceptedTimedSegmentCount", -1) != 0)
        throw ControlledError("failed-evidence-has-accepted-timeline");
      continue;
    }
    std::vector<Segment> segments;
    for (const Json& item : sample.at("segments"))
      segments.push_back({item.at("startMs"), item.at("endMs"), item.at("text")});
    validate_segments(segments, duration, sample.at("timestampProvenance"), engine == "qwen3-asr");
  }
  const bool opened = raw.at("lifecycle").at("sessionOpened");
  const int close_count = raw.at("lifecycle").at("sessionCloseCount");
  const bool exact = close_count == (opened ? 1 : 0);
  if (raw.at("lifecycle").value("sessionExactOnce", !exact) != exact)
    throw ControlledError("session-lifecycle-invalid");
}

void qwen_grouping_test() {
  const std::vector<Segment> raw{{0, 0, "日"}, {0, 10, "本"}, {10, 10, "語"}};
  const std::vector<Segment> grouped = group_alignment_like_upstream({{0, 100, "日本語"}}, raw);
  if (grouped.size() != 1 || grouped[0].start_ms != 0 || grouped[0].end_ms != 10
      || upstream_alignment_units("日本語。") != std::vector<std::string>{"日", "本", "語", "。"}
      || upstream_alignment_units("。。") != std::vector<std::string>{"。", "。"}
      || upstream_alignment_units("日本abc・DEF") != std::vector<std::string>{"日", "本", "abc", "・", "DEF"}
      || upstream_alignment_units(u8"A\uF900B") != std::vector<std::string>{u8"A\uF900B"}
      || upstream_alignment_units(u8"日\u3000本") != std::vector<std::string>{"日", u8"\u3000", "本"})
    throw ControlledError("qwen-grouping-self-check-failed");
  validate_segments(grouped, 1000, "forced-aligner", true);
  std::cout << "{\"status\":\"pass\",\"checks\":\"exact-v0.8.22-qwen-tokenizer-and-segment-grouping\"}\n";
}

void self_check() {
  const fs::path root = fs::path(POC_LOCAL_ROOT) / "self-check";
  fs::remove_all(root);
  fs::create_directories(root);
  std::vector<int16_t> pcm(kSampleRate, 0);
  write_pcm_wav(root / "valid.wav", pcm);
  const WavAudio audio = read_wav(root / "valid.wav");
  if (audio.duration_ms != 1000 || audio.samples.size() != kSampleRate)
    throw ControlledError("wav-self-check-failed");
  std::ofstream(root / "bad.wav") << "bad";
  bool bad_wav = false;
  try { static_cast<void>(read_wav(root / "bad.wav")); } catch (const ControlledError&) { bad_wav = true; }
  if (!bad_wav) throw ControlledError("wav-negative-self-check-failed");
  if (!is_task_local_output(root / "result.json")
      || is_task_local_output(fs::path(POC_LOCAL_ROOT).parent_path() / "escape.json")
      || is_task_local_output(fs::path(POC_LOCAL_ROOT) / ".." / "escape.json"))
    throw ControlledError("output-containment-self-check-failed");
  qwen_grouping_test();

  std::vector<int16_t> source_pcm(kSampleRate, 7);
  std::vector<int16_t> leading_pcm(2 * kSampleRate, 0);
  leading_pcm.insert(leading_pcm.end(), source_pcm.begin(), source_pcm.end());
  std::vector<int16_t> boundary_pcm = source_pcm;
  boundary_pcm.insert(boundary_pcm.end(), kSampleRate, 0);
  boundary_pcm.insert(boundary_pcm.end(), source_pcm.begin(), source_pcm.end());
  write_pcm_wav(root / "source.wav", source_pcm);
  write_pcm_wav(root / "leading.wav", leading_pcm);
  write_pcm_wav(root / "boundary.wav", boundary_pcm);
  const WavAudio source = read_wav(root / "source.wav");
  validate_derived_audio(read_wav(root / "leading.wav"), source, "prepend-2000ms-zero-pcm16");
  validate_derived_audio(read_wav(root / "boundary.wav"), source, "concat-source-1000ms-zero-source");
  std::cout << "{\"status\":\"pass\",\"checks\":\"wav,canonical-containment,exact-v0.8.22-qwen-tokenizer,derived-audio\"}\n";
  fs::remove_all(root);
}

Json negative_identity(const Json& base, const Json& expected, const Json& observed) {
  return {{"baseEvidenceIdentity", base}, {"expectedAligner", expected}, {"observedAligner", observed}};
}

Json align_lifecycle(const bool created, const int free_count) {
  const bool exact = free_count == (created ? 1 : 0);
  if (!exact) throw ControlledError("negative-align-result-lifecycle-invalid");
  return {{"alignResultCreated", created}, {"alignResultFreeCount", free_count}, {"exactOnce", exact}};
}

void negative_matrix(const std::vector<std::string>& args) {
  const fs::path output = required_arg(args, "--output");
  require_task_local_output(output);
  const fs::path lock_path = required_arg(args, "--lock");
  const fs::path model = required_arg(args, "--model");
  const fs::path aligner = required_arg(args, "--aligner");
  const fs::path audio_path = required_arg(args, "--audio");
  const fs::path corrupt = required_arg(args, "--corrupt-aligner");
  const fs::path unloadable = required_arg(args, "--unloadable-aligner");
  const Json lock = read_json(lock_path);
  validate_runtime_lock(lock);
  validate_model_lock(lock, "qwen3-asr", model, aligner);
  const WavAudio audio = read_wav(audio_path);
  const Json base = identity_bundle(lock, lock_path, "qwen3-asr", model, aligner, audio_path,
                                    required_arg(args, "--manifest-sha256"), required_arg(args, "--case-id"),
                                    "negative-obligation");
  const Json expected = model_lock_entry(lock, "qwen3-asr", "aligner");
  Json cases = Json::array();
  Api api;
  int baseline_free = 0;
  crispasr_align_result* baseline_raw = api.align_words(aligner.u8string().c_str(), "日本語", audio.samples.data(),
    static_cast<int32_t>(audio.samples.size()), 0, 1);
  const bool baseline_created = baseline_raw != nullptr;
  AlignOwner baseline(api, baseline_raw, baseline_free);
  if (!baseline_created) throw ControlledError("negative-baseline-aligner-load-failed");
  const std::vector<Segment> baseline_entries = copy_alignment(api, baseline.get());
  baseline.release();
  const Json baseline_lifecycle = align_lifecycle(baseline_created, baseline_free);

  const auto append = [&](const std::string& name, const std::string& stage, const std::string& code,
                          const bool api_called, const Json& observed, const Json& trace,
                          const bool created, const int free_count) {
    const Json lifecycle = align_lifecycle(created, free_count);
    cases.push_back({{"case", name}, {"status", "controlled-failure"}, {"stage", stage}, {"code", code},
                     {"apiCalled", api_called}, {"acceptedTimedSegments", Json::array()},
                     {"acceptedTimedSegmentCount", 0}, {"identity", negative_identity(base, expected, observed)},
                     {"trace", trace}, {"lifecycle", lifecycle}});
  };
  append("missing", "request-identity", "aligner-required", false, file_observation({}),
         {{"requestHadAligner", false}, {"modelLoadReached", false}, {"alignmentReached", false}}, false, 0);
  append("corrupt", "identity", "aligner-hash-mismatch", false, file_observation(corrupt),
         {{"requestHadAligner", true}, {"identityMatched", false}, {"modelLoadReached", false}}, false, 0);
  {
    int free_count = 0;
    crispasr_align_result* raw = api.align_words(unloadable.u8string().c_str(), "日本語", audio.samples.data(),
      static_cast<int32_t>(audio.samples.size()), 0, 1);
    const bool created = raw != nullptr;
    AlignOwner owner(api, raw, free_count);
    if (created) throw ControlledError("unloadable-negative-unexpected-success");
    owner.release();
    append("unloadable", "public-C-ABI-model-load", "aligner-model-load-failed", true,
           file_observation(unloadable), {{"requestHadAligner", true}, {"fixtureIdentityMatched", true},
                                          {"modelLoadReached", true}, {"alignmentResult", "null"}}, created, free_count);
  }
  {
    int free_count = 0;
    crispasr_align_result* raw = api.align_words(aligner.u8string().c_str(), "", audio.samples.data(),
      static_cast<int32_t>(audio.samples.size()), 0, 1);
    const bool created = raw != nullptr;
    AlignOwner owner(api, raw, free_count);
    if (created) throw ControlledError("empty-negative-unexpected-success");
    owner.release();
    append("empty-transcript", "public-C-ABI-request", "aligner-empty-transcript", true,
           file_observation(aligner), {{"baselineModelLoadSucceeded", true}, {"transcriptBytes", 0},
                                      {"alignmentResult", "null"}}, created, free_count);
  }
  {
    int free_count = 0;
    crispasr_align_result* raw = api.align_words(aligner.u8string().c_str(), "日本語", audio.samples.data(),
      static_cast<int32_t>(audio.samples.size()), 0, 1);
    const bool created = raw != nullptr;
    AlignOwner owner(api, raw, free_count);
    if (!created) throw ControlledError("malformed-negative-alignment-failed");
    const std::vector<Segment> aligned = copy_alignment(api, owner.get());
    owner.release();
    const std::vector<Segment> grouped = group_alignment_like_upstream({{0, 0, ""}}, aligned);
    if (!grouped.empty()) throw ControlledError("malformed-negative-unexpected-segments");
    append("malformed-segment-map", "post-alignment-grouping", "segment-map-empty", true,
           file_observation(aligner), {{"baselineModelLoadSucceeded", true}, {"rawAlignmentEntryCount", aligned.size()},
                                      {"sourceSegmentCount", 1}, {"sourceNonEmptySegmentCount", 0}}, created, free_count);
  }
  {
    int free_count = 0;
    crispasr_align_result* raw = api.align_words(aligner.u8string().c_str(), "日本語", audio.samples.data(), 0, 0, 1);
    const bool created = raw != nullptr;
    AlignOwner owner(api, raw, free_count);
    if (created) throw ControlledError("invalid-audio-negative-unexpected-success");
    owner.release();
    append("invalid-audio", "public-C-ABI-request", "aligner-invalid-audio", true,
           file_observation(aligner), {{"baselineModelLoadSucceeded", true}, {"nSamples", 0},
                                      {"alignmentResult", "null"}}, created, free_count);
  }
  const int threads = static_cast<int>(std::max(1u, std::thread::hardware_concurrency()));
  Json evidence{{"schemaVersion", kSchemaVersion}, {"kind", "hikaru-crispasr-aligner-negative-matrix"},
                {"status", "completed"}, {"identities", base},
                {"baseline", {{"modelLoadAndAlignmentSucceeded", true},
                                {"rawAlignmentEntryCount", baseline_entries.size()},
                                {"lifecycle", baseline_lifecycle}}},
                {"environment", native_environment()}, {"runtime", {{"loadedLocalModules", loaded_local_modules()},
                  {"openParams", {{"abiVersion", 2}, {"nThreads", threads}, {"useGpu", 0},
                                   {"flashAttn", 0}, {"nGpuLayers", 0}}}}},
                {"cases", cases}};
  write_json(output, evidence);
  std::cout << Json{{"status", "completed"}, {"caseCount", cases.size()}}.dump() << '\n';
}

void validate_negative_evidence_json(const Json& evidence, const EvidenceSelection& selected) {
  if (evidence.value("kind", "") != "hikaru-crispasr-aligner-negative-matrix"
      || evidence.value("schemaVersion", 0) != kSchemaVersion || evidence.value("status", "") != "completed")
    throw ControlledError("negative-evidence-envelope-invalid");
  validate_common_identity(evidence.at("identities"), evidence.at("runtime"), evidence.at("environment"),
                           "qwen3-asr", selected);
  const Json lock = read_json(selected.lock);
  const Json& locked_aligner = model_lock_entry(lock, "qwen3-asr", "aligner");
  const Json& baseline = evidence.at("baseline");
  if (!baseline.value("modelLoadAndAlignmentSucceeded", false)
      || baseline.value("rawAlignmentEntryCount", 0) <= 0)
    throw ControlledError("negative-baseline-invalid");
  const Json& baseline_lifecycle = baseline.at("lifecycle");
  const bool baseline_created = baseline_lifecycle.at("alignResultCreated");
  const int baseline_free = baseline_lifecycle.at("alignResultFreeCount");
  if (baseline_lifecycle.value("exactOnce", false) != (baseline_free == (baseline_created ? 1 : 0))
      || !baseline_created || baseline_free != 1)
    throw ControlledError("negative-baseline-lifecycle-invalid");
  const Json& cases = evidence.at("cases");
  if (!cases.is_array() || cases.size() != 6)
    throw ControlledError("negative-case-set-invalid");
  for (const Json& item : cases) {
    if (item.value("status", "") != "controlled-failure"
        || item.value("acceptedTimedSegmentCount", -1) != 0 || !item.at("acceptedTimedSegments").empty())
      throw ControlledError("negative-case-accepted-output-invalid");
    const Json& lifecycle = item.at("lifecycle");
    const bool created = lifecycle.at("alignResultCreated");
    const int free_count = lifecycle.at("alignResultFreeCount");
    if (lifecycle.value("exactOnce", false) != (free_count == (created ? 1 : 0)))
      throw ControlledError("negative-case-lifecycle-invalid");
    const Json& identity = item.at("identity");
    if (identity.at("baseEvidenceIdentity") != evidence.at("identities"))
      throw ControlledError("negative-case-base-identity-mismatch");
    require_identity_match(identity.at("expectedAligner"), locked_aligner, "negative-expected-aligner");
    const std::string name = item.at("case");
    const bool expected_created = name == "malformed-segment-map";
    if (created != expected_created || free_count != (expected_created ? 1 : 0))
      throw ControlledError("negative-case-created-free-count-invalid");
    const Json& observed = identity.at("observedAligner");
    if (name == "missing") {
      if (observed.value("state", "") != "not-supplied" || created || free_count != 0)
        throw ControlledError("negative-missing-condition-invalid");
    } else if (name == "corrupt") {
      if (selected.corrupt_aligner.empty()) throw ControlledError("selected-corrupt-aligner-missing");
      require_identity_match(observed, file_observation(selected.corrupt_aligner), "negative-corrupt-aligner");
    } else if (name == "unloadable") {
      if (selected.unloadable_aligner.empty()) throw ControlledError("selected-unloadable-aligner-missing");
      require_identity_match(observed, file_observation(selected.unloadable_aligner), "negative-unloadable-aligner");
    } else if (name == "empty-transcript" || name == "malformed-segment-map" || name == "invalid-audio") {
      require_identity_match(observed, file_observation(selected.aligner), "negative-selected-aligner");
    } else {
      throw ControlledError("negative-case-name-invalid");
    }
  }
}

void validate_evidence(const std::vector<std::string>& args) {
  const EvidenceSelection selected = evidence_selection(args);
  const Json evidence = read_json(selected.evidence);
  const std::string kind = evidence.value("kind", "");
  if (kind == kRawKind) validate_raw_evidence_json(evidence, selected);
  else if (kind == "hikaru-crispasr-aligner-negative-matrix") validate_negative_evidence_json(evidence, selected);
  else throw ControlledError("evidence-kind-unsupported");
  std::cout << Json{{"status", "valid"}, {"kind", kind}, {"evidenceStatus", evidence.at("status")}}.dump() << '\n';
}

}  // namespace

int main(int argc, char** argv) {
  try {
    const std::vector<std::string> args(argv + 1, argv + argc);
    if (args.empty()) throw ControlledError("mode-required");
    if (std::find(args.begin(), args.end(), "--self-check") != args.end()) self_check();
    else if (std::find(args.begin(), args.end(), "--qwen-grouping-test") != args.end()) qwen_grouping_test();
    else if (std::find(args.begin(), args.end(), "--abi-probe") != args.end()) abi_probe();
    else if (std::find(args.begin(), args.end(), "--invalid-model-test") != args.end()) invalid_model_test();
    else if (std::find(args.begin(), args.end(), "--contract-test") != args.end()) contract_test(args);
    else if (std::find(args.begin(), args.end(), "--run") != args.end()) run_model(args);
    else if (std::find(args.begin(), args.end(), "--negative-matrix") != args.end()) negative_matrix(args);
    else if (std::find(args.begin(), args.end(), "--validate-evidence") != args.end())
      validate_evidence(args);
    else throw ControlledError("unknown-mode");
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "controlled failure: " << error.what() << '\n';
    std::cout << Json{{"status", "failed"}, {"code", "controlled-error"}, {"detail", error.what()}}.dump() << '\n';
    return 2;
  }
}
