import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engines.vad import VadEngine


class VadEngineLoadTests(unittest.TestCase):
    def test_load_initializes_model_and_utils(self):
        """load() 应加载 Silero VAD 模型"""
        vad = VadEngine()
        vad.load()

        self.assertIsNotNone(vad._model)
        self.assertIsNotNone(vad._utils)

    def test_load_is_idempotent(self):
        """多次调用 load() 应该是幂等的"""
        vad = VadEngine()
        vad.load()
        model_first = vad._model

        vad.load()
        model_second = vad._model

        self.assertIs(model_first, model_second)


import tempfile
import wave
import math
from engines.vad import SpeechSegment


def _write_activity_wav(
    path: Path,
    duration_ms: int,
    active_ranges: list[tuple[int, int]],
) -> None:
    """生成测试音频：指定区域有活动信号，其他区域静音"""
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


class VadDetectionTests(unittest.TestCase):
    def test_detect_speech_segments_converts_sample_offsets_to_ms(self):
        """应将 Silero 输出的采样点偏移转换为毫秒 SpeechSegment 列表

        注意：不依赖 Silero 对合成音频的判定（纯音调不会被识别为语音），
        改为注入伪 get_speech_timestamps，确定性地验证本模块的转换逻辑。
        """
        vad = VadEngine()
        # 绕过真实模型加载，注入伪 utils：第一个元素即 get_speech_timestamps
        vad._model = object()

        captured = {}

        def fake_get_speech_timestamps(wav, model, **kwargs):
            captured['kwargs'] = kwargs
            captured['wav_len'] = len(wav)
            # 16kHz：1000ms=16000 采样点
            return [
                {'start': 16000, 'end': 48000},   # 1000ms - 3000ms
                {'start': 80000, 'end': 128000},  # 5000ms - 8000ms
            ]

        vad._utils = (fake_get_speech_timestamps,)

        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_activity_wav(audio, 10_000, [(1000, 3000), (5000, 8000)])

            segments = vad.detect_speech_segments(
                str(audio),
                threshold=0.6,
                min_speech_duration_ms=500,
            )

        self.assertEqual(len(segments), 2)
        self.assertIsInstance(segments[0], SpeechSegment)
        self.assertEqual(segments[0].start_ms, 1000)
        self.assertEqual(segments[0].end_ms, 3000)
        self.assertEqual(segments[1].start_ms, 5000)
        self.assertEqual(segments[1].end_ms, 8000)
        # 参数应透传给 Silero
        self.assertEqual(captured['kwargs']['threshold'], 0.6)
        self.assertEqual(captured['kwargs']['min_speech_duration_ms'], 500)
        # 10s @ 16kHz 应读出约 160000 采样点
        self.assertAlmostEqual(captured['wav_len'], 160000, delta=160)


from engines.vad import split_long_segments


class VadSplitTests(unittest.TestCase):
    def test_split_long_segments_creates_overlapping_windows(self):
        """应将超长语音段切分为带重叠的窗口"""
        segments = [
            SpeechSegment(start_ms=0, end_ms=50_000),  # 50s
        ]

        chunks = split_long_segments(
            segments,
            max_duration_ms=20_000,
            overlap_ms=2_000,
        )

        # 50s 应切分为 3 个窗口: [0-20], [18-38], [36-50]
        self.assertEqual(len(chunks), 3)
        self.assertEqual(chunks[0], (0, 20_000))
        self.assertEqual(chunks[1], (18_000, 38_000))
        self.assertEqual(chunks[2], (36_000, 50_000))

    def test_split_preserves_short_segments(self):
        """短于最大长度的语音段应保持不变"""
        segments = [
            SpeechSegment(start_ms=1000, end_ms=15_000),
        ]

        chunks = split_long_segments(segments, max_duration_ms=20_000)

        self.assertEqual(chunks, [(1000, 15_000)])

    def test_split_handles_multiple_segments(self):
        """应处理多个语音段"""
        segments = [
            SpeechSegment(start_ms=0, end_ms=10_000),
            SpeechSegment(start_ms=15_000, end_ms=45_000),  # 30s，需要切分
        ]

        chunks = split_long_segments(segments, max_duration_ms=20_000, overlap_ms=2_000)

        # 第一段保持，第二段切分为 2 个窗口
        self.assertEqual(len(chunks), 3)
        self.assertEqual(chunks[0], (0, 10_000))

    def test_split_avoids_infinite_loop_when_overlap_exceeds_max_duration(self):
        """max_duration_ms <= overlap_ms 时应回退为整段不切分"""
        segments = [SpeechSegment(start_ms=0, end_ms=50_000)]

        chunks = split_long_segments(
            segments,
            max_duration_ms=2_000,
            overlap_ms=2_000,
        )

        self.assertEqual(chunks, [(0, 50_000)])


if __name__ == "__main__":
    unittest.main()
