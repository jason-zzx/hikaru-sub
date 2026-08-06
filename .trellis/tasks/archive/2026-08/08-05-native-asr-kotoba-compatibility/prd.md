# T08 - Productize Kotoba And Legacy CTranslate2 Cache Compatibility

## Goal

Correct the authoritative long benchmark and non-semantic-vocalization policy, re-evaluate retained T02/T06/T08 CTranslate2 evidence without rewriting history, and continue productizing the native `kotoba-faster-whisper` route on the reviewed T07 CUDA development lane. After K1 retained seven corrected long-v2 semantic gaps, qualify one K2 bounded-stride overlap candidate without pre-waiving any of those gaps. Preserve Kotoba-only model readiness and prove that the exact existing Hugging Face CTranslate2 snapshot can be reused in place without copying.

T08 supplies corrected CTranslate2 dispositions plus an accepted Kotoba engine algorithm/cache handoff when its gates pass. It does not switch Hikaru Sub's production/default ASR route.

## Background

- Parent task: `.trellis/tasks/07-25-native-asr-migration/`.
- T02 proved the pinned CTranslate2/Kotoba runtime feasible. Under the now-superseded old manifest, its fixed 15-second non-overlap Kotoba candidate passed short-v1 but reported 5 medium-v1 and 36 long-v1 gaps.
- T06 provides the production worker seam, protocol v1 integration, timestamp-driven seek, no-history support, legal timeline normalization, evidence tooling patterns, and Rust-host compatibility.
- T07 provides an attested ignored-local CUDA device-0/FLOAT16 lane and recorded large GPU speedups. T08 quality failures must continue on that GPU lane.
- The only supported Kotoba model remains `kotoba-tech/kotoba-whisper-v2.0-faster` at pinned revision `f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc`.
- T01 `.asr-benchmark` WAV+ASS pairs are the only quality and speech-region truth. Python output is diagnostic only.
- The user corrected the long reference: existing `long.wav` must use `long-v2.ass` SHA-256 `46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b` with 681 Dialogue rows. The old `long.ass` was incorrectly paired and remains historical only.
- The user decided that a missed standalone non-semantic vocalization such as `うんうん` or `うあ、うあ、うあ` is diagnostic but not a subtitle-quality failure.
- Retained T02/T06/T08 raw CTranslate2 segments permit corrected re-scoring without rerunning completed inference.
- Corrected K1 passes short-v1 and medium-v1 but retains seven long-v2 semantic gaps. Six are wholly within the final four seconds of their responsible 15-second source window; all responsible traces ended `source-window-end` with zero source overlap.
- The user reviewed gaps #1, #4, and #6 as likely non-product defects, but explicitly deferred recording any waiver until after K2. K2 must therefore score all seven under the unchanged comparator and gate.

## Requirements

### R1 - Scope And Stable Boundaries

- Support Windows x64 native development for `kotoba-faster-whisper -> ctranslate2` only.
- Reuse the existing `hikaru-asr-worker`, protocol v1, Tauri native host, CTranslate2 `4.8.0`, tokenizer, audio feature extraction, timestamp parser, cancellation, recovery, and T07 execution configuration.
- Keep ordinary `faster-whisper` defaults and its disabled native release status unchanged.
- Keep Release/default routing on Python legacy. Do not change frontend model lists, production model download, runtime manifests, installer, portable package, or settings UI.
- Do not introduce a second worker, protocol version, backend registry, or Kotoba-specific process host.

### R2 - Kotoba Model And Readiness Contract

- Accept only `kotoba-tech/kotoba-whisper-v2.0-faster` under the pinned immutable revision and file identities inherited from T02.
- Require non-empty `preprocessor_config.json` for Kotoba and verify the loaded model exposes 128 mel bins.
- Keep `preprocessor_config.json` optional for ordinary faster-whisper; T08 must add a negative regression proving the rule remains isolated.
- Missing required files, invalid model metadata, wrong mel shape, or missing Kotoba preprocessor must fail before `ready` with a stable safe error.

### R3 - Minimum Kotoba Candidate K1

