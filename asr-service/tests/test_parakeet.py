import unittest
from pathlib import Path
import sys
import tempfile
import wave
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import engines.parakeet as parakeet
from engines.base import AsrSegment
from engines.parakeet import ParakeetEngine, build_segments_from_char_timestamps


def _write_silence_wav(path: Path, duration_ms: int) -> None:
    rate = 16000
    frames = int(rate * duration_ms / 1000)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"\0\0" * frames)


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

    def test_splits_on_short_pauses_by_default(self):
        chars = [
            {"char": "あ", "start": 0.0, "end": 0.1},
            {"char": "い", "start": 0.1, "end": 0.2},
            {"char": "う", "start": 0.32, "end": 0.42},
            {"char": "え", "start": 0.42, "end": 0.52},
        ]

        self.assertEqual(
            build_segments_from_char_timestamps(chars, "あいうえ"),
            [
                AsrSegment(start_ms=0, end_ms=200, text="あい"),
                AsrSegment(start_ms=320, end_ms=520, text="うえ"),
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

    def test_cuda_diagnostic_explains_cpu_only_torch(self):
        reason = parakeet._cuda_unavailable_reason(_CpuOnlyTorch())

        self.assertIn("CPU 版 PyTorch", reason)
        self.assertIn("CUDA", reason)

    def test_availability_check_uses_lightweight_module_lookup(self):
        def fake_find_spec(name: str):
            return object() if name in {"nemo", "torch"} else None

        with patch("importlib.util.find_spec", side_effect=fake_find_spec):
            self.assertTrue(ParakeetEngine.is_available())


if __name__ == "__main__":
    unittest.main()
