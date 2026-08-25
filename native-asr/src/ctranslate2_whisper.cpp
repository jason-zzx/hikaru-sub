#include "ctranslate2_whisper.hpp"
#include "wav_audio.hpp"

#ifndef _WIN32
#error The CTranslate2 worker currently supports Windows x64 only.
#endif

#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>

#include <ctranslate2/devices.h>
#include <ctranslate2/models/whisper.h>
#include <ctranslate2/types.h>
#ifdef HIKARU_ASR_CT2_WITH_CUDA
#include <cuda.h>
#endif
#include <cpu_provider_factory.h>
#include <nlohmann/json.hpp>
#include <onnxruntime_cxx_api.h>
#include <pocketfft_hdronly.h>
#ifdef HIKARU_ASR_WHISPER_FALLBACK_PARITY
#include <zlib.h>
#endif

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <complex>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <limits>
#include <numeric>
#include <optional>
#include <set>
#include <sstream>
#include <thread>
#include <utility>

extern "C" {
struct HikaruTokenizerHandle;
HikaruTokenizerHandle* hikaru_tokenizer_open(const char* path);
void hikaru_tokenizer_close(HikaruTokenizerHandle* handle);
int hikaru_tokenizer_token_to_id(
    HikaruTokenizerHandle* handle,
    const char* token,
    std::uint32_t* output);
char* hikaru_tokenizer_decode(
    HikaruTokenizerHandle* handle,
    const std::uint32_t* ids,
    std::size_t len,
    int skip_special);
void hikaru_tokenizer_string_free(char* value);
std::size_t hikaru_tokenizer_last_error(char* buffer, std::size_t capacity);
}

namespace hikaru_asr::whisper {
namespace {

using Clock = std::chrono::steady_clock;
using Json = nlohmann::json;
namespace fs = std::filesystem;

constexpr double pi = 3.141592653589793238462643383279502884;

double elapsed_ms(const Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

std::string tokenizer_error() {
  std::array<char, 512> buffer{};
  hikaru_tokenizer_last_error(buffer.data(), buffer.size());
  return buffer.data();
}

class Tokenizer {
 public:
  explicit Tokenizer(const fs::path& path) {
    const std::string value = path.u8string();
    handle_ = hikaru_tokenizer_open(value.c_str());
    if (handle_ == nullptr) {
      throw BackendError("tokenizer_open_failed", "Tokenizer could not be opened");
    }
  }

  ~Tokenizer() {
    hikaru_tokenizer_close(handle_);
  }

  std::size_t token_to_id(const char* token) const {
    std::uint32_t id = 0;
    if (!hikaru_tokenizer_token_to_id(handle_, token, &id)) {
      throw BackendError("tokenizer_metadata_invalid", "Required tokenizer token is missing");
    }
    return id;
  }

  std::string decode(const std::vector<std::uint32_t>& ids) const {
    if (ids.empty()) {
      return {};
    }
    char* value = hikaru_tokenizer_decode(handle_, ids.data(), ids.size(), 1);
    if (value == nullptr) {
      throw BackendError("tokenizer_decode_failed", "Tokenizer could not decode generated tokens");
    }
    std::string output(value);
    hikaru_tokenizer_string_free(value);
    return output;
  }

 private:
  HikaruTokenizerHandle* handle_ = nullptr;
};

wav::Audio read_wav(const fs::path& path) {
  try {
    return wav::read_pcm16_mono_16khz(path);
  } catch (const wav::AudioError& error) {
    throw BackendError(error.code(), error.what());
  }
}
std::vector<float> mel_filters(int mel_bins) {
  if (mel_bins != 80 && mel_bins != 128) {
    throw BackendError("model_contract_mismatch", "Whisper model has unsupported mel bins");
  }
  constexpr int bins = fft_size / 2 + 1;
  std::vector<double> mels(static_cast<std::size_t>(mel_bins) + 2);
  std::vector<double> frequencies(mels.size());
  std::vector<double> differences(mels.size() - 1);
  for (std::size_t index = 0; index < mels.size(); ++index) {
    mels[index] = 45.245640471924965 * static_cast<double>(index)
        / static_cast<double>(mels.size() - 1);
    constexpr double frequency_step = 200.0 / 3.0;
    constexpr double minimum_log_mel = 1000.0 / frequency_step;
    constexpr double log_step = 0.06875177742094912;
    frequencies[index] = mels[index] >= minimum_log_mel
        ? 1000.0 * std::exp(log_step * (mels[index] - minimum_log_mel))
        : frequency_step * mels[index];
  }
  for (std::size_t index = 0; index < differences.size(); ++index) {
    differences[index] = frequencies[index + 1] - frequencies[index];
  }

  std::vector<float> filters(static_cast<std::size_t>(mel_bins) * bins);
  for (int mel = 0; mel < mel_bins; ++mel) {
    const double scale = 2.0 / (frequencies[mel + 2] - frequencies[mel]);
    for (int bin = 0; bin < bins; ++bin) {
      const double fft_frequency = static_cast<double>(bin) * sample_rate / fft_size;
      const double lower = (fft_frequency - frequencies[mel]) / differences[mel];
      const double upper = (frequencies[mel + 2] - fft_frequency) / differences[mel + 1];
      filters[static_cast<std::size_t>(mel) * bins + bin] =
          static_cast<float>(std::max(0.0, std::min(lower, upper)) * scale);
    }
  }
  return filters;
}

std::int64_t reflect_index(std::int64_t index, std::int64_t size) {
  while (index < 0 || index >= size) {
    if (index < 0) {
      index = -index;
    } else {
      index = 2 * size - 2 - index;
    }
  }
  return index;
}

std::vector<float> log_mel_window(
    const std::vector<float>& samples,
    int mel_bins,
    std::int64_t frame_offset,
    int frame_count) {
  if (samples.empty() || frame_count < 0 || frame_count > max_model_frames) {
    throw BackendError("feature_invalid_input", "Log-mel input is invalid");
  }
  const std::int64_t padded_sample_count =
      static_cast<std::int64_t>(samples.size()) + hop_length;
  const std::int64_t available_frames = padded_sample_count / hop_length;
  if (frame_offset < 0 || frame_offset + frame_count > available_frames) {
    throw BackendError("feature_frame_range", "Log-mel frame range is invalid");
  }

  constexpr int bins = fft_size / 2 + 1;
  constexpr int batch_limit = 256;
  const std::vector<float> filters = mel_filters(mel_bins);
  std::vector<float> output(
      static_cast<std::size_t>(mel_bins) * max_model_frames,
      0.0f);
  float global_max = -std::numeric_limits<float>::infinity();

  for (int batch_start = 0; batch_start < frame_count; batch_start += batch_limit) {
    const int batch = std::min(batch_limit, frame_count - batch_start);
    std::vector<float> frames(static_cast<std::size_t>(batch) * fft_size);
    for (int local = 0; local < batch; ++local) {
      const std::int64_t center =
          (frame_offset + batch_start + local) * hop_length;
      for (int sample = 0; sample < fft_size; ++sample) {
        const std::int64_t reflected = reflect_index(
            center + sample - fft_size / 2,
            padded_sample_count);
        const float value = reflected < static_cast<std::int64_t>(samples.size())
            ? samples[static_cast<std::size_t>(reflected)]
            : 0.0f;
        const float window = 0.5f - 0.5f * std::cos(
            2.0f * static_cast<float>(pi) * sample / fft_size);
        frames[static_cast<std::size_t>(local) * fft_size + sample] = value * window;
      }
    }

    std::vector<std::complex<float>> spectra(
        static_cast<std::size_t>(batch) * bins);
    const pocketfft::shape_t shape{static_cast<std::size_t>(batch), fft_size};
    const pocketfft::stride_t input_stride{
        static_cast<std::ptrdiff_t>(fft_size * sizeof(float)),
        static_cast<std::ptrdiff_t>(sizeof(float))};
    const pocketfft::stride_t output_stride{
        static_cast<std::ptrdiff_t>(bins * sizeof(std::complex<float>)),
        static_cast<std::ptrdiff_t>(sizeof(std::complex<float>))};
    pocketfft::r2c(
        shape,
        input_stride,
        output_stride,
        1,
        true,
        frames.data(),
        spectra.data(),
        1.0f,
        1);

    for (int local = 0; local < batch; ++local) {
      for (int mel = 0; mel < mel_bins; ++mel) {
        double energy = 0;
        for (int bin = 0; bin < bins; ++bin) {
          energy += filters[static_cast<std::size_t>(mel) * bins + bin]
              * std::norm(spectra[static_cast<std::size_t>(local) * bins + bin]);
        }
        const float value = std::log10(std::max(1e-10f, static_cast<float>(energy)));
        output[static_cast<std::size_t>(mel) * max_model_frames
               + batch_start + local] = value;
        global_max = std::max(global_max, value);
      }
    }
  }

  if (frame_count > 0) {
    const float floor = global_max - 8.0f;
    for (int mel = 0; mel < mel_bins; ++mel) {
      for (int frame = 0; frame < frame_count; ++frame) {
        float& value = output[static_cast<std::size_t>(mel) * max_model_frames + frame];
        value = (std::max(value, floor) + 4.0f) / 4.0f;
      }
    }
  }
  return output;
}

std::string digest_hex(const unsigned char* digest, std::size_t size) {
  std::ostringstream output;
  for (std::size_t index = 0; index < size; ++index) {
    output << std::hex << std::setw(2) << std::setfill('0')
           << static_cast<int>(digest[index]);
  }
  return output.str();
}

std::string sha256_text(const std::string& text) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) {
    throw BackendError("hash_failed", "SHA-256 provider is unavailable");
  }
  std::array<unsigned char, 32> digest{};
  const NTSTATUS status = BCryptHash(
      algorithm,
      nullptr,
      0,
      reinterpret_cast<PUCHAR>(const_cast<char*>(text.data())),
      static_cast<ULONG>(text.size()),
      digest.data(),
      static_cast<ULONG>(digest.size()));
  BCryptCloseAlgorithmProvider(algorithm, 0);
  if (status != 0) {
    throw BackendError("hash_failed", "SHA-256 calculation failed");
  }
  return digest_hex(digest.data(), digest.size());
}

static_assert(ORT_API_VERSION == 28, "Candidate B requires ONNX Runtime C API 28");

void check_cancelled(const CancellationCallback& is_cancelled) {
  if (is_cancelled && is_cancelled()) {
    throw BackendError("cancelled", "Native ASR was cancelled");
  }
}

std::string sha256_file(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    throw BackendError("vad_model_missing", "Silero VAD model is missing");
  }
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  ULONG object_length = 0;
  ULONG returned = 0;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0
      || BCryptGetProperty(
             algorithm,
             BCRYPT_OBJECT_LENGTH,
             reinterpret_cast<PUCHAR>(&object_length),
             sizeof(object_length),
             &returned,
             0) != 0) {
    if (algorithm != nullptr) BCryptCloseAlgorithmProvider(algorithm, 0);
    throw BackendError("hash_failed", "SHA-256 provider is unavailable");
  }
  std::vector<unsigned char> object(object_length);
  if (BCryptCreateHash(
          algorithm,
          &hash,
          object.data(),
          object_length,
          nullptr,
          0,
          0) != 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw BackendError("hash_failed", "SHA-256 hash creation failed");
  }
  std::vector<unsigned char> buffer(1 << 20);
  while (input) {
    input.read(
        reinterpret_cast<char*>(buffer.data()),
        static_cast<std::streamsize>(buffer.size()));
    const std::streamsize count = input.gcount();
    if (count > 0
        && BCryptHashData(hash, buffer.data(), static_cast<ULONG>(count), 0) != 0) {
      BCryptDestroyHash(hash);
      BCryptCloseAlgorithmProvider(algorithm, 0);
      throw BackendError("hash_failed", "SHA-256 update failed");
    }
  }
  std::array<unsigned char, 32> digest{};
  const NTSTATUS status = BCryptFinishHash(
      hash,
      digest.data(),
      static_cast<ULONG>(digest.size()),
      0);
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  if (status != 0) {
    throw BackendError("hash_failed", "SHA-256 calculation failed");
  }
  return digest_hex(digest.data(), digest.size());
}