- Start with one minimum candidate derived from the pinned model card and the existing T06 seam:
  - maximum 15-second source window;
  - padded 30-second Whisper model tensor and timestamp range;
  - Japanese transcription prompt;
  - beam size 5;
  - no previous-text context;
  - timestamp-driven seek/overlap instead of T02's fixed non-overlap advance;
  - no VAD dependency in the K1 identity.
- K1 must use T07's CUDA device 0/FLOAT16 lane for repeated quality measurements. CPU runs are limited to focused regression or fallback evidence and do not select the development device.
- Do not add fuzzy overlap repair, reference-derived segmentation, synthetic timestamps, arbitrary gap filling, or Python-parity patches.
- If K1 fails a mandatory gate, preserve the evidence and complete the remaining authoritative K1 cases under the same frozen identity before returning to planning. Do not implement another candidate until the full K1 diagnostic matrix is published, and do not speculatively add ORT/VAD or chunk-merging code.
- `useVad=true` must not silently activate ordinary faster-whisper Candidate B under a Kotoba identity. It either remains an explicitly unqualified route input or fails before `ready` until a separately reviewed Kotoba VAD candidate exists.

### R4 - Corrected Ground-Truth Quality And Evidence

- Replace the current authoritative long case with `long-v2`: existing `long.wav`, corrected `long-v2.ass`, new ASS/dialogue/manifest identity, and unchanged audio/duration identity. Do not silently reuse `long-v1` for a different reference.
- Validate exact short-v1, medium-v1, and long-v2 identities before scoring or inference.
- Run short-v1 as 1 cold + 3 warm samples. Run medium-v1 and long-v2 as one measured sample each under the same identity, regardless of earlier case outcomes, so accelerated candidates retain a complete three-case diagnostic matrix.
- Recompute metrics through the shared benchmark implementation. Do not copy or trust editable CER/gap logic.
- Every case must meet:
  - CER `<=0.35`;
  - accelerated inference RTF `<=0.5`;
  - short cold process wall `<=120s`;
  - peak process RSS `<=6 GiB`;
  - zero invalid or out-of-bounds timeline segments;
  - zero semantic confirmed speech gaps `>=1.5s`.
- A standalone cue may be excluded from the zero-gap gate only after NFKC normalization, removal of whitespace/Unicode punctuation and symbols plus `ー` / `〜` / `~`, and exact matching as 1..6 repeats of one approved unit: `あ`, `う`, `え`, `お`, `ん`, `うん`, or `うあ`. It remains included in CER and must be published separately as an excluded diagnostic gap. `はい`, laughter, unknown forms, and mixed or lexical cues remain mandatory.
- No VRAM gate is introduced.
- One worker/runner/DLL/model/config/input-lock/device identity must cover all retained rows. Any identity change invalidates affected measurements.
- Raw audio, transcript, token traces, absolute paths, models, binaries, and module paths stay under ignored local roots. Tracked evidence contains only sanitized identities, hashes, aggregate metrics, dispositions, and limitations.

### R5 - Legacy Hugging Face Cache Compatibility

- Prove direct reuse of the exact legacy cache path:

  ```text
  <HF_HOME>/hub/models--kotoba-tech--kotoba-whisper-v2.0-faster/snapshots/f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc/
  ```

- Accept both normal Hugging Face symlink-backed snapshots and Windows copied-file snapshots.
- Do not copy, relocate, rewrite, or delete the legacy snapshot.
- Do not resolve mutable `refs/main` as the model identity.
- Missing, partial, wrong-revision, or malformed snapshots must fail safely before inference.
- T08 may use a test-only host/resolution seam to prove this contract. The production manifest, downloader, readiness marker, and cleanup behavior remain owned by T12/T16.

### R6 - Protocol And Host Compatibility

- `main.cpp` must dispatch both ordinary faster-whisper and Kotoba through the same CTranslate2 worker while choosing an explicit engine-specific algorithm/readiness profile.
- Preserve protocol v1 request/event schema, stdout JSONL-only output, bounded stderr diagnostics, monotonic progress, legal segments, terminal semantics, and process-tree cancellation.
- Extend model-backed Rust tests to select Kotoba without allowing product/Release code to read new test inputs.
- Verify real-worker success, structured pre-ready model failure, recovery/fallback ASS, cancellation/reap, and active-gate release.

