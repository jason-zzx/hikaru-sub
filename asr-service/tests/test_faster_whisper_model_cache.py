import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch

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
