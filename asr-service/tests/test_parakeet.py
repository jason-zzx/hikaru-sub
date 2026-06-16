import unittest
from pathlib import Path
import math
import sys
import tempfile
import wave
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import engines.parakeet as parakeet
from engines.base import AsrSegment
from engines.parakeet import (
    ParakeetEngine,
    build_segments_from_char_timestamps,
    merge_chunk_segments,
    plan_audio_chunks,
)


def _write_silence_wav(path: Path, duration_ms: int) -> None:
    rate = 16000
    frames = int(rate * duration_ms / 1000)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"\0\0" * frames)


def _write_activity_wav(
    path: Path,
    duration_ms: int,
    active_ranges: list[tuple[int, int]],
) -> None:
    rate = 16000
    frames = int(rate * duration_ms / 1000)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        samples = bytearray()
        for index in range(frames):
            time_ms = int(index * 1000 / rate)
            active = any(start <= time_ms < end for start, end in active_ranges)
            value = int(8000 * math.sin(index * 0.05)) if active else 0
            samples.extend(value.to_bytes(2, "little", signed=True))
        wav.writeframes(bytes(samples))


class _ReadmeStyleOutput:
    text = "こんにちは。次です。"


class _ReadmeStyleModel:
    def __init__(self) -> None:
        self.calls = []

    def transcribe(self, files, **kwargs):
        self.calls.append(kwargs)
        if kwargs:
            raise TypeError("this fake only supports the README transcribe signature")
        return [_ReadmeStyleOutput()]


class _FakeParakeetEngine(ParakeetEngine):
    def __init__(self, model_obj) -> None:
        super().__init__()
        self._model = model_obj

    def load(self) -> None:
        return None


class _BackfillFakeEngine(ParakeetEngine):
    def __init__(self, backfill_segments: list[AsrSegment]) -> None:
        super().__init__()
        self.backfill_segments = backfill_segments
        self.calls: list[tuple[str, int]] = []

    def _transcribe_one_audio(self, audio_path: str, duration_ms: int) -> list[AsrSegment]:
        self.calls.append((Path(audio_path).name, duration_ms))
        return self.backfill_segments

    def _transcribe_fallback_audio(
        self,
        audio_path: str,
        duration_ms: int,
    ) -> list[AsrSegment]:
        return []


class _FallbackBackfillFakeEngine(_BackfillFakeEngine):
    def __init__(self, fallback_segments: list[AsrSegment]) -> None:
        super().__init__([])
        self.fallback_segments = fallback_segments
        self.fallback_calls: list[tuple[str, int]] = []

    def _transcribe_fallback_audio(
        self,
        audio_path: str,
        duration_ms: int,
    ) -> list[AsrSegment]:
        self.fallback_calls.append((Path(audio_path).name, duration_ms))
        return self.fallback_segments


class _QueuedBackfillFakeEngine(ParakeetEngine):
    def __init__(self, backfill_batches: list[list[AsrSegment]]) -> None:
        super().__init__()
        self.backfill_batches = list(backfill_batches)
        self.calls: list[tuple[str, int]] = []

    def _transcribe_one_audio(self, audio_path: str, duration_ms: int) -> list[AsrSegment]:
        self.calls.append((Path(audio_path).name, duration_ms))
        if not self.backfill_batches:
            return []
        return self.backfill_batches.pop(0)


class _UnavailableCuda:
    @staticmethod
    def is_available() -> bool:
        return False

    @staticmethod
    def device_count() -> int:
        return 0


class _CpuOnlyCudaBackend:
    @staticmethod
    def is_built() -> bool:
        return False


class _CpuOnlyBackends:
    cuda = _CpuOnlyCudaBackend()


class _CpuOnlyTorch:
    cuda = _UnavailableCuda()
    backends = _CpuOnlyBackends()

    class version:
        cuda = None


