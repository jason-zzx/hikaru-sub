import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engines.base import AsrSegment, Transcription
from jobs import JobManager


class _FakeEngine:
    def transcribe(
        self,
        audio_path,
        *,
        language=None,
        cancel_check=None,
        progress_callback=None,
    ):
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


class _CancellableEngine:
    """首个片段产出后阻塞，直到 cancel_check 为 True。"""

    def transcribe(
        self,
        audio_path,
        *,
        language=None,
        cancel_check=None,
        progress_callback=None,
    ):
        def _iter():
            yield AsrSegment(start_ms=0, end_ms=500, text="first")
            for _ in range(50):
                if cancel_check and cancel_check():
                    return
                time.sleep(0.02)
            yield AsrSegment(start_ms=500, end_ms=1000, text="should-not-appear")

        return Transcription(duration_ms=1000, language="ja", segments=_iter())


class _ProgressOnlyEngine:
    """先上报进度，但暂不产出字幕片段。"""

    def __init__(self):
        self.reported = threading.Event()
        self.release = threading.Event()

    def transcribe(
        self,
        audio_path,
        *,
        language=None,
        cancel_check=None,
        progress_callback=None,
    ):
        def _iter():
            if progress_callback:
                progress_callback(400)
            self.reported.set()
            self.release.wait(timeout=1)
            return
            yield  # pragma: no cover

        return Transcription(duration_ms=1000, language="ja", segments=_iter())


class _OutOfOrderProgressEngine:
    def __init__(self) -> None:
        self.ready_for_second = threading.Event()
        self.proceed = threading.Event()

    def transcribe(
        self,
        audio_path,
        *,
        language=None,
        cancel_check=None,
        progress_callback=None,
    ):
        def _iter():
            yield AsrSegment(start_ms=0, end_ms=9000, text="late")
            self.ready_for_second.set()
            if not self.proceed.wait(timeout=1):
                return
            yield AsrSegment(start_ms=0, end_ms=3000, text="early-backfill")

        return Transcription(duration_ms=10_000, language="ja", segments=_iter())


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

    def test_cancelled_job_stops_during_segment_iteration(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp) / ".hikaru"
            project_dir.mkdir()
            audio = project_dir / "audio.wav"
            audio.write_bytes(b"fake audio")

            manager = JobManager()
            with patch("jobs.create_engine", return_value=_CancellableEngine()):
                job = manager.create(
                    audio_path=str(audio),
                    engine="parakeet",
                    model="nvidia/parakeet-tdt_ctc-0.6b-ja",
                    device="auto",
                    language="ja",
                )
                time.sleep(0.05)
                manager.cancel(job.id)
                snapshot = _wait_for_completion(job)

            self.assertEqual(snapshot["status"], "cancelled")
            self.assertEqual(snapshot["segmentCount"], 1)

    def test_progress_callback_updates_running_job_without_segments(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp) / ".hikaru"
            project_dir.mkdir()
            audio = project_dir / "audio.wav"
            audio.write_bytes(b"fake audio")

            engine = _ProgressOnlyEngine()
            manager = JobManager()
            with patch("jobs.create_engine", return_value=engine):
                job = manager.create(
                    audio_path=str(audio),
                    engine="parakeet",
                    model="nvidia/parakeet-tdt_ctc-0.6b-ja",
                    device="auto",
                    language="ja",
                )
                self.assertTrue(engine.reported.wait(timeout=1))
                running = job.snapshot(with_segments=True)
                engine.release.set()
                _wait_for_completion(job)

            self.assertEqual(running["status"], "running")
            self.assertEqual(running["segmentCount"], 0)
            self.assertEqual(running["processedMs"], 400)
            self.assertEqual(running["progress"], 0.4)

    def test_segment_progress_does_not_regress_on_out_of_order_end_ms(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp) / ".hikaru"
            project_dir.mkdir()
            audio = project_dir / "audio.wav"
            audio.write_bytes(b"fake audio")

            engine = _OutOfOrderProgressEngine()
            manager = JobManager()
            with patch("jobs.create_engine", return_value=engine):
                job = manager.create(
                    audio_path=str(audio),
                    engine="parakeet",
                    model="nvidia/parakeet-tdt_ctc-0.6b-ja",
                    device="auto",
                    language="ja",
                )
                self.assertTrue(engine.ready_for_second.wait(timeout=1))
                after_first = job.snapshot(with_segments=True)
                engine.proceed.set()
                snapshot = _wait_for_completion(job)

            self.assertEqual(after_first["status"], "running")
            self.assertEqual(after_first["processedMs"], 9000)
            self.assertEqual(after_first["progress"], 0.9)
            self.assertEqual(snapshot["status"], "completed")
            self.assertEqual(snapshot["processedMs"], 10_000)


if __name__ == "__main__":
    unittest.main()
