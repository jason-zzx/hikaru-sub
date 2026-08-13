#pragma once

#include <cstdint>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>

namespace hikaru_asr::wav {

inline constexpr int sample_rate = 16000;

class AudioError : public std::runtime_error {
 public:
  AudioError(std::string code, std::string message);
  const std::string& code() const noexcept;

 private:
  std::string code_;
};

struct Audio {
  std::vector<float> samples;
  std::int64_t duration_ms = 0;
};

Audio read_pcm16_mono_16khz(const std::filesystem::path& path);

}  // namespace hikaru_asr::wav
