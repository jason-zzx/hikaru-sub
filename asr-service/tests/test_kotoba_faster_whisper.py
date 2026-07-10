import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engines.base import AsrError
from engines.faster_whisper import FasterWhisperEngine
from engines.kotoba_faster_whisper import (
    MODEL_ID,
    KotobaFasterWhisperEngine,
)
from engines.registry import create_engine, list_engines


class KotobaFasterWhisperEngineTests(unittest.TestCase):
    def test_uses_the_only_supported_model_by_default(self):
        engine = KotobaFasterWhisperEngine()
        self.assertEqual(engine.model, MODEL_ID)

    def test_requires_faster_whisper_1_1_1_or_newer(self):
        with patch.object(FasterWhisperEngine, "is_available", return_value=True):
            for version, expected in (
                ("1.0.3", False),
                ("1.1.0", False),
                ("1.1.1", True),
                ("1.2.1", True),
            ):
                with self.subTest(version=version):
                    with patch("faster_whisper.__version__", version):
                        self.assertEqual(
                            KotobaFasterWhisperEngine.is_available(),
                            expected,
                        )

    def test_refuses_to_load_an_unsupported_faster_whisper_runtime(self):
        engine = KotobaFasterWhisperEngine(device="cpu")
        with patch("faster_whisper.__version__", "1.1.0"):
            with patch("faster_whisper.WhisperModel"):
                with self.assertRaisesRegex(AsrError, r"faster-whisper>=1\.1\.1"):
                    engine.load()

    def test_rejects_unsupported_models_at_construction(self):
        for model in ("", "kotoba-tech/unsupported"):
            with self.subTest(model=model):
                with self.assertRaisesRegex(AsrError, MODEL_ID):
                    KotobaFasterWhisperEngine(model=model)

    def test_reports_unsupported_models_as_not_downloaded(self):
        for model in ("", "other/model"):
            with self.subTest(model=model):
                self.assertFalse(
                    KotobaFasterWhisperEngine.is_model_downloaded(model)
                )

    def test_rejects_unsupported_models_for_download(self):
        for model in ("", "other/model"):
            with self.subTest(model=model):
                with self.assertRaisesRegex(AsrError, MODEL_ID):
                    KotobaFasterWhisperEngine.download_model(model)

    def test_delegates_cache_detection_to_faster_whisper(self):
        with patch.object(
            FasterWhisperEngine,
            "is_model_downloaded",
            return_value=True,
        ) as check:
            self.assertTrue(KotobaFasterWhisperEngine.is_model_downloaded(MODEL_ID))
        check.assert_called_once_with(MODEL_ID)

    def test_requires_preprocessor_config_in_cached_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory)
            (snapshot / "config.json").write_text("{}", encoding="utf-8")
            (snapshot / "model.bin").write_bytes(b"model")
            (snapshot / "tokenizer.json").write_text("{}", encoding="utf-8")
            (snapshot / "vocabulary.json").write_text("{}", encoding="utf-8")

            with patch("faster_whisper.download_model", return_value=directory):
                self.assertFalse(
                    KotobaFasterWhisperEngine.is_model_downloaded(MODEL_ID)
                )
                (snapshot / "preprocessor_config.json").write_text(
                    '{"feature_size": 128}',
                    encoding="utf-8",
                )
                self.assertTrue(
                    KotobaFasterWhisperEngine.is_model_downloaded(MODEL_ID)
                )

    def test_delegates_download_and_progress_to_faster_whisper(self):
        progress = MagicMock()
        with patch.object(FasterWhisperEngine, "download_model") as download:
            KotobaFasterWhisperEngine.download_model(MODEL_ID, progress=progress)
        download.assert_called_once_with(MODEL_ID, progress=progress)

    def test_uses_kotoba_transcription_options(self):
        engine = KotobaFasterWhisperEngine()
        mock_model = MagicMock()
        mock_model.transcribe.return_value = (
            [],
            MagicMock(duration=10.0, language="ja"),
        )
        engine._model = mock_model

        engine.transcribe("dummy.wav", language="ja")

        kwargs = mock_model.transcribe.call_args.kwargs
        self.assertEqual(kwargs["chunk_length"], 15)
        self.assertFalse(kwargs["condition_on_previous_text"])
        self.assertEqual(kwargs["beam_size"], 5)
        self.assertTrue(kwargs["vad_filter"])

    def test_registry_lists_and_creates_the_engine(self):
        names = {item["name"] for item in list_engines()}
        self.assertIn("kotoba-faster-whisper", names)

        engine = create_engine(
            "kotoba-faster-whisper",
            model=MODEL_ID,
            device="cpu",
        )
        self.assertIsInstance(engine, KotobaFasterWhisperEngine)


if __name__ == "__main__":
    unittest.main()
