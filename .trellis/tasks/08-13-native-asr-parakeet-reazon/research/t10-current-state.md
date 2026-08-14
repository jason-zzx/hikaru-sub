# T10 Current State — Parakeet and ReazonSpeech Productization

## Purpose and authority

This note scopes T10 against the current repository state. It does not qualify either route and does not authorize implementation or production routing.

Authority order for T10:

1. Parent requirements and task map: `.trellis/tasks/07-25-native-asr-migration/{prd.md,design.md,implement.md}`.
2. Current corrected quality evidence: `.trellis/tasks/archive/2026-08/08-06-crispasr-long-v2-correction/research/{crispasr-long-v2-handoff.md,crispasr-long-v2-correction-report.md}`.
3. Shared backend/device handoff: `.trellis/tasks/archive/2026-08/08-07-native-asr-crispasr-backend/research/crispasr-backend-handoff.md`.
4. Historical ABI/shape diagnostics: `.trellis/tasks/archive/2026-08/07-25-native-asr-crispasr-poc/research/{crispasr-poc-report.md,abi-contract.md}`.
5. Current implementation and tests under `native-asr/` and `src-tauri/src/asr_worker.rs`.
6. Benchmark rules: `.trellis/spec/asr/quality-guidelines.md`.

Historical T03 `long-v1` values are provenance only. T10 must use the current T03C `long-v2` reference identity and must rerun inference after any algorithm/config/binary change.

## Confirmed route state

| Route | Current authority | What is proven | What is not proven |
|---|---|---|---|
| Parakeet JA Q8_0 | `stop-revise` | CrispASR ABI/runtime works; CPU/GPU execution-family seam exists; nested native word getters contain substantial legal timing | Product quality: corrected CER is `0.4917 / 0.6123 / 0.5962`, above `0.35` in all three cases; output is one oversized top-level segment |
| ReazonSpeech Q8_0 | `proceed-with-named-risks` | Correct route is Hikaru `reazonspeech-nemo` -> CrispASR logical backend `parakeet`; corrected CER is `0.1333 / 0.2857 / 0.2944`; historical CPU text/RTF/RSS/timeline/gap gates pass | Subtitle readiness: each result is one oversized top-level segment and approximately 91–94% of native word ranges are zero-duration |
| `parakeet-family` development device | `development-gpu-ready` | Reazon representative GPU/CPU warmed RTF ratios are `0.119318` short and `0.110944` locked 120s | Engine quality, product routing, formal runtime pack identity, CPU fallback, and production GPU qualification |

Frozen product gates relevant to both routes are CER `<=0.35` per case, CPU inference RTF `<=1.0`, accelerated RTF `<=0.5`, short cold wall `<=120s`, CrispASR RSS `<=12 GiB`, zero illegal/out-of-bounds segments, and zero semantic speech gaps `>=1.5s`. Source: `.trellis/spec/asr/quality-guidelines.md`, section `Ground-Truth ASR Comparison`.

## Current implementation seams

### Shared backend data already exists

- `native-asr/src/crispasr_backend.hpp` — `NativeWord`, `NativeSegment`, and `Result` preserve top-level text/timing and nested native words. T10 should extend policy above these copied Hikaru-owned values, not expose upstream handles or add a second ABI wrapper.
- `native-asr/src/crispasr_backend.cpp` — `upstream_backend(Engine)` already maps both `Engine::Parakeet` and `Engine::ReazonSpeechNemo` to the explicit upstream string `parakeet`; filenames do not select a backend.
- `native-asr/src/crispasr_backend.cpp` — `copy_source_segments(...)` validates non-Qwen top-level ranges but deliberately permits zero-duration native words (`end == start`). This accurately preserves the Reazon risk but means native words cannot be emitted directly as protocol `Segment` values.
- `native-asr/src/crispasr_backend.cpp` — `CrispAsrBackend::Impl::transcribe(...)` already calls the pinned stable `crispasr_session_transcribe_lang` path, owns callback reset/result cleanup, and returns copied data. T10 should not replace lifecycle/ABI ownership.
- `native-asr/src/crispasr_backend.cpp` — `segment_callback(...)` currently forwards every legal non-Qwen upstream preview as a protocol candidate. For current real models this can be the same whole-file oversized segment that T10 is meant to correct.