void validate_vad_model_identity(const fs::path& path) {
  constexpr std::uintmax_t expected_size = 1245151;
  constexpr const char* expected_sha256 =
      "4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2";
  if (!fs::is_regular_file(path)) {
    throw BackendError("vad_model_missing", "Silero VAD model is missing");
  }
  if (fs::file_size(path) != expected_size || sha256_file(path) != expected_sha256) {
    throw BackendError("vad_model_identity_mismatch", "Silero VAD model identity is invalid");
  }
}

std::vector<float> make_vad_rows(const std::vector<float>& samples) {
  if (samples.empty()) {
    throw BackendError("vad_invalid_audio", "Silero VAD requires non-empty audio");
  }
  const std::size_t padding = vad_window_samples
      - samples.size() % static_cast<std::size_t>(vad_window_samples);
  std::vector<float> padded(samples);
  padded.resize(samples.size() + padding, 0.0f);
  const std::size_t rows = padded.size() / vad_window_samples;
  std::vector<float> result(
      rows * static_cast<std::size_t>(vad_window_samples + vad_context_samples),
      0.0f);
  for (std::size_t row = 0; row < rows; ++row) {
    float* destination = result.data()
        + row * static_cast<std::size_t>(vad_window_samples + vad_context_samples);
    if (row > 0) {
      const std::size_t context_start = row * vad_window_samples - vad_context_samples;
      std::copy_n(
          padded.data() + context_start,
          vad_context_samples,
          destination);
    }
    std::copy_n(
        padded.data() + row * vad_window_samples,
        vad_window_samples,
        destination + vad_context_samples);
  }
  return result;
}

std::vector<VadSpeechInterval> pad_vad_intervals(
    std::vector<VadSpeechInterval> intervals,
    std::size_t original_sample_count) {
  const std::int64_t source_end = static_cast<std::int64_t>(original_sample_count);
  const std::int64_t speech_pad_samples = sample_rate * vad_speech_pad_ms / 1000;
  for (std::size_t index = 0; index < intervals.size(); ++index) {
    VadSpeechInterval& interval = intervals[index];
    if (index == 0) {
      interval.start_sample = std::max<std::int64_t>(
          0,
          interval.start_sample - speech_pad_samples);
    }
    if (index + 1 < intervals.size()) {
      VadSpeechInterval& next = intervals[index + 1];
      const std::int64_t silence = next.start_sample - interval.end_sample;
      if (silence < 2 * speech_pad_samples) {
        const std::int64_t half = silence / 2;
        interval.end_sample += half;
        next.start_sample = std::max<std::int64_t>(0, next.start_sample - half);
      } else {
        interval.end_sample = std::min(source_end, interval.end_sample + speech_pad_samples);
        next.start_sample = std::max<std::int64_t>(0, next.start_sample - speech_pad_samples);
      }
    } else {
      interval.end_sample = std::min(source_end, interval.end_sample + speech_pad_samples);
    }
  }

  std::int64_t previous_end = 0;
  std::int64_t silence_before = 0;
  std::int64_t compressed_end = 0;
  for (VadSpeechInterval& interval : intervals) {
    if (interval.start_sample < previous_end
        || interval.start_sample < 0
        || interval.end_sample <= interval.start_sample
        || interval.end_sample > source_end) {
      throw BackendError("vad_interval_invalid", "Silero VAD produced invalid speech intervals");
    }
    silence_before += interval.start_sample - previous_end;
    compressed_end += interval.end_sample - interval.start_sample;
    interval.silence_before_samples = silence_before;
    interval.compressed_end_sample = compressed_end;
    previous_end = interval.end_sample;
  }
  return intervals;
}

std::vector<VadSpeechInterval> make_vad_intervals(
    const std::vector<float>& probabilities,
    std::size_t original_sample_count) {
  if (original_sample_count == 0) {
    throw BackendError("vad_invalid_audio", "Silero VAD requires non-empty audio");
  }
  const std::int64_t min_silence_samples = sample_rate * vad_min_silence_ms / 1000;
  bool triggered = false;
  std::int64_t current_start = 0;
  std::int64_t temporary_end = 0;
  std::vector<VadSpeechInterval> intervals;

  for (std::size_t index = 0; index < probabilities.size(); ++index) {
    const float probability = probabilities[index];
    if (!std::isfinite(probability) || probability < 0.0f || probability > 1.0f) {
      throw BackendError("vad_nonfinite_output", "Silero VAD returned an invalid probability");
    }
    const std::int64_t sample = static_cast<std::int64_t>(index) * vad_window_samples;
    if (probability >= vad_threshold && temporary_end != 0) {
      temporary_end = 0;
    }
    if (probability >= vad_threshold && !triggered) {
      triggered = true;
      current_start = sample;
      continue;
    }
    if (probability < vad_negative_threshold && triggered) {
      if (temporary_end == 0) {
        temporary_end = sample;
      }
      if (sample - temporary_end < min_silence_samples) {
        continue;
      }
      if (temporary_end > current_start) {
        intervals.push_back({current_start, temporary_end, 0, 0});
      }
      triggered = false;
      current_start = 0;
      temporary_end = 0;
    }
  }

  const std::int64_t source_end = static_cast<std::int64_t>(original_sample_count);
  if (triggered && source_end - current_start > 0) {
    intervals.push_back({current_start, source_end, 0, 0});
  }

  return pad_vad_intervals(std::move(intervals), original_sample_count);
}

std::int64_t round_samples_to_10ms(std::int64_t sample) {
  if (sample < 0) {
    throw BackendError("vad_timestamp_restoration_failed", "Restored timestamp is negative");
  }
  std::int64_t units = sample / 160;
  const std::int64_t remainder = sample % 160;
  if (remainder > 80 || (remainder == 80 && units % 2 != 0)) {
    ++units;
  }
  return units * 10;
}

std::size_t vad_interval_index(
    const std::vector<VadSpeechInterval>& intervals,
    std::int64_t compressed_sample,
    bool is_end) {
  if (intervals.empty() || compressed_sample < 0) {
    throw BackendError("vad_timestamp_restoration_failed", "VAD timestamp map is empty or invalid");
  }
  if (is_end) {
    const auto exact = std::find_if(
        intervals.begin(),
        intervals.end(),
        [&](const VadSpeechInterval& interval) {
          return interval.compressed_end_sample == compressed_sample;
        });
    if (exact != intervals.end()) {
      return static_cast<std::size_t>(exact - intervals.begin());
    }
  }
  const auto iterator = std::upper_bound(
      intervals.begin(),
      intervals.end(),
      compressed_sample,
      [](std::int64_t sample, const VadSpeechInterval& interval) {
        return sample < interval.compressed_end_sample;
      });
  return iterator == intervals.end()
      ? intervals.size() - 1
      : static_cast<std::size_t>(iterator - intervals.begin());
}

std::int64_t restore_vad_time_ms(
    const std::vector<VadSpeechInterval>& intervals,
    std::int64_t compressed_time_ms,
    bool is_end) {
  if (compressed_time_ms < 0
      || compressed_time_ms > std::numeric_limits<std::int64_t>::max() / 16) {
    throw BackendError("vad_timestamp_restoration_failed", "Compressed timestamp is invalid");
  }
  const std::int64_t compressed_sample = compressed_time_ms * 16;
  const std::size_t index = vad_interval_index(intervals, compressed_sample, is_end);
  return round_samples_to_10ms(
      compressed_sample + intervals[index].silence_before_samples);
}

std::vector<float> compress_vad_audio(
    const std::vector<float>& samples,
    const std::vector<VadSpeechInterval>& intervals) {
  std::size_t size = 0;
  for (const VadSpeechInterval& interval : intervals) {
    size += static_cast<std::size_t>(interval.end_sample - interval.start_sample);
  }
  std::vector<float> compressed;
  compressed.reserve(size);
  for (const VadSpeechInterval& interval : intervals) {
    compressed.insert(
        compressed.end(),
        samples.begin() + interval.start_sample,
        samples.begin() + interval.end_sample);
  }
  return compressed;
}

void validate_vad_schema(Ort::Session& session) {
  const std::array<const char*, 3> input_names{"input", "h", "c"};
  const std::array<const char*, 3> output_names{"speech_probs", "hn", "cn"};
  const std::array<std::vector<std::int64_t>, 3> input_shapes{
      std::vector<std::int64_t>{-1, 576},
      std::vector<std::int64_t>{1, 1, 128},
      std::vector<std::int64_t>{1, 1, 128}};
  const std::array<std::vector<std::int64_t>, 3> output_shapes{
      std::vector<std::int64_t>{-1},
      std::vector<std::int64_t>{1, 1, 128},
      std::vector<std::int64_t>{1, 1, 128}};
  if (session.GetInputCount() != input_names.size()
      || session.GetOutputCount() != output_names.size()) {
    throw BackendError("vad_model_schema_mismatch", "Silero VAD model input/output count is invalid");
  }
  Ort::AllocatorWithDefaultOptions allocator;
  for (std::size_t index = 0; index < input_names.size(); ++index) {
    const auto name = session.GetInputNameAllocated(index, allocator);
    const auto info = session.GetInputTypeInfo(index).GetTensorTypeAndShapeInfo();
    if (std::string(name.get()) != input_names[index]
        || info.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT
        || info.GetShape() != input_shapes[index]) {
      throw BackendError("vad_model_schema_mismatch", "Silero VAD model input schema is invalid");
    }
  }
  for (std::size_t index = 0; index < output_names.size(); ++index) {
    const auto name = session.GetOutputNameAllocated(index, allocator);
    const auto info = session.GetOutputTypeInfo(index).GetTensorTypeAndShapeInfo();
    if (std::string(name.get()) != output_names[index]
        || info.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT
        || info.GetShape() != output_shapes[index]) {
      throw BackendError("vad_model_schema_mismatch", "Silero VAD model output schema is invalid");
    }
  }
}

