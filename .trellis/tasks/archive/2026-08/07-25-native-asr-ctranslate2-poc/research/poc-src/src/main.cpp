#include <windows.h>
#include <bcrypt.h>
#include <psapi.h>

#include <ctranslate2/models/whisper.h>
#include <nlohmann/json.hpp>
#include <pocketfft_hdronly.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cmath>
#include <complex>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <future>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <numeric>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

extern "C" {
struct PocTokenizerHandle;
PocTokenizerHandle* poc_tokenizer_open(const char* path);
void poc_tokenizer_close(PocTokenizerHandle* handle);
int poc_tokenizer_token_to_id(PocTokenizerHandle* handle, const char* token, uint32_t* output);
int poc_tokenizer_encode(PocTokenizerHandle* handle, const char* text, uint32_t** ids, size_t* len);
void poc_tokenizer_ids_free(uint32_t* ids, size_t len);
char* poc_tokenizer_decode(PocTokenizerHandle* handle, const uint32_t* ids, size_t len, int skip_special);
void poc_tokenizer_string_free(char* value);
size_t poc_tokenizer_last_error(char* buffer, size_t capacity);
}

namespace fs = std::filesystem;
using Json = nlohmann::json;
using Clock = std::chrono::steady_clock;

namespace {
constexpr int kSampleRate = 16000;
constexpr int kFftSize = 400;
constexpr int kHopLength = 160;
constexpr int kMelCount = 128;
constexpr int kMaxFrames = 3000;
constexpr int kTimestampResolutionMs = 20;
constexpr double kPi = 3.141592653589793238462643383279502884;
constexpr uint32_t kExpectedSot = 50258;
constexpr uint32_t kExpectedJa = 50266;
constexpr uint32_t kExpectedTranscribe = 50360;
constexpr uint32_t kExpectedEot = 50257;
constexpr uint32_t kExpectedTimestampBegin = 50365;
constexpr int64_t kModelWindowDurationMs = static_cast<int64_t>(kMaxFrames) * kHopLength * 1000 / kSampleRate;
const Clock::time_point kProcessStarted = Clock::now();

#ifndef POC_LOCAL_ROOT
#error POC_LOCAL_ROOT must name the task-local ignored research/local directory
#endif

class ControlledError : public std::runtime_error {
public:
  using std::runtime_error::runtime_error;
};

double elapsed_ms(const Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

std::string tokenizer_error() {
  std::array<char, 512> buffer{};
  poc_tokenizer_last_error(buffer.data(), buffer.size());
  return buffer.data();
}

class Tokenizer {
public:
  explicit Tokenizer(const fs::path& path) {
    const std::string value = path.u8string();
    _handle = poc_tokenizer_open(value.c_str());
    if (_handle == nullptr)
      throw ControlledError("tokenizer-open: " + tokenizer_error());
  }

  ~Tokenizer() {
    poc_tokenizer_close(_handle);
  }

  Tokenizer(const Tokenizer&) = delete;
  Tokenizer& operator=(const Tokenizer&) = delete;

  uint32_t token_to_id(const char* token) const {
    uint32_t id = 0;
    if (!poc_tokenizer_token_to_id(_handle, token, &id))
      throw ControlledError("tokenizer-token: " + tokenizer_error());
    return id;
  }

  std::vector<uint32_t> encode(const std::string& text) const {
    uint32_t* ids = nullptr;
    size_t len = 0;
    if (!poc_tokenizer_encode(_handle, text.c_str(), &ids, &len))
      throw ControlledError("tokenizer-encode: " + tokenizer_error());
    std::vector<uint32_t> output(ids, ids + len);
    poc_tokenizer_ids_free(ids, len);
    return output;
  }

  std::string decode(const std::vector<uint32_t>& ids) const {
    char* value = poc_tokenizer_decode(_handle, ids.data(), ids.size(), 1);
    if (value == nullptr)
      throw ControlledError("tokenizer-decode: " + tokenizer_error());
    std::string output(value);
    poc_tokenizer_string_free(value);
    return output;
  }

private:
  PocTokenizerHandle* _handle = nullptr;
};

uint16_t read_u16(std::istream& input) {
  std::array<unsigned char, 2> bytes{};
  if (!input.read(reinterpret_cast<char*>(bytes.data()), bytes.size()))
    throw ControlledError("wav-truncated");
  return static_cast<uint16_t>(bytes[0] | (bytes[1] << 8));
}

uint32_t read_u32(std::istream& input) {
  std::array<unsigned char, 4> bytes{};
  if (!input.read(reinterpret_cast<char*>(bytes.data()), bytes.size()))
    throw ControlledError("wav-truncated");
  return static_cast<uint32_t>(bytes[0])
       | (static_cast<uint32_t>(bytes[1]) << 8)
       | (static_cast<uint32_t>(bytes[2]) << 16)
       | (static_cast<uint32_t>(bytes[3]) << 24);
}

std::string read_fourcc(std::istream& input) {
  std::array<char, 4> value{};
  if (!input.read(value.data(), value.size()))
    throw ControlledError("wav-truncated");
  return std::string(value.data(), value.size());
}

struct WavAudio {
  std::vector<float> samples;
  int64_t duration_ms = 0;
};

WavAudio read_wav(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input)
    throw ControlledError("wav-open-failed");
  if (read_fourcc(input) != "RIFF")
    throw ControlledError("wav-not-riff");
  static_cast<void>(read_u32(input));
  if (read_fourcc(input) != "WAVE")
    throw ControlledError("wav-not-wave");

  bool format_ready = false;
  WavAudio audio;
  while (input && !audio.samples.size()) {
    const std::string chunk = read_fourcc(input);
    const uint32_t size = read_u32(input);
    if (chunk == "fmt ") {
      if (size < 16)
        throw ControlledError("wav-invalid-fmt");
      const uint16_t format = read_u16(input);
      const uint16_t channels = read_u16(input);
      const uint32_t sample_rate = read_u32(input);
      static_cast<void>(read_u32(input));
      static_cast<void>(read_u16(input));
      const uint16_t bits = read_u16(input);
      if (format != 1 || channels != 1 || sample_rate != kSampleRate || bits != 16)
        throw ControlledError("wav-requires-16khz-mono-pcm16");
      input.seekg(size - 16, std::ios::cur);
      format_ready = true;
    } else if (chunk == "data") {
      if (!format_ready || size == 0 || size % 2 != 0)
        throw ControlledError("wav-invalid-data");
      const size_t count = size / 2;
      audio.samples.resize(count);
      std::vector<int16_t> pcm(count);
      if (!input.read(reinterpret_cast<char*>(pcm.data()), size))
        throw ControlledError("wav-truncated-data");
      std::transform(pcm.begin(), pcm.end(), audio.samples.begin(), [](const int16_t value) {
        return static_cast<float>(value) / 32768.0f;
      });
    } else {
      input.seekg(size, std::ios::cur);
    }
    if (size % 2 != 0)
      input.seekg(1, std::ios::cur);
  }
  if (!format_ready || audio.samples.empty())
    throw ControlledError("wav-missing-required-chunk");
  audio.duration_ms = (static_cast<int64_t>(audio.samples.size()) * 1000 + kSampleRate / 2) / kSampleRate;
  return audio;
}

std::vector<float> mel_filters() {
  constexpr int bins = kFftSize / 2 + 1;
  std::array<double, kMelCount + 2> mels{};
  std::array<double, kMelCount + 2> freqs{};
  std::array<double, kMelCount + 1> differences{};
  for (size_t i = 0; i < mels.size(); ++i) {
    mels[i] = 45.245640471924965 * static_cast<double>(i) / static_cast<double>(mels.size() - 1);
    constexpr double f_sp = 200.0 / 3.0;
    constexpr double min_log_mel = 1000.0 / f_sp;
    constexpr double log_step = 0.06875177742094912;
    freqs[i] = mels[i] >= min_log_mel
      ? 1000.0 * std::exp(log_step * (mels[i] - min_log_mel))
      : f_sp * mels[i];
  }
  for (size_t i = 0; i < differences.size(); ++i)
    differences[i] = freqs[i + 1] - freqs[i];

  std::vector<float> filters(kMelCount * bins);
  for (int mel = 0; mel < kMelCount; ++mel) {
    const double scale = 2.0 / (freqs[mel + 2] - freqs[mel]);
    for (int bin = 0; bin < bins; ++bin) {
      const double fft_freq = static_cast<double>(bin) * kSampleRate / kFftSize;
      const double lower = (fft_freq - freqs[mel]) / differences[mel];
      const double upper = (freqs[mel + 2] - fft_freq) / differences[mel + 1];
      filters[mel * bins + bin] = static_cast<float>(std::max(0.0, std::min(lower, upper)) * scale);
    }
  }
  return filters;
}

int64_t reflect_index(int64_t index, const int64_t size) {
  while (index < 0 || index >= size) {
    if (index < 0)
      index = -index;
    else
      index = 2 * size - 2 - index;
  }
  return index;
}

std::vector<float> log_mel_window(const std::vector<float>& original, const int64_t frame_offset, const int frame_count) {
  if (original.empty() || frame_count < 0 || frame_count > kMaxFrames)
    throw ControlledError("feature-invalid-input");
  std::vector<float> waveform = original;
  waveform.resize(waveform.size() + kHopLength, 0.0f);
  const int64_t available_frames = static_cast<int64_t>(waveform.size()) / kHopLength;
  if (frame_offset < 0 || frame_offset + frame_count > available_frames)
    throw ControlledError("feature-frame-range");

  constexpr int bins = kFftSize / 2 + 1;
  constexpr int batch_limit = 256;
  static const std::vector<float> filters = mel_filters();
  std::vector<float> output(kMelCount * kMaxFrames, 0.0f);
  float global_max = -std::numeric_limits<float>::infinity();

  for (int batch_start = 0; batch_start < frame_count; batch_start += batch_limit) {
    const int batch = std::min(batch_limit, frame_count - batch_start);
    std::vector<float> frames(static_cast<size_t>(batch) * kFftSize);
    for (int local = 0; local < batch; ++local) {
      const int64_t center = (frame_offset + batch_start + local) * kHopLength;
      for (int sample = 0; sample < kFftSize; ++sample) {
        const int64_t source = reflect_index(center + sample - kFftSize / 2, static_cast<int64_t>(waveform.size()));
        const float window = 0.5f - 0.5f * std::cos(2.0f * static_cast<float>(kPi) * sample / kFftSize);
        frames[static_cast<size_t>(local) * kFftSize + sample] = waveform[static_cast<size_t>(source)] * window;
      }
    }
    std::vector<std::complex<float>> spectra(static_cast<size_t>(batch) * bins);
    const pocketfft::shape_t shape{static_cast<size_t>(batch), kFftSize};
    const pocketfft::stride_t input_stride{static_cast<ptrdiff_t>(kFftSize * sizeof(float)), static_cast<ptrdiff_t>(sizeof(float))};
    const pocketfft::stride_t output_stride{static_cast<ptrdiff_t>(bins * sizeof(std::complex<float>)), static_cast<ptrdiff_t>(sizeof(std::complex<float>))};
    pocketfft::r2c(shape, input_stride, output_stride, 1, true, frames.data(), spectra.data(), 1.0f, 1);

    for (int local = 0; local < batch; ++local) {
      for (int mel = 0; mel < kMelCount; ++mel) {
        double energy = 0;
        for (int bin = 0; bin < bins; ++bin)
          energy += filters[mel * bins + bin] * std::norm(spectra[static_cast<size_t>(local) * bins + bin]);
        const float value = std::log10(std::max(1e-10f, static_cast<float>(energy)));
        output[static_cast<size_t>(mel) * kMaxFrames + batch_start + local] = value;
        global_max = std::max(global_max, value);
      }
    }
  }
  if (frame_count != 0) {
    const float floor = global_max - 8.0f;
    for (int mel = 0; mel < kMelCount; ++mel) {
      for (int frame = 0; frame < frame_count; ++frame) {
        float& value = output[static_cast<size_t>(mel) * kMaxFrames + frame];
        value = (std::max(value, floor) + 4.0f) / 4.0f;
      }
    }
  }
  return output;
}

std::string digest_hex(const unsigned char* digest, const size_t size) {
  std::ostringstream output;
  for (size_t index = 0; index < size; ++index)
    output << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(digest[index]);
  return output.str();
}

std::string sha256_hex(const std::string& value) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0)
    throw ControlledError("sha256-provider-failed");
  std::array<unsigned char, 32> digest{};
  const NTSTATUS status = BCryptHash(algorithm, nullptr, 0,
    reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())), static_cast<ULONG>(value.size()),
    digest.data(), static_cast<ULONG>(digest.size()));
  BCryptCloseAlgorithmProvider(algorithm, 0);
  if (status != 0)
    throw ControlledError("sha256-failed");
  return digest_hex(digest.data(), digest.size());
}

