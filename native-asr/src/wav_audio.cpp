#include "wav_audio.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <fstream>
#include <utility>

namespace hikaru_asr::wav {
namespace {

std::uint16_t read_u16(std::istream& input) {
  std::array<unsigned char, 2> bytes{};
  if (!input.read(reinterpret_cast<char*>(bytes.data()), bytes.size())) {
    throw AudioError("invalid_audio", "WAV file is truncated");
  }
  return static_cast<std::uint16_t>(bytes[0] | (bytes[1] << 8));
}

std::uint32_t read_u32(std::istream& input) {
  std::array<unsigned char, 4> bytes{};
  if (!input.read(reinterpret_cast<char*>(bytes.data()), bytes.size())) {
    throw AudioError("invalid_audio", "WAV file is truncated");
  }
  return static_cast<std::uint32_t>(bytes[0])
      | (static_cast<std::uint32_t>(bytes[1]) << 8)
      | (static_cast<std::uint32_t>(bytes[2]) << 16)
      | (static_cast<std::uint32_t>(bytes[3]) << 24);
}

std::string read_fourcc(std::istream& input) {
  std::array<char, 4> value{};
  if (!input.read(value.data(), value.size())) {
    throw AudioError("invalid_audio", "WAV file is truncated");
  }
  return std::string(value.data(), value.size());
}

}  // namespace

AudioError::AudioError(std::string code, std::string message)
    : std::runtime_error(std::move(message)), code_(std::move(code)) {}

const std::string& AudioError::code() const noexcept {
  return code_;
}

Audio read_pcm16_mono_16khz(const std::filesystem::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    throw AudioError("audio_open_failed", "WAV file could not be opened");
  }
  if (read_fourcc(input) != "RIFF") {
    throw AudioError("invalid_audio", "Audio must be a RIFF WAV file");
  }
  static_cast<void>(read_u32(input));
  if (read_fourcc(input) != "WAVE") {
    throw AudioError("invalid_audio", "Audio must be a WAVE file");
  }

  bool format_ready = false;
  bool data_ready = false;
  Audio audio;
  while (input && !data_ready) {
    if (input.peek() == std::char_traits<char>::eof()) break;
    const std::string chunk = read_fourcc(input);
    const std::uint32_t size = read_u32(input);
    if (chunk == "fmt ") {
      if (size < 16) {
        throw AudioError("invalid_audio", "WAV fmt chunk is invalid");
      }
      const std::uint16_t format = read_u16(input);
      const std::uint16_t channels = read_u16(input);
      const std::uint32_t rate = read_u32(input);
      static_cast<void>(read_u32(input));
      static_cast<void>(read_u16(input));
      const std::uint16_t bits = read_u16(input);
      if (format != 1 || channels != 1 || rate != sample_rate || bits != 16) {
        throw AudioError(
            "unsupported_audio_format",
            "Audio must be 16 kHz mono PCM16 WAV");
      }
      input.seekg(size - 16, std::ios::cur);
      if (!input) {
        throw AudioError("invalid_audio", "WAV fmt chunk is truncated");
      }
      format_ready = true;
    } else if (chunk == "data") {
      if (!format_ready || size == 0 || size % sizeof(std::int16_t) != 0) {
        throw AudioError("invalid_audio", "WAV data chunk is invalid");
      }
      std::vector<std::int16_t> pcm(size / sizeof(std::int16_t));
      if (!input.read(reinterpret_cast<char*>(pcm.data()), size)) {
        throw AudioError("invalid_audio", "WAV data is truncated");
      }
      audio.samples.resize(pcm.size());
      std::transform(pcm.begin(), pcm.end(), audio.samples.begin(), [](std::int16_t value) {
        return static_cast<float>(value) / 32768.0f;
      });
      data_ready = true;
    } else {
      input.seekg(size, std::ios::cur);
      if (!input) {
        throw AudioError("invalid_audio", "WAV chunk is truncated");
      }
    }
    if (size % 2 != 0) {
      input.seekg(1, std::ios::cur);
      if (!input) {
        throw AudioError("invalid_audio", "WAV chunk padding is truncated");
      }
    }
  }

  if (!format_ready || !data_ready || audio.samples.empty()) {
    throw AudioError("invalid_audio", "WAV file is missing required chunks");
  }
  audio.duration_ms =
      (static_cast<std::int64_t>(audio.samples.size()) * 1000 + sample_rate / 2)
      / sample_rate;
  return audio;
}

}  // namespace hikaru_asr::wav
