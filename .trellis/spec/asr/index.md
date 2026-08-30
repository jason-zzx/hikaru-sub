# Legacy ASR Sidecar Development Guidelines

> Development and historical rollback source for the Python FastAPI ASR service (`asr-service/`).

**Global hard rules** (git commit policy, product naming, security, runtime dependency / model cache policy): see [`/AGENTS.md`](/AGENTS.md). This layer documents sidecar-local patterns.

---

## Overview

The sidecar owns its **development-only inference path**: pluggable Python engines, transcription jobs, model download status, ASS write-out when requested, and optional JSONL diagnostics.

Production desktop ASR uses the independent Native CTranslate2 CPU worker with exact manifest readiness for `tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, and `large-v3-turbo`; `large-v3` remains the frontend default. Tauri owns worker lifecycle and protocol orchestration; React owns UI, ASS editing, and translation.

The repo-root `asr-service/` remains development and one-cycle rollback evidence. It is not copied to `src-tauri/resources/`, included in NSIS/portable artifacts, or used by the production default route. Do not restore packaged template synchronization as part of ordinary sidecar development.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | `server.py`, `jobs.py`, `engines/`, `schemas.py`, tests |
| [Engine Plugins](./engine-plugins.md) | Registry, default vs optional engines, Kotoba cache rules |
| [API and Jobs](./api-and-jobs.md) | HTTP surface, schemas, snapshots, diagnostics |
| [Quality Guidelines](./quality-guidelines.md) | `unittest`; optional engine deps |

---

## Pre-Development Checklist

- [ ] Confirm the change is inference / job / engine related (not UI or FFmpeg)
- [ ] Register new engines in `engines/registry.py` and implement `AsrEngine`
- [ ] Keep HTTP request/response camelCase aliases aligned with frontend types
- [ ] VAD failures should degrade, not abort transcription when product expects fallback

---

## Quality Check Pointers

```bash
cd asr-service
python -m unittest discover tests
```

Note when optional engines (Parakeet / Qwen3) are not installed locally.

---

**Language**: Specs in this tree are written in **English**.
