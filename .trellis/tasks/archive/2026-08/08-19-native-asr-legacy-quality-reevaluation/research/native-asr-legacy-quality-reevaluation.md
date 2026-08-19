# Native ASR Legacy-Relative Quality Re-evaluation

> Deterministically generated from `native-asr-legacy-quality-reevaluation.json`. This is a historical-evidence quality reassessment, not production qualification.

- Comparison profile: `python-legacy-cuda-v1`
- Benchmark manifest SHA-256: `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`
- Native inference rerun: **none**
- Release eligibility: `not-decided-by-this-task`

## Model Summary

| Logical model | Frozen candidate | Old disposition | Observed relative metrics | Identity-aware subtitle quality | Native evidence | Independent gates |
|---|---|---|---|---|---|---|
| `faster-whisper/large-v3` | `selected-cpu-beam1-no-history` | `corrected-large-v3-pass` | `stop-revise` | `stop-revise` | `complete` | `pass` |
| `kotoba-faster-whisper/kotoba-whisper-v2.0-faster` | `kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1` | `accepted-kotoba-algorithm-input` | `stop-revise` | `stop-revise` | `complete` | `pass` |
| `parakeet/parakeet-tdt_ctc-0.6b-ja` | `P1-window15s-native-word-v1` | `stop-revise` | `stop-revise` | `baseline-incomplete` | `validated-failure` | `stop-revise` |
| `reazonspeech-nemo/reazonspeech-nemo-v2` | `R2-vad12-pad30-overlap-top-level-v1` | `stop-revise + better-than-r1` | `stop-revise` | `baseline-incomplete` | `validated-failure` | `stop-revise` |
| `qwen3-asr/qwen3-asr-1.7b` | `t03c-corrected-qwen-poc` | `stop-revise` | `stop-revise` | `baseline-incomplete` | `validated-failure` | `stop-revise` |

## Per-case Metrics

### `faster-whisper/large-v3`

#### `short-v1` — `completed-comparison` / observed `stop-revise` / identity-aware `stop-revise`

| Metric | Python | Native | Delta | Direction | Disposition | Provenance |
|---|---:|---:|---:|---|---|---|
| `cer` | 0.3583 | 0.2667 | -0.0917 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `substitutions` | 25 | 11 | -14 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `deletions` | 16 | 18 | 2 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `insertions` | 2 | 3 | 1 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `emptyTextCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapDurationMs` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |

#### `medium-v1` — `completed-comparison` / observed `stop-revise` / identity-aware `stop-revise`

| Metric | Python | Native | Delta | Direction | Disposition | Provenance |
|---|---:|---:|---:|---|---|---|
| `cer` | 0.1002 | 0.1134 | 0.0132 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `substitutions` | 72 | 78 | 6 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `deletions` | 92 | 149 | 57 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `insertions` | 64 | 31 | -33 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `emptyTextCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapDurationMs` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |

#### `long-v2` — `completed-comparison` / observed `stop-revise` / identity-aware `stop-revise`

| Metric | Python | Native | Delta | Direction | Disposition | Provenance |
|---|---:|---:|---:|---|---|---|
| `cer` | 0.1795 | 0.1509 | -0.0286 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `substitutions` | 958 | 631 | -327 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `deletions` | 1686 | 1906 | 220 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `insertions` | 942 | 477 | -465 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `emptyTextCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapDurationMs` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |

### `kotoba-faster-whisper/kotoba-whisper-v2.0-faster`

#### `short-v1` — `completed-comparison` / observed `stop-revise` / identity-aware `stop-revise`

| Metric | Python | Native | Delta | Direction | Disposition | Provenance |
|---|---:|---:|---:|---|---|---|
| `cer` | 0.3250 | 0.3500 | 0.0250 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `substitutions` | 16 | 16 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `deletions` | 22 | 21 | -1 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `insertions` | 1 | 5 | 4 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `emptyTextCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapDurationMs` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |

#### `medium-v1` — `completed-comparison` / observed `stop-revise` / identity-aware `stop-revise`

| Metric | Python | Native | Delta | Direction | Disposition | Provenance |
|---|---:|---:|---:|---|---|---|
| `cer` | 0.2215 | 0.2796 | 0.0580 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `substitutions` | 176 | 210 | 34 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `deletions` | 259 | 152 | -107 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `insertions` | 69 | 274 | 205 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `emptyTextCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapCount` | 1 | 0 | -1 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapDurationMs` | 1590 | 0 | -1590 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |

#### `long-v2` — `completed-comparison` / observed `stop-revise` / identity-aware `stop-revise`

| Metric | Python | Native | Delta | Direction | Disposition | Provenance |
|---|---:|---:|---:|---|---|---|
| `cer` | 0.2345 | 0.2948 | 0.0603 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `substitutions` | 1087 | 1263 | 176 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `deletions` | 3156 | 2154 | -1002 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `insertions` | 440 | 2471 | 2031 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `emptyTextCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapCount` | 13 | 0 | -13 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapDurationMs` | 32270 | 0 | -32270 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |

### `parakeet/parakeet-tdt_ctc-0.6b-ja`

