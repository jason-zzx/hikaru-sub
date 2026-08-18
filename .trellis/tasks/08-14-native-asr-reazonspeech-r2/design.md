# ReazonSpeech R2 technical design

## 1. Design objective

R2 fixes the inference boundary that R1 introduced without changing model quantization, runtime pin, host lifecycle or release routing.

R1 coupled two unrelated constraints:

- inference used contiguous fixed `15000ms` buffers;
- subtitle cues were limited to `15000ms`.

Pinned CrispASR treats Japanese input above `12s` as a different streamed path, so every full R1 window exceeded the maintained single-pass range. R2 decouples inference slicing from subtitle limits:

```text
verified PCM
  -> pinned CrispASR Silero VAD
  -> ordered speech cores, each <= 12s (energy-minimum re-split)
  -> direct-ABI final 30ms padding (windows <= 12.06s; adjacent overlap <= 60ms)
  -> one exact single-pass transcribe per padded window on one loaded session
  -> one legal top-level cue per slice
  -> one atomic segmentsReplace
```

The primary candidate is intentionally one mechanism: maintained VAD boundaries plus the pinned direct ABI's own final padding. No caller-created overlap, ownership rewrite, dedup, generic segmenter, quantization sweep or decoder search is added.

## 2. Candidate ladder

### 2.1 Diagnostic oracle — not a candidate

Before product changes, add a task-local tracked stdlib Python oracle that uses `ctypes` to call the exact pinned C ABI directly. It must:

- verify the locked `crispasr.dll`, ReazonSpeech Q8_0 and canonical Silero VAD asset identities;
- open one CUDA Reazon session with the same open params as the worker;
- call `crispasr_vad_slices` with the frozen primary defaults, `12000ms` unpadded core cap and official/default `speechPadMs=30`;
- call `crispasr_session_transcribe_lang` exactly once for every returned slice;
- read only the copied top-level result for each slice and write ignored raw JSON;
- record the actual VAD windows, call count and maximum slice duration.

The oracle does not invoke the CLI dispatcher, `transcribe_vad`, clamp, ownership rewrite, dedup, stitching, gap-fill, caller-created overlap, decoder search, punctuation splitting or any reference repair. It accepts only adjacent overlap up to `60ms` created by the pinned ABI's final `30ms` padding. Its tracked runner refuses alternate algorithm parameters, so any output is directly attributable to the primary mechanism.

Run short-v1 and medium-v1 through the shared comparator. The oracle may show a plausible direction but cannot publish a quality disposition because it is not the reviewed worker identity and does not complete the full matrix. Stop if it shows no improvement signal in completion, CER or semantic gaps.

**Superseded Step 1 gate:** `R2-vad12-top-level-v1` was `not-promising` structurally. With the frozen `30ms` speech pad, short-v1 returned `[0,10260]ms` followed by `[10200,14080]ms`. The pinned C ABI pads after post-merge/rechunking, creating native `60ms` overlap that contradicted that identity's blanket non-overlap rule.

**User-reviewed decision:** keep official/default `speechPadMs=30` and change the identity rather than clamp or switch to an unsupported `0ms` workaround. The new oracle distinguishes the `12000ms` unpadded core cap from the `12060ms` padded inference cap, permits only adjacent ABI-native overlap up to `60ms`, and still forbids ownership rewrite/dedup/stitching.

**New Step 1 gate:** `R2-vad12-pad30-overlap-top-level-v1` completed short-v1 and medium-v1 under one frozen identity and classified `promising`: short CER `0.266667`, semantic gaps `1`; medium CER `0.295385`, semantic gaps `19`; zero timeline errors in both. This remains a source-only direction signal, not a formal candidate disposition. Stop before Step 2/product code pending user review.

### 2.2 Primary — `R2-vad12-pad30-overlap-top-level-v1`

Frozen algorithm:

```text
vad=Silero ggml-silero-v6.2.0.bin
threshold=0.5
minSpeechMs=250
minSilenceMs=100
speechPadMs=30
coreMaxSliceDurationMs=12000
paddedMaxInferenceWindowMs=12060
sliceSplit=upstream energy-minimum
adjacentNativePaddingOverlapMs<=60
nonAdjacentOverlap=false
sessionReuse=true
sourceSegmentsPerSlice=1
cueMapping=one legal top-level source segment -> one cue
singlePassDispatch=legacy inline direct parakeet_transcribe_ex
singlePassEnvironment=CRISPASR_PARAKEET_STREAM_THRESHOLD=13; CRISPASR_SESSION_UNIFIED_DISPATCH=0
reactiveStreamedFallback=false
model=ReazonSpeech Q8_0
```

The exact VAD asset size/hash/license, CLI/source identities and any maintained default that differs in the pinned source must be frozen in `research/r2-input-lock.md` before acquisition.

### 2.3 Conditional fallback — `R2-vad12-gapfill-v1`

Not implemented unless the primary complete matrix is `no-material-improvement` and raw evidence shows one or more `>=1000ms` uncovered spans inside valid VAD slices.

The fallback may add only the pinned upstream behavior:

