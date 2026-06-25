import unittest
from pathlib import Path

from engines.base import AsrSegment
from engines.chunking import (
    plan_audio_chunks,
    merge_chunk_segments,
    build_segments_from_char_timestamps,
    build_segments_from_text,
)


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


if __name__ == "__main__":
    unittest.main()
