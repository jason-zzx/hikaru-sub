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
  const fs::path aligner = root / "aligner.gguf";
  std::ofstream(model) << "model";
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
    CrispAsrBackend backend(config(Engine::ReazonSpeechNemo, audio, model, library));
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
        Engine::ReazonSpeechNemo, audio, model, library, std::nullopt, Device::Cuda));
  });
  HMODULE marker = LoadLibraryExW(
      fs::absolute(cuda_marker).c_str(),
      nullptr,
      LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
  check(marker != nullptr, "fake CUDA marker could not be loaded");
  {
    CrispAsrBackend backend(config(
        Engine::ReazonSpeechNemo, audio, model, library, std::nullopt, Device::Cuda));
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
