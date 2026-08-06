# T03C CrispASR Long-v2 Correction Handoff

## Current Authority

The current CrispASR benchmark authority is the T03C correction matrix generated from retained T03 bytes after all nine authoritative rows passed the original compiled identity validator. It uses current manifest `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`, shared comparator `b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822`, and unchanged `long.wav` identity `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e` / `4,144,235ms` remapped from historical `long-v1` to current `long-v2` reference only.

Archived T01/T03 reports remain immutable provenance for historical manifest `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277`; they are not current quality authority.

## Corrected Dispositions

- Parakeet: `stop-revise`. Corrected CER is `0.4917` / `0.6123` / `0.5962` for short-v1 / medium-v1 / long-v2. Long-v2 has zero semantic gaps and timeline errors, but CER still fails and top-level output remains one oversized segment.
- ReazonSpeech: `proceed-with-named-risks`. Corrected CER is `0.1333` / `0.2857` / `0.2944`; every original text/performance/resource/timeline/gap gate passes. One oversized top-level segment and mostly zero-duration native word ranges remain explicit risks; this is not subtitle-ready qualification.
- Qwen3 + ForcedAligner: `stop-revise`. Short-v1 CER remains `0.2083` with zero semantic gaps/timeline errors, but ForcedAligner start timing remains failed (`7,700ms` median, `17,969ms` P95). Medium-v1 and long-v2 remain validated, unscored `segment-legality-failed` blockers with zero accepted timed output and no synthesized metrics.

Standalone approved vocalization exclusions remain included in CER and are reported separately from semantic gaps.

## Artifacts

- correction lock: `.trellis/tasks/08-06-crispasr-long-v2-correction/research/crispasr-long-v2-correction-lock.md`
- deterministic matrix: `.trellis/tasks/08-06-crispasr-long-v2-correction/research/evidence/crispasr-long-v2-correction.json`, SHA-256 `40640099a9790a3d65eee932753b378bc002ced960a6a0265463bd5f443e9051`
- deterministic report: `.trellis/tasks/08-06-crispasr-long-v2-correction/research/crispasr-long-v2-correction-report.md`, SHA-256 `9eb9504834f3e35144097de807db8d738b9c349788e6b9c89da48e1d50cd815d`

## Downstream Boundary

- T09/T10/T11 may consume these corrected route dispositions, runtime/model identity, and named risks; they must not treat ReazonSpeech as subtitle-ready or repair Qwen evidence synthetically.
- Python legacy remains Release/default. No production route, frontend, Tauri, worker, runtime pack, package, downloader, installer, settings, or model changed.
- No inference or CrispASR/native worker build ran.
