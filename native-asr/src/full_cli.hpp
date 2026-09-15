#pragma once

#include <hikaru_asr/protocol.hpp>
#include <nlohmann/json.hpp>
#include <functional>
#include <stdexcept>

namespace hikaru_asr::full_cli {
class Error : public std::runtime_error {
 public:
  explicit Error(const std::string& code) : std::runtime_error(code) {}
};
// Shared byte/JSON boundary only; each engine owns its output semantics.
using Json = nlohmann::json;
void require(bool ok, const char* code = "qwen_cli_output_invalid");
std::wstring wide(const std::string& text);
std::wstring compact(const std::string& text);
std::int64_t integer(const Json& value);
std::string text(const Json& value);
Json document(const std::string& bytes, std::int64_t duration_ms);
std::vector<Segment> transcribe(const WorkerRequestV1& request,
                               const std::function<void(std::int64_t)>& ready,
                               const std::function<void(std::int64_t, std::int64_t)>& progress);
}  // namespace hikaru_asr::full_cli

namespace hikaru_asr::parakeet_cli {
std::vector<Segment> parse_result(const std::string& bytes, std::int64_t duration_ms, bool& silence);
}
