#include "crispasr_backend.hpp"
#include "wav_audio.hpp"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>

namespace {

using namespace hikaru_asr;
using namespace hikaru_asr::crisp;
namespace fs = std::filesystem;

void check(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

void write_u16(std::ostream& output, std::uint16_t value) {
  output.put(static_cast<char>(value & 0xff));
  output.put(static_cast<char>((value >> 8) & 0xff));
}

void write_u32(std::ostream& output, std::uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) output.put(static_cast<char>((value >> shift) & 0xff));
}

void write_wav(const fs::path& path, std::int64_t duration_ms = 1000) {
  const std::vector<std::int16_t> samples(
      static_cast<std::size_t>(duration_ms * wav::sample_rate / 1000), 0);
  std::ofstream output(path, std::ios::binary);
  output.write("RIFF", 4);
  write_u32(output, 36 + static_cast<std::uint32_t>(samples.size() * 2));
  output.write("WAVEfmt ", 8);
  write_u32(output, 16);
  write_u16(output, 1);
  write_u16(output, 1);
  write_u32(output, wav::sample_rate);
  write_u32(output, wav::sample_rate * 2);
  write_u16(output, 2);
  write_u16(output, 16);
  output.write("data", 4);
  write_u32(output, static_cast<std::uint32_t>(samples.size() * 2));
  output.write(reinterpret_cast<const char*>(samples.data()), static_cast<std::streamsize>(samples.size() * 2));
}

void write_bad_wav(const fs::path& path, std::uint16_t channels, std::uint32_t sample_rate) {
  const std::vector<std::int16_t> samples(32, 0);
  std::ofstream output(path, std::ios::binary);
  output.write("RIFF", 4);
  write_u32(output, 36 + static_cast<std::uint32_t>(samples.size() * 2));
  output.write("WAVEfmt ", 8);
  write_u32(output, 16);
  write_u16(output, 1);
  write_u16(output, channels);
  write_u32(output, sample_rate);
  write_u32(output, sample_rate * channels * 2);
  write_u16(output, channels * 2);
  write_u16(output, 16);
  output.write("data", 4);
  write_u32(output, static_cast<std::uint32_t>(samples.size() * 2));
  output.write(reinterpret_cast<const char*>(samples.data()), static_cast<std::streamsize>(samples.size() * 2));
}

fs::path temporary_root() {
  const fs::path root = fs::temp_directory_path() / ("hikaru-crispasr-" + std::to_string(GetCurrentProcessId()));
  fs::remove_all(root);
  fs::create_directories(root);
  return root;
}

BackendConfig config(
    Engine engine,
    const fs::path& audio,
    const fs::path& model,
    const fs::path& library,
    std::optional<fs::path> aligner = std::nullopt,
    Device device = Device::Cpu) {
  return BackendConfig{engine, device, audio, model, std::move(aligner), library};
}

struct FakeCounterApi {
  HMODULE module = nullptr;
  void (*reset)() = nullptr;
  int (*get)(int) = nullptr;