#### `short-v1` — `completed-comparison` / observed `stop-revise` / identity-aware `baseline-incomplete`

| Metric | Python | Native | Delta | Direction | Disposition | Provenance |
|---|---:|---:|---:|---|---|---|
| `cer` | 0.7583 | 0.1667 | -0.5917 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `substitutions` | 1 | 5 | 4 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `deletions` | 90 | 12 | -78 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `insertions` | 0 | 3 | 3 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `emptyTextCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapCount` | 5 | 0 | -5 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapDurationMs` | 10620 | 0 | -10620 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |

#### `medium-v1` — `completed-comparison` / observed `stop-revise` / identity-aware `baseline-incomplete`

| Metric | Python | Native | Delta | Direction | Disposition | Provenance |
|---|---:|---:|---:|---|---|---|
| `cer` | 0.2818 | 0.3925 | 0.1108 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `substitutions` | 254 | 185 | -69 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `deletions` | 189 | 666 | 477 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `insertions` | 198 | 42 | -156 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `emptyTextCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapCount` | 12 | 17 | 5 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapDurationMs` | 31120 | 52280 | 21160 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |

#### `long-v2` — `validated-failed` / observed `unscored` / identity-aware `unscored`

Validated native failure: `parakeet_family_text_conservation` (`candidate-caused-structured-failure`). No CER, gap, or timing metric was synthesized.

### `reazonspeech-nemo/reazonspeech-nemo-v2`

#### `short-v1` — `completed-comparison` / observed `stop-revise` / identity-aware `baseline-incomplete`

| Metric | Python | Native | Delta | Direction | Disposition | Provenance |
|---|---:|---:|---:|---|---|---|
| `cer` | 0.1083 | 0.2667 | 0.1583 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `substitutions` | 2 | 2 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `deletions` | 11 | 30 | 19 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `insertions` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `emptyTextCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapCount` | 0 | 1 | 1 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapDurationMs` | 0 | 2080 | 2080 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |

#### `medium-v1` — `completed-comparison` / observed `stop-revise` / identity-aware `baseline-incomplete`

| Metric | Python | Native | Delta | Direction | Disposition | Provenance |
|---|---:|---:|---:|---|---|---|
| `cer` | 0.5011 | 0.2954 | -0.2057 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `substitutions` | 121 | 186 | 65 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `deletions` | 967 | 421 | -546 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `insertions` | 52 | 65 | 13 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `emptyTextCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapCount` | 46 | 19 | -27 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapDurationMs` | 137230 | 44280 | -92950 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |

#### `long-v2` — `validated-failed` / observed `unscored` / identity-aware `unscored`

Validated native failure: `crispasr_result_invalid` (`candidate-caused-structured-failure`). No CER, gap, or timing metric was synthesized.

### `qwen3-asr/qwen3-asr-1.7b`

#### `short-v1` — `completed-comparison` / observed `stop-revise` / identity-aware `baseline-incomplete`

| Metric | Python | Native | Delta | Direction | Disposition | Provenance |
|---|---:|---:|---:|---|---|---|
| `cer` | 0.2500 | 0.2083 | -0.0417 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `substitutions` | 14 | 11 | -3 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `deletions` | 16 | 11 | -5 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `insertions` | 0 | 3 | 3 | `lower-or-equal` | `stop-revise` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `emptyTextCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapCount` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `semanticGapDurationMs` | 0 | 0 | 0 | `lower-or-equal` | `qualified` | `python-legacy-cuda-v1` / `shared-t01-recomputed-historical-native` |
| `qwenForcedAlignerMedianStartErrorMs` | 140.0000 | 7700.0000 | 7560.0000 | `lower-or-equal` | `stop-revise` | `forced-aligner` / `forced-aligner` |
| `qwenForcedAlignerP95StartErrorMs` | 2060.0000 | 17969.0000 | 15909.0000 | `lower-or-equal` | `stop-revise` | `forced-aligner` / `forced-aligner` |

#### `medium-v1` — `validated-failed` / observed `unscored` / identity-aware `unscored`

Validated native failure: `segment-legality-failed` (`candidate-caused-structured-failure`). No CER, gap, or timing metric was synthesized.

#### `long-v2` — `validated-failed` / observed `unscored` / identity-aware `unscored`

Validated native failure: `segment-legality-failed` (`candidate-caused-structured-failure`). No CER, gap, or timing metric was synthesized.

## Boundaries And Limitations

- Historical archived artifacts remain immutable and no native inference was run.
- Parakeet, ReazonSpeech, and Qwen native artifact/companion mappings remain pending T12; their identity-aware subtitle disposition is baseline-incomplete.
- Validated native failures retain failure provenance and receive no synthetic CER, gap, or timing metrics.
- Large-v3 is only one Whisper anchor; missing large-v2 native qualification keeps the Whisper family blocked.
- Qwen product grouping/timeline policy remains owned by T11; runtime packs, device qualification, and release eligibility remain owned by T14/T15/T18.
- The authoritative corpus still lacks low-volume coverage.

No production route, worker, Tauri/React code, installer, runtime pack, model downloader, or archived evidence was changed.