std::string sha256_file(const fs::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input)
    throw ControlledError("sha256-file-open-failed");

  BCRYPT_ALG_HANDLE algorithm = nullptr;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0)
    throw ControlledError("sha256-provider-failed");
  ULONG object_length = 0;
  ULONG property_length = 0;
  if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH,
                        reinterpret_cast<PUCHAR>(&object_length), sizeof(object_length),
                        &property_length, 0) != 0 || object_length == 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw ControlledError("sha256-object-length-failed");
  }
  std::vector<unsigned char> object(object_length);
  BCRYPT_HASH_HANDLE hash = nullptr;
  if (BCryptCreateHash(algorithm, &hash, object.data(), object_length, nullptr, 0, 0) != 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    throw ControlledError("sha256-create-failed");
  }

  std::vector<unsigned char> buffer(1 << 20);
  while (true) {
    input.read(reinterpret_cast<char*>(buffer.data()), static_cast<std::streamsize>(buffer.size()));
    const std::streamsize count = input.gcount();
    if (count > 0 && BCryptHashData(hash, buffer.data(), static_cast<ULONG>(count), 0) != 0) {
      BCryptDestroyHash(hash);
      BCryptCloseAlgorithmProvider(algorithm, 0);
      throw ControlledError("sha256-data-failed");
    }
    if (input.eof() || !input)
      break;
  }

  std::array<unsigned char, 32> digest{};
  const NTSTATUS finish_status = BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0);
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  if (finish_status != 0)
    throw ControlledError("sha256-finish-failed");
  return digest_hex(digest.data(), digest.size());
}

