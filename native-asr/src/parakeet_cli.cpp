#include "full_cli.hpp"
#include <algorithm>

namespace hikaru_asr::parakeet_cli {
using namespace full_cli;
namespace {
std::string subtitle_text(const Json& value) {
  auto result = text(value);
  require(std::none_of(result.begin(), result.end(), [](unsigned char c) {
    return c < 0x20 || c == 0x7f;
  }));
  return result;
}
void source_interval(const Json& offsets, std::int64_t duration) {
  const auto start = integer(offsets.at("from")), end = integer(offsets.at("to"));
  require(start >= 0 && end >= start && end <= duration);
}
}

std::vector<Segment> parse_result(const std::string& bytes, std::int64_t duration_ms, bool& silence,
                                  const std::string& expected_model) {
  try {
    const auto root = document(bytes, duration_ms);
    const auto& identity = root.at("crispasr");
    require(identity.at("backend") == "parakeet"
        && (expected_model.empty() || text(identity.at("model")) == expected_model)
        && root.at("displayFallback").is_boolean() && root.at("displayFallback") == false
        && root.at("vadSilence").is_boolean());
    silence = root.at("vadSilence").get<bool>();
    const auto& display = root.at("displaySegments");
    const auto& source = root.at("transcription");
    require(display.is_array() && source.is_array()
        && display.size() <= limits::max_replacement_segments);
    EventV1 event; event.type = EventType::SegmentsReplace;
    std::wstring display_text, source_text;
    for (const auto& row : display) {
      Segment segment{integer(row.at("startMs")), integer(row.at("endMs")), subtitle_text(row.at("text"))};
      require(!compact(segment.text).empty());
      display_text += compact(segment.text);
      event.segments.push_back(std::move(segment));
    }
    for (const auto& row : source) {
      const auto content = compact(subtitle_text(row.at("text")));
      source_text += content;
      source_interval(row.at("offsets"), duration_ms);
      const auto words = row.value("words", Json::array());
      require(words.is_array() && (content.empty() || !words.empty()));
      for (const auto& word : words) {
        (void)subtitle_text(word.at("text"));
        source_interval(word.at("offsets"), duration_ms);
        const auto start = integer(word.at("t0")), end = integer(word.at("t1"));
        require(start >= 0 && end >= start && end <= duration_ms / 10
            && integer(word.at("offsets").at("from")) == start * 10
            && integer(word.at("offsets").at("to")) == end * 10);
      }
    }
    require(display_text == source_text);
    require(silence ? source.empty() && display.empty() : !source.empty() && !display.empty());
    // Raw anchors/overlaps are legal. Final display is strict: no Qwen merge,
    // sorting, fabricated duration or other application-side timing repair.
    EventSequenceState state; state.ready = true; state.duration_ms = duration_ms;
    ProtocolError error; std::string line;
    require(validate_event(state, event, error) && serialize_event(event, line, error));
    return std::move(event.segments);
  } catch (const std::exception&) {
    throw Error(expected_model.empty() ? "parakeet_cli_output_invalid" : "reazonspeech_cli_output_invalid");
  }
}
}  // namespace hikaru_asr::parakeet_cli