- identify uncovered native-timing spans inside a slice;
- add `200ms` edge padding;
- re-transcribe the gap in isolation;
- retain recovered native items whose midpoint belongs to the gap and is not already covered;
- at most two rounds;
- no reference text, fuzzy match or inferred duration.

It is a new candidate identity and reruns the complete matrix.

## 3. Reused boundaries

Remain unchanged:

- `native-asr/include/hikaru_asr/protocol.hpp` and protocol-v1 limits;
- `NativeAsrHost`, active-job gate, recovery and process-tree cancellation;
- `CrispAsrBackend` session open/identity verification/callback ownership/result cleanup;
- explicit `reazonspeech-nemo -> parakeet` upstream route;
- `96` code-point / `15000ms` cue caps;
- one final `segmentsReplace` then `completed`;
- T01 manifest/comparator and evidence privacy model;
- Parakeet P1 and Qwen strict behavior;
- default-off CrispASR compile/release boundary.

No new protocol field or generic VAD abstraction is required. During R2 evidence, the canonical VAD model is a fixed sibling/task-local input, like existing development-only model assets. Downstream tasks decide delivery only if an algorithm is accepted.

## 4. Minimal code surface

Expected product files:

```text
native-asr/src/crispasr_backend.hpp
native-asr/src/crispasr_backend.cpp
native-asr/src/parakeet_family_policy.hpp
native-asr/src/parakeet_family_policy.cpp
native-asr/src/main.cpp
native-asr/tests/crispasr_backend_tests.cpp
native-asr/tests/parakeet_family_policy_tests.cpp
native-asr/tests/fake_crispasr_abi.cpp
native-asr/tests/crispasr_worker_contract_tests.cpp
native-asr/CMakeLists.txt                 # only if test/evidence wiring requires it
src-tauri/src/asr_worker.rs              # test-only only if existing real-host seam is insufficient
```

Task-local evidence files stay under this task's `research/`; binaries, models, media, raw JSON and stderr stay under ignored `research/local/`.

Do not add a `VadProvider` interface, factory, new backend class or third-party segmentation dependency.

## 5. Backend VAD seam

Bind the two existing pinned C ABI functions only:

```cpp
crispasr_vad_slices(...)
crispasr_vad_free(...)
```

Add a narrow concrete method, exact name subject to local style:

```cpp
std::vector<AudioWindow> CrispAsrBackend::detect_reazon_vad_windows(
    const std::filesystem::path& vad_model_path);
```

Contract:

- only valid for `Engine::ReazonSpeechNemo`;
- VAD model must be regular, non-empty and match the frozen identity before inference;
- operate on backend-owned verified 16 kHz mono samples;
- use the frozen primary constants, not user-tunable product knobs;
- convert returned seconds to integer millisecond windows once, using the pinned runner's deterministic rounding rule;
- reject non-finite, empty, reversed, out-of-order or out-of-audio spans;
- require strictly increasing starts and ends; permit silence gaps and do not require full audio coverage;
- permit overlap only between adjacent windows, only up to the direct ABI's native final-padding bound of `60ms`; reject non-adjacent or greater overlap;
- bind `12000ms` as the unpadded VAD/rechunk core cap and reject every returned padded inference window above `12060ms` / `192960` samples;
- free returned spans exactly once on all exits;
- missing/size/hash-invalid VAD assets fail with stable pre-call errors; ABI-declared failures use their documented return semantics; any empty result whose cause cannot be distinguished reliably is reported through one conservative stable fail-closed code, never by parsing stderr or guessing;
- no VAD failure falls back to R1 fixed windows.

`transcribe_window` remains the inference call. Before every call, clear inherited `CRISPASR_PARAKEET_*`, set `CRISPASR_PARAKEET_STREAM_THRESHOLD=13`, set `CRISPASR_SESSION_UNIFIED_DISPATCH=0`, and reject windows above `192960` samples. In the pinned legacy inline session branch, every legal R2 window necessarily selects direct `parakeet_transcribe_ex`; null returns fail without reactive streamed fallback.

## 6. Reazon policy seam

Keep Parakeet P1 validation unchanged. Split the common window validation by engine:

- Parakeet continues to require contiguous full-audio R1 windows.
- Reazon R2 accepts ordered speech windows with gaps and only bounded adjacent ABI-native padding overlap (`<=60ms`).

For each Reazon VAD window:

1. require exactly one source segment;
2. require non-empty valid UTF-8 text;
3. require source timing strictly positive and fully within the padded VAD window/audio; final cue starts must be nondecreasing, while cue ranges may inherit the same bounded adjacent overlap;
4. require cue text `<=96` Unicode scalar values;
5. require cue duration `<=15000ms` (automatically expected from the 12-second slice, still checked);
6. append exactly the source text without normalization or repair.

The concatenated final cue text must equal the concatenated selected source text byte-for-byte. Zero VAD windows or zero final cues fail closed.

The official Reazon subword decoder is not used in primary. If VAD slices produce an over-cap cue or poor readability despite improved inference, that is evidence for a separately reviewed model-specific segmentation candidate.

## 7. Worker flow

Reazon primary worker path:

