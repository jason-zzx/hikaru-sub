import unittest
from pathlib import Path

from engines.base import AsrSegment
from engines.chunking import (
    plan_audio_chunks,
    merge_chunk_segments,
    dedupe_transcript_segments,
    apply_gap_backfill,
    build_segments_from_char_timestamps,
    build_segments_from_text,
    _japanese_soft_boundary_score,
    _merge_overlapping_text,
)


def _chars_from_text(text: str, *, char_sec: float = 0.1, gap_after: dict[int, float] | None = None):
    """按字符生成 timestamps；gap_after[i] 表示第 i 个字符结束后额外停顿秒数。"""
    gap_after = gap_after or {}
    chars = []
    cursor = 0.0
    for i, ch in enumerate(text):
        chars.append({"char": ch, "start": cursor, "end": cursor + char_sec})
        cursor += char_sec
        cursor += gap_after.get(i, 0.0)
    return chars


class PlanAudioChunksTests(unittest.TestCase):
    def test_short_audio_returns_single_chunk_covering_all(self):
        chunks = plan_audio_chunks(30_000)
        self.assertEqual(chunks, [(0, 30_000)])

    def test_below_chunking_min_returns_single_chunk(self):
        # CHUNKING_MIN_DURATION_MS=60000，55s 不分块
        chunks = plan_audio_chunks(55_000)
        self.assertEqual(chunks, [(0, 55_000)])

    def test_long_audio_splits_with_overlap(self):
        # chunk_ms=45000, overlap=2000, step=43000
        chunks = plan_audio_chunks(100_000)
        self.assertTrue(len(chunks) >= 2)
        # 每块不超过 chunk_ms
        for start, end in chunks:
            self.assertLessEqual(end - start, 45_000)
        # 块间有 overlap（下一块 start < 上一块 end）
        for i in range(1, len(chunks)):
            self.assertLess(chunks[i][0], chunks[i - 1][1])
        # 覆盖到末尾
        self.assertEqual(chunks[-1][1], 100_000)

    def test_zero_duration_returns_single_zero_chunk(self):
        self.assertEqual(plan_audio_chunks(0), [(0, 0)])


class MergeChunkSegmentsTests(unittest.TestCase):
    def test_drops_exact_text_overlap_duplicate(self):
        # 两块 overlap 区域产出相同文本，应去重
        chunk_segments = [
            (0, [AsrSegment(0, 2000, "こんにちは")]),
            (1500, [AsrSegment(0, 2000, "こんにちは")]),  # 偏移后 1500-3500
        ]
        merged = merge_chunk_segments(chunk_segments, overlap_ms=2000)
        # 同文本 + overlap > 0 → 去重为一个
        texts = [s.text for s in merged]
        self.assertEqual(texts.count("こんにちは"), 1)

    def test_prefers_longer_text_on_duplicate(self):
        chunk_segments = [
            (0, [AsrSegment(0, 2000, "こんにちは")]),
            (1500, [AsrSegment(0, 2500, "こんにちはございます")]),
        ]
        merged = merge_chunk_segments(chunk_segments, overlap_ms=2000)
        self.assertIn("こんにちはございます", [s.text for s in merged])

    def test_keeps_distinct_segments(self):
        chunk_segments = [
            (0, [AsrSegment(0, 2000, "おはよう")]),
            (2000, [AsrSegment(0, 2000, "ありがとうございます")]),
        ]
        merged = merge_chunk_segments(chunk_segments, overlap_ms=2000)
        self.assertEqual(len(merged), 2)


