# T08 Corrected CTranslate2 Handoff

## Current Authority

The current private benchmark uses distinct `long-v2` identity `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`. Archived long-v1 reports remain historical. Standalone approved vocalization gaps are diagnostic-only, remain in CER, and publish separately from semantic gaps.

## Corrected Dispositions

- T02 ordinary fixed-window: historical `stop-revise` (short CER and medium/long-v2 semantic gaps fail).
- T02 Kotoba fixed-window: historical `stop-revise` (medium/long-v2 semantic gaps fail).
- T06 selected Candidate A: corrected large-v3 short/medium/long-v2 pass; a separate future ordinary seven-model qualification matrix is now evidence-eligible. Production routing remains disabled.
- T06 Candidate B: diagnostic-only; do not run long and do not retain ORT/VAD as a T13 package input.
- T08 Kotoba K1: short and medium pass, but long-v2 retains seven semantic gaps; disposition remains `stop-revise` and no accepted Kotoba algorithm input is handed to T18.

## Downstream Boundary

- T12 may consume Kotoba's exact pinned model files and immutable Hugging Face cache-reuse contract.
- T13 remains free of Candidate B ORT/VAD input.
- T14/T15 retain formal runtime-pack and device qualification ownership.
- T16/T17 retain routing/settings/UI ownership.
- T18 receives no accepted Kotoba algorithm from K1.
- Release/default remains Python legacy; no inference was rerun and no production/UI/package route changed.

Authoritative artifacts:

- correction lock: `.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/corrected-ct2-reassessment-lock.md`, SHA-256 `4a91bc04eb25c2c4fafc65667a05d233b8ef0f698ed6e7f7943d8197ffe0c6d1`
- correction matrix: `.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/evidence/corrected-ct2-reassessment.json`, SHA-256 `a470ce38aeb2173b54b31f359771bc6d24836a5688ee605c0091db7681bdf99d`
- correction report: `.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/corrected-ct2-reassessment-report.md`, SHA-256 `984b4c48c499f64b0e64eeabef2b8c8ad590e958ec270385c7718cfa77f82a62`
