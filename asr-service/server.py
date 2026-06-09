"""FastAPI 应用：暴露引擎查询、转录任务创建与进度查询接口。"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from engines.registry import list_engines
from jobs import JobManager
from models import DownloadManager
from schemas import DownloadModelRequest, TranscribeRequest

VERSION = "0.1.0"


def create_app() -> FastAPI:
    app = FastAPI(title="Hikaru-Sub ASR Sidecar", version=VERSION)
    manager = JobManager()
    downloads = DownloadManager()

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "version": VERSION}

    @app.get("/engines")
    def engines() -> dict:
        return {"engines": list_engines()}

    @app.get("/models/status")
    def model_status(
        engine: str = "faster-whisper", model: str = "large-v3"
    ) -> dict:
        available = any(
            e["name"] == engine and e["available"] for e in list_engines()
        )
        downloaded = downloads.is_downloaded(engine, model) if available else False
        return {
            "engine": engine,
            "model": model,
            "available": available,
            "downloaded": downloaded,
        }

    @app.post("/models/download")
    def model_download(req: DownloadModelRequest) -> dict:
        job = downloads.start(req.engine, req.model)
        return {"jobId": job.id, "status": job.status.value}

    @app.get("/models/download/{job_id}")
    def model_download_progress(job_id: str) -> dict:
        job = downloads.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="任务不存在")
        return job.snapshot()

    @app.post("/transcribe")
    def transcribe(req: TranscribeRequest) -> dict:
        job = manager.create(
            audio_path=req.audio_path,
            engine=req.engine,
            model=req.model,
            device=req.device,
            language=req.language,
            compute_type=req.compute_type,
        )
        return {"jobId": job.id, "status": job.status.value}

    @app.get("/jobs/{job_id}")
    def get_job(job_id: str, segments: bool = True) -> dict:
        job = manager.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="任务不存在")
        return job.snapshot(with_segments=segments)

    @app.post("/jobs/{job_id}/cancel")
    def cancel_job(job_id: str) -> dict:
        if not manager.cancel(job_id):
            raise HTTPException(status_code=404, detail="任务不存在")
        return {"ok": True}

    return app