std::string ids_trace(const std::vector<size_t>& ids) {
  std::ostringstream output;
  for (size_t i = 0; i < ids.size(); ++i) {
    if (i)
      output << ',';
    output << ids[i];
  }
  return output.str();
}

bool has_text(const std::string& value) {
  return value.find_first_not_of(" \t\r\n") != std::string::npos;
}

Json parse_timestamp_segments(
  const std::vector<size_t>& ids,
  const std::function<std::string(const std::vector<uint32_t>&)>& decode,
  const int64_t window_offset_ms,
  const int64_t model_window_duration_ms,
  const int64_t audio_duration_ms) {
  std::vector<size_t> timestamps;
  for (size_t i = 0; i < ids.size(); ++i) {
    if (ids[i] >= kExpectedTimestampBegin && ids[i] <= kExpectedTimestampBegin + 1500)
      timestamps.push_back(i);
  }
  if (timestamps.size() < 2)
    throw ControlledError("timestamp-no-complete-pair");

  Json segments = Json::array();
  size_t start_position = timestamps.front();
  for (size_t timestamp_index = 1; timestamp_index < timestamps.size(); ++timestamp_index) {
    const size_t end_position = timestamps[timestamp_index];
    if (end_position <= start_position + 1) {
      start_position = end_position;
      continue;
    }
    const size_t start_token = ids[start_position];
    const size_t end_token = ids[end_position];
    if (end_token <= start_token)
      throw ControlledError("timestamp-non-positive-pair");
    std::vector<uint32_t> text_ids;
    for (size_t i = start_position + 1; i < end_position; ++i) {
      if (ids[i] < kExpectedTimestampBegin && ids[i] != kExpectedEot)
        text_ids.push_back(static_cast<uint32_t>(ids[i]));
    }
    const std::string text = decode(text_ids);
    if (has_text(text)) {
      const int64_t raw_start_ms = window_offset_ms
        + static_cast<int64_t>(start_token - kExpectedTimestampBegin) * kTimestampResolutionMs;
      const int64_t raw_end_ms = window_offset_ms
        + static_cast<int64_t>(end_token - kExpectedTimestampBegin) * kTimestampResolutionMs;
      if (raw_start_ms < window_offset_ms
          || raw_end_ms > window_offset_ms + model_window_duration_ms)
        throw ControlledError("timestamp-out-of-model-window");
      if (raw_start_ms >= audio_duration_ms)
        throw ControlledError("timestamp-after-audio");
      const int64_t end_ms = std::min(raw_end_ms, audio_duration_ms);
      if (end_ms <= raw_start_ms)
        throw ControlledError("timestamp-empty-after-audio-bound");
      segments.push_back({
        {"startMs", raw_start_ms}, {"endMs", end_ms}, {"text", text},
        {"timestampStartToken", start_token}, {"timestampEndToken", end_token},
        {"timestampStartMsRaw", raw_start_ms}, {"timestampEndMsRaw", raw_end_ms},
        {"timestampEndClampedToAudio", raw_end_ms != end_ms},
        {"tokenStartIndex", start_position}, {"tokenEndIndex", end_position}
      });
    }
    start_position = end_position;
  }
  if (segments.empty())
    throw ControlledError("timestamp-pairs-have-no-text");
  return segments;
}