### R7 - Corrected Historical Re-evaluation And Handoff

- Re-score completed T02 ordinary/Kotoba, T06 selected Candidate A/Candidate B, and T08 K1 raw CTranslate2 outputs against the corrected benchmark and vocalization policy before rerunning inference.
- Preserve archived T01/T02/T06 evidence as historical old-manifest results. Publish correction/supersession artifacts that bind original raw hashes, original candidate identities, corrected manifest/comparator identity, and new dispositions.
- Historical candidates preserve their reviewed task-specific runtime/resource gates during corrected re-scoring; T02/T06 CPU rows are not retroactively subjected to T08's accelerated RTF limit.
- T06 selected Candidate A is treated as passing the corrected large-v3 short/medium/long-v2 gate only if final deterministic re-scoring reproduces the preview result: long-v2 CER `0.1509`, zero semantic gaps, zero timeline errors, and unchanged RTF/resource evidence.
- T06 Candidate B is diagnostic-only when selected Candidate A passes; do not run its missing long case or retain ORT/VAD as a package input without a separate product reason.
- T08 completes only when all three authoritative Kotoba cases pass the corrected frozen gates under one reviewed candidate identity.
- A passing T08 result is an accepted engine algorithm/cache input for T12-T15 and final T18 rebuild. It is not a publishable GPU pack, device matrix, or production route enablement.
- A mandatory Kotoba failure records `stop-revise` after all three authoritative cases are measured, leaves native Kotoba disabled, and returns the complete observed failure profile to the parent without changing Python legacy.

### R8 - Kotoba Candidate K2

- Freeze exactly one K2 identity: `kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1`.
- Keep K1's pinned model/revision, 15-second maximum source window, padded 30-second model/timestamp range, Japanese prompt, beam 5, temperature 0, no previous-text history, timestamp parser, no-VAD boundary, worker/protocol, and T07 CUDA device 0/FLOAT16 identity.
- Cap Kotoba K2's applied seek to `1000` mel frames / `10000ms`; retain any parsed advance below that cap. Every full 15-second source window therefore overlaps the following decode by at least 5 seconds. Ordinary faster-whisper remains unchanged.
- Deterministic ownership uses decoded window starts: non-final window `i` owns segment starts in `[S[i], S[i+1])`, the final window owns `[S[last], audioDuration)`, and a start exactly at the boundary belongs to the later window. The later-starting window owns the complete source overlap.
- Buffer one window's parsed segments until its applied advance and ownership end are known. Filter non-owner segments, remove only exact `(startMs, endMs, text)` duplicates, validate unchanged timestamp bounds and monotonic starts, then emit protocol segments. Do not clip, stretch, synthesize, fuzzy-match, reference-match, or fill gaps.
- Progress follows the committed ownership frontier / next window start and remains monotonic, ending at exact audio duration.
- Preserve K1 evidence and create a distinct K2 lock, raw root, adapter identity, sanitized publisher identity, and gap-disposition diagnostic. Any K2 source/config/ownership/trace/runtime/model/corpus identity change invalidates affected rows.
- Reassess all seven corrected K1 long-v2 gap coordinates. Do not pre-waive #1, #4, or #6; decide whether any is a reviewed non-defect only after the complete K2 result exists.
- Run short-v1 as 1 cold + 3 warm and medium-v1/long-v2 once each under one K2 identity, regardless of earlier failures. Apply the existing CER, accelerated RTF, cold wall, RSS, timeline, and zero-semantic-gap gates unchanged.
- If any mandatory K2 gate fails, publish `stop-revise`, leave native Kotoba disabled, preserve the complete diagnostic matrix, and return to planning before K3 or any waiver decision.

## Acceptance Criteria

