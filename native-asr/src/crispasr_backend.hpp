#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include <hikaru_asr/protocol.hpp>

namespace hikaru_asr::crisp {

struct ResultFailureDetail {
  std::string subtype;
  int segment_index = 0;
  std::int64_t local_start_ms = 0;
  std::int64_t local_end_ms = 0;
  std::string result_trace_sha256;
};

class BackendError : public std::runtime_error {
 public:
  BackendError(
      std::string code,
      std::string message,
      std::optional<ResultFailureDetail> result_failure = std::nullopt);
  const std::string& code() const noexcept;
  const std::optional<ResultFailureDetail>& result_failure() const noexcept;

 private:
  std::string code_;
  std::optional<ResultFailureDetail> result_failure_;
};

struct BackendConfig {
  Engine engine = Engine::Parakeet;
  Device device = Device::Cpu;
  std::filesystem::path audio_path;
  std::filesystem::path model_path;
  std::optional<std::filesystem::path> aligner_path;
  std::filesystem::path library_path;
};

struct NativeWord {
  std::string text;
  std::int64_t start_ms = 0;
  std::int64_t end_ms = 0;
};

struct NativeSegment {
  std::string text;
  std::int64_t raw_start_ms = 0;
  std::int64_t raw_end_ms = 0;
  std::vector<NativeWord> words;
};

struct AlignmentEntry {
  std::string text;
  std::int64_t start_ms = 0;
  std::int64_t end_ms = 0;
};

struct Result {
  std::vector<NativeSegment> source_segments;
  std::vector<AlignmentEntry> alignment;
};

struct AudioWindow {
  std::int64_t start_ms = 0;
  std::int64_t end_ms = 0;
};

inline constexpr std::int64_t reazon_vad_core_max_duration_ms = 12'000;
inline constexpr std::int64_t reazon_vad_padded_max_duration_ms = 12'060;
inline constexpr std::int64_t reazon_vad_max_adjacent_overlap_ms = 60;
inline constexpr std::int64_t reazon_vad_max_samples = 192'960;

using ProgressCallback = std::function<void(std::int64_t processed_ms)>;
using SegmentCallback = std::function<void(const Segment& segment)>;

class CrispAsrBackend {
 public:
  explicit CrispAsrBackend(BackendConfig config);
  ~CrispAsrBackend();

  CrispAsrBackend(const CrispAsrBackend&) = delete;
  CrispAsrBackend& operator=(const CrispAsrBackend&) = delete;

  std::int64_t duration_ms() const;
  Result transcribe(
      const ProgressCallback& on_progress = {},
      const SegmentCallback& on_segment = {});
  Result transcribe_window(
      AudioWindow window,
      const ProgressCallback& on_progress = {},
      const SegmentCallback& on_segment = {});
  std::vector<AudioWindow> detect_reazon_vad_windows(
      const std::filesystem::path& vad_model_path);

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

std::string sha256_text(std::string_view text);
bool runtime_identity_matches(
    const std::filesystem::path& path,
    std::uintmax_t expected_size,
    const std::string& expected_sha256);
bool reazon_vad_identity_matches(const std::filesystem::path& path);
bool reazon_vad_identity_permitted(const std::filesystem::path& path);
std::filesystem::path upstream_compatible_path(const std::filesystem::path& path);
const char* upstream_backend(Engine engine);

}  // namespace hikaru_asr::crisp