void validate_segments(const Json& segments, const int64_t duration_ms) {
  if (!segments.is_array() || segments.empty())
    throw ControlledError("segments-empty");
  int64_t previous_start = -1;
  for (const Json& segment : segments) {
    const int64_t start = segment.at("startMs").get<int64_t>();
    const int64_t end = segment.at("endMs").get<int64_t>();
    const std::string text = segment.at("text").get<std::string>();
    if (!has_text(text) || start < 0 || start >= end || end > duration_ms || start < previous_start)
      throw ControlledError("segment-legality-failed");
    if (!segment.contains("timestampStartToken") || !segment.contains("timestampEndToken"))
      throw ControlledError("segment-missing-token-provenance");
    previous_start = start;
  }
}

void validate_model_assets(const fs::path& model, const std::string& engine, const bool require_real_tokenizer) {
  if (engine != "faster-whisper" && engine != "kotoba-faster-whisper")
    throw ControlledError("unsupported-engine");
  for (const char* file : {"config.json", "model.bin", "tokenizer.json", "vocabulary.json"}) {
    const fs::path path = model / file;
    if (!fs::is_regular_file(path) || fs::file_size(path) == 0)
      throw ControlledError(std::string("model-asset-missing:") + file);
  }
  if (engine == "kotoba-faster-whisper") {
    const fs::path preprocessor = model / "preprocessor_config.json";
    if (!fs::is_regular_file(preprocessor) || fs::file_size(preprocessor) == 0)
      throw ControlledError("kotoba-preprocessor-required");
  }
  std::ifstream config_file(model / "config.json");
  Json config;
  config_file >> config;
  if (!config.is_object() || !config.contains("alignment_heads"))
    throw ControlledError("model-config-invalid");
  if (require_real_tokenizer) {
    Tokenizer tokenizer(model / "tokenizer.json");
    const std::array<std::pair<const char*, uint32_t>, 6> goldens{{
      {"<|startoftranscript|>", kExpectedSot}, {"<|ja|>", kExpectedJa},
      {"<|transcribe|>", kExpectedTranscribe}, {"<|endoftext|>", kExpectedEot},
      {"<|0.00|>", kExpectedTimestampBegin}, {"<|30.00|>", kExpectedTimestampBegin + 1500}
    }};
    for (const auto& [token, expected] : goldens) {
      if (tokenizer.token_to_id(token) != expected)
        throw ControlledError("tokenizer-special-golden-mismatch");
    }
    const std::vector<uint32_t> hello = tokenizer.encode(" Hello");
    if (hello != std::vector<uint32_t>{2425} || tokenizer.decode(hello) != " Hello")
      throw ControlledError("tokenizer-text-golden-mismatch");
  }
}

void validate_model_lock(const fs::path& model, const std::string& engine, const fs::path& lock_path) {
  std::ifstream input(lock_path);
  if (!input)
    throw ControlledError("input-lock-open-failed");
  Json lock;
  input >> lock;
  bool matched = false;
  for (const Json& entry : lock.at("models")) {
    if (entry.at("engine").get<std::string>() != engine)
      continue;
    matched = true;
    for (const Json& file : entry.at("files")) {
      const std::string name = file.at("name").get<std::string>();
      const fs::path path = model / name;
      const uintmax_t expected_size = file.at("sizeBytes").get<uintmax_t>();
      if (!fs::is_regular_file(path) || fs::file_size(path) != expected_size)
        throw ControlledError("model-lock-size-mismatch:" + name);
      if (sha256_file(path) != file.at("sha256").get<std::string>())
        throw ControlledError("model-lock-hash-mismatch:" + name);
    }
    break;
  }
  if (!matched)
    throw ControlledError("model-lock-engine-missing");
}

