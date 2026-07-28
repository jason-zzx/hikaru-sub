import json
import sys
import tempfile
import threading
import time
import unittest
import wave
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engines.base import AsrSegment, Transcription
from engines.faster_whisper import _set_long_runtime_seed
from engines.whisper_runtime import (
    whisper_inference_session as runtime_whisper_inference_session,
)
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


class _ControlledLazyEngine:
    def __init__(
        self,
        *,
        blocked=False,
        error=False,
        handle_error=False,
        seeded=False,
        on_handle=None,
    ):
        self.error = error
        self.handle_error = handle_error
        self.seeded = seeded
        self.on_handle = on_handle
        self.handle_started = threading.Event()
        self.iteration_started = threading.Event()
        self.release = threading.Event()
        self.closed = threading.Event()
        if not blocked:
            self.release.set()

    def transcribe(
        self,
        audio_path,
        *,
        language=None,
        cancel_check=None,
        progress_callback=None,
    ):
        if self.seeded:
            _set_long_runtime_seed()
        self.handle_started.set()
        if self.on_handle is not None:
            self.on_handle()
        if self.handle_error:
            raise RuntimeError("handle creation failed")

        def _iter():
            self.iteration_started.set()
            try:
                self.release.wait(timeout=2)
                if self.error:
                    raise RuntimeError("lazy inference failed")
                yield AsrSegment(start_ms=0, end_ms=500, text="segment")
            finally:
                self.closed.set()

        return Transcription(duration_ms=1000, language="ja", segments=_iter())


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


