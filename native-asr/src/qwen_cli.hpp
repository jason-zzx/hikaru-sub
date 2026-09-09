#pragma once

#include <hikaru_asr/protocol.hpp>
#include <filesystem>
#include <functional>
#include <stdexcept>

namespace hikaru_asr::qwen_cli {
class Error : public std::runtime_error {
 public:
  explicit Error(const std::string& code) : std::runtime_error(code) {}
};

// ready is bridge/audio readiness, not evidence that models have loaded.
std::vector<Segment> transcribe(const WorkerRequestV1& request,
                               const std::function<void(std::int64_t)>& ready);
std::vector<Segment> parse_result(const std::string& bytes, std::int64_t duration_ms,
                                 bool& silence);
}  // namespace hikaru_asr::qwen_cli
