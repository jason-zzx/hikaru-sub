import importlib
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _reload_model_modules():
    diagnostics = importlib.import_module("diagnostics")
    diagnostics = importlib.reload(diagnostics)
    models = importlib.import_module("models")
    models = importlib.reload(models)
    return models


def _wait_for_status(job, status):
    deadline = time.time() + 2
    while time.time() < deadline:
        snapshot = job.snapshot()
        if snapshot["status"] == status:
            return snapshot
        time.sleep(0.02)
    raise AssertionError(f"job did not reach {status}: {job.snapshot()}")


class ModelDownloadDiagnosticsTests(unittest.TestCase):
    def test_failed_download_logs_huggingface_endpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "asr-debug.log"
            env = {
                "HIKARU_ASR_DEBUG_LOG": str(log_path),
                "HF_ENDPOINT": "https://hf-mirror.com",
                "HF_HOME": str(Path(tmp) / "hf-cache"),
            }
            with patch.dict(os.environ, env, clear=False):
                models = _reload_model_modules()
                manager = models.DownloadManager()
                with patch(
                    "models.download_model",
                    side_effect=RuntimeError(
                        "Distant resource does not seem to be on huggingface.co"
                    ),
                ):
                    job = manager.start("faster-whisper", "tiny")
                    snapshot = _wait_for_status(job, "failed")

            self.assertIn("Distant resource", snapshot["error"])
            self.assertIn("hf-mirror", snapshot["error"])
            self.assertIn("中国大陆出口", snapshot["error"])
            self.assertEqual(snapshot["hfEndpoint"], "https://hf-mirror.com")
            self.assertEqual(snapshot["hfHome"], str(Path(tmp) / "hf-cache"))
            self.assertEqual(snapshot["debugLogPath"], str(log_path))
            events = [
                json.loads(line)
                for line in log_path.read_text(encoding="utf-8").splitlines()
            ]
            error_events = [
                event for event in events if event["event"] == "model_download_error"
            ]
            self.assertTrue(error_events)
            self.assertEqual(error_events[-1]["hfEndpoint"], "https://hf-mirror.com")
            self.assertEqual(error_events[-1]["engine"], "faster-whisper")
            self.assertEqual(error_events[-1]["model"], "tiny")

        _reload_model_modules()


if __name__ == "__main__":
    unittest.main()
