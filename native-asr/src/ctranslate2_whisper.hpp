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

namespace hikaru_asr::whisper {

inline constexpr int sample_rate = 16000;
inline constexpr int fft_size = 400;
inline constexpr int hop_length = 160;
inline constexpr int max_model_frames = 3000;
inline constexpr std::int64_t model_window_duration_ms = 30000;
inline constexpr int timestamp_resolution_ms = 20;
inline constexpr int vad_window_samples = 512;
inline constexpr int vad_context_samples = 64;
inline constexpr std::size_t vad_batch_rows = 10000;
inline constexpr float vad_threshold = 0.5f;
inline constexpr double vad_negative_threshold = 0.35;
inline constexpr std::int64_t vad_min_silence_ms = 2000;
inline constexpr std::int64_t vad_speech_pad_ms = 400;

enum class ExecutionDevice {
  Cpu,
  Cuda,
};

enum class ExecutionComputeType {
  Int8,
  Float16,
};

struct BackendExecutionConfig {
  ExecutionDevice device = ExecutionDevice::Cpu;
  ExecutionComputeType compute_type = ExecutionComputeType::Int8;
  int device_index = 0;
};

struct BackendExecutionAttestation {
  BackendExecutionConfig config;
  int visible_device_count = 0;
  bool compute_type_supported = true;
  std::string device_name;
  int compute_capability_major = 0;
  int compute_capability_minor = 0;
  int cuda_driver_api_version = 0;
};

BackendExecutionConfig cpu_execution_config();
BackendExecutionConfig cuda_execution_config();

struct CandidateAConfig {
  std::size_t beam_size = 1;
  std::size_t max_length = 448;
  float patience = 1.0f;
  float length_penalty = 1.0f;
  float repetition_penalty = 1.0f;
  std::size_t no_repeat_ngram_size = 0;
  float no_speech_threshold = 0.6f;
  float log_prob_threshold = -1.0f;
  bool condition_on_previous_text = false;
  bool timestamp_driven_seek = true;
  float prompt_reset_on_temperature = 0.5f;
  float temperature = 0.0f;
  std::size_t max_initial_timestamp_index = 50;
};

struct TokenIds {
  std::size_t eot = 0;
  std::size_t sot = 0;
  std::size_t japanese = 0;
  std::size_t transcribe = 0;
  std::size_t sot_prev = 0;
  std::size_t timestamp_begin = 0;
};

struct SegmentEvidence {
  Segment segment;
  std::int64_t raw_start_ms = 0;
  std::int64_t raw_end_ms = 0;
  bool end_bounded_to_audio = false;
  std::int64_t compressed_start_ms = -1;
  std::int64_t compressed_end_ms = -1;
  bool vad_timestamp_restored = false;
  std::size_t timestamp_start_token = 0;
  std::size_t timestamp_end_token = 0;
  std::vector<std::size_t> tokens;
  std::string trace_sha256;
};

struct VadSpeechInterval {
  std::int64_t start_sample = 0;
  std::int64_t end_sample = 0;
  std::int64_t compressed_end_sample = 0;
  std::int64_t silence_before_samples = 0;
};

struct CandidateBVadResult {
  std::size_t original_sample_count = 0;
  std::size_t padded_sample_count = 0;
  std::size_t row_count = 0;
  std::size_t batch_count = 0;
  double inference_ms = 0;
  double final_h_sum = 0;
  double final_c_sum = 0;
  std::vector<float> probabilities;
  std::vector<VadSpeechInterval> intervals;
  std::vector<float> compressed_samples;
};

struct WindowTrace {
  std::int64_t window_offset_ms = 0;
  std::int64_t source_window_duration_ms = 0;
  std::int64_t model_window_duration_ms = whisper::model_window_duration_ms;
  std::int64_t seek_frames_before = 0;
  std::int64_t seek_frames_after = 0;
  std::int64_t source_overlap_ms = 0;
  std::int64_t source_progress_before_ms = 0;
  std::int64_t source_progress_after_ms = 0;
  bool vad_timestamp_restored = false;
  std::size_t prompt_token_count = 0;
  std::size_t history_token_count_before = 0;
  std::size_t history_token_count_after = 0;
  std::size_t prefix_forward_token_count = 0;
  std::size_t generated_token_count = 0;
  double feature_ms = 0;
  double generate_ms = 0;
  std::size_t generation_call_count = 0;
  std::size_t fallback_call_count = 0;
  float no_speech_probability = 0;
  float average_log_probability = 0;
  bool skipped_as_no_speech = false;
  std::string parse_status;
  std::string parse_error;
  std::string sha256;
  std::vector<std::size_t> token_ids;
};

struct TranscriptionResult {
  std::int64_t duration_ms = 0;
  double feature_ms = 0;
  double generate_ms = 0;
  double inference_ms = 0;
  double vad_ms = 0;
  bool vad_enabled = false;
  std::size_t original_sample_count = 0;
  std::size_t compressed_sample_count = 0;
  std::size_t vad_row_count = 0;
  std::size_t vad_batch_count = 0;
  std::vector<VadSpeechInterval> vad_intervals;
  std::vector<SegmentEvidence> segments;
  std::vector<WindowTrace> traces;
  std::string failure_code;
};

struct TimestampParseResult {
  std::vector<SegmentEvidence> segments;
  std::vector<std::size_t> history_tokens;
  std::int64_t seek_advance_frames = 0;
  bool single_timestamp_ending = false;
  bool used_decoded_seek = false;
};

class BackendError : public std::runtime_error {
 public:
  BackendError(std::string code, std::string message);
  const std::string& code() const noexcept;

