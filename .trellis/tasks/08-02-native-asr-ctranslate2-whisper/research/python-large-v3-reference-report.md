# ASR Benchmark Results

> Generated deterministically from schema-version 1 benchmark JSON. Ground-truth references come only from validated WAV+ASS; do not edit metrics by hand.

## Candidate Status

| Kind | Engine | Model | Device | Case | Class | Status | CER | Timeline errors | Confirmed gaps >=1.5s | Cold total RTF | Warm inference RTF median | Timestamp provenance | Qwen start median ms | Qwen start P95 ms |
|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|
| python-reference | faster-whisper | `large-v3` | cpu | `long-v1` | long | completed | 0.295 | 0 | 1 | 1.355 | — | engine-native | — | — |
| python-reference | faster-whisper | `large-v3` | cpu | `medium-v1` | medium | completed | 0.099 | 1 | 1 | 1.084 | — | engine-native | — | — |
| python-reference | faster-whisper | `large-v3` | cpu | `short-v1` | short | completed | 0.358 | 1 | 0 | 2.115 | 0.886 | engine-native | — | — |

## Manifest Evidence

| Corpus | Manifest SHA-256 |
|---|---|
| `hikaru-user-ja-ground-truth-v1` | `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277` |

## Corpus Evidence

| Case | WAV SHA-256 | ASS SHA-256 | Duration ms | Dialogue count | Tags |
|---|---|---|---:|---:|---|
| `long-v1` | `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e` | `7954ce24af05dca37b2930136c83ee722e80fd637ef298cc7eeb47f29cf8c6f3` | 4144235 | 908 | background-noise, clear-japanese, continuous-speech-over-30s, english, long-silence, numbers, person-names, proper-nouns, rapid-dialogue |
| `medium-v1` | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` | `d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e` | 498872 | 165 | background-noise, clear-japanese, english, proper-nouns |
| `short-v1` | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` | `60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b` | 24102 | 8 | clear-japanese |

## Limitations And Reproduction

No failed or skipped records.

## Handoff Status

- Python reference `faster-whisper`: recorded for all listed cases; diagnostic only.
- Python reference `kotoba-faster-whisper`: not recorded; optional diagnostic only.
- Python reference `parakeet`: not recorded; optional diagnostic only.
- Python reference `qwen3-asr`: not recorded; optional diagnostic only.
- Python reference `reazonspeech-nemo`: not recorded; optional diagnostic only.
- Missing coverage tags: low-volume; corpus-wide claims remain blocked.
- User-reviewed T01 budgets are frozen: each engine/case CER `<=0.35`; inference RTF `<=1.0` on CPU or `<=0.5` on accelerated GPU paths; short cold process wall `<=120s`; peak RSS `<=6 GiB` for CTranslate2 or `<=12 GiB` for CrispASR. No VRAM gate is defined.
- Listed Python results are current-implementation diagnostics only and are not evaluated as pass/fail against the frozen budgets.
- Qwen3 timing accuracy is eligible only when `timestampProvenance` is `forced-aligner`; synthetic, mixed, unknown, and generic `engine-native` timestamps are excluded.
- T02/T03 must consume the same manifest, WAV/ASS hashes, schema, and metric implementation rather than reimplementing CER/P95/gap logic.