### Worker and protocol seams already exist

- `native-asr/src/main.cpp` — `run_crispasr(...)` is the narrow product-policy seam. It currently rejects `useVad=true`, rejects Vulkan, emits upstream preview segments, maps final top-level source segments directly, emits `segmentsReplace` only when preview/final differ, then completes.
- `native-asr/include/hikaru_asr/protocol.hpp` — protocol v1 already has `Segment`, `SegmentsReplace`, and no model-specific event type. No protocol revision is needed.
- `native-asr/src/protocol.cpp:284-286` — final replacement is bounded by the shared segment-count limit and validated atomically.
- `native-asr/protocol-v1-limits.json:7-9` — text is bounded to 16,384 bytes and replacement count to 32,768. T10 output assembly must additionally prove that a complete long-v2 replacement fits the event-line limit; blindly emitting every native word is not acceptable.
- `src-tauri/src/asr_worker.rs:329-333` — all three CrispASR engine IDs already resolve to backend `crispasr`.
- `src-tauri/src/asr_worker.rs:1619-1623`, `1790-1815`, `2628-2675` — ignored-local exact model inputs, real-host launch, success, and hard-cancellation seams already exist. T10 should reuse the same host rather than add another launcher.

### Existing tests are reusable but not sufficient

- `native-asr/tests/crispasr_backend_tests.cpp` — `run_tests(...)` covers explicit Reazon alias routing, copied nested words, callback/final replacement difference, ownership cleanup, CUDA marker rejection, and common failures.
- The fake ABI currently exercises only tiny one-segment/one-word shapes. It does not cover subtitle assembly from hundreds of native words, mostly-zero-duration Reazon words, text conservation, bounded cue size, or long replacement size.
- `native-asr/CMakeLists.txt` keeps `HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=OFF` by default and links CrispASR only in an opt-in worker. That release/default-off boundary must remain in T10; T14–T18 own packaging and cutover.
- `native-asr/CMakeLists.txt` also embeds the archived T09 evidence-runner local-root shape through `T09_LOCAL_ROOT`. T10 evidence must use a T10-owned ignored local root and must not make the T09 acquisition runner the product-quality authority.

## Findings by severity

### Blocker — Parakeet cannot be qualified by segmentation alone

**Evidence:** corrected CER `0.4917 / 0.6123 / 0.5962` fails every authoritative case in `crispasr-long-v2-correction-report.md`.

Changing one giant segment into smaller segments without changing recognized text leaves CER unchanged. Therefore a shared output segmenter may solve subtitle shape but cannot satisfy Parakeet acceptance. T10 needs one separately identified, evidence-backed inference candidate that can change Parakeet text output, or it must truthfully retain `stop-revise`.

### Blocker — Reazon's historical pass is not subtitle-ready timing

**Evidence:** `crispasr-poc-report.md`, section `ReazonSpeech Q8_0`, records one top-level segment per file and zero-duration words of `69/76`, `1,141/1,248`, and `10,098/10,749` for short/medium/long. T03C explicitly retains this as a named risk.

Direct word-to-cue conversion would violate `endMs > startMs` for most words. Splitting the full text and proportionally distributing time would invent timing and is not justified by current evidence. T10 needs an audio-bounded or native-anchor-backed segmentation policy and direct ground-truth validation.

### High — No T10 algorithm/evidence identity exists yet

T03C re-scored retained T03 bytes and ran no inference. T09 measured development device speed using a frozen T09 worker/runtime but intentionally did not implement subtitle policy or route qualification. Any T10 source/config/output-policy change invalidates those rows as product evidence under `.trellis/spec/asr/quality-guidelines.md`.

T10 therefore needs its own lock, ignored raw acquisition, shared T01 adapter/comparator use, deterministic sanitized publisher, and short/medium/long-v2 rows under one frozen candidate identity.