std::unique_ptr<Ort::Session> make_vad_session(
    Ort::Env& environment,
    const fs::path& model_path,
    bool verify_identity) {
  if (verify_identity) {
    validate_vad_model_identity(model_path);
  }
  if (std::string(OrtGetApiBase()->GetVersionString()) != "1.28.0") {
    throw BackendError("vad_runtime_identity_mismatch", "ONNX Runtime version is not 1.28.0");
  }
  const std::vector<std::string> providers = Ort::GetAvailableProviders();
  if (std::find(providers.begin(), providers.end(), "CPUExecutionProvider") == providers.end()) {
    throw BackendError("vad_cpu_provider_missing", "ONNX Runtime CPU provider is unavailable");
  }
  Ort::SessionOptions options;
  options.SetInterOpNumThreads(1);
  options.SetIntraOpNumThreads(1);
  options.DisableCpuMemArena();
  options.SetLogSeverityLevel(4);
  options.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);
  options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
  options.AppendExecutionProvider_CPU(0);
  try {
    auto session = std::make_unique<Ort::Session>(environment, model_path.c_str(), options);
    validate_vad_schema(*session);
    return session;
  } catch (const BackendError&) {
    throw;
  } catch (const std::exception&) {
    throw BackendError("vad_model_load_failed", "Silero VAD model could not be loaded");
  }
}

CandidateBVadResult run_vad_session(
    Ort::Session& session,
    const std::vector<float>& samples,
    std::size_t batch_rows,
    const CancellationCallback& is_cancelled) {
  if (batch_rows == 0 || batch_rows > vad_batch_rows) {
    throw BackendError("vad_runtime_failed", "Silero VAD batch size is invalid");
  }
  check_cancelled(is_cancelled);
  const Clock::time_point started = Clock::now();
  std::vector<float> rows = make_vad_rows(samples);
  const std::size_t row_width = vad_window_samples + vad_context_samples;
  const std::size_t row_count = rows.size() / row_width;
  std::array<float, 128> h{};
  std::array<float, 128> c{};
  std::vector<float> probabilities;
  probabilities.reserve(row_count);
  const std::array<const char*, 3> input_names{"input", "h", "c"};
  const std::array<const char*, 3> output_names{"speech_probs", "hn", "cn"};
  const std::array<std::int64_t, 3> state_shape{1, 1, 128};
  auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  std::size_t batches = 0;

  for (std::size_t begin = 0; begin < row_count; begin += batch_rows) {
    check_cancelled(is_cancelled);
    const std::size_t count = std::min(batch_rows, row_count - begin);
    const std::array<std::int64_t, 2> input_shape{
        static_cast<std::int64_t>(count),
        row_width};
    std::array<Ort::Value, 3> inputs{
        Ort::Value::CreateTensor<float>(
            memory,
            rows.data() + begin * row_width,
            count * row_width,
            input_shape.data(),
            input_shape.size()),
        Ort::Value::CreateTensor<float>(
            memory,
            h.data(),
            h.size(),
            state_shape.data(),
            state_shape.size()),
        Ort::Value::CreateTensor<float>(
            memory,
            c.data(),
            c.size(),
            state_shape.data(),
            state_shape.size())};
    try {
      auto outputs = session.Run(
          Ort::RunOptions{nullptr},
          input_names.data(),
          inputs.data(),
          inputs.size(),
          output_names.data(),
          output_names.size());
      if (outputs.size() != 3
          || outputs[0].GetTensorTypeAndShapeInfo().GetShape()
              != std::vector<std::int64_t>{static_cast<std::int64_t>(count)}
          || outputs[1].GetTensorTypeAndShapeInfo().GetShape()
              != std::vector<std::int64_t>{1, 1, 128}
          || outputs[2].GetTensorTypeAndShapeInfo().GetShape()
              != std::vector<std::int64_t>{1, 1, 128}) {
        throw BackendError("vad_model_schema_mismatch", "Silero VAD runtime output shape is invalid");
      }
      const float* output_probabilities = outputs[0].GetTensorData<float>();
      probabilities.insert(
          probabilities.end(),
          output_probabilities,
          output_probabilities + count);
      const float* hn = outputs[1].GetTensorData<float>();
      const float* cn = outputs[2].GetTensorData<float>();
      if (!std::all_of(hn, hn + h.size(), [](float value) { return std::isfinite(value); })
          || !std::all_of(cn, cn + c.size(), [](float value) { return std::isfinite(value); })) {
        throw BackendError("vad_nonfinite_output", "Silero VAD returned non-finite state");
      }
      std::copy_n(hn, h.size(), h.begin());
      std::copy_n(cn, c.size(), c.begin());
    } catch (const BackendError&) {
      throw;
    } catch (const std::exception&) {
      throw BackendError("vad_runtime_failed", "Silero VAD inference failed");
    }
    ++batches;
    check_cancelled(is_cancelled);
  }

  CandidateBVadResult result;
  result.original_sample_count = samples.size();
  result.padded_sample_count = row_count * vad_window_samples;
  result.row_count = row_count;
  result.batch_count = batches;
  result.inference_ms = elapsed_ms(started);
  result.final_h_sum = std::accumulate(h.begin(), h.end(), 0.0);
  result.final_c_sum = std::accumulate(c.begin(), c.end(), 0.0);
  result.probabilities = std::move(probabilities);
  result.intervals = make_vad_intervals(result.probabilities, samples.size());
  result.compressed_samples = compress_vad_audio(samples, result.intervals);
  return result;
}

std::string token_trace(const std::vector<std::size_t>& ids) {
  std::ostringstream output;
  for (std::size_t index = 0; index < ids.size(); ++index) {
    if (index != 0) {
      output << ',';
    }
    output << ids[index];
  }
  return output.str();
}

bool has_text(const std::string& text) {
  return text.find_first_not_of(" \t\r\n") != std::string::npos;
}

std::int64_t timestamp_ms(
    std::size_t token,
    std::size_t timestamp_begin,
    std::int64_t window_offset_ms) {
  return window_offset_ms
      + static_cast<std::int64_t>(token - timestamp_begin) * timestamp_resolution_ms;
}

SegmentEvidence parse_slice(
    const std::vector<std::size_t>& slice,
    const TokenIds& tokens,
    const DecodeTokens& decode,
    std::int64_t window_offset_ms,
    std::int64_t audio_duration_ms) {
  if (slice.size() < 2 || slice.front() < tokens.timestamp_begin
      || slice.back() < tokens.timestamp_begin
      || slice.front() > tokens.timestamp_begin + 1500
      || slice.back() > tokens.timestamp_begin + 1500) {
    throw BackendError("invalid_generation", "Generated timestamp range is invalid");
  }

  const std::int64_t raw_start = timestamp_ms(
      slice.front(), tokens.timestamp_begin, window_offset_ms);
  const std::int64_t raw_end = timestamp_ms(
      slice.back(), tokens.timestamp_begin, window_offset_ms);
  if (raw_start < window_offset_ms
      || raw_end > window_offset_ms + model_window_duration_ms
      || raw_end <= raw_start) {
    throw BackendError("invalid_generation", "Generated timestamp pair is invalid");
  }
  if (raw_start >= audio_duration_ms) {
    throw BackendError("timestamp_after_audio", "Generated segment starts after WAV end");
  }

  std::vector<std::uint32_t> text_ids;
  for (std::size_t index = 1; index + 1 < slice.size(); ++index) {
    if (slice[index] < tokens.timestamp_begin && slice[index] != tokens.eot) {
      text_ids.push_back(static_cast<std::uint32_t>(slice[index]));
    }
  }
  const std::string text = decode(text_ids);
  const std::int64_t end = std::min(raw_end, audio_duration_ms);
  if (end <= raw_start) {
    throw BackendError("timestamp_after_audio", "Generated segment is empty at WAV end");
  }

  SegmentEvidence evidence;
  evidence.segment = {raw_start, end, text};
  evidence.raw_start_ms = raw_start;
  evidence.raw_end_ms = raw_end;
  evidence.end_bounded_to_audio = raw_end != end;
  evidence.timestamp_start_token = slice.front();
  evidence.timestamp_end_token = slice.back();
  evidence.tokens = slice;
  return evidence;
}

bool same_segment(const SegmentEvidence& left, const SegmentEvidence& right) {
  return left.segment.start_ms == right.segment.start_ms
      && left.segment.end_ms == right.segment.end_ms
      && left.segment.text == right.segment.text;
}

std::vector<std::size_t> make_prompt(
    const TokenIds& tokens,
    const std::vector<std::size_t>& history,
    const CandidateAConfig& config) {
  std::vector<std::size_t> prompt;
  if (config.condition_on_previous_text && !history.empty()) {
    prompt.push_back(tokens.sot_prev);
    constexpr std::size_t history_limit = 448 / 2 - 1;
    const std::size_t begin = history.size() > history_limit
        ? history.size() - history_limit
        : 0;
    prompt.insert(prompt.end(), history.begin() + static_cast<std::ptrdiff_t>(begin), history.end());
  }
  prompt.push_back(tokens.sot);
  prompt.push_back(tokens.japanese);
  prompt.push_back(tokens.transcribe);
  return prompt;
}

float average_log_probability(
    const ctranslate2::models::WhisperGenerationResult& result,
    float length_penalty) {
  if (result.sequences_ids.empty() || result.sequences_ids.front().empty()
      || result.scores.empty()) {
    throw BackendError("invalid_generation", "Generated sequence or score is missing");
  }
  const double length = static_cast<double>(result.sequences_ids.front().size());
  const double cumulative = result.scores.front() * std::pow(length, length_penalty);
  return static_cast<float>(cumulative / (length + 1.0));
}

std::uint32_t utf8_code_point(
    const std::string& text,
    std::size_t index,
    std::size_t& next) {
  const auto byte = [&](std::size_t offset) {
    if (offset >= text.size()) {
      throw BackendError("tokenizer_decode_failed", "Decoded text is invalid UTF-8");
    }
    return static_cast<unsigned char>(text[offset]);
  };
  const unsigned char first = byte(index);
  std::size_t length = 1;
  std::uint32_t value = first;
  if ((first & 0x80) == 0) {
    length = 1;
  } else if ((first & 0xe0) == 0xc0) {
    length = 2;
    value = first & 0x1f;
  } else if ((first & 0xf0) == 0xe0) {
    length = 3;
    value = first & 0x0f;
  } else if ((first & 0xf8) == 0xf0) {
    length = 4;
    value = first & 0x07;
  } else {
    throw BackendError("tokenizer_decode_failed", "Decoded text is invalid UTF-8");
  }
  for (std::size_t offset = 1; offset < length; ++offset) {
    const unsigned char continuation = byte(index + offset);
    if ((continuation & 0xc0) != 0x80) {
      throw BackendError("tokenizer_decode_failed", "Decoded text is invalid UTF-8");
    }
    value = (value << 6) | (continuation & 0x3f);
  }
  if ((length == 2 && value < 0x80)
      || (length == 3 && value < 0x800)
      || (length == 4 && value < 0x10000)
      || value > 0x10ffff
      || (value >= 0xd800 && value <= 0xdfff)) {
    throw BackendError("tokenizer_decode_failed", "Decoded text is invalid UTF-8");
  }
  next = index + length;
  return value;
}

bool python_whitespace(std::uint32_t value) {
  return (value >= 0x09 && value <= 0x0d)
      || (value >= 0x1c && value <= 0x20)
      || value == 0x85
      || value == 0xa0
      || value == 0x1680
      || (value >= 0x2000 && value <= 0x200a)
      || value == 0x2028
      || value == 0x2029
      || value == 0x202f
      || value == 0x205f
      || value == 0x3000;
}

