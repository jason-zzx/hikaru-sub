// Test executable only: scenarios come from synthetic model-file contents.
#include <nlohmann/json.hpp>
#include <hikaru_asr/protocol.hpp>
#include "wav_audio.hpp"
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#define NOMINMAX
#include <windows.h>

int wmain(int argc, wchar_t** argv) {
  namespace fs = std::filesystem;
  using Json = nlohmann::json;
  if (argc == 2 && std::wstring(argv[1]) == L"--descendant") { Sleep(INFINITE); return 0; }
  if (argc == 2 && std::wstring(argv[1]) == L"--hikaru-probe-cuda") {
    const auto scenario = fs::path(argv[0]).stem().string();
    if (scenario == "probe-descendant") {
      std::wstring command = L"\"" + fs::path(argv[0]).wstring() + L"\" --descendant";
      STARTUPINFOW startup{}; startup.cb = sizeof(startup);
      PROCESS_INFORMATION child{};
      if (!CreateProcessW(argv[0], command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                          nullptr, nullptr, &startup, &child)) return 50;
      CloseHandle(child.hThread); CloseHandle(child.hProcess);
    }
    if (scenario == "probe-hang" || scenario == "probe-descendant") { Sleep(INFINITE); return 0; }
    std::string bytes = "{\"schemaVersion\":1,\"backend\":\"crispasr\",\"device\":\"cuda\",\"operation\":\"ggml-add-f32\",\"nodes\":1,\"otherDeviceNodes\":0,\"resultVerified\":true,\"modelExecutionProof\":false}";
    if (scenario == "probe-bad") bytes = "bad";
    if (scenario == "probe-duplicate") bytes.insert(1, "\"schemaVersion\":1,");
    if (scenario == "probe-nul") { bytes += '\0'; bytes += "junk"; }
    if (scenario == "probe-utf8") bytes += '\xff';
    if (scenario == "probe-trailing") bytes += "{}";
    if (scenario == "probe-device") bytes.replace(bytes.find("cuda"), 4, "cpu");
    if (scenario == "probe-oversize") bytes = std::string(16385, 'x');
    if (scenario == "probe-stderr") std::cerr << std::string(16385, 'x');
    std::cout << bytes << '\n';
    return scenario == "probe-nonzero" ? 43 : 0;
  }
  fs::path model, result, audio;
  std::string device;
  for (int i = 1; i + 1 < argc; ++i) {
    const std::wstring key(argv[i]);
    if (key == L"-m") model = argv[i+1];
    if (key == L"-f") audio = argv[i+1];
    if (key == L"-of") result = fs::path(std::wstring(argv[i+1]) + L".json");
    if (key == L"--gpu-backend") device = fs::path(argv[i+1]).string();
  }
  std::string scenario; std::ifstream(model) >> scenario;
  try { if (hikaru_asr::wav::read_pcm16_mono_16khz(audio).duration_ms != 3000) return 45; }
  catch (...) { return 45; }
  if (scenario == "descendant") {
    std::wstring command = L"\"" + fs::path(argv[0]).wstring() + L"\" --descendant";
    STARTUPINFOW startup{}; startup.cb = sizeof(startup);
    PROCESS_INFORMATION child{};
    if (!CreateProcessW(argv[0], command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                        nullptr, nullptr, &startup, &child)) return 50;
    CloseHandle(child.hThread); CloseHandle(child.hProcess);
  }
  if (scenario == "hang" || scenario == "descendant") { Sleep(INFINITE); return 0; }
  std::cout << "private transcript and paths must not enter protocol\n";
  std::cerr << "private diagnostic C:\\sensitive\\file synthetic transcript\n";
  std::cerr << "hikaru_vad: device=cpu chunks=3 completed=1\n";
  for (const auto* role : {"asr", "aligner", "lazy-audio"}) {
    if (scenario == "no-graph" && std::string(role) == "aligner") continue;
    std::cerr << "hikaru_graph: role=" << role << " device=" << device << " nodes=10 other="
              << (scenario == "wrong-device" ? 1 : 0) << '\n';
  }
  if (scenario == "nonzero") return 40;
  std::ofstream out(result, std::ios::binary);
  if (scenario == "half-file") { out << "{\"displaySegments\":["; return 0; }
  if (scenario == "bad-json") { out << "not json"; return 0; }
  if (scenario == "oversize") { out << std::string(hikaru_asr::limits::max_event_line_bytes + 1, 'x'); return 0; }
  Json word{{"text", "合成テスト。"}, {"t0", 0}, {"t1", 100}, {"offsets", {{"from", 0}, {"to", 1000}}}};
  Json row{{"startMs", 0}, {"endMs", 1000}, {"text", "合成テスト。"}};
  Json source{{"text", "合成テスト。"}, {"words", Json::array({word})}};
  Json value{{"crispasr", {{"backend", "qwen3"}}}, {"displayFallback", false}, {"vadSilence", false},
      {"displaySegments", Json::array({row})}, {"transcription", Json::array({source})}};
  if (scenario == "silence") { value["vadSilence"] = true; value["displaySegments"] = Json::array(); value["transcription"] = Json::array(); }
  if (scenario == "empty") { value["displaySegments"] = Json::array(); value["transcription"] = Json::array(); }
  if (scenario == "no-words") value["transcription"][0]["words"] = Json::array();
  if (scenario == "fallback") value["displayFallback"] = true;
  if (scenario == "text-loss") value["displaySegments"][0]["text"] = "消失";
  if (scenario == "zero-duration") value["displaySegments"][0]["endMs"] = 0;
  if (scenario == "out-of-audio") value["displaySegments"][0]["endMs"] = 900000;
  if (scenario == "wrong-type") value["displaySegments"][0]["endMs"] = 1.0;
  if (scenario == "wrong-units") value["transcription"][0]["words"][0]["offsets"]["to"] = 100;
  if (scenario == "unordered") { value["displaySegments"][0]["startMs"] = 500; value["displaySegments"].push_back(row); }
  // Synthetic display-only defects; source text and useful words stay valid.
  const auto display_rows = [&](std::initializer_list<std::pair<int, int>> times) {
    value["displaySegments"] = Json::array();
    const char* texts[] = {" A ", " 日本　", " B ", "終 "};
    std::string content;
    std::size_t i = 0;
    for (const auto& [start, end] : times) {
      value["displaySegments"].push_back({{"startMs", start}, {"endMs", end}, {"text", texts[i]}});
      content += texts[i++];
    }
    value["transcription"][0]["text"] = content;
  };
  if (scenario == "zero-middle") display_rows({{0, 500}, {800, 800}, {1000, 1500}});
  if (scenario == "zero-trailing") display_rows({{0, 500}, {800, 800}});
  if (scenario == "zero-leading") display_rows({{100, 100}, {400, 800}});
  if (scenario == "zero-leading-consecutive") display_rows({{100, 100}, {200, 200}, {400, 800}});
  if (scenario == "zero-consecutive") display_rows({{0, 500}, {800, 800}, {900, 900}});
  if (scenario == "all-zero-same") display_rows({{100, 100}, {100, 100}});
  if (scenario == "all-zero-distinct") display_rows({{100, 100}, {200, 200}});
  if (scenario == "backward-cascade") display_rows({{500, 800}, {1000, 1500}, {2000, 2500}, {100, 2600}});
  if (scenario == "zero-cascade") display_rows({{500, 800}, {1000, 1500}, {100, 100}});
  if (scenario == "ordinary-overlap") display_rows({{0, 1500}, {500, 1000}});
  if (scenario == "equal-starts") display_rows({{100, 1500}, {100, 500}});
  if (scenario.rfind("member-", 0) == 0 || scenario.rfind("merged-text-", 0) == 0) {
    display_rows({{0, 2000}, {900, 900}});
    auto& member = value["displaySegments"][1];
    if (scenario == "member-negative-duration") member["startMs"] = 1000; // envelope would hide it
    if (scenario == "member-negative-start") member["startMs"] = -1;
    if (scenario == "member-negative-end") member["endMs"] = -1;
    if (scenario == "member-out-of-audio") member["endMs"] = 3001;
    if (scenario == "member-zero-out-of-audio") member["startMs"] = member["endMs"] = 3001;
    if (scenario == "member-float") member["endMs"] = 900.0;
    if (scenario == "member-bool") member["startMs"] = true;
    if (scenario == "member-unsigned-overflow") member["endMs"] = UINT64_MAX;
    if (scenario == "member-missing") member.erase("endMs");
    if (scenario == "member-text-type") member["text"] = 1;
    if (scenario == "member-text-empty") member["text"] = "";
    if (scenario == "member-text-whitespace") member["text"] = " 　";
    if (scenario == "member-text-control") member["text"] = "\t日本";
    if (scenario == "member-text-nul") member["text"] = std::string("A\0B", 3);
    if (scenario == "member-text-oversize") member["text"] = std::string(hikaru_asr::limits::max_text_bytes + 1, 'x');
    if (scenario.rfind("merged-text-", 0) == 0) {
      value["displaySegments"][0]["text"] = std::string(hikaru_asr::limits::max_text_bytes / 2, 'x');
      member["text"] = std::string(hikaru_asr::limits::max_text_bytes / 2 + (scenario == "merged-text-overflow"), 'y');
    }
    // Keep conservation valid, so invalid-member tests cannot pass for text loss.
    if (member["text"].is_string()) value["transcription"][0]["text"] =
        value["displaySegments"][0]["text"].get<std::string>() + member["text"].get<std::string>();
  }
  if (scenario == "count-overflow") {
    value["displaySegments"] = Json::array();
    for (std::size_t i = 0; i <= hikaru_asr::limits::max_replacement_segments; ++i) {
      value["displaySegments"].push_back({{"startMs", i % 2 ? 1000 : 0}, {"endMs", 1000}, {"text", "x"}});
    }
    // Without the ORIGINAL count cap, these would merge into legal two-byte cues.
    value["transcription"][0]["text"] = std::string(hikaru_asr::limits::max_replacement_segments + 1, 'x');
  }
  if (scenario == "unhelpful-words") {
    value["transcription"][0]["words"][0]["t1"] = 0;
    value["transcription"][0]["words"][0]["offsets"]["to"] = 0;
  }
  if (scenario == "word-negative") value["transcription"][0]["words"][0]["t0"] = -1;
  if (scenario == "word-type") value["transcription"][0]["words"][0]["t1"] = true;
  if (scenario == "word-text-empty") value["transcription"][0]["words"][0]["text"] = "";
  if (scenario == "fallback-type") value["displayFallback"] = 0;
  if (scenario == "escaped-nul-unused") value["unused"] = std::string(1, '\0');
  auto bytes = value.dump();
  if (scenario == "duplicate") bytes.insert(1, "\"vadSilence\":false,");
  if (scenario == "unicode-invalid") bytes.insert(1, "\"invalid\":\"\\ud800\",");
  if (scenario == "utf8-invalid") bytes.insert(1, "\"invalid\":\"\xff\",");
  if (scenario == "nul-suffix") bytes += '\0';
  if (scenario == "nul-garbage") { bytes += '\0'; bytes += "garbage"; }
  if (scenario == "nul-invalid-utf8") { bytes += '\0'; bytes += '\xff'; }
  if (scenario == "nul-nested-value") bytes.insert(bytes.find("qwen3") + 2, 1, '\0');
  if (scenario == "nul-nested-key") bytes.insert(bytes.find("backend") + 2, 1, '\0');
  if (scenario == "nul-nested-token") bytes.insert(bytes.find("false") + 2, 1, '\0');
  if (scenario == "trailing-whitespace") bytes += " \t\r\n";
  out << bytes;
  out.close();
  if (scenario == "wait-success") {
    while (!fs::exists(result.parent_path() / "finish")) Sleep(1);
  }
  return scenario == "after-output-nonzero" ? 42 : 0;
}
