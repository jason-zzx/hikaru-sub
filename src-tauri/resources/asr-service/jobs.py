"""转录任务管理：每个任务在后台线程运行，支持进度查询与取消。"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional

from ass_writer import write_ass_file
from diagnostics import debug_exception, debug_log
from diagnostics import debug_log, debug_segments_in_range
from engines.base import AsrError, AsrSegment, TranscriptSegmentRefresh
from engines.chunking import _duration_ms
from engines.registry import create_engine


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class AsrJob:
    id: str
    audio_path: str
    engine: str
    model: str
    device: str
    language: Optional[str]
    compute_type: Optional[str] = None
    output_ass_path: Optional[str] = None
    use_vad: bool = False
    vad_config: Optional[dict] = None
    status: JobStatus = JobStatus.PENDING
    progress: float = 0.0
    duration_ms: int = 0
    processed_ms: int = 0
    detected_language: Optional[str] = None
    segments: List[AsrSegment] = field(default_factory=list)
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    _cancel: threading.Event = field(default_factory=threading.Event, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def snapshot(self, with_segments: bool = True) -> dict:
        """生成可 JSON 序列化的状态快照（camelCase，对齐前端约定）。"""
        with self._lock:
            data = {
                "id": self.id,
                "status": self.status.value,
                "progress": round(self.progress, 4),
                "durationMs": self.duration_ms,
                "processedMs": self.processed_ms,
                "segmentCount": len(self.segments),
                "detectedLanguage": self.detected_language,
                "error": self.error,
            }
            if with_segments:
                data["segments"] = [
                    {"startMs": s.start_ms, "endMs": s.end_ms, "text": s.text}
                    for s in self.segments
                ]
            return data


class JobManager:
    def __init__(self) -> None:
        self._jobs: Dict[str, AsrJob] = {}
        self._lock = threading.Lock()

    def create(
        self,
        *,
        audio_path: str,
        engine: str,
        model: str,
        device: str,
        language: Optional[str],
        compute_type: Optional[str] = None,
        output_ass_path: Optional[str] = None,
        use_vad: bool = False,
        vad_config: Optional[dict] = None,
    ) -> AsrJob:
        job = AsrJob(
            id=uuid.uuid4().hex,
            audio_path=audio_path,
            engine=engine,
            model=model,
            device=device,
            language=language,
            compute_type=compute_type,
            output_ass_path=output_ass_path,
            use_vad=use_vad,
            vad_config=vad_config,
        )
        with self._lock:
            self._jobs[job.id] = job
        debug_log(
            "job_created",
            jobId=job.id,
            engine=engine,
            model=model,
            device=device,
            language=language,
            audioPath=audio_path,
            outputAssPath=output_ass_path,
        )
        thread = threading.Thread(target=self._run, args=(job,), daemon=True)
        thread.start()
        return job

    def get(self, job_id: str) -> Optional[AsrJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if job is None:
            return False
        job._cancel.set()
        return True

    def _recovery_path(self, job: AsrJob) -> Path:
        return Path(job.audio_path).parent / "asr-jobs" / f"{job.id}.json"

    def _write_recovery_snapshot(self, job: AsrJob) -> None:
        path = self._recovery_path(job)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.tmp")
        tmp.write_text(
            json.dumps(job.snapshot(with_segments=True), ensure_ascii=False),
            encoding="utf-8",
        )
        tmp.replace(path)
        debug_log("job_recovery_saved", jobId=job.id, path=str(path))

    def _write_completed_ass(self, job: AsrJob) -> None:
        with job._lock:
            if job.status != JobStatus.COMPLETED or not job.segments:
                return
            segments = list(job.segments)
            output_ass_path = job.output_ass_path
        if not output_ass_path:
            debug_log("job_ass_save_skipped", jobId=job.id, reason="missing_output_path")
            return
        ass_path = Path(output_ass_path)
        write_ass_file(ass_path, segments)
        debug_log(
            "job_ass_saved",
            jobId=job.id,
            path=str(ass_path),
            segmentCount=len(segments),
        )

    def _persist_terminal_outputs(self, job: AsrJob) -> None:
        try:
            self._write_recovery_snapshot(job)
        except Exception as exc:  # noqa: BLE001 diagnostics only
            debug_exception("job_recovery_save_error", exc, jobId=job.id)
        try:
            self._write_completed_ass(job)
        except Exception as exc:  # noqa: BLE001 diagnostics only
            debug_exception("job_ass_save_error", exc, jobId=job.id)

    def _run(self, job: AsrJob) -> None:
        with job._lock:
            job.status = JobStatus.RUNNING
        debug_log("job_thread_start", jobId=job.id)
        try:
            if not os.path.isfile(job.audio_path):
                raise AsrError(f"音频文件不存在: {job.audio_path}")

            debug_log("job_create_engine_start", jobId=job.id, engine=job.engine)
            engine = create_engine(
                job.engine,
                model=job.model,
                device=job.device,
                compute_type=job.compute_type,
                use_vad=job.use_vad,
                vad_config=job.vad_config,
            )
            debug_log("job_create_engine_done", jobId=job.id, engine=job.engine)
            debug_log("job_transcribe_start", jobId=job.id)

            # 预探测音频时长，使阻塞型引擎（如 qwen3 一次性整段转录）的
            # progress_callback 在 transcribe 返回前就能正常上报进度。
            # 引擎内部仍可自行探测，开销仅为读取 wav 头，可忽略。
            try:
                pre_duration = _duration_ms(job.audio_path)
                if pre_duration > 0:
                    with job._lock:
                        if job.duration_ms <= 0:
                            job.duration_ms = pre_duration
                    debug_log("job_duration_pre_probed", jobId=job.id, durationMs=pre_duration)
            except Exception as exc:  # noqa: BLE001 预探测失败不阻断转录
                debug_exception("job_duration_pre_probe_error", exc, jobId=job.id)

            def report_progress(processed_ms: int) -> None:
                with job._lock:
                    if job.status != JobStatus.RUNNING or job.duration_ms <= 0:
                        return
                    next_processed = max(
                        job.processed_ms,
                        min(max(0, processed_ms), job.duration_ms),
                    )
                    job.processed_ms = next_processed
                    job.progress = min(next_processed / job.duration_ms, 1.0)

            transcription = engine.transcribe(
                job.audio_path,
                language=job.language,
                cancel_check=job._cancel.is_set,
                progress_callback=report_progress,
            )
            debug_log(
                "job_transcribe_handle_ready",
                jobId=job.id,
                durationMs=transcription.duration_ms,
                language=transcription.language,
            )
            with job._lock:
                job.duration_ms = transcription.duration_ms
                job.detected_language = transcription.language

            for item in transcription.segments:
                if job._cancel.is_set():
                    with job._lock:
                        job.status = JobStatus.CANCELLED
                    self._persist_terminal_outputs(job)
                    return
                if isinstance(item, TranscriptSegmentRefresh):
                    with job._lock:
                        job.segments = list(item.segments)
                        if job.segments:
                            last_end_ms = job.segments[-1].end_ms
                            if job.duration_ms > 0:
                                job.processed_ms = max(job.processed_ms, min(last_end_ms, job.duration_ms))
                                job.progress = min(job.processed_ms / job.duration_ms, 1.0)
                            else:
                                job.processed_ms = max(job.processed_ms, last_end_ms)
                        count = len(job.segments)
                    debug_log(
                        "job_segment_refresh",
                        jobId=job.id,
                        segmentCount=count,
                    )
                    debug_segments_in_range(
                        "job_segment_refresh_in_trace",
                        item.segments,
                        jobId=job.id,
                    )
                    continue
                seg = item
                with job._lock:
                    job.segments.append(seg)
                    if job.duration_ms > 0:
                        next_processed = max(
                            job.processed_ms,
                            min(seg.end_ms, job.duration_ms),
                        )
                        job.processed_ms = next_processed
                        job.progress = min(next_processed / job.duration_ms, 1.0)
                    else:
                        job.processed_ms = max(job.processed_ms, seg.end_ms)
                    count = len(job.segments)
                if count == 1 or count % 20 == 0:
                    debug_log(
                        "job_segment",
                        jobId=job.id,
                        segmentCount=count,
                        processedMs=seg.end_ms,
                    )

            cancelled_after_segments = False
            with job._lock:
                # 取消可能恰在最后一段后触发
                if job._cancel.is_set():
                    job.status = JobStatus.CANCELLED
                    cancelled_after_segments = True
                else:
                    job.status = JobStatus.COMPLETED
                    job.progress = 1.0
                    if job.duration_ms > 0:
                        job.processed_ms = job.duration_ms
            if cancelled_after_segments:
                debug_log("job_cancelled_after_segments", jobId=job.id)
                self._persist_terminal_outputs(job)
                return
            self._persist_terminal_outputs(job)
            debug_log("job_completed", jobId=job.id, segmentCount=len(job.segments))
        except AsrError as exc:
            debug_exception("job_asr_error", exc, jobId=job.id)
            with job._lock:
                job.status = JobStatus.FAILED
                job.error = str(exc)
            self._persist_terminal_outputs(job)
        except Exception as exc:  # noqa: BLE001 兜底，避免线程静默崩溃
            debug_exception("job_internal_error", exc, jobId=job.id)
            with job._lock:
                job.status = JobStatus.FAILED
                job.error = f"内部错误: {exc}"
            self._persist_terminal_outputs(job)
