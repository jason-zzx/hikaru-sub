# ASR Quality Guidelines

## Verification

```bash
cd asr-service
python -m unittest discover tests
```

Representative tests:

- `tests/test_jobs.py` — job manager behavior
- `tests/test_faster_whisper_model_cache.py` — cache readiness
- `tests/test_kotoba_faster_whisper.py` — version gate + preprocessor requirement
- `tests/test_vad.py`, `tests/test_chunking.py`, `tests/test_diagnostics.py`
- Optional engine suites: `test_parakeet.py`, `test_qwen3_asr_engine.py` (may need deps)

When optional engines or models are absent, report that limitation instead of claiming full coverage.

## Standards

- Engines stay behind `AsrEngine` + registry
- HTTP aliases stay aligned with frontend types
- Diagnostics are opt-in via env; keep default runs quiet
- Prefer small, focused unittest modules mirroring engines/helpers

## Anti-Patterns

- Committing model weights or venv contents
- Silent Kotoba cache “ready” without `preprocessor_config.json`
- Changing job snapshot shape without cross-layer type updates
- Adding GPU-only code paths without documenting CPU/optional install reality