std::string python_strip_utf8(const std::string& text) {
  std::size_t first_non_whitespace = text.size();
  std::size_t end_non_whitespace = 0;
  for (std::size_t index = 0; index < text.size();) {
    std::size_t next = index;
    const std::uint32_t value = utf8_code_point(text, index, next);
    if (!python_whitespace(value)) {
      if (first_non_whitespace == text.size()) {
        first_non_whitespace = index;
      }
      end_non_whitespace = next;
    }
    index = next;
  }
  return first_non_whitespace == text.size()
      ? std::string()
      : text.substr(first_non_whitespace, end_non_whitespace - first_non_whitespace);
}

#ifdef HIKARU_ASR_CT2_WITH_CUDA
class CudaDriverModule {
 public:
  CudaDriverModule()
      : handle_(LoadLibraryW(L"nvcuda.dll")) {
    if (handle_ == nullptr) {
      throw BackendError("cuda_runtime_failed", "CUDA driver module is unavailable");
    }
  }

  ~CudaDriverModule() {
    FreeLibrary(handle_);
  }

  template <typename Function>
  Function symbol(const char* name) const {
    const FARPROC value = GetProcAddress(handle_, name);
    if (value == nullptr) {
      throw BackendError("cuda_runtime_failed", "CUDA driver API is incomplete");
    }
    return reinterpret_cast<Function>(value);
  }

 private:
  HMODULE handle_ = nullptr;
};
#endif

BackendExecutionAttestation validate_execution_config(
    const BackendExecutionConfig& config) {
  BackendExecutionAttestation attestation;
  attestation.config = config;
  if (config.device_index != 0) {
    throw BackendError("execution_config_invalid", "CTranslate2 device index must be 0");
  }
  if (config.device == ExecutionDevice::Cpu) {
    if (config.compute_type != ExecutionComputeType::Int8) {
      throw BackendError("execution_config_invalid", "CPU execution requires INT8");
    }
    return attestation;
  }
  if (config.compute_type != ExecutionComputeType::Float16) {
    throw BackendError("execution_config_invalid", "CUDA execution requires FLOAT16");
  }
#ifndef HIKARU_ASR_CT2_WITH_CUDA
  throw BackendError("cuda_not_built", "This worker was built without CUDA support");
#else
  const CudaDriverModule driver;
  const auto initialize = driver.symbol<decltype(&cuInit)>("cuInit");
  const auto get_driver_version = driver.symbol<decltype(&cuDriverGetVersion)>("cuDriverGetVersion");
  const auto get_device_count = driver.symbol<decltype(&cuDeviceGetCount)>("cuDeviceGetCount");
  const auto get_device = driver.symbol<decltype(&cuDeviceGet)>("cuDeviceGet");
  const auto get_device_name = driver.symbol<decltype(&cuDeviceGetName)>("cuDeviceGetName");
  const auto get_device_attribute = driver.symbol<decltype(&cuDeviceGetAttribute)>("cuDeviceGetAttribute");
  int driver_device_count = 0;
  CUdevice device = 0;
  std::array<char, 256> device_name{};
  if (initialize(0) != CUDA_SUCCESS
      || get_driver_version(&attestation.cuda_driver_api_version) != CUDA_SUCCESS
      || get_device_count(&driver_device_count) != CUDA_SUCCESS) {
    throw BackendError("cuda_runtime_failed", "CUDA driver initialization failed");
  }
  if (driver_device_count <= config.device_index) {
    throw BackendError("cuda_device_unavailable", "CUDA device 0 is unavailable");
  }
  if (get_device(&device, config.device_index) != CUDA_SUCCESS
      || get_device_name(device_name.data(), static_cast<int>(device_name.size()), device) != CUDA_SUCCESS
      || get_device_attribute(
             &attestation.compute_capability_major,
             CU_DEVICE_ATTRIBUTE_COMPUTE_CAPABILITY_MAJOR,
             device) != CUDA_SUCCESS
      || get_device_attribute(
             &attestation.compute_capability_minor,
             CU_DEVICE_ATTRIBUTE_COMPUTE_CAPABILITY_MINOR,
             device) != CUDA_SUCCESS) {
    throw BackendError("cuda_runtime_failed", "CUDA device attestation failed");
  }
  attestation.device_name = device_name.data();
  try {
    attestation.visible_device_count = ctranslate2::get_device_count(ctranslate2::Device::CUDA);
    attestation.compute_type_supported = attestation.compute_capability_major >= 7
        && ctranslate2::mayiuse_float16(ctranslate2::Device::CUDA, config.device_index);
  } catch (const std::exception&) {
    throw BackendError("cuda_runtime_failed", "CTranslate2 CUDA capability detection failed");
  }
  if (attestation.visible_device_count <= config.device_index) {
    throw BackendError("cuda_device_unavailable", "CTranslate2 cannot access CUDA device 0");
  }
  if (!attestation.compute_type_supported) {
    throw BackendError(
        "cuda_compute_type_unsupported",
        "CUDA device 0 does not support FLOAT16");
  }
  return attestation;
#endif
}

ctranslate2::Device ctranslate2_device(ExecutionDevice device) {
  return device == ExecutionDevice::Cuda
      ? ctranslate2::Device::CUDA
      : ctranslate2::Device::CPU;
}

ctranslate2::ComputeType ctranslate2_compute_type(ExecutionComputeType compute_type) {
  return compute_type == ExecutionComputeType::Float16
      ? ctranslate2::ComputeType::FLOAT16
      : ctranslate2::ComputeType::INT8;
}

fs::path validated_tokenizer_path(
    const fs::path& model_path,
    bool require_kotoba_preprocessor) {
  validate_model_directory(model_path, require_kotoba_preprocessor);
  return model_path / "tokenizer.json";
}

}  // namespace

BackendExecutionConfig cpu_execution_config() {
  return {};
}

BackendExecutionConfig cuda_execution_config() {
  return {ExecutionDevice::Cuda, ExecutionComputeType::Float16, 0};
}

CandidateAConfig kotoba_config() {
  CandidateAConfig config;
  config.beam_size = 5;
  config.condition_on_previous_text = false;
  config.timestamp_driven_seek = true;
  config.max_source_frames = 1500;
  return config;
}

CandidateAConfig kotoba_k2_config() {
  CandidateAConfig config = kotoba_config();
  config.max_applied_seek_frames = 1000;
  return config;
}

CandidateAConfig upstream_generation_fallback_config() {
  CandidateAConfig config;
  config.beam_size = 5;
  config.condition_on_previous_text = true;
  config.upstream_generation_fallback = true;
  return config;
}

double upstream_compression_ratio(const std::string& text) {
#ifndef HIKARU_ASR_WHISPER_FALLBACK_PARITY
  static_cast<void>(text);
  throw BackendError(
      "fallback_not_built",
      "This worker was built without exact zlib fallback parity support");
#else
  if (std::string(zlibVersion()) != "1.3.1") {
    throw BackendError("fallback_identity_mismatch", "Exact zlib 1.3.1 is required");
  }
  const std::string stripped = python_strip_utf8(text);
  uLongf compressed_size = compressBound(static_cast<uLong>(stripped.size()));
  std::vector<Bytef> compressed(compressed_size);
  const Bytef* source = stripped.empty()
      ? reinterpret_cast<const Bytef*>("")
      : reinterpret_cast<const Bytef*>(stripped.data());
  if (compress2(
          compressed.data(),
          &compressed_size,
          source,
          static_cast<uLong>(stripped.size()),
          Z_DEFAULT_COMPRESSION) != Z_OK
      || compressed_size == 0) {
    throw BackendError("fallback_compression_failed", "zlib compression failed");
  }
  return static_cast<double>(stripped.size())
      / static_cast<double>(compressed_size);
#endif
}

std::string upstream_zlib_version() {
#ifdef HIKARU_ASR_WHISPER_FALLBACK_PARITY
  return zlibVersion();
#else
  return {};
#endif
}

GenerationFallbackResult run_upstream_generation_fallback(
    const CandidateAConfig& config,
    const FallbackGenerator& generate) {
  const CandidateAConfig expected = upstream_generation_fallback_config();
  if (!generate
      || !config.upstream_generation_fallback
      || config.beam_size != expected.beam_size
      || config.max_length != expected.max_length
      || config.patience != expected.patience
      || config.length_penalty != expected.length_penalty
      || config.repetition_penalty != expected.repetition_penalty
      || config.no_repeat_ngram_size != expected.no_repeat_ngram_size
      || config.no_speech_threshold != expected.no_speech_threshold
      || config.log_prob_threshold != expected.log_prob_threshold
      || !config.condition_on_previous_text
      || !config.timestamp_driven_seek
      || config.prompt_reset_on_temperature != expected.prompt_reset_on_temperature
      || config.temperature != 0.0f
      || config.max_initial_timestamp_index != expected.max_initial_timestamp_index
      || config.max_source_frames != max_model_frames
      || config.max_applied_seek_frames != 0) {
    throw BackendError("config_identity_mismatch", "Fallback candidate config is not closed");
  }

  GenerationFallbackResult result;
  std::vector<std::size_t> below_compression_threshold;
  for (double temperature : upstream_fallback_temperatures) {
    FallbackAttemptOptions options;
    options.temperature = temperature;
    options.sampling = temperature > 0;
    options.beam_size = options.sampling ? 1 : config.beam_size;
    options.patience = config.patience;
    options.num_hypotheses = options.sampling ? upstream_sampling_best_of : 1;
    options.sampling_topk = options.sampling
        ? std::optional<std::size_t>(upstream_sampling_topk)
        : std::nullopt;
    options.sampling_temperature = options.sampling
        ? std::optional<double>(temperature)
        : std::nullopt;

    const FallbackGenerated generated = generate(options);
    if (generated.token_ids.empty()) {
      throw BackendError("invalid_generation", "Generated sequence is empty");
    }
    const double length = static_cast<double>(generated.token_ids.size());
    FallbackAttemptTrace trace;
    trace.options = options;
    trace.token_ids = generated.token_ids;
    trace.score = generated.score;
    trace.average_log_probability =
        generated.score * std::pow(length, config.length_penalty) / (length + 1.0);
    trace.no_speech_probability = generated.no_speech_probability;
    trace.decoded_text = generated.decoded_text;
    trace.compression_ratio = upstream_compression_ratio(generated.decoded_text);
    trace.compression_triggered =
        trace.compression_ratio > upstream_compression_ratio_threshold;
    trace.log_probability_triggered =
        trace.average_log_probability < config.log_prob_threshold;
    trace.silence_override =
        static_cast<double>(generated.no_speech_probability) > upstream_no_speech_threshold
        && trace.log_probability_triggered;
    if (!trace.compression_triggered) {
      below_compression_threshold.push_back(result.attempts.size());
    }
    std::ostringstream identity;
    identity << std::setprecision(17)
             << temperature << '\n'
             << options.beam_size << '\n'
             << options.patience << '\n'
             << options.num_hypotheses << '\n'
             << (options.sampling_topk
                     ? std::to_string(*options.sampling_topk)
                     : std::string("default")) << '\n';
    if (options.sampling_temperature) {
      identity << *options.sampling_temperature;
    } else {
      identity << "default";
    }
    identity << '\n'
             << options.sampling << '\n'
             << trace.average_log_probability << '\n'
             << trace.compression_ratio << '\n'
             << generated.no_speech_probability << '\n'
             << trace.compression_triggered << '\n'
             << trace.log_probability_triggered << '\n'
             << trace.silence_override << '\n'
             << sha256_text(token_trace(generated.token_ids)) << '\n'
             << sha256_text(generated.decoded_text);
    trace.aggregate_sha256 = sha256_text(identity.str());
    result.attempts.push_back(std::move(trace));

    const FallbackAttemptTrace& current = result.attempts.back();
    const bool needs_fallback =
        (current.compression_triggered || current.log_probability_triggered)
        && !current.silence_override;
    if (!needs_fallback) {
      result.selected_attempt_index = result.attempts.size() - 1;
      result.selected_temperature = temperature;
      return result;
    }
  }

  const std::vector<std::size_t> all_indices = [&]() {
    std::vector<std::size_t> values(result.attempts.size());
    std::iota(values.begin(), values.end(), 0);
    return values;
  }();
  const std::vector<std::size_t>& eligible = below_compression_threshold.empty()
      ? all_indices
      : below_compression_threshold;
  result.selected_attempt_index = *std::max_element(
      eligible.begin(),
      eligible.end(),
      [&](std::size_t left, std::size_t right) {
        return result.attempts[left].average_log_probability
            < result.attempts[right].average_log_probability;
      });
  // faster-whisper 1.2.1 reports the final ladder temperature on all-failed
  // selection, even when an earlier result has the highest log probability.
  result.selected_temperature = upstream_fallback_temperatures.back();
  return result;
}

