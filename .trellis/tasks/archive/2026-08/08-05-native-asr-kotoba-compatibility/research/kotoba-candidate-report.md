# T08 Kotoba K1 Candidate Report

**Disposition: `stop-revise`.**

K1 uses 15-second maximum source windows, a padded 30-second model range, beam 5, no previous-text history, timestamp-driven seek, no VAD, and CUDA device 0/FLOAT16.

| Case | Samples | CER | GPU RTF | Cold wall | Peak RSS | Timeline errors | Semantic gaps >=1.5s | Excluded vocalization gaps | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `short-v1` | 1 cold + 3 warm | `0.3250` | `0.035` | `5.803s` | `1.66 GB` | 0 | 0 | 0 | **pass** |
| `medium-v1` | 1 measured | `0.2163` | `0.032` | `20.641s` | `1.66 GB` | 0 | 0 | 2 | **pass** |
| `long-v2` | 1 measured | `0.2268` | `0.030` | `127.287s` | `1.66 GB` | 0 | 7 | 0 | **fail** |

## Cache Compatibility

The exact pinned Hugging Face snapshot revision was opened in place. No model file was copied, relocated, rewritten, or deleted.

## Scope

Release/default routing remains Python legacy. This result is not a publishable GPU pack, device matrix, downloader input, installer change, or production route enablement.
