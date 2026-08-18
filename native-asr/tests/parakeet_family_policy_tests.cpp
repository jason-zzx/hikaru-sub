#include "parakeet_family_policy.hpp"

#include "crispasr_backend.hpp"

#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using namespace hikaru_asr;
using namespace hikaru_asr::crisp;
using namespace hikaru_asr::parakeet_family;

void check(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

NativeSegment source(
    std::string text,
    std::int64_t start_ms,
    std::int64_t end_ms,
    std::vector<NativeWord> words = {}) {
  return {std::move(text), start_ms, end_ms, std::move(words)};
}

WindowResult window(
    std::int64_t start_ms,
    std::int64_t end_ms,
    std::vector<NativeSegment> sources) {
  return {start_ms, end_ms, std::move(sources)};
}

void expect_error(
    const char* code,
    Engine engine,
    std::vector<WindowResult> windows,
    std::int64_t duration_ms) {
  const PolicyResult result = assemble_segments(engine, windows, duration_ms);
  check(result.segments.empty(), std::string(code) + " returned segments");
  check(result.error_code == code,
        std::string("expected ") + code + ", got " + result.error_code);
}

std::string repeated(const char* value, int count) {
  std::string output;
  for (int index = 0; index < count; ++index) output += value;
  return output;
}

void run_tests() {
  {
    const PolicyResult result = assemble_segments(
        Engine::ReazonSpeechNemo,
        {window(100, 10'000, {source("最初", 200, 9'900, {{"最", 0, 0}, {"初", 0, 0}})}),
         window(9'940, 20'000, {source("最後", 9'950, 19'900, {{"最", 9'950, 9'950}})})},
        20'000);
    check(result.error_code.empty() && result.segments.size() == 2,
          "Reazon gapped/native-overlap windows failed");
    check(result.segments[1].start_ms == 9'950 && result.segments[1].text == "最後",
          "Reazon top-level timing/text drift");
  }

  {
    const PolicyResult result = assemble_segments(
        Engine::Parakeet,
        {window(0, 15'000, {source(
            "あいうえお",
            100,
            14'900,
            {{"あ", 100, 500}, {"い", 500, 500}, {"う", 600, 900},
             {"え", 900, 900}, {"お", 1'000, 1'300}})})},
        15'000);
    check(result.error_code.empty() && result.segments.size() == 1, "Parakeet mixed words failed");
    check(result.segments[0].text == "あいうえお" && result.segments[0].start_ms == 100
              && result.segments[0].end_ms == 1'300,
          "Parakeet ownership drift");
  }

  {
    const std::string first = repeated("あ", 60);
    const std::string second = repeated("い", 60);
    const PolicyResult result = assemble_segments(
        Engine::Parakeet,
        {window(0, 15'000, {source(
            first + second,
            0,
            15'000,
            {{first, 0, 1'000}, {second, 1'000, 2'000}})})},
        15'000);
    check(result.error_code.empty() && result.segments.size() == 2, "96-point split failed");
    check(result.segments[0].text == first && result.segments[1].text == second,
          "cap split changed text");
  }

  expect_error("parakeet_family_empty_output", Engine::Parakeet, {}, 1'000);
  expect_error("parakeet_family_empty_output", Engine::Parakeet, {}, 0);
  expect_error("parakeet_family_invalid_input", Engine::Parakeet, {window(0, 1'000, {})}, 1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::Parakeet,
      {window(0, 1'000, {source("a", 0, 1'000, {{"a", 0, 1'000}})}),
       window(2'000, 3'000, {source("b", 2'000, 3'000, {{"b", 2'000, 3'000}})})},
      3'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 500, {source("a", 0, 500)}),
       window(400, 1'000, {source("b", 400, 1'000)})},
      1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(-1, 1'000, {source("x", 0, 900)})},
      1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 12'061, {source("a", 0, 12'000)})},
      12'061);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 10'000, {source("a", 0, 9'900)}),
       window(9'939, 20'000, {source("b", 9'950, 19'000)})},
      20'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 10'000, {source("a", 0, 9'000)}),
       window(9'940, 10'010, {source("b", 9'940, 10'000)}),
       window(9'990, 10'020, {source("c", 9'990, 10'020)})},
      10'020);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 10'000, {source("a", 9'990, 10'000)}),
       window(9'940, 20'000, {source("b", 9'950, 10'100)})},
      20'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 1'000, {source("x", 0, 0)})},
      1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 1'000, {source("", 0, 1'000)})},
      1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 1'000, {source("a", 0, 500), source("b", 500, 1'000)})},
      1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 1'000, {source("x", 900, 1'001)})},
      1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 1'000, {source(std::string("\xc3\x28", 2), 0, 1'000)})},
      1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 1'000, {source(std::string("\xed\xa0\x80", 3), 0, 1'000)})},
      1'000);
  expect_error(
      "parakeet_family_cue_limit",
      Engine::ReazonSpeechNemo,
      {window(0, 1'000, {source(repeated("あ", 97), 0, 1'000)})},
      1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::ReazonSpeechNemo,
      {window(0, 15'001, {source("x", 0, 15'001)})},
      15'001);
  expect_error(
      "parakeet_family_text_conservation",
      Engine::Parakeet,
      {window(0, 1'000, {source("一致しない", 0, 1'000, {{"一致", 0, 500}})})},
      1'000);
  expect_error(
      "parakeet_family_empty_output",
      Engine::Parakeet,
      {window(0, 1'000, {source("ゼロ", 0, 1'000, {{"ゼロ", 100, 100}})})},
      1'000);
  {
    const PolicyResult leading_trailing = assemble_segments(
        Engine::Parakeet,
        {window(0, 1'000, {source(
            "先アンカー後",
            0,
            1'000,
            {{"先", 100, 100}, {"アンカー", 200, 600}, {"後", 700, 700}})})},
        1'000);
    check(leading_trailing.error_code.empty()
              && leading_trailing.segments.size() == 1
              && leading_trailing.segments.front().text == "先アンカー後",
          "leading/trailing zero-duration ownership failed");
  }
  expect_error(
      "parakeet_family_invalid_input",
      Engine::Parakeet,
      {window(0, 1'000, {source("逆順", 0, 1'000, {{"逆", 500, 700}, {"順", 400, 800}})})},
      1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::Parakeet,
      {window(0, 1'000, {source("交差", 0, 1'000, {{"交", 0, 900}, {"差", 500, 600}})})},
      1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::Parakeet,
      {window(0, 1'000, {source("空", 0, 1'000, {{"", 0, 500}})})},
      1'000);
  expect_error(
      "parakeet_family_invalid_input",
      Engine::Parakeet,
      {window(0, 1'000, {source(
          std::string("\xc3\x28", 2),
          0,
          1'000,
          {{std::string("\xc3\x28", 2), 0, 500}})})},
      1'000);
  expect_error(
      "parakeet_family_cue_limit",
      Engine::Parakeet,
      {window(0, 15'000, {source(
          repeated("あ", 97),
          0,
          15'000,
          {{repeated("あ", 97), 0, 1'000}})})},
      15'000);

  {
    const PolicyResult exact = assemble_segments(
        Engine::ReazonSpeechNemo,
        {window(0, 12'060, {source("境界", 0, 12'060)})},
        12'060);
    check(exact.error_code.empty() && exact.segments.front().end_ms == 12'060,
          "exact padded Reazon boundary failed");
  }

  {
    const std::string exact_96 = repeated("😀", 96);
    const PolicyResult exact = assemble_segments(
        Engine::ReazonSpeechNemo,
        {window(0, 1'000, {source(exact_96, 0, 1'000)})},
        1'000);
    check(exact.error_code.empty() && exact.segments.front().text == exact_96,
          "exact 96-scalar UTF-8 boundary failed");
  }

  {
    const PolicyResult short_final = assemble_segments(
        Engine::Parakeet,
        {window(0, 15'000, {source("前", 0, 1'000, {{"前", 0, 1'000}})}),
         window(15'000, 15'500, {source(
             "後",
             15'000,
             15'400,
             {{"後", 15'000, 15'400}})})},
        15'500);
    check(short_final.error_code.empty() && short_final.segments.size() == 2,
          "short final window failed");
  }

  expect_error(
      "parakeet_family_invalid_input",
      Engine::Qwen3Asr,
      {window(0, 1'000, {source("x", 0, 1'000)})},
      1'000);
}

}  // namespace

int main() {
  try {
    run_tests();
    std::cout << "parakeet family policy tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "parakeet family policy tests failed: " << error.what() << '\n';
    return 1;
  }
}
