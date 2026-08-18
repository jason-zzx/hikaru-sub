# ReazonSpeech R2 formal report

Candidate: `R2-vad12-pad30-overlap-top-level-v1`

Quality disposition: **`stop-revise`**

Relative selection: **`better-than-r1`**

Raw index SHA-256: `ac860d5a44725158505db3568588dff500d112b69fe601e8d8fe34d798e81ed6`

| Case | Status | CER | CUDA RTF | Semantic gaps | Excluded gaps | Timeline | Max cue cp/ms | Max VAD window/overlap | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `short-v1` | `completed` | 0.26666666666666666 | 0.03161298647432285 | 1 | 0 | 0 | 42 / 8320 | 10260 / 60 | **fail** |
| `medium-v1` | `completed` | 0.2953846153846154 | 0.021827599464389967 | 19 | 1 | 0 | 75 / 11600 | 11870 / 60 | **fail** |
| `long-v2` | `validated-failed` | — | partial-attempt 0.045656934046344876 through 768570ms; no full-case RTF | — | — | — | — / — | — / — | **fail** `crispasr_result_invalid` / `zero_duration_top_level_result` at zero-based window `61` (62nd window) |

## Relative reasons

- `medium-v1_cer_reduction`

## Boundary

No Release/default, frontend, settings, downloader, installer, portable, package, Parakeet, Qwen, or CTranslate2 route change.
