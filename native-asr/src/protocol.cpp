#include <hikaru_asr/protocol.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <limits>
#include <set>
#include <stdexcept>

namespace hikaru_asr {
namespace {

using Json = nlohmann::json;

bool fail(ProtocolError& error, std::string code, std::string message) {
  error = {std::move(code), std::move(message)};
  return false;
}

bool validate_wire_line(std::string_view line, std::size_t max_bytes, const char* kind,
                        ProtocolError& error) {
  if (line.size() > max_bytes) {
    return fail(error, std::string(kind) + "_line_too_large",
                std::string(kind) + " line exceeds the protocol limit");
  }
  if (line.size() >= 3 && static_cast<unsigned char>(line[0]) == 0xef &&
      static_cast<unsigned char>(line[1]) == 0xbb &&
      static_cast<unsigned char>(line[2]) == 0xbf) {
    return fail(error, std::string(kind) + "_bom", std::string(kind) + " line must not use BOM");
  }
  if (line.find('\0') != std::string_view::npos) {
    return fail(error, std::string(kind) + "_contains_nul",
                std::string(kind) + " line contains NUL");
  }
  if (line.find('\n') != std::string_view::npos || line.find('\r') != std::string_view::npos) {
    return fail(error, std::string(kind) + "_multiline",
                std::string(kind) + " must contain exactly one JSON line");
  }
  return true;
}

bool parse_json_object(std::string_view line, const char* kind, Json& value, ProtocolError& error) {
  value = Json::parse(line.begin(), line.end(), nullptr, false);
  if (value.is_discarded()) {
    return fail(error, std::string(kind) + "_malformed_json",
                std::string(kind) + " is not valid UTF-8 JSON");
  }
  if (!value.is_object()) {
    return fail(error, std::string(kind) + "_invalid_shape",
                std::string(kind) + " JSON must be an object");
  }
  return true;
}

bool required_string(const Json& object, const char* key, std::string& value, ProtocolError& error,
                     const char* code = "missing_or_invalid_field") {
  const auto it = object.find(key);
  if (it == object.end() || !it->is_string()) {
    return fail(error, code, std::string("field '") + key + "' must be a string");
  }
  value = it->get<std::string>();
  return true;
}

bool required_bool(const Json& object, const char* key, bool& value, ProtocolError& error) {
  const auto it = object.find(key);
  if (it == object.end() || !it->is_boolean()) {
    return fail(error, "missing_or_invalid_field",
                std::string("field '") + key + "' must be a boolean");
  }
  value = it->get<bool>();
  return true;
}

bool json_integer(const Json& value, std::int64_t& result) {
  if (!value.is_number_integer() && !value.is_number_unsigned()) {
    return false;
  }
  try {
    result = value.get<std::int64_t>();
    return true;
  } catch (const std::exception&) {
    return false;
  }
}

bool required_integer(const Json& object, const char* key, std::int64_t& value,
                      ProtocolError& error) {
  const auto it = object.find(key);
  if (it == object.end() || !json_integer(*it, value)) {
    return fail(error, "missing_or_invalid_field",
                std::string("field '") + key + "' must be an in-range integer");
  }
  return true;
}

bool parse_engine(std::string_view text, Engine& value) {
  if (text == "faster-whisper") value = Engine::FasterWhisper;
  else if (text == "kotoba-faster-whisper") value = Engine::KotobaFasterWhisper;
  else if (text == "parakeet") value = Engine::Parakeet;
  else if (text == "reazonspeech-nemo") value = Engine::ReazonSpeechNemo;
  else if (text == "qwen3-asr") value = Engine::Qwen3Asr;
  else return false;
  return true;
}

bool parse_backend(std::string_view text, Backend& value) {
  if (text == "ctranslate2") value = Backend::CTranslate2;
  else if (text == "crispasr") value = Backend::CrispAsr;
  else return false;
  return true;
}

bool parse_device(std::string_view text, Device& value) {
  if (text == "cpu") value = Device::Cpu;
  else if (text == "cuda") value = Device::Cuda;
  else if (text == "vulkan") value = Device::Vulkan;
  else return false;
  return true;
}

bool parse_role(std::string_view text, ModelRole& value) {
  if (text == "model") value = ModelRole::Model;
  else if (text == "aligner") value = ModelRole::Aligner;
  else return false;
  return true;
}

bool parse_event_type(std::string_view text, EventType& value) {
  if (text == "ready") value = EventType::Ready;
  else if (text == "progress") value = EventType::Progress;
  else if (text == "segment") value = EventType::Segment;
  else if (text == "segmentsReplace") value = EventType::SegmentsReplace;
  else if (text == "completed") value = EventType::Completed;
  else if (text == "error") value = EventType::Error;
  else return false;
  return true;
}

bool has_control(std::string_view text) {
  return std::any_of(text.begin(), text.end(), [](unsigned char c) { return c < 0x20 || c == 0x7f; });
}

bool valid_job_id(std::string_view value) {
  if (value.empty() || value.size() > limits::max_job_id_bytes || has_control(value)) return false;
  return std::any_of(value.begin(), value.end(), [](unsigned char c) { return !std::isspace(c); });
}

bool valid_local_absolute_path(std::string_view value) {
  if (value.empty() || value.size() > limits::max_path_bytes || has_control(value)) return false;

  std::string path(value);
  std::replace(path.begin(), path.end(), '\\', '/');
  if (path.rfind("//./", 0) == 0 || path.rfind("//??/", 0) == 0) return false;
  if (path.rfind("//?/", 0) == 0) {
    path.erase(0, 4);
    if (path.rfind("UNC/", 0) == 0) path = "//" + path.substr(4);
  }

  const auto has_invalid_component_char = [](std::string_view text) {
    return text.find_first_of("<>\"|?*") != std::string_view::npos;
  };
  const bool drive_absolute = path.size() >= 3 && std::isalpha(static_cast<unsigned char>(path[0])) &&
                              path[1] == ':' && path[2] == '/';
  if (drive_absolute) {
    return path.size() > 3 && path.find(':', 2) == std::string::npos &&
           !has_invalid_component_char(std::string_view(path).substr(3));
  }

  if (path.rfind("//", 0) == 0) {
    const auto server_end = path.find('/', 2);
    if (server_end == std::string::npos || server_end == 2) return false;
    const auto share_end = path.find('/', server_end + 1);
    const auto share_stop = share_end == std::string::npos ? path.size() : share_end;
    const std::string_view server(path.data() + 2, server_end - 2);
    const std::string_view share(path.data() + server_end + 1, share_stop - server_end - 1);
    return !share.empty() && server != "." && server.find(':') == std::string_view::npos &&
           share.find(':') == std::string_view::npos &&
           !has_invalid_component_char(std::string_view(path).substr(2));
  }
  return false;
}

Backend backend_for(Engine engine) {
  switch (engine) {
    case Engine::FasterWhisper:
    case Engine::KotobaFasterWhisper:
      return Backend::CTranslate2;
    case Engine::Parakeet:
    case Engine::ReazonSpeechNemo:
    case Engine::Qwen3Asr:
      return Backend::CrispAsr;
  }
  return Backend::CTranslate2;
}

bool validate_vad_config(const Json& value, VadConfig& config, ProtocolError& error) {
  if (!value.is_object()) return fail(error, "invalid_vad_config", "vadConfig must be an object");

  const auto parse_ms = [&](const char* key, std::int64_t min, std::int64_t max,
                            std::optional<std::int64_t>& target) -> bool {
    const auto it = value.find(key);
    if (it == value.end()) return true;
    std::int64_t parsed = 0;
    if (!json_integer(*it, parsed) || parsed < min || parsed > max) {
      return fail(error, "invalid_vad_config", std::string("vadConfig.") + key + " is out of range");
    }
    target = parsed;
    return true;
  };

  const auto threshold = value.find("threshold");
  if (threshold != value.end()) {
    if (!threshold->is_number()) {
      return fail(error, "invalid_vad_config", "vadConfig.threshold must be numeric");
    }
    double parsed = 0.0;
    try {
      parsed = threshold->get<double>();
    } catch (const std::exception&) {
      return fail(error, "invalid_vad_config", "vadConfig.threshold is out of range");
    }
    if (!std::isfinite(parsed) || parsed < 0.0 || parsed > 1.0) {
      return fail(error, "invalid_vad_config", "vadConfig.threshold is out of range");
    }
    config.threshold = parsed;
  }

  if (!parse_ms("minSpeechDurationMs", 0, 60000, config.min_speech_duration_ms) ||
      !parse_ms("minSilenceDurationMs", 0, 60000, config.min_silence_duration_ms) ||
      !parse_ms("speechPadMs", 0, 10000, config.speech_pad_ms) ||
      !parse_ms("maxSegmentDurationMs", 1000, 600000, config.max_segment_duration_ms)) {
    return false;
  }
  if (config.min_speech_duration_ms && config.max_segment_duration_ms &&
      *config.max_segment_duration_ms < *config.min_speech_duration_ms) {
    return fail(error, "invalid_vad_config",
                "vadConfig.maxSegmentDurationMs must cover minSpeechDurationMs");
  }
  return true;
}

bool validate_segment_shape(const Segment& segment, ProtocolError& error) {
  if (segment.text.empty() || segment.text.size() > limits::max_text_bytes || has_control(segment.text)) {
    return fail(error, "invalid_segment", "segment text must be non-empty, bounded UTF-8 text");
  }
  if (segment.start_ms < 0 || segment.end_ms <= segment.start_ms) {
    return fail(error, "invalid_segment", "segment must satisfy 0 <= startMs < endMs");
  }
  return true;
}

bool parse_segment(const Json& value, Segment& segment, ProtocolError& error) {
  if (!value.is_object()) return fail(error, "invalid_segment", "segment must be an object");
  if (!required_integer(value, "startMs", segment.start_ms, error) ||
      !required_integer(value, "endMs", segment.end_ms, error) ||
      !required_string(value, "text", segment.text, error, "invalid_segment")) {
    return false;
  }
  return validate_segment_shape(segment, error);
}

bool valid_error_code(std::string_view code) {
  if (code.empty() || code.size() > limits::max_job_id_bytes) return false;
  return std::all_of(code.begin(), code.end(), [](unsigned char c) {
    return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_';
  });
}

bool validate_event_shape(const EventV1& event, ProtocolError& error) {
  switch (event.type) {
    case EventType::Ready:
      if (event.duration_ms <= 0) return fail(error, "invalid_ready", "ready durationMs must be positive");
      return true;
    case EventType::Progress:
      if (event.processed_ms < 0 || event.duration_ms <= 0) {
        return fail(error, "invalid_progress", "progress values must be non-negative with positive duration");
      }
      return true;
    case EventType::Segment:
      return validate_segment_shape(event.segment, error);
    case EventType::SegmentsReplace: {
      if (event.segments.size() > limits::max_replacement_segments) {
        return fail(error, "replacement_too_large", "segmentsReplace exceeds the segment count limit");
      }
      std::int64_t previous = -1;
      for (const auto& segment : event.segments) {
        if (!validate_segment_shape(segment, error)) return false;
        if (segment.start_ms < previous) {
          return fail(error, "invalid_segment_order", "replacement segments must be sorted by startMs");
        }
        previous = segment.start_ms;
      }
      return true;
    }
    case EventType::Completed:
      if (event.duration_ms <= 0 || event.detected_language != "ja") {
        return fail(error, "invalid_completed", "completed requires positive durationMs and detectedLanguage 'ja'");
      }
      return true;
    case EventType::Error:
      if (!valid_error_code(event.code) || event.message.empty() ||
          event.message.size() > limits::max_text_bytes || has_control(event.message)) {
        return fail(error, "invalid_error", "error requires a stable code and bounded safe message");
      }
      return true;
  }
  return fail(error, "unknown_event", "event type is not supported by protocol v1");
}

Json segment_json(const Segment& segment) {
  return Json{{"endMs", segment.end_ms}, {"startMs", segment.start_ms}, {"text", segment.text}};
}

bool replacement_fits_event_line(const EventV1& event, ProtocolError& error) {
  std::size_t size = std::string_view("{\"event\":\"segmentsReplace\",\"protocolVersion\":1,\"segments\":[]}").size();
  for (std::size_t index = 0; index < event.segments.size(); ++index) {
    std::string serialized;
    try {
      serialized = segment_json(event.segments[index]).dump();
    } catch (const std::exception&) {
      return fail(error, "event_serialization_failed", "event contains invalid UTF-8");
    }
    const std::size_t comma = index == 0 ? 0 : 1;
    if (comma > limits::max_event_line_bytes - size ||
        serialized.size() > limits::max_event_line_bytes - size - comma) {
      return fail(error, "event_line_too_large", "serialized event exceeds the protocol limit");
    }
    size += comma + serialized.size();
  }
  return true;
}

}  // namespace

const char* to_string(Engine value) {
  switch (value) {
    case Engine::FasterWhisper: return "faster-whisper";
    case Engine::KotobaFasterWhisper: return "kotoba-faster-whisper";
    case Engine::Parakeet: return "parakeet";
    case Engine::ReazonSpeechNemo: return "reazonspeech-nemo";
    case Engine::Qwen3Asr: return "qwen3-asr";
  }
  return "";
}

const char* to_string(Backend value) {
  return value == Backend::CTranslate2 ? "ctranslate2" : "crispasr";
}

const char* to_string(Device value) {
  switch (value) {
    case Device::Cpu: return "cpu";
    case Device::Cuda: return "cuda";
    case Device::Vulkan: return "vulkan";
  }
  return "";
}

const char* to_string(ModelRole value) {
  return value == ModelRole::Model ? "model" : "aligner";
}

const char* to_string(EventType value) {
  switch (value) {
    case EventType::Ready: return "ready";
    case EventType::Progress: return "progress";
    case EventType::Segment: return "segment";
    case EventType::SegmentsReplace: return "segmentsReplace";
    case EventType::Completed: return "completed";
    case EventType::Error: return "error";
  }
  return "";
}

bool read_bounded_line(std::istream& input, std::size_t max_bytes, std::string& line,
                       bool& eof, ProtocolError& error) {
  line.clear();
  eof = false;
  char c = 0;
  while (input.get(c)) {
    if (c == '\n') {
      if (!line.empty() && line.back() == '\r') line.pop_back();
      return true;
    }
    if (line.size() == max_bytes) {
      return fail(error, "line_too_large", "input line exceeds the protocol limit");
    }
    line.push_back(c);
  }
  eof = line.empty();
  return true;
}

bool parse_request_line(std::string_view line, WorkerRequestV1& request, ProtocolError& error) {
  if (!validate_wire_line(line, limits::max_request_line_bytes, "request", error)) return false;
  Json root;
  if (!parse_json_object(line, "request", root, error)) return false;

  std::int64_t version = 0;
  if (!required_integer(root, "protocolVersion", version, error)) return false;
  if (version != limits::protocol_version) {
    return fail(error, "unsupported_protocol_version", "protocolVersion must be 1");
  }

  WorkerRequestV1 parsed;
  std::string engine;
  std::string backend;
  std::string device;
  if (!required_string(root, "jobId", parsed.job_id, error) ||
      !required_string(root, "engine", engine, error) ||
      !required_string(root, "backend", backend, error) ||
      !required_string(root, "audioPath", parsed.audio_path, error) ||
      !required_string(root, "device", device, error) ||
      !required_string(root, "language", parsed.language, error) ||
      !required_bool(root, "useVad", parsed.use_vad, error)) {
    return false;
  }
  if (!valid_job_id(parsed.job_id)) return fail(error, "invalid_job_id", "jobId is empty or invalid");
  if (!parse_engine(engine, parsed.engine)) return fail(error, "unknown_engine", "engine is not supported");
  if (!parse_backend(backend, parsed.backend)) return fail(error, "unknown_backend", "backend is not supported");
  if (parsed.backend != backend_for(parsed.engine)) {
    return fail(error, "invalid_route", "engine and backend do not match the fixed route matrix");
  }
  if (!parse_device(device, parsed.device)) return fail(error, "unknown_device", "device must be cpu, cuda, or vulkan");
  if (parsed.backend == Backend::CTranslate2 && parsed.device == Device::Vulkan) {
    return fail(error, "invalid_device_for_route", "ctranslate2 routes do not support vulkan");
  }
  if (parsed.language != "ja") return fail(error, "invalid_language", "language must be 'ja'");
  if (!valid_local_absolute_path(parsed.audio_path)) {
    return fail(error, "invalid_local_path", "audioPath must be an absolute local Windows path");
  }

  const auto models = root.find("modelPaths");
  if (models == root.end() || !models->is_array() || models->empty() ||
      models->size() > limits::max_model_entries) {
    return fail(error, "invalid_model_paths", "modelPaths must be a non-empty bounded array");
  }
  std::set<ModelRole> roles;
  for (const auto& value : *models) {
    if (!value.is_object()) return fail(error, "invalid_model_paths", "model path entry must be an object");
    std::string role;
    ModelPath model;
    if (!required_string(value, "role", role, error) || !required_string(value, "path", model.path, error)) {
      return false;
    }
    if (!parse_role(role, model.role)) return fail(error, "unknown_model_role", "model role is not supported");
    if (!roles.insert(model.role).second) return fail(error, "duplicate_model_role", "model roles must be unique");
    if (!valid_local_absolute_path(model.path)) {
      return fail(error, "invalid_local_path", "model path must be an absolute local Windows path");
    }
    parsed.model_paths.push_back(std::move(model));
  }
  if (roles.count(ModelRole::Model) == 0) return fail(error, "missing_model_role", "model role is required");
  if (parsed.engine == Engine::Qwen3Asr) {
    if (roles.count(ModelRole::Aligner) == 0 || roles.size() != 2) {
      return fail(error, "missing_model_role", "qwen3-asr requires model and aligner roles");
    }
  } else if (roles.size() != 1) {
    return fail(error, "unexpected_model_role", "this route accepts only the model role");
  }

  const auto vad = root.find("vadConfig");
  if (parsed.use_vad && vad != root.end()) {
    VadConfig config;
    if (!validate_vad_config(*vad, config, error)) return false;
    parsed.vad_config = std::move(config);
  }

  request = std::move(parsed);
  return true;
}

bool parse_event_line(std::string_view line, EventV1& event, ProtocolError& error) {
  if (!validate_wire_line(line, limits::max_event_line_bytes, "event", error)) return false;
  Json root;
  if (!parse_json_object(line, "event", root, error)) return false;

  std::int64_t version = 0;
  std::string name;
  if (!required_integer(root, "protocolVersion", version, error) ||
      !required_string(root, "event", name, error)) {
    return false;
  }
  if (version != limits::protocol_version) {
    return fail(error, "unsupported_protocol_version", "event protocolVersion must be 1");
  }

  EventV1 parsed;
  if (!parse_event_type(name, parsed.type)) return fail(error, "unknown_event", "event is not supported");

  std::string text;
  switch (parsed.type) {
    case EventType::Ready:
      if (!required_string(root, "backend", text, error) || !parse_backend(text, parsed.backend)) {
        return fail(error, "invalid_ready", "ready backend is invalid");
      }
      if (!required_string(root, "device", text, error) || !parse_device(text, parsed.device)) {
        return fail(error, "invalid_ready", "ready device is invalid");
      }
      if (!required_integer(root, "durationMs", parsed.duration_ms, error)) return false;
      break;
    case EventType::Progress:
      if (!required_integer(root, "processedMs", parsed.processed_ms, error) ||
          !required_integer(root, "durationMs", parsed.duration_ms, error)) return false;
      break;
    case EventType::Segment:
      if (!parse_segment(root, parsed.segment, error)) return false;
      break;
    case EventType::SegmentsReplace: {
      const auto values = root.find("segments");
      if (values == root.end() || !values->is_array() ||
          values->size() > limits::max_replacement_segments) {
        return fail(error, "replacement_too_large", "segmentsReplace is missing or too large");
      }
      parsed.segments.reserve(values->size());
      for (const auto& value : *values) {
        Segment segment;
        if (!parse_segment(value, segment, error)) return false;
        parsed.segments.push_back(std::move(segment));
      }
      break;
    }
    case EventType::Completed:
      if (!required_integer(root, "durationMs", parsed.duration_ms, error) ||
          !required_string(root, "detectedLanguage", parsed.detected_language, error)) return false;
      break;
    case EventType::Error:
      if (!required_string(root, "code", parsed.code, error) ||
          !required_string(root, "message", parsed.message, error)) return false;
      break;
  }

  if (!validate_event_shape(parsed, error)) return false;
  event = std::move(parsed);
  return true;
}

bool serialize_event(const EventV1& event, std::string& line, ProtocolError& error) {
  if (!validate_event_shape(event, error)) return false;
  if (event.type == EventType::SegmentsReplace && !replacement_fits_event_line(event, error)) {
    return false;
  }
  Json root{{"event", to_string(event.type)}, {"protocolVersion", limits::protocol_version}};
  switch (event.type) {
    case EventType::Ready:
      root["backend"] = to_string(event.backend);
      root["device"] = to_string(event.device);
      root["durationMs"] = event.duration_ms;
      break;
    case EventType::Progress:
      root["durationMs"] = event.duration_ms;
      root["processedMs"] = event.processed_ms;
      break;
    case EventType::Segment:
      root["startMs"] = event.segment.start_ms;
      root["endMs"] = event.segment.end_ms;
      root["text"] = event.segment.text;
      break;
    case EventType::SegmentsReplace:
      root["segments"] = Json::array();
      for (const auto& segment : event.segments) root["segments"].push_back(segment_json(segment));
      break;
    case EventType::Completed:
      root["detectedLanguage"] = event.detected_language;
      root["durationMs"] = event.duration_ms;
      break;
    case EventType::Error:
      root["code"] = event.code;
      root["message"] = event.message;
      break;
  }
  try {
    line = root.dump();
  } catch (const std::exception&) {
    return fail(error, "event_serialization_failed", "event contains invalid UTF-8");
  }
  if (line.size() > limits::max_event_line_bytes) {
    return fail(error, "event_line_too_large", "serialized event exceeds the protocol limit");
  }
  return true;
}

EventSequenceState make_event_sequence_state(const WorkerRequestV1& request) {
  EventSequenceState state;
  state.expected_backend = request.backend;
  state.expected_device = request.device;
  return state;
}

bool validate_event(EventSequenceState& state, const EventV1& event, ProtocolError& error) {
  if (!validate_event_shape(event, error)) return false;
  if (state.terminal) return fail(error, "event_after_terminal", "stdout event follows a terminal event");

  if (event.type == EventType::Error) {
    state.terminal = true;
    return true;
  }
  if (event.type == EventType::Ready) {
    if (state.ready) return fail(error, "duplicate_ready", "ready must occur exactly once");
    if (event.backend != state.expected_backend || event.device != state.expected_device) {
      return fail(error, "ready_route_mismatch", "ready backend/device differs from the request");
    }
    state.ready = true;
    state.duration_ms = event.duration_ms;
    return true;
  }
  if (!state.ready) return fail(error, "event_before_ready", "only error is allowed before ready");

  switch (event.type) {
    case EventType::Progress:
      if (event.duration_ms != state.duration_ms) {
        return fail(error, "duration_drift", "progress durationMs differs from ready");
      }
      if (event.processed_ms < state.processed_ms) {
        return fail(error, "progress_regression", "processedMs must be monotonic");
      }
      if (event.processed_ms > state.duration_ms) {
        return fail(error, "invalid_progress", "processedMs exceeds durationMs");
      }
      state.processed_ms = event.processed_ms;
      return true;
    case EventType::Segment:
      if (event.segment.end_ms > state.duration_ms) {
        return fail(error, "segment_out_of_bounds", "segment exceeds ready durationMs");
      }
      if (event.segment.start_ms < state.last_segment_start_ms) {
        return fail(error, "invalid_segment_order", "segment events must be sorted by startMs");
      }
      state.last_segment_start_ms = event.segment.start_ms;
      return true;
    case EventType::SegmentsReplace: {
      std::int64_t previous = -1;
      for (const auto& segment : event.segments) {
        if (segment.end_ms > state.duration_ms) {
          return fail(error, "segment_out_of_bounds", "replacement segment exceeds ready durationMs");
        }
        if (segment.start_ms < previous) {
          return fail(error, "invalid_segment_order", "replacement segments must be sorted by startMs");
        }
        previous = segment.start_ms;
      }
      state.last_segment_start_ms = previous;
      return true;
    }
    case EventType::Completed:
      if (event.duration_ms != state.duration_ms) {
        return fail(error, "duration_drift", "completed durationMs differs from ready");
      }
      state.terminal = true;
      return true;
    case EventType::Ready:
    case EventType::Error:
      break;
  }
  return fail(error, "invalid_transition", "event transition is invalid");
}

bool validate_event_eof(const EventSequenceState& state, ProtocolError& error) {
  if (!state.terminal) return fail(error, "missing_terminal_event", "EOF occurred before completed or error");
  return true;
}

}  // namespace hikaru_asr
