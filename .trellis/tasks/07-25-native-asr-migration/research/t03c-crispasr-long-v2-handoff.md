# T03C Corrected CrispASR Handoff

## Current Authority

T03C is the current CrispASR quality authority for manifest `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` and `long-v2`. All nine retained T03 authoritative rows first passed the original compiled runtime/model/evidence validator; completed rows were then recomputed through the current shared comparator. Archived T03 long-v1 reports remain immutable historical provenance only.

## Corrected Dispositions

- Parakeet remains `stop-revise`: corrected short/medium/long-v2 CER `0.4917/0.6123/0.5962`; long-v2 has zero semantic gaps/timeline errors, but all CER gates fail and top-level output remains one oversized segment.
- ReazonSpeech remains `proceed-with-named-risks`: corrected CER `0.1333/0.2857/0.2944`, with original CPU/performance/resource/timeline/gap gates passing. Its one oversized segment and mostly zero-duration word ranges are not subtitle-ready.
- Qwen remains `stop-revise`: short CER `0.2083` passes but ForcedAligner timing still fails; medium/long-v2 remain validated unscored `segment-legality-failed` blockers with zero accepted timed output.

## Authoritative Artifacts

- lock: `.trellis/tasks/08-06-crispasr-long-v2-correction/research/crispasr-long-v2-correction-lock.md`
- matrix: `.trellis/tasks/08-06-crispasr-long-v2-correction/research/evidence/crispasr-long-v2-correction.json`, SHA-256 `40640099a9790a3d65eee932753b378bc002ced960a6a0265463bd5f443e9051`
- report: `.trellis/tasks/08-06-crispasr-long-v2-correction/research/crispasr-long-v2-correction-report.md`, SHA-256 `9eb9504834f3e35144097de807db8d738b9c349788e6b9c89da48e1d50cd815d`
- full handoff: `.trellis/tasks/08-06-crispasr-long-v2-correction/research/crispasr-long-v2-handoff.md`

Python legacy remains Release/default. This handoff changes evidence authority only; T09/T10/T11 retain product implementation ownership.
