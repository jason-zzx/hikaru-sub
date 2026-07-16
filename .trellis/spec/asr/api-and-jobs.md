# ASR HTTP API and Jobs

## App Factory

`server.create_app()` builds FastAPI, a `JobManager`, and a `DownloadManager`. Routes (see `server.py`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness + version |
| GET | `/engines` | Registered engines + availability |
| GET | `/models/status` | `available` / `downloaded` for engine+model |
| POST | `/models/download` | Start model download job |
| GET | `/models/download/{job_id}` | Download progress snapshot |
| POST | `/transcribe` | Start transcription job → `{ jobId, status }` |
| GET | `/jobs/{job_id}` | Job snapshot (`segments` query flag) |
| POST | `/jobs/{job_id}/cancel` | Cancel in-flight job via manager |

Tauri is the usual client; keep camelCase aliases stable for the React types (`AsrJobSnapshot`, etc.).

## Request Schemas

`schemas.py` uses Pydantic `populate_by_name` + Field aliases (`audioPath`, `outputAssPath`, `useVad`, `vadConfig`, `computeType`, …). Frontend sends camelCase; engines consume snake_case dumps where needed.

## Job Lifecycle

`jobs.JobManager.create(...)` spawns a background thread per job:

- Status: `pending` → `running` → `completed` | `failed` | `cancelled`
- Progress fields: `progress`, `durationMs`, `processedMs`, `segmentCount`, …
- Optional `output_ass_path` → `ass_writer.write_ass_file` on success
- Cancel via threading `Event`

`AsrJob.snapshot(with_segments=...)` is the JSON contract for polling.

## Diagnostics

`diagnostics.py` logs JSONL only when `HIKARU_ASR_DEBUG_LOG` is set by the Tauri host (path typically managed `asr-debug.log`). Useful events include app/job lifecycle and `model_download_*`. Do not log secrets or full credential headers.

## Anti-Patterns

- Breaking camelCase snapshot keys without updating `src/types` and Tauri proxies
- Running inference on the FastAPI worker thread (jobs already use background threads — keep it that way)
- Treating missing job ids as 200 with empty body (use 404 as today)
