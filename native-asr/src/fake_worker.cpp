#include <hikaru_asr/protocol.hpp>

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <string>
#include <thread>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <process.h>
#else
#include <sys/types.h>
#include <unistd.h>
#endif

namespace {

using namespace hikaru_asr;

[[noreturn]] void hang_forever() {
  for (;;) std::this_thread::sleep_for(std::chrono::hours(24));
}

EventV1 ready(Backend backend, Device device, std::int64_t duration) {
  EventV1 event;
  event.type = EventType::Ready;
  event.backend = backend;
  event.device = device;
  event.duration_ms = duration;
  return event;
}

EventV1 progress(std::int64_t processed, std::int64_t duration) {
  EventV1 event;
  event.type = EventType::Progress;
  event.processed_ms = processed;
  event.duration_ms = duration;
  return event;
}

EventV1 segment(std::int64_t start, std::int64_t end, std::string text) {
  EventV1 event;
  event.type = EventType::Segment;
  event.segment = {start, end, std::move(text)};
  return event;
}

EventV1 replacement(std::vector<Segment> segments) {
  EventV1 event;
  event.type = EventType::SegmentsReplace;
  event.segments = std::move(segments);
  return event;
}

EventV1 completed(std::int64_t duration) {
  EventV1 event;
  event.type = EventType::Completed;
  event.duration_ms = duration;
  event.detected_language = "ja";
  return event;
}

EventV1 error_event(std::string code, std::string message) {
  EventV1 event;
  event.type = EventType::Error;
  event.code = std::move(code);
  event.message = std::move(message);
  return event;
}

class Emitter {
 public:
  explicit Emitter(const WorkerRequestV1& request) : state_(make_event_sequence_state(request)) {}

  bool emit(const EventV1& event) {
    ProtocolError error;
    std::string line;
    if (!validate_event(state_, event, error) || !serialize_event(event, line, error)) {
      std::cerr << "fake_worker_internal_error:" << error.code << '\n';
      return false;
    }
    std::cout << line << '\n' << std::flush;
    return true;
  }

