# T02 Planning Evidence

## Confirmed Current Implementation Facts

- Current pins are `faster-whisper==1.2.1` and `ctranslate2==4.8.0`.
- Python faster-whisper currently uses CPU int8/beam/VAD behavior; Kotoba currently uses 15s chunks, no previous text, Japanese and Kotoba-only `preprocessor_config.json` readiness.
- `large-v2` + `ja` + duration `>=600000ms` currently enters a V4/seed/session/semantic segmentation special path. T02 large-v3+Kotoba remains a general CT2 feasibility scope; T06 must validate large-v2 long audio as a product regression case.
- These facts explain current behavior and known risks. They are not native algorithm authority or parity gates.

## Authority And Planning Decisions

- T01 user WAV+ASS ground truth is the only quality/timeline reference; its per-case coverage and absolute CER/RTF/cold-wall/RSS/timeline budgets are user-reviewed and frozen.
- Implementation sources rank official CTranslate2/Whisper docs and stable APIs, pinned model cards, maintained community recommendations, then ground-truth measurements.
- Python output is optional current-implementation diagnostics. Missing Python results do not block native comparison and cannot patch reference annotations.
- Use task-local disposable C++ source and ignored local models/build/results.
- Test tokenizer/features/timestamps independently before model inference.
- T02 does not implement product VAD/fallback/merge/cache or large-v2 special handling; T06 owns those after authoritative evaluation.

## Manifest Handoff

Planning evidence remains as provenance, and both manifests now include T01 `research/benchmark-contract.md`. Add `research/python-reference-report.md` only if it exists, explicitly as non-gating current implementation reference.

## Risks To Carry Forward

- Exact CTranslate2 API/tokenizer/FFT selection requires immutable-source proof.
- Numerical tolerances must be fixed before transcript inspection.
- T02 proves only recorded Windows hardware feasibility; T12 owns package compatibility.
