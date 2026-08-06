# T08 Kotoba K1 Corrected Handoff

## Disposition

`stop-revise`

K1 completed short-v1, medium-v1, and corrected long-v2 under one original inference identity. Short and medium pass the corrected semantic-gap policy; medium's two missed standalone vocalizations remain in CER and are published as excluded diagnostics. Long-v2 retains seven semantic gaps, so native Kotoba remains disabled and no K2 is authorized by this handoff.

## Corrected Quality Result

| Case | CER | CUDA RTF | Peak RSS | Timeline errors | Semantic gaps >=1.5s | Excluded vocalization gaps | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| `short-v1` | `0.3250` | warm median `0.035` | `1.66 GB` | 0 | 0 | 0 | pass |
| `medium-v1` | `0.2163` | `0.032` | `1.66 GB` | 0 | 0 | 2 | pass |
| `long-v2` | `0.2268` | `0.030` | `1.66 GB` | 0 | 7 | 0 | fail |

## Accepted Compatibility Inputs

- The existing worker/host accepts development protocol v1 `kotoba-faster-whisper -> ctranslate2` requests on CPU and CUDA.
- Kotoba requires non-empty `preprocessor_config.json` and a loaded 128-mel model; ordinary faster-whisper remains preprocessor-optional.
- Kotoba `useVad=true` fails before `ready` with `kotoba_vad_not_qualified`.
- The exact immutable Hugging Face snapshot revision `f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc` runs in place without model copying or mutation.
- Real Rust-host success, structured pre-ready failure, recovery/minimal ASS, cancellation/reap, and active-slot release remain accepted from the reviewed K1 implementation.

## Evidence Identity

- Original K1 inference lock: `24d20963c1d5790d142694f579e2baf7baf21bf19355e126aaa66352a95a7c4e`
- Corrected reassessment lock: `4a91bc04eb25c2c4fafc65667a05d233b8ef0f698ed6e7f7943d8197ffe0c6d1`
- Current long-v2 manifest: `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`
- Corrected K1 evidence: `research/evidence/kotoba-candidate.json`, SHA-256 `3b9df18e8792d5fddbe0db2c61691c232fa60c8650a313d649f5fe5786966b9c`
- Corrected K1 report: `research/kotoba-candidate-report.md`, SHA-256 `891792108ffe0481df831b670a5ece654af98e63aa1613bcca6bb3cac5cebe11`
- Cross-task correction matrix: `research/evidence/corrected-ct2-reassessment.json`, SHA-256 `a470ce38aeb2173b54b31f359771bc6d24836a5688ee605c0091db7681bdf99d`

The original K1 lock remains the immutable measured-input identity against historical long-v1. The correction lock changes only authoritative scoring/publication; no raw transcript, token trace, model, binary, or private path was tracked or mutated.

## Downstream Ownership

- T12 may consume the pinned Kotoba model file identities and exact immutable-cache reuse contract, but not treat K1 as an accepted subtitle algorithm.
- T14/T15 retain formal GPU pack/device qualification ownership.
- T16/T17 retain production routing/settings/UI ownership.
- T18 receives no accepted Kotoba algorithm input from K1.
- Release/default remains Python legacy; no production model manager, package, installer, portable, frontend, or runtime route changed.