bool kotoba_mel_shape_supported(std::size_t mel_bins) {
  return mel_bins == 128;
}

BackendError::BackendError(std::string code, std::string message)
    : std::runtime_error(std::move(message)), code_(std::move(code)) {}

const std::string& BackendError::code() const noexcept {
  return code_;
}

std::int64_t verified_wav_duration_ms(const fs::path& audio_path) {
  return read_wav(audio_path).duration_ms;
}

std::int64_t source_frame_count(std::size_t sample_count) {
  return static_cast<std::int64_t>(
      (sample_count + static_cast<std::size_t>(hop_length) - 1)
      / static_cast<std::size_t>(hop_length));
}

void validate_model_directory(
    const fs::path& model_path,
    bool require_kotoba_preprocessor) {
  if (!fs::is_directory(model_path)) {
    throw BackendError("model_not_ready", "Model directory is missing");
  }
  for (const char* name : {"config.json", "model.bin", "tokenizer.json"}) {
    const fs::path path = model_path / name;
    if (!fs::is_regular_file(path) || fs::file_size(path) == 0) {
      throw BackendError("model_not_ready", "Required model file is missing");
    }
  }
  if ((!fs::is_regular_file(model_path / "vocabulary.json")
       || fs::file_size(model_path / "vocabulary.json") == 0)
      && (!fs::is_regular_file(model_path / "vocabulary.txt")
          || fs::file_size(model_path / "vocabulary.txt") == 0)) {
    throw BackendError("model_not_ready", "Required model vocabulary is missing");
  }
  if (require_kotoba_preprocessor) {
    const fs::path preprocessor = model_path / "preprocessor_config.json";
    if (!fs::is_regular_file(preprocessor) || fs::file_size(preprocessor) == 0) {
      throw BackendError(
          "kotoba_preprocessor_missing",
          "Kotoba preprocessor metadata is missing");
    }
  }

  std::ifstream config_input(model_path / "config.json");
  Json config = Json::parse(config_input, nullptr, false);
  if (!config.is_object() || !config.contains("alignment_heads")) {
    throw BackendError("model_metadata_invalid", "Whisper model metadata is invalid");
  }
}

TimestampParseResult parse_timestamp_tokens(
    const std::vector<std::size_t>& token_ids,
    const TokenIds& tokens,
    const DecodeTokens& decode,
    std::int64_t window_offset_ms,
    std::int64_t source_window_duration_ms,
    std::int64_t audio_duration_ms) {
  if (token_ids.empty()) {
    throw BackendError("invalid_generation", "Generated token sequence is empty");
  }

  for (std::size_t token : token_ids) {
    if (token >= tokens.timestamp_begin && token > tokens.timestamp_begin + 1500) {
      throw BackendError("invalid_generation", "Generated timestamp exceeds model range");
    }
  }

  TimestampParseResult parsed;
  parsed.single_timestamp_ending = token_ids.size() >= 2
      && token_ids[token_ids.size() - 2] < tokens.timestamp_begin
      && token_ids.back() >= tokens.timestamp_begin;

  std::vector<std::size_t> consecutive;
  for (std::size_t index = 1; index < token_ids.size(); ++index) {
    if (token_ids[index] >= tokens.timestamp_begin
        && token_ids[index - 1] >= tokens.timestamp_begin) {
      consecutive.push_back(index);
    }
  }

  if (!consecutive.empty()) {
    std::vector<std::size_t> slices = consecutive;
    if (parsed.single_timestamp_ending) {
      slices.push_back(token_ids.size());
    }
    std::size_t last_slice = 0;
    for (std::size_t current_slice : slices) {
      std::vector<std::size_t> slice(
          token_ids.begin() + static_cast<std::ptrdiff_t>(last_slice),
          token_ids.begin() + static_cast<std::ptrdiff_t>(current_slice));
      SegmentEvidence segment = parse_slice(
          slice,
          tokens,
          decode,
          window_offset_ms,
          audio_duration_ms);
      parsed.history_tokens.insert(
          parsed.history_tokens.end(),
          slice.begin(),
          slice.end());
      if (has_text(segment.segment.text)) {
        parsed.segments.push_back(std::move(segment));
      }
      last_slice = current_slice;
    }

    if (parsed.single_timestamp_ending) {
      parsed.seek_advance_frames = (source_window_duration_ms + 9) / 10;
    } else {
      const std::size_t end_token = token_ids[consecutive.back() - 1];
      parsed.seek_advance_frames = static_cast<std::int64_t>(
          end_token - tokens.timestamp_begin) * 2;
      parsed.used_decoded_seek = true;
    }
  } else {
    const auto first = std::find_if(token_ids.begin(), token_ids.end(), [&](std::size_t token) {
      return token >= tokens.timestamp_begin;
    });
    const auto last = std::find_if(token_ids.rbegin(), token_ids.rend(), [&](std::size_t token) {
      return token >= tokens.timestamp_begin;
    });
    if (first == token_ids.end() || last == token_ids.rend()
        || &*first == &*last) {
      throw BackendError("invalid_generation", "Generated timestamps do not form a complete pair");
    }
    const std::size_t first_index = static_cast<std::size_t>(first - token_ids.begin());
    const std::size_t last_index = token_ids.size() - 1
        - static_cast<std::size_t>(last - token_ids.rbegin());
    std::vector<std::size_t> slice(
        token_ids.begin() + static_cast<std::ptrdiff_t>(first_index),
        token_ids.begin() + static_cast<std::ptrdiff_t>(last_index + 1));
    SegmentEvidence segment = parse_slice(
        slice,
        tokens,
        decode,
        window_offset_ms,
        audio_duration_ms);
    parsed.history_tokens = slice;
    if (has_text(segment.segment.text)) {
      parsed.segments.push_back(std::move(segment));
    }
    parsed.seek_advance_frames = (source_window_duration_ms + 9) / 10;
  }

  if (parsed.seek_advance_frames <= 0) {
    throw BackendError("invalid_generation", "Generated timestamps did not advance source seek");
  }
  return parsed;
}

std::vector<float> official_log_mel_for_test(
    const std::vector<float>& samples,
    int mel_bins,
    std::int64_t frame_offset,
    int frame_count) {
  return log_mel_window(samples, mel_bins, frame_offset, frame_count);
}

void remove_exact_duplicate_segments(std::vector<SegmentEvidence>& segments) {
  std::vector<SegmentEvidence> unique;
  unique.reserve(segments.size());
  for (SegmentEvidence& segment : segments) {
    const bool duplicate = std::any_of(unique.begin(), unique.end(), [&](const SegmentEvidence& item) {
      return same_segment(item, segment);
    });
    if (!duplicate) {
      unique.push_back(std::move(segment));
    }
  }
  segments = std::move(unique);
}

std::int64_t kotoba_k2_applied_seek_frames(
    std::int64_t proposed_advance_frames,
    std::int64_t remaining_frames,
    std::int64_t max_applied_seek_frames) {
  if (proposed_advance_frames <= 0
      || remaining_frames <= 0
      || max_applied_seek_frames <= 0) {
    throw BackendError("invalid_generation", "K2 seek advance must be positive");
  }
  return std::min({proposed_advance_frames, max_applied_seek_frames, remaining_frames});
}

std::int64_t kotoba_k2_owner_window_index(
    const std::vector<std::int64_t>& window_starts_ms,
    std::int64_t segment_start_ms) {
  if (window_starts_ms.empty()
      || segment_start_ms < 0
      || window_starts_ms.front() != 0
      || !std::is_sorted(window_starts_ms.begin(), window_starts_ms.end())
      || std::adjacent_find(window_starts_ms.begin(), window_starts_ms.end())
          != window_starts_ms.end()) {
    throw BackendError("invalid_generation", "K2 window-start chain is invalid");
  }
  const auto owner = std::upper_bound(
      window_starts_ms.begin(),
      window_starts_ms.end(),
      segment_start_ms);
  return owner == window_starts_ms.begin()
      ? 0
      : static_cast<std::int64_t>(owner - window_starts_ms.begin() - 1);
}

K2CommitResult commit_kotoba_k2_window(
    const std::vector<SegmentEvidence>& parsed_segments,
    std::int64_t ownership_start_ms,
    std::int64_t ownership_end_ms,
    bool final_window,
    std::int64_t audio_duration_ms,
    std::int64_t window_index,
    const std::vector<SegmentEvidence>& already_emitted) {
  if (ownership_start_ms < 0
      || ownership_end_ms <= ownership_start_ms
      || ownership_end_ms > audio_duration_ms
      || final_window != (ownership_end_ms == audio_duration_ms)) {
    throw BackendError("invalid_generation", "K2 ownership interval is invalid");
  }

  K2CommitResult result;
  result.dispositions.reserve(parsed_segments.size());
  for (const SegmentEvidence& segment : parsed_segments) {
    K2SegmentDisposition disposition;
    disposition.segment = segment;
    disposition.tuple_sha256 = sha256_text(
        std::to_string(segment.segment.start_ms) + "\n"
        + std::to_string(segment.segment.end_ms) + "\n"
        + segment.segment.text);
    const bool owned = segment.segment.start_ms >= ownership_start_ms
        && segment.segment.start_ms < ownership_end_ms;
    if (!owned) {
      disposition.owner_window_index = segment.segment.start_ms >= ownership_end_ms
          ? window_index + 1
          : std::max<std::int64_t>(0, window_index - 1);
      disposition.disposition = "non-owner";
      ++result.non_owner_discarded_count;
      result.dispositions.push_back(std::move(disposition));
      continue;
    }

    disposition.owner_window_index = window_index;
    ++result.owned_before_dedup_count;
    const auto duplicate = std::find_if(
        already_emitted.begin(),
        already_emitted.end(),
        [&](const SegmentEvidence& existing) { return same_segment(existing, segment); });
    const auto current_duplicate = std::find_if(
        result.emitted.begin(),
        result.emitted.end(),
        [&](const SegmentEvidence& existing) { return same_segment(existing, segment); });
    if (duplicate != already_emitted.end() || current_duplicate != result.emitted.end()) {
      const SegmentEvidence& target = duplicate != already_emitted.end()
          ? *duplicate
          : *current_duplicate;
      disposition.disposition = "exact-duplicate";
      disposition.duplicate_target_sha256 = sha256_text(
          std::to_string(target.segment.start_ms) + "\n"
          + std::to_string(target.segment.end_ms) + "\n"
          + target.segment.text);
      ++result.exact_duplicate_discarded_count;
      result.dispositions.push_back(std::move(disposition));
      continue;
    }
    if (!has_text(segment.segment.text)
        || segment.segment.start_ms < 0
        || segment.segment.end_ms <= segment.segment.start_ms
        || segment.segment.end_ms > audio_duration_ms
        || (!already_emitted.empty()
            && segment.segment.start_ms < already_emitted.back().segment.start_ms)
        || (!result.emitted.empty()
            && segment.segment.start_ms < result.emitted.back().segment.start_ms)) {
      throw BackendError("invalid_generation", "K2 owned segment timeline is invalid");
    }
    disposition.disposition = "emitted";
    result.emitted.push_back(segment);
    result.dispositions.push_back(std::move(disposition));
  }
  return result;
}