bool is_task_local_output(const fs::path& path) {
  const fs::path root = fs::weakly_canonical(fs::path(POC_LOCAL_ROOT));
  const fs::path candidate = fs::weakly_canonical(path.is_absolute() ? path : fs::absolute(path));
  const fs::path relative = candidate.lexically_relative(root);
  if (relative.empty() || relative.is_absolute())
    return false;
  const auto first = relative.begin();
  return first != relative.end() && *first != "..";
}

void require_task_local_output(const fs::path& path) {
  if (!is_task_local_output(path))
    throw ControlledError("raw-output-must-be-under-task-research-local");
}

Json runtime_binary_identity() {
  std::vector<wchar_t> buffer(32768);
  const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  if (length == 0 || length >= buffer.size())
    throw ControlledError("runtime-binary-path-failed");
  const fs::path path(std::wstring(buffer.data(), length));
  return {{"sizeBytes", fs::file_size(path)}, {"sha256", sha256_file(path)}};
}

void write_pcm_wav(const fs::path& path, const std::vector<int16_t>& pcm) {
  std::ofstream output(path, std::ios::binary);
  const uint32_t data_size = static_cast<uint32_t>(pcm.size() * sizeof(int16_t));
  auto write_u16 = [&output](const uint16_t value) { output.write(reinterpret_cast<const char*>(&value), sizeof(value)); };
  auto write_u32 = [&output](const uint32_t value) { output.write(reinterpret_cast<const char*>(&value), sizeof(value)); };
  output.write("RIFF", 4); write_u32(36 + data_size); output.write("WAVEfmt ", 8); write_u32(16);
  write_u16(1); write_u16(1); write_u32(kSampleRate); write_u32(kSampleRate * 2); write_u16(2); write_u16(16);
  output.write("data", 4); write_u32(data_size);
  output.write(reinterpret_cast<const char*>(pcm.data()), data_size);
}

void self_check() {
  const fs::path root = fs::temp_directory_path() / ("hikaru-ct2-poc-" + std::to_string(GetCurrentProcessId()));
  fs::remove_all(root);
  fs::create_directories(root / "ordinary");
  fs::create_directories(root / "kotoba");
  const auto write_fixture = [](const fs::path& model) {
    std::ofstream(model / "config.json") << "{\"alignment_heads\":[]}";
    for (const char* name : {"model.bin", "tokenizer.json", "vocabulary.json"})
      std::ofstream(model / name, std::ios::binary).put('x');
  };
  write_fixture(root / "ordinary");
  write_fixture(root / "kotoba");
  validate_model_assets(root / "ordinary", "faster-whisper", false);
  bool kotoba_failed = false;
  try {
    validate_model_assets(root / "kotoba", "kotoba-faster-whisper", false);
  } catch (const ControlledError& error) {
    kotoba_failed = std::string(error.what()) == "kotoba-preprocessor-required";
  }
  if (!kotoba_failed)
    throw ControlledError("kotoba-negative-self-check-failed");

  std::vector<int16_t> pcm(kSampleRate);
  for (int i = 0; i < kSampleRate; ++i)
    pcm[i] = static_cast<int16_t>(8192.0 * std::sin(2.0 * kPi * 1000.0 * i / kSampleRate));
  write_pcm_wav(root / "sine.wav", pcm);
  const WavAudio audio = read_wav(root / "sine.wav");
  const int frames = static_cast<int>((audio.samples.size() + kHopLength) / kHopLength);
  const std::vector<float> mel = log_mel_window(audio.samples, 0, frames);
  const auto close = [](const float left, const float right, const float tolerance) { return std::abs(left - right) <= tolerance; };
  if (frames != 101 || !close(mel[0], 0.573474f, 0.0005f)
      || !close(mel[40 * kMaxFrames], 1.256608f, 0.0005f)
      || !close(mel[30 * kMaxFrames + 10], -0.676069f, 0.0005f))
    throw ControlledError("log-mel-golden-mismatch");
  const std::vector<float> silence = log_mel_window(std::vector<float>(kSampleRate, 0.0f), 0, 101);
  if (!close(silence[0], -1.5f, 1e-6f) || silence[101] != 0.0f)
    throw ControlledError("log-mel-silence-golden-mismatch");

  std::ofstream(root / "bad.wav") << "not-wave";
  bool wav_failed = false;
  try {
    static_cast<void>(read_wav(root / "bad.wav"));
  } catch (const ControlledError&) {
    wav_failed = true;
  }
  if (!wav_failed)
    throw ControlledError("malformed-wav-self-check-failed");

  const auto decode_golden = [](const std::vector<uint32_t>& ids) {
    return ids == std::vector<uint32_t>{2425} ? std::string(" Hello") : std::string();
  };
  const auto expect_timestamp_failure = [&decode_golden](const std::vector<size_t>& ids) {
    try {
      static_cast<void>(parse_timestamp_segments(ids, decode_golden, 0, 30000, 30000));
      return false;
    } catch (const ControlledError&) {
      return true;
    }
  };
  if (!expect_timestamp_failure({100, 101, kExpectedEot})
      || !expect_timestamp_failure({kExpectedTimestampBegin, 2425, kExpectedEot})
      || !expect_timestamp_failure({kExpectedTimestampBegin + 50, 2425, kExpectedTimestampBegin + 50}))
    throw ControlledError("timestamp-failure-vector-self-check-failed");
  const Json paired = parse_timestamp_segments(
    {kExpectedTimestampBegin, 2425, kExpectedTimestampBegin + 50}, decode_golden, 0, 30000, 30000);
  const Json consecutive = parse_timestamp_segments(
    {kExpectedTimestampBegin, 2425, kExpectedTimestampBegin + 50,
     kExpectedTimestampBegin + 50, 2425, kExpectedTimestampBegin + 100},
    decode_golden, 0, 30000, 30000);
  const Json leading_silence = parse_timestamp_segments(
    {kExpectedTimestampBegin + 25, 2425, kExpectedTimestampBegin + 50}, decode_golden, 0, 30000, 30000);
  const Json source_bound = parse_timestamp_segments(
    {kExpectedTimestampBegin + 1175, 2425, kExpectedTimestampBegin + 1250},
    decode_golden, 0, 30000, 24102);
  bool after_audio_failed = false;
  try {
    static_cast<void>(parse_timestamp_segments(
      {kExpectedTimestampBegin + 1250, 2425, kExpectedTimestampBegin + 1300},
      decode_golden, 0, 30000, 24102));
  } catch (const ControlledError& error) {
    after_audio_failed = std::string(error.what()) == "timestamp-after-audio";
  }
  const int64_t kotoba_source_window_ms = static_cast<int64_t>(1500) * kHopLength * 1000 / kSampleRate;
  const int64_t final_source_window_ms = std::min<int64_t>(
    static_cast<int64_t>(910) * kHopLength * 1000 / kSampleRate, 9055);
  if (paired.size() != 1 || consecutive.size() != 2
      || leading_silence.front().at("startMs").get<int64_t>() != 500
      || source_bound.front().at("endMs").get<int64_t>() != 24102
      || !source_bound.front().at("timestampEndClampedToAudio").get<bool>()
      || !after_audio_failed || kModelWindowDurationMs != 30000
      || kotoba_source_window_ms != 15000 || final_source_window_ms != 9055)
    throw ControlledError("timestamp-valid-vector-self-check-failed");
  validate_segments(consecutive, 30000);
  fs::remove_all(root);
}

