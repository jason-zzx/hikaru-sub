#include "qwen_cli.hpp"
#include "full_cli.hpp"
#include <algorithm>

namespace hikaru_asr::qwen_cli {
using namespace full_cli;
std::vector<Segment> parse_result(const std::string& bytes, std::int64_t duration_ms,
                                 bool& silence) {
  try {
    const auto root = document(bytes, duration_ms);
    require(root.at("crispasr").at("backend") == "qwen3"
        && root.at("displayFallback").is_boolean() && root.at("displayFallback") == false
        && root.at("vadSilence").is_boolean());
    silence = root.at("vadSilence").get<bool>();
    const auto& display = root.at("displaySegments");
    const auto& source = root.at("transcription");
    require(display.is_array() && source.is_array()
        && display.size() <= limits::max_replacement_segments);
    std::vector<Segment> segments;
    std::wstring display_text, source_text;
    for (const auto& row : display) {
      Segment segment{integer(row.at("startMs")), integer(row.at("endMs")), text(row.at("text"))};
      // Validate ORIGINAL members before an envelope can conceal a defect.
      const auto content = compact(segment.text);
      require(segment.start_ms >= 0 && segment.end_ms >= segment.start_ms
          && segment.end_ms <= duration_ms && !content.empty()
          && segment.text.size() <= limits::max_text_bytes
          && std::none_of(segment.text.begin(), segment.text.end(), [](unsigned char c) {
            return c < 0x20 || c == 0x7f;
          }));
      display_text += content;
      segments.push_back(std::move(segment));
    }
    for (const auto& row : source) {
      const auto content = compact(text(row.at("text")));
      source_text += content;
      if (content.empty()) continue;
      const auto& words = row.at("words");
      require(words.is_array() && !words.empty());
      bool useful = false;
      for (const auto& word : words) {
        const auto start = integer(word.at("t0")), end = integer(word.at("t1"));
        require(start >= 0 && end >= start && end <= INT64_MAX / 10
            && integer(word.at("offsets").at("from")) == start * 10
            && integer(word.at("offsets").at("to")) == end * 10);
        require(!compact(text(word.at("text"))).empty());
        useful = useful || end > start;
      }
      require(useful);
    }
    require(display_text == source_text);
    require(silence ? source.empty() && display.empty() : !source.empty() && !display.empty());
    // Merge only contiguous zero-duration/start-reversal groups. Keep ranges
    // until grouping is finished, so a backward cascade never recopies text.
    struct Group { std::size_t first, last; Segment envelope; bool positive; };
    std::vector<Group> groups;
    for (std::size_t i = 0; i < segments.size(); ++i) {
      const auto& row = segments[i];
      Group current{i, i, {row.start_ms, row.end_ms, {}}, row.end_ms > row.start_ms};
      const auto join_previous = [&] {
        const auto& previous = groups.back();
        current.first = previous.first;
        current.envelope.start_ms = std::min(previous.envelope.start_ms, current.envelope.start_ms);
        current.envelope.end_ms = std::max(previous.envelope.end_ms, current.envelope.end_ms);
        current.positive = current.positive || previous.positive;
        groups.pop_back();
      };
      // Leading zeros stay pending until an ORIGINAL positive member arrives,
      // even when distinct zero points already give their envelope a duration.
      if (!groups.empty() && (!current.positive || !groups.back().positive)) join_previous();
      while (!groups.empty() && current.envelope.start_ms < groups.back().envelope.start_ms) join_previous();
      groups.push_back(std::move(current));
    }
    EventV1 event; event.type = EventType::SegmentsReplace;
    for (auto& group : groups) {
      require(group.positive);
      std::size_t size = 0;
      for (auto i = group.first; i <= group.last; ++i) size += segments[i].text.size();
      require(size <= limits::max_text_bytes);
      group.envelope.text.reserve(size);
      for (auto i = group.first; i <= group.last; ++i) group.envelope.text += segments[i].text;
      event.segments.push_back(std::move(group.envelope));
    }
    // Unchanged final protocol shape/time/order/aggregate and UTF-8 checks.
    EventSequenceState state;
    state.ready = true; state.duration_ms = duration_ms;
    ProtocolError error; std::string line;
    require(validate_event(state, event, error) && serialize_event(event, line, error));
    return std::move(event.segments);
  } catch (const std::exception&) { throw Error("qwen_cli_output_invalid"); }
}

}  // namespace hikaru_asr::qwen_cli