### High — Raw upstream previews can contaminate recovery with the known giant segment

`native-asr/src/main.cpp::run_crispasr` forwards upstream preview callbacks before T10 final assembly. If the worker is cancelled or crashes before final replacement, the Rust recovery snapshot may retain the known whole-file segment. Product policy should not emit a preview unless that preview already satisfies the selected T10 legality/size policy. The minimal safe default is to suppress raw Parakeet-family preview output and emit only policy-approved final segments/replacement; lifecycle progress may remain sparse because the pinned upstream progress callback was historically silent.

### High — Route closure semantics need to remain independent

The parent states that one engine failure does not disable the other and that engines are promoted independently. T10 planning should produce separate Parakeet and Reazon dispositions and rollback flags. It must not make Reazon success contingent on waiving Parakeet CER, and must not describe T10 as fully quality-qualified if Parakeet remains `stop-revise` without an explicit parent replan.

### Medium — Subtitle-scale output has no frozen numeric cap

The parent requires validation of "subtitle segment size" but the inspected parent/spec artifacts do not define a maximum cue duration or Japanese text length. This is not repository-answerable today. A testable cap must be frozen before implementation; it must not be copied automatically from Python's historical 45-second chunk or Kotoba's 15-second inference window because those are inference windows, not subtitle UX requirements.

### Medium — Text conservation is untested

A T10 segmenter must prove that joining final cue texts yields the selected candidate transcript under one explicit Japanese normalization rule. Otherwise punctuation/whitespace handling can silently change CER while appearing to be segmentation. Existing fake tests prove copied strings, not whole-result text conservation.

### Medium — VAD remains deliberately unavailable

`native-asr/src/main.cpp::run_crispasr` fails `useVad=true` with `crispasr_vad_not_implemented`. No T09 CrispASR VAD candidate was selected. T10 should not add VAD merely because segmentation is difficult. A VAD candidate requires a new reviewed identity and evidence that it addresses the observed failure; otherwise keep the existing fail-closed behavior.

### Medium — Formal GPU/product claims remain downstream

T09's external attestation is enough to keep repeated T10 experiments on CUDA, not enough to publish a managed pack or production route. T10 should record the exact development device identity and run required CPU final/regression rows for any claimed CPU-qualified route. T14/T15 still own immutable GPU packs, capability probing, fallback, and accelerated product qualification.

## Minimal candidate ladder

The candidate ladder stays minimal, but each frozen model candidate must finish the authoritative short-v1 / medium-v1 / long-v2 matrix before its quality disposition. A failed quality gate does not justify building a generic segmentation framework or configurable policy matrix; it only makes the completed candidate `stop-revise`.

### Shared candidate S0 — policy-safe final emission

Minimum common change:

1. Keep the existing `CrispAsrBackend` ABI/lifecycle and copied `Result` shape.
2. Suppress raw whole-file preview callbacks unless already product-eligible.
3. Convert the final copied result through one small Parakeet-family policy function returning `std::vector<Segment>`.
4. Validate non-empty text, legal ordered audio-bounded ranges, text conservation, configured subtitle-size cap, protocol segment count, and serialized replacement size before emission.
5. Emit one final `segmentsReplace` when necessary, then `completed`.

This is necessary for both routes but does not by itself change CER.

### Reazon candidate R1 — bounded-audio inference windows

Recommended first real candidate, subject to official/pinned-source confirmation:

- Reuse the same session and `transcribe_lang` call on bounded PCM windows; do not add VAD or another inference library.
- Derive emitted timing from the actual audio window plus legal native local range, never proportional character timing.
- Prefer the smallest no-overlap/bounded-boundary candidate that can pass the benchmark. Add overlap/ownership/dedup only after a measured boundary failure requires it.
- Preserve exact recognized text and record every window start/end, native range, translated range, text hash, and final disposition in ignored evidence.

