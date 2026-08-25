# Phase 3D actual Python ORT identity repair pre-model evidence

## Disposition

**V3 pre-model repair complete; independently reviewed `clean-to-request-fresh-v3-acquisition`.** No `InferenceSession` was constructed, no Silero VAD or ASR model was loaded, and no parity cell/parser/publication ran.

- Immutable v1 lock: `470f9e0fba8cb0bc837660eae4173635bcc86212bea83324a02c0953d9c36793`
- Immutable v2 lock: `481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543`
- V2 invalid record: `5c287a6b7b252284466379873bb4e2a237fda1dc0a1babc551583757ff3fc118`
- V2 tracked report: `86b7cfcde55d46848ec4003feadfff9b61c7e72e5cbca8eb0bd6658fe137b78d`
- Corrected v3 lock: `62ef486a9f54d62d3f78504fc293a1917e59746d85cf09a73422edc2c384e42f`

V3 changes only the Python ONNX Runtime VAD module contract. The candidate, four cells, C++ runner/worker, large-v3 model, Mel tensors, CT2 roots, prompt/options/fallback/parser logic and decision rule are unchanged.

## Import-only observation

A frozen CPython 3.11.15 / ONNX Runtime 1.26.0 import-only smoke loaded no model and constructed no session. The exact modules observed below the frozen `onnxruntime/capi` root were:

- loaded: `onnxruntime_providers_shared.dll`;
- loaded: `onnxruntime_pybind11_state.pyd`;
- not loaded: `onnxruntime.dll`.

Ignored sanitized smoke SHA-256: `3e3bbbff2aa438a662fb2a2380d6efe688072aebf7dc43a4f07a7d8ca25623e4`.

The future authorized VAD preflight must reproduce this exact relevant-module set after Silero inference. Missing/additional/cross-root/hash or loaded-status drift fails before ASR model load. Import-only evidence does not predict or waive the future session check.

## Validation

- parity publisher mutation/privacy tests: `14/14` passed;
- parser/input/ORT import tests: `10/10` passed, including producer-side cross-root and unresolved-module-path rejection;
- existing GPU quality publisher tests: `15/15` passed;
- `py_compile`: passed;
- no native/C++ source or binary rebuild was required by this repair.

## Stop boundary

Independent Gate D3 found no remaining blocker. Fresh explicit authorization is required for the exact v3 VAD preflight plus four frozen cells. The clean review does not authorize VAD inference, ASR model load or parity acquisition.