1. validate route/device/model roles and the fixed VAD asset;
2. construct one `CrispAsrBackend`;
3. emit `ready`;
4. call `detect_reazon_vad_windows`;
5. sequentially call `transcribe_window` for each window;
6. emit worker-owned monotonic progress at each completed slice endpoint, without raw preview segments;
7. run Reazon policy;
8. validate/serialize one complete `segmentsReplace` through the existing `Emitter`;
9. emit replacement and `completed`.

Any VAD/backend/policy/protocol failure after `ready` emits one structured `error`; no `segment` or `segmentsReplace` has been accepted before it.

Parakeet and Qwen stay on their current paths. `useVad` product semantics are not expanded in R2: the candidate's VAD is a frozen algorithm input for evidence, not a new UI/configuration behavior.

## 8. Evidence flow

```text
ignored raw worker rows
  -> reviewed raw index (size/hash/role only)
  -> publisher identity validation
  -> shared T01 recomputation
  -> per-case metrics + absolute gates
  -> R1-relative comparison
  -> deterministic JSON/Markdown/handoff
```

Candidate identity binds at least:

- R1 publication identity used for relative thresholds;
- manifest/comparator/audio case identities;
- CrispASR source/submodules/runtime DLL;
- worker/runner and policy source/config;
- Reazon Q8_0 model;
- Silero VAD model and VAD constants;
- CUDA device/driver/loaded modules/restricted PATH;
- cue caps, protocol limits and candidate ID;
- every raw attempt hash.

Formal sampling remains R1-compatible:

- short-v1: one cold + three warm fresh processes;
- medium-v1: one fresh measured process;
- long-v2: one fresh measured process;
- all cases run under one frozen identity despite earlier quality failures.

A structured partial failure publishes attempted-through duration/time only, never full-case RTF.

## 9. Result model

Publication adds a comparison object without weakening existing qualification:

```json
{
  "qualityDisposition": "qualified | stop-revise",
  "relativeSelection": "better-than-r1 | no-material-improvement",
  "relativeReasons": ["long_completed", "medium_gap_reduction"]
}
```

Absolute gates remain authoritative for `qualified`. Relative reasons are recomputed from immutable R1/R2 metrics and cannot be caller-supplied promotion labels.

A candidate may therefore truthfully be:

- `qualified + better-than-r1` — accepted algorithm input;
- `stop-revise + better-than-r1` — preferred development basis only;
- `stop-revise + no-material-improvement` — discard/return to planning.

`qualified + no-material-improvement` should be impossible against the failed R1 baseline and must be rejected by the publisher as inconsistent.

## 10. Validation design

### Pure/backend tests

- VAD success, no speech, missing/corrupt model, negative/reversed/out-of-audio/non-finite spans, monotonic starts/ends, exact 12-second core / 12.06-second padded bounds, adjacent 60ms boundary, greater/non-adjacent overlap and final short slice;
- returned span exact-once free, callback reset/result free/session close;
- same session handles multiple non-contiguous windows;
- Reazon ordered gapped windows pass; Parakeet gapped windows still fail;
- one/multiple/zero source segments, zero duration, invalid UTF-8, 97 code points, 15001ms, text conservation failure;
- Parakeet P1 vectors unchanged.

### Worker/host tests

- no raw previews;
- monotonic progress with silence gaps;
- exactly one replacement then completed;
- VAD/backend/policy failure after ready leaves zero accepted output;
- cancellation before final replacement leaves zero recovery segments and reaps process tree;
- existing Parakeet, Qwen, VAD rejection/default-off and CT2 lanes remain unchanged except the explicitly selected Reazon evidence lane.

### Publisher tests

Reject mutations to:

- R1 baseline/thresholds;
- VAD asset/config/window count/timing;
- model/runtime/worker/device/modules/PATH;
- case/audio/raw hashes;
- CER/gap/timeline/cue/performance metrics;
- completion/failure status;
- absolute disposition, relative selection or relative reasons;
- partial/full RTF labeling;
- privacy and deterministic ordering.

## 11. Rollback

- Oracle fails: delete task-local probe artifacts; no product code exists.
- VAD seam fails: remove the two ABI bindings/method and restore current R1-disabled behavior.
- Policy/worker fails: restore the existing contiguous R1 branch; no route was enabled.
- Evidence identity drifts: invalidate only R2 rows and rerun; keep T10 R1 immutable.
- Primary is better but not qualified: retain sanitized evidence/selection only; do not package VAD or enable route.
- Primary is not better: discard it and return to planning before any secondary candidate.

## 12. Trade-offs

- **VAD first, not F16:** directly addresses arbitrary boundaries and silence windows while preserving the recommended Q8_0 identity.
- **One cue per VAD slice:** smallest truthful subtitle policy; official subword segmentation waits for evidence that it is needed.
- **No engineered overlap:** maintained VAD/energy cuts still avoid fixed-overlap ownership/dedup logic. The only accepted overlap is the pinned direct ABI's own final `30ms` edge padding, bounded to adjacent `60ms`, and it is left visible rather than rewritten.
- **Relative selection separate from qualification:** honors the user's willingness to retain improvements without silently weakening release gates.
