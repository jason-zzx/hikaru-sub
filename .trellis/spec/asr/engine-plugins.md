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
| `reazonspeech-nemo` | `reazonspeech_nemo.py` | Optional NeMo whole-audio engine; CPU/CUDA profiles |

Setup scripts distinguish `parakeet-cpu|parakeet-cuda|qwen3-cpu|qwen3-cuda|reazonspeech-cpu|reazonspeech-cuda` from the default faster-whisper install (see `/AGENTS.md`). ReazonSpeech's CPU/CUDA profiles share `requirements-reazonspeech.txt`; the profile selects the PyTorch wheel source.

## Kotoba-Specific Cache Rule

`KotobaFasterWhisperEngine.require_preprocessor_config = True`. Cached snapshot must include `preprocessor_config.json`. This requirement is **Kotoba-only** — do not force it on ordinary faster-whisper models (`faster_whisper.py` defaults `require_preprocessor_config=False`). Tests: `tests/test_kotoba_faster_whisper.py`.

## VAD

Engines accept `use_vad` + `vad_config`. Product expectation: VAD load/detect failure should degrade rather than hard-fail the whole transcription when fallback is implemented. VAD config is session-scoped in the app — sidecar should not invent persistence.

## Whole-Audio Buffers

Native whole-audio engines must keep PCM in a compact buffer (`bytes` / `array`) and convert it directly to the inference tensor. Do not materialize the full recording as `list[float]`: Python object overhead scales to multiple GiB per hour. Perform normalization and padding in the tensor path, and keep a unit test asserting that the WAV reader returns a compact representation.

## Anti-Patterns

- Extending `preprocessor_config.json` requirement to all Whisper models
- Registering an engine that is never `is_available()`-honest about missing deps
- Adding a second registry parallel to `engines/registry.py`
