# ASR Directory Structure

## Root: `asr-service/`

| Path | Role |
|------|------|
| `main.py` | Process entry (uvicorn / app bootstrap) |
| `server.py` | FastAPI routes: health, engines, models, transcribe, jobs |
| `jobs.py` | `JobManager` / `AsrJob` — background threads, progress, cancel, ASS write |
| `schemas.py` | Pydantic request models with camelCase aliases |
| `models.py` | Model download manager (`DownloadManager`) |
| `ass_writer.py` | Write transcript segments to ASS on disk |
| `diagnostics.py` | JSONL debug log when `HIKARU_ASR_DEBUG_LOG` is set |
| `engines/base.py` | `AsrEngine`, `AsrSegment`, `Transcription` |
| `engines/registry.py` | Name → engine class; `list_engines` / `create_engine` / download helpers |
| `engines/faster_whisper.py` | Default Whisper runtime |
| `engines/kotoba_faster_whisper.py` | Kotoba Japanese model on faster-whisper |
| `engines/parakeet.py` | Optional Parakeet engine |
| `engines/qwen3_asr.py` | Optional Qwen3-ASR engine |
| `engines/vad.py` / `chunking.py` | VAD + chunking helpers |
| `tests/` | `unittest` modules (`test_jobs.py`, engine/cache/VAD tests, …) |

## Related Template

`src-tauri/resources/asr-service/` — bundled clean template for releases. Keep behavioral changes intentional across both trees when shipping.

## Placement Rules

- New engines: new module under `engines/` + registry entry.
- HTTP shapes: `schemas.py` + job `snapshot()` camelCase fields.
- Diagnostics events: `diagnostics.debug_log` / `debug_exception` — no secrets.

## Anti-Patterns

- Putting UI or Tauri path policy inside the sidecar
- Bypassing the registry with hard-coded engine imports in `server.py`
- Writing large model weights into the git tree
