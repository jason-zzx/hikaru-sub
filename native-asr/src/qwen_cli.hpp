#pragma once

#include "full_cli.hpp"

namespace hikaru_asr::qwen_cli {
using Error = full_cli::Error;
std::vector<Segment> parse_result(const std::string& bytes, std::int64_t duration_ms,
                                 bool& silence);
}  // namespace hikaru_asr::qwen_cli
