# T08 Kotoba Productization Design

## Summary

T08 adds one engine-specific profile to the existing native CTranslate2 worker. The minimum K1 profile keeps the pinned Kotoba model-card settings that matter (`15s`, no previous text, beam 5) but replaces T02's fixed non-overlap advance with the T06 timestamp-driven seek implementation. It reuses the T07 CUDA lane for fast model-backed measurement.

The design deliberately does not introduce a model downloader, production route switch, VAD dependency, second worker, or new protocol field. Legacy cache compatibility is proven through the existing test-only native host by passing the immutable Hugging Face snapshot directory directly to the worker.

A planning rollback adds a corrected benchmark layer: the user supplied the correct `long-v2.ass` for the existing long WAV and approved a conservative standalone-vocalization exclusion. Completed T02/T06/T08 raw CTranslate2 outputs are rescored without rerunning inference, while historical reports remain immutable.

Corrected K1 retains seven long-v2 semantic gaps. K2 changes only Kotoba window orchestration: it caps applied stride at 10 seconds for at least 5 seconds of source overlap and gives the later-starting window deterministic ownership of the complete overlap. K1 model/decode settings, ordinary faster-whisper, protocol, host, benchmark policy, and production routing remain unchanged.

## Architecture

```text
T01 ground truth + pinned Kotoba snapshot
        |
        v
Tauri NativeAsrHost (test/model-backed only)
  engine=kotoba-faster-whisper
  backend=ctranslate2
  device=cuda
  model path=<legacy HF snapshot>
        |
        v
hikaru-asr-worker
  request validation
  -> Kotoba route/profile selection
  -> Kotoba-only preprocessor validation
  -> CTranslate2WhisperBackend
       max source frames=1500
       padded model frames=3000
       beam=5
       previous text=off
       timestamp-driven seek=on
       VAD=off
       CUDA device 0/FLOAT16
        |
        v
protocol v1 ready/progress/segment/completed
        |
        v
T01 adapter + deterministic sanitized publisher
```

Release/default continues to use the Python sidecar.

## Worker Profile Boundary

Use the smallest extension to the existing `CandidateAConfig` rather than creating a new backend hierarchy:

```cpp
struct CandidateAConfig {
  // existing fields...
  int max_source_frames = max_model_frames;
};
```

Add one focused helper for the route:

```cpp
CandidateAConfig kotoba_config();
```

The helper returns:

- `beam_size = 5`
- `condition_on_previous_text = false`
- `timestamp_driven_seek = true`
- `max_source_frames = 1500`

Ordinary default construction remains 3000 frames, beam 1, no history, timestamp-driven seek. Tests lock both profiles so a Kotoba change cannot drift ordinary faster-whisper.

The transcription loop changes only the source-window cap:

```text
segmentFrames = min(config.maxSourceFrames, totalFrames - seek)
model tensor = always [1, nMels, 3000]
```

Timestamp tokens remain validated against the full 30-second model range, while traces record the shorter source window separately. Seek advance remains capped to the actual source-window frames.

## Route Dispatch

`native-asr/src/main.cpp` currently accepts only ordinary faster-whisper. Replace the single-engine guard with an explicit route switch:

- `faster-whisper`: current default config and existing Candidate B behavior remain unchanged.
- `kotoba-faster-whisper`: K1 config, Kotoba readiness, no VAD model.
- other routes: unchanged `route_not_implemented`.

Do not infer the profile from model path or filename. The validated protocol engine selects it.

K1 evidence uses `useVad=false`. A Kotoba request with `useVad=true` must not accidentally load the ordinary Candidate B ORT/VAD path. Until a separate Kotoba VAD candidate is reviewed, reject it before `ready` with a narrow route-specific error. This keeps the measured/package identity truthful.

## Model Validation

Keep generic required-file validation shared, with one explicit Kotoba flag or engine-aware overload:

```text
required for both:
  config.json
  model.bin
  tokenizer.json
  vocabulary.json OR vocabulary.txt
  valid Whisper metadata

additional for Kotoba:
  non-empty preprocessor_config.json
  loaded CT2 n_mels == 128
```

Ordinary snapshots remain valid without `preprocessor_config.json`. The worker does not trust the preprocessor JSON to choose mel count; it reads `n_mels` from the loaded CTranslate2 model and uses the file as the Kotoba readiness companion required by the product contract.

