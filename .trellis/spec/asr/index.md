# ASR Sidecar Development Guidelines

> Python FastAPI ASR service (`asr-service/`).

**Global hard rules** (git commit policy, product naming, security, runtime dependency / model cache policy): see [`/AGENTS.md`](/AGENTS.md). This layer documents sidecar-local patterns.

---

## Overview

The sidecar owns **ASR inference only**: pluggable engines, transcription jobs, model download status, ASS write-out when requested, and optional JSONL diagnostics.

Tauri owns process lifecycle and HTTP proxying. React owns UI, ASS editing, and translation.

Packaged template copy may also live under `src-tauri/resources/asr-service/`. Prefer editing the repo-root `asr-service/` as the development source of truth and keep template sync intentional when releasing.

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
