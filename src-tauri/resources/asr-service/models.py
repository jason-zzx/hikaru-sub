"""模型下载任务管理：后台线程下载模型，支持进度查询。

与转录任务相互独立：下载产物落入 HuggingFace 本地缓存，供后续转录复用。
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Optional

from diagnostics import debug_exception, debug_log
from engines.registry import download_model, is_model_downloaded

HF_MIRROR_ROUTE_HINT = (
    "当前使用 hf-mirror。该镜像可能按出口 IP 分流；如果模型下载流量"
    "没有全程使用中国大陆出口，可能会被重定向到 HuggingFace 官方站并失败。"
    "请切换为官方源，或确保模型下载流量全程使用中国大陆出口后重试。"
)


def model_download_error_hint(endpoint: Optional[str], error: str) -> Optional[str]:
    if not endpoint or "hf-mirror.com" not in endpoint:
        return None
    markers = [
        "Distant resource does not seem to be on huggingface.co",
        "trying to locate the file on the Hub",
        "cannot find the requested files in the local cache",
    ]
    if any(marker in error for marker in markers):
        return HF_MIRROR_ROUTE_HINT
    return None


class DownloadStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class DownloadJob:
    id: str
    engine: str
    model: str
    hf_endpoint: Optional[str] = None
    hf_home: Optional[str] = None
    debug_log_path: Optional[str] = None
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
                "hfEndpoint": self.hf_endpoint,
                "hfHome": self.hf_home,
                "debugLogPath": self.debug_log_path,
            }


class DownloadManager:
    def __init__(self) -> None:
        self._jobs: Dict[str, DownloadJob] = {}
        self._lock = threading.Lock()

    def is_downloaded(self, engine: str, model: str) -> bool:
        return is_model_downloaded(engine, model)

    def start(self, engine: str, model: str) -> DownloadJob:
        job = DownloadJob(
            id=uuid.uuid4().hex,
            engine=engine,
            model=model,
            hf_endpoint=os.environ.get("HF_ENDPOINT"),
            hf_home=os.environ.get("HF_HOME"),
            debug_log_path=os.environ.get("HIKARU_ASR_DEBUG_LOG"),
        )
        debug_log(
            "model_download_queued",
            jobId=job.id,
            engine=engine,
            model=model,
            hfEndpoint=job.hf_endpoint,
            hfHome=job.hf_home,
            debugLogPath=job.debug_log_path,
        )
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
            debug_log(
                "model_download_start",
                jobId=job.id,
                engine=job.engine,
                model=job.model,
                hfEndpoint=job.hf_endpoint,
                hfHome=job.hf_home,
                debugLogPath=job.debug_log_path,
            )
            download_model(job.engine, job.model, progress=job.report)
            with job._lock:
                job.status = DownloadStatus.COMPLETED
            debug_log(
                "model_download_completed",
                jobId=job.id,
                engine=job.engine,
                model=job.model,
                downloadedBytes=job.downloaded_bytes,
                totalBytes=job.total_bytes,
                hfEndpoint=job.hf_endpoint,
                hfHome=job.hf_home,
                debugLogPath=job.debug_log_path,
            )
        except Exception as exc:  # noqa: BLE001 兜底，避免线程静默崩溃
            error = str(exc)
            hint = model_download_error_hint(job.hf_endpoint, error)
            if hint:
                error = f"{error}\n{hint}"
            with job._lock:
                job.status = DownloadStatus.FAILED
                job.error = error
            debug_exception(
                "model_download_error",
                exc,
                jobId=job.id,
                engine=job.engine,
                model=job.model,
                hfEndpoint=job.hf_endpoint,
                hfHome=job.hf_home,
                debugLogPath=job.debug_log_path,
                hint=hint,
            )
