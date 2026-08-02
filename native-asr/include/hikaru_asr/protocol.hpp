#pragma once

#include <cstdint>
#include <istream>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <hikaru_asr/protocol_limits.hpp>

namespace hikaru_asr {

enum class Engine {
  FasterWhisper,
  KotobaFasterWhisper,
  Parakeet,
  ReazonSpeechNemo,
  Qwen3Asr,
};

enum class Backend { CTranslate2, CrispAsr };
enum class Device { Cpu, Cuda, Vulkan };
enum class ModelRole { Model, Aligner };
enum class EventType { Ready, Progress, Segment, SegmentsReplace, Completed, Error };

struct ProtocolError {
  std::string code;
  std::string message;
};

struct ModelPath {
  ModelRole role = ModelRole::Model;
  std::string path;
};

struct VadConfig {
  std::optional<double> threshold;
  std::optional<std::int64_t> min_speech_duration_ms;
  std::optional<std::int64_t> min_silence_duration_ms;
  std::optional<std::int64_t> speech_pad_ms;
  std::optional<std::int64_t> max_segment_duration_ms;
};

struct WorkerRequestV1 {
  std::string job_id;
  Engine engine = Engine::FasterWhisper;
  Backend backend = Backend::CTranslate2;
  std::vector<ModelPath> model_paths;
  std::string audio_path;
  Device device = Device::Cpu;
  std::string language;
  bool use_vad = false;
  std::optional<VadConfig> vad_config;
};

struct Segment {
  std::int64_t start_ms = 0;
  std::int64_t end_ms = 0;
  std::string text;
};

struct EventV1 {
  EventType type = EventType::Ready;
  Backend backend = Backend::CTranslate2;
  Device device = Device::Cpu;
  std::int64_t duration_ms = 0;
  std::int64_t processed_ms = 0;
  Segment segment;
  std::vector<Segment> segments;
  std::string detected_language;
  std::string code;
  std::string message;
};

struct EventSequenceState {
  Backend expected_backend = Backend::CTranslate2;
  Device expected_device = Device::Cpu;
  bool ready = false;
  bool terminal = false;
  std::int64_t duration_ms = 0;
  std::int64_t processed_ms = 0;
  std::int64_t last_segment_start_ms = -1;
};

const char* to_string(Engine value);
const char* to_string(Backend value);
const char* to_string(Device value);
const char* to_string(ModelRole value);
const char* to_string(EventType value);

bool read_bounded_line(std::istream& input, std::size_t max_bytes, std::string& line,
                       bool& eof, ProtocolError& error);
bool parse_request_line(std::string_view line, WorkerRequestV1& request, ProtocolError& error);
bool parse_event_line(std::string_view line, EventV1& event, ProtocolError& error);
bool serialize_event(const EventV1& event, std::string& line, ProtocolError& error);

EventSequenceState make_event_sequence_state(const WorkerRequestV1& request);
bool validate_event(EventSequenceState& state, const EventV1& event, ProtocolError& error);
bool validate_event_eof(const EventSequenceState& state, ProtocolError& error);

}  // namespace hikaru_asr