 private:
  EventSequenceState state_;
};

void emit_pre_ready_error(const ProtocolError& protocol_error) {
  EventV1 event = error_event(protocol_error.code.empty() ? "invalid_request" : protocol_error.code,
                              protocol_error.message.empty() ? "request was rejected" : protocol_error.message);
  ProtocolError serialization_error;
  std::string line;
  if (serialize_event(event, line, serialization_error)) std::cout << line << '\n' << std::flush;
}

bool read_request(WorkerRequestV1& request) {
  ProtocolError error;
  std::string line;
  bool eof = false;
  if (!read_bounded_line(std::cin, limits::max_request_line_bytes, line, eof, error)) {
    error.code = "request_line_too_large";
    emit_pre_ready_error(error);
    return false;
  }
  if (eof) {
    error = {"missing_request", "stdin closed before the request line"};
    emit_pre_ready_error(error);
    return false;
  }
  if (!parse_request_line(line, request, error)) {
    emit_pre_ready_error(error);
    return false;
  }

  std::string extra;
  if (!read_bounded_line(std::cin, limits::max_request_line_bytes, extra, eof, error)) {
    error = {"request_extra_line", "stdin contains data after the request line"};
    emit_pre_ready_error(error);
    return false;
  }
  if (!eof) {
    error = {"request_extra_line", "stdin must contain exactly one request line"};
    emit_pre_ready_error(error);
    return false;
  }
  return true;
}

bool spawn_child_hang(const std::filesystem::path& executable) {
#ifdef _WIN32
  const auto path = executable.string();
  return _spawnl(_P_NOWAIT, path.c_str(), path.c_str(), "--scenario", "child-hang-helper",
                 static_cast<char*>(nullptr)) != -1;
#else
  const pid_t child = fork();
  if (child == 0) {
    const auto path = executable.string();
    execl(path.c_str(), path.c_str(), "--scenario", "child-hang-helper", nullptr);
    _exit(127);
  }
  return child > 0;
#endif
}

int run_scenario(const std::string& scenario, const WorkerRequestV1& request,
                 const std::filesystem::path& executable) {
  constexpr std::int64_t duration = 120000;
  Emitter emitter(request);

  if (scenario == "success") {
    if (!emitter.emit(ready(request.backend, request.device, duration)) ||
        !emitter.emit(segment(1000, 3000, "synthetic alpha")) ||
        !emitter.emit(progress(30000, duration)) ||
        !emitter.emit(segment(32000, 35000, "synthetic beta")) ||
        !emitter.emit(replacement({{1000, 3000, "synthetic alpha revised"},
                                   {32000, 35000, "synthetic beta"}})) ||
        !emitter.emit(progress(duration, duration)) || !emitter.emit(completed(duration))) return 74;
    return 0;
  }
  if (scenario == "segments-replace") {
    if (!emitter.emit(ready(request.backend, request.device, duration)) ||
        !emitter.emit(segment(1000, 2000, "preview")) ||
        !emitter.emit(replacement({{1100, 2100, "replacement"}})) ||
        !emitter.emit(completed(duration))) return 74;
    return 0;
  }
  if (scenario == "structured-error") {
    if (!emitter.emit(ready(request.backend, request.device, duration)) ||
        !emitter.emit(segment(1000, 3000, "partial synthetic result")) ||
        !emitter.emit(progress(30000, duration)) ||
        !emitter.emit(error_event("model_runtime_failed", "synthetic runtime failure"))) return 74;
    return 20;
  }
  if (scenario == "malformed-json") {
    std::cout << "{not-json\n" << std::flush;
    return 0;
  }
  if (scenario == "unknown-event") {
    std::cout << "{\"backend\":\"" << to_string(request.backend) << "\",\"device\":\""
              << to_string(request.device)
              << "\",\"durationMs\":120000,\"event\":\"ready\",\"protocolVersion\":1}\n"
              << "{\"event\":\"mystery\",\"protocolVersion\":1}\n" << std::flush;
    return 0;
  }
  if (scenario == "version-mismatch") {
    std::cout << "{\"event\":\"ready\",\"protocolVersion\":2}\n" << std::flush;
    return 0;
  }
  if (scenario == "invalid-transition") {
    std::cout << "{\"durationMs\":120000,\"event\":\"progress\",\"processedMs\":1000,\"protocolVersion\":1}\n"
              << std::flush;
    return 0;
  }
  if (scenario == "invalid-segment") {
    if (!emitter.emit(ready(request.backend, request.device, duration))) return 74;
    std::cout << "{\"endMs\":1000,\"event\":\"segment\",\"protocolVersion\":1,\"startMs\":1000,\"text\":\"invalid\"}\n"
              << std::flush;
    return 0;
  }
  if (scenario == "duration-drift") {
    if (!emitter.emit(ready(request.backend, request.device, duration))) return 74;
    std::cout << "{\"durationMs\":120001,\"event\":\"progress\",\"processedMs\":1000,\"protocolVersion\":1}\n"
              << std::flush;
    return 0;
  }
  if (scenario == "oversized-line") {
    std::cout << std::string(limits::max_event_line_bytes + 1, 'x') << '\n' << std::flush;
    return 0;
  }
  if (scenario == "crash-before-ready") return 70;
  if (scenario == "crash-after-progress") {
    if (!emitter.emit(ready(request.backend, request.device, duration)) ||
        !emitter.emit(progress(30000, duration))) return 74;
    return 71;
  }
  if (scenario == "zero-exit-without-terminal") {
    if (!emitter.emit(ready(request.backend, request.device, duration)) ||
        !emitter.emit(progress(30000, duration))) return 74;
    return 0;
  }
  if (scenario == "completed-then-nonzero") {
    if (!emitter.emit(ready(request.backend, request.device, duration)) ||
        !emitter.emit(completed(duration))) return 74;
    return 72;
  }
  if (scenario == "hang-after-ready") {
    if (!emitter.emit(ready(request.backend, request.device, duration))) return 74;
    hang_forever();
  }
  if (scenario == "child-process-hang") {
    if (!emitter.emit(ready(request.backend, request.device, duration))) return 74;
    if (!spawn_child_hang(executable)) {
      emitter.emit(error_event("child_spawn_failed", "synthetic child could not start"));
      return 73;
    }
    hang_forever();
  }
  if (scenario == "stderr-diagnostics") {
    std::cerr << std::string(limits::max_stderr_diagnostic_bytes, 'D') << std::flush;
    if (!emitter.emit(ready(request.backend, request.device, duration)) ||
        !emitter.emit(completed(duration))) return 74;
    return 0;
  }

  ProtocolError error{"unknown_scenario", "fake worker scenario is not supported"};
  emit_pre_ready_error(error);
  return 64;
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stderr), _O_BINARY);
#endif
  if (argc != 3 || std::string(argv[1]) != "--scenario") {
    std::cerr << "usage: hikaru-asr-fake-worker --scenario <name>\n";
    return 64;
  }
  const std::string scenario = argv[2];
  if (scenario == "child-hang-helper") hang_forever();

  WorkerRequestV1 request;
  if (!read_request(request)) return 2;
  return run_scenario(scenario, request, std::filesystem::absolute(argv[0]));
}