## Legacy Cache Compatibility

The worker remains path-agnostic: Tauri supplies an approved local directory. T08 proves the existing Hugging Face layout without adding T12's production model manager.

Expected immutable path:

```text
<HF_HOME>/hub/
  models--kotoba-tech--kotoba-whisper-v2.0-faster/
    snapshots/f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc/
```

Compatibility proof:

1. The model-backed test receives the legacy snapshot path through test-only environment input.
2. The host canonicalizes it through existing `ResolvedNativeLaunch` handling.
3. The worker removes only the Windows extended-path spelling at the CTranslate2 boundary.
4. Model validation follows normal files whether they are snapshot symlinks or Windows copies.
5. The test records that the supplied path is the exact revision directory and that no tracked/product code copies the snapshot.

Negative fixtures cover missing preprocessor, missing vocabulary, invalid metadata, and a wrong/nonexistent revision path. T12 later owns production discovery, hash/readiness, downloads, and managed cleanup.

## Rust Host Test Seam

Extend only the `#[cfg(test)]` model-backed input structure with an optional exact engine value, defaulting to `faster-whisper` for backward compatibility:

```text
HIKARU_ASR_CT2_ENGINE=faster-whisper|kotoba-faster-whisper
```

`production_launch` uses the selected engine but otherwise preserves the existing managed-workspace audio copy, model path resolution, device selection, recovery, cancellation, and active-gate behavior. Product/Release code never reads this key.

Kotoba model-backed coverage:

- CUDA success through the T07 worker;
- structured pre-ready missing-preprocessor failure;
- cancellation/reap using a longer managed audio copy;
- recovery JSON and minimal ASS ordering;
- active gate release.

## Corrected Benchmark Contract

The current private manifest replaces the old long case with a new identity:

```text
caseId: long-v2
audio: long.wav
audio SHA-256: af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e
reference: long-v2.ass
ASS SHA-256: 46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b
dialogueCount: 681
durationMs: 4,144,235
```

Before changing the ignored current manifest, copy its old `e4656b...` identity into the task-local ignored correction workspace. Old source-specific adapters validate historical raw files against that old manifest and their original locks. Archived tracked reports are not edited.

The shared benchmark adds one deterministic classifier after ordinary missing-region detection:

```text
normalize cue with NFKC
remove whitespace, Unicode punctuation/symbols, and ー/〜/~
exclude only when the complete remainder equals 1..6 repeats of exactly one unit:
  あ | う | え | お | ん | うん | うあ
```

The classifier is cue-level and conservative:

- a gap is diagnostic-only only when every overlapping reference cue is approved standalone vocalization;
- `はい`, laughter text/markers, mixed lexical cues, and any unknown unit remain semantic and gating;
- excluded cues stay in reference text and CER;
- publication contains `missingSpeechRegions` for semantic defects and a separate `excludedNonSemanticVocalizationRegions` diagnostic list/count;
- timing and timeline legality remain unchanged.

## Corrected Historical Evidence Flow

```text
old manifest snapshot + original task lock/adapter + ignored raw hash
  -> validate original T02/T06/T08 evidence identity
  -> corrected current manifest (short-v1 / medium-v1 / long-v2)
  -> shared comparator + approved vocalization classifier
  -> one deterministic sanitized correction JSON/Markdown
  -> source-task supersession handoffs without rewriting archives
```

The correction publisher freezes original raw SHA-256 identities and source roles for:

- T02 ordinary fixed-window and Kotoba fixed-window;
- T06 selected Candidate A and Candidate B;
- T08 Kotoba K1.

A missing raw file, source-adapter failure, hash drift, old/new manifest drift, policy drift, or private path/text leak publishes no result. Completed inference is not rerun merely because the reference changed.

## K1 Evidence Flow

```text
corrected manifest + model + K1 + worker/runtime/device
  -> ignored raw runner JSON
  -> task-local adapter imports scripts/asr-benchmark.py
  -> identity validation + corrected metric recomputation
  -> deterministic sanitized JSON/Markdown
```

The runner adds one focused `--run-kotoba-evidence` mode instead of refactoring the historical T06/T07 evidence modes. It records:

- source/model window durations and token trace hashes;
- K1 config;
- model file identities;
- runner/worker/CT2/tokenizer identities;
- requested/resolved CUDA device and loaded-module identity using the T07 rules;
- 1 cold + 3 warm short samples, one medium, one long;
- peak process RSS.