std::vector<float> candidate_b_vad_rows_for_test(const std::vector<float>& samples) {
  return make_vad_rows(samples);
}

std::vector<VadSpeechInterval> candidate_b_intervals_for_test(
    const std::vector<float>& probabilities,
    std::size_t original_sample_count) {
  return make_vad_intervals(probabilities, original_sample_count);
}

std::vector<VadSpeechInterval> candidate_b_pad_intervals_for_test(
    std::vector<VadSpeechInterval> intervals,
    std::size_t original_sample_count) {
  return pad_vad_intervals(std::move(intervals), original_sample_count);
}

std::int64_t candidate_b_restore_time_ms_for_test(
    const std::vector<VadSpeechInterval>& intervals,
    std::int64_t compressed_time_ms,
    bool is_end) {
  return restore_vad_time_ms(intervals, compressed_time_ms, is_end);
}

CandidateBVadResult candidate_b_run_vad_for_test(
    const fs::path& vad_model_path,
    const std::vector<float>& samples,
    std::size_t batch_rows,
    bool verify_identity) {
  Ort::Env environment(ORT_LOGGING_LEVEL_ERROR, "hikaru-candidate-b-test");
  std::unique_ptr<Ort::Session> session = make_vad_session(
      environment,
      vad_model_path,
      verify_identity);
  return run_vad_session(*session, samples, batch_rows, {});
}

void candidate_b_force_ort_run_failure_for_test(const fs::path& vad_model_path) {
  Ort::Env environment(ORT_LOGGING_LEVEL_ERROR, "hikaru-candidate-b-negative-test");
  std::unique_ptr<Ort::Session> session = make_vad_session(
      environment,
      vad_model_path,
      true);
  std::array<float, 575> input{};
  std::array<float, 128> h{};
  std::array<float, 128> c{};
  const std::array<std::int64_t, 2> input_shape{1, 575};
  const std::array<std::int64_t, 3> state_shape{1, 1, 128};
  auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  std::array<Ort::Value, 3> inputs{
      Ort::Value::CreateTensor<float>(
          memory,
          input.data(),
          input.size(),
          input_shape.data(),
          input_shape.size()),
      Ort::Value::CreateTensor<float>(
          memory,
          h.data(),
          h.size(),
          state_shape.data(),
          state_shape.size()),
      Ort::Value::CreateTensor<float>(
          memory,
          c.data(),
          c.size(),
          state_shape.data(),
          state_shape.size())};
  const std::array<const char*, 3> input_names{"input", "h", "c"};
  const std::array<const char*, 3> output_names{"speech_probs", "hn", "cn"};
  try {
    static_cast<void>(session->Run(
        Ort::RunOptions{nullptr},
        input_names.data(),
        inputs.data(),
        inputs.size(),
        output_names.data(),
        output_names.size()));
  } catch (const std::exception&) {
    throw BackendError("vad_runtime_failed", "Silero VAD inference failed");
  }
  throw BackendError("vad_runtime_failed", "Silero VAD invalid-input negative unexpectedly passed");
}

class CTranslate2WhisperBackend::Impl {
 public:
  Impl(
      const fs::path& model_path,
      CandidateAConfig config,
      std::optional<fs::path> vad_model_path,
      BackendExecutionConfig execution,
      bool require_kotoba_model)
      : attestation(validate_execution_config(execution)),
        tokenizer(validated_tokenizer_path(model_path, require_kotoba_model)),
        config(std::move(config)),
        vad_model_path(std::move(vad_model_path)) {
    if (this->config.max_source_frames <= 0
        || this->config.max_source_frames > max_model_frames
        || this->config.max_applied_seek_frames < 0
        || this->config.max_applied_seek_frames > max_model_frames
        || (this->config.max_applied_seek_frames > 0
            && this->config.max_applied_seek_frames > this->config.max_source_frames)) {
      throw BackendError("config_identity_mismatch", "Source window frame limit is invalid");
    }
    if (this->config.upstream_generation_fallback) {
#ifndef HIKARU_ASR_WHISPER_FALLBACK_PARITY
      throw BackendError("fallback_not_built", "Exact fallback parity support is disabled");
#else
      const CandidateAConfig expected = upstream_generation_fallback_config();
      if (!this->vad_model_path
          || this->config.beam_size != expected.beam_size
          || !this->config.condition_on_previous_text
          || !this->config.timestamp_driven_seek
          || this->config.temperature != 0.0f
          || this->config.max_applied_seek_frames != 0
          || upstream_zlib_version() != "1.3.1") {
        throw BackendError(
            "config_identity_mismatch",
            "Fallback parity requires beam5/history-on/exact-VAD identity");
      }
#endif
    }
    tokens.eot = tokenizer.token_to_id("<|endoftext|>");
    tokens.sot = tokenizer.token_to_id("<|startoftranscript|>");
    tokens.japanese = tokenizer.token_to_id("<|ja|>");
    tokens.transcribe = tokenizer.token_to_id("<|transcribe|>");
    tokens.sot_prev = tokenizer.token_to_id("<|startofprev|>");
    tokens.timestamp_begin = tokenizer.token_to_id("<|notimestamps|>") + 1;

    ctranslate2::ReplicaPoolConfig pool;
    intra_threads = std::max(1u, std::thread::hardware_concurrency());
    pool.num_threads_per_replica = intra_threads;
    try {
      model = std::make_unique<ctranslate2::models::Whisper>(
          model_path.u8string(),
          ctranslate2_device(attestation.config.device),
          ctranslate2_compute_type(attestation.config.compute_type),
          std::vector<int>{attestation.config.device_index},
          false,
          pool);
    } catch (const std::exception&) {
      if (attestation.config.device == ExecutionDevice::Cuda) {
        throw BackendError("cuda_model_load_failed", "CUDA model initialization failed");
      }
      throw BackendError("model_load_failed", "CTranslate2 model could not be loaded");
    }
    if (!model->is_multilingual()) {
      throw BackendError("model_contract_mismatch", "Whisper model is not multilingual");
    }
    const std::size_t model_mels = model->n_mels();
    if (model_mels != 80 && model_mels != 128) {
      throw BackendError("model_contract_mismatch", "Whisper model mel shape is unsupported");
    }
    if (require_kotoba_model && !kotoba_mel_shape_supported(model_mels)) {
      throw BackendError("kotoba_mel_shape_mismatch", "Kotoba model must expose 128 mel bins");
    }
    mel_bins = static_cast<int>(model_mels);
  }

  void ensure_vad_session(const CancellationCallback& is_cancelled) {
    if (!vad_model_path || vad_session) {
      return;
    }
    check_cancelled(is_cancelled);
    vad_environment = std::make_unique<Ort::Env>(
        ORT_LOGGING_LEVEL_ERROR,
        "hikaru-candidate-b");
    vad_session = make_vad_session(*vad_environment, *vad_model_path, true);
    check_cancelled(is_cancelled);
  }

  BackendExecutionAttestation attestation;
  Tokenizer tokenizer;
  CandidateAConfig config;
  TokenIds tokens;
  int mel_bins = 0;
  std::size_t intra_threads = 1;
  std::size_t inter_threads = 1;
  std::unique_ptr<ctranslate2::models::Whisper> model;
  std::optional<fs::path> vad_model_path;
  std::unique_ptr<Ort::Env> vad_environment;
  std::unique_ptr<Ort::Session> vad_session;
};

CTranslate2WhisperBackend::CTranslate2WhisperBackend(
    const fs::path& model_path,
    CandidateAConfig config,
    std::optional<fs::path> vad_model_path,
    BackendExecutionConfig execution,
    bool require_kotoba_model)
    : impl_(std::make_unique<Impl>(
          model_path,
          std::move(config),
          std::move(vad_model_path),
          execution,
          require_kotoba_model)) {}

CTranslate2WhisperBackend::~CTranslate2WhisperBackend() = default;

int CTranslate2WhisperBackend::mel_bins() const {
  return impl_->mel_bins;
}

std::size_t CTranslate2WhisperBackend::resolved_intra_threads() const {
  return impl_->intra_threads;
}

std::size_t CTranslate2WhisperBackend::resolved_inter_threads() const {
  return impl_->inter_threads;
}

const TokenIds& CTranslate2WhisperBackend::token_ids() const {
  return impl_->tokens;
}

const BackendExecutionAttestation& CTranslate2WhisperBackend::execution_attestation() const {
  return impl_->attestation;
}

