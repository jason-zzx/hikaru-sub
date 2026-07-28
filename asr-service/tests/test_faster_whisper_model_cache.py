import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import ANY, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engines.faster_whisper import FasterWhisperEngine


def _fake_faster_whisper(model_path: str) -> ModuleType:
    module = ModuleType("faster_whisper")
    module.download_model = MagicMock(return_value=model_path)
    return module


class FasterWhisperModelCacheTests(unittest.TestCase):
    def test_rejects_incomplete_download_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory)
            (snapshot / "config.json").write_text("{}", encoding="utf-8")
            (snapshot / "tokenizer.json").write_text("{}", encoding="utf-8")
            (snapshot / "vocabulary.json").write_text("{}", encoding="utf-8")

            with patch.dict(
                sys.modules,
                {"faster_whisper": _fake_faster_whisper(directory)},
            ):
                self.assertFalse(
                    FasterWhisperEngine.is_model_downloaded("owner/model")
                )

    def test_accepts_snapshot_with_required_model_files(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory)
            (snapshot / "config.json").write_text("{}", encoding="utf-8")
            (snapshot / "model.bin").write_bytes(b"model")
            (snapshot / "tokenizer.json").write_text("{}", encoding="utf-8")
            (snapshot / "vocabulary.txt").write_text("token", encoding="utf-8")

            with patch.dict(
                sys.modules,
                {"faster_whisper": _fake_faster_whisper(directory)},
            ):
                self.assertTrue(
                    FasterWhisperEngine.is_model_downloaded("owner/model")
                )

    def test_large_v2_readiness_requires_verified_v4_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory)
            (snapshot / "config.json").write_text("{}", encoding="utf-8")
            (snapshot / "model.bin").write_bytes(b"model")
            (snapshot / "tokenizer.json").write_text("{}", encoding="utf-8")
            (snapshot / "vocabulary.txt").write_text("token", encoding="utf-8")

            with patch.dict(
                sys.modules,
                {"faster_whisper": _fake_faster_whisper(directory)},
            ):
                with patch(
                    "engines.silero_v4.is_silero_v4_ready",
                    return_value=False,
                ):
                    self.assertFalse(
                        FasterWhisperEngine.is_model_downloaded("large-v2")
                    )
                with patch(
                    "engines.silero_v4.is_silero_v4_ready",
                    return_value=True,
                ):
                    self.assertTrue(
                        FasterWhisperEngine.is_model_downloaded("large-v2")
                    )

    def test_large_v2_download_includes_v4_without_resetting_main_progress(self):
        progress = MagicMock()
        with (
            patch(
                "engines.faster_whisper.snapshot_download_repo"
            ) as download_snapshot,
            patch("engines.silero_v4.download_silero_v4") as download_v4,
        ):
            FasterWhisperEngine.download_model("large-v2", progress=progress)

            download_snapshot.assert_called_once_with(
                "Systran/faster-whisper-large-v2",
                progress=progress,
                allow_patterns=ANY,
            )
            download_v4.assert_called_once_with()
            download_v4.reset_mock()

            FasterWhisperEngine.download_model("base", progress=progress)
            download_v4.assert_not_called()

    def test_validates_local_model_directories_too(self):
        with tempfile.TemporaryDirectory() as directory:
            model_dir = Path(directory)
            self.assertFalse(FasterWhisperEngine.is_model_downloaded(directory))

            (model_dir / "config.json").write_text("{}", encoding="utf-8")
            (model_dir / "model.bin").write_bytes(b"model")
            (model_dir / "tokenizer.json").write_text("{}", encoding="utf-8")
            (model_dir / "vocabulary.json").write_text("{}", encoding="utf-8")

            self.assertTrue(FasterWhisperEngine.is_model_downloaded(directory))


if __name__ == "__main__":
    unittest.main()