  explicit FakeCounterApi(const fs::path& library) {
    module = LoadLibraryExW(
        fs::absolute(library).c_str(),
        nullptr,
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    check(module != nullptr, "fake counter DLL could not be loaded");
    reset = reinterpret_cast<void (*)()>(GetProcAddress(module, "hikaru_fake_crispasr_reset_counters"));
    get = reinterpret_cast<int (*)(int)>(GetProcAddress(module, "hikaru_fake_crispasr_counter"));
    check(reset != nullptr && get != nullptr, "fake counter exports are missing");
  }

  ~FakeCounterApi() {
    if (module) FreeLibrary(module);
  }
};

void check_counts(
    FakeCounterApi& counters,
    const std::vector<int>& expected,
    const std::string& label) {
  for (int index = 0; index < static_cast<int>(expected.size()); ++index) {
    check(counters.get(index) == expected[index], label + " counter drift at " + std::to_string(index));
  }
}

void expect_error(const std::string& code, const std::function<void()>& action) {
  try {
    action();
  } catch (const BackendError& error) {
    check(error.code() == code, "unexpected backend error: " + error.code());
    return;
  }
  throw std::runtime_error("expected backend error was not thrown: " + code);
}

void run_tests(
    const fs::path& library,
    const fs::path& broken_library,
    const fs::path& cuda_marker) {
  FakeCounterApi counters(library);
  const fs::path root = temporary_root();
  const fs::path audio = root / "audio.wav";
  write_wav(audio);
  check(wav::read_pcm16_mono_16khz(audio).duration_ms == 1000, "shared WAV duration drift");
  const fs::path model = root / "model.gguf";
  const fs::path reazon_model = root / "reazon-model.gguf";
  const fs::path aligner = root / "aligner.gguf";
  std::ofstream(model) << "model";
  std::ofstream(reazon_model) << "model";
  std::ofstream(aligner) << "aligner";
  const fs::path stereo = root / "stereo.wav";
  write_bad_wav(stereo, 2, wav::sample_rate);
  expect_error("unsupported_audio_format", [&] {
    CrispAsrBackend backend(config(Engine::Parakeet, stereo, model, library));
  });
  const fs::path truncated = root / "truncated.wav";
  std::ofstream(truncated, std::ios::binary) << "RIFF";
  expect_error("invalid_audio", [&] {
    CrispAsrBackend backend(config(Engine::Parakeet, truncated, model, library));
  });

  check(upstream_backend(Engine::Parakeet) == std::string("parakeet"), "Parakeet route drift");
  check(upstream_backend(Engine::ReazonSpeechNemo) == std::string("parakeet"), "Reazon alias drift");
  check(upstream_backend(Engine::Qwen3Asr) == std::string("qwen3"), "Qwen route drift");
  check(upstream_compatible_path(fs::u8path(R"(\\?\C:\模型\a.gguf)")) == fs::u8path(R"(C:\模型\a.gguf)"),
        "verbatim path normalization drift");
  check(upstream_compatible_path(fs::u8path(R"(\\?\UNC\server\share\a.gguf)"))
            == fs::u8path(R"(\\server\share\a.gguf)"),
        "UNC path normalization drift");

  expect_error("crispasr_abi_mismatch", [&] {
    CrispAsrBackend backend(config(Engine::Parakeet, audio, model, broken_library));
  });

  counters.reset();
  {
    CrispAsrBackend backend(config(Engine::ReazonSpeechNemo, audio, reazon_model, library));
    check(backend.duration_ms() == 1000, "duration drift");
    std::vector<std::int64_t> progress;
    std::vector<Segment> previews;
    const Result result = backend.transcribe(
        [&](std::int64_t value) { progress.push_back(value); },
        [&](const Segment& segment) { previews.push_back(segment); });
    check(progress == std::vector<std::int64_t>({500, 500, 1000}), "progress normalization drift");
    check(previews.size() == 1 && previews[0].text == "preview", "preview copying drift");
    check(result.source_segments.size() == 1 && result.source_segments[0].text == "final", "final copying drift");
    check(result.source_segments[0].words.size() == 1, "nested word ownership drift");
  }
  check_counts(counters, {1, 1, 1, 1, 0, 0, 1, 1, 1, 1}, "Reazon success");

  counters.reset();
  {
    const fs::path same_model = root / "same-preview.gguf";
    std::ofstream(same_model) << "model";
    CrispAsrBackend backend(config(Engine::Parakeet, audio, same_model, library));
    const Result result = backend.transcribe();
    check(result.source_segments[0].text == "preview", "matching preview/final drift");
  }
  check_counts(counters, {1, 1, 1, 1, 0, 0, 1, 1, 1, 1}, "matching preview success");

  const fs::path window_audio = root / "window-audio.wav";
  write_wav(window_audio, 20'000);
  counters.reset();
  {
    CrispAsrBackend backend(config(Engine::Parakeet, window_audio, model, library));
    check(backend.duration_ms() == 20'000, "window duration drift");
    std::vector<std::int64_t> progress;
    std::vector<Segment> previews;
    const Result first = backend.transcribe_window(
        {0, 15'000},
        [&](std::int64_t value) { progress.push_back(value); },
        [&](const Segment& segment) { previews.push_back(segment); });
    const Result second = backend.transcribe_window(
        {15'000, 20'000},
        [&](std::int64_t value) { progress.push_back(value); },
        [&](const Segment& segment) { previews.push_back(segment); });
    check(progress == std::vector<std::int64_t>({500, 500, 15'000, 15'500, 15'500, 20'000}),
          "window progress translation drift");
    check(previews.size() == 2 && previews[1].start_ms == 15'000
              && previews[1].end_ms == 15'500,
          "window preview offset drift");
    check(first.source_segments[0].raw_start_ms == 0
              && first.source_segments[0].raw_end_ms == 600
              && second.source_segments[0].raw_start_ms == 15'000
              && second.source_segments[0].raw_end_ms == 15'600
              && second.source_segments[0].words[0].start_ms == 15'000
              && second.source_segments[0].words[0].end_ms == 15'100,
          "window copied timing offset drift");
  }
  check_counts(counters, {1, 1, 2, 2, 0, 0, 2, 2, 2, 2}, "repeated window success");
  check(counters.get(12) == 2 && counters.get(13) == 5'000 * wav::sample_rate / 1000,
        "window sample slicing drift");

  const fs::path vad_model = root / "ggml-silero-v6.2.0.bin";
  std::ofstream(vad_model) << "vad";
  check(!reazon_vad_identity_matches(vad_model),
        "production VAD identity accepted a wrong-size non-empty asset");
  check(reazon_vad_identity_permitted(vad_model),
        "generic VAD test identity bypass was not isolated from runtime identity");
  const fs::path wrong_hash_vad = root / "wrong-hash-vad.bin";
  {
    std::ofstream output(wrong_hash_vad, std::ios::binary);
    output.seekp(885'097);
    output.put('\0');
  }
  check(fs::file_size(wrong_hash_vad) == 885'098
            && !reazon_vad_identity_matches(wrong_hash_vad),
        "production VAD identity accepted a correct-size wrong-hash asset");
  counters.reset();
  SetEnvironmentVariableA("CRISPASR_PARAKEET_STREAM_THRESHOLD", "12");
  SetEnvironmentVariableA("CRISPASR_PARAKEET_STREAM_CHUNK", "2");
  SetEnvironmentVariableA("CRISPASR_SESSION_UNIFIED_DISPATCH", "1");
  {
    CrispAsrBackend backend(config(Engine::ReazonSpeechNemo, window_audio, reazon_model, library));
    const std::vector<AudioWindow> windows = backend.detect_reazon_vad_windows(vad_model);
    check(windows.size() == 2
              && windows[0].start_ms == 0 && windows[0].end_ms == 12'060
              && windows[1].start_ms == 12'000 && windows[1].end_ms == 20'000,
          "Reazon VAD windows drifted");
    for (const auto& window : windows) backend.transcribe_window(window);
  }
  check_counts(counters, {1, 1, 2, 2, 0, 0, 2, 2, 2, 2}, "Reazon VAD success");
  check(counters.get(14) == 1 && counters.get(15) == 1,
        "VAD spans were not freed exactly once");
  check(counters.get(16) == 500 && counters.get(17) == 250
            && counters.get(18) == 100 && counters.get(19) == 30
            && counters.get(20) == 12'000 && counters.get(21) == 16,
        "frozen VAD parameters drifted");
  check(counters.get(22) == 2 && counters.get(23) == 0,
        "Reazon exact single-pass strategy drifted");
  char inherited[8]{};
  check(GetEnvironmentVariableA("CRISPASR_PARAKEET_STREAM_CHUNK", inherited, sizeof(inherited)) == 0,
        "inherited Parakeet strategy knob was not cleared");

  const fs::path long_window_audio = root / "long-window-audio.wav";
  write_wav(long_window_audio, 540'000);
  SetEnvironmentVariableA("HIKARU_FAKE_CRISPASR_VAD_SCENARIO", "long-float-boundary");
  {
    CrispAsrBackend backend(config(
        Engine::ReazonSpeechNemo, long_window_audio, reazon_model, library));
    const std::vector<AudioWindow> windows = backend.detect_reazon_vad_windows(vad_model);
    check(windows.size() == 2
              && windows[0].start_ms == 510'970 && windows[0].end_ms == 522'930
              && windows[1].start_ms == 522'870 && windows[1].end_ms == 533'630,
          "real long-v2 float endpoint regression drifted");
  }
  for (const char* scenario : {"long-float-overlap61", "long-float-too-long"}) {
    SetEnvironmentVariableA("HIKARU_FAKE_CRISPASR_VAD_SCENARIO", scenario);
    expect_error("crispasr_vad_result_invalid", [&] {
      CrispAsrBackend backend(config(
          Engine::ReazonSpeechNemo, long_window_audio, reazon_model, library));
      backend.detect_reazon_vad_windows(vad_model);
    });
  }

  SetEnvironmentVariableA("HIKARU_FAKE_CRISPASR_VAD_SCENARIO", "energy-split");
  {
    CrispAsrBackend backend(config(Engine::ReazonSpeechNemo, window_audio, reazon_model, library));
    const std::vector<AudioWindow> windows = backend.detect_reazon_vad_windows(vad_model);
    check(windows.size() == 2
              && windows[0].end_ms == 11'870 && windows[1].start_ms == 11'810,
          "upstream energy-minimum split window drifted");
  }
  SetEnvironmentVariableA("HIKARU_FAKE_CRISPASR_VAD_SCENARIO", nullptr);

  expect_error("crispasr_vad_not_supported", [&] {
    CrispAsrBackend backend(config(Engine::Parakeet, window_audio, model, library));
    backend.detect_reazon_vad_windows(vad_model);
  });
  expect_error("crispasr_vad_model_invalid", [&] {
    CrispAsrBackend backend(config(Engine::ReazonSpeechNemo, window_audio, reazon_model, library));
    backend.detect_reazon_vad_windows(root / "missing-vad.bin");
  });
  expect_error("crispasr_window_invalid", [&] {
    CrispAsrBackend backend(config(Engine::ReazonSpeechNemo, window_audio, reazon_model, library));
    backend.transcribe_window({0, 12'061});
  });

  std::vector<std::pair<std::string, std::string>> zero_results;
  for (const char* scenario : {"no-speech-like", "internal-failure-like"}) {
    counters.reset();
    SetEnvironmentVariableA("HIKARU_FAKE_CRISPASR_VAD_SCENARIO", scenario);
    try {
      CrispAsrBackend backend(config(Engine::ReazonSpeechNemo, window_audio, reazon_model, library));
      backend.detect_reazon_vad_windows(vad_model);
      throw std::runtime_error("zero-result VAD scenario unexpectedly succeeded");
    } catch (const BackendError& error) {
      zero_results.emplace_back(error.code(), error.what());
    }
    check(counters.get(14) == 1 && counters.get(15) == 0,
          std::string("zero-result VAD cleanup drifted for ") + scenario);
  }
  check(zero_results.size() == 2 && zero_results[0] == zero_results[1]
            && zero_results[0].first == "crispasr_vad_no_result",
        "indistinguishable zero-result VAD outcomes did not fail identically");

  for (const auto& [scenario, code, expected_frees] :
       std::vector<std::tuple<const char*, const char*, int>>{
           {"error", "crispasr_vad_failed", 0},
           {"error-with-spans", "crispasr_vad_failed", 1},
           {"nonfinite", "crispasr_vad_result_invalid", 1},
           {"negative", "crispasr_vad_result_invalid", 1},
           {"reversed", "crispasr_vad_result_invalid", 1},
           {"outside", "crispasr_vad_result_invalid", 1},
           {"unordered", "crispasr_vad_result_invalid", 1},
           {"overlap61", "crispasr_vad_result_invalid", 1},
           {"nonadjacent", "crispasr_vad_result_invalid", 1},
           {"too-long", "crispasr_vad_result_invalid", 1}}) {
    counters.reset();
    SetEnvironmentVariableA("HIKARU_FAKE_CRISPASR_VAD_SCENARIO", scenario);
    expect_error(code, [&] {
      CrispAsrBackend backend(config(Engine::ReazonSpeechNemo, window_audio, reazon_model, library));
      backend.detect_reazon_vad_windows(vad_model);
    });
    check(counters.get(14) == 1 && counters.get(15) == expected_frees,
          std::string("VAD cleanup drifted for ") + scenario);
  }
  SetEnvironmentVariableA("HIKARU_FAKE_CRISPASR_VAD_SCENARIO", nullptr);

  for (const AudioWindow invalid : std::vector<AudioWindow>{{-1, 1}, {0, 0}, {0, 20'001}}) {
    expect_error("crispasr_window_invalid", [&] {
      CrispAsrBackend backend(config(Engine::Parakeet, window_audio, model, library));
      backend.transcribe_window(invalid);
    });
  }
  expect_error("crispasr_window_invalid", [&] {
    CrispAsrBackend backend(config(Engine::Qwen3Asr, audio, model, library, aligner));
    backend.transcribe_window({0, 1000});
  });

  counters.reset();
  const fs::path second_null = root / "second-null.gguf";
  std::ofstream(second_null) << "model";
  expect_error("crispasr_transcribe_failed", [&] {
    CrispAsrBackend backend(config(Engine::Parakeet, window_audio, second_null, library));
    backend.transcribe_window({0, 15'000});
    backend.transcribe_window({15'000, 20'000});
  });
  check_counts(counters, {1, 1, 1, 1, 0, 0, 2, 2, 2, 2}, "second window failure");
  check(counters.get(12) == 2, "second window was not attempted");

  expect_error("crispasr_device_unavailable", [&] {
    CrispAsrBackend backend(config(
        Engine::ReazonSpeechNemo, audio, reazon_model, library, std::nullopt, Device::Cuda));
  });
  HMODULE marker = LoadLibraryExW(
      fs::absolute(cuda_marker).c_str(),
      nullptr,
      LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
  check(marker != nullptr, "fake CUDA marker could not be loaded");
  {
    CrispAsrBackend backend(config(
        Engine::ReazonSpeechNemo, audio, reazon_model, library, std::nullopt, Device::Cuda));
  }
  FreeLibrary(marker);

  counters.reset();
  {
    CrispAsrBackend backend(config(Engine::Qwen3Asr, audio, model, library, aligner));
    std::size_t callback_count = 0;
    const Result result = backend.transcribe({}, [&](const Segment&) { ++callback_count; });
    check(callback_count == 0, "Qwen emitted ineligible callback timing");
    check(result.source_segments.size() == 1 && result.alignment.size() == 2, "Qwen capability copying drift");
    check(result.source_segments[0].raw_start_ms < 0
              && result.source_segments[0].words[0].start_ms < 0,
          "Qwen session sentinel provenance drifted");
    check(result.alignment[0].start_ms == result.alignment[0].end_ms, "zero-duration raw alignment was rejected");
  }
  check_counts(counters, {1, 1, 1, 1, 1, 1, 1, 1, 1, 1}, "Qwen success");

  counters.reset();
  const fs::path tail_unbounded = root / "tail-unbounded.gguf";
  std::ofstream(tail_unbounded) << "aligner";
  {
    CrispAsrBackend backend(config(Engine::Qwen3Asr, audio, model, library, tail_unbounded));
    const Result result = backend.transcribe();
    check(result.alignment.size() == 1 && result.alignment[0].end_ms == 100000,
          "unbounded raw capability tail was modified or rejected");
  }
  check_counts(counters, {1, 1, 1, 1, 1, 1, 1, 1, 1, 1}, "Qwen unbounded raw tail");

  expect_error("missing_model_role", [&] {
    CrispAsrBackend backend(config(Engine::Qwen3Asr, audio, model, library));
  });

  counters.reset();
  const fs::path callback_failure = root / "callback-failure.gguf";
  std::ofstream(callback_failure) << "model";
  expect_error("crispasr_result_invalid", [&] {
    CrispAsrBackend backend(config(Engine::Parakeet, audio, callback_failure, library));
    backend.transcribe();
  });
  check_counts(counters, {1, 1, 1, 1, 0, 0, 1, 1, 1, 1}, "callback failure");
  check(counters.get(10) > 0 && counters.get(11) > counters.get(10),
        "callbacks were not reset before result cleanup");

  counters.reset();
  const fs::path zero_duration = root / "zero-duration-result.gguf";
  std::ofstream(zero_duration) << "model";
  try {
    CrispAsrBackend backend(config(Engine::ReazonSpeechNemo, audio, zero_duration, library));
    backend.transcribe_window({0, 1000});
    throw std::runtime_error("zero-duration result unexpectedly passed");
  } catch (const BackendError& error) {
    const auto& detail = error.result_failure();
    check(error.code() == "crispasr_result_invalid" && detail.has_value(),
          "zero-duration result did not retain structured failure detail");
    const std::string trace = "segmentIndex=0\nlocalStartMs=2160\nlocalEndMs=2160"
        "\nwindowDurationMs=1000";
    check(detail->subtype == "zero_duration_top_level_result"
              && detail->segment_index == 0
              && detail->local_start_ms == 2160
              && detail->local_end_ms == 2160
              && detail->result_trace_sha256 == sha256_text(trace),
          "zero-duration result fingerprint drifted");
  }
  check_counts(counters, {1, 1, 1, 1, 0, 0, 1, 1, 1, 1}, "zero-duration result");

  for (const auto& [name, code] : std::vector<std::pair<std::string, std::string>>{
           {"open-null.gguf", "crispasr_model_load_failed"},
           {"backend-mismatch.gguf", "crispasr_backend_mismatch"},
           {"transcribe-null.gguf", "crispasr_transcribe_failed"},
           {"invalid-result.gguf", "crispasr_result_invalid"}}) {
    counters.reset();
    const fs::path fixture = root / name;
    std::ofstream(fixture) << "model";
    expect_error(code, [&] {
      CrispAsrBackend backend(config(Engine::Parakeet, audio, fixture, library));
      if (code == "crispasr_transcribe_failed" || code == "crispasr_result_invalid") backend.transcribe();
    });
    if (code == "crispasr_model_load_failed") {
      check_counts(counters, {0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, name);
    } else if (code == "crispasr_backend_mismatch") {
      check_counts(counters, {1, 1, 0, 0, 0, 0, 0, 0, 0, 0}, name);
    } else if (code == "crispasr_transcribe_failed") {
      check_counts(counters, {1, 1, 0, 0, 0, 0, 1, 1, 1, 1}, name);
    } else {
      check_counts(counters, {1, 1, 1, 1, 0, 0, 1, 1, 1, 1}, name);
    }
  }

  for (const auto& [name, code] : std::vector<std::pair<std::string, std::string>>{
           {"align-null.gguf", "crispasr_alignment_failed"},
           {"invalid-align.gguf", "crispasr_alignment_invalid"}}) {
    counters.reset();
    const fs::path fixture = root / name;
    std::ofstream(fixture) << "aligner";
    expect_error(code, [&] {
      CrispAsrBackend backend(config(Engine::Qwen3Asr, audio, model, library, fixture));
      backend.transcribe();
    });
    if (code == "crispasr_alignment_failed") {
      check_counts(counters, {1, 1, 1, 1, 0, 0, 1, 1, 1, 1}, name);
    } else {
      check_counts(counters, {1, 1, 1, 1, 1, 1, 1, 1, 1, 1}, name);
    }
  }

  check(runtime_identity_matches(library, fs::file_size(library), "bad") == false,
        "runtime hash validator accepted drift");
  fs::remove_all(root);
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc != 4) throw std::runtime_error("expected fake, broken, and CUDA marker DLL paths");
    run_tests(fs::u8path(argv[1]), fs::u8path(argv[2]), fs::u8path(argv[3]));
    std::cout << "crispasr backend tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "crispasr backend tests failed: " << error.what() << '\n';
    return 1;
  }
}
