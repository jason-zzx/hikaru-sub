"""模型下载任务管理：后台线程下载模型，支持进度查询。

与转录任务相互独立：下载产物落入 HuggingFace 本地缓存，供后续转录复用。
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Optional

from engines.registry import download_model, is_model_downloaded


class DownloadStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class DownloadJob:
    id: str
    engine: str
    model: str
    status: DownloadStatus = DownloadStatus.RUNNING
    downloaded_bytes: int = 0
    total_bytes: int = 0
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def report(self, done: int, total: int) -> None:
        """下载进度回调（线程内调用）。"""
        with self._lock:
            self.downloaded_bytes = done
            self.total_bytes = total

    def snapshot(self) -> dict:
        """生成可 JSON 序列化的状态快照（camelCase，对齐前端约定）。"""
        with self._lock:
            if self.total_bytes > 0:
                progress = min(self.downloaded_bytes / self.total_bytes, 1.0)
            else:
                progress = 0.0
            if self.status == DownloadStatus.COMPLETED:
                progress = 1.0
            return {
                "id": self.id,
                "status": self.status.value,
                "progress": round(progress, 4),
                "downloadedBytes": self.downloaded_bytes,
                "totalBytes": self.total_bytes,
                "error": self.error,
            }


class DownloadManager:
    def __init__(self) -> None:
        self._jobs: Dict[str, DownloadJob] = {}
        self._lock = threading.Lock()

    def is_downloaded(self, engine: str, model: str) -> bool:
        return is_model_downloaded(engine, model)

    def start(self, engine: str, model: str) -> DownloadJob:
        job = DownloadJob(id=uuid.uuid4().hex, engine=engine, model=model)
        with self._lock:
            self._jobs[job.id] = job
        thread = threading.Thread(target=self._run, args=(job,), daemon=True)
        thread.start()
        return job

    def get(self, job_id: str) -> Optional[DownloadJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def _run(self, job: DownloadJob) -> None:
        try:
            download_model(job.engine, job.model, progress=job.report)
            with job._lock:
                job.status = DownloadStatus.COMPLETED
        except Exception as exc:  # noqa: BLE001 兜底，避免线程静默崩溃
            with job._lock:
                job.status = DownloadStatus.FAILED
                job.error = str(exc)
