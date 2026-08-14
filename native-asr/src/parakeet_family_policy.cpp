#include "parakeet_family_policy.hpp"

#include "crispasr_backend.hpp"

#include <string_view>
#include <utility>

namespace hikaru_asr::parakeet_family {
namespace {

struct Utf8Info {
  bool valid = false;
  std::size_t code_points = 0;
};

Utf8Info inspect_utf8(std::string_view text) {
  if (text.empty()) return {};
  std::size_t count = 0;
  for (std::size_t index = 0; index < text.size();) {
    const auto lead = static_cast<unsigned char>(text[index]);
    std::size_t length = 0;
    std::uint32_t value = 0;
    if (lead <= 0x7f) {
      length = 1;
      value = lead;
    } else if (lead >= 0xc2 && lead <= 0xdf) {
      length = 2;
      value = lead & 0x1f;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      length = 3;
      value = lead & 0x0f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      length = 4;
      value = lead & 0x07;
    } else {
      return {};
    }
    if (index + length > text.size()) return {};
    for (std::size_t offset = 1; offset < length; ++offset) {
      const auto byte = static_cast<unsigned char>(text[index + offset]);
      if ((byte & 0xc0) != 0x80) return {};
      value = (value << 6) | (byte & 0x3f);
    }
    if ((length == 3 && value < 0x800) || (length == 4 && value < 0x10000)
        || (value >= 0xd800 && value <= 0xdfff) || value > 0x10ffff) {
      return {};
    }
    ++count;
    index += length;
  }
  return {true, count};
}

PolicyResult failure(const char* code) {
  return {{}, code};
}

bool valid_range(
    std::int64_t start_ms,
    std::int64_t end_ms,
    std::int64_t lower_ms,
    std::int64_t upper_ms) {
  return start_ms >= lower_ms && end_ms > start_ms && end_ms <= upper_ms;
}

bool append_text(std::string& target, std::size_t& code_points, const std::string& text) {
  const Utf8Info info = inspect_utf8(text);
  if (!info.valid || info.code_points > max_cue_code_points - code_points) return false;
  target += text;
  code_points += info.code_points;
  return true;
}

PolicyResult assemble_reazon(const std::vector<WindowResult>& windows) {
  PolicyResult output;
  for (const auto& window : windows) {
    if (window.source_segments.size() != 1) return failure("parakeet_family_invalid_input");
    const auto& source = window.source_segments.front();
    const Utf8Info text = inspect_utf8(source.text);
    if (!text.valid) return failure("parakeet_family_invalid_input");
    if (!valid_range(
            source.raw_start_ms,
            source.raw_end_ms,
            window.window_start_ms,
            window.window_end_ms)) {
      return failure("parakeet_family_invalid_input");
    }
    if (text.code_points > max_cue_code_points
        || source.raw_end_ms - source.raw_start_ms > max_cue_duration_ms) {
      return failure("parakeet_family_cue_limit");
    }
    output.segments.push_back({source.raw_start_ms, source.raw_end_ms, source.text});
  }
  if (output.segments.empty()) return failure("parakeet_family_empty_output");
  return output;
}

struct OwnedAnchor {
  std::int64_t start_ms = 0;
  std::int64_t end_ms = 0;
  std::string text;
  std::size_t code_points = 0;
};

PolicyResult assemble_parakeet(const std::vector<WindowResult>& windows) {
  PolicyResult output;
  std::string selected_text;
  std::string final_text;
  for (const auto& window : windows) {
    if (window.source_segments.size() != 1) return failure("parakeet_family_invalid_input");
    const auto& source = window.source_segments.front();
    if (!inspect_utf8(source.text).valid || source.words.empty()
        || !valid_range(
            source.raw_start_ms,
            source.raw_end_ms,
            window.window_start_ms,
            window.window_end_ms)) {
      return failure("parakeet_family_invalid_input");
    }
    std::string words_text;
    std::vector<OwnedAnchor> anchors;
    std::string leading;
    std::size_t leading_points = 0;
    std::int64_t previous_word_start = -1;
    std::int64_t previous_positive_end = -1;
    for (const auto& word : source.words) {
      const Utf8Info word_info = inspect_utf8(word.text);
      if (!word_info.valid || word.start_ms < window.window_start_ms
          || word.end_ms < word.start_ms || word.end_ms > window.window_end_ms
          || word.start_ms < previous_word_start) {
        return failure("parakeet_family_invalid_input");
      }
      previous_word_start = word.start_ms;
      words_text += word.text;
      if (word.end_ms == word.start_ms) {
        if (anchors.empty()) {
          if (word_info.code_points > max_cue_code_points - leading_points) {
            return failure("parakeet_family_cue_limit");
          }
          leading += word.text;
          leading_points += word_info.code_points;
        } else if (!append_text(anchors.back().text, anchors.back().code_points, word.text)) {
          return failure("parakeet_family_cue_limit");
        }
        continue;
      }
      if (!valid_range(word.start_ms, word.end_ms, window.window_start_ms, window.window_end_ms)
          || word.end_ms < previous_positive_end) {
        return failure("parakeet_family_invalid_input");
      }
      previous_positive_end = word.end_ms;
      OwnedAnchor anchor{word.start_ms, word.end_ms, {}, 0};
      if (!leading.empty()) {
        anchor.text = std::move(leading);
        anchor.code_points = leading_points;
        leading.clear();
        leading_points = 0;
      }
      if (!append_text(anchor.text, anchor.code_points, word.text)) {
        return failure("parakeet_family_cue_limit");
      }
      anchors.push_back(std::move(anchor));
    }
    if (words_text != source.text) return failure("parakeet_family_text_conservation");
    if (anchors.empty() || !leading.empty()) return failure("parakeet_family_empty_output");
    selected_text += source.text;

    Segment cue;
    std::size_t cue_points = 0;
    for (auto& anchor : anchors) {
      const bool would_exceed = !cue.text.empty()
          && (anchor.code_points > max_cue_code_points - cue_points
              || anchor.end_ms - cue.start_ms > max_cue_duration_ms);
      if (would_exceed) {
        final_text += cue.text;
        output.segments.push_back(std::move(cue));
        cue = {};
        cue_points = 0;
      }
      if (cue.text.empty()) {
        cue.start_ms = anchor.start_ms;
        cue.end_ms = anchor.end_ms;
      } else {
        cue.end_ms = anchor.end_ms;
      }
      cue.text += anchor.text;
      cue_points += anchor.code_points;
    }
    if (!cue.text.empty()) {
      final_text += cue.text;
      output.segments.push_back(std::move(cue));
    }
  }
  if (output.segments.empty()) return failure("parakeet_family_empty_output");
  if (selected_text != final_text) return failure("parakeet_family_text_conservation");
  return output;
}

}  // namespace

PolicyResult assemble_segments(
    Engine engine,
    const std::vector<WindowResult>& windows,
    std::int64_t audio_duration_ms) {
  if (audio_duration_ms <= 0 || windows.empty()) return failure("parakeet_family_empty_output");
  std::int64_t expected_start = 0;
  for (const auto& window : windows) {
    const std::int64_t duration = window.window_end_ms - window.window_start_ms;
    const bool final_window = window.window_end_ms == audio_duration_ms;
    if (window.window_start_ms != expected_start
        || duration <= 0
        || window.window_end_ms > audio_duration_ms
        || duration > window_duration_ms
        || (!final_window && duration != window_duration_ms)) {
      return failure("parakeet_family_invalid_input");
    }
    expected_start = window.window_end_ms;
  }
  if (expected_start != audio_duration_ms) return failure("parakeet_family_invalid_input");

  if (engine == Engine::ReazonSpeechNemo) {
    return assemble_reazon(windows);
  }
  if (engine == Engine::Parakeet) {
    return assemble_parakeet(windows);
  }
  return failure("parakeet_family_invalid_input");
}

}  // namespace hikaru_asr::parakeet_family
