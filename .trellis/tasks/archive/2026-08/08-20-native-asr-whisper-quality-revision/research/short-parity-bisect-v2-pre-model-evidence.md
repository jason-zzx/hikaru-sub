# Phase 3D VAD identity repair pre-model evidence

## Disposition

**Pre-model v2 repair complete; independently reviewed `clean-to-request-renewed-acquisition`.** No VAD or ASR model was loaded, no parity cell ran, and no parity publication exists.

- Superseded acquisition lock SHA-256: `470f9e0fba8cb0bc837660eae4173635bcc86212bea83324a02c0953d9c36793`
- Corrected v2 lock SHA-256: `481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543`
- Candidate and four-cell matrix: unchanged `short-input-runtime-parity-bisect-v1`
- Production/default: unchanged Python legacy

The first acquisition authorization stopped before model load because the original lock froze only the expected VAD interval. V2 preserves that lock byte-for-byte and adds one closed boundary:

- exact CPython 3.11.15 executable;
- faster-whisper 1.2.1 `audio.py` and `vad.py`;
- exact Silero V6 ONNX asset;
- ONNX Runtime 1.26.0 package, native extension, runtime and providers-shared files;
- CPUExecutionProvider-only session and exact loaded sibling `onnxruntime.dll`;
- a sanitized ignored-local artifact binding WAV, decoded waveform, retained waveform and one `[0,385637)` interval;
- mandatory publisher validation of that artifact and current disk identities before any parity row is published.

## No-model checks

- Parity publisher mutation/privacy tests: `13/13` passed.
- Parser/input/VAD-tool tests: `7/7` passed.
- Existing GPU quality publisher tests: `15/15` passed.
- V2 tool and VAD disk identities: passed.
- All four final runner preflights completed with `modelLoaded=false` under v2.
- Original lock remains SHA-256 `470f9e0f...`; corrected lock is `481c17cc...`.

Mutation coverage rejects VAD asset/source/runtime file drift, interval or waveform drift, provider or loaded-module drift, input-lock drift and unknown/private fields. The VAD tool imports faster-whisper/ONNX Runtime only inside its execution entry point, so source/fake tests do not initialize either model.

## Next gate

Independent Gate D2 review found no blocker. Fresh explicit authorization is required for the exact v2 VAD preflight plus four frozen model-backed cells. The review itself does not authorize either operation.
