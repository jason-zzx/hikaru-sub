# T03C - Correct CrispASR Long-v2 Historical Evidence

## Goal

Complete the corrected-ground-truth migration by deterministically re-evaluating retained T03 CrispASR evidence against the authoritative `long-v2.ass`, while preserving archived old-manifest reports as immutable history. Publish one current CrispASR supersession matrix, update the parent migration's authoritative conclusions and artifact links, and ensure no active authority still relies on the mistakenly supplied `long.ass`.

This task corrects evidence and documentation only. It does not rerun inference, change CrispASR/native/product code, or enable any production route.

## Background

- Parent task: `.trellis/tasks/07-25-native-asr-migration/`.
- Current private benchmark manifest SHA-256 is `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` and binds `long.wav` to `long-v2.ass` SHA-256 `46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b`, 681 Dialogue rows, and duration `4,144,235ms`.
- Historical manifest `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277` bound the same audio to the incorrect `long.ass` SHA-256 `7954ce24af05dca37b2930136c83ee722e80fd637ef298cc7eeb47f29cf8c6f3`.
- T08 already rescored retained T02/T06/T08 CTranslate2 evidence against long-v2 and the approved standalone-vocalization policy. It did not rescore T03 CrispASR.
- T03 retained all authoritative raw evidence under its ignored archived local root. Parakeet and ReazonSpeech have completed short/medium/long rows. Qwen has a completed short row and identity-valid failed medium/long rows with no accepted legal timeline.
- A planning preview through the current shared comparator produced Parakeet long-v2 CER `0.5962`, ReazonSpeech long-v2 CER `0.2944`, and unchanged Qwen long-v2 `segment-legality-failed`; final publication must validate identity and reproduce the complete preview matrix.

## Requirements

### R1 - Historical Evidence Integrity

- Preserve the archived T01 benchmark contract, T03 report, tracked T03 evidence, input lock, adapter, publisher, and raw files without rewriting their historical long-v1 claims.
- Treat historical reports as provenance only. Current route conclusions must point to the new correction artifacts.
- Bind the original T03 manifest, input lock, executable, required DLLs, model/aligner, CPU open parameters, loaded modules, restricted PATH, and every authoritative raw SHA-256 before rescoring.
- A missing, changed, malformed, or identity-invalid historical input must prevent publication.

### R2 - Corrected Benchmark And Comparator

- Validate exact current manifest identity `3c05c0eb...` and exact long-v2 audio/ASS/duration/dialogue identity before scoring.
- Import `scripts/asr-benchmark.py`; do not copy CER, timeline, gap, vocalization, or Qwen timing algorithms.
- Recompute short-v1, medium-v1, and long-v2 completed rows through the current shared comparator.
- Preserve the approved standalone-vocalization rule: excluded vocalizations remain in CER and publish separately from semantic gaps.
- Map only the unchanged long WAV/duration from historical `long-v1` source identity to current `long-v2`; never treat different audio bytes as a reference-only correction.

### R3 - Route-specific Corrected Dispositions

- Parakeet must publish the complete corrected matrix and remain `stop-revise` unless every original T03 gate passes. Final deterministic output must reproduce preview CER/gaps/timeline values, including long-v2 CER `0.5962` at four decimals.
- ReazonSpeech must publish the complete corrected matrix and remain `proceed-with-named-risks` only if all original T03 text/performance/resource/timeline/gap gates still pass. Final output must reproduce long-v2 CER `0.2944`, zero semantic gaps, and zero timeline errors at four decimals.
- ReazonSpeech's one oversized top-level segment and mostly zero-duration native word ranges remain named risks; correction must not reclassify them as subtitle-ready.
- Qwen short must be rescored through the current manifest and preserve its ForcedAligner timing failure.
- Qwen medium and long-v2 must remain validated, unscored `segment-legality-failed` upstream blockers with zero accepted timed output. Do not invent CER, gap, timing, or synthetic segments.
- Preserve T03's original CPU RTF `<=1.0`, short cold wall `<=120s`, RSS `<=12 GiB`, timeline/gap, and Qwen timing gates. Do not apply T08 GPU or CTranslate2 RSS gates retroactively.

