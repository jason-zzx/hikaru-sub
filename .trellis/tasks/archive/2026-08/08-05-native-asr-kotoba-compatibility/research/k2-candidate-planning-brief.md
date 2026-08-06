# K2 Candidate Planning Brief

> Superseded ownership decision: this brief established the 15s/10s/5s geometry and gap attribution, but its midpoint-ownership recommendation was rejected by `k2-candidate-design-critique.md`. The authoritative candidate is `kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1` as frozen in `prd.md` and `design.md`; do not implement the midpoint rule described below.

## Decision

Recommend exactly one K2 identity:

`kotoba-k2-bounded-stride-overlap5-owner-v1`

K2 keeps K1's model, prompt, beam, history, timestamp parser, worker, protocol, CUDA lane, and readiness contract. It adds a Kotoba-only maximum applied stride of 1,000 mel frames / 10,000 ms, guaranteeing at least 500 frames / 5,000 ms overlap on every full 15-second source window. Deterministic temporal ownership replaces fuzzy overlap merging.

No K1 gap is waived before K2 runs. Reviewed gaps #1, #4, and #6 remain mandatory semantic failures unless the unchanged corrected comparator shows them covered after K2. All seven K1 long-v2 gap identities must be reassessed.

Product decision needed: none.

## Evidence Boundary

Reviewed inputs:

- active T08 `prd.md`, `design.md`, and `implement.md`;
- K1 lock, corrected handoff, candidate publication, and correction lock/report;
- ignored K1 long raw trace `research/local/raw-full-matrix/long.json`;
- current CTranslate2 loop/parser/tests in `native-asr/`;
- pinned Kotoba converted-model card at revision `f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc`;
- local maintained references: faster-whisper `1.2.1` and Transformers `4.57.6`.

No inference was run. The corrected comparator was used read-only to reproduce the seven long-v2 regions from retained K1 segments.

## Corrected K1 Gap Analysis

All seven responsible traces ended with a single timestamp and `source-window-end`, then advanced the full 15,000 ms with zero overlap. Times below are source milliseconds. Trace hashes identify retained ignored raw traces without publishing token IDs or text.

| Gap | Responsible trace and 15s source window | Uncovered region within window | Emitted segment boundary relation | Parsed seek behavior | Full left overlap needed from current following decode | Boundary classification |
|---:|---|---|---|---|---:|---|
| 1 | trace 63, `9bd801bb9162ead3aca01748e065ac37235821a3fee397d759a78426f1eb3a04`, `937720..952720` | `+3910..+7370` (`941630..945090`) | previous output ends `939720`; following output starts `952720` | single ending timestamp at `+2000`; full 15s advance | `11090 ms` | **Not** in final 5s; current boundary explanation is insufficient |
| 2 | trace 85, `03795dcb7d26e28716d0bcda27ce7d456ebdf078d49e65003362a527b57c1da3`, `1263540..1278540` | `+13400..+15000` | exactly previous output end to next-window start | single ending timestamp at `+13400`; full 15s advance | `1600 ms` | At boundary; touches 15s end |
| 3 | trace 86, `44b652e04561aa04fc3565a5ad0ae8e9a552b05ac415d3b746a2c2d3169a5b06`, `1278540..1293540` | `+11000..+13000` | internal hole between two segments from the same trace | single ending timestamp at `+15000`; full 15s advance | `4000 ms` | Near boundary, but not caused by the final seek alone |
| 4 | trace 97, `ce4e5c629f7eaa9a624b6c6eadeb9b815a6a468ac5497a10558b8747f5800ef2`, `1443540..1458540` | `+13180..+15000` | exactly previous output end to next-window start | single ending timestamp at `+13180`; full 15s advance | `1820 ms` | At boundary; touches 15s end |
| 5 | trace 107, `c374a052284cc14b077151a9adeb7e3d4e554c9ac8081c8a80627eb32c890f6f`, `1593540..1608540` | `+13290..+15000` | previous output ends at `+12440`; following output starts at window end | single ending timestamp at `+12440`; full 15s advance | `1710 ms` | At boundary; touches 15s end |
| 6 | trace 123, `f96ff6e12fe44cb80d070bf65bb32bf81375f85389f25c892a66ebdfb1aea012`, `1833540..1848540` | `+12160..+13690` | starts exactly at previous output end; next output starts at window end | single ending timestamp at `+12160`; full 15s advance | `2840 ms` | Near boundary; ends 1,310 ms before 15s end |
| 7 | trace 271, `70992f9906583e30802b36f8fe07ae3cd019b65b2bee97b20b9d7cc793d6eb69`, `4038460..4053460` | `+12020..+15000` | exactly previous output end to next-window start | single ending timestamp at `+12020`; full 15s advance | `2980 ms` | At boundary; touches 15s end |