The adapter/publisher must reject identity drift, failed rows without complete traces, mutable metric substitution, paths outside the canonical ignored root, and private transcript/path leakage.

## Candidate Gate

K1 execution order:

1. Core/profile/preprocessor/cache tests.
2. Build protocol-only, CPU CT2, and CUDA development presets.
3. Run short-v1 1 cold + 3 warm on CUDA.
4. Publish/check short, retaining any failure without changing the candidate identity.
5. Run medium-v1 once and retain its result regardless of outcome.
6. Run long-v2 once under the same identity.
7. Publish the final three-case evidence twice and require byte-identical output. A partial prefix remains diagnostic, reports its next case, and is never terminal even when a measured case fails.

If K1 fails any gate, do not add VAD or merge heuristics in the same iteration. Complete the three-case K1 matrix, preserve traces, then revise `prd.md`/`design.md` with one evidence-backed candidate, review the new identity, and only then resume implementation.

## K2 Bounded-Stride Overlap Candidate

Frozen candidate ID:

```text
kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1
```

K1 evidence shows that every responsible long-v2 trace ended `source-window-end` with zero overlap. Six of seven gaps lie wholly within the final four seconds of their responsible 15-second window. K2 retains the 15-second source window but caps the applied advance:

```text
proposedAdvance = parsed timestamp advance, or full source window for no-speech
appliedAdvance = min(proposedAdvance, 1000 frames, remaining frames)
nextWindowStart = currentWindowStart + appliedAdvance
```

A full 1500-frame window therefore has at least 500 frames / 5 seconds of source overlap. Parsed advances below 1000 frames retain their larger overlap. Final partial windows cannot advance beyond source end. This cap applies only to the K2 Kotoba profile; ordinary faster-whisper and preserved K1 evidence remain unchanged.

The full HF chunk postprocessor is intentionally not copied. K2 borrows only the 15s/10s/5s geometry and does not add longest-common-sequence token merging, fuzzy text matching, or a second subtitle representation.

## K2 Temporal Ownership

Let decoded window starts be `S[0], S[1], ...`, with `S[i+1]` produced by window `i`'s applied advance:

- non-final window `i` owns segment start timestamps in `[S[i], S[i+1])`;
- the final window owns `[S[last], audioDuration)`;
- a start exactly at `S[i+1]` belongs to the later window;
- equivalently, the latest decoded window whose start is not after a segment start owns it.

The later window owns the complete overlap. This is deliberate: midpoint ownership was rejected because it can expose K1 gaps #3 and #6 to the next decode and then discard the recovered segments before publication.

Ownership uses only token-derived start time and window coordinates. It never inspects reference text, candidate text similarity, token similarity, or gap coordinates. Segment start/end/text remain unchanged; no clipping, stretching, synthetic timing, or gap filling is allowed.

Known risk: a segment emitted by an earlier window may start before the next window but extend into its ownership interval, while a later segment covers overlapping content with shifted timestamps. K2 does not add fuzzy conflict resolution; CER, gap, timeline, and duplicate diagnostics decide whether the deterministic rule is acceptable.

## K2 Buffering, Emission, And Progress

Current K1 emits parsed segments before the applied advance is known. K2 reorders only the current-window commit:

1. Parse and validate timestamp-derived segments into a current-window buffer.
2. Compute proposed/applied advance, next window start, overlap, and ownership end.
3. Classify every buffered segment by start-time ownership.
4. Remove only exact `(startMs, endMs, text)` duplicates from owned segments.
5. Validate unchanged bounds and nondecreasing emitted starts against prior output.
6. Append and invoke the protocol segment callback only for surviving owned segments.
7. Publish progress at the committed ownership frontier / next window start; publish exact audio duration on completion.

Only one decoded window is buffered; no lookahead decode or retractable protocol event is introduced. Exact dedup occurs before callback emission because the existing final cleanup cannot retract already emitted events.

Ignored raw trace adds candidate/ownership identity, window index/start/end, parsed/proposed/applied advance, next start, actual overlap, parser flags, half-open ownership interval, segment disposition counts, progress frontier, and per-parsed-segment exact tuple/trace hashes plus `emitted|non-owner|exact-duplicate` disposition. The adapter proves count conservation, contiguous ownership, overlap floor, unchanged token-derived output, monotonic progress, and ordinary-route isolation. Tracked evidence publishes only hashes and aggregate counts.

