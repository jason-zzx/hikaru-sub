# Corrected CTranslate2 Reassessment

The current benchmark uses `long-v2`; archived long-v1 reports remain historical. Approved standalone vocalization gaps are diagnostic-only and remain included in CER.

| Candidate | Case | CER | RTF | Semantic gaps | Excluded vocalization gaps | Timeline errors | Result |
|---|---|---:|---:|---:|---:|---:|---|
| `t02-large-v3-fixed` | `short-v1` | `0.3583` | `0.777` | 0 | 0 | 0 | **fail** |
| `t02-large-v3-fixed` | `medium-v1` | `0.1745` | `0.717` | 10 | 0 | 0 | **fail** |
| `t02-large-v3-fixed` | `long-v2` | `0.2245` | `0.706` | 68 | 0 | 0 | **fail** |
| `t02-kotoba-fixed` | `short-v1` | `0.3417` | `0.556` | 0 | 0 | 0 | **pass** |
| `t02-kotoba-fixed` | `medium-v1` | `0.2224` | `0.515` | 3 | 2 | 0 | **fail** |
| `t02-kotoba-fixed` | `long-v2` | `0.2512` | `0.459` | 16 | 0 | 0 | **fail** |
| `t06-selected-a` | `short-v1` | `0.2667` | `0.623` | 0 | 0 | 0 | **pass** |
| `t06-selected-a` | `medium-v1` | `0.1134` | `0.559` | 0 | 0 | 0 | **pass** |
| `t06-selected-a` | `long-v2` | `0.1509` | `0.550` | 0 | 0 | 0 | **pass** |
| `t06-candidate-b` | `short-v1` | `0.2667` | `0.654` | 0 | 0 | 0 | **pass** |
| `t06-candidate-b` | `medium-v1` | `0.1055` | `0.599` | 0 | 1 | 0 | **pass** |
| `t08-kotoba-k1` | `short-v1` | `0.3250` | `0.035` | 0 | 0 | 0 | **pass** |
| `t08-kotoba-k1` | `medium-v1` | `0.2163` | `0.032` | 0 | 2 | 0 | **pass** |
| `t08-kotoba-k1` | `long-v2` | `0.2268` | `0.030` | 7 | 0 | 0 | **fail** |

## Corrected Dispositions

- `t02-large-v3-fixed`: `historical-stop-revise` — short CER and medium/long semantic-gap gates still fail.
- `t02-kotoba-fixed`: `historical-stop-revise` — medium/long semantic-gap gates still fail.
- `t06-selected-a`: `corrected-large-v3-pass` — short/medium/long-v2 pass; full ordinary model qualification remains follow-up work.
- `t06-candidate-b`: `diagnostic-only-no-long-run` — selected Candidate A passes, so Candidate B long is unnecessary and ORT/VAD is not a package input.
- `t08-kotoba-k1`: `stop-revise` — short and medium pass, but long-v2 retains seven semantic gaps.

## Boundary

No inference was rerun. Candidate B long was not run. Release/default routing remains Python legacy; no production route, UI, downloader, installer, runtime pack, or package input was enabled.
