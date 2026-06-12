import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engines.base import AsrSegment, Transcription
from jobs import JobManager


class _FakeEngine:
    def transcribe(self, audio_path, *, language=None):
        return Transcription(
            duration_ms=1200,
            language=language or "ja",
            segments=iter(
                [
                    AsrSegment(start_ms=0, end_ms=600, text="こんにちは"),
                    AsrSegment(start_ms=700, end_ms=1200, text="次です"),
                ]
            ),
        )


def _wait_for_completion(job):
    deadline = time.time() + 3
    while time.time() < deadline:
        snapshot = job.snapshot(with_segments=True)
        if snapshot["status"] not in {"pending", "running"}:
            return snapshot
        time.sleep(0.02)
    raise AssertionError(f"job did not finish: {job.snapshot(with_segments=True)}")


class JobPersistenceTests(unittest.TestCase):
    def test_completed_job_writes_recovery_snapshot_and_ass_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp) / ".hikaru"
            project_dir.mkdir()
            audio = project_dir / "audio.wav"
            audio.write_bytes(b"fake audio")
            ass_path = project_dir / "subtitles.ass"

            manager = JobManager()
            with patch("jobs.create_engine", return_value=_FakeEngine()):
                job = manager.create(
                    audio_path=str(audio),
                    engine="parakeet",
                    model="nvidia/parakeet-tdt_ctc-0.6b-ja",
                    device="auto",
                    language="ja",
                    output_ass_path=str(ass_path),
                )
                snapshot = _wait_for_completion(job)

            self.assertEqual(snapshot["status"], "completed")
            recovery_path = project_dir / "asr-jobs" / f"{job.id}.json"
            recovery = json.loads(recovery_path.read_text(encoding="utf-8"))
            self.assertEqual(recovery["id"], job.id)
            self.assertEqual(recovery["status"], "completed")
            self.assertEqual(len(recovery["segments"]), 2)
            self.assertEqual(recovery["segments"][0]["text"], "こんにちは")

            ass_text = ass_path.read_text(encoding="utf-8")
            self.assertIn("[Events]", ass_text)
            self.assertIn("Dialogue: 0,0:00:00.00,0:00:00.60,Primary", ass_text)
            self.assertIn("こんにちは", ass_text)


if __name__ == "__main__":
    unittest.main()
