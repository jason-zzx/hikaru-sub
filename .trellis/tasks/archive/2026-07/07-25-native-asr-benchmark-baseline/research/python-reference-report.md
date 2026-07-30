# ASR Benchmark Results

> Generated deterministically from schema-version 1 benchmark JSON. Ground-truth references come only from validated WAV+ASS; do not edit metrics by hand.

## Candidate Status

| Kind | Engine | Model | Device | Case | Class | Status | CER | Timeline errors | Confirmed gaps >=1.5s | Cold total RTF | Warm inference RTF median | Timestamp provenance | Qwen start median ms | Qwen start P95 ms |
|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|
| python-reference | faster-whisper | `base` | cpu | `short-v1` | short | completed | 0.467 | 0 | 0 | 0.301 | 0.093 | engine-native | — | — |
| python-reference | faster-whisper | `large-v3` | cpu | `short-v1` | short | completed | 0.358 | 1 | 0 | 1.426 | 0.919 | engine-native | — | — |
| python-reference | kotoba-faster-whisper | `kotoba-tech/kotoba-whisper-v2.0-faster` | cpu | `short-v1` | short | completed | 0.325 | 0 | 0 | 1.097 | 0.729 | engine-native | — | — |
| python-reference | parakeet | `nvidia/parakeet-tdt_ctc-0.6b-ja` | cpu | `short-v1` | short | completed | 0.758 | 0 | 5 | 1.148 | 0.060 | engine-native-or-synthetic-fallback | — | — |
| python-reference | qwen3-asr | `Qwen/Qwen3-ASR-1.7B` | cpu | `short-v1` | short | completed | 0.250 | 0 | 0 | 2.433 | 1.598 | forced-aligner | 140.0 | 2060.0 |
| python-reference | reazonspeech-nemo | `reazon-research/reazonspeech-nemo-v2` | cpu | `short-v1` | short | completed | 0.108 | 0 | 0 | 1.306 | 0.177 | engine-native | — | — |

## Manifest Evidence

| Corpus | Manifest SHA-256 |
|---|---|
| `hikaru-user-ja-ground-truth-v1` | `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277` |

## Corpus Evidence

| Case | WAV SHA-256 | ASS SHA-256 | Duration ms | Dialogue count | Tags |
|---|---|---|---:|---:|---|
| `short-v1` | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` | `60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b` | 24102 | 8 | clear-japanese |

## Limitations And Reproduction

No failed or skipped records.

## Handoff Status

- Python reference `faster-whisper`: recorded for all listed cases; diagnostic only.
- Python reference `kotoba-faster-whisper`: recorded for all listed cases; diagnostic only.
- Python reference `parakeet`: recorded for all listed cases; diagnostic only.
- Python reference `qwen3-asr`: recorded for all listed cases; diagnostic only.
- Python reference `reazonspeech-nemo`: recorded for all listed cases; diagnostic only.
- Python-reference duration classes not recorded: long, medium; diagnostic claims for those classes remain unavailable and do not block native ground-truth comparison.
- Missing coverage tags: low-volume; corpus-wide claims remain blocked.
- User-reviewed T01 budgets are frozen: each engine/case CER `<=0.35`; inference RTF `<=1.0` on CPU or `<=0.5` on accelerated GPU paths; short cold process wall `<=120s`; peak RSS `<=6 GiB` for CTranslate2 or `<=12 GiB` for CrispASR. No VRAM gate is defined.
- Listed Python results are current-implementation diagnostics only and are not evaluated as pass/fail against the frozen budgets.
- Qwen3 timing accuracy is eligible only when `timestampProvenance` is `forced-aligner`; synthetic, mixed, unknown, and generic `engine-native` timestamps are excluded.
- T02/T03 must consume the same manifest, WAV/ASS hashes, schema, and metric implementation rather than reimplementing CER/P95/gap logic.