- [x] Worker accepts protocol v1 `kotoba-faster-whisper -> ctranslate2` requests on CPU/CUDA and keeps ordinary faster-whisper behavior unchanged.
- [x] Kotoba requires non-empty `preprocessor_config.json` and 128 mel bins; ordinary Whisper still accepts valid snapshots without the preprocessor file.
- [x] K1 is frozen as 15-second source windows, 30-second model range, beam 5, no history, timestamp-driven seek, no VAD, and T07 CUDA device 0/FLOAT16.
- [x] The current benchmark manifest uses a new long-v2 identity bound to `long-v2.ass`; the old long-v1 reference remains historical and cannot enter current publication.
- [x] The shared comparator reports semantic gaps and excluded standalone vocalization gaps separately; excluded vocalizations remain in CER and cannot hide mixed/lexical content.
- [x] Short-v1 1-cold/3-warm and medium/long-v2 measured rows are evaluated against CER, accelerated RTF, cold wall, RSS, timeline, and semantic-gap gates under one identity.
- [x] T02/T06/T08 completed CTranslate2 raw outputs are deterministically rescored and correction artifacts preserve original evidence provenance without rewriting archived reports.
- [x] T06 selected Candidate A corrected long-v2 result passes with zero semantic gaps; Candidate B long is not run unless a separate reason survives Candidate A correction.
- [x] The exact pinned legacy Hugging Face snapshot runs in place without copying; incomplete/wrong/malformed cache fixtures fail before `ready`.
- [x] Real Rust-host Kotoba success/failure/cancel/recovery tests pass without changing Release/default routing or product command contracts.
- [x] Protocol-only, CPU CT2, and CUDA development CTests remain independently runnable; ordinary CI does not require CUDA or models.
- [x] Sanitized publication is deterministic and recomputes metrics through T01; tracked files contain no private subtitle/media/model/path data.
- [x] Parent/downstream handoff records either a passing Kotoba algorithm input or truthful `stop-revise`, with T12/T14/T15/T18 ownership unchanged.
- [x] K2 uses a 15-second source window, maximum 10-second applied stride, at least 5-second full-window overlap, and later-start ownership without changing K1 model/decode/runtime identity or ordinary faster-whisper.
- [x] K2 buffers before callback emission, filters by half-open ownership intervals, performs exact-only pre-emission deduplication, preserves token-derived text/timestamps, and reports a monotonic ownership-frontier progress chain.
- [x] Focused goldens prove that plausible following-window recovery at K1 gap #3 and #6 coordinates is retained; a midpoint-ownership mutation fails those tests.
- [x] K2 trace/evidence validates parsed/applied advances, overlap floor, ownership partition, per-segment disposition conservation, exact tuple hashes, ordinary-route isolation, and deterministic sanitized publication.
- [x] All seven K1 long-v2 gaps are reassessed without pre-waiving #1/#4/#6, and the complete K2 short/medium/long-v2 GPU matrix records either an accepted algorithm input or truthful `stop-revise`.
- [x] Relevant worker CTest, Rust tests, `pnpm build`, benchmark self-check/tests, task validation, `git diff --check`, and privacy/ignore checks pass.

## Out Of Scope

- New ordinary faster-whisper algorithm work, rerunning already completed K1 inference, or enabling its production route. The corrected T06 qualification handoff and any newly unlocked full seven-model matrix remain follow-up execution.
- Pre-classifying K1 gaps #1/#4/#6 as non-defects before K2 evidence exists.
- Production native route cutover or Python removal.
- Final native model manifest, download/resume/hash/atomic installation, cleanup, or settings migration.
- Formal CUDA/Vulkan runtime packs, driver matrix, managed pack download, or GPU fallback qualification.
- Frontend runtime/model/device UX.
- Additional Kotoba models, arbitrary custom model directories, macOS/Linux/ARM, or multi-job concurrency.

## Rollback

Restore the previous ignored benchmark manifest and remove only corrected supplemental publications if the new reference/policy validation fails; archived T01/T02/T06 reports remain untouched. K2 rollback removes only its Kotoba stride cap, ownership filter, trace fields, distinct lock, and ignored K2 evidence, restoring the committed K1 `stop-revise` behavior. Broader Kotoba rollback disables only the native Kotoba dispatch/profile and removes T08 task-local ignored build/raw outputs. Preserve T04-T07 worker/host/CUDA infrastructure, ordinary faster-whisper behavior, user caches, and Python legacy/default routing.
