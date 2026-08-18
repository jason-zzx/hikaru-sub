#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <initializer_list>
#include <limits>
#include <string>
#include <vector>

namespace {

struct FakeCounters {
  int sessions_opened = 0;
  int sessions_closed = 0;
  int results_created = 0;
  int results_freed = 0;
  int alignments_created = 0;
  int alignments_freed = 0;
  int progress_registered = 0;
  int progress_reset = 0;
  int segment_registered = 0;
  int segment_reset = 0;
  int callback_failures = 0;
  int cleanup_order = 0;
  int callback_reset_order = 0;
  int result_free_order = 0;
  int transcribe_calls = 0;
  int last_sample_count = 0;
  int vad_calls = 0;
  int vad_frees = 0;
  int vad_threshold_milli = 0;
  int vad_min_speech_ms = 0;
  int vad_min_silence_ms = 0;
  int vad_speech_pad_ms = 0;
  int vad_max_chunk_ms = 0;
  int vad_threads = 0;
  int strategy_valid_calls = 0;
  int strategy_invalid_calls = 0;
};

bool reazon_strategy_valid() {
  char threshold[16]{};
  char unified[16]{};
  if (GetEnvironmentVariableA(
          "CRISPASR_PARAKEET_STREAM_THRESHOLD", threshold, sizeof(threshold)) == 0
      || std::strcmp(threshold, "13") != 0
      || GetEnvironmentVariableA(
             "CRISPASR_SESSION_UNIFIED_DISPATCH", unified, sizeof(unified)) == 0
      || std::strcmp(unified, "0") != 0) {
    return false;
  }
  LPCH environment = GetEnvironmentStringsA();
  if (!environment) return false;
  bool valid = true;
  for (const char* cursor = environment; *cursor != '\0';) {
    const std::string entry(cursor);
    cursor += entry.size() + 1;
    constexpr char prefix[] = "CRISPASR_PARAKEET_";
    const std::size_t separator = entry.find('=');
    if (_strnicmp(entry.c_str(), prefix, sizeof(prefix) - 1) == 0
        && (separator == std::string::npos
            || _stricmp(
                   entry.substr(0, separator).c_str(),
                   "CRISPASR_PARAKEET_STREAM_THRESHOLD") != 0)) {
      valid = false;
      break;
    }
  }
  FreeEnvironmentStringsA(environment);
  return valid;
}

std::string vad_scenario() {
  char value[64]{};
  return GetEnvironmentVariableA(
             "HIKARU_FAKE_CRISPASR_VAD_SCENARIO", value, sizeof(value)) > 0
      ? value
      : "success";
}

FakeCounters counters;

}  // namespace

