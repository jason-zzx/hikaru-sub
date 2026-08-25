# Phase 3D v4 short parity runner repair pre-model evidence

## Disposition

**V4 pre-model implementation complete and ready for independent review.** This evidence does not authorize Python Silero VAD inference, CTranslate2 Whisper/large-v3 construction, encode, generate, any parity acquisition cell, parser publication, parity attribution, a quality candidate, production/default changes, CPU inheritance, or a formal matrix.

The v3 defect is repaired only in the task-local parity runner. `--short-parity-preflight` and `--run-whisper-short-parity` now require closed `--vad-model` input. The path must resolve canonically to `silero_vad_v6.onnx` beside the active isolated runner and must match size `1,245,151` plus SHA-256 `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2` before backend construction. The existing backend fallback invariant, protocol, worker route, and product defaults are unchanged.

## Frozen v4 identity

- Lock: `gpu-short-parity-bisect-lock-v4.md`
- Lock SHA-256: `e38e23f5fc28405ffb2554324b2967c077d6eeda46b010ec51aac5bece378ff8`
- Superseded v3 lock: `62ef486a9f54d62d3f78504fc293a1917e59746d85cf09a73422edc2c384e42f`
- V3 invalid first-cell record: `808dd23c1f69e395bd759aad183e04e6b32e8c354a54f151b64c001e22882132`
- V3 tracked invalid report: `1571773487cfe39fbf33daa149e030b29c257b3dca2760c0056604a46f79509d`
- Preserved completed v3 VAD artifact: `f7201eef4c0e912eb181291038f66942d218ef7fb5e14ff86a0783f62a447246`

The v1/v2/v3 locks, v2/v3 invalid records and reports, completed v3 VAD artifact, pre-model evidence, and prior GPU publications were checked as a 30-file immutable set and remained byte-identical.

## Changed source, tool, and binary identities

| Input | Bytes | SHA-256 |
|---|---:|---|
| `native-asr/tests/ctranslate2_whisper_tests.cpp` | 176,485 | `5020c49a7c6ef8eec18e4760675792698241d4a5e232ba9f4f9e1965ed4cd526` |
| `publish_whisper_short_parity_bisect.py` | 34,794 | `9c94d18fab5a75aee5ce10fe45f049114e34a97da153c15ef78bfd026e7081ed` |
| `test_publish_whisper_short_parity_bisect.py` | 30,052 | `855c7446641984e33cfc9e66227846f1e43dbbf4594725d81e9702aa690c449f` |
| `reproduction-commands.md` | 15,859 | `4e0542f1589d324fca8c53b43984db0340635dc2cdc6ca09f3cb58ea0f340d59` |
| parity runner, both roots | 1,117,184 | `d49c5708dc337dfbe0cf2862b4723bfa1852d4d97ac61d7cfed5583b0615fc7c` |
| parity worker, both roots | 552,960 | `d6649b54e0b7409e6e1acd6122fb29837504868af91902e29487ed238a6fc1b1` |
| exact Silero V6, both roots | 1,245,151 | `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2` |

Both isolated runtime roots have exact closed file inventories: seven files for native no-cuDNN and nine for Python-wheel CT2/cuDNN/OpenMP. The frozen expected post-generation module sets remain unchanged except for the rebuilt runner identity; the VAD asset is a required disk input, not a loaded module claim.

## No-model execution proof

Both runtime roots passed the same executable's `--fallback-self-check`, `--short-parity-self-check`, and `--self-check`. Task-local runtime smoke envelopes are:

| Runtime | Smoke SHA-256 | `modelLoaded` |
|---|---|---|
| native no-cuDNN | `4537074dee333f44e1383f1a44187e6ada0baffc6a1f584cfa31f175cd80f9c3` | `false` |
| Python-wheel | `0df1d87751e8d27f23f2a7962f98456349f33b359fda1e6eeb7432be16407a97` | `false` |

All four closed preflights completed with the exact runtime-local VAD identity and explicit `vadModelLoaded=false`, `asrModelLoaded=false`, and `modelLoaded=false`:

| Cell | Preflight SHA-256 |
|---|---|
| `python-runtime-python-mel` | `e8b888fbaad6e3350867110a5b0d06f6844279cce11d05d0225952513c4a15a2` |
| `python-runtime-native-mel` | `9363ba44922fcefce3a537f4121a3831da14bab80f0fb3f8606da79bdc281cda` |
| `native-runtime-python-mel` | `c9eb1e3656ee6b662e82f71ed2da7c36118fecb167e82823d11290e8f9e74fc7` |
| `native-runtime-native-mel` | `03942aad9960e4945979a1c77128d07d8a43b295c3b17e02ec38573bcf44b7c7` |

No v4 VAD-preflight artifact, parity raw row, parser artifact, or parity JSON/Markdown publication exists. Negative no-model checks rejected missing `--vad-model`, a VAD path from the other isolated root, and a wrong-size/hash runtime-local asset before backend/model construction.

## Validation summary

- Protocol-only CTest: `6/6` passed.
- CPU CT2 CTest: `8/8` passed.
- CUDA fallback no-model CTest: `9/9` passed.
- CUDA parity no-model CTest: `10/10` passed.
- Short parity publisher/mutation/privacy/determinism tests: `15/15` passed.
- Short parser/input/ORT import-only tests: `10/10` passed.
- Fake fallback Python/native oracle: `16` vectors passed.
- Existing GPU quality publisher tests: `15/15` passed after restoring the immutable historical fallback-runner copy used by that lock's disk-identity test.
- Python `py_compile`: passed.
- V4 lock regeneration: byte-identical at SHA-256 `e38e23f5fc28405ffb2554324b2967c077d6eeda46b010ec51aac5bece378ff8`.
- Frozen v4 source/tool/runtime disk re-attestation: passed.
- Active/archive ignore checks and 30-file predecessor immutability check: passed.

## Review and stop boundary

Implementation self-review found no scope widening or unresolved pre-model blocker. Independent Trellis review remains a parent-session gate and must not load VAD or ASR models. A clean independent review permits only requesting fresh explicit acquisition authorization under the exact v4 lock; it does not itself authorize inference.

Residual risks remain unchanged: the historical v3 completed VAD artifact cannot be reused under v4; future authorized VAD execution must bind the v4 lock, and any future parity model construction/generation/module-set or anchor-reproduction result remains unproven.
