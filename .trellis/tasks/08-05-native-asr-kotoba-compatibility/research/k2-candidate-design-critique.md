# Independent K2 Candidate Design Critique

## Scope

Read-only critique of `research/k2-candidate-planning-brief.md` against:

- `native-asr/src/ctranslate2_whisper.cpp`;
- `native-asr/src/ctranslate2_whisper.hpp`;
- `native-asr/tests/ctranslate2_whisper_tests.cpp`;
- ignored K1 long trace `research/local/raw-full-matrix/long.json`.

No inference was run. No production or planning file was edited.

## Findings By Severity

### Critical - Midpoint ownership can discard the recovery K2 is intended to test

The proposed geometry exposes gap #3 to a following decode but does not guarantee that the recovered segment survives ownership filtering.

For the old K1 window:

- source window: `[1278540, 1293540]`;
- gap #3: `[1289540, 1291540]`, or `+11000..+13000`;
- K2 following start under a 10-second stride: `N = 1288540`;
- old window end: `E = 1293540`;
- proposed midpoint cut: `floor((N + E) / 2) = 1291040`, or `+12500`.

A following-window segment starting at the gap start, `1289540`, is before the midpoint. The brief therefore assigns that start to the old window and discards the following-window segment as non-owner output. The old window is exactly the decode that omitted `[1289540, 1291540]`.

The K1 trace confirms the hole is internal to one generated trace: one retained segment ends at `1289540`, the next retained segment starts at `1291540`, and both bind trace SHA-256 `44b652e04561aa04fc3565a5ad0ae8e9a552b05ac415d3b746a2c2d3169a5b06`. Exposure without retention does not test whether overlap repairs the observed failure class.

Gap #6 has the same problem. Its measured start is `+12160`, also before the `+12500` midpoint for a 5-second overlap. Thus midpoint ownership is directly misaligned with at least two of the six gaps claimed to be exposed by K2.

Conclusion: `kotoba-k2-bounded-stride-overlap5-owner-v1` is inadequately targeted as frozen. A pass could still happen through re-phasing, but a failure would be ambiguous between model non-recovery and deterministic ownership discard.

### High - The proposed trace does not prove whether recovery occurred before discard

The brief requires aggregate parsed/owned/discarded counts but only requires per-segment ownership evidence for retained segments. That is insufficient for the central K2 question.

For every parsed segment, ignored raw evidence must record its source start/end, token-trace hash, owner decision, and final disposition. Otherwise the adapter cannot distinguish:

- the following window did not recover gap #3;
- it recovered a segment before the midpoint and ownership discarded it;
- it recovered an exact duplicate that dedup removed;
- it recovered a conflicting segment that another rule selected against.

Tracked publication can remain sanitized by publishing hashes and aggregate disposition counts only.

### Medium - Streaming emission must be reordered around seek calculation

The current loop emits non-VAD segments at `native-asr/src/ctranslate2_whisper.cpp:1653`, but computes parsed/applied advance afterward at `native-asr/src/ctranslate2_whisper.cpp:1668`. Ownership depends on the applied next-window start, so a K2 implementation cannot preserve that order.

K2 must hold the current window's parsed segments in a temporary buffer, compute the applied advance and ownership end, filter and exact-dedup, run monotonic validation, and only then call the segment callback. This remains streaming: it adds only current-window buffering, not a second decoded-window lookahead.

### Medium - Dedup and progress need pre-emission invariants

The current backend performs a final exact-duplicate pass at `native-asr/src/ctranslate2_whisper.cpp:1712`, after non-VAD callbacks have already occurred. K2 exact dedup must happen after ownership filtering but before callback emission; a final cleanup cannot retract protocol events.

Progress already follows applied seek in the current loop. Under K2 it should be explicitly defined as the committed ownership frontier, not the decoded source-window end. For non-final window `i`, progress after emission must equal `S[i+1]`; final progress must equal audio duration. It must remain monotonic even when parsed seek is less than the 10-second cap.

### Low - Coordinate goldens are needed in addition to generic partition tests

The proposed midpoint vector tests can all pass while preserving the gap #3 blind zone. Tests must bind the measured gap #3 and gap #6 coordinates and include a mutation that reinstates midpoint ownership, proving the test fails for the rejected rule.

