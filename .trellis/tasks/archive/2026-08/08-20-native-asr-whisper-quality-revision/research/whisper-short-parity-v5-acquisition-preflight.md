# Phase 3D v5 acquisition outcome

## Disposition

`invalid-evidence`; no parity attribution.

The fresh exact-v5 authorization was consumed under `gpu-short-parity-bisect-lock-v5.md` SHA-256 `6a2ee4ee58cde783be473e907a4fe56aa72c7afcdba7b567644d2dfce74ac8fb`.

## Completed gates

- The pre-model re-attestation matched the exact v5 lock, frozen source/tools, both isolated runtime roots, model/Mel/corpus/VAD/Python/ORT identities, restricted PATH, RTX 3070/driver/CUDA identity, and preserved predecessor evidence. Ignored sanitized artifact SHA-256: `d9414b5ce92f772b011c5509b40b513b07f897d360b4a82e4f60adaf81eb00bb`.
- Both runtime smokes and all four closed no-model preflights reproduced their reviewed hashes with every model-loaded flag false.
- The fresh Python Silero V6 preflight completed and reproduced one `[0,385637)` interval, the frozen waveform before/after VAD, exact loaded `{onnxruntime_providers_shared.dll, onnxruntime_pybind11_state.pyd}`, and exact not-loaded `onnxruntime.dll`. Ignored artifact SHA-256: `90e58fed46551047a55d89a537a8d91a692a844d73b6041c5d87ca4393b12002`.

## Exact stopping boundary

The first cell, `python-runtime-python-mel`, successfully constructed the frozen large-v3 CTranslate2 model under Python-wheel CT2/CUDA FP16. Before encode or generate, the parity-only entry rejected the frozen feature/model contract with:

```text
config_identity_mismatch: Short parity bisect requires the exact ordinary fallback identity
```

The frozen probe supplies `80 x 3000` Mel while the frozen large-v3 model exposes `128` Mel bins (`preprocessor_config.json: feature_size=128`). The source preflight could not observe this model-loaded contract, so the cell identity is invalid rather than a model-quality or factor-attribution result.

Ignored sanitized invalid record SHA-256: `3c8ebeddabe4b3e68b8c426a256293fd4cc0cc9d00d18d84e6cbaf1fff185d2c`; failure fingerprint SHA-256: `e55783fb28a1dbfb06cc2f6f5b6882a0eb230c07c704e7ee601396cc4f0d8e22`.

No atomic cell row, encode, generate, parser artifact, parity publication, transcript, token record, quality candidate, formal matrix, route/default change, CPU inheritance, packaging or commit exists. The other three cells were not run. V5 must not be repaired or retried in place, and this run creates no v6 identity.