extern "C" {

struct crispasr_open_params_v1 {
  int abi_version;
  int n_threads;
  int use_gpu;
  int verbosity;
  int flash_attn;
  int n_gpu_layers;
  int reserved[6];
};

struct FakeSegment {
  std::string text;
  std::int64_t t0;
  std::int64_t t1;
};

struct crispasr_session {
  std::string model;
  std::string backend;
  void (*progress)(int, int, void*) = nullptr;
  void* progress_data = nullptr;
  void (*segment)(const char*, std::int64_t, std::int64_t, int, void*) = nullptr;
  void* segment_data = nullptr;
};

struct crispasr_session_result {
  std::vector<FakeSegment> segments;
  std::vector<FakeSegment> words;
};

struct crispasr_align_result {
  std::vector<FakeSegment> words;
};

__declspec(dllexport) int crispasr_session_available_backends(char* output, int capacity) {
  const char* value = "parakeet,qwen3";
  if (capacity <= static_cast<int>(std::strlen(value))) return -1;
  std::memcpy(output, value, std::strlen(value) + 1);
  return static_cast<int>(std::strlen(value));
}

__declspec(dllexport) void crispasr_set_gpu_backend(const char*) {}

__declspec(dllexport) crispasr_session* crispasr_session_open_with_params(
    const char* model,
    const char* backend,
    const crispasr_open_params_v1*) {
  if (!model || !backend || std::strstr(model, "open-null")) return nullptr;
  ++counters.sessions_opened;
  return new crispasr_session{model, backend};
}

__declspec(dllexport) const char* crispasr_session_backend(crispasr_session* session) {
  if (!session) return nullptr;
  if (session->model.find("backend-mismatch") != std::string::npos) return "qwen3";
  return session->backend.c_str();
}

__declspec(dllexport) void crispasr_session_set_progress_callback(
    crispasr_session* session,
    void (*callback)(int, int, void*),
    void* data) {
  if (!session) return;
  if (callback) {
    ++counters.progress_registered;
  } else {
    ++counters.progress_reset;
    if (counters.callback_reset_order == 0) counters.callback_reset_order = ++counters.cleanup_order;
  }
  session->progress = callback;
  session->progress_data = data;
}

__declspec(dllexport) void crispasr_session_set_segment_callback(
    crispasr_session* session,
    void (*callback)(const char*, std::int64_t, std::int64_t, int, void*),
    void* data) {
  if (!session) return;
  if (callback) {
    ++counters.segment_registered;
  } else {
    ++counters.segment_reset;
    if (counters.callback_reset_order == 0) counters.callback_reset_order = ++counters.cleanup_order;
  }
  session->segment = callback;
  session->segment_data = data;
}

__declspec(dllexport) crispasr_session_result* crispasr_session_transcribe_lang(
    crispasr_session* session,
    const float*,
    int sample_count,
    const char*) {
  if (!session || sample_count <= 0) return nullptr;
  ++counters.transcribe_calls;
  counters.last_sample_count = sample_count;
  if (session->model.find("reazon") != std::string::npos) {
    if (reazon_strategy_valid()) {
      ++counters.strategy_valid_calls;
    } else {
      ++counters.strategy_invalid_calls;
      return nullptr;
    }
  }
  if (session->model.find("transcribe-null") != std::string::npos
      || (session->model.find("second-null") != std::string::npos
          && counters.transcribe_calls == 2)) {
    return nullptr;
  }
  if (session->progress) {
    session->progress(
        session->model.find("callback-failure") != std::string::npos ? -1 : 8000,
        sample_count,
        session->progress_data);
    session->progress(4000, sample_count, session->progress_data);
    session->progress(sample_count, sample_count, session->progress_data);
  }
  const std::int64_t duration_cs = sample_count / 160;
  const std::int64_t preview_end_cs = std::min<std::int64_t>(50, duration_cs);
  const std::int64_t final_end_cs = std::min<std::int64_t>(60, duration_cs);
  const std::int64_t word_end_cs = std::min<std::int64_t>(10, duration_cs);
  if (session->segment && session->backend != "qwen3"
      && session->model.find("callback-failure") == std::string::npos) {
    session->segment("preview", 0, preview_end_cs, 0, session->segment_data);
  }
  auto* result = new crispasr_session_result;
  ++counters.results_created;
  if (session->model.find("policy-empty") != std::string::npos) {
    // Leave the copied result empty so the worker policy fails after ready.
  } else if (session->model.find("zero-duration-result") != std::string::npos) {
    result->segments.push_back({"zero", 216, 216});
    result->words.push_back({"zero", 216, 216});
  } else if (session->model.find("invalid-result") != std::string::npos) {
    result->segments.push_back({"invalid", 20, 10});
    result->words.push_back({"invalid", 0, word_end_cs});
  } else if (session->backend == "qwen3") {
    result->segments.push_back({"qwen-source", -1, -1});
    result->words.push_back({"qwen-source", -1, -1});
  } else if (session->model.find("protocol-invalid-text") != std::string::npos) {
    const std::string text(1, '\x01');
    result->segments.push_back({text, 0, final_end_cs});
    result->words.push_back({text, 0, word_end_cs});
  } else if (session->model.find("oversized-text") != std::string::npos) {
    const std::string text(17'000, 'x');
    result->segments.push_back({text, 0, final_end_cs});
    result->words.push_back({text, 0, word_end_cs});
  } else if (session->model.find("same-preview") != std::string::npos) {
    result->segments.push_back({"preview", 0, preview_end_cs});
    result->words.push_back({"preview", 0, word_end_cs});
  } else {
    result->segments.push_back({"final", 0, final_end_cs});
    result->words.push_back({"final", 0, word_end_cs});
  }
  return result;
}

__declspec(dllexport) int crispasr_vad_slices(
    const char*,
    const float*,
    int sample_count,
    int sample_rate,
    float threshold,
    int min_speech_ms,
    int min_silence_ms,
    int speech_pad_ms,
    float max_chunk_duration_s,
    int threads,
    float** out_spans) {
  ++counters.vad_calls;
  counters.vad_threshold_milli = static_cast<int>(threshold * 1000.0f);
  counters.vad_min_speech_ms = min_speech_ms;
  counters.vad_min_silence_ms = min_silence_ms;
  counters.vad_speech_pad_ms = speech_pad_ms;
  counters.vad_max_chunk_ms = static_cast<int>(max_chunk_duration_s * 1000.0f);
  counters.vad_threads = threads;
  if (!out_spans || sample_count <= 0 || sample_rate <= 0) return -1;
  *out_spans = nullptr;
  const std::string scenario = vad_scenario();
  if (scenario == "empty" || scenario == "no-speech-like"
      || scenario == "internal-failure-like") return 0;
  if (scenario == "error") return -1;
  auto allocate = [&](std::initializer_list<float> values) {
    *out_spans = static_cast<float*>(std::malloc(values.size() * sizeof(float)));
    if (!*out_spans) return false;
    std::copy(values.begin(), values.end(), *out_spans);
    return true;
  };
  if (scenario == "error-with-spans") {
    if (!allocate({0.0f, 1.0f})) return -2;
    return -2;
  }
  if (scenario == "nonfinite") {
    if (!allocate({0.0f, std::numeric_limits<float>::infinity()})) return -2;
    return 1;
  }
  if (scenario == "negative") {
    if (!allocate({-0.1f, 1.0f})) return -2;
    return 1;
  }
  if (scenario == "reversed") {
    if (!allocate({1.0f, 0.5f})) return -2;
    return 1;
  }
  if (scenario == "outside") {
    if (!allocate({0.0f, static_cast<float>(sample_count) / sample_rate + 1.0f})) return -2;
    return 1;
  }
  if (scenario == "unordered") {
    if (!allocate({1.0f, 2.0f, 0.5f, 3.0f})) return -2;
    return 2;
  }
  if (scenario == "long-float-boundary") {
    if (!allocate({510.9700012207031f, 522.9300537109375f,
                   522.8699951171875f, 533.6300048828125f})) return -2;
    return 2;
  }
  if (scenario == "long-float-overlap61") {
    if (!allocate({510.9700012207031f, 522.9306030273438f,
                   522.8699951171875f, 533.6300048828125f})) return -2;
    return 2;
  }
  if (scenario == "long-float-too-long") {
    if (!allocate({510.8695983886719f, 522.9306030273438f})) return -2;
    return 1;
  }
  if (scenario == "overlap61") {
    if (!allocate({0.0f, 2.0f, 1.939f, 3.0f})) return -2;
    return 2;
  }
  if (scenario == "nonadjacent") {
    if (!allocate({0.0f, 10.0f, 9.94f, 10.01f, 9.99f, 10.02f})) return -2;
    return 3;
  }
  if (scenario == "too-long") {
    if (!allocate({0.0f, 12.061f})) return -2;
    return 1;
  }
  if (scenario == "energy-split") {
    const float duration = static_cast<float>(sample_count) / sample_rate;
    if (!allocate({0.0f, 11.87f, 11.81f, duration})) return -2;
    return 2;
  }
  const float duration = static_cast<float>(sample_count) / sample_rate;
  if (duration <= 12.06f) {
    if (!allocate({0.0f, duration})) return -2;
    return 1;
  }
  if (!allocate({0.0f, 12.06f, 12.0f, duration})) return -2;
  return 2;
}

__declspec(dllexport) void crispasr_vad_free(float* spans) {
  if (spans) ++counters.vad_frees;
  std::free(spans);
}

__declspec(dllexport) int crispasr_session_result_n_segments(crispasr_session_result* result) {
  return result ? static_cast<int>(result->segments.size()) : 0;
}

__declspec(dllexport) const char* crispasr_session_result_segment_text(crispasr_session_result* result, int index) {
  return result && index >= 0 && index < static_cast<int>(result->segments.size())
      ? result->segments[index].text.c_str() : nullptr;
}

__declspec(dllexport) std::int64_t crispasr_session_result_segment_t0(crispasr_session_result* result, int index) {
  return result && index >= 0 && index < static_cast<int>(result->segments.size())
      ? result->segments[index].t0 : -1;
}

__declspec(dllexport) std::int64_t crispasr_session_result_segment_t1(crispasr_session_result* result, int index) {
  return result && index >= 0 && index < static_cast<int>(result->segments.size())
      ? result->segments[index].t1 : -1;
}

__declspec(dllexport) int crispasr_session_result_n_words(crispasr_session_result* result, int) {
  return result ? static_cast<int>(result->words.size()) : 0;
}
__declspec(dllexport) const char* crispasr_session_result_word_text(
    crispasr_session_result* result, int, int index) {
  return result && index >= 0 && index < static_cast<int>(result->words.size())
      ? result->words[index].text.c_str() : nullptr;
}
__declspec(dllexport) std::int64_t crispasr_session_result_word_t0(
    crispasr_session_result* result, int, int index) {
  return result && index >= 0 && index < static_cast<int>(result->words.size())
      ? result->words[index].t0 : -1;
}
__declspec(dllexport) std::int64_t crispasr_session_result_word_t1(
    crispasr_session_result* result, int, int index) {
  return result && index >= 0 && index < static_cast<int>(result->words.size())
      ? result->words[index].t1 : -1;
}
__declspec(dllexport) void crispasr_session_result_free(crispasr_session_result* result) {
  if (result) {
    ++counters.results_freed;
    counters.result_free_order = ++counters.cleanup_order;
  }
  delete result;
}

#ifndef HIKARU_ASR_FAKE_CRISPASR_BROKEN
__declspec(dllexport) crispasr_align_result* crispasr_align_words_abi(
    const char* aligner,
    const char*,
    const float*,
    int32_t sample_count,
    std::int64_t,
    int32_t) {
  if (!aligner || sample_count <= 0 || std::strstr(aligner, "align-null")) return nullptr;
  auto* result = new crispasr_align_result;
  ++counters.alignments_created;
  if (std::strstr(aligner, "invalid-align")) {
    result->words.push_back({"x", 10, 5});
  } else if (std::strstr(aligner, "tail-unbounded")) {
    result->words.push_back({"tail", 100, 10000});
  } else {
    result->words.push_back({"q", 0, 0});
    result->words.push_back({"w", 0, 100});
  }
  return result;
}
#else
__declspec(dllexport) crispasr_align_result* crispasr_align_words_broken(
    const char*, const char*, const float*, int32_t, std::int64_t, int32_t) { return nullptr; }
#endif

__declspec(dllexport) int crispasr_align_result_n_words(crispasr_align_result* result) {
  return result ? static_cast<int>(result->words.size()) : 0;
}
__declspec(dllexport) const char* crispasr_align_result_word_text(crispasr_align_result* result, int index) {
  return result && index >= 0 && index < static_cast<int>(result->words.size())
      ? result->words[index].text.c_str() : nullptr;
}
__declspec(dllexport) std::int64_t crispasr_align_result_word_t0(crispasr_align_result* result, int index) {
  return result && index >= 0 && index < static_cast<int>(result->words.size())
      ? result->words[index].t0 : -1;
}
__declspec(dllexport) std::int64_t crispasr_align_result_word_t1(crispasr_align_result* result, int index) {
  return result && index >= 0 && index < static_cast<int>(result->words.size())
      ? result->words[index].t1 : -1;
}
__declspec(dllexport) void crispasr_align_result_free(crispasr_align_result* result) {
  if (result) ++counters.alignments_freed;
  delete result;
}
__declspec(dllexport) void crispasr_session_close(crispasr_session* session) {
  if (session) ++counters.sessions_closed;
  delete session;
}

__declspec(dllexport) void hikaru_fake_crispasr_reset_counters() {
  counters = {};
}

__declspec(dllexport) int hikaru_fake_crispasr_counter(int index) {
  switch (index) {
    case 0: return counters.sessions_opened;
    case 1: return counters.sessions_closed;
    case 2: return counters.results_created;
    case 3: return counters.results_freed;
    case 4: return counters.alignments_created;
    case 5: return counters.alignments_freed;
    case 6: return counters.progress_registered;
    case 7: return counters.progress_reset;
    case 8: return counters.segment_registered;
    case 9: return counters.segment_reset;
    case 10: return counters.callback_reset_order;
    case 11: return counters.result_free_order;
    case 12: return counters.transcribe_calls;
    case 13: return counters.last_sample_count;
    case 14: return counters.vad_calls;
    case 15: return counters.vad_frees;
    case 16: return counters.vad_threshold_milli;
    case 17: return counters.vad_min_speech_ms;
    case 18: return counters.vad_min_silence_ms;
    case 19: return counters.vad_speech_pad_ms;
    case 20: return counters.vad_max_chunk_ms;
    case 21: return counters.vad_threads;
    case 22: return counters.strategy_valid_calls;
    case 23: return counters.strategy_invalid_calls;
    default: return -1;
  }
}

}  // extern "C"