class DedupeTranscriptSegmentsTests(unittest.TestCase):
    def test_merges_exact_duplicate_with_overlapping_times(self):
        segments = [
            AsrSegment(64328, 65504, "5時ですよ。"),
            AsrSegment(64540, 65500, "5時ですよ。"),
        ]
        deduped = dedupe_transcript_segments(segments)
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0].text, "5時ですよ。")
        self.assertEqual(deduped[0].start_ms, 64328)
        self.assertEqual(deduped[0].end_ms, 65504)

    def test_drops_suffix_substring_duplicate(self):
        segments = [
            AsrSegment(
                107456,
                112576,
                "出演されている嫌な顔をされながらおパンツ見せてもらいたいリターンズを見ました",
            ),
            AsrSegment(112576, 112776, "リターンズを見ました。"),
        ]
        deduped = dedupe_transcript_segments(segments)
        self.assertEqual(len(deduped), 1)
        self.assertIn("リターンズを見ました", deduped[0].text)

    def test_preserves_distinct_overlapping_segments(self):
        segments = [
            AsrSegment(9952, 11792, "こんばんは飯田ひかるです。"),
            AsrSegment(11728, 12752, "皆さん、"),
            AsrSegment(12432, 12912, "こんばんは。"),
        ]
        deduped = dedupe_transcript_segments(segments)
        self.assertEqual(len(deduped), 3)


class ApplyGapBackfillTests(unittest.TestCase):
    def test_context_gap_supersedes_stale_fragments_and_assembles_greeting(self):
        segments = [
            AsrSegment(11792, 12112, "それ"),
            AsrSegment(12112, 12432, "こちら"),
        ]
        window_segments = [
            AsrSegment(11728 - 5008, 11792 - 5008, "皆さん、"),
            AsrSegment(9952 - 5008, 11792 - 5008, "こんばんは飯田ひかるです。"),
        ]
        merged = apply_gap_backfill(
            segments,
            gap_start_ms=7536,
            gap_end_ms=11792,
            chunk_start_ms=5008,
            window_segments=window_segments,
            overlap_ms=2000,
            assemble=True,
        )
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].start_ms, 11728)
        self.assertEqual(merged[0].text, "皆さん、こんばんは飯田ひかるです。")

    def test_skips_redundant_second_gap_fill(self):
        segments = [
            AsrSegment(11728, 12912, "皆さん、こんばんは飯田ひかるです。"),
        ]
        window_segments = [
            AsrSegment(12432 - 11072, 12752 - 11072, "皆さん、"),
            AsrSegment(12432 - 11072, 12912 - 11072, "こんばんは。"),
        ]
        merged = apply_gap_backfill(
            segments,
            gap_start_ms=12432,
            gap_end_ms=14352,
            chunk_start_ms=11072,
            window_segments=window_segments,
            overlap_ms=2000,
            assemble=True,
        )
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].text, "皆さん、こんばんは飯田ひかるです。")


class BuildSegmentsTests(unittest.TestCase):
    def _char(self, ch, start, end):
        return {"char": ch, "start": start, "end": end}

    def test_splits_on_punctuation(self):
        timestamps = [
            self._char("こ", 0.0, 0.1),
            self._char("ん", 0.1, 0.2),
            self._char("に", 0.2, 0.3),
            self._char("ち", 0.3, 0.4),
            self._char("は", 0.4, 0.5),
            self._char("。", 0.5, 0.6),
            self._char("世", 0.7, 0.8),
            self._char("界", 0.8, 0.9),
        ]
        segments = build_segments_from_char_timestamps(timestamps, fallback_text="")
        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0].text, "こんにちは。")
        self.assertEqual(segments[0].start_ms, 0)
        self.assertEqual(segments[0].end_ms, 600)
        self.assertEqual(segments[1].text, "世界")

    def test_empty_timestamps_falls_back_to_text(self):
        segments = build_segments_from_text("テストです。おわり。", duration_ms=5000)
        self.assertTrue(len(segments) >= 1)
        self.assertEqual(segments[-1].end_ms, 5000)

    def test_ignores_blank_chars(self):
        timestamps = [
            self._char(" ", 0.0, 0.05),
            self._char("あ", 0.05, 0.15),
            self._char(" ", 0.15, 0.2),
        ]
        segments = build_segments_from_char_timestamps(timestamps, fallback_text="")
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].text, "あ")


