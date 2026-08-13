#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include <hikaru_asr/protocol.hpp>

namespace hikaru_asr::crisp {

class BackendError : public std::runtime_error {
 public:
  BackendError(std::string code, std::string message);
  const std::string& code() const noexcept;

 private:
  std::string code_;
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

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

bool runtime_identity_matches(
    const std::filesystem::path& path,
    std::uintmax_t expected_size,
    const std::string& expected_sha256);
std::filesystem::path upstream_compatible_path(const std::filesystem::path& path);
const char* upstream_backend(Engine engine);

}  // namespace hikaru_asr::crisp
