#include "crispasr_output.h"
#include <cassert>
#include <filesystem>
#include <string>

int main(int argc, char** argv) {
    assert(argc == 2);
    const std::string root = argv[1];
    crispasr_segment source;
    source.text = u8"日本語。次。";
    source.t0 = 0;
    source.t1 = 200;
    source.words = {{u8"日本語。", 0, 100}, {u8"次。", 100, 200}};
    crispasr_token diagnostic;
    diagnostic.text = std::string("\xe6\x97", 2); // partial BPE bytes, not UTF-8 text
    source.tokens.push_back(diagnostic);
    bool fallback = true;
    const auto display = crispasr_make_disp_segments({source}, 0, true, &fallback);
    assert(!fallback && display.size() == 2);
    assert(display[0].text + display[1].text == source.text);
    assert(crispasr_write_json(root + "/good.json", {source}, "qwen3", "fixture", "ja", true,
                               nullptr, &display, fallback, false));
    // Historical JSON proves the failure fixture, while display-mode JSON omits
    // diagnostic tokens only. Corrupt actual source/word/display text stays corrupt
    // so the external boundary validator MUST reject it rather than normalize it.
    assert(crispasr_write_json(root + "/diagnostic.json", {source}, "qwen3", "fixture", "ja", true));
    source.text = std::string("\xe6\x97", 2);
    source.words[0].text = source.text;
    const auto bad = crispasr_make_disp_segments({source}, 0, true, &fallback);
    assert(crispasr_write_json(root + "/invalid-text.json", {source}, "qwen3", "fixture", "ja", true,
                               nullptr, &bad, fallback, false));
    source.words.clear();
    source.text = u8"日本語。次。";
    const auto no_words = crispasr_make_disp_segments({source}, 0, true, &fallback);
    assert(fallback);
    assert(crispasr_write_json(root + "/fallback.json", {source}, "qwen3", "fixture", "ja", true,
                               nullptr, &no_words, fallback, false));
}