Why this is the minimal viable direction: Reazon's nested word clock is mostly unusable, while its text accuracy is already within gate. Audio windows can create truthful coarse timing without relying on zero-duration words. The current Python `45s + 2s overlap` route is a diagnostic regression input only, not the native default.

Ceiling/risk: non-overlap can cut speech at boundaries; overlap requires an explicit ownership rule and may duplicate text. The candidate must be rejected, not patched from reference text, if ground-truth gaps or duplication appear.

### Parakeet candidate P1 — bounded-audio inference plus native-word assembly

Recommended single bounded experiment after upstream-source review:

- Use the same pinned session API on bounded PCM windows so the inference input—not just output formatting—changes.
- Within each window, form cues only from legal monotonic positive-duration native word spans; attach zero-duration items only when text conservation and a surrounding legal native span are provable.
- Use window/top-level timing only as an outer bound, not as proportional synthetic word timing.
- Run short-v1, medium-v1, and long-v2 under one frozen candidate identity. Record any failed quality gate and continue the remaining audio; the full failure distribution is required before P1 is classified.

Why not start with whole-audio word subdivision: it can improve subtitle shape, but the known all-case CER blocker remains untouched. Why not add VAD first: no evidence connects VAD to Parakeet's short CER failure.

### Deliberately excluded options

- No proportional text-to-time distribution.
- No reference-derived hole filling or transcript correction.
- No Python parity requirement.
- No new backend interface/factory/protocol version.
- No T14/T15 runtime-pack work, downloader, settings, UI, or release routing.
- No Qwen/ForcedAligner policy in T10.

## Evidence gaps T10 must close

1. **T10 input lock:** current long-v2 manifest/comparator, exact Parakeet/Reazon model hashes/licenses, worker/runtime/source/toolchain/device identity, candidate config, and ignored local root. Pinned repeated-window semantics are already documented in `research/t10-window-contract.md`.
2. **Model-backed output shape:** per case record top-level and word timing distributions, text-conservation result, final cue duration/text distributions, protocol replacement byte size, CER, semantic gaps, timeline, RTF, cold wall, and RSS. The approved output cap is 96 code points / 15000ms.
3. **CPU evidence:** rerun the final accepted algorithm on CPU if claiming a CPU-qualified route; historical T03 CPU rows do not cover T10's algorithm/binary.
4. **CUDA evidence:** use `parakeet-family: development-gpu-ready` for iteration, but identify results as development quality evidence until T14/T15.
5. **Failure/rollback evidence:** independent route disablement, structured invalid-result failure, cancellation/reap, recovery without an ineligible giant preview, and no effect on CT2/Qwen/default routing.
6. **Privacy/determinism:** raw text/audio/model paths only below the canonical ignored T10 local root; tracked publication contains hashes/aggregates only and regenerates byte-identically.

## Required focused tests

### Native unit/CTest

- A small pure policy function with vectors for legal multi-segment output, mostly-zero-duration Reazon words, mixed legal/zero-duration Parakeet words, backward/out-of-bounds ranges, empty text, text-conservation failure, cue cap, segment-count cap, and replacement-line overflow.
- Fake ABI fixtures with multiple source segments/words and preview/final differences; preserve existing ownership/reset/cleanup assertions.
- Assert raw ineligible previews are not emitted and one approved final replacement completes.
- Assert `useVad=true` and Vulkan remain fail closed unless separately replanned.
- Full existing protocol, fake-worker, CTranslate2, and CrispASR core CTest lanes remain green.

### Rust host

- Reazon and Parakeet success through the existing host with final replacement/recovery semantics.
- Pre-ready model/runtime failure, post-ready policy failure with zero accepted final output, hard cancellation/reap, and active-job gate.
- Release/default worker still rejects CrispASR when the development/product compile gate is off.

### Model-backed qualification