## K2 Evidence Gate

Create a new K2 lock and preserve K1 unchanged. Run one frozen identity on the T07 CUDA device-0/FLOAT16 lane:

1. Profile/stride/ownership/parser/streaming/trace tests.
2. Protocol-only, CPU CT2, and CUDA development builds/tests.
3. short-v1: 1 cold + 3 warm.
4. medium-v1: one measured run.
5. long-v2: one measured run.
6. Reassess all seven K1 gap coordinates, including #1/#4/#6 with no pre-run waiver.
7. Publish the complete matrix twice and require byte-identical sanitized JSON/Markdown.

Existing gates remain unchanged. A failure publishes `stop-revise`, leaves native Kotoba disabled, and returns to planning before K3 or any non-defect classification. A pass is still only an algorithm/cache handoff, not a release pack or production route.

## Compatibility And Ownership

- Protocol v1 and `AsrJobSnapshot` remain unchanged.
- T05 owns host lifecycle/recovery/cancellation.
- T06 ordinary worker code remains unchanged. Corrected evidence supersedes its old long-gap disposition: selected Candidate A passes large-v3 short/medium/long-v2 and unlocks a separate future full ordinary model matrix, but production routing stays disabled.
- T06 Candidate B remains diagnostic-only and does not justify an ORT/VAD package input once selected Candidate A passes; no Candidate B long run is planned.
- T07 remains development CUDA evidence only.
- T12 consumes the exact Kotoba model files, revision, cache contract, and final T08 disposition.
- T13/T18 consume only the final accepted engine identity; K1 adds no ORT dependency.
- T14/T15 own formal GPU pack build and qualification.
- T16/T17 own production routing/settings/UI.

## Security And Privacy

- Model/audio paths are structured protocol values, never shell-concatenated.
- Raw output is restricted to the canonical T08 ignored local root before model/audio access.
- Tracked artifacts contain no subtitle text, audio/model bytes, absolute user paths, or raw loaded-module paths.
- Legacy snapshots are read-only inputs. T08 never deletes or rewrites them.

## Rollback

K2 rollback removes its Kotoba-only applied-stride cap, ownership filter, buffered commit order, trace fields, and K2 evidence artifacts, restoring the committed K1 `stop-revise` profile. Broader rollback reverts the Kotoba route switch, K1 source-window config, Kotoba validation, test-only host engine selection, and T08 evidence tooling. Delete only T08 ignored local output. No user cache, setting, project, Python route, ordinary worker route, or CUDA development artifact requires migration.

## Design Decisions

- **D1:** Reuse the T06 backend and add one source-window field; no engine class hierarchy.
- **D2:** K1 changes only the observed failure-relevant orchestration: fixed 15-second advance becomes timestamp-driven seek.
- **D3:** Keep model-card beam 5/no-history for the first candidate; do not reuse ordinary beam 1 without evidence.
- **D4:** Keep K1 VAD-free so T06's rejected ORT/VAD package input is not silently reintroduced.
- **D5:** Prove legacy-cache reuse through the model-backed test seam; T12 remains the production resolver/downloader owner.
- **D6:** A passing T08 algorithm is still not a publishable CUDA pack or production route.
- **D7:** Correct the current benchmark with a new `long-v2` case identity; never silently reuse `long-v1` with different reference bytes.
- **D8:** Exclude only the approved frozen standalone vocalization forms from the zero-gap gate; retain them in CER and diagnostics.
- **D9:** Re-score completed historical raw evidence after validating its original identity; do not rerun completed inference or rewrite archived reports.
- **D10:** Do not run Candidate B long: corrected selected Candidate A already removes the only product reason for VAD/ORT.
- **D11:** K2 uses a Kotoba-only 1000-frame maximum applied stride, preserving any shorter parsed seek and guaranteeing at least 500 frames of overlap on full windows.
- **D12:** The later-starting window owns the complete overlap by half-open segment-start intervals; midpoint ownership is rejected because it can discard plausible #3/#6 recovery.
- **D13:** Buffer only the current window until advance/ownership is known, deduplicate exact tuples before callback emission, and keep protocol events non-retractable.
- **D14:** Keep all seven K1 gaps mandatory during K2; defer the user's reviewed #1/#4/#6 non-defect decision until complete K2 evidence exists.