class WhisperInferenceCoordinationTests(unittest.TestCase):
    def _audio(self, directory: str) -> Path:
        audio = Path(directory) / "audio.wav"
        audio.write_bytes(b"fake audio")
        return audio

    def _create_job(self, manager, audio, *, engine, model):
        return manager.create(
            audio_path=str(audio),
            engine=engine,
            model=model,
            device="auto",
            language="ja",
        )

    @staticmethod
    def _factory(engines):
        def create(_name, *, model, **_kwargs):
            return engines[model]

        return create

    def test_whisper_family_jobs_do_not_overlap_through_lazy_iteration(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio = self._audio(tmp)
            first = _ControlledLazyEngine(blocked=True)
            second = _ControlledLazyEngine()
            manager = JobManager()
            engines = {"first": first, "second": second}

            with patch("jobs.create_engine", side_effect=self._factory(engines)):
                first_job = self._create_job(
                    manager,
                    audio,
                    engine="faster-whisper",
                    model="first",
                )
                self.assertTrue(first.iteration_started.wait(timeout=1))
                second_job = self._create_job(
                    manager,
                    audio,
                    engine="kotoba-faster-whisper",
                    model="second",
                )
                try:
                    self.assertFalse(second.handle_started.wait(timeout=0.1))
                finally:
                    first.release.set()
                self.assertEqual(_wait_for_completion(first_job)["status"], "completed")
                self.assertEqual(_wait_for_completion(second_job)["status"], "completed")

            self.assertTrue(first.closed.is_set())
            self.assertTrue(second.handle_started.is_set())

    def test_cancelled_queued_whisper_job_never_creates_transcription_handle(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio = self._audio(tmp)
            first = _ControlledLazyEngine(blocked=True)
            queued = _ControlledLazyEngine()
            queued_waiting = threading.Event()
            manager = JobManager()
            engines = {"first": first, "queued": queued}

            def observed_session(engine_name):
                if engine_name == "kotoba-faster-whisper":
                    queued_waiting.set()
                return runtime_whisper_inference_session(engine_name)

            with (
                patch("jobs.create_engine", side_effect=self._factory(engines)),
                patch("jobs.whisper_inference_session", side_effect=observed_session),
            ):
                first_job = self._create_job(
                    manager,
                    audio,
                    engine="faster-whisper",
                    model="first",
                )
                self.assertTrue(first.iteration_started.wait(timeout=1))
                queued_job = self._create_job(
                    manager,
                    audio,
                    engine="kotoba-faster-whisper",
                    model="queued",
                )
                self.assertTrue(queued_waiting.wait(timeout=1))
                try:
                    self.assertFalse(queued.handle_started.is_set())
                    manager.cancel(queued_job.id)
                finally:
                    first.release.set()

                self.assertEqual(_wait_for_completion(first_job)["status"], "completed")
                queued_snapshot = _wait_for_completion(queued_job)

            self.assertEqual(queued_snapshot["status"], "cancelled")
            self.assertFalse(queued.handle_started.is_set())
            recovery = json.loads(
                (
                    audio.parent
                    / "asr-jobs"
                    / f"{queued_job.id}.json"
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(recovery["status"], "cancelled")

    def test_non_whisper_engine_remains_concurrent(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio = self._audio(tmp)
            whisper = _ControlledLazyEngine(blocked=True)
            other = _ControlledLazyEngine()
            manager = JobManager()
            engines = {"whisper": whisper, "other": other}

            with patch("jobs.create_engine", side_effect=self._factory(engines)):
                whisper_job = self._create_job(
                    manager,
                    audio,
                    engine="faster-whisper",
                    model="whisper",
                )
                self.assertTrue(whisper.iteration_started.wait(timeout=1))
                other_job = self._create_job(
                    manager,
                    audio,
                    engine="parakeet",
                    model="other",
                )
                try:
                    self.assertEqual(
                        _wait_for_completion(other_job)["status"],
                        "completed",
                    )
                    self.assertEqual(
                        whisper_job.snapshot(with_segments=False)["status"],
                        "running",
                    )
                finally:
                    whisper.release.set()
                self.assertEqual(
                    _wait_for_completion(whisper_job)["status"],
                    "completed",
                )

    def test_cancellation_closes_iterator_and_releases_whisper_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio = self._audio(tmp)
            first = _ControlledLazyEngine(blocked=True)
            second = _ControlledLazyEngine()
            manager = JobManager()
            engines = {"first": first, "second": second}

            with patch("jobs.create_engine", side_effect=self._factory(engines)):
                first_job = self._create_job(
                    manager,
                    audio,
                    engine="faster-whisper",
                    model="first",
                )
                self.assertTrue(first.iteration_started.wait(timeout=1))
                second_job = self._create_job(
                    manager,
                    audio,
                    engine="kotoba-faster-whisper",
                    model="second",
                )
                self.assertFalse(second.handle_started.wait(timeout=0.1))
                manager.cancel(first_job.id)
                first.release.set()

                self.assertEqual(_wait_for_completion(first_job)["status"], "cancelled")
                self.assertEqual(_wait_for_completion(second_job)["status"], "completed")

            self.assertTrue(first.closed.is_set())

    def test_lazy_error_releases_whisper_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio = self._audio(tmp)
            first = _ControlledLazyEngine(blocked=True, error=True)
            second = _ControlledLazyEngine()
            manager = JobManager()
            engines = {"first": first, "second": second}

            with patch("jobs.create_engine", side_effect=self._factory(engines)):
                first_job = self._create_job(
                    manager,
                    audio,
                    engine="faster-whisper",
                    model="first",
                )
                self.assertTrue(first.iteration_started.wait(timeout=1))
                second_job = self._create_job(
                    manager,
                    audio,
                    engine="faster-whisper",
                    model="second",
                )
                self.assertFalse(second.handle_started.wait(timeout=0.1))
                first.release.set()

                self.assertEqual(_wait_for_completion(first_job)["status"], "failed")
                self.assertEqual(_wait_for_completion(second_job)["status"], "completed")

            self.assertTrue(first.closed.is_set())

    def test_seeded_long_job_resets_random_seed_on_success_close_and_error(self):
        for mode, expected_status in (
            ("success", "completed"),
            ("close", "cancelled"),
            ("lazy-error", "failed"),
            ("handle-error", "failed"),
        ):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                audio = self._audio(tmp)
                engine = _ControlledLazyEngine(
                    blocked=mode == "close",
                    error=mode == "lazy-error",
                    handle_error=mode == "handle-error",
                    seeded=True,
                )
                manager = JobManager()
                ctranslate2 = ModuleType("ctranslate2")
                seed_calls = []
                ctranslate2.set_random_seed = seed_calls.append

                with (
                    patch.dict(sys.modules, {"ctranslate2": ctranslate2}),
                    patch(
                        "engines.whisper_runtime.secrets.randbelow",
                        return_value=40,
                    ),
                    patch(
                        "jobs.create_engine",
                        return_value=engine,
                    ),
                ):
                    job = self._create_job(
                        manager,
                        audio,
                        engine="faster-whisper",
                        model="long",
                    )
                    if mode == "close":
                        self.assertTrue(engine.iteration_started.wait(timeout=1))
                        manager.cancel(job.id)
                        engine.release.set()
                    snapshot = _wait_for_completion(job)

                self.assertEqual(snapshot["status"], expected_status)
                self.assertEqual(seed_calls, [0, 41])
                self.assertEqual(engine.closed.is_set(), mode != "handle-error")

    def test_later_short_and_kotoba_jobs_never_receive_fixed_seed_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio = self._audio(tmp)
            seed_calls = []
            observed_seeds = []
            long_engine = _ControlledLazyEngine(blocked=True, seeded=True)
            short_engine = _ControlledLazyEngine(
                on_handle=lambda: observed_seeds.append(seed_calls[-1]),
            )
            kotoba_engine = _ControlledLazyEngine(
                on_handle=lambda: observed_seeds.append(seed_calls[-1]),
            )
            manager = JobManager()
            engines = {
                "long": long_engine,
                "short": short_engine,
                "kotoba": kotoba_engine,
            }
            ctranslate2 = ModuleType("ctranslate2")
            ctranslate2.set_random_seed = seed_calls.append

            with (
                patch.dict(sys.modules, {"ctranslate2": ctranslate2}),
                patch(
                    "engines.whisper_runtime.secrets.randbelow",
                    return_value=98,
                ),
                patch("jobs.create_engine", side_effect=self._factory(engines)),
            ):
                long_job = self._create_job(
                    manager,
                    audio,
                    engine="faster-whisper",
                    model="long",
                )
                self.assertTrue(long_engine.iteration_started.wait(timeout=1))
                short_job = self._create_job(
                    manager,
                    audio,
                    engine="faster-whisper",
                    model="short",
                )
                kotoba_job = self._create_job(
                    manager,
                    audio,
                    engine="kotoba-faster-whisper",
                    model="kotoba",
                )
                self.assertFalse(short_engine.handle_started.wait(timeout=0.1))
                self.assertFalse(kotoba_engine.handle_started.wait(timeout=0.1))
                long_engine.release.set()
                self.assertEqual(_wait_for_completion(long_job)["status"], "completed")
                self.assertEqual(_wait_for_completion(short_job)["status"], "completed")
                self.assertEqual(_wait_for_completion(kotoba_job)["status"], "completed")

            self.assertEqual(seed_calls, [0, 99])
            self.assertEqual(observed_seeds, [99, 99])

    def test_reset_failure_poisons_waiting_whisper_jobs_without_blocking_others(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio = self._audio(tmp)
            seed_calls = []
            long_engine = _ControlledLazyEngine(
                blocked=True,
                error=True,
                seeded=True,
            )
            short_engine = _ControlledLazyEngine()
            kotoba_engine = _ControlledLazyEngine()
            other_engine = _ControlledLazyEngine()
            manager = JobManager()
            engines = {
                "long": long_engine,
                "short": short_engine,
                "kotoba": kotoba_engine,
                "other": other_engine,
            }
            ctranslate2 = ModuleType("ctranslate2")

            def set_random_seed(seed):
                seed_calls.append(seed)
                if seed != 0:
                    raise RuntimeError("reset failed")

            ctranslate2.set_random_seed = set_random_seed

            with (
                patch.dict(sys.modules, {"ctranslate2": ctranslate2}),
                patch(
                    "engines.whisper_runtime._WHISPER_RUNTIME_POISONED",
                    False,
                ),
                patch(
                    "engines.whisper_runtime.secrets.randbelow",
                    return_value=98,
                ),
                patch("jobs.create_engine", side_effect=self._factory(engines)),
            ):
                long_job = self._create_job(
                    manager,
                    audio,
                    engine="faster-whisper",
                    model="long",
                )
                self.assertTrue(long_engine.iteration_started.wait(timeout=1))
                short_job = self._create_job(
                    manager,
                    audio,
                    engine="faster-whisper",
                    model="short",
                )
                kotoba_job = self._create_job(
                    manager,
                    audio,
                    engine="kotoba-faster-whisper",
                    model="kotoba",
                )
                self.assertFalse(short_engine.handle_started.wait(timeout=0.1))
                self.assertFalse(kotoba_engine.handle_started.wait(timeout=0.1))

                long_engine.release.set()
                long_snapshot = _wait_for_completion(long_job)
                short_snapshot = _wait_for_completion(short_job)
                kotoba_snapshot = _wait_for_completion(kotoba_job)

                other_job = self._create_job(
                    manager,
                    audio,
                    engine="parakeet",
                    model="other",
                )
                self.assertEqual(
                    _wait_for_completion(other_job)["status"],
                    "completed",
                )

            self.assertEqual(seed_calls, [0, 99])
            self.assertEqual(long_snapshot["status"], "failed")
            self.assertIn("重启 ASR 服务", long_snapshot["error"])
            self.assertEqual(short_snapshot["status"], "failed")
            self.assertIn("重启 ASR 服务", short_snapshot["error"])
            self.assertEqual(kotoba_snapshot["status"], "failed")
            self.assertIn("重启 ASR 服务", kotoba_snapshot["error"])
            self.assertTrue(long_engine.closed.is_set())
            self.assertFalse(short_engine.handle_started.is_set())
            self.assertFalse(kotoba_engine.handle_started.is_set())


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
