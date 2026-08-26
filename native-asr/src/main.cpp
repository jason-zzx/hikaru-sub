#include "ctranslate2_whisper.hpp"
#ifdef HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT
#include "crispasr_backend.hpp"
#include "parakeet_family_policy.hpp"
#endif

#include <hikaru_asr/protocol.hpp>

#include "../third_party/nlohmann/json.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
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
using Json = nlohmann::json;
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

  bool emit(const EventV1& event, ProtocolError* failure = nullptr) {
    ProtocolError error;
    std::string line;
    EventSequenceState next = state_;
    if (!serialize_event(event, line, error) || !validate_event(next, event, error)) {
      if (failure) *failure = error;
      std::cerr << "worker_internal_error:" << error.code << '\n';
      return false;
    }
    std::cout << line << '\n' << std::flush;
    state_ = next;
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

#ifdef HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT
constexpr const char* r2_evidence_prefix = "hikaru_r2_evidence:";

bool r2_evidence_enabled() {
  const char* value = std::getenv("HIKARU_ASR_R2_EVIDENCE_TRACE");
  return value != nullptr && std::string_view(value) == "1";
}

std::string environment_value(const char* name) {
  const char* value = std::getenv(name);
  return value == nullptr ? std::string{} : std::string(value);
}

void emit_r2_evidence(Json value) {
  if (!r2_evidence_enabled()) return;
  value["schema"] = "hikaru-reazonspeech-r2-worker-trace-v1";
  std::cerr << r2_evidence_prefix << value.dump() << '\n' << std::flush;
}

Json child_cuda_device() {
  HMODULE library = LoadLibraryW(L"nvcuda.dll");
  if (library == nullptr) {
    throw crisp::BackendError("crispasr_evidence_trace_failed", "CUDA driver attestation failed");
  }
  using CuInit = int (*)(unsigned int);
  using CuDeviceGet = int (*)(int*, int);
  using CuDeviceGetName = int (*)(char*, int, int);
  using CuDeviceComputeCapability = int (*)(int*, int*, int);
  using CuDriverGetVersion = int (*)(int*);
  const auto init = reinterpret_cast<CuInit>(GetProcAddress(library, "cuInit"));
  const auto get_device = reinterpret_cast<CuDeviceGet>(GetProcAddress(library, "cuDeviceGet"));
  const auto get_name = reinterpret_cast<CuDeviceGetName>(GetProcAddress(library, "cuDeviceGetName"));
  const auto get_capability = reinterpret_cast<CuDeviceComputeCapability>(
      GetProcAddress(library, "cuDeviceComputeCapability"));
  const auto get_version = reinterpret_cast<CuDriverGetVersion>(
      GetProcAddress(library, "cuDriverGetVersion"));
  int device = 0;
  int major = 0;
  int minor = 0;
  int version = 0;
  char name[256]{};
  const bool ok = init && get_device && get_name && get_capability && get_version
      && init(0) == 0
      && get_device(&device, 0) == 0
      && get_name(name, static_cast<int>(sizeof(name)), device) == 0
      && get_capability(&major, &minor, device) == 0
      && get_version(&version) == 0;
  FreeLibrary(library);
  if (!ok) {
    throw crisp::BackendError("crispasr_evidence_trace_failed", "CUDA driver attestation failed");
  }
  return Json{
      {"index", 0},
      {"name", name},
      {"computeCapability", std::to_string(major) + "." + std::to_string(minor)},
      {"driverApiVersion", version}};
}

Json source_segment_evidence(const crisp::NativeSegment& segment) {
  return Json{
      {"startMs", segment.raw_start_ms},
      {"endMs", segment.raw_end_ms},
      {"textBytes", segment.text.size()},
      {"textSha256", crisp::sha256_text(segment.text)}};
}

Json final_segment_evidence(const Segment& segment) {
  return Json{
      {"startMs", segment.start_ms},
      {"endMs", segment.end_ms},
      {"textBytes", segment.text.size()},
      {"textSha256", crisp::sha256_text(segment.text)}};
}
#endif

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
#ifdef HIKARU_ASR_MVP_CPU_RUNTIME
  if (!ordinary || request.backend != Backend::CTranslate2) {
    emit_pre_ready_error(
        "route_not_built",
        "requested native ASR route is not included in the MVP CPU runtime");
    return 2;
  }
#else
  if ((!ordinary && !kotoba) || request.backend != Backend::CTranslate2) {
    emit_pre_ready_error(
        "route_not_implemented",
        "requested native ASR route is not implemented by this worker");
    return 2;
  }
#endif
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
    if (ordinary && request.use_vad) {
#ifndef HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT
      throw whisper::BackendError(
          "vad_not_built",
          "Candidate B VAD support is not included in this worker");
#else
      validate_candidate_b_config(request);
#endif
    }
    const fs::path audio = fs::u8path(request.audio_path);
    const fs::path model = model_path(request);
    whisper::validate_model_directory(model, kotoba);
    const std::int64_t duration_ms = whisper::verified_wav_duration_ms(audio);
#ifdef HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT
    const std::optional<fs::path> vad_model = ordinary && request.use_vad
        ? std::optional<fs::path>(
              current_executable_directory() / "silero_vad_v6.onnx")
        : std::nullopt;
#else
    const std::optional<fs::path> vad_model = std::nullopt;
#endif
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
    emit_pre_ready_error(
        "crispasr_vad_not_implemented",
        "CrispASR product VAD configuration is not implemented");
    return 2;
  }
  if (request.device == Device::Vulkan) {
    emit_pre_ready_error("device_not_implemented", "T09 does not implement CrispASR Vulkan");
    return 2;
  }
  const bool reazon_r2 = request.engine == Engine::ReazonSpeechNemo;
  const bool trace_r2 = reazon_r2 && r2_evidence_enabled();
  std::size_t attempted_calls = 0;
  std::size_t completed_calls = 0;
  std::int64_t attempted_through_ms = 0;
  std::optional<std::size_t> attempted_window_index;
  std::optional<crisp::AudioWindow> attempted_window;
  bool vad_planned = false;
  const auto trace_failure = [&](
      const std::string& code,
      const char* stage,
      const crisp::ResultFailureDetail* result_failure) {
    if (!trace_r2) return;
    Json failure{
        {"kind", "failure"},
        {"code", code},
        {"stage", stage},
        {"attemptedTranscribeCalls", attempted_calls},
        {"completedTranscribeCalls", completed_calls},
        {"attemptedThroughMs", attempted_through_ms}};
    if (result_failure && attempted_window_index && attempted_window) {
      failure["resultFailure"] = Json{
          {"subtype", result_failure->subtype},
          {"zeroBasedWindowIndex", *attempted_window_index},
          {"windowStartMs", attempted_window->start_ms},
          {"windowEndMs", attempted_window->end_ms},
          {"localStartMs", result_failure->local_start_ms},
          {"localEndMs", result_failure->local_end_ms},
          {"segmentIndex", result_failure->segment_index},
          {"resultTraceSha256", result_failure->result_trace_sha256}};
    }
    emit_r2_evidence(std::move(failure));
  };

  std::unique_ptr<crisp::CrispAsrBackend> backend;
  fs::path reazon_vad_model;
  try {
    if (trace_r2) {
      emit_r2_evidence(Json{
          {"kind", "identity"},
          {"device", child_cuda_device()},
          {"deviceSelectionEnvironment", Json{
              {"CUDA_DEVICE_ORDER", environment_value("CUDA_DEVICE_ORDER")},
              {"CUDA_VISIBLE_DEVICES", environment_value("CUDA_VISIBLE_DEVICES")},
              {"GPU_DEVICE_ORDINAL", environment_value("GPU_DEVICE_ORDINAL")},
              {"HIP_VISIBLE_DEVICES", environment_value("HIP_VISIBLE_DEVICES")},
              {"NVIDIA_VISIBLE_DEVICES", environment_value("NVIDIA_VISIBLE_DEVICES")}}}});
    }
    const auto model = request_model_path(request, ModelRole::Model);
    const auto aligner = request_model_path(request, ModelRole::Aligner);
    if (!model) throw crisp::BackendError("missing_model_role", "model role is required");
    if (request.engine == Engine::ReazonSpeechNemo) {
      reazon_vad_model = current_executable_directory() / "ggml-silero-v6.2.0.bin";
      if (!crisp::reazon_vad_identity_permitted(reazon_vad_model)) {
        throw crisp::BackendError(
            "crispasr_vad_model_invalid",
            "The frozen ReazonSpeech VAD asset is unavailable");
      }
    }
    backend = std::make_unique<crisp::CrispAsrBackend>(crisp::BackendConfig{
        request.engine,
        request.device,
        ctranslate2_compatible_path(fs::u8path(request.audio_path)),
        *model,
        aligner,
        current_executable_directory() / "crispasr.dll"});
  } catch (const crisp::BackendError& error) {
    trace_failure(error.code(), "pre-ready", nullptr);
    emit_pre_ready_error(error.code(), error.what());
    return 20;
  } catch (const std::exception&) {
    trace_failure("crispasr_runtime_failed", "pre-ready", nullptr);
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
    std::string selected_source_text;
    if (reazon_r2) {
      const std::vector<crisp::AudioWindow> vad_windows =
          backend->detect_reazon_vad_windows(reazon_vad_model);
      vad_planned = true;
      if (trace_r2) {
        Json traced_windows = Json::array();
        for (std::size_t index = 0; index < vad_windows.size(); ++index) {
          traced_windows.push_back(Json{
              {"index", index},
              {"startMs", vad_windows[index].start_ms},
              {"endMs", vad_windows[index].end_ms}});
        }
        emit_r2_evidence(Json{
            {"kind", "vad"},
            {"windows", std::move(traced_windows)}});
      }
      for (std::size_t index = 0; index < vad_windows.size(); ++index) {
        const auto& window = vad_windows[index];
        ++attempted_calls;
        attempted_through_ms = window.end_ms;
        attempted_window_index = index;
        attempted_window = window;
        if (trace_r2) {
          emit_r2_evidence(Json{
              {"kind", "transcribeAttempt"},
              {"windowIndex", index},
              {"startMs", window.start_ms},
              {"endMs", window.end_ms}});
        }
        crisp::Result result = backend->transcribe_window(window);
        ++completed_calls;
        if (trace_r2) {
          Json source_segments = Json::array();
          for (const auto& segment : result.source_segments) {
            source_segments.push_back(source_segment_evidence(segment));
          }
          emit_r2_evidence(Json{
              {"kind", "sourceResult"},
              {"windowIndex", index},
              {"startMs", window.start_ms},
              {"endMs", window.end_ms},
              {"sourceSegments", std::move(source_segments)}});
        }
        for (const auto& segment : result.source_segments) {
          selected_source_text += segment.text;
        }
        windows.push_back({window.start_ms, window.end_ms, std::move(result.source_segments)});
        emit_progress(window.end_ms);
      }
    } else {
      for (std::int64_t start_ms = 0; start_ms < duration_ms;) {
        const std::int64_t end_ms = std::min(
            start_ms + parakeet_family::window_duration_ms,
            duration_ms);
        crisp::Result result = backend->transcribe_window({start_ms, end_ms}, emit_progress);
        windows.push_back({start_ms, end_ms, std::move(result.source_segments)});
        emit_progress(end_ms);
        start_ms = end_ms;
      }
    }

    parakeet_family::PolicyResult policy =
        parakeet_family::assemble_segments(request.engine, windows, duration_ms);
    if (!policy.error_code.empty()) {
      trace_failure(policy.error_code, "policy", nullptr);
      if (!emitter.emit(error_event(policy.error_code, "Parakeet-family subtitle policy rejected output"))) {
        return 74;
      }
      return 20;
    }

    if (trace_r2) {
      std::string final_text;
      Json final_segments = Json::array();
      for (const auto& segment : policy.segments) {
        final_text += segment.text;
        final_segments.push_back(final_segment_evidence(segment));
      }
      emit_r2_evidence(Json{
          {"kind", "policy"},
          {"sourceTextBytes", selected_source_text.size()},
          {"sourceTextSha256", crisp::sha256_text(selected_source_text)},
          {"finalTextBytes", final_text.size()},
          {"finalTextSha256", crisp::sha256_text(final_text)},
          {"finalSegments", std::move(final_segments)}});
    }

    EventV1 replace;
    replace.type = EventType::SegmentsReplace;
    replace.segments = std::move(policy.segments);
#ifdef HIKARU_ASR_CRISPASR_WORKER_CONTRACT_TEST
    if (!request.model_paths.empty()
        && request.model_paths.front().path.find("protocol-oversized-replacement")
            != std::string::npos) {
      replace.segments.assign(
          limits::max_replacement_segments + 1,
          Segment{0, 1, "x"});
    }
#endif
    ProtocolError replacement_error;
    if (!emitter.emit(replace, &replacement_error)) {
      trace_failure(replacement_error.code, "protocol", nullptr);
      if (!emitter.emit(error_event(replacement_error.code, replacement_error.message))) return 74;
      return 20;
    }

    EventV1 completed;
    completed.type = EventType::Completed;
    completed.duration_ms = duration_ms;
    completed.detected_language = "ja";
    if (!emitter.emit(completed)) return 74;
    return 0;
  } catch (const crisp::BackendError& error) {
    trace_failure(
        error.code(),
        !vad_planned ? "vad" : attempted_calls > completed_calls ? "transcribe" : "worker",
        error.result_failure() ? &*error.result_failure() : nullptr);
    if (!emitter.emit(error_event(error.code(), error.what()))) return 74;
    return 20;
  } catch (const std::exception&) {
    trace_failure(
        "crispasr_runtime_failed",
        !vad_planned ? "vad" : attempted_calls > completed_calls ? "transcribe" : "worker",
        nullptr);
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
