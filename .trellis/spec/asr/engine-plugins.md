# ASR Engine Plugins

## Contract

All engines subclass `AsrEngine` (`engines/base.py`):

- Output units: `AsrSegment` (`start_ms`, `end_ms`, `text`)
- Streaming progress via `Transcription.segments` iterator
- Class methods: `is_available()`, `is_model_downloaded(model)`, `download_model(...)`
- Instance: construct with `model`, `device`, optional `compute_type`, `use_vad`, `vad_config`

Register in `_REGISTRY` inside `engines/registry.py`. `list_engines()` returns `{ name, available }` for the UI.

## Engines in Tree Today

| Name | Module | Dependency reality |
|------|--------|--------------------|
| `faster-whisper` | `faster_whisper.py` | Default setup path |
| `kotoba-faster-whisper` | `kotoba_faster_whisper.py` | Reuses faster-whisper runtime; needs `faster-whisper>=1.1.1`; single model id `kotoba-tech/kotoba-whisper-v2.0-faster` |
| `parakeet` | `parakeet.py` | Optional / large — install only when explicitly requested |
| `qwen3-asr` | `qwen3_asr.py` | Optional / large — same |
| `reazonspeech-nemo` | `reazonspeech_nemo.py` | Optional NeMo engine; whole-audio under 60 s, 45 s chunks (2 s overlap) beyond — built-in ALSD beam search is O(T²) on whole-audio input; CPU/CUDA profiles |

Setup scripts distinguish `parakeet-cpu|parakeet-cuda|qwen3-cpu|qwen3-cuda|reazonspeech-cpu|reazonspeech-cuda` from the default faster-whisper install (see `/AGENTS.md`). ReazonSpeech's CPU/CUDA profiles share `requirements-reazonspeech.txt`; the profile selects the PyTorch wheel source.

## Kotoba-Specific Cache Rule

`KotobaFasterWhisperEngine.require_preprocessor_config = True`. Cached snapshot must include `preprocessor_config.json`. This requirement is **Kotoba-only** — do not force it on ordinary faster-whisper models (`faster_whisper.py` defaults `require_preprocessor_config=False`). Tests: `tests/test_kotoba_faster_whisper.py`.

## Ordinary Faster-Whisper Long/Short Routing

- Route to long semantic mode only when the engine is ordinary `faster-whisper`, model key is `large-v2`, requested language is exactly `ja`, and WAV-header duration is at least `600_000ms`.
- Long mode uses the pinned 1.2.1 generation-loop fork, official managed Silero V4, CUDA/auto `int8_float16` (CPU `int8`), fixed runtime seed `0`, carried Japanese prompt state, aligned words without word-end seek refinement, and source-timestamp bounding.
- The target short path stays on upstream `WhisperModel` and V6 VAD. For Japanese `large-v2`, an unset/`auto`/`default` non-CPU compute uses `int8_float16`; explicit compute and CPU `int8` remain honored.
- Other languages/models and Kotoba do not enter the fork/V4/hard-hole path. Kotoba keeps its upstream model and specialized transcription options.
- `large-v2` readiness includes the hash-verified V4 asset; missing/corrupt V4 must fail long mode clearly rather than falling back to the known-fragmenting path.

## Scenario: CTranslate2 Whisper Inference Coordination

### 1. Scope / Trigger

CTranslate2 random generators are process-global. Apply this contract to every `faster-whisper` and `kotoba-faster-whisper` job whenever handle creation or lazy segment iteration can overlap another job.

### 2. Signatures

```python
whisper_inference_session(engine_name: str) -> Iterator[None]
mark_long_runtime_seeded() -> None
```

`JobManager` wraps `engine.transcribe(...)`, complete `Transcription.segments` iteration, and iterator close in `whisper_inference_session(job.engine)`.

### 3. Contracts

- One process-wide lock is shared by ordinary faster-whisper and Kotoba; other engines remain concurrent.
- Long mode claims session ownership before calling `ctranslate2.set_random_seed(0)`.
- Before unlocking after success, cancellation, generator close, or error, a seeded long session replaces seed `0` with a fresh system-random nonzero seed.
- Short faster-whisper and Kotoba never request fixed seed `0`; cleanup preserves their normal nondeterministic fallback behavior.
- Direct long engine callers must wrap handle creation **and complete lazy iteration** in `whisper_inference_session("faster-whisper")`. An unwrapped call fails before seed `0` or model loading.
- There is no environment/config key or user-facing seed control.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Whisper-family session already active | Wait for the shared lock; do not create the next engine handle |
| Non-Whisper job while Whisper runs | Continue independently |
| Long seed reset succeeds | Unlock; later short/Kotoba observes a nonzero replacement seed |
| Long seed reset fails/has unknown state | Mark runtime poisoned before unlock; fail current and all later Whisper-family jobs with restart guidance |
| Runtime already poisoned | Reject before `engine.transcribe(...)`; sidecar restart is the recovery |
| Direct long call without session | Raise `AsrError` before calling CTranslate2 seed/model APIs |

### 5. Good / Base / Bad Cases

- **Good:** `JobManager` owns the session; a cancelled long iterator is closed, seed is reset, then waiting Kotoba starts.
- **Base:** short-only or Kotoba-only jobs serialize with other Whisper jobs but never request seed `0`.
- **Bad:** release the lock after handle creation while the lazy iterator is still decoding; reset failure followed by allowing another Whisper job; call long mode directly without a session.

### 6. Tests Required

- Assert ordinary/Kotoba jobs cannot overlap from handle creation through lazy iterator close.
- Assert non-Whisper jobs remain concurrent.
- Cover success, cancellation/close, handle error, and lazy error seed cleanup.
- Force reset failure; assert runtime is poisoned, waiting/future Whisper jobs never enter engine code, and non-Whisper still runs.
- Assert direct unwrapped long calls do not invoke seed `0` or model loading.
- For auto-device warmup failure, observe the first GPU model is released (including traceback references) before CPU fallback construction.

### 7. Wrong vs Correct

```python
# Wrong: handle is lazy; decode continues after the lock is gone.
with whisper_inference_session("faster-whisper"):
    transcription = engine.transcribe(path, language="ja")
for segment in transcription.segments:
    consume(segment)

# Correct: session owns handle creation, iteration, and close.
with whisper_inference_session("faster-whisper"):
    transcription = engine.transcribe(path, language="ja")
    iterator = transcription.segments
    try:
        for segment in iterator:
            consume(segment)
    finally:
        close = getattr(iterator, "close", None)
        if close is not None:
            close()
```

## VAD

Engines accept `use_vad` + `vad_config`. Product expectation: VAD load/detect failure should degrade rather than hard-fail the whole transcription when fallback is implemented. VAD config is session-scoped in the app — sidecar should not invent persistence.

## Whole-Audio Buffers

Native whole-audio engines must keep PCM in a compact buffer (`bytes` / `array`) and convert it directly to the inference tensor. Do not materialize the full recording as `list[float]`: Python object overhead scales to multiple GiB per hour. Perform normalization and padding in the tensor path, and keep a unit test asserting that the WAV reader returns a compact representation.

## Anti-Patterns

- Extending `preprocessor_config.json` requirement to all Whisper models
- Releasing the Whisper inference lock before lazy iteration/close or leaving seed `0` active for a later short/Kotoba job
- Registering an engine that is never `is_available()`-honest about missing deps
- Adding a second registry parallel to `engines/registry.py`
