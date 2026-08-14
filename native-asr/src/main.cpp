#include "ctranslate2_whisper.hpp"
#ifdef HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT
#include "crispasr_backend.hpp"
#include "parakeet_family_policy.hpp"
#endif

#include <hikaru_asr/protocol.hpp>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <iostream>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#ifdef _WIN32
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#endif

namespace {

using namespace hikaru_asr;
namespace fs = std::filesystem;

EventV1 error_event(std::string code, std::string message) {
  EventV1 event;
  event.type = EventType::Error;
  event.code = std::move(code);
  event.message = std::move(message);
  return event;
}

class Emitter {
 public:
  explicit Emitter(const WorkerRequestV1& request)
      : state_(make_event_sequence_state(request)) {}

  bool emit(const EventV1& event) {
    ProtocolError error;
    std::string line;
    if (!validate_event(state_, event, error) || !serialize_event(event, line, error)) {
      std::cerr << "worker_internal_error:" << error.code << '\n';
      return false;
    }
    std::cout << line << '\n' << std::flush;
    return true;
  }

 private:
  EventSequenceState state_;
};

void emit_pre_ready_error(std::string code, std::string message) {
  ProtocolError error;
  std::string line;
  const EventV1 event = error_event(std::move(code), std::move(message));
  if (serialize_event(event, line, error)) {
    std::cout << line << '\n' << std::flush;
  }
}

bool read_request(WorkerRequestV1& request) {
  ProtocolError error;
  std::string line;
  bool eof = false;
  if (!read_bounded_line(std::cin, limits::max_request_line_bytes, line, eof, error)) {
    emit_pre_ready_error("request_line_too_large", "request line exceeds the protocol limit");
    return false;
  }
  if (eof) {
    emit_pre_ready_error("missing_request", "stdin closed before the request line");
    return false;
  }
  if (!parse_request_line(line, request, error)) {
    emit_pre_ready_error(
        error.code.empty() ? "invalid_request" : error.code,
        error.message.empty() ? "request was rejected" : error.message);
    return false;
  }

  std::string extra;
  if (!read_bounded_line(std::cin, limits::max_request_line_bytes, extra, eof, error) || !eof) {
    emit_pre_ready_error("request_extra_line", "stdin must contain exactly one request line");
    return false;
  }
  return true;
}

fs::path ctranslate2_compatible_path(const fs::path& path) {
  std::string value = path.u8string();
  if (value.rfind(R"(\\?\UNC\)", 0) == 0) {
    value = R"(\\)" + value.substr(8);
  } else if (value.rfind(R"(\\?\)", 0) == 0) {
    value.erase(0, 4);
  }
  return fs::u8path(value);
}

fs::path current_executable_directory() {
  std::vector<wchar_t> buffer(32768);
  const DWORD length = GetModuleFileNameW(
      nullptr,
      buffer.data(),
      static_cast<DWORD>(buffer.size()));
  if (length == 0 || length >= buffer.size()) {
    throw whisper::BackendError("worker_runtime_failed", "Worker executable path is unavailable");
  }
  return fs::path(std::wstring(buffer.data(), length)).parent_path();
}

void validate_candidate_b_config(const WorkerRequestV1& request) {
  if (!request.use_vad || !request.vad_config) {
    return;
  }
  const VadConfig& config = *request.vad_config;
  const bool mismatch =
      (config.threshold && std::abs(*config.threshold - whisper::vad_threshold) > 1e-9)
      || (config.min_speech_duration_ms && *config.min_speech_duration_ms != 0)
      || (config.min_silence_duration_ms
          && *config.min_silence_duration_ms != whisper::vad_min_silence_ms)
      || (config.speech_pad_ms && *config.speech_pad_ms != whisper::vad_speech_pad_ms)
      || config.max_segment_duration_ms.has_value();
  if (mismatch) {
    throw whisper::BackendError(
        "vad_config_identity_mismatch",
        "Candidate B accepts only the frozen ordinary faster-whisper VAD defaults");
  }
}

std::optional<fs::path> request_model_path(const WorkerRequestV1& request, ModelRole role) {
  for (const ModelPath& model : request.model_paths) {
    if (model.role == role) return ctranslate2_compatible_path(fs::u8path(model.path));
  }
  return std::nullopt;
}

fs::path model_path(const WorkerRequestV1& request) {
  for (const ModelPath& model : request.model_paths) {
    if (model.role == ModelRole::Model) {
      // CTranslate2 4.8.0 does not open the host's canonical \\?\ path string.
      return ctranslate2_compatible_path(fs::u8path(model.path));
    }
  }
  throw whisper::BackendError("missing_model_role", "model role is required");
}

int run_ctranslate2(const WorkerRequestV1& request) {
  const bool ordinary = request.engine == Engine::FasterWhisper;
  const bool kotoba = request.engine == Engine::KotobaFasterWhisper;
  if ((!ordinary && !kotoba) || request.backend != Backend::CTranslate2) {
    emit_pre_ready_error(
        "route_not_implemented",
        "requested native ASR route is not implemented by this worker");
    return 2;
  }
  if (request.device == Device::Vulkan) {
    emit_pre_ready_error(
        "device_not_implemented",
        "this CTranslate2 worker does not implement Vulkan");
    return 2;
  }
  try {
    if (kotoba && request.use_vad) {
      throw whisper::BackendError(
          "kotoba_vad_not_qualified",
          "Native Kotoba VAD is not qualified");
    }
    if (ordinary) {
      validate_candidate_b_config(request);
    }
    const fs::path audio = fs::u8path(request.audio_path);
    const fs::path model = model_path(request);
    whisper::validate_model_directory(model, kotoba);
    const std::int64_t duration_ms = whisper::verified_wav_duration_ms(audio);
    const std::optional<fs::path> vad_model = ordinary && request.use_vad
        ? std::optional<fs::path>(
              current_executable_directory() / "silero_vad_v6.onnx")
        : std::nullopt;
    const whisper::BackendExecutionConfig execution = request.device == Device::Cuda
        ? whisper::cuda_execution_config()
        : whisper::cpu_execution_config();
    const whisper::CandidateAConfig config = kotoba
        ? whisper::kotoba_k2_config()
        : whisper::CandidateAConfig{};
    whisper::CTranslate2WhisperBackend backend(
        model,
        config,
        vad_model,
        execution,
        kotoba);
    Emitter emitter(request);

    EventV1 ready;
    ready.type = EventType::Ready;
    ready.backend = Backend::CTranslate2;
    ready.device = request.device;
    ready.duration_ms = duration_ms;
    if (!emitter.emit(ready)) {
      return 74;
    }

    const whisper::TranscriptionResult result = backend.transcribe(
        audio,
        [&](std::int64_t processed_ms) {
          EventV1 progress;
          progress.type = EventType::Progress;
          progress.processed_ms = processed_ms;
          progress.duration_ms = duration_ms;
          if (!emitter.emit(progress)) {
            throw whisper::BackendError("protocol_emit_failed", "progress event could not be emitted");
          }
        },
        [&](const Segment& segment) {
          EventV1 event;
          event.type = EventType::Segment;
          event.segment = segment;
          if (!emitter.emit(event)) {
            throw whisper::BackendError("protocol_emit_failed", "segment event could not be emitted");
          }
        });

    if (!result.failure_code.empty()) {
      if (!emitter.emit(error_event(
              result.failure_code,
              request.use_vad
                  ? "Candidate B failed closed"
                  : "CTranslate2 generated an invalid timestamp sequence"))) {
        return 74;
      }
      return 20;
    }

    EventV1 completed;
    completed.type = EventType::Completed;
    completed.duration_ms = duration_ms;
    completed.detected_language = "ja";
    if (!emitter.emit(completed)) {
      return 74;
    }
    return 0;
  } catch (const whisper::BackendError& error) {
    emit_pre_ready_error(error.code(), error.what());
    return 20;
  } catch (const std::exception&) {
    emit_pre_ready_error("model_runtime_failed", "native ASR runtime failed");
    return 20;
  }
}

#ifdef HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT
int run_crispasr(const WorkerRequestV1& request) {
  if (request.backend != Backend::CrispAsr
      || (request.engine != Engine::Parakeet
          && request.engine != Engine::ReazonSpeechNemo
          && request.engine != Engine::Qwen3Asr)) {
    emit_pre_ready_error("route_not_implemented", "requested CrispASR route is not implemented");
    return 2;
  }
  if (request.use_vad) {
    emit_pre_ready_error("crispasr_vad_not_implemented", "T09 does not implement CrispASR VAD");
    return 2;
  }
  if (request.device == Device::Vulkan) {
    emit_pre_ready_error("device_not_implemented", "T09 does not implement CrispASR Vulkan");
    return 2;
  }
  std::unique_ptr<crisp::CrispAsrBackend> backend;
  try {
    const auto model = request_model_path(request, ModelRole::Model);
    const auto aligner = request_model_path(request, ModelRole::Aligner);
    if (!model) throw crisp::BackendError("missing_model_role", "model role is required");
    backend = std::make_unique<crisp::CrispAsrBackend>(crisp::BackendConfig{
        request.engine,
        request.device,
        ctranslate2_compatible_path(fs::u8path(request.audio_path)),
        *model,
        aligner,
        current_executable_directory() / "crispasr.dll"});
  } catch (const crisp::BackendError& error) {
    emit_pre_ready_error(error.code(), error.what());
    return 20;
  } catch (const std::exception&) {
    emit_pre_ready_error("crispasr_runtime_failed", "CrispASR runtime failed");
    return 20;
  }

  const std::int64_t duration_ms = backend->duration_ms();
  Emitter emitter(request);
  EventV1 ready;
  ready.type = EventType::Ready;
  ready.backend = Backend::CrispAsr;
  ready.device = request.device;
  ready.duration_ms = duration_ms;
  if (!emitter.emit(ready)) return 74;

  const auto emit_progress = [&](std::int64_t processed_ms) {
    EventV1 progress;
    progress.type = EventType::Progress;
    progress.processed_ms = processed_ms;
    progress.duration_ms = duration_ms;
    if (!emitter.emit(progress)) {
      throw crisp::BackendError("protocol_emit_failed", "progress event could not be emitted");
    }
  };

  try {
    if (request.engine == Engine::Qwen3Asr) {
      backend->transcribe(emit_progress);
      if (!emitter.emit(error_event(
              "qwen_timeline_policy_not_implemented",
              "Qwen backend and ForcedAligner capability passed; T11 timeline policy is required"))) {
        return 74;
      }
      return 20;
    }

    std::vector<parakeet_family::WindowResult> windows;
    for (std::int64_t start_ms = 0; start_ms < duration_ms;) {
      const std::int64_t end_ms = std::min(
          start_ms + parakeet_family::window_duration_ms,
          duration_ms);
      crisp::Result result = backend->transcribe_window({start_ms, end_ms}, emit_progress);
      windows.push_back({start_ms, end_ms, std::move(result.source_segments)});
      emit_progress(end_ms);
      start_ms = end_ms;
    }

    parakeet_family::PolicyResult policy =
        parakeet_family::assemble_segments(request.engine, windows, duration_ms);
    if (!policy.error_code.empty()) {
      if (!emitter.emit(error_event(policy.error_code, "Parakeet-family subtitle policy rejected output"))) {
        return 74;
      }
      return 20;
    }

    EventV1 replace;
    replace.type = EventType::SegmentsReplace;
    replace.segments = std::move(policy.segments);
    if (!emitter.emit(replace)) return 74;

    EventV1 completed;
    completed.type = EventType::Completed;
    completed.duration_ms = duration_ms;
    completed.detected_language = "ja";
    if (!emitter.emit(completed)) return 74;
    return 0;
  } catch (const crisp::BackendError& error) {
    if (!emitter.emit(error_event(error.code(), error.what()))) return 74;
    return 20;
  } catch (const std::exception&) {
    if (!emitter.emit(error_event("crispasr_runtime_failed", "CrispASR runtime failed"))) return 74;
    return 20;
  }
}
#endif

int run_worker(const WorkerRequestV1& request) {
  if (request.backend == Backend::CTranslate2) return run_ctranslate2(request);
#ifdef HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT
  if (request.backend == Backend::CrispAsr) return run_crispasr(request);
#endif
  emit_pre_ready_error(
      "route_not_implemented",
      "requested native ASR route is not implemented by this worker");
  return 2;
}

}  // namespace

int main() {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stderr), _O_BINARY);
#endif
  WorkerRequestV1 request;
  if (!read_request(request)) {
    return 2;
  }
  return run_worker(request);
}
