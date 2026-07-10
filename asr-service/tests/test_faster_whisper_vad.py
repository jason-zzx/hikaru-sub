import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engines.base import AsrError
from engines.faster_whisper import FasterWhisperEngine


class FasterWhisperVadTests(unittest.TestCase):
    def test_passes_vad_parameters_when_use_vad_enabled(self):
        """use_vad=True 时应传递自定义 VAD 参数"""
        engine = FasterWhisperEngine(
            model="base",
            use_vad=True,
            vad_config={
                'threshold': 0.6,
                'min_speech_duration_ms': 1000,
                'min_silence_duration_ms': 500,
            }
        )

        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([], MagicMock(duration=10.0, language="en"))
        engine._model = mock_model

        engine.transcribe('dummy.wav')

        call_kwargs = mock_model.transcribe.call_args.kwargs
        self.assertTrue(call_kwargs['vad_filter'])
        self.assertIsNotNone(call_kwargs['vad_parameters'])
        self.assertEqual(call_kwargs['vad_parameters']['threshold'], 0.6)
        self.assertEqual(call_kwargs['vad_parameters']['min_speech_duration_ms'], 1000)
        self.assertEqual(call_kwargs['vad_parameters']['min_silence_duration_ms'], 500)

    def test_uses_default_vad_when_use_vad_disabled(self):
        """use_vad=False 时应使用默认 VAD（vad_parameters=None）"""
        engine = FasterWhisperEngine(model="base", use_vad=False)

        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([], MagicMock(duration=10.0, language="en"))
        engine._model = mock_model

        engine.transcribe('dummy.wav')

        call_kwargs = mock_model.transcribe.call_args.kwargs
        self.assertTrue(call_kwargs['vad_filter'])
        self.assertIsNone(call_kwargs['vad_parameters'])

    def test_converts_max_segment_duration_to_seconds(self):
        """max_segment_duration_ms 应转换为 max_speech_duration_s"""
        engine = FasterWhisperEngine(
            model="base",
            use_vad=True,
            vad_config={'max_segment_duration_ms': 30_000}
        )

        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([], MagicMock(duration=10.0, language="en"))
        engine._model = mock_model

        engine.transcribe('dummy.wav')

        call_kwargs = mock_model.transcribe.call_args.kwargs
        self.assertEqual(call_kwargs['vad_parameters']['max_speech_duration_s'], 30.0)

    def test_uses_shared_defaults_when_vad_config_empty(self):
        """use_vad=True 且 vad_config 为空时应使用与 Parakeet/前端一致的默认值"""
        engine = FasterWhisperEngine(model="base", use_vad=True, vad_config={})

        mock_model = MagicMock()
        mock_model.transcribe.return_value = ([], MagicMock(duration=10.0, language="en"))
        engine._model = mock_model

        engine.transcribe('dummy.wav')

        vad_params = mock_model.transcribe.call_args.kwargs['vad_parameters']
        self.assertEqual(vad_params['min_speech_duration_ms'], 500)
        self.assertEqual(vad_params['min_silence_duration_ms'], 300)

    def test_passes_engine_specific_transcribe_options(self):
        class _ConfiguredEngine(FasterWhisperEngine):
            def _transcribe_options(self) -> dict:
                return {
                    "chunk_length": 15,
                    "condition_on_previous_text": False,
                }

        engine = _ConfiguredEngine(model="base")
        mock_model = MagicMock()
        mock_model.transcribe.return_value = (
            [],
            MagicMock(duration=10.0, language="ja"),
        )
        engine._model = mock_model

        engine.transcribe("dummy.wav", language="ja")

        call_kwargs = mock_model.transcribe.call_args.kwargs
        self.assertEqual(call_kwargs["chunk_length"], 15)
        self.assertFalse(call_kwargs["condition_on_previous_text"])

    def test_wraps_lazy_inference_errors_as_asr_errors(self):
        def broken_segments():
            raise RuntimeError("lazy inference failed")
            yield

        engine = FasterWhisperEngine(model="base")
        mock_model = MagicMock()
        mock_model.transcribe.return_value = (
            broken_segments(),
            MagicMock(duration=10.0, language="ja"),
        )
        engine._model = mock_model

        transcription = engine.transcribe("dummy.wav", language="ja")

        with self.assertRaisesRegex(AsrError, "转录失败"):
            list(transcription.segments)

    def test_default_engine_does_not_pass_specialized_options(self):
        engine = FasterWhisperEngine(model="base")
        mock_model = MagicMock()
        mock_model.transcribe.return_value = (
            [],
            MagicMock(duration=10.0, language="ja"),
        )
        engine._model = mock_model

        engine.transcribe("dummy.wav", language="ja")

        call_kwargs = mock_model.transcribe.call_args.kwargs
        self.assertNotIn("chunk_length", call_kwargs)
        self.assertNotIn("condition_on_previous_text", call_kwargs)
        self.assertEqual(call_kwargs["beam_size"], 5)


if __name__ == "__main__":
    unittest.main()