class JapaneseSoftBoundaryTests(unittest.TestCase):
    def test_does_not_split_tottemo_on_tte(self):
        text = "これはとっても楽しいです"
        chars = _chars_from_text(text, char_sec=0.08)
        segments = build_segments_from_char_timestamps(chars, text, max_chars=12)
        for seg in segments:
            self.assertNotEqual(seg.text, "これはとって")
            self.assertNotIn("とって\n", seg.text)
        self.assertEqual("".join(s.text for s in segments), text)

    def test_does_not_split_shite_shimau(self):
        text = "うっかりしてしまいました"
        chars = _chars_from_text(text, char_sec=0.08)
        segments = build_segments_from_char_timestamps(chars, text, max_chars=10)
        for seg in segments:
            self.assertNotEqual(seg.text, "うっかりして")
        self.assertEqual("".join(s.text for s in segments), text)

    def test_does_not_split_quotative_tte_iu(self):
        text = "危ない今光って言いそうになった"
        chars = []
        cursor = 5.04
        for ch in "危ない今":
            chars.append({"char": ch, "start": cursor, "end": cursor + 0.14})
            cursor += 0.14
        cursor += 0.16
        chars.append({"char": "光", "start": cursor, "end": cursor + 0.08})
        cursor += 0.40
        for ch in "って言いそうになった":
            chars.append({"char": ch, "start": cursor, "end": cursor + 0.08})
            cursor += 0.08
        segments = build_segments_from_char_timestamps(chars, text)
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].text, text)

    def test_still_splits_shite_before_ikimasu(self):
        text = "今日は新しい企画なのでこちらで紹介していきます"
        chars = _chars_from_text(text, char_sec=0.25)
        segments = build_segments_from_char_timestamps(chars, text)
        self.assertGreater(len(segments), 1)
        self.assertEqual(segments[0].text, "今日は新しい企画なのでこちらで紹介して")

    def test_does_not_split_dewa_nai(self):
        text = "これではないと思います"
        chars = _chars_from_text(text, char_sec=0.08)
        segments = build_segments_from_char_timestamps(chars, text, max_chars=10)
        for seg in segments:
            self.assertNotEqual(seg.text, "これでは")
        self.assertEqual("".join(s.text for s in segments), text)

    def test_does_not_split_kedo_mo(self):
        text = "忙しいけども頑張ります"
        chars = _chars_from_text(text, char_sec=0.08)
        segments = build_segments_from_char_timestamps(chars, text, max_chars=10)
        for seg in segments:
            self.assertNotEqual(seg.text, "忙しいけど")
        self.assertEqual("".join(s.text for s in segments), text)

    def test_does_not_split_particle_de_in_demo(self):
        text = "誰でも参加できます"
        chars = _chars_from_text(text, char_sec=0.08)
        segments = build_segments_from_char_timestamps(chars, text, max_chars=8)
        for seg in segments:
            self.assertNotEqual(seg.text, "誰で")
        self.assertEqual("".join(s.text for s in segments), text)

    def test_does_not_split_shite_iru(self):
        text = "今まさに準備しているところです"
        chars = _chars_from_text(text, char_sec=0.07)
        segments = build_segments_from_char_timestamps(chars, text, max_chars=12)
        for seg in segments:
            self.assertNotEqual(seg.text, "今まさに準備して")
        self.assertEqual("".join(s.text for s in segments), text)

    def test_contextual_tte_score_blocks_mo(self):
        self.assertEqual(
            _japanese_soft_boundary_score("とって", "て", following="も"),
            0,
        )

    def test_does_not_split_nde_shimau(self):
        text = "ついつい飲んでしまいました"
        chars = _chars_from_text(text, char_sec=0.08)
        segments = build_segments_from_char_timestamps(chars, text, max_chars=10)
        for seg in segments:
            self.assertNotEqual(seg.text, "ついつい飲んで")
        self.assertEqual("".join(s.text for s in segments), text)


class MergeOverlappingTextTests(unittest.TestCase):
    def test_preserves_prefix_when_later_chunk_drops_it(self):
        merged = _merge_overlapping_text(
            "すごい爽やかな気持ちになりました。",
            "爽やかな気持ちになりました何かさ最近暑くてさ",
        )
        self.assertTrue(merged.startswith("すごい"))
        self.assertIn("何かさ最近暑くてさ", merged)

    def test_keeps_longer_when_one_contains_the_other(self):
        self.assertEqual(
            _merge_overlapping_text("短い", "短い文です"),
            "短い文です",
        )


if __name__ == "__main__":
    unittest.main()
