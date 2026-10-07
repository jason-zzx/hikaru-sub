#include "full_cli.hpp"
#include "wav_audio.hpp"
#include <iostream>

using namespace hikaru_asr;
using Json = nlohmann::json;

int main(int argc, char**) {
  try {
    if (argc > 1) {
      std::string line;
      std::getline(std::cin, line);
      WorkerRequestV1 request;
      ProtocolError error;
      full_cli::require(parse_request_line(line, request, error));
      const auto audio = wav::read_pcm16_mono_16khz(std::filesystem::u8path(request.audio_path));
      const auto spans = full_cli::detect_speech(request, audio.samples.size(),
          [](auto done, auto total) { std::cerr << done << '/' << total << '\n'; });
      Json output = Json::array();
      for (const auto& span : spans) output.push_back({span.start_sample, span.end_sample});
      std::cout << output.dump() << '\n';
      return 0;
    }
    Json root = {{"crispasr_vad", {{"version", 1}, {"kind", "vad_segments"},
        {"sample_rate", 16000}, {"num_slices", 2}, {"slices", Json::array({
          {{"start", 7}, {"end", 16007}}, {{"start", 160007}, {"end", 176013}}})}}}};
    const auto parsed = full_cli::parse_vad_result(root.dump(), 176013);
    full_cli::require(parsed.size() == 2 && parsed[1].start_sample == 160007
        && parsed[1].end_sample == 176013);
    const auto reject = [](const std::string& bytes) {
      try { full_cli::parse_vad_result(bytes, 176013); }
      catch (const std::exception&) { return; }
      throw std::runtime_error("invalid VAD output accepted");
    };
    for (const auto& bad_end : {Json(176014), Json(160007), Json(true), Json(176013.0)}) {
      auto bad = root;
      bad["crispasr_vad"]["slices"][1]["end"] = bad_end;
      reject(bad.dump());
    }
    for (const auto& bad_start : {Json(-1), Json(16006)}) {
      auto bad = root;
      bad["crispasr_vad"]["slices"][1]["start"] = bad_start;
      reject(bad.dump());
    }
    for (const auto& key : {"version", "num_slices", "sample_rate"}) {
      auto bad = root;
      bad["crispasr_vad"][key] = 0;
      reject(bad.dump());
    }
    reject(root.dump() + std::string(1, '\0'));
    reject(root.dump() + "{}");
    reject(root.dump().substr(0, 20));
    auto duplicate = root.dump();
    duplicate.insert(1, "\"crispasr_vad\":{},");
    reject(duplicate);
    root["crispasr_vad"]["slices"] = Json::array();
    root["crispasr_vad"]["num_slices"] = 0;
    full_cli::require(full_cli::parse_vad_result(root.dump(), 176013).empty());
    std::cout << "VAD integer-sample boundary checks passed\n";
    return 0;
  } catch (const std::exception&) {
    std::cerr << "VAD test/launch failed\n";
    return 20;
  }
}
