# T08 Kotoba K2 Handoff

## Disposition

`accepted-kotoba-algorithm-input`

The frozen `kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1` candidate completed short-v1, medium-v1, and long-v2 under one reviewed CUDA identity. Every case passes the frozen CER, GPU RTF, short cold wall, RSS, timeline, and zero-semantic-gap gates. All seven corrected K1 long-v2 gap coordinates are covered without a waiver.

## Quality Result

| Case | Samples | CER | CUDA RTF | Cold wall | Peak RSS | Timeline errors | Semantic gaps >=1.5s | Excluded vocalization gaps | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `short-v1` | 1 cold + 3 warm | `0.3500` | warm median `0.052` | `6.067s` | `1.66 GB` | 0 | 0 | 0 | pass |
| `medium-v1` | 1 measured | `0.2796` | `0.047` | informational | `1.66 GB` | 0 | 0 | 2 | pass |
| `long-v2` | 1 measured | `0.2948` | `0.043` | informational | `1.66 GB` | 0 | 0 | 0 | pass |

The seven K1 coordinates `(941630..945090)`, `(1276940..1278540)`, `(1289540..1291540)`, `(1456720..1458540)`, `(1606830..1608540)`, `(1845700..1847230)`, and `(4050480..4053460)` all publish `covered`. Coordinate-set SHA-256: `7aeda829b3a12c3a52e48ec2db70e1bf48af08f69cf839fcae5f26312657350f`.

## Accepted Algorithm Contract

- 1500-frame / 15-second maximum source window; padded 3000-frame / 30-second model and timestamp range.
- Japanese prompt, beam 5, temperature 0, no previous-text history, no VAD.
- Applied advance is exactly `min(proposedAdvance, 1000, remainingFrames)`, guaranteeing at least 500 frames / 5 seconds overlap for every full non-final source window.
- Non-final window `i` owns segment starts in `[S[i], S[i+1])`; final owns `[S[last], audioDuration)`. Exact boundaries belong to the later window.
- Owner evidence is resolved against the complete decoded-start chain, not assumed to be only `i+1`.
- One-window buffering; exact tuple dedup before callbacks; token-derived text/timestamps remain unchanged; no fuzzy merge, clipping, synthesis, reference repair, or gap filling.
- Progress follows ownership frontiers and reaches exact duration once.
- Strict adapter independently derives stride, ownership, disposition, counts, duplicate targets, progress, runtime identity, raw hashes, and shared T01 metrics.

## Cache And Runtime Inputs

- model: `kotoba-tech/kotoba-whisper-v2.0-faster`
- revision: `f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc`
- exact immutable Hugging Face snapshot is reused in place without copying or mutation
- Kotoba-only non-empty `preprocessor_config.json` and loaded 128-mel requirement remain mandatory
- CTranslate2 4.8.0, CUDA 12.8, device 0/FLOAT16, compute capability 8.6, cuDNN OFF
- ordinary faster-whisper and K1 defaults remain isolated; Kotoba `useVad=true` remains rejected before `ready`

## Evidence Identity

- K2 input lock: `research/kotoba-k2-lock.md`, SHA-256 `d55f363d69cf6ce29892c159e26556dcfecc00e207f7e7c9cd13425078d24c9a`
- K2 correction lock: `research/kotoba-k2-correction-lock.md`, SHA-256 `d9bc43b6a47743c7377e22d6676f5e4d9a119e07dbcb1ae7f0ebe9d6cfb1578a`
- sanitized evidence: `research/evidence/kotoba-k2-candidate.json`, SHA-256 `5b7fa644eb1d9cbd10412bf0959ea46631332b7bb1266567d203b00cbbfc2415`
- sanitized report: `research/kotoba-k2-candidate-report.md`, SHA-256 `5149c954b93ee6eeb6fd4fef3e25873d69ce7fcf99ef8102ba9a97607daf9419`
- ignored raw hashes: short `f563cceacc31e9e2ca0cd8437c3b39ccd8fa99acd3abd27451c47655cdbe6439`, medium `491623b83f22fcb1304da645940f62318830598abe90e89fbac62ca906f64d8f`, long-v2 `0a494f7e2d07d4abbf0ab49e5fcfab3c4e809f1bb2622fe346a5069495ea1bad`
- double publication is byte-identical for JSON and Markdown

## Downstream Boundary

- T12 may consume the pinned Kotoba model files, immutable cache-reuse contract, and accepted K2 algorithm identity.
- T14/T15 retain formal runtime-pack, driver/device matrix, fallback, and release GPU qualification ownership.
- T16/T17 retain production routing/settings/UI ownership.
- T18 may consume K2 as the accepted Kotoba algorithm input for final rebuild/cutover decisions.
- This handoff is not a publishable GPU pack and does not enable Release/default routing; Python legacy remains the product route.