std::string required_arg(const std::vector<std::string>& args, const std::string& name) {
  const auto iterator = std::find(args.begin(), args.end(), name);
  if (iterator == args.end() || std::next(iterator) == args.end())
    throw ControlledError("missing-argument:" + name);
  return *std::next(iterator);
}

int optional_int_arg(const std::vector<std::string>& args, const std::string& name, const int fallback) {
  const auto iterator = std::find(args.begin(), args.end(), name);
  if (iterator == args.end())
    return fallback;
  if (std::next(iterator) == args.end())
    throw ControlledError("missing-argument:" + name);
  const int value = std::stoi(*std::next(iterator));
  if (value <= 0)
    throw ControlledError("invalid-argument:" + name);
  return value;
}

Json run_sample(
  ctranslate2::models::Whisper& model,
  const Tokenizer& tokenizer,
  const WavAudio& audio,
  const std::vector<size_t>& prompt,
  const int window_frames,
  const std::string& run_kind,
  const int repeat_index) {
  const Clock::time_point started = Clock::now();
  double feature_ms = 0;
  double generate_ms = 0;
  Json segments = Json::array();
  Json traces = Json::array();
  const int64_t total_frames = static_cast<int64_t>(audio.samples.size() + kHopLength) / kHopLength;

  for (int64_t seek = 0; seek < total_frames; seek += window_frames) {
    const int frames = static_cast<int>(std::min<int64_t>(window_frames, total_frames - seek));
    const Clock::time_point feature_started = Clock::now();
    std::vector<float> mel = log_mel_window(audio.samples, seek, frames);
    feature_ms += elapsed_ms(feature_started);
    ctranslate2::StorageView features({1, kMelCount, kMaxFrames}, mel);

    ctranslate2::models::WhisperOptions options;
    options.beam_size = 5;
    options.max_length = 448;
    options.num_hypotheses = 1;
    options.return_no_speech_prob = true;
    options.max_initial_timestamp_index = 50;
    const Clock::time_point generate_started = Clock::now();
    auto futures = model.generate(features, {prompt}, options);
    ctranslate2::models::WhisperGenerationResult generated = futures.front().get();
    generate_ms += elapsed_ms(generate_started);
    if (generated.sequences_ids.empty())
      throw ControlledError("generate-empty-sequence");
    const std::vector<size_t>& ids = generated.sequences_ids.front();
    const std::string trace_hash = sha256_hex(ids_trace(ids));
    const int64_t offset_ms = seek * kHopLength * 1000 / kSampleRate;
    const int64_t model_window_duration_ms = kModelWindowDurationMs;
    const int64_t source_window_duration_ms = std::min<int64_t>(
      static_cast<int64_t>(frames) * kHopLength * 1000 / kSampleRate,
      audio.duration_ms - offset_ms);
    Json trace{
      {"windowOffsetMs", offset_ms}, {"windowDurationMs", source_window_duration_ms},
      {"modelWindowDurationMs", model_window_duration_ms}, {"tokenIds", ids},
      {"sha256", trace_hash}, {"noSpeechProbability", generated.no_speech_prob}
    };
    try {
      Json parsed = parse_timestamp_segments(
        ids,
        [&tokenizer](const std::vector<uint32_t>& text_ids) { return tokenizer.decode(text_ids); },
        offset_ms,
        model_window_duration_ms,
        audio.duration_ms);
      for (Json& segment : parsed) {
        segment["traceSha256"] = trace_hash;
        segments.push_back(std::move(segment));
      }
      trace["parseStatus"] = "pass";
    } catch (const ControlledError& error) {
      trace["parseStatus"] = "failed";
      trace["parseError"] = error.what();
      traces.push_back(std::move(trace));
      if (generated.no_speech_prob <= 0.6f) {
        const double inference_ms = elapsed_ms(started);
        return {
          {"status", "failed"}, {"runKind", run_kind}, {"repeatIndex", repeat_index},
          {"segments", segments}, {"tokenTraces", traces},
          {"failure", {{"code", error.what()}, {"windowOffsetMs", offset_ms},
                        {"modelWindowDurationMs", model_window_duration_ms},
                        {"sourceWindowDurationMs", source_window_duration_ms}}},
          {"timings", {
            {"featureMs", feature_ms}, {"modelGenerateMs", generate_ms},
            {"inferenceMs", inference_ms}, {"inferenceRtf", inference_ms / audio.duration_ms}
          }}
        };
      }
      continue;
    }
    traces.push_back(std::move(trace));
  }
  validate_segments(segments, audio.duration_ms);
  const double inference_ms = elapsed_ms(started);
  return {
    {"status", "completed"}, {"runKind", run_kind}, {"repeatIndex", repeat_index},
    {"segments", segments}, {"tokenTraces", traces},
    {"timings", {
      {"featureMs", feature_ms}, {"modelGenerateMs", generate_ms},
      {"inferenceMs", inference_ms}, {"inferenceRtf", inference_ms / audio.duration_ms}
    }}
  };
}

