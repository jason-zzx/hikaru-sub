# Phase 3C pre-model evidence

## Scope result

`upstream-generation-fallback-parity-v1` is implemented and reviewed only at the source/fake-generation/evidence-schema level. No ASR model was loaded and neither fallback diagnostic acquisition cell was run.

Key corrections completed in this review:

- temperature `0.0` now leaves both CTranslate2 sampling options untouched at the pinned 4.8.0 defaults while the sanitized schema reports `samplingTopK: null` and `samplingTemperature: null`; positive temperatures set exact top-k `0` and attempt temperature values;
- fallback average log probability remains double precision like Python, and CT2 float no-speech values are compared against Python's double `0.6`; boundary vectors now cover both previously divergent cases;
- exact strict no-speech/log-probability silence override, six-attempt all-failed selection, first-maximum ties, and selected-temperature prompt reset match faster-whisper 1.2.1;
- ignored raw attempts retain private token/text inputs while the publisher enforces a closed fallback trace inventory and recomputes score-derived average log probability, zlib compression ratio, trigger predicates, selected-output linkage, and each aggregate SHA-256; tracked publication retains only aggregate summaries;
- the closed two-cell fallback diagnostic schema remains promotion-ineligible and acquisition-blocked; fallback-only CMake configuration without the CT2 worker now fails closed;
- source, oracle, publisher, rebuilt worker/runner, DLL and config hashes in `gpu-fallback-diagnostic-lock.md` were refreshed and independently revalidated.

## Changed implementation and evidence files

- `native-asr/CMakeLists.txt`
- `native-asr/CMakePresets.json`
- `native-asr/src/ctranslate2_whisper.hpp`
- `native-asr/src/ctranslate2_whisper.cpp`
- `native-asr/tests/ctranslate2_whisper_tests.cpp`
- `research/publish_whisper_gpu_quality.py`
- `research/test_publish_whisper_gpu_quality.py`
- `research/test_whisper_fallback_oracle.py`
- `research/gpu-fallback-diagnostic-lock.md`
- `research/phase3c-pre-model-evidence.md`

## Pre-model checks

| Command | Result |
|---|---|
| `python research/test_publish_whisper_gpu_quality.py` | pass: 13 tests |
| `<asr-service-venv-python> research/test_whisper_fallback_oracle.py --runner <task-local-runner> --local-root research/local/oracle` | pass: 16 native/Python vectors |
| protocol preset configure/build/CTest | pass: 6/6 |
| CPU CT2 preset configure/build plus focused CTest | pass: 8/8 |
| CUDA Whisper-quality preset configure/build plus focused CTest | pass: 9/9, including fallback parity |
| `python ./.trellis/scripts/task.py validate <task>` | pass: both context manifests valid |
| lock source/runtime/config hash validation | pass: all frozen entries current |
| `git diff --check`, privacy scan, active/archive ignore checks, no-staged check | pass |

The combined convenience build wrappers exceeded the session command wrapper timeout after compilation; the resulting protocol/CPU/CUDA lanes were rerun with explicit bounded CTest commands and passed as recorded above.

## Unresolved risks and stop boundary

- Whether fallback triggers on the authoritative short/medium audio and whether it improves subtitle quality remain unknown until separately approved model-backed acquisition.
- T07 CTranslate2/CUDA artifacts remain development-only; any future acquisition must re-attest GPU, driver, loaded modules, restricted PATH, model, VAD and lock identities.
- Any further source, publisher, oracle or binary change invalidates the refreshed lock hashes and requires rebuild/revalidation.
- History eligibility remains intentionally unchanged and is not part of this candidate.