TranscriptionResult CTranslate2WhisperBackend::transcribe(
    const fs::path& audio_path,
    const ProgressCallback& on_progress,
    const SegmentCallback& on_segment,
    const CancellationCallback& is_cancelled) {
  check_cancelled(is_cancelled);
  const wav::Audio audio = read_wav(audio_path);
  TranscriptionResult result;
  result.duration_ms = audio.duration_ms;
  result.original_sample_count = audio.samples.size();
  const Clock::time_point inference_started = Clock::now();
  const bool k2 = impl_->config.max_applied_seek_frames > 0;
  std::size_t window_index = 0;

  CandidateBVadResult vad;
  const std::vector<float>* decode_samples = &audio.samples;
  std::int64_t decode_duration_ms = audio.duration_ms;
  if (impl_->vad_model_path) {
    result.vad_enabled = true;
    impl_->ensure_vad_session(is_cancelled);
    vad = run_vad_session(
        *impl_->vad_session,
        audio.samples,
        vad_batch_rows,
        is_cancelled);
    result.vad_ms = vad.inference_ms;
    result.vad_row_count = vad.row_count;
    result.vad_batch_count = vad.batch_count;
    result.vad_intervals = vad.intervals;
    result.compressed_sample_count = vad.compressed_samples.size();
    decode_samples = &vad.compressed_samples;
    if (decode_samples->empty()) {
      check_cancelled(is_cancelled);
      if (on_progress) {
        on_progress(audio.duration_ms);
      }
      result.inference_ms = elapsed_ms(inference_started);
      return result;
    }
    decode_duration_ms =
        (static_cast<std::int64_t>(decode_samples->size()) * 1000 + sample_rate / 2)
        / sample_rate;
  } else {
    result.compressed_sample_count = audio.samples.size();
  }

  const std::int64_t total_frames = source_frame_count(decode_samples->size());
  std::int64_t seek = 0;
  std::int64_t source_progress = 0;
  std::vector<std::size_t> history;

  while (seek < total_frames) {
    check_cancelled(is_cancelled);
    const int segment_frames = static_cast<int>(std::min<std::int64_t>(
        impl_->config.max_source_frames,
        total_frames - seek));
    const std::int64_t window_offset_ms = seek * 10;
    const std::int64_t source_duration_ms = std::min<std::int64_t>(
        static_cast<std::int64_t>(segment_frames) * 10,
        decode_duration_ms - window_offset_ms);

    WindowTrace trace;
    trace.window_offset_ms = window_offset_ms;
    trace.source_window_duration_ms = source_duration_ms;
    trace.seek_frames_before = seek;
    trace.history_token_count_before = history.size();
    trace.source_progress_before_ms = source_progress;
    trace.vad_timestamp_restored = result.vad_enabled;
    trace.k2_candidate = k2;
    trace.window_index = window_index;
    trace.ownership_start_ms = window_offset_ms;
    trace.last_emitted_start_before_ms = result.segments.empty()
        ? -1
        : result.segments.back().segment.start_ms;

    const Clock::time_point feature_started = Clock::now();
    std::vector<float> mel = log_mel_window(
        *decode_samples,
        impl_->mel_bins,
        seek,
        segment_frames);
    trace.feature_ms = elapsed_ms(feature_started);
    result.feature_ms += trace.feature_ms;
    ctranslate2::StorageView features(
        {1, impl_->mel_bins, max_model_frames},
        std::move(mel));

    ctranslate2::models::WhisperOptions options;
    options.beam_size = impl_->config.beam_size;
    options.patience = impl_->config.patience;
    options.length_penalty = impl_->config.length_penalty;
    options.repetition_penalty = impl_->config.repetition_penalty;
    options.no_repeat_ngram_size = impl_->config.no_repeat_ngram_size;
    options.max_length = impl_->config.max_length;
    options.num_hypotheses = 1;
    options.return_scores = true;
    options.return_no_speech_prob = true;
    options.max_initial_timestamp_index = impl_->config.max_initial_timestamp_index;
    if (!impl_->config.upstream_generation_fallback) {
      options.sampling_temperature = impl_->config.temperature;
    }

    ctranslate2::models::WhisperGenerationResult generated;
    try {
      const std::vector<std::size_t> prompt = make_prompt(
          impl_->tokens,
          history,
          impl_->config);
      trace.prompt_token_count = prompt.size();
      trace.prefix_forward_token_count = prompt.empty() ? 0 : prompt.size() - 1;
      const Clock::time_point generate_started = Clock::now();
      if (impl_->config.upstream_generation_fallback) {
        std::vector<ctranslate2::models::WhisperGenerationResult> generated_attempts;
        const GenerationFallbackResult fallback = run_upstream_generation_fallback(
            impl_->config,
            [&](const FallbackAttemptOptions& attempt) {
              ctranslate2::models::WhisperOptions attempt_options = options;
              attempt_options.beam_size = attempt.beam_size;
              attempt_options.patience = attempt.patience;
              attempt_options.num_hypotheses = attempt.num_hypotheses;
              if (attempt.sampling_topk) {
                attempt_options.sampling_topk = *attempt.sampling_topk;
              }
              if (attempt.sampling_temperature) {
                attempt_options.sampling_temperature =
                    static_cast<float>(*attempt.sampling_temperature);
              }
              auto futures = impl_->model->generate(features, {prompt}, attempt_options);
              if (futures.empty()) {
                throw BackendError(
                    "invalid_generation",
                    "CTranslate2 fallback attempt returned no future");
              }
              ctranslate2::models::WhisperGenerationResult value = futures.front().get();
              if (value.sequences_ids.empty()
                  || value.sequences_ids.front().empty()
                  || value.scores.empty()) {
                throw BackendError(
                    "invalid_generation",
                    "CTranslate2 fallback attempt returned no sequence or score");
              }
              FallbackGenerated summary;
              summary.token_ids = value.sequences_ids.front();
              summary.score = value.scores.front();
              summary.no_speech_probability = value.no_speech_prob;
              std::vector<std::uint32_t> ids;
              ids.reserve(summary.token_ids.size());
              std::transform(
                  summary.token_ids.begin(),
                  summary.token_ids.end(),
                  std::back_inserter(ids),
                  [](std::size_t id) { return static_cast<std::uint32_t>(id); });
              summary.decoded_text = impl_->tokenizer.decode(ids);
              generated_attempts.push_back(std::move(value));
              check_cancelled(is_cancelled);
              return summary;
            });
        generated = std::move(generated_attempts.at(fallback.selected_attempt_index));
        trace.generation_fallback_enabled = true;
        trace.selected_fallback_attempt_index = fallback.selected_attempt_index;
        trace.generation_call_count = fallback.attempts.size();
        trace.fallback_call_count = fallback.attempts.size() - 1;
        trace.selected_temperature = fallback.selected_temperature;
        trace.fallback_attempts = fallback.attempts;
        trace.average_log_probability =
            fallback.attempts[fallback.selected_attempt_index].average_log_probability;
        trace.compression_ratio =
            fallback.attempts[fallback.selected_attempt_index].compression_ratio;
      } else {
        trace.generation_call_count = 1;
        auto futures = impl_->model->generate(features, {prompt}, options);
        generated = futures.front().get();
        trace.selected_temperature = impl_->config.temperature;
      }
      trace.generate_ms = elapsed_ms(generate_started);
      result.generate_ms += trace.generate_ms;
      check_cancelled(is_cancelled);
    } catch (const BackendError&) {
      throw;
    } catch (const std::exception&) {
      throw BackendError("model_runtime_failed", "CTranslate2 generation failed");
    }

    if (generated.sequences_ids.empty()) {
      throw BackendError("invalid_generation", "CTranslate2 returned no sequence");
    }
    trace.token_ids = generated.sequences_ids.front();
    trace.generated_token_count = trace.token_ids.size();
    trace.sha256 = sha256_text(token_trace(trace.token_ids));
    trace.no_speech_probability = generated.no_speech_prob;
    if (!trace.generation_fallback_enabled) {
      trace.average_log_probability = average_log_probability(
          generated,
          impl_->config.length_penalty);
    }

    const double no_speech_threshold = impl_->config.upstream_generation_fallback
        ? upstream_no_speech_threshold
        : static_cast<double>(impl_->config.no_speech_threshold);
    const bool skip_no_speech =
        static_cast<double>(trace.no_speech_probability) > no_speech_threshold
        && trace.average_log_probability <= impl_->config.log_prob_threshold;
    if (skip_no_speech) {
      trace.skipped_as_no_speech = true;
      trace.parse_status = "no-speech";
      const std::int64_t proposed_advance = segment_frames;
      const std::int64_t advance = k2
          ? kotoba_k2_applied_seek_frames(
              proposed_advance,
              total_frames - seek,
              impl_->config.max_applied_seek_frames)
          : proposed_advance;
      trace.parsed_seek_advance_frames = proposed_advance;
      trace.proposed_advance_frames = proposed_advance;
      trace.applied_seek_advance_frames = advance;
      seek += advance;
      trace.seek_frames_after = seek;
      trace.next_window_start_ms = std::min(audio.duration_ms, seek * 10);
      trace.final_window = seek == total_frames;
      trace.ownership_end_ms = trace.final_window
          ? audio.duration_ms
          : trace.next_window_start_ms;
      trace.history_token_count_after = history.size();
      trace.actual_source_overlap_frames = std::max<std::int64_t>(0, segment_frames - advance);
      trace.source_overlap_ms = trace.actual_source_overlap_frames * 10;
      source_progress = result.vad_enabled
          ? std::min(
                audio.duration_ms,
                restore_vad_time_ms(vad.intervals, seek * 10, true))
          : std::min(audio.duration_ms, seek * 10);
      trace.source_progress_after_ms = source_progress;
      trace.last_emitted_start_after_ms = trace.last_emitted_start_before_ms;
      result.traces.push_back(std::move(trace));
      ++window_index;
      if (on_progress) {
        on_progress(source_progress);
      }
      continue;
    }

    try {
      TimestampParseResult parsed = parse_timestamp_tokens(
          trace.token_ids,
          impl_->tokens,
          [&](const std::vector<std::uint32_t>& ids) {
            return impl_->tokenizer.decode(ids);
          },
          window_offset_ms,
          source_duration_ms,
          decode_duration_ms);
      for (SegmentEvidence& segment : parsed.segments) {
        segment.trace_sha256 = trace.sha256;
        if (result.vad_enabled) {
          segment.compressed_start_ms = segment.raw_start_ms;
          segment.compressed_end_ms = segment.raw_end_ms;
          const std::int64_t restored_start = restore_vad_time_ms(
              vad.intervals,
              segment.compressed_start_ms,
              false);
          const std::int64_t restored_raw_end = restore_vad_time_ms(
              vad.intervals,
              segment.compressed_end_ms,
              true);
          if (restored_start >= audio.duration_ms) {
            throw BackendError(
                "vad_timestamp_restoration_failed",
                "Restored segment starts at or after WAV end");
          }
          const std::int64_t restored_end = std::min(
              restored_raw_end,
              audio.duration_ms);
          if (restored_end <= restored_start) {
            throw BackendError(
                "vad_timestamp_restoration_failed",
                "Restored segment range is invalid");
          }
          segment.raw_start_ms = restored_start;
          segment.raw_end_ms = restored_raw_end;
          segment.end_bounded_to_audio = restored_raw_end != restored_end;
          segment.segment.start_ms = restored_start;
          segment.segment.end_ms = restored_end;
          segment.vad_timestamp_restored = true;
        }
        if (!k2) {
          const bool duplicate = std::any_of(
              result.segments.begin(),
              result.segments.end(),
              [&](const SegmentEvidence& existing) {
                return same_segment(existing, segment);
              });
          if (!duplicate) {
            if (!has_text(segment.segment.text)
                || segment.segment.start_ms < 0
                || segment.segment.end_ms <= segment.segment.start_ms
                || segment.segment.end_ms > audio.duration_ms
                || (!result.segments.empty()
                    && segment.segment.start_ms < result.segments.back().segment.start_ms)) {
              throw BackendError("invalid_generation", "Generated segment timeline is invalid");
            }
            if (!result.vad_enabled && on_segment) {
              on_segment(segment.segment);
            }
            result.segments.push_back(segment);
          }
        }
      }
      history.insert(
          history.end(),
          parsed.history_tokens.begin(),
          parsed.history_tokens.end());
      if (!impl_->config.condition_on_previous_text
          || trace.selected_temperature > impl_->config.prompt_reset_on_temperature) {
        history.clear();
      }
      trace.history_token_count_after = history.size();
      const std::int64_t parsed_advance = std::min<std::int64_t>(
          parsed.seek_advance_frames,
          segment_frames);
      const std::int64_t proposed_advance = impl_->config.timestamp_driven_seek
          ? parsed_advance
          : segment_frames;
      const std::int64_t advance = k2
          ? kotoba_k2_applied_seek_frames(
              proposed_advance,
              total_frames - seek,
              impl_->config.max_applied_seek_frames)
          : proposed_advance;
      if (advance <= 0) {
        throw BackendError("invalid_generation", "Generated timestamps did not advance seek");
      }
      trace.parsed_seek_advance_frames = parsed.seek_advance_frames;
      trace.proposed_advance_frames = proposed_advance;
      trace.applied_seek_advance_frames = advance;
      trace.single_timestamp_ending = parsed.single_timestamp_ending;
      trace.used_decoded_seek = parsed.used_decoded_seek;
      seek += advance;
      trace.seek_frames_after = seek;
      trace.next_window_start_ms = std::min(audio.duration_ms, seek * 10);
      trace.final_window = seek == total_frames;
      trace.ownership_end_ms = trace.final_window
          ? audio.duration_ms
          : trace.next_window_start_ms;
      trace.actual_source_overlap_frames = std::max<std::int64_t>(0, segment_frames - advance);
      trace.source_overlap_ms = trace.actual_source_overlap_frames * 10;
      trace.parse_status = parsed.used_decoded_seek ? "decoded-seek" : "source-window-end";

      if (k2) {
        trace.parsed_segment_count = parsed.segments.size();
        K2CommitResult committed = commit_kotoba_k2_window(
            parsed.segments,
            trace.ownership_start_ms,
            trace.ownership_end_ms,
            trace.final_window,
            audio.duration_ms,
            static_cast<std::int64_t>(window_index),
            result.segments);
        trace.owned_before_dedup_count = committed.owned_before_dedup_count;
        trace.non_owner_discarded_count = committed.non_owner_discarded_count;
        trace.exact_duplicate_discarded_count = committed.exact_duplicate_discarded_count;
        trace.emitted_segment_count = committed.emitted.size();
        trace.segment_dispositions = std::move(committed.dispositions);
        for (SegmentEvidence& segment : committed.emitted) {
          if (!result.vad_enabled && on_segment) {
            on_segment(segment.segment);
          }
          result.segments.push_back(std::move(segment));
        }
      }
      trace.last_emitted_start_after_ms = result.segments.empty()
          ? -1
          : result.segments.back().segment.start_ms;
      source_progress = result.vad_enabled
          ? std::min(
                audio.duration_ms,
                restore_vad_time_ms(vad.intervals, seek * 10, true))
          : std::min(audio.duration_ms, seek * 10);
      if (source_progress < trace.source_progress_before_ms) {
        throw BackendError(
            "vad_timestamp_restoration_failed",
            "Restored source progress regressed");
      }
      trace.source_progress_after_ms = source_progress;
    } catch (const BackendError& error) {
      trace.parse_status = "failed";
      trace.parse_error = error.code();
      trace.seek_frames_after = seek;
      trace.history_token_count_after = history.size();
      trace.source_progress_after_ms = source_progress;
      result.failure_code = error.code();
      result.traces.push_back(std::move(trace));
      result.inference_ms = elapsed_ms(inference_started);
      return result;
    }

    result.traces.push_back(std::move(trace));
    ++window_index;
    if (on_progress) {
      on_progress(source_progress);
    }
  }

  if (k2) {
    std::vector<std::int64_t> window_starts_ms;
    window_starts_ms.reserve(result.traces.size());
    for (const WindowTrace& trace : result.traces) {
      window_starts_ms.push_back(trace.ownership_start_ms);
    }
    for (WindowTrace& trace : result.traces) {
      for (K2SegmentDisposition& disposition : trace.segment_dispositions) {
        disposition.owner_window_index = kotoba_k2_owner_window_index(
            window_starts_ms,
            disposition.segment.segment.start_ms);
      }
    }
  }
  remove_exact_duplicate_segments(result.segments);
  if (result.vad_enabled && on_segment) {
    for (const SegmentEvidence& segment : result.segments) {
      on_segment(segment.segment);
    }
  }
  check_cancelled(is_cancelled);
  if (on_progress && (!k2 || source_progress != audio.duration_ms)) {
    on_progress(audio.duration_ms);
  }
  result.inference_ms = elapsed_ms(inference_started);
  return result;
}