Six gaps (#2-#7) are wholly within the final 4 seconds of their responsible K1 window. A 5-second guaranteed overlap exposes all six to an adjacent decode. Gap #1 needs 11.09 seconds relative to the current K1 following window and therefore is not proven by the overlap hypothesis. A bounded-stride schedule will re-phase later windows, so K2 must run before deciding whether #1 is a separate recognition defect.

The regions are real coverage holes, not timeline errors. Gaps #2, #3, #4, #6, and #7 begin exactly at an emitted segment end; #2, #4, and #7 end exactly at the next window start. Gap #3 is the strongest warning against treating this as only a seek bug because it sits between two segments produced by one window.

## Option Comparison

### 1. Guaranteed Overlap/Stride Plus Ownership - Recommend

- Smallest change that directly addresses the measured failure class.
- A 10-second maximum stride guarantees 5 seconds of overlap, enough to expose gaps #2-#7 under the observed K1 boundaries.
- Preserves an earlier decoded seek when it is below 10 seconds, so unfinished timestamp tails are not skipped.
- Adds deterministic temporal ownership instead of text/token similarity merging.
- Expected worst-case decode count is about 1.5x K1 when every raw seek would otherwise advance 15 seconds. K1 long CUDA RTF `0.030` leaves large measured headroom, but K2 must remeasure rather than extrapolate a pass.

### 2. Full Model-Card/HF Chunk Pipeline - Do Not Adopt For K2

The pinned converted-model card says HF chunked long-form was empirically better than sequential long-form. Transformers `4.57.6` uses `chunk_length_s / 6` as the default left and right stride, so 15-second chunks imply 2.5 seconds on each side, 5 seconds total overlap, and a 10-second step.

That geometry supports K2. The complete HF postprocessor does not: it carries a large stride/timestamp state machine and resolves overlapping token sequences with a fault-tolerant longest-common-sequence heuristic. Porting it would be substantially larger, would introduce fuzzy token matching explicitly excluded by the current decision, and would not reuse the existing physical segment/protocol path cleanly.

K2 should borrow only the evidence-backed 15s/10s/5s geometry, not the HF merger.

### 3. VAD - Do Not Adopt

- The seven K1 defects are confirmed-speech coverage holes, not silence-only windows or illegal timestamp restoration.
- VAD changes audio coordinates and adds ORT/model/runtime/packaging surface without evidence that it resolves Kotoba's exact gaps.
- Corrected T06 removed the product reason for retaining Candidate B ORT/VAD.
- It violates the requested K2 boundary and would affect more code than bounded stride.

### 4. Change Only Timestamp-Driven Seek - Do Not Adopt Alone

The current parser matches maintained faster-whisper semantics: a single ending timestamp means no speech after it, so seek advances the full source window. Changing that rule to advance to the last timestamp would create data-dependent overlap of roughly 13.0s for gap #1 and 1.6-3.0s for several boundary gaps, but zero overlap for gap #3 because that trace ended at 15s.

This is less predictable, can repeatedly re-decode most of a window, and still does not address the same-window internal hole. A maximum-stride cap preserves valid earlier decoded seeks while guaranteeing bounded overlap for single-ending and no-speech paths.

## Frozen K2 Identity

- engine/backend/model/revision: unchanged K1 `kotoba-faster-whisper -> ctranslate2`, pinned Kotoba revision;
- source window: maximum `1500` frames / `15000 ms`;
- model tensor and timestamp range: padded `3000` frames / `30000 ms`;
- prompt/decode: Japanese transcription, beam `5`, temperature `0`, no previous text, existing thresholds and token parser;
- applied seek: `min(parsedSeekAdvanceFrames, 1000, remainingFrames)` for parsed, single-ending, and no-speech paths;
- guaranteed full-window overlap: at least `500` frames / `5000 ms`; decoded advances below 1000 frames retain their larger overlap;
- device: T07 CUDA device `0`, FLOAT16; no fallback;
- VAD: disabled; `useVad=true` remains pre-ready failure;
- ordinary faster-whisper: unchanged.

### Deterministic Ownership And Dedup

For adjacent decoded windows, let the current source window end at `E` and the applied next-window start be `N`. Their actual overlap is `[N, E]`. The ownership cut is `floor((N + E) / 2)`.

- The first window owns segment **start timestamps** from `0` to its right cut.
- Each middle window owns start timestamps in the half-open interval `[previousCut, currentCut)`.
- The final window owns `[previousCut, audioDuration)`.
- A start exactly on a cut belongs to the later window.
- Discard non-owner segments before protocol emission.
- Preserve token-derived start/end/text unchanged; do not clip, stretch, or synthesize timestamps.
- Remove only exact duplicates with the existing `(startMs, endMs, text)` equality after ownership filtering.
- Do not use fuzzy text/token matching, reference-derived repair, gap filling, or cross-window text selection.
- Existing monotonic timeline validation remains fail-closed.

Start-time ownership is deliberately simpler than HF token merging and preserves streaming order. Its known risk is that a segment detected only from a later window's left context can be discarded because its start belongs to the earlier owner. K2 evidence, especially gap #1, decides whether that limitation is acceptable.

## Necessary Trace Fields

Keep all K1 trace fields and add to ignored raw evidence:

- candidate ID and `windowIndex`;
- `parsedSeekAdvanceFrames` and `appliedSeekAdvanceFrames`;
- `minimumOverlapFrames` / `actualSourceOverlapMs`;
- `singleTimestampEnding` and `usedDecodedSeek`;
- `ownershipStartMs`, `ownershipEndMs`, and half-open boundary rule;
- parsed, owned, non-owner-discarded, and exact-duplicate-discarded segment counts;
- per retained segment: owner window index, ownership anchor (`startMs`), and trace SHA-256.

The adapter must prove the seek chain, overlap floor, ownership partition, count conservation, unchanged token-derived timestamps, exact-only dedup, and ordinary-route isolation. Tracked publication should retain hashes and aggregate counts only; token IDs, transcript text, exact raw segments, and machine paths remain ignored.

## Focused Tests

1. Config isolation: ordinary defaults stay 3000-frame/timestamp-driven with no ownership cap; K2 alone uses 1500/1000.
2. Applied seek vectors: parsed 1500 -> applied 1000; parsed 800 -> applied 800; no-speech 1500 -> applied 1000; final partial never advances past source end.
3. Ownership vectors: exact 5s overlap gives a 2.5s midpoint cut; larger decoded overlap splits at its midpoint; first/final intervals cover the full timeline without holes or double ownership.
4. Boundary golden: a segment start immediately below a cut belongs left; exactly on the cut belongs right; timestamps/text are unchanged.
5. Dedup golden: overlapping windows with equal or conflicting text at the same time select only the temporal owner; exact duplicates inside the owner collapse; no similarity matching occurs.
6. Parser golden: existing single-ending, decoded-seek, malformed, final-partial, and WAV-bound behavior remains unchanged apart from applied stride.
7. Trace/adapter mutation tests: reject stride, overlap, cut, owner, count, candidate, ordinary-config, or identity tampering.
8. Existing protocol, readiness, cache, CPU CT2, CUDA, Rust host success/failure/cancel/recovery/active-gate tests remain green.

## Evidence Invalidation

Create a new K2 lock and preserve K1 unchanged. Invalidate affected K2 rows on any change to:

- K2 parameters, ownership/dedup rule, worker source/binary, trace schema, adapter, or publisher;
- model revision/files, tokenizer, CTranslate2, CUDA/runtime modules, device, or compute type;
- WAV/ASS/manifest/comparator/vocalization-policy identity;
- sample count/order, incomplete seek chain, overlap below the floor, ownership/count inconsistency, or private-path/text leakage.

The ignored diagnostic should bind the original seven-gap coordinate set by a deterministic hash and report each as covered or still missing. No gap is removed from the gate before scoring.

## Full GPU Matrix

Run one frozen K2 identity on the reviewed T07 CUDA device-0/FLOAT16 lane:

- short-v1: `1` cold + `3` warm;
- medium-v1: `1` measured sample;
- long-v2: `1` measured sample;
- continue through all three cases regardless of an earlier failure;
- publish twice and require byte-identical sanitized JSON/Markdown.

Apply the existing gates unchanged: CER `<=0.35`, accelerated RTF `<=0.5`, short cold wall `<=120s`, RSS `<=6 GiB`, zero timeline errors, and zero semantic gaps. Reassess all seven K1 long-v2 gaps, including #1/#4/#6, before any waiver or K3 discussion. No VRAM gate is added.

## Risks And Rollback

Risks:

- Gap #1 is not explained by the current final-5s boundary pattern and may survive.
- Gap #3 is an internal same-window hole and may survive despite adjacent exposure.
- Temporal ownership may choose a weaker overlapping decode; this is accepted for K2 because it is deterministic and avoids fuzzy repair.
- Decode work rises toward 1.5x when raw timestamp seeks would otherwise advance the full 15 seconds.

Rollback removes only the Kotoba K2 stride cap, ownership filter, new trace fields, and ignored K2 evidence. Restore K1 dispatch/profile as disabled `stop-revise`; preserve K1 evidence, legacy-cache compatibility, protocol/host infrastructure, ordinary faster-whisper behavior, and Python legacy/default routing.