size_t peak_working_set() {
  PROCESS_MEMORY_COUNTERS counters{};
  counters.cb = sizeof(counters);
  if (!GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters)))
    throw ControlledError("rss-measurement-failed");
  return counters.PeakWorkingSetSize;
}

Json native_environment() {
  SYSTEM_INFO system_info{};
  GetNativeSystemInfo(&system_info);
  MEMORYSTATUSEX memory{};
  memory.dwLength = sizeof(memory);
  const bool memory_ready = GlobalMemoryStatusEx(&memory) != 0;

  OSVERSIONINFOW version{};
  version.dwOSVersionInfoSize = sizeof(version);
  using RtlGetVersion = LONG(WINAPI*)(OSVERSIONINFOW*);
  const HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  const auto rtl_get_version = ntdll == nullptr
    ? nullptr
    : reinterpret_cast<RtlGetVersion>(GetProcAddress(ntdll, "RtlGetVersion"));
  const bool version_ready = rtl_get_version != nullptr && rtl_get_version(&version) == 0;

  char* processor = nullptr;
  size_t processor_length = 0;
  static_cast<void>(_dupenv_s(&processor, &processor_length, "PROCESSOR_IDENTIFIER"));
  const std::string processor_name = processor == nullptr ? "unknown" : processor;
  std::free(processor);
  return {
    {"os", "Windows"},
    {"osRelease", version_ready
      ? std::to_string(version.dwMajorVersion) + "." + std::to_string(version.dwMinorVersion)
        + "." + std::to_string(version.dwBuildNumber)
      : "unknown"},
    {"architecture", system_info.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64 ? "x86_64" : "unknown"},
    {"cpu", processor_name},
    {"logicalCores", system_info.dwNumberOfProcessors},
    {"totalMemoryBytes", memory_ready ? Json(memory.ullTotalPhys) : Json(nullptr)},
    {"totalMemoryUnavailableReason", memory_ready ? Json(nullptr) : Json("GlobalMemoryStatusEx failed")},
    {"gpu", {{"devices", nullptr}, {"method", nullptr}, {"unavailableReason", "CPU-only PoC"}}},
    {"runtime", "CTranslate2 C++ public Whisper API"}
  };
}

