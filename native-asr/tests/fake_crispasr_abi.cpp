#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
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
};

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
  if (!session || sample_count <= 0 || session->model.find("transcribe-null") != std::string::npos) return nullptr;
  if (session->progress) {
    session->progress(
        session->model.find("callback-failure") != std::string::npos ? -1 : 8000,
        sample_count,
        session->progress_data);
    session->progress(4000, sample_count, session->progress_data);
    session->progress(sample_count, sample_count, session->progress_data);
  }
  if (session->segment && session->backend != "qwen3"
      && session->model.find("callback-failure") == std::string::npos) {
    session->segment("preview", 0, 50, 0, session->segment_data);
  }
  auto* result = new crispasr_session_result;
  ++counters.results_created;
  if (session->model.find("invalid-result") != std::string::npos) {
    result->segments.push_back({"invalid", 20, 10});
  } else if (session->backend == "qwen3") {
    result->segments.push_back({"qwen-source", -1, -1});
  } else if (session->model.find("same-preview") != std::string::npos) {
    result->segments.push_back({"preview", 0, 50});
  } else {
    result->segments.push_back({"final", 0, 60});
  }
  return result;
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

__declspec(dllexport) int crispasr_session_result_n_words(crispasr_session_result*, int) { return 1; }
__declspec(dllexport) const char* crispasr_session_result_word_text(crispasr_session_result*, int, int) { return "word"; }
__declspec(dllexport) std::int64_t crispasr_session_result_word_t0(crispasr_session_result* result, int, int) {
  return result && !result->segments.empty() && result->segments[0].text == "qwen-source" ? -1 : 0;
}
__declspec(dllexport) std::int64_t crispasr_session_result_word_t1(crispasr_session_result* result, int, int) {
  return result && !result->segments.empty() && result->segments[0].text == "qwen-source" ? -1 : 10;
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
    default: return -1;
  }
}

}  // extern "C"
