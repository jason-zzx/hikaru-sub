# Python Legacy CUDA ASR Baseline

> Deterministically generated from `python-legacy-baseline.json`. WAV+ASS remains the only reference truth; Python output is only a same-model/same-case subtitle-quality floor.

- Comparison profile: `python-legacy-cuda-v1`
- Corpus: `hikaru-user-ja-ground-truth-v1`
- Benchmark manifest SHA-256: `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`
- Performance/resource and structural/security gates remain absolute and independent.

## Baseline Rows

| Logical model | Case | Status | CER | S | D | I | Empty | Semantic gaps | Gap ms | Timeline errors | Cold inference RTF | Warm inference RTF | Cold wall ms | Peak RSS bytes | Timing provenance | Qwen median ms | Qwen P95 ms | Raw result SHA-256 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|
| `faster-whisper/large-v2` | `short-v1` | completed | 0.242 | 11 | 18 | 0 | 0 | 0 | 0 | 1 | 0.407 | 0.097 | 19997.403 | 4481679360 | `engine-native` | — | — | `6fa18a41d495871aefde78953d543fb470ba87d4b094d7433c3f8d43cbd999e8` |
| `faster-whisper/large-v2` | `medium-v1` | completed | 0.095 | 83 | 66 | 67 | 0 | 0 | 0 | 0 | 0.129 | — | 76747.105 | 4482007040 | `engine-native` | — | — | `39f5fb62516d1a7f415ced38428a0353ae49bd6d283045db81a6a7475b7f55f7` |
| `faster-whisper/large-v2` | `long-v2` | completed | 0.114 | 505 | 1191 | 581 | 0 | 24 | 78330 | 0 | 0.133 | — | 589451.451 | 4915367936 | `engine-native` | — | — | `526b7eb75306f6d5b2a667a511ef00c224cc842485e64331ee4850a96928d3ac` |
| `faster-whisper/large-v3` | `short-v1` | completed | 0.358 | 25 | 16 | 2 | 0 | 0 | 0 | 1 | 0.117 | 0.097 | 14390.201 | 3821871104 | `engine-native` | — | — | `d9dd89836eaf5e98e1d7697f7ed804f832b70e90f3809b94b2dfa3d8c89621fb` |
| `faster-whisper/large-v3` | `medium-v1` | completed | 0.100 | 72 | 92 | 64 | 0 | 0 | 0 | 1 | 0.143 | — | 85858.775 | 3821559808 | `engine-native` | — | — | `98797b2a713b8c2f8c4604d4ed5b4bff5cdcd7f1029150243dea84d2b7b0922f` |
| `faster-whisper/large-v3` | `long-v2` | completed | 0.180 | 958 | 1686 | 942 | 0 | 0 | 0 | 0 | 0.130 | — | 554031.066 | 4538273792 | `engine-native` | — | — | `29d36d654a3870542b913f8c638e57741585ab1254b2d6c65658ecc1ab34fe3b` |
| `kotoba-faster-whisper/kotoba-whisper-v2.0-faster` | `short-v1` | completed | 0.325 | 16 | 22 | 1 | 0 | 0 | 0 | 0 | 0.043 | 0.038 | 9839.156 | 2253049856 | `engine-native` | — | — | `739343348cfecbb1940ffeafd9894ac47176a6d216a63eb23354b82eddb72b2b` |
| `kotoba-faster-whisper/kotoba-whisper-v2.0-faster` | `medium-v1` | completed | 0.222 | 176 | 259 | 69 | 0 | 1 | 1590 | 0 | 0.031 | — | 24003.634 | 2253729792 | `engine-native` | — | — | `ca682492ef35c5a7e1e5dcaa85f29dc7e9a9b3202b35485c130c96bdf58df90b` |
| `kotoba-faster-whisper/kotoba-whisper-v2.0-faster` | `long-v2` | completed | 0.234 | 1087 | 3156 | 440 | 0 | 13 | 32270 | 1 | 0.028 | — | 129657.802 | 4545347584 | `engine-native` | — | — | `9785e696de568525ed56d6d1ba3d4fe7478bacf39faaa1871df0add89249b39d` |
| `parakeet/parakeet-tdt_ctc-0.6b-ja` | `short-v1` | completed | 0.758 | 1 | 90 | 0 | 0 | 5 | 10620 | 0 | 0.068 | 0.005 | 40018.334 | 3734224896 | `engine-native-or-synthetic-fallback` | — | — | `a86c8220d0493a5eea3142a1755492f5c7784f216ae6ca0087d48225f9611358` |
| `parakeet/parakeet-tdt_ctc-0.6b-ja` | `medium-v1` | completed | 0.282 | 254 | 189 | 198 | 0 | 12 | 31120 | 0 | 0.019 | — | 39140.876 | 3731873792 | `engine-native-or-synthetic-fallback` | — | — | `3495554b3b3ad1c4d9d5d5111588acd6e0d9f24a56fa98e2a225b89570d754d5` |
| `parakeet/parakeet-tdt_ctc-0.6b-ja` | `long-v2` | completed | 0.317 | 2263 | 1851 | 2210 | 0 | 57 | 192470 | 0 | 0.017 | — | 104903.860 | 3732934656 | `engine-native-or-synthetic-fallback` | — | — | `477a8c49f384e16d2fef0ff9b05bc3281e2f33e9072aed68dd1261d3a573591a` |
| `qwen3-asr/qwen3-asr-1.7b` | `short-v1` | completed | 0.250 | 14 | 16 | 0 | 0 | 0 | 0 | 0 | 0.431 | 0.272 | 34055.448 | 5358247936 | `forced-aligner` | 140.0 | 2060.0 | `abe89eada6df0fa5b2f50b7f4be833ab368d767acad459e5cd6827483fff349b` |
| `qwen3-asr/qwen3-asr-1.7b` | `medium-v1` | completed | 0.126 | 132 | 81 | 73 | 0 | 3 | 5420 | 0 | 0.230 | — | 137800.658 | 5358526464 | `forced-aligner` | 295.0 | 3543.0 | `b0223fae466edb3cabeaf79e6a4ec0903850eb2fbf07bb23347e098278898d3a` |
| `qwen3-asr/qwen3-asr-1.7b` | `long-v2` | completed | 0.200 | 1148 | 1619 | 1218 | 0 | 12 | 25440 | 0 | 0.555 | — | 2320006.708 | 5360271360 | `mixed` | — | — | `2171fb8f7757ad4642a2b88052c76658735621251231c9a5293cc0f4d21f790e` |
| `reazonspeech-nemo/reazonspeech-nemo-v2` | `short-v1` | completed | 0.108 | 2 | 11 | 0 | 0 | 0 | 0 | 0 | 0.121 | 0.081 | 33142.118 | 3653337088 | `engine-native` | — | — | `6ece024aa9defbc4a1890a2551efa80e5ea81655014df105eea126ccddbe8bf0` |
| `reazonspeech-nemo/reazonspeech-nemo-v2` | `medium-v1` | completed | 0.501 | 121 | 967 | 52 | 0 | 46 | 137230 | 0 | 0.071 | — | 63580.759 | 3654344704 | `engine-native` | — | — | `886f4a253f6e8e35c7efaddf2aa7e60b2335d80b205dbe5d5c3decc4e7537528` |
| `reazonspeech-nemo/reazonspeech-nemo-v2` | `long-v2` | completed | 0.265 | 1112 | 3486 | 694 | 0 | 83 | 282730 | 0 | 0.068 | — | 313925.879 | 3652632576 | `engine-native` | — | — | `9cedf428d4978b1e70828b2088b9b4276fda4a525ccf0b957f2706c0569f1afc` |

