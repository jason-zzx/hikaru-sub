"""FastAPI 应用：暴露引擎查询、转录任务创建与进度查询接口。"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from engines.registry import list_engines
from diagnostics import debug_log
from jobs import JobManager
from models import DownloadManager
from schemas import DownloadModelRequest, TranscribeRequest

VERSION = "0.1.0"


def create_app() -> FastAPI:
    app = FastAPI(title="Hikaru-Sub ASR Sidecar", version=VERSION)
    manager = JobManager()
    downloads = DownloadManager()
    debug_log("app_created", version=VERSION, manager_id=id(manager))

    @app.get("/health")
    def health() -> dict:
        debug_log("health")
        return {"status": "ok", "version": VERSION}

    @app.get("/engines")
    def engines() -> dict:
        engines_list = list_engines()
        debug_log("engines", engines=engines_list)
        return {"engines": engines_list}

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
        vad_config = (
            req.vad_config.model_dump(exclude_none=True)
            if req.vad_config is not None
            else {}
        )
        debug_log(
            "transcribe_request",
            engine=req.engine,
            model=req.model,
            device=req.device,
            language=req.language,
            outputAssPath=req.output_ass_path,
            audioPath=req.audio_path,
            useVad=req.use_vad,
            vadConfig=vad_config,
        )
        job = manager.create(
            audio_path=req.audio_path,
            engine=req.engine,
            model=req.model,
            device=req.device,
            language=req.language,
            compute_type=req.compute_type,
            output_ass_path=req.output_ass_path,
            use_vad=req.use_vad,
            vad_config=vad_config,
        )
        debug_log("transcribe_response", jobId=job.id, status=job.status.value)
        return {"jobId": job.id, "status": job.status.value}

    @app.get("/jobs/{job_id}")
    def get_job(job_id: str, segments: bool = True) -> dict:
        job = manager.get(job_id)
        if job is None:
            debug_log("job_missing", jobId=job_id, manager_id=id(manager))
            raise HTTPException(status_code=404, detail="任务不存在")
        snapshot = job.snapshot(with_segments=segments)
        debug_log(
            "job_snapshot",
            jobId=job_id,
            status=snapshot.get("status"),
            progress=snapshot.get("progress"),
            segmentCount=snapshot.get("segmentCount"),
            withSegments=segments,
        )
        return snapshot

    @app.post("/jobs/{job_id}/cancel")
    def cancel_job(job_id: str) -> dict:
        if not manager.cancel(job_id):
            debug_log("cancel_missing", jobId=job_id, manager_id=id(manager))
            raise HTTPException(status_code=404, detail="任务不存在")
        debug_log("cancel_requested", jobId=job_id)
        return {"ok": True}

    return app
