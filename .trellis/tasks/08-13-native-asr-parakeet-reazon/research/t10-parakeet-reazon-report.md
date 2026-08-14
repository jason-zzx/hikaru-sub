# T10 Parakeet / ReazonSpeech Report

Raw index SHA-256: `ef1b0a811fc9544f0b7b1358f663db65690c99e7fadd4d604a5e22d8eefa4d3b`

## reazonspeech-nemo

Disposition: `stop-revise`

| Case | Status | CER | CUDA RTF | Timeline | Semantic gaps | Result |
|---|---|---:|---:|---:|---:|---|
| `short-v1` | `completed` | 0.225 | 0.05845980416562941 | 0 | 1 | **fail** |
| `medium-v1` | `completed` | 0.37714285714285717 | 0.035689425143122885 | 0 | 22 | **fail** |
| `long-v2` | `validated-failed` | — | — | — | — | **fail** |

## parakeet

Disposition: `stop-revise`

| Case | Status | CER | CUDA RTF | Timeline | Semantic gaps | Result |
|---|---|---:|---:|---:|---:|---|
| `short-v1` | `completed` | 0.16666666666666666 | 0.022135914032030538 | 0 | 0 | **pass** |
| `medium-v1` | `completed` | 0.39252747252747255 | 0.017026716271909426 | 0 | 17 | **fail** |
| `long-v2` | `validated-failed` | — | 0.01690671786228339 | — | — | **fail** |

## Boundary

No Release/default route, model downloader, settings, frontend, installer, or runtime-pack change.