## Minimal Deterministic Alternatives

| Alternative | Result |
|---|---|
| Keep 15s/10s/5s and midpoint start ownership | Reject. It deterministically discards plausible recovery for gaps #3 and #6. |
| Keep 15s/10s/5s and give the later window the full overlap by start timestamp | Smallest adequate change. It retains any following-window recovery whose start is at or after the following window start. |
| Keep midpoint ownership but increase overlap | Reject. A midpoint always leaves the first half of every overlap owned by the decode whose right edge is under investigation. More overlap moves the cut but does not remove that structural blind zone. |
| Emit both windows and remove exact duplicates only | Reject. Conflicting overlapping outputs remain, producing duplicate/competing subtitles without a deterministic single owner. |
| Fill uncovered time from the adjacent window | Reject. This adds a timing-repair state machine and selection behavior beyond a simple candidate orchestration change. |
| Use a fixed 10-second stride instead of a maximum applied stride | Not needed for K2. It is deterministic but discards valid shorter decoded seeks and changes more of K1 than the ownership correction requires. |

## Exactly One Recommended K2 Identity

`kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1`

All K1 model, revision, tokenizer, prompt, beam, history, timestamp parser, worker, protocol, CUDA lane, readiness, and gate identities remain unchanged.

### Source Window And Stride

- source window: maximum `1500` mel frames / `15000 ms`;
- model tensor and timestamp range: padded `3000` frames / `30000 ms`;
- parsed speech advance: existing parser result capped to the current source-window frames;
- no-speech proposed advance: current source-window frames;
- applied advance: `min(proposedAdvanceFrames, 1000, remainingFrames)`;
- full 15-second window overlap: at least `500` frames / `5000 ms`;
- parsed advances below `1000` frames remain unchanged and produce larger overlap;
- ordinary faster-whisper remains unchanged.

### Ownership Rule

Let decoded window starts be `S[0], S[1], ...`, where `S[i+1]` is derived from window `i`'s applied advance.

- non-final window `i` owns segment start timestamps in `[S[i], S[i+1])`;
- the final window owns `[S[last], audioDuration)`;
- a start exactly at `S[i+1]` belongs to the later window;
- equivalently, the latest decoded window whose start is not after the segment start owns that segment;
- the later window therefore owns the entire source overlap;
- ownership uses only token-derived segment start time; it does not inspect text, tokens, reference data, or segment similarity;
- segment start/end/text remain unchanged; no clipping, stretching, or synthetic timing is permitted.

For gap #3, the following window starts at `1288540` and owns every recovered start at or after that value. A recovered segment starting at `1289540` is retained. The same rule retains a gap #6 recovery starting at its measured `+12160` coordinate.

Gap #1 remains an explicit unresolved recognition risk because its old coordinate is outside the guaranteed following-window overlap. It is not waived: all seven K1 gap identities remain in the K2 scoring gate.

### Buffering And Emission Rule

For each decoded window:

1. Parse and validate all timestamp-derived segments into a current-window buffer.
2. Compute proposed advance, applied advance, `S[i+1]`, overlap, and ownership interval.
3. Classify every buffered segment as owner or non-owner by start timestamp.
4. Exact-dedup owned segments against already retained exact tuples and earlier owned tuples in the same buffer.
5. Validate unchanged bounds and nondecreasing emitted start time against the last emitted segment.
6. Append and call the protocol segment callback only for surviving owned segments, in parser order.
7. Emit progress equal to the ownership end / applied next start; emit exact audio duration on completion.

No cross-window lookahead buffer is required because `S[i+1]` is known after parsing window `i`. No emitted event is retractable.

### Dedup Rule

- Run after ownership filtering and before protocol emission.
- Remove only exact `(startMs, endMs, text)` duplicates.
- Treat same-time different-text segments as non-duplicates; do not use text/token similarity.
- Cross-window conflicts are resolved only by temporal ownership, not by content.
- Keep the existing fail-closed bounds and monotonic-start validation.

### Required Ignored Raw Trace Fields

Per candidate/run:

- `candidateId` and ownership-rule identity;
- model/worker/runtime/input identities already required by K1.

Per window:

- `windowIndex`;
- `windowStartFrames`, `windowStartMs`, `sourceWindowFrames`, `sourceWindowEndMs`;
- `parsedSeekAdvanceFrames`, `proposedAdvanceFrames`, `appliedSeekAdvanceFrames`;
- `nextWindowStartMs`, `actualSourceOverlapFrames`, `actualSourceOverlapMs`;
- `parseStatus`, `singleTimestampEnding`, `usedDecodedSeek`;
- `ownershipStartMs`, `ownershipEndMs`, `ownershipEndExclusive`, `finalWindow`;
- `parsedSegmentCount`, `ownedBeforeDedupCount`, `nonOwnerDiscardedCount`, `exactDuplicateDiscardedCount`, `emittedSegmentCount`;
- `sourceProgressBeforeMs`, `sourceProgressAfterMs`;
- `lastEmittedStartBeforeMs`, `lastEmittedStartAfterMs`;
- existing generated-token trace SHA-256.

Per parsed segment:

- token-derived `startMs` and `endMs`;
- canonical exact-tuple SHA-256 and token-trace SHA-256;
- `ownershipAnchor = startMs`;
- resolved `ownerWindowIndex`;
- disposition: `emitted`, `non-owner`, or `exact-duplicate`;
- duplicate target hash when disposition is `exact-duplicate`.

Adapter invariants:

- `parsed = nonOwnerDiscarded + ownedBeforeDedup`;
- `ownedBeforeDedup = exactDuplicateDiscarded + emitted`;
- ownership intervals are contiguous and half-open;
- emitted segment timestamps/text hash exactly match parsed evidence;
- progress equals the committed ownership frontier and never regresses;
- no ordinary faster-whisper row contains K2 fields or behavior.

Tracked evidence should publish only candidate identity, hashes, aggregate counts, gap dispositions, and mutation-check outcomes. Raw text, token IDs, exact segment lists, and machine paths remain ignored.

### Focused Tests

1. Profile isolation: ordinary defaults remain `3000` source frames with existing timestamp-driven behavior; only K2 uses `1500` source frames, `1000` maximum applied advance, and latest-start ownership.
2. Applied advance vectors: parsed `1500 -> 1000`; parsed `800 -> 800`; no-speech `1500 -> 1000`; final partial `700 -> 700`; no advance may pass zero or source end.
3. Ownership partition: `[S[i], S[i+1])`; exact boundary belongs later; final interval closes at audio duration; variable advances produce contiguous intervals without double ownership.
4. Gap #3 golden: following start `1288540`, recovered start `1289540` is emitted by the following window. A midpoint-cut mutation at `1291040` must fail the golden.
5. Gap #6 golden: a recovered start at old-window `+12160` is emitted by the following window. The midpoint mutation must fail.
6. Unchanged timing: ownership never modifies parsed start/end/text; attempted clipping/stretching/synthetic timestamps fail the test.
7. Streaming: no callback occurs before applied advance and ownership end are known; callback starts remain nondecreasing across windows; no callback is retracted.
8. Exact dedup: exact tuples collapse before callback; same-time different-text tuples are not similarity-merged; non-owner overlap output is discarded before dedup.
9. Progress: callbacks equal applied ownership frontiers, are sorted, never exceed duration, and end exactly at duration for speech, no-speech, and final-partial paths.
10. Trace conservation: segment disposition counts balance; owner indices and tuple hashes reproduce; mutations to stride, overlap, owner, progress, counts, candidate, or ordinary-route isolation are rejected.
11. Parser regression: existing paired, single-ending, decoded-seek, malformed, timestamp-after-WAV, and final-partial vectors remain unchanged before K2 orchestration applies its stride cap.
12. Existing protocol, readiness, cache, CPU CT2, CUDA, Rust-host success/failure/cancel/recovery/active-gate tests remain green.
13. Full K2 evidence reassesses all seven K1 long-v2 gaps with no pre-run waiver, including #1, #3, #4, and #6.

## Product Decision

No user product decision remains before running this revised K2 identity. The ownership correction is an engineering experiment boundary, and the existing CER, performance, timeline, and zero-semantic-gap gates decide acceptance. If gap #1 or any other mandatory gap remains, record `stop-revise` and return to K3 planning rather than requesting a waiver.
