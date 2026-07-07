import json
import sys
import tempfile
import threading
import time
import unittest
import wave
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


class _BlockingProgressEngine:
    """模拟 qwen3 一次性阻塞转录：transcribe 返回前（阻塞期间）调 progress_callback。

    用于验证 jobs.py 预探测 duration 使阻塞型引擎的进度在 transcribe 返回前即可上报。
    """

    def __init__(self, audio_duration_ms: int) -> None:
        self._audio_duration_ms = audio_duration_ms
        self.progress_seen: list[int] = []
        self.duration_when_progress: list[int] = []
        self.reported = threading.Event()

    def transcribe(
        self,
        audio_path,
        *,
        language=None,
        cancel_check=None,
        progress_callback=None,
    ):
        # 阻塞期间上报进度（此时 Transcription 尚未返回，jobs.py 旧逻辑会因 duration_ms=0 丢弃）
        if progress_callback:
            # 上报一半进度
            half = self._audio_duration_ms // 2
            progress_callback(half)
        self.reported.set()
        # 等主线程读取快照后放行
        time.sleep(0.3)
        return Transcription(
            duration_ms=self._audio_duration_ms, language="ja", segments=iter([])
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
            workspace = Path(tmp) / "cache" / "workspace" / "abc"
            workspace.mkdir(parents=True)
            audio = workspace / "audio.wav"
            audio.write_bytes(b"fake audio")
            ass_path = Path(tmp) / "episode.transcribed.ass"

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
            recovery_path = workspace / "asr-jobs" / f"{job.id}.json"
            recovery = json.loads(recovery_path.read_text(encoding="utf-8"))
            self.assertEqual(recovery["id"], job.id)
            self.assertEqual(recovery["status"], "completed")
            self.assertEqual(len(recovery["segments"]), 2)
            self.assertEqual(recovery["segments"][0]["text"], "こんにちは")

            ass_text = ass_path.read_text(encoding="utf-8")
            self.assertIn("[Events]", ass_text)
            self.assertIn("Dialogue: 0,0:00:00.00,0:00:00.60,Primary", ass_text)
            self.assertIn("こんにちは", ass_text)

    def test_completed_job_without_output_path_does_not_write_default_ass(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "cache" / "workspace" / "abc"
            workspace.mkdir(parents=True)
            audio = workspace / "audio.wav"
            audio.write_bytes(b"fake audio")

            manager = JobManager()
            with patch("jobs.create_engine", return_value=_FakeEngine()):
                job = manager.create(
                    audio_path=str(audio),
                    engine="parakeet",
                    model="nvidia/parakeet-tdt_ctc-0.6b-ja",
                    device="auto",
                    language="ja",
                )
                snapshot = _wait_for_completion(job)

            self.assertEqual(snapshot["status"], "completed")
            legacy_ass_name = "subtitles" + ".ass"
            self.assertFalse((workspace / legacy_ass_name).exists())

    def test_cancelled_job_stops_during_segment_iteration(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "cache" / "workspace" / "abc"
            workspace.mkdir(parents=True)
            audio = workspace / "audio.wav"
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
            workspace = Path(tmp) / "cache" / "workspace" / "abc"
            workspace.mkdir(parents=True)
            audio = workspace / "audio.wav"
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
            workspace = Path(tmp) / "cache" / "workspace" / "abc"
            workspace.mkdir(parents=True)
            audio = workspace / "audio.wav"
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

    def test_pre_probed_duration_enables_progress_for_blocking_engine(self):
        """阻塞型引擎（如 qwen3 一次性转录）在 transcribe 返回前上报进度时，
        jobs.py 预探测的 duration 使进度不被丢弃（修复进度卡 0% 的核心）。"""
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "cache" / "workspace" / "abc"
            workspace.mkdir(parents=True)
            audio = workspace / "audio.wav"
            # 写真实 2s wav，使 _duration_ms 预探测成功
            rate = 16000
            with wave.open(str(audio), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(rate)
                w.writeframes(b"\0\0" * (rate * 2))

            engine = _BlockingProgressEngine(audio_duration_ms=2000)
            manager = JobManager()
            with patch("jobs.create_engine", return_value=engine):
                job = manager.create(
                    audio_path=str(audio),
                    engine="qwen3-asr",
                    model="Qwen/Qwen3-ASR-1.7B",
                    device="cpu",
                    language="ja",
                )
                self.assertTrue(engine.reported.wait(timeout=2))
                running = job.snapshot(with_segments=True)
                _wait_for_completion(job)

            # 预探测已把 duration_ms 设为 2000，阻塞期间上报 1000 → progress 0.5
            self.assertEqual(running["status"], "running")
            self.assertEqual(running["durationMs"], 2000)
            self.assertEqual(running["processedMs"], 1000)
            self.assertAlmostEqual(running["progress"], 0.5, places=2)


if __name__ == "__main__":
    unittest.main()
