#pragma once

#include "crispasr_backend.hpp"

#include <cstdint>
#include <string>
#include <vector>

#include <hikaru_asr/protocol.hpp>

namespace hikaru_asr::parakeet_family {

inline constexpr std::int64_t window_duration_ms = 15'000;
inline constexpr std::size_t max_cue_code_points = 96;
inline constexpr std::int64_t max_cue_duration_ms = 15'000;

struct WindowResult {
  std::int64_t window_start_ms = 0;
  std::int64_t window_end_ms = 0;
  std::vector<crisp::NativeSegment> source_segments;
};

struct PolicyResult {
  std::vector<Segment> segments;
  std::string error_code;
};

PolicyResult assemble_segments(
    Engine engine,
    const std::vector<WindowResult>& windows,
    std::int64_t audio_duration_ms);

}  // namespace hikaru_asr::parakeet_family
