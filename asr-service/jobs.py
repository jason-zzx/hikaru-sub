"""转录任务管理：每个任务在后台线程运行，支持进度查询与取消。"""

from __future__ import annotations

import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

from engines.base import AsrError, AsrSegment
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
    ) -> AsrJob:
        job = AsrJob(
            id=uuid.uuid4().hex,
            audio_path=audio_path,
            engine=engine,
            model=model,
            device=device,
            language=language,
            compute_type=compute_type,
        )
        with self._lock:
            self._jobs[job.id] = job
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

    def _run(self, job: AsrJob) -> None:
        with job._lock:
            job.status = JobStatus.RUNNING
        try:
            if not os.path.isfile(job.audio_path):
                raise AsrError(f"音频文件不存在: {job.audio_path}")

            engine = create_engine(
                job.engine,
                model=job.model,
                device=job.device,
                compute_type=job.compute_type,
            )
            transcription = engine.transcribe(job.audio_path, language=job.language)
            with job._lock:
                job.duration_ms = transcription.duration_ms
                job.detected_language = transcription.language

            for seg in transcription.segments:
                if job._cancel.is_set():
                    with job._lock:
                        job.status = JobStatus.CANCELLED
                    return
                with job._lock:
                    job.segments.append(seg)
                    job.processed_ms = seg.end_ms
                    if job.duration_ms > 0:
                        job.progress = min(seg.end_ms / job.duration_ms, 1.0)

            with job._lock:
                # 取消可能恰在最后一段后触发
                if job._cancel.is_set():
                    job.status = JobStatus.CANCELLED
                    return
                job.status = JobStatus.COMPLETED
                job.progress = 1.0
                if job.duration_ms > 0:
                    job.processed_ms = job.duration_ms
        except AsrError as exc:
            with job._lock:
                job.status = JobStatus.FAILED
                job.error = str(exc)
        except Exception as exc:  # noqa: BLE001 兜底，避免线程静默崩溃
            with job._lock:
                job.status = JobStatus.FAILED
                job.error = f"内部错误: {exc}"
