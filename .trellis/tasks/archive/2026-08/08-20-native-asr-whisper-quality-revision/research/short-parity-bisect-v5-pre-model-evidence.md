# Phase 3D v5 VAD lock-selection repair pre-model evidence

## Disposition

**V5 pre-model implementation complete; independent review is still required.** This evidence does not authorize acquisition, Python Silero VAD inference, CTranslate2 Whisper/large-v3 construction, encode, generate, any parity cell, parser publication, parity attribution, quality/formal evidence, route/default changes, CPU inheritance, packaging, commit, push, or archive.

V5 repairs only the task-local Python VAD preflight lock-selection seam. The corrected tool accepts the canonical task-research `gpu-short-parity-bisect-lock-v5.md` and rejects v1-v4, unknown, cross-root, malformed, and wrong-audio inputs before loading the lock identity or importing faster-whisper/ONNX Runtime. The v4 C++ runner/worker, both isolated CT2 runtime roots, runtime-local `--vad-model` contract, production fallback invariant, protocol, and product defaults are unchanged.

## Frozen v5 identity

- Lock: `gpu-short-parity-bisect-lock-v5.md`
- Lock SHA-256: `6a2ee4ee58cde783be473e907a4fe56aa72c7afcdba7b567644d2dfce74ac8fb`
- Immutable v4 lock: `e38e23f5fc28405ffb2554324b2967c077d6eeda46b010ec51aac5bece378ff8`
- V4 invalid preflight record: `47299ae4a7d52b818dae72afa4e69f429e8ddd4e8a8a561ff5a96d0d894013c0`
- V4 tracked invalid report: `01d1279f18d8794bf814bffa8620ac1ec3efc0b975b8a4b44a7086a24d0a3de4`
- V4 pre-model re-attestation: `385353870ebba5d20c894daf595e80f735ff95d0e629992a7dc52c2fde46b5ef`

The v5 publisher treats v4 as the acquisition predecessor. Machine field `supersedesLockSha256` remains the v3 harness-predecessor value solely because the unchanged v4 C++ no-model validator freezes that assertion; separate publisher-enforced `acquisitionSupersedesLockSha256` binds v4 exactly.

## Changed task-local identities

| Input | Bytes | SHA-256 |
|---|---:|---|
| `whisper_short_vad_preflight.py` | 11,489 | `c841445714148cf9be7c62d0b522d9ae68864470dd73425544cadc5702fa981f` |
| `publish_whisper_short_parity_bisect.py` | 37,011 | `48df92790067f07ff34015f35b5d48a61fe9a17915f06a3370923623aa4fe2f4` |
| `test_publish_whisper_short_parity_bisect.py` | 31,901 | `6dc4e28c2c33dd89e82cc30a8d4e36221c83cb3a79171b0111d9056437a6a5fc` |
| `test_whisper_short_vad_preflight_lock.py` | 3,825 | `e4d642f16f22fe3eb0a46231f5b529eb3f7c11b2342857104f239f2008b8ec6b` |

No native C++ source, CMake preset, runner, worker, tokenizer, CT2/ORT/VAD runtime file, protocol, backend invariant, or product route changed for v5.

## Closed lock-selection coverage

The stdlib-only v5 lock tests load the tool without faster-whisper or ONNX Runtime and prove:

- exact canonical v5 reaches `load_identity` and the real v5 identity block without importing model packages;
- v1, v2, v3, v4, v6/unknown, same-name cross-root, malformed child path, and wrong audio fail before `load_identity`;
- the v5 publisher accepts only the canonical v5 lock and mutation-rejects v4 predecessor, v2/v3/v4 invalid evidence, v4 no-model preflight, VAD model, privacy/promotion, and stop-boundary drift.

## No-model execution proof

Both unchanged isolated roots reran the same executable runtime smoke:

| Runtime | Smoke SHA-256 | `modelLoaded` |
|---|---|---|
| native no-cuDNN | `4537074dee333f44e1383f1a44187e6ada0baffc6a1f584cfa31f175cd80f9c3` | `false` |
| Python-wheel | `0df1d87751e8d27f23f2a7962f98456349f33b359fda1e6eeb7432be16407a97` | `false` |

All four closed preflights reran under the v5 lock and reproduced the v4-reviewed byte hashes:

| Cell | SHA-256 | `vadModelLoaded` | `asrModelLoaded` | `modelLoaded` |
|---|---|---|---|---|
| `python-runtime-python-mel` | `e8b888fbaad6e3350867110a5b0d06f6844279cce11d05d0225952513c4a15a2` | `false` | `false` | `false` |
| `python-runtime-native-mel` | `9363ba44922fcefce3a537f4121a3831da14bab80f0fb3f8606da79bdc281cda` | `false` | `false` | `false` |
| `native-runtime-python-mel` | `c9eb1e3656ee6b662e82f71ed2da7c36118fecb167e82823d11290e8f9e74fc7` | `false` | `false` | `false` |
| `native-runtime-native-mel` | `03942aad9960e4945979a1c77128d07d8a43b295c3b17e02ec38573bcf44b7c7` | `false` | `false` | `false` |

Negative C++ no-model checks rejected missing `--vad-model`, the other isolated root's VAD path, and a wrong-identity runtime-local VAD asset before backend/model construction.

No v5 VAD artifact, VAD inference, ASR model construction, encode/generate output, parity raw row, parser artifact, or parity publication exists. Exact-v5 Python acceptance was exercised only through the post-lock pre-import boundary.

## Validation summary

- V5 stdlib lock-selection tests: `5/5` passed.
- Short parity publisher/mutation/privacy/determinism tests: `15/15` passed.
- Short parser/input/ORT import-only tests: `10/10` passed; no `InferenceSession` was constructed.
- Fake fallback Python/native oracle: `16` vectors passed without an ASR model.
- Existing GPU quality publisher tests: `15/15` passed.
- Protocol-only configure/build/CTest: `6/6` passed.
- CPU CT2 CTest: `8/8` passed against the unchanged CPU binary. A one-thread CPU rebuild was attempted twice but exceeded the harness timeout while rebuilding unchanged CT2 dependencies; no v5 C++ change depends on that rebuild.
- CUDA fallback no-model CTest: `9/9` passed.
- CUDA parity no-model CTest: `10/10` passed.
- Python `py_compile`: passed.
- V5 lock generation repeated byte-identically at SHA-256 `6a2ee4ee58cde783be473e907a4fe56aa72c7afcdba7b567644d2dfce74ac8fb`.
- Prior 30-file manifest plus v1-v4 locks, v2/v3/v4 invalid evidence, completed v3 VAD artifact, v4 reports/preflights, and prior publications remained byte-identical.

## Review and residual risk

Implementation self-review found no scope widening or model-load path. Independent review remains mandatory and must stay pre-model. The next unresolved risk is model-backed only: after fresh exact-v5 authorization, the real Silero V6 result/module identity and all four CTranslate2 generation cells still need fail-closed acquisition. No previous authorization carries forward.