 private:
  std::string code_;
};

using DecodeTokens = std::function<std::string(const std::vector<std::uint32_t>&)>;
using ProgressCallback = std::function<void(std::int64_t processed_ms)>;
using SegmentCallback = std::function<void(const Segment&)>;
using CancellationCallback = std::function<bool()>;

std::int64_t verified_wav_duration_ms(const std::filesystem::path& audio_path);
std::int64_t source_frame_count(std::size_t sample_count);
void validate_model_directory(const std::filesystem::path& model_path);

TimestampParseResult parse_timestamp_tokens(
    const std::vector<std::size_t>& token_ids,
    const TokenIds& tokens,
    const DecodeTokens& decode,
    std::int64_t window_offset_ms,
    std::int64_t source_window_duration_ms,
    std::int64_t audio_duration_ms);

std::vector<float> official_log_mel_for_test(
    const std::vector<float>& samples,
    int mel_bins,
    std::int64_t frame_offset,
    int frame_count);

void remove_exact_duplicate_segments(std::vector<SegmentEvidence>& segments);

std::vector<float> candidate_b_vad_rows_for_test(const std::vector<float>& samples);
std::vector<VadSpeechInterval> candidate_b_intervals_for_test(
    const std::vector<float>& probabilities,
    std::size_t original_sample_count);
std::vector<VadSpeechInterval> candidate_b_pad_intervals_for_test(
    std::vector<VadSpeechInterval> intervals,
    std::size_t original_sample_count);
std::int64_t candidate_b_restore_time_ms_for_test(
    const std::vector<VadSpeechInterval>& intervals,
    std::int64_t compressed_time_ms,
    bool is_end);
CandidateBVadResult candidate_b_run_vad_for_test(
    const std::filesystem::path& vad_model_path,
    const std::vector<float>& samples,
    std::size_t batch_rows = vad_batch_rows,
    bool verify_identity = true);
void candidate_b_force_ort_run_failure_for_test(
    const std::filesystem::path& vad_model_path);

class CTranslate2WhisperBackend {
 public:
  explicit CTranslate2WhisperBackend(
      const std::filesystem::path& model_path,
      CandidateAConfig config = {},
      std::optional<std::filesystem::path> vad_model_path = std::nullopt,
      BackendExecutionConfig execution = {});
  ~CTranslate2WhisperBackend();

  CTranslate2WhisperBackend(const CTranslate2WhisperBackend&) = delete;
  CTranslate2WhisperBackend& operator=(const CTranslate2WhisperBackend&) = delete;

  TranscriptionResult transcribe(
      const std::filesystem::path& audio_path,
      const ProgressCallback& on_progress = {},
      const SegmentCallback& on_segment = {},
      const CancellationCallback& is_cancelled = {});

  int mel_bins() const;
  std::size_t resolved_intra_threads() const;
  std::size_t resolved_inter_threads() const;
  const TokenIds& token_ids() const;
  const BackendExecutionAttestation& execution_attestation() const;

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace hikaru_asr::whisper
