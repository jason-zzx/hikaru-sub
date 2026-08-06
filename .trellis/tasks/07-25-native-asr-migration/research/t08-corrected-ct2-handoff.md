# T08 Corrected CTranslate2 Handoff

## Current Authority

The current private benchmark uses distinct `long-v2` identity `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`. Archived long-v1 reports remain historical. Standalone approved vocalization gaps are diagnostic-only, remain in CER, and publish separately from semantic gaps.

## Corrected Dispositions

- T02 ordinary fixed-window: historical `stop-revise` (short CER and medium/long-v2 semantic gaps fail).
- T02 Kotoba fixed-window: historical `stop-revise` (medium/long-v2 semantic gaps fail).
- T06 selected Candidate A: corrected large-v3 short/medium/long-v2 pass; a separate future ordinary seven-model qualification matrix is now evidence-eligible. Production routing remains disabled.
- T06 Candidate B: diagnostic-only; do not run long and do not retain ORT/VAD as a T13 package input.
- T08 Kotoba K1: historical `stop-revise`; short and medium pass, but long-v2 retained seven semantic gaps.
- T08 Kotoba K2: `accepted-kotoba-algorithm-input`; bounded 10-second applied stride plus latest-start half-open ownership passes short/medium/long-v2, has zero semantic gaps, and covers all seven K1 coordinates without a waiver. Short CER is exactly the inclusive `0.3500` gate; medium/long-v2 CER are `0.2796`/`0.2948`, with CUDA RTF `0.047`/`0.043`.

## Downstream Boundary

- T12 may consume Kotoba's exact pinned model files, immutable Hugging Face cache-reuse contract, and accepted K2 algorithm identity.
- T13 remains free of Candidate B ORT/VAD input.
- T14/T15 retain formal runtime-pack, driver/device matrix, fallback, and release GPU qualification ownership.
- T16/T17 retain routing/settings/UI ownership.
- T18 may consume K2 as the accepted Kotoba algorithm input for final rebuild/cutover decisions.
- Release/default remains Python legacy; no production/UI/package route changed.

Authoritative artifacts:

- correction lock: `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/corrected-ct2-reassessment-lock.md`, SHA-256 `4a91bc04eb25c2c4fafc65667a05d233b8ef0f698ed6e7f7943d8197ffe0c6d1`
- correction matrix: `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/evidence/corrected-ct2-reassessment.json`, SHA-256 `a470ce38aeb2173b54b31f359771bc6d24836a5688ee605c0091db7681bdf99d`
- correction report: `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/corrected-ct2-reassessment-report.md`, SHA-256 `984b4c48c499f64b0e64eeabef2b8c8ad590e958ec270385c7718cfa77f82a62`
- K2 input lock: `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/kotoba-k2-lock.md`, SHA-256 `d55f363d69cf6ce29892c159e26556dcfecc00e207f7e7c9cd13425078d24c9a`
- K2 evidence: `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/evidence/kotoba-k2-candidate.json`, SHA-256 `5b7fa644eb1d9cbd10412bf0959ea46631332b7bb1266567d203b00cbbfc2415`
- K2 report: `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/kotoba-k2-candidate-report.md`, SHA-256 `5149c954b93ee6eeb6fd4fef3e25873d69ce7fcf99ef8102ba9a97607daf9419`
- K2 handoff: `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/kotoba-k2-handoff.md`
