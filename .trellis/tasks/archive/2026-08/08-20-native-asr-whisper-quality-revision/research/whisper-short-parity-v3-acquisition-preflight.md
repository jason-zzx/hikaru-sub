# Phase 3D v3 acquisition preflight outcome

**Status: `invalid-evidence-pre-model-no-publication`.**

Fresh authorization was applied only to `short-input-runtime-parity-bisect-v1` under immutable lock SHA-256 `62ef486a9f54d62d3f78504fc293a1917e59746d85cf09a73422edc2c384e42f`.

## Completed gates

- The v1/v2/v3 lock hashes and frozen source, tool, model, Mel, runtime-file and loaded-module disk identities matched before VAD execution.
- Exact faster-whisper 1.2.1 Silero V6 VAD completed and retained one interval `[0,385637)`.
- The decoded and post-VAD waveform SHA-256 both matched `2cbf22e7635a41cf751401525e4358c19f2d452ae99c0ced78f65b6e9327e1c2`.
- Python ONNX Runtime reproduced the exact loaded set `{onnxruntime_providers_shared.dll, onnxruntime_pybind11_state.pyd}`; frozen sibling `onnxruntime.dll` remained not loaded.

## Fail-closed boundary

The first cell, `python-runtime-python-mel`, exited before CTranslate2 Whisper model construction with the frozen runner error fingerprint for `Fallback parity requires beam5/history-on/exact-VAD identity`.

The reviewed runner constructs the fallback-enabled parity backend with no VAD model path. The backend checks that invariant before creating the CTranslate2 Whisper model, so the unchanged v3 identity cannot reach model construction. This is a harness/identity defect, not feature/runtime attribution evidence.

- Silero VAD inference ran and passed.
- No CTranslate2 Whisper ASR model was loaded.
- No encoder or generation call ran.
- No atomic parity row or model metric exists.
- The remaining three cells did not run.
- No parser artifact or parity publication exists.
- Production/default remains Python legacy; no candidate, CER, CPU inheritance or formal-matrix conclusion was emitted.

## Evidence hashes

| Artifact | SHA-256 |
|---|---|
| immutable v1 lock | `470f9e0fba8cb0bc837660eae4173635bcc86212bea83324a02c0953d9c36793` |
| immutable v2 lock | `481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543` |
| immutable v3 lock | `62ef486a9f54d62d3f78504fc293a1917e59746d85cf09a73422edc2c384e42f` |
| ignored pre-model re-attestation | `ad48d75a8a85d4cdf6090cde10b4280653362d91b9876d4b754fb6e9478b38e8` |
| ignored completed VAD preflight | `f7201eef4c0e912eb181291038f66942d218ef7fb5e14ff86a0783f62a447246` |
| ignored invalid first-cell record | `808dd23c1f69e395bd759aad183e04e6b32e8c354a54f151b64c001e22882132` |

V3 remains immutable. Any repair requires a new rebuilt runner, new reviewed lock and fresh authorization; validation must not be relaxed in place.
