# CrispASR Long-v2 Corrected Supersession

Current authority uses manifest `3c05c0eb...` and `long-v2`; archived T03 long-v1 results remain immutable historical provenance.

| Route | Case | Status | CER | CPU RTF | Semantic gaps | Excluded vocalizations | Timeline errors | Result |
|---|---|---|---:|---:|---:|---:|---:|---|
| `parakeet` | `short-v1` | `measured` | 0.4917 | 0.132 | 2 | 0 | 0 | `fail` |
| `parakeet` | `medium-v1` | `measured` | 0.6123 | 0.125 | 1 | 0 | 0 | `fail` |
| `parakeet` | `long-v2` | `measured` | 0.5962 | 0.125 | 0 | 0 | 0 | `fail` |
| `reazonspeech` | `short-v1` | `measured` | 0.1333 | 0.155 | 0 | 0 | 0 | `pass` |
| `reazonspeech` | `medium-v1` | `measured` | 0.2857 | 0.149 | 0 | 0 | 0 | `pass` |
| `reazonspeech` | `long-v2` | `measured` | 0.2944 | 0.150 | 0 | 0 | 0 | `pass` |
| `qwen3` | `short-v1` | `measured` | 0.2083 | 0.619 | 0 | 0 | 0 | `fail` |
| `qwen3` | `medium-v1` | `upstream-blocker` | unscored | 0.659 | blocked | blocked | blocked | `upstream-blocker` |
| `qwen3` | `long-v2` | `upstream-blocker` | unscored | 0.634 | blocked | blocked | blocked | `upstream-blocker` |

## Corrected Dispositions

- **parakeet:** `stop-revise`.
- **reazonspeech:** `proceed-with-named-risks`.
- **qwen3:** `stop-revise`.

## Named Risks And Boundaries

- ReazonSpeech remains a text/runtime input with named segmentation/timing risks, not a subtitle-ready route.
- Parakeet retains one oversized top-level segment and fails CER on every completed case.
- Qwen short retains its ForcedAligner timing failure; medium and long-v2 remain validated, unscored `segment-legality-failed` blockers with zero accepted timed output.
- Standalone approved vocalizations remain in CER and are reported separately from semantic gaps.
- No inference or worker build ran. Python legacy remains Release/default; no product route or package changed.

## Identity

- Historical manifest: `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277` (`long-v1`, superseded for current authority).
- Current manifest: `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` (`long-v2`, 681 Dialogue rows).
- Unchanged long WAV: `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e`, `4144235ms`.
- Shared comparator: `b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822`.
- T03 input lock: `f72aa6d2c7117abff16862bef8f9e18c45c9fcb9dc98249c2cf6e0872703279f`; all nine authoritative rows passed the original compiled identity validator.

## Supersession Boundary

This report supersedes only current T03 benchmark conclusions. Archived T01/T03 reports and evidence remain byte-identical historical records. T09/T10/T11 still own later backend/product work.