- Use the shared T01 benchmark implementation; never reimplement CER/gap/timeline scoring.
- Reazon and Parakeet: complete short/medium/long-v2 under one frozen identity even when an earlier case fails a quality gate. Identity/input/runtime attestation drift, harness corruption, or incomplete trace is invalid and repaired/rerun; an identity-valid candidate-caused structured load/compute/resource failure with a complete trace is a valid failed row, but still does not truncate later cases.
- Required CPU/GPU timing and resource samples must be explicit; no T09 speed row may be relabeled as T10 quality evidence.
- Deterministic publisher mutation tests reject manifest/model/worker/runtime/config/device/raw-hash/metric/segment-distribution drift.

## Repository-answerable planning decisions

These decisions are already supported by repository authority and should not be re-asked:

- Keep both routes in the existing worker and existing protocol v1.
- Reuse one `CrispAsrBackend`; do not create a generic backend hierarchy.
- Explicit route mapping is `parakeet|reazonspeech-nemo -> parakeet`.
- Use the T09 `parakeet-family` CUDA lane for repeated T10 experiments; subtitle failures do not select CPU.
- Keep Release/default Python legacy and all native CrispASR product routes disabled during T10.
- Keep Qwen, model downloader, runtime packs, settings, frontend, installer, and cutover out of scope.
- Keep VAD fail closed until a separately reviewed candidate exists.
- Treat Parakeet and Reazon qualification/rollback independently.
- Use current T03C long-v2 authority and shared T01 metrics; Python is diagnostic only.

## Frozen planning decisions

1. Subtitle output caps are user-approved at `96` Unicode code points and `15000ms` per cue. The decision is based on the authoritative ASS distribution (long-v2 P95 `57` code points / `9340ms`, observed maxima `81` / `13800ms`) rather than Python's historical `40/5000` values. This product cap is independent of the inference-window choice.
2. The first R1/P1 inference candidate separately uses continuous `15000ms` no-overlap PCM windows because every window then supplies a truthful outer time bound that cannot itself exceed the cue-duration cap. Window size remains a candidate algorithm identity, not a user setting or a derivation from Python chunking.
3. User approved independent closure: T10 may archive with Reazon qualified and Parakeet truthfully `stop-revise`; the parent task map has been updated to match.
4. R1 and P1 both complete the full short-v1 / medium-v1 / long-v2 matrix. A single quality-gate failure or identity-valid candidate-caused structured failure does not truncate later cases; invalid attestation/input/harness/incomplete-trace evidence triggers repair and case rerun.
5. Repeated same-session window semantics and window-local timing are supported by pinned source inspection and recorded in `research/t10-window-contract.md`; contradiction in fake/model-backed checks fails the candidate and returns to planning.

## Expected minimal tracked implementation surface

Likely product changes, subject to final design:

- `native-asr/src/crispasr_backend.hpp/.cpp` — only if a narrow windowed-transcription or policy input/output seam is required.
- `native-asr/src/main.cpp` — policy-approved preview/final event mapping.
- `native-asr/tests/crispasr_backend_tests.cpp` and fake ABI fixture — focused deterministic coverage.
- `native-asr/CMakeLists.txt` — only the minimum T10 test/evidence target/root wiring; preserve default-off product boundary.
- `src-tauri/src/asr_worker.rs` — test-only model-backed T10 host cases if existing helpers are insufficient.
- `.trellis/tasks/08-13-native-asr-parakeet-reazon/research/` — locks, ignored acquisition tooling references, sanitized evidence/report/handoff.

Avoid changing frontend, product Tauri commands/types, protocol schema, downloader, runtime settings, packaging, or Python engines in T10.

## Residual risks

- Parakeet may be fundamentally unable to meet the frozen CER gate with this model/quantization and pinned upstream API; T10 must support a truthful `stop-revise` result.
- Reazon audio windowing may trade giant segments for boundary duplication or speech loss. Only direct short/medium/long-v2 evidence can decide.
- The pinned upstream progress callback can remain silent, so suppressing giant previews may leave only coarse running status until final output; this is preferable to persisting invalid subtitle shape but must be covered by host/recovery tests.
- Development CUDA identity is not a formal pack identity. A route that only passes on the T09 local CUDA lane remains unpublishable until T14/T15.