## Family-Gated Whisper Models

- `faster-whisper/tiny`: `family-gated-no-baseline`; it borrows no anchor metrics.
- `faster-whisper/base`: `family-gated-no-baseline`; it borrows no anchor metrics.
- `faster-whisper/small`: `family-gated-no-baseline`; it borrows no anchor metrics.
- `faster-whisper/medium`: `family-gated-no-baseline`; it borrows no anchor metrics.
- `faster-whisper/large-v3-turbo`: `family-gated-no-baseline`; it borrows no anchor metrics.

## Native Comparison Contract

- `cer`: `lower-or-equal`.
- `substitutions`: `lower-or-equal`.
- `deletions`: `lower-or-equal`.
- `insertions`: `lower-or-equal`.
- `emptyTextCount`: `lower-or-equal`.
- `semanticGapCount`: `lower-or-equal`.
- `semanticGapDurationMs`: `lower-or-equal`.
- `qwenForcedAlignerMedianStartErrorMs`: `lower-or-equal`; eligible forced-aligner provenance on both rows.
- `qwenForcedAlignerP95StartErrorMs`: `lower-or-equal`; eligible forced-aligner provenance on both rows.

Independent absolute gates:

- timeline legality: zero invalid/out-of-bounds/negative/reversed/zero-duration segments.
- valid UTF-8, text conservation, subtitle and protocol legality.
- complete required matrix and identity/evidence attestation.
- CPU inference RTF <= 1.0 and accelerated GPU inference RTF <= 0.5.
- short cold process wall <= 120s.
- peak RSS <= 6 GiB for CTranslate2 and <= 12 GiB for CrispASR.
- process cancellation/reap, recovery, path containment, privacy and license contracts.

## Limitations And Supersession

- low-volume remains absent from the authoritative corpus coverage.
- Python CUDA performance and resource values are diagnostic only and never establish relative native gates.
- Qwen3 long-v2 uses mixed timestamp provenance, so its baseline timing fields are ineligible while its text/gap quality fields remain published.
- native GGUF revisions/hashes marked pending in the identity manifest must be frozen before those model comparisons can qualify.
- Supersedes for prospective Python quality authority only: `.trellis/tasks/archive/2026-07/07-25-native-asr-benchmark-baseline/research/python-reference-report.md`; historical contents remain immutable.