### R4 - Deterministic Sanitized Publication

- Create one task-local correction lock that binds old/current manifests, current comparator, T03 source tools/artifacts, exact raw hashes, and expected preview values/dispositions.
- Publish deterministic sanitized JSON and Markdown containing identities, aggregate metrics, route dispositions, segmentation/timing risks, supersession boundaries, and limitations only.
- Tracked artifacts must contain no transcript/reference text, token arrays, raw alignment entries, absolute machine paths, model/audio bytes, or private corpus paths.
- Run publication twice from validated retained inputs and require byte-identical JSON and Markdown.
- Mutation tests must reject old/current manifest drift, raw hash drift, route/row substitution, metric tampering, Qwen failed-row promotion, gate drift, private-path/text leakage, and incomplete matrices.

### R5 - Current Authority And Link Repair

- Add a CrispASR correction handoff under this task and update the parent migration to use it as current T03 authority.
- Update parent `prd.md`, `design.md`, and relevant handoffs so current T02/T03/T06/T08 conclusions use long-v2; old long-v1 numbers may remain only when explicitly labeled historical/superseded.
- Repair the parent T08 handoff's artifact paths to the archived T08 directory.
- Audit active parent/spec/handoff files for old manifest hash, `long-v1`, and `long.ass`. Any remaining occurrence must be either removed from current authority or explicitly marked historical.
- Add a durable ASR quality rule requiring all-backend evidence inventory and supersession when an authoritative reference identity changes.

### R6 - Stable Product Boundary

- Do not rerun model inference or rebuild CrispASR/native workers.
- Do not modify archived T01/T03 evidence/report files.
- Do not change frontend, Tauri, native worker, model downloader, runtime pack, installer, settings, or production route behavior.
- Python legacy remains Release/default. T03C is evidence correction and does not consume the parent roadmap's later T09 CrispASR backend-core number.

## Acceptance Criteria

- [x] All nine T03 authoritative raw rows validate against the exact historical identity before correction consumes them.
- [x] Current manifest/long-v2/comparator identities are exact and independently validated.
- [x] Parakeet/Reazon short/medium/long-v2 and Qwen short are recomputed through the shared comparator; Qwen medium/long-v2 remain validated unscored blockers.
- [x] Final deterministic metrics reproduce the reviewed preview: Parakeet long-v2 CER `0.5962`, ReazonSpeech long-v2 CER `0.2944`, zero long semantic gaps/timeline errors for both, and unchanged route dispositions.
- [x] ReazonSpeech remains named-risk-only rather than subtitle-ready; Parakeet and Qwen remain `stop-revise`.
- [x] Correction lock, sanitized JSON, Markdown report, and parent handoff bind original raw/tool/runtime/model plus current benchmark identities without private data.
- [x] Double publication is byte-identical and mutation/privacy tests pass.
- [x] Parent current authority uses long-v2 for CTranslate2 and CrispASR; historical long-v1 references are clearly labeled and T08 archive links resolve.
- [x] Archived T01/T03 reports and evidence are byte-identical to their pre-task state.
- [x] Relevant benchmark tests, correction publisher tests, task validation, `git diff --check`, status/size/ignore/privacy scans pass.
- [x] No product/native/frontend/Tauri/runtime/package files change and no inference runs.

## Out Of Scope

- Rerunning Parakeet, ReazonSpeech, Qwen, CTranslate2, or Python inference.
- Rewriting archived T01/T02/T03/T06/T08 reports to pretend they originally used long-v2.
- Changing the approved vocalization classifier or reference ASS.
- Fixing CrispASR segmentation, Qwen alignment, GPU execution, backend integration, model packaging, or production routing.
- Re-evaluating non-authoritative Python diagnostic outputs unless needed only to label them historical.
- Archiving the parent migration task or starting downstream T09/T10/T11 productization.

## Rollback

Remove only this task's correction lock/publisher/tests/evidence/report/handoff and revert current parent/spec link/authority edits. Historical archived evidence, current private benchmark, product code, models, raw output, and routing remain unchanged.