#ifdef HIKARU_ASR_WHISPER_PARITY_BISECT
TranscriptionResult CTranslate2WhisperBackend::transcribe_precomputed_mel_for_test(
    std::vector<float> mel,
    std::size_t source_sample_count,
    std::int64_t audio_duration_ms,
    const CancellationCallback& is_cancelled) {
  check_cancelled(is_cancelled);
  if (impl_->mel_bins != 128
      || impl_->config.beam_size != 5
      || !impl_->config.condition_on_previous_text
      || !impl_->config.timestamp_driven_seek
      || impl_->config.upstream_generation_fallback
      || impl_->config.temperature != 0.0f
      || impl_->config.max_source_frames != max_model_frames
      || impl_->config.max_applied_seek_frames != 0) {
    throw BackendError(
        "config_identity_mismatch",
        "Execution parity requires the exact large-v3 short first-attempt identity");
  }
  if (source_sample_count != 385637
      || audio_duration_ms != 24102
      || source_frame_count(source_sample_count) != 2411
      || mel.size() != static_cast<std::size_t>(impl_->mel_bins * max_model_frames)) {
    throw BackendError(
        "feature_invalid_input",
        "Execution parity input shape or source identity drifted");
  }

  const Clock::time_point inference_started = Clock::now();
  TranscriptionResult result;
  result.duration_ms = audio_duration_ms;
  result.original_sample_count = source_sample_count;
  result.compressed_sample_count = source_sample_count;

  WindowTrace trace;
  trace.window_offset_ms = 0;
  trace.source_window_duration_ms = audio_duration_ms;
  trace.seek_frames_before = 0;
  trace.source_progress_before_ms = 0;
  trace.window_index = 0;
  trace.ownership_start_ms = 0;
  trace.ownership_end_ms = audio_duration_ms;
  trace.final_window = true;

  ctranslate2::StorageView features(
      {1, impl_->mel_bins, max_model_frames},
      std::move(mel));
  ctranslate2::models::WhisperOptions options;
  options.beam_size = impl_->config.beam_size;
  options.patience = impl_->config.patience;
  options.length_penalty = impl_->config.length_penalty;
  options.repetition_penalty = impl_->config.repetition_penalty;
  options.no_repeat_ngram_size = impl_->config.no_repeat_ngram_size;
  options.max_length = impl_->config.max_length;
  options.num_hypotheses = 1;
  options.return_scores = true;
  options.return_no_speech_prob = true;
  options.max_initial_timestamp_index = impl_->config.max_initial_timestamp_index;
  options.sampling_temperature = 0.0f;

  ctranslate2::models::WhisperGenerationResult generated;
  try {
    const std::vector<std::size_t> prompt = make_prompt(
        impl_->tokens,
        {},
        impl_->config);
    trace.prompt_token_count = prompt.size();
    trace.prefix_forward_token_count = prompt.empty() ? 0 : prompt.size() - 1;
    const Clock::time_point generate_started = Clock::now();
    auto futures = impl_->model->generate(features, {prompt}, options);
    if (futures.empty()) {
      throw BackendError(
          "invalid_generation",
          "Execution parity generation returned no future");
    }
    generated = futures.front().get();
    trace.generate_ms = elapsed_ms(generate_started);
    result.generate_ms = trace.generate_ms;
    trace.generation_call_count = 1;
    trace.fallback_call_count = 0;
    trace.selected_temperature = 0.0;
    check_cancelled(is_cancelled);
  } catch (const BackendError&) {
    throw;
  } catch (const std::exception&) {
    throw BackendError(
        "model_runtime_failed",
        "Execution parity CTranslate2 generation failed");
  }

  if (generated.sequences_ids.empty() || generated.scores.empty()) {
    throw BackendError(
        "invalid_generation",
        "Execution parity CTranslate2 returned no sequence or score");
  }
  trace.token_ids = generated.sequences_ids.front();
  trace.generated_token_count = trace.token_ids.size();
  trace.sha256 = sha256_text(token_trace(trace.token_ids));
  trace.no_speech_probability = generated.no_speech_prob;
  trace.average_log_probability = average_log_probability(
      generated,
      impl_->config.length_penalty);
  const bool skip_no_speech =
      static_cast<double>(trace.no_speech_probability) > upstream_no_speech_threshold
      && trace.average_log_probability <= impl_->config.log_prob_threshold;
  if (skip_no_speech) {
    trace.skipped_as_no_speech = true;
    trace.parse_status = "no-speech";
    trace.seek_frames_after = source_frame_count(source_sample_count);
    trace.source_progress_after_ms = audio_duration_ms;
    result.traces.push_back(std::move(trace));
    result.inference_ms = elapsed_ms(inference_started);
    return result;
  }

  try {
    TimestampParseResult parsed = parse_timestamp_tokens(
        trace.token_ids,
        impl_->tokens,
        [&](const std::vector<std::uint32_t>& ids) {
          return impl_->tokenizer.decode(ids);
        },
        0,
        audio_duration_ms,
        audio_duration_ms);
    for (SegmentEvidence& segment : parsed.segments) {
      segment.trace_sha256 = trace.sha256;
      if (!has_text(segment.segment.text)
          || segment.segment.start_ms < 0
          || segment.segment.end_ms <= segment.segment.start_ms
          || segment.segment.end_ms > audio_duration_ms
          || (!result.segments.empty()
              && segment.segment.start_ms < result.segments.back().segment.start_ms)) {
        throw BackendError(
            "invalid_generation",
            "Execution parity generated segment timeline is invalid");
      }
      result.segments.push_back(std::move(segment));
    }
    trace.parsed_seek_advance_frames = parsed.seek_advance_frames;
    trace.proposed_advance_frames = parsed.seek_advance_frames;
    trace.applied_seek_advance_frames = parsed.seek_advance_frames;
    trace.seek_frames_after = source_frame_count(source_sample_count);
    trace.single_timestamp_ending = parsed.single_timestamp_ending;
    trace.used_decoded_seek = parsed.used_decoded_seek;
    trace.parse_status = parsed.used_decoded_seek
        ? "decoded-seek"
        : "source-window-end";
    trace.parsed_segment_count = result.segments.size();
    trace.emitted_segment_count = result.segments.size();
    trace.history_token_count_after = 0;
    trace.source_progress_after_ms = audio_duration_ms;
    trace.last_emitted_start_after_ms = result.segments.empty()
        ? -1
        : result.segments.back().segment.start_ms;
  } catch (const BackendError& error) {
    trace.parse_status = "failed";
    trace.parse_error = error.code();
    trace.seek_frames_after = 0;
    trace.source_progress_after_ms = 0;
    result.failure_code = error.code();
  }

  result.traces.push_back(std::move(trace));
  remove_exact_duplicate_segments(result.segments);
  check_cancelled(is_cancelled);
  result.inference_ms = elapsed_ms(inference_started);
  return result;
}
#endif

}  // namespace hikaru_asr::whisper