class ParakeetSegmentTests(unittest.TestCase):
    def test_plans_long_audio_into_overlapping_chunks(self):
        chunks = plan_audio_chunks(125_000, chunk_ms=60_000, overlap_ms=2_000)

        self.assertEqual(
            chunks,
            [
                (0, 60_000),
                (58_000, 118_000),
                (116_000, 125_000),
            ],
        )

    def test_short_audio_uses_single_chunk(self):
        self.assertEqual(plan_audio_chunks(59_000), [(0, 59_000)])

    def test_merges_chunk_segments_with_offsets_and_drops_overlap_duplicates(self):
        merged = merge_chunk_segments(
            [
                (
                    0,
                    [
                        AsrSegment(start_ms=0, end_ms=1000, text="前半"),
                        AsrSegment(start_ms=58000, end_ms=60000, text="重複"),
                    ],
                ),
                (
                    58000,
                    [
                        AsrSegment(start_ms=0, end_ms=2000, text="重複"),
                        AsrSegment(start_ms=3000, end_ms=4000, text="後半"),
                    ],
                ),
            ],
            overlap_ms=2000,
        )

        self.assertEqual(
            merged,
            [
                AsrSegment(start_ms=0, end_ms=1000, text="前半"),
                AsrSegment(start_ms=58000, end_ms=60000, text="重複"),
                AsrSegment(start_ms=61000, end_ms=62000, text="後半"),
            ],
        )

    def test_drops_contained_overlap_segments_with_similar_text(self):
        merged = merge_chunk_segments(
            [
                (
                    0,
                    [
                        AsrSegment(
                            start_ms=1000,
                            end_ms=5000,
                            text="ビニールはちょっとちゃんと剥がしていただきます。",
                        ),
                    ],
                ),
                (
                    3000,
                    [
                        AsrSegment(
                            start_ms=0,
                            end_ms=1200,
                            text="ちょっとちゃんと剥がして",
                        ),
                    ],
                ),
            ],
            overlap_ms=2000,
        )

        self.assertEqual(
            merged,
            [
                AsrSegment(
                    start_ms=1000,
                    end_ms=5000,
                    text="ビニールはちょっとちゃんと剥がしていただきます。",
                ),
            ],
        )

    def test_prefers_longer_overlap_segment_when_text_is_similar(self):
        merged = merge_chunk_segments(
            [
                (
                    0,
                    [
                        AsrSegment(
                            start_ms=1000,
                            end_ms=3000,
                            text="すごい爽やかな気持ちになりました。",
                        ),
                    ],
                ),
                (
                    1500,
                    [
                        AsrSegment(
                            start_ms=0,
                            end_ms=3600,
                            text="爽やかな気持ちになりました何かさ最近暑くてさ",
                        ),
                    ],
                ),
            ],
            overlap_ms=2000,
        )

        self.assertEqual(
            merged,
            [
                AsrSegment(
                    start_ms=1500,
                    end_ms=5100,
                    text="爽やかな気持ちになりました何かさ最近暑くてさ",
                ),
            ],
        )

    def test_splits_japanese_text_on_punctuation(self):
        chars = [
            {"char": "こ", "start": 0.00, "end": 0.10},
            {"char": "ん", "start": 0.10, "end": 0.20},
            {"char": "に", "start": 0.20, "end": 0.30},
            {"char": "ち", "start": 0.30, "end": 0.40},
            {"char": "は", "start": 0.40, "end": 0.50},
            {"char": "。", "start": 0.50, "end": 0.60},
            {"char": "次", "start": 0.80, "end": 0.90},
            {"char": "で", "start": 0.90, "end": 1.00},
            {"char": "す", "start": 1.00, "end": 1.10},
            {"char": "。", "start": 1.10, "end": 1.20},
        ]

        self.assertEqual(
            build_segments_from_char_timestamps(chars, "こんにちは。次です。"),
            [
                AsrSegment(start_ms=0, end_ms=600, text="こんにちは。"),
                AsrSegment(start_ms=800, end_ms=1200, text="次です。"),
            ],
        )

    def test_splits_long_japanese_text_without_waiting_for_word_boundaries(self):
        text = "これはとても長い字幕なので途中で読みやすく分割します"
        chars = [
            {"char": ch, "start": i * 0.1, "end": (i + 1) * 0.1}
            for i, ch in enumerate(text)
        ]

        segments = build_segments_from_char_timestamps(chars, text, max_chars=14)

        self.assertGreater(len(segments), 1)
        self.assertEqual("".join(seg.text for seg in segments), text)
        self.assertTrue(all(seg.end_ms > seg.start_ms for seg in segments))

    def test_default_max_chars_allows_longer_forty_char_segments(self):
        text = "あ" * 36
        chars = [
            {"char": ch, "start": i * 0.02, "end": (i + 1) * 0.02}
            for i, ch in enumerate(text)
        ]

        self.assertEqual(
            build_segments_from_char_timestamps(chars, text),
            [AsrSegment(start_ms=0, end_ms=720, text=text)],
        )

    def test_keeps_short_phrase_together_across_timestamp_jitter(self):
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

        self.assertEqual(
            build_segments_from_char_timestamps(chars, text),
            [AsrSegment(start_ms=5040, end_ms=6960, text=text)],
        )

    def test_splits_on_short_pauses_after_japanese_soft_boundary(self):
        chars = [
            {"char": "そ", "start": 0.0, "end": 0.1},
            {"char": "う", "start": 0.1, "end": 0.2},
            {"char": "で", "start": 0.2, "end": 0.3},
            {"char": "す", "start": 0.3, "end": 0.4},
            {"char": "次", "start": 0.52, "end": 0.62},
            {"char": "で", "start": 0.62, "end": 0.72},
            {"char": "す", "start": 0.72, "end": 0.82},
        ]

        self.assertEqual(
            build_segments_from_char_timestamps(chars, "そうです次です"),
            [
                AsrSegment(start_ms=0, end_ms=400, text="そうです"),
                AsrSegment(start_ms=520, end_ms=820, text="次です"),
            ],
        )

    def test_default_max_duration_allows_nearly_five_second_segments(self):
        text = "今日は新しい企画なのでこちらで紹介"
        chars = [
            {"char": ch, "start": i * 0.28, "end": (i + 1) * 0.28}
            for i, ch in enumerate(text)
        ]

        self.assertEqual(
            build_segments_from_char_timestamps(chars, text),
            [AsrSegment(start_ms=0, end_ms=4760, text=text)],
        )

    def test_splits_long_duration_at_japanese_soft_boundary(self):
        text = "今日は新しい企画なのでこちらで紹介していきます"
        chars = [
            {"char": ch, "start": i * 0.25, "end": (i + 1) * 0.25}
            for i, ch in enumerate(text)
        ]

        segments = build_segments_from_char_timestamps(chars, text)

        self.assertGreater(len(segments), 1)
        self.assertEqual("".join(seg.text for seg in segments), text)
        self.assertEqual("今日は新しい企画なのでこちらで紹介して", segments[0].text)

    def test_ignores_blank_tokens_and_keeps_timing_contiguous(self):
        chars = [
            {"char": "あ", "start": 1.0, "end": 1.1},
            {"char": " ", "start": 1.1, "end": 1.2},
            {"char": "い", "start": 1.2, "end": 1.3},
        ]

        self.assertEqual(
            build_segments_from_char_timestamps(chars, "あい"),
            [AsrSegment(start_ms=1000, end_ms=1300, text="あい")],
        )

    def test_flattens_nemo_list_wrapped_tokens(self):
        text = "最初のコーナーはこちら"
        chars = [
            {"char": [""], "start": 0.00, "end": 0.08},
            *[
                {"char": [ch], "start": 0.08 + i * 0.08, "end": 0.16 + i * 0.08}
                for i, ch in enumerate(text)
            ],
        ]

        segments = build_segments_from_char_timestamps(chars, text)

        expected_end_ms = int(round((0.16 + (len(text) - 1) * 0.08) * 1000))
        self.assertEqual(
            [AsrSegment(start_ms=80, end_ms=expected_end_ms, text=text)],
            segments,
        )
        self.assertNotIn("[", segments[0].text)
        self.assertNotIn("'", segments[0].text)

    def test_transcribe_accepts_readme_style_output_and_uses_audio_duration(self):
        model = _ReadmeStyleModel()
        engine = _FakeParakeetEngine(model)
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_silence_wav(audio, duration_ms=4000)

            transcription = engine.transcribe(str(audio))
            segments = list(transcription.segments)

        self.assertEqual(transcription.duration_ms, 4000)
        self.assertEqual(transcription.language, "ja")
        self.assertEqual("".join(seg.text for seg in segments), "こんにちは。次です。")
        self.assertEqual(segments[-1].end_ms, 4000)
        self.assertEqual(model.calls[-1], {})

    def test_backfill_retranscribes_active_internal_gaps(self):
        engine = _BackfillFakeEngine(
            [AsrSegment(start_ms=4000, end_ms=14000, text="補完された音声")]
        )
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_activity_wav(audio, 40_000, [(18_000, 29_000)])

            merged = engine._backfill_missing_segments(
                str(audio),
                40_000,
                [
                    AsrSegment(start_ms=0, end_ms=15_000, text="前"),
                    AsrSegment(start_ms=32_000, end_ms=35_000, text="後"),
                ],
            )

        self.assertEqual(
            merged,
            [
                AsrSegment(start_ms=0, end_ms=15_000, text="前"),
                AsrSegment(start_ms=19_000, end_ms=29_000, text="補完された音声"),
                AsrSegment(start_ms=32_000, end_ms=35_000, text="後"),
            ],
        )
        self.assertEqual(len(engine.calls), 1)

    def test_backfill_skips_silent_internal_gaps(self):
        engine = _BackfillFakeEngine(
            [AsrSegment(start_ms=0, end_ms=1000, text="不要な補完")]
        )
        original = [
            AsrSegment(start_ms=0, end_ms=5000, text="前"),
            AsrSegment(start_ms=65_000, end_ms=70_000, text="後"),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_silence_wav(audio, duration_ms=70_000)

            merged = engine._backfill_missing_segments(str(audio), 70_000, original)

        self.assertEqual(merged, original)
        self.assertEqual(engine.calls, [])

    def test_backfill_drops_segments_outside_target_gap(self):
        engine = _BackfillFakeEngine(
            [
                AsrSegment(start_ms=0, end_ms=320, text="これは"),
                AsrSegment(start_ms=2480, end_ms=7440, text="別に大きな口を披露する場所ではありません"),
                AsrSegment(start_ms=14_080, end_ms=14_480, text="なるほど。"),
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_activity_wav(audio, 35_000, [(18_480, 29_280)])

            merged = engine._backfill_missing_segments(
                str(audio),
                35_000,
                [
                    AsrSegment(start_ms=14_160, end_ms=18_480, text="前"),
                    AsrSegment(start_ms=29_280, end_ms=29_920, text="後"),
                ],
            )

        self.assertEqual(
            merged,
            [
                AsrSegment(start_ms=14_160, end_ms=18_480, text="前"),
                AsrSegment(start_ms=18_480, end_ms=18_800, text="これは"),
                AsrSegment(
                    start_ms=20_960,
                    end_ms=25_920,
                    text="別に大きな口を披露する場所ではありません",
                ),
                AsrSegment(start_ms=29_280, end_ms=29_920, text="後"),
            ],
        )

    def test_backfill_preserves_primary_segments_when_supplement_is_empty(self):
        engine = _BackfillFakeEngine([])
        original = [
            AsrSegment(start_ms=1000, end_ms=3000, text="すごい爽やかな気持ちになりました。"),
            AsrSegment(start_ms=1500, end_ms=5100, text="爽やかな気持ちになりました何かさ最近暑くてさ"),
            AsrSegment(start_ms=30_000, end_ms=31_000, text="後"),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_activity_wav(audio, 35_000, [(10_000, 20_000)])

            merged = engine._backfill_missing_segments(str(audio), 35_000, original)

        self.assertEqual(merged, original)

    def test_backfill_retries_active_gap_with_context_padding(self):
        engine = _QueuedBackfillFakeEngine(
            [
                [],
                [
                    AsrSegment(start_ms=0, end_ms=4000, text="左文脈"),
                    AsrSegment(start_ms=6000, end_ms=10000, text="補完された音声"),
                    AsrSegment(start_ms=19_500, end_ms=20_500, text="右文脈"),
                ],
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_activity_wav(audio, 40_000, [(18_000, 29_000)])

            merged = engine._backfill_missing_segments(
                str(audio),
                40_000,
                [
                    AsrSegment(start_ms=0, end_ms=18_000, text="前"),
                    AsrSegment(start_ms=29_000, end_ms=35_000, text="後"),
                ],
            )

        self.assertEqual(
            merged,
            [
                AsrSegment(start_ms=0, end_ms=18_000, text="前"),
                AsrSegment(start_ms=19_000, end_ms=23_000, text="補完された音声"),
                AsrSegment(start_ms=29_000, end_ms=35_000, text="後"),
            ],
        )
        self.assertEqual([duration for _, duration in engine.calls], [11_000, 21_000])

    def test_backfill_does_not_use_faster_whisper_fallback_by_default(self):
        engine = _FallbackBackfillFakeEngine(
            [AsrSegment(start_ms=1000, end_ms=5000, text="抹茶も大好きです")]
        )
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_activity_wav(audio, 120_000, [(86_000, 110_000)])

            merged = engine._backfill_missing_segments(
                str(audio),
                120_000,
                [
                    AsrSegment(start_ms=80_000, end_ms=86_000, text="前"),
                    AsrSegment(start_ms=110_000, end_ms=112_000, text="後"),
                ],
            )

        self.assertEqual(
            merged,
            [
                AsrSegment(start_ms=80_000, end_ms=86_000, text="前"),
                AsrSegment(start_ms=110_000, end_ms=112_000, text="後"),
            ],
        )
        self.assertGreaterEqual(len(engine.calls), 1)
        self.assertEqual(engine.fallback_calls, [])

    def test_cuda_diagnostic_explains_cpu_only_torch(self):
        reason = parakeet._cuda_unavailable_reason(_CpuOnlyTorch())

        self.assertIn("CPU 版 PyTorch", reason)
        self.assertIn("CUDA", reason)

    def test_availability_check_uses_lightweight_module_lookup(self):
        def fake_find_spec(name: str):
            return object() if name in {"nemo", "torch"} else None

        with patch("importlib.util.find_spec", side_effect=fake_find_spec):
            self.assertTrue(ParakeetEngine.is_available())


class ParakeetVadIntegrationTests(unittest.TestCase):
    def test_vad_enabled_uses_speech_segments(self):
        """VAD 启用时应按检测到的语音段分块，跳过中间长静音

        说明：合成音频不会被真实 Silero 判定为语音，故 mock detect_speech_segments
        返回已知语音段，确定性地验证 VAD 驱动的分块路径。
        """
        import engines.vad as vad_module

        engine = _BackfillFakeEngine([])
        engine.use_vad = True
        engine.vad_config = {
            'min_speech_duration_ms': 500,
            'min_silence_duration_ms': 300,
        }

        speech_segments = [
            vad_module.SpeechSegment(start_ms=0, end_ms=5_000),
            vad_module.SpeechSegment(start_ms=15_000, end_ms=20_000),
        ]

        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            # 内容无关紧要：VAD 检测被 mock；用静音避免 backfill 追加额外调用
            _write_silence_wav(audio, 20_000)

            with patch.object(
                vad_module.VadEngine,
                "detect_speech_segments",
                return_value=speech_segments,
            ):
                engine._transcribe_chunks(str(audio), 20_000)

        # 应转录 2 个语音段，跳过中间 10s 静音（固定分块 20s 只会产生 1 块）
        self.assertEqual(len(engine.calls), 2)

    def test_vad_disabled_uses_fixed_chunks(self):
        """VAD 禁用时应使用固定分块"""
        engine = _BackfillFakeEngine([])
        engine.use_vad = False

        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_silence_wav(audio, 120_000)

            engine._transcribe_chunks(str(audio), 120_000)

            # 120s / 45s ≈ 3 chunks
            self.assertEqual(len(engine.calls), 3)


if __name__ == "__main__":
    unittest.main()