void run_model(const std::vector<std::string>& args) {
  const fs::path model_path = required_arg(args, "--model");
  const fs::path audio_path = required_arg(args, "--audio");
  const fs::path output_path = required_arg(args, "--output");
  const fs::path lock_path = required_arg(args, "--lock");
  const std::string engine = required_arg(args, "--engine");
  const int repeats = optional_int_arg(args, "--repeats", 1);
  require_task_local_output(output_path);
  validate_model_assets(model_path, engine, true);
  validate_model_lock(model_path, engine, lock_path);
  Tokenizer tokenizer(model_path / "tokenizer.json");
  const std::vector<size_t> prompt{
    tokenizer.token_to_id("<|startoftranscript|>"), tokenizer.token_to_id("<|ja|>"),
    tokenizer.token_to_id("<|transcribe|>")
  };
  const WavAudio audio = read_wav(audio_path);
  const Clock::time_point load_started = Clock::now();
  ctranslate2::ReplicaPoolConfig config;
  config.num_threads_per_replica = std::max(1u, std::thread::hardware_concurrency());
  ctranslate2::models::Whisper whisper(model_path.string(), ctranslate2::Device::CPU,
                                       ctranslate2::ComputeType::INT8, {0}, false, config);
  const double load_ms = elapsed_ms(load_started);
  if (!whisper.is_multilingual() || whisper.n_mels() != kMelCount)
    throw ControlledError("model-whisper-contract-mismatch");

  const int window_seconds = engine == "kotoba-faster-whisper" ? 15 : 30;
  Json samples = Json::array();
  Json failure = nullptr;
  for (int repeat = 0; repeat < repeats; ++repeat) {
    Json sample = run_sample(whisper, tokenizer, audio, prompt, window_seconds * 100,
                             repeat == 0 ? "cold" : "warm", repeat + 1);
    if (repeat == 0) {
      const double cold_total_ms = elapsed_ms(kProcessStarted);
      sample["timings"]["loadMs"] = load_ms;
      sample["timings"]["totalMs"] = cold_total_ms;
      sample["timings"]["totalRtf"] = cold_total_ms / audio.duration_ms;
    }
    if (sample.value("status", "") == "failed") {
      failure = sample.at("failure");
      samples.push_back(std::move(sample));
      break;
    }
    samples.push_back(std::move(sample));
  }

  const std::string status = failure.is_null() ? "completed" : "failed";
  Json result{
    {"schemaVersion", 1}, {"kind", "hikaru-ct2-poc-raw"}, {"status", status},
    {"engine", engine}, {"modelPath", model_path.u8string()}, {"audioPath", audio_path.u8string()},
    {"inputLockSha256", sha256_file(lock_path)},
    {"durationMs", audio.duration_ms}, {"device", "cpu"}, {"computeType", "int8"},
    {"decode", {{"beamSize", 5}, {"maxLength", 448}, {"language", "ja"}}},
    {"window", {{"seconds", window_seconds}, {"contextPolicy", "no-previous-text"}}},
    {"prompt", {{"ids", prompt}, {"sha256", sha256_hex(ids_trace(prompt))}}},
    {"preprocessor", {{"featureSize", kMelCount}, {"sampleRate", kSampleRate}, {"nFft", kFftSize}, {"hopLength", kHopLength}}},
    {"environment", native_environment()},
    {"runtimeBinary", runtime_binary_identity()},
    {"samples", samples},
    {"resources", {{"peakProcessRssBytes", peak_working_set()}, {"method", "GetProcessMemoryInfo.PeakWorkingSetSize"}}}
  };
  if (!failure.is_null())
    result["failure"] = failure;
  fs::create_directories(output_path.parent_path());
  std::ofstream(output_path) << std::setw(2) << result << '\n';
  std::cout << Json{{"status", status}, {"sampleCount", samples.size()},
                    {"segmentCount", samples.front().value("segments", Json::array()).size()}}.dump() << '\n';
}

void validate_evidence(const fs::path& path) {
  std::ifstream input(path);
  Json value;
  input >> value;
  const std::string status = value.value("status", "");
  if (value.value("kind", "") != "hikaru-ct2-poc-raw"
      || (status != "completed" && status != "failed"))
    throw ControlledError("evidence-envelope-invalid");
  const int64_t duration = value.at("durationMs").get<int64_t>();
  for (const Json& sample : value.at("samples")) {
    const Json segments = sample.value("segments", Json::array());
    if (!segments.empty())
      validate_segments(segments, duration);
    if (sample.value("status", "") == "failed") {
      if (!sample.contains("failure") || !sample.at("failure").is_object()
          || !sample.at("failure").contains("code") || sample.at("tokenTraces").empty())
        throw ControlledError("failed-evidence-missing-trace");
      bool retained_failure = false;
      for (const Json& trace : sample.at("tokenTraces")) {
        if (!trace.is_object() || !trace.contains("windowOffsetMs")
            || !trace.contains("windowDurationMs") || !trace.contains("modelWindowDurationMs")
            || !trace.contains("tokenIds") || !trace.at("tokenIds").is_array() || trace.at("tokenIds").empty()
            || !trace.contains("sha256") || trace.at("sha256").get<std::string>().size() != 64)
          throw ControlledError("failed-evidence-trace-fields-invalid");
        if (trace.value("parseStatus", "") == "failed"
            && trace.value("parseError", "") == sample.at("failure").at("code").get<std::string>())
          retained_failure = true;
      }
      if (!retained_failure)
        throw ControlledError("failed-evidence-error-trace-mismatch");
    } else if (segments.empty()) {
      throw ControlledError("completed-evidence-missing-segments");
    }
  }
  std::cout << Json{{"status", "valid"}, {"sampleCount", value.at("samples").size()},
                    {"evidenceStatus", status}}.dump() << '\n';
}

}  // namespace

int main(int argc, char** argv) {
  try {
    const std::vector<std::string> args(argv + 1, argv + argc);
    if (args.empty())
      throw ControlledError("mode-required");
    if (std::find(args.begin(), args.end(), "--self-check") != args.end()) {
      self_check();
      std::cout << "{\"status\":\"pass\",\"checks\":\"model,wav,mel,timestamp,segment\"}\n";
    } else if (std::find(args.begin(), args.end(), "--contract-test") != args.end()) {
      const fs::path model = required_arg(args, "--model");
      const std::string engine = required_arg(args, "--engine");
      validate_model_assets(model, engine, true);
      validate_model_lock(model, engine, required_arg(args, "--lock"));
      std::cout << "{\"status\":\"pass\",\"checks\":\"model,hashes,tokenizer,prompt\"}\n";
    } else if (std::find(args.begin(), args.end(), "--run") != args.end()) {
      run_model(args);
    } else if (std::find(args.begin(), args.end(), "--validate-evidence") != args.end()) {
      validate_evidence(required_arg(args, "--validate-evidence"));
    } else {
      throw ControlledError("unknown-mode");
    }
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "controlled failure: " << error.what() << '\n';
    std::cout << "{\"status\":\"failed\",\"code\":\"controlled-error\"}\n";
    return 2;
  }
}
