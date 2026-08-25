# ASR Quality Guidelines

## Verification

```bash
cd asr-service
python -m unittest discover tests
```

Representative tests:

- `tests/test_jobs.py` — job manager behavior
- `tests/test_faster_whisper_model_cache.py` — cache readiness
- `tests/test_kotoba_faster_whisper.py` — version gate + preprocessor requirement
- `tests/test_vad.py`, `tests/test_chunking.py`, `tests/test_diagnostics.py`
- Optional engine suites: `test_parakeet.py`, `test_qwen3_asr_engine.py` (may need deps)

When optional engines or models are absent, report that limitation instead of claiming full coverage.

## Standards

- Engines stay behind `AsrEngine` + registry
- HTTP aliases stay aligned with frontend types
- Diagnostics are opt-in via env; keep default runs quiet
- Prefer small, focused unittest modules mirroring engines/helpers

## Scenario: Ground-Truth ASR Comparison

### 1. Scope / Trigger

Use this contract whenever a Python or native ASR candidate is measured for migration feasibility. User-provided `.asr-benchmark` WAV+ASS pairs remain the only text, speech-region, and timeline truth. The authoritative model-level handoff in `.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json` establishes a scoped subtitle-quality non-regression gate only for complete, identity-bound `python-legacy-cuda-v1` rows; Python output never creates or repairs reference annotations. Future native model qualification uses the user-approved `native-gpu-authoritative-v1` profile: only the frozen GPU candidate runs model-backed quality/performance matrices, and a matching CPU route inherits that disposition without a CPU model-backed rerun.

### 2. Signatures

```bash
python scripts/asr-benchmark.py validate --manifest <manifest> --corpus-root <root>
<development-python> scripts/asr-benchmark.py run --manifest <manifest> --corpus-root <root> --expected-interpreter <development-python> --hf-home <cache> --case <case-id> --engine <engine> --model <model> --device <cpu|cuda|auto> --output <ignored-json>
python scripts/asr-benchmark.py report --results <ignored-results> --output <markdown>
```

T02/T03 and later native harnesses consume or adapt the versioned `hikaru-asr-benchmark-result` envelope; they must not copy CER, P95, speech-gap, refresh, or report algorithms.

Pinned CrispASR CPU evidence uses the public session/alignment ABI:

```text
crispasr_session_open_with_params(..., use_gpu=0, n_gpu_layers=0, ...)
crispasr_session_set_progress_callback / set_segment_callback / set_token_callback
crispasr_session_transcribe*
crispasr_session_result_* / crispasr_align_words_abi
crispasr_session_result_free / crispasr_alignment_result_free / crispasr_session_close
```

Use the exact signatures and ABI version from the locked headers; the names above define the historical T03 proof surface, not a wrapper API or a requirement that every later backend bind every callback. T09's shared backend binds exactly progress and segment callbacks, never the token callback, and derives reset counts from the successfully registered setters.

### 3. Contracts

- Manifest case keys are safe relative WAV/ASS paths plus hashes, WAV shape, duration class, Dialogue count, positive per-case coverage tags, source/license/authorization, and `ass-dialogue-v1` derivation metadata. Inline reference text/segments are forbidden.
- Validation parses ASS locally and derives private reference text/segments/speech intervals in memory. Tracked reports contain only stable IDs, hashes, aggregate metrics, coverage, and limitations.
- `TranscriptSegmentRefresh` replaces the complete preview list before scoring for every engine.
- Native Whisper evidence distinguishes the supplied source slice from the padded model timestamp range. A 15-second seek slice may still use the model's 30-second timestamp-token range; record both `sourceWindowDurationMs` and `modelWindowDurationMs` per trace.
- A token-derived end inside the model range may be bounded to the verified WAV end only when raw evidence retains the original end, final end, token IDs, trace hash, and an explicit bound flag. A segment starting at/after WAV end still fails. Do not use bounding to repair missing speech.
- Native evidence records immutable model file sizes/SHA-256, input-lock SHA-256, executable SHA-256, environment, and ignored raw/result hashes. Raw transcripts/traces may be written only below the exact canonical task-local ignored root; substring path checks are insufficient.
- Separate model-backed **discovery**, **candidate acquisition**, and **qualification**. Discovery is ignored-local, `qualificationEligible=false`, records actual loaded model/runtime contracts, and may never be promoted. Expected lazy-loaded modules, model feature shape, or other values observable only after model construction/generation must be learned from discovery before a candidate lock freezes them; do not guess them from sibling files or no-model smoke. Acquisition uses a frozen identity only after discovery has proved the command reaches its intended model boundary. Qualification begins only after a causal candidate already exists.
- Native ordinary Whisper reads `n_mels` from the loaded CT2 model and supports exactly the official 80- and 128-mel shapes. Every feature producer and precomputed-Mel probe must derive its shape from that exact model identity; a default `FeatureExtractor` size is not authority. Large-v3 snapshots exposing `n_mels == 128` require exact `128 × 3000` inputs, while 80-mel hashes are invalid for that model even when numerically well formed. Ordinary snapshots accept either `vocabulary.txt` or `vocabulary.json`; `preprocessor_config.json` remains Kotoba-only for product readiness, but a pinned ordinary model's feature metadata may corroborate the loaded `n_mels` contract. The native Kotoba profile requires a non-empty preprocessor file plus loaded `n_mels == 128`, uses a maximum 15-second source window with the 30-second model/timestamp range, beam 5, no previous-text history, and timestamp-driven seek. Kotoba `useVad=true` fails before `ready` until a separately reviewed candidate exists.
- On Windows, the Rust host may supply a canonical `\\?\` model path. CTranslate2 4.8.0 cannot open that spelling directly: the worker removes only the extended-path prefix at the CT2 boundary and passes UTF-8 bytes (`u8string()`), while the host remains responsible for canonical managed-root validation.
- CT2 model-backed builds verify the pinned clean source commit plus required CT2/oneDNN/pocketfft file identities and build the tokenizer with `cargo --locked --offline`. Protocol/fake-worker-only builds disable the model backend explicitly rather than requiring local inference inputs.
- One shared native identity validator must cover every completed, failed, derived, and negative record before scoring or publication. It binds manifest/case/audio, lock, executable, required DLLs, route model/aligner, CPU/GPU params, loaded modules, and restricted-PATH policy. Never merge rows from different executable/DLL/lock identities into one evidence set.
- CrispASR CPU claims require public CPU-forced open params plus actual loaded-module inventory under a restricted PATH; DLL filenames alone do not prove which backend ran.
- CrispASR callback contexts are reset on every success/error exit before destruction. Result/alignment/session cleanup evidence records created/free/close counts and derives exact-once status from those counts; do not publish a hard-coded boolean.
- Qwen3 raw CJK character ranges are not subtitle segments. Preserve them, tokenize/group with the exact pinned upstream ranges and source-segment semantics, and accept only legal ForcedAligner-derived grouped segments. For T09 capability evidence only, unchanged raw ranges require only `0 <= start <= end` and have no audio-end upper bound; do not clip or promote them to accepted timing, and publish the maximum tail overrun as a diagnostic risk. Session getter sentinel timing remains explicitly ineligible. A zero-duration final group fails closed; it is not repaired by synthetic expansion.
- Native top-level segments and nested word timing are separate capabilities. Report both distributions. One broad top-level segment can mathematically hide confirmed gaps but does not prove subtitle-scale segmentation readiness.
- Controlled failed evidence retains the failing trace and source/model bounds. Validators reject empty placeholder traces, and the benchmark adapter must refuse failed evidence. An externally terminated long run with no atomic token result is process evidence only: write a sanitized record below the exact task-local ignored root that binds the lock, executable/runtime identity, timeout duration, termination source/status, `atomicOutputPresent=false`, `modelMetricsRetained=false`, `processRemaining=false`, and `scoringEligible=false`; freeze that record's SHA-256 in tracked reproduction evidence. Never reconstruct missing model metrics or merge the process record into completed rows.
- A sanitized publisher must recompute CER/timeline/gaps from the authoritative manifest/ASS through the shared T01 implementation; it must not trust mutable pre-adapted metric fields. Any inference source/config/binary/DLL/model identity change invalidates affected measurements and requires rerunning them before publication.
- A historical-evidence reinterpretation lock must freeze the exact candidate inventory and unique path/hash set, including logical model/candidate/mapping identity, prior and independent-gate dispositions, canonical ignored root, publication/source role cardinality, and every tracked/raw artifact hash. Each schema adapter must additionally validate the frozen sample run role/repeat index, engine/backend/device/algorithm, model/companion, worker/runtime/input lock, completed/failed status, and any reviewed failure fingerprint before scoring. A hash-valid file or editable lock label alone is insufficient authority.
- When an authoritative reference identity changes, inventory every backend and result family that consumed the superseded identity, including completed, failed, diagnostic, derived, and currently inactive routes. Preserve historical artifacts, then publish an identity-bound supersession or an explicit validated-unscored disposition for every authoritative row before any parent/spec/handoff may claim the migration uses the new reference. Correcting only the currently active backend is incomplete.
- Missing confirmed-speech regions are semantic and gating by default. A region is diagnostic-only when every overlapping reference cue, after NFKC normalization and removal of whitespace, Unicode punctuation/symbols, and `ー` / `〜` / `~`, is exactly 1..6 repeats of one unit from `あ`, `う`, `え`, `お`, `ん`, `うん`, or `うあ`. Excluded regions remain in CER and publish separately; `はい`, laughter, mixed/lexical cues, and unknown forms remain semantic.
- Every model candidate whose authoritative corpus is short-v1 / medium-v1 / long-v2 must complete all three cases under one frozen inference identity before quality disposition, even when an earlier case fails CER, timeline, semantic-gap, performance, resource, subtitle-size, or protocol-output gates. A quality failure is recorded and the matrix continues. Identity/input/runtime attestation drift, harness corruption, or an incomplete trace makes a row invalid and requires repair plus rerun of the affected case. By contrast, an identity-valid, candidate-caused structured failure with a complete trace—such as deterministic model load/compute rejection or a measured resource-limit failure—is valid failed evidence, counts as that case's attempted matrix row, and yields a non-qualified disposition without authorizing later-case truncation. External termination without atomic output remains unscored and must be rerun. Only the complete matrix may publish `accepted-*-algorithm-input`, `qualified`, `stop-revise`, or `unsupported-for-native-release`. A later candidate requires a newly reviewed identity that addresses the complete observed failure distribution. This full-matrix rule applies to T10 and all later model tasks; it does not retroactively alter archived evidence or require unrelated model identities to run in one combined candidate.
- Native subtitle-quality qualification is per `logicalModelIdentity × case × comparisonProfile` under `native-gpu-authoritative-v1`: CER and S/D/I, empty text, semantic confirmed-speech gaps, and eligible Qwen3 ForcedAligner median/P95 must each be no worse than the matching `python-legacy-cuda-v1` row. No average, family-only match, cross-model row, missing row, or ineligible timing provenance may authorize release. Historical absolute CER/gap/Qwen limits remain diagnostics rather than the new subtitle-quality release decision.
- Only an exact, frozen GPU candidate identity acquires model-backed qualification evidence. The matching CPU route does not run CER/S/D/I, RTF, wall, RSS, or model-output qualification samples; after the GPU candidate passes, CPU records `qualificationSource=inherited-from-gpu` with the same logical model and algorithm/config identity. It must leave CPU measurement fields absent and must never copy GPU values into CPU fields. A GPU failure, drift, missing row, or non-qualified pack leaves both GPU and inherited CPU routes non-qualified.
- Frozen GPU non-quality and structural gates remain absolute: accelerated inference RTF `<=0.5`; short cold wall `<=120s`; peak process RSS `<=6 GiB` for CTranslate2 or `<=12 GiB` for CrispASR; zero invalid/out-of-bounds/negative/reversed/zero-duration timeline segments; valid UTF-8, text conservation, subtitle/protocol legality, complete matrix coverage, and all GPU identity/process/path/privacy/license/cancellation/recovery contracts. No VRAM gate is defined, and Python measurements never relax these gates. CPU compilation, protocol, packaging, path, and non-model smoke tests remain required by their owning tasks, but they do not produce an independent model qualification disposition.
- Python legacy never establishes expected output, relative performance/resource gates, or missing annotations. Missing, invalid, identity-drifted, or provenance-ineligible baseline evidence yields `baseline-incomplete` or `unscored`, never qualification.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| WAV/ASS hash or declared shape differs | Reject the manifest case |
| Absolute/escaping path or unsupported manifest field | Reject before reading candidate output |
| Inline reference or inferred speech interval | Reject; derive only from the local ASS |
| Raw result path inside Git tree is not ignored | Refuse to write |
| Python runner uses the wrong interpreter/cache | Reject as invalid evidence |
| Qwen3 provenance is synthetic/mixed/unknown/generic engine-native | Record timing as ineligible |
| Whisper trace uses a shorter source slice than its padded model tensor | Validate tokens against the model range; record both ranges |
| Token-derived end exceeds verified WAV end but stays inside model range | Preserve raw end and explicitly bound final end to WAV duration |
| Token-derived start is at/after WAV end | Fail the candidate sample |
| Raw output path is outside the canonical task-local ignored root | Reject before model/audio access |
| Input lock, model hashes, executable/DLL identity, CPU params, loaded modules, or PATH policy differs | Reject or classify as a separate evidence set |
| A discovery lane is supplied as candidate/qualification evidence | Reject promotion; discovery records actual dynamic contracts only |
| A candidate lock freezes a model-loaded fact that was never observed by discovery | Reject acquisition readiness; run one bounded unscored discovery instead of creating a lock-version repair chain |
| Precomputed Whisper Mel shape differs from the exact loaded model `n_mels` | Reject before encode/generate; invalidate that feature authority and do not resize or substitute the tensor in place |
| Derived or negative record bypasses the shared identity validator | Reject publication even when its status/timeline looks valid |
| A CPU model-backed qualification row is supplied or GPU metrics are copied into CPU fields | Reject publication; CPU may only carry `qualificationSource=inherited-from-gpu` plus the exact matching GPU candidate reference |
| Qwen raw character range is zero-duration or ends after audio while remaining non-negative/non-reversed | Retain unchanged as raw provenance only, publish maximum tail overrun, and validate accepted timing only after exact pinned source-segment grouping |
| Qwen raw character range is negative or reversed | Reject capability evidence |
| Qwen grouped final segment is zero-duration or session-native/synthetic | Fail closed with zero accepted timeline |
| Callback context exits without all registered callbacks reset | Reject lifecycle evidence |
| Created result/alignment/session count does not match free/close count | Reject exact-once claim |
| Failed envelope has no complete matching trace | Reject the evidence; do not summarize it as a blocker |
| Long model process hits an external timeout before atomic raw publication | Write and hash a separate ignored-local sanitized process record with frozen lock/runtime/timeout/termination identity and explicit no-output/no-metrics/no-process/no-scoring flags; do not invent token traces or merge with completed rows |
| Final CT2 source/config/binary identity differs from measured rows | Invalidate and rerun the affected minimum authoritative cases before publication |
| One case fails a mandatory quality gate | Record the failure, continue the same model candidate through the remaining short/medium/long-v2 cases, then publish the complete-matrix disposition |
| Identity/input/runtime attestation drifts, harness output is corrupt, or the failure trace is incomplete | Invalid evidence; repair and rerun that case before any quality disposition |
| Frozen identity produces a structured candidate-caused load/compute/resource failure with a complete trace | Count a valid failed row for that case, continue the remaining cases, and publish a non-qualified complete-matrix disposition |
| Historical reinterpretation lock changes a candidate disposition/root/role cardinality/path count, or an adapter sees a different run role/repeat/backend/device/companion/failure fingerprint | Reject before metric recomputation even when every referenced file hash still matches |
| Ordinary CT2 model exposes neither 80 nor 128 mels, or lacks both vocabulary formats | Reject as model contract mismatch; do not apply Kotoba readiness rules to repair it |
| Coverage tag is absent or unconfirmed | Leave it absent and report the corpus-wide gap |

### 5. Good / Base / Bad Cases

- **Good:** a frozen GPU candidate uses the validated manifest identity, one exact lock/binary/DLL/model evidence set, shared recomputed metrics, and the matching model/case `python-legacy-cuda-v1` quality row; every relative field is reported independently while structural, performance, security and evidence gates remain absolute. A matching CPU route records only `inherited-from-gpu` and the source GPU identity, with no fabricated CPU measurements.
- **Base:** a required Python row or eligible Qwen timing provenance is missing, an engine returns one broad legal segment, or a mandatory GPU long run times out before atomic publication; comparison reports `baseline-incomplete`/`unscored` or the independent structural limitation and does not qualify either GPU or inherited CPU.
- **Bad:** regenerate reference text from a Python transcript, trust editable adapted metrics without recomputation, use a family/cross-model/missing Python row, average cases to hide one failing metric, use Python performance to waive an absolute gate, stop a model candidate after the first quality failure instead of completing its frozen audio matrix, acquire a CPU model-output row as a qualification substitute, copy GPU metrics into CPU fields, add VAD without a new reviewed identity, treat runtime feasibility or one broad segment as subtitle readiness, publish derived/negative records without identity validation, treat Qwen character ranges as final cues, use a source-slice duration as the model timestamp range, or commit private media/raw results.

### 6. Tests Required

```bash
python scripts/asr-benchmark.py self-check
python scripts/asr-benchmark.py validate --manifest asr-service/benchmarks/corpus.example.json
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
cd asr-service && python -m unittest discover tests
```

Assert ASS fail-closed parsing, exact S/D/I CER counts, timing provenance, per-case coverage union, refresh replacement, deterministic sanitized Markdown, ignored raw outputs, and path/privacy rejection. Historical reinterpretation publishers additionally mutation-test candidate dispositions, ignored roots, publication/source roles, exact unique path/hash counts, sample run roles/repeat indices, backend/device/algorithm/companion identity, completed/failed state, and reviewed failure fingerprints. Gap tests must cover approved punctuation/elongation/repetition forms, `はい`, laughter, mixed lexical cues, multiple overlapping cues, CER retention, and deterministic separate semantic/excluded diagnostics. Native Whisper harnesses additionally assert distinct source/model windows, verified-WAV end bounding with raw provenance, start-after-audio failure, exact model/lock/binary identity, canonical output containment, and complete failed-trace validation.

Native CTranslate2 production harnesses additionally assert:

- official 80- and 128-mel goldens, exact model-derived feature shape for every precomputed-Mel path, large-v3 128-mel rejection of 80-mel input before encode, both ordinary vocabulary formats, and no ordinary preprocessor readiness requirement;
- one model-backed discovery smoke reaches the intended model boundary before any reviewer may call a dynamic-contract acquisition identity ready; no-model ABI, mutation and lock tests alone are insufficient;
- timestamp-driven seek, leading silence, final partial windows, consecutive timestamps, source-end bounding and start-after-audio rejection;
- pinned clean CT2/oneDNN/pocketfft identities, offline locked tokenizer build, and a protocol-only configure with the CT2 backend disabled;
- Rust-host real-worker success, structured pre-ready failure/recovery and process-tree cancellation through test-only env injection;
- publisher mutation rejection for model/runtime/config/metrics/timeout identities and byte-identical regenerated output.

Native CrispASR harnesses additionally assert:

- a default-off shared backend compile gate, exact pinned runtime DLL identity before load, explicit `parakeet|reazonspeech-nemo -> parakeet` and `qwen3-asr -> qwen3` mapping, and no filename-inferred route;
- exactly progress/segment callback registration with reset before result/alignment/session release on every structured exit; hard cancellation proves process reap only, never in-process destructor counters;
- Qwen copies source results plus raw ForcedAligner entries but emits zero accepted timed output and stable post-ready `qwen_timeline_policy_not_implemented` until the separately reviewed grouping policy exists;
- mutation rejection for case/audio/manifest/lock/executable/DLL/model/aligner/CPU params/modules/PATH across completed, failed, derived, and negative records;
- exact pinned CJK punctuation/mixed-script token counts and source-segment grouping;
- Qwen session getter timing is ineligible and all accepted timing is ForcedAligner-derived;
- real missing/corrupt/unloadable/empty/malformed/invalid-audio negatives accept zero timed output;
- callback reset on success and error, plus created/free/close count-derived exact-once cleanup;
- short cold + three warm samples, medium/long attempts or complete failed evidence, single final evidence identity, and byte-identical sanitized publication;
- family-scoped development-device results never cross-authorize: T09 published `parakeet-family: development-gpu-ready` from both paired speed samples, while copied-result invalidity is no-result and must never be promoted to GPU unavailable.

### 7. Wrong vs Correct

```text
Wrong: run or synthesize a CPU quality/performance row after the matching GPU candidate passes, or copy GPU values into CPU measurement fields.
Correct: publish the exact GPU evidence once; bind the CPU route to that candidate with `qualificationSource=inherited-from-gpu` and leave CPU measurement fields absent.

Wrong: native passes because its family average is near Python, because it borrows another model's row, because Python performance is slow, or because one broad segment covers the whole speech interval.
Correct: native GPU subtitle quality passes only when every applicable metric is no worse than the same logical model and case under `python-legacy-cuda-v1`; the GPU candidate must also independently pass the frozen structural, performance/resource, identity, protocol, path, cancellation/recovery, privacy and license gates against validated WAV+ASS truth.

Wrong: after short-v1 fails CER/RTF, stop that model candidate and infer that medium/long-v2 would add no evidence.
Correct: keep the candidate identity frozen, complete medium-v1 and long-v2, publish the full per-case failure distribution, then activate a new candidate only when it addresses that complete profile.

Wrong: use every Qwen aligner character range as a cue, expand zero-duration ranges, or publish session getter sentinel timing.
Correct: retain raw ranges, reproduce the exact pinned upstream source grouping, accept only legal ForcedAligner-derived final segments, and fail closed otherwise.

Wrong: verify only the files and hashes named by an editable historical lock, then trust its candidate disposition, ignored root, sample roles, or companion labels.
Correct: freeze and validate the complete lock inventory plus adapter-level run/backend/device/model/companion/failure identity before shared-T01 recomputation.
```

## Scenario: Native CrispASR Parakeet-Family Window Policy

### 1. Scope / Trigger

Use this contract when `parakeet` or `reazonspeech-nemo` is evaluated above the shared CrispASR backend. T10's reviewed R1/P1 identities are both `stop-revise`; this scenario preserves their executable safety/evidence contracts for any later R2/P2. It does not enable Release/default routing, VAD, a formal GPU pack, or Qwen grouping.

### 2. Signatures

```cpp
struct AudioWindow { std::int64_t start_ms; std::int64_t end_ms; };
Result CrispAsrBackend::transcribe_window(
    AudioWindow window,
    const ProgressCallback& on_progress = {},
    const SegmentCallback& on_segment = {});

namespace parakeet_family {
inline constexpr std::int64_t window_duration_ms = 15'000;
inline constexpr std::size_t max_cue_code_points = 96;
inline constexpr std::int64_t max_cue_duration_ms = 15'000;
PolicyResult assemble_segments(
    Engine engine,
    const std::vector<WindowResult>& windows,
    std::int64_t audio_duration_ms);
}
```

The worker keeps protocol v1 and emits `ready -> progress* -> segmentsReplace -> completed`, or `ready -> progress* -> error`. It never emits Parakeet-family raw upstream `segment` previews.

### 3. Contracts

- Reuse one pinned session sequentially. Each exact 16 kHz PCM window owns one result; callbacks reset and the result frees before the next call. `transcribe()` remains the whole-audio thin wrapper.
- Native result timing is window-local. The backend adds the window start exactly once, then rejects overflow, negative/reversed/zero top-level timing, or ranges outside the real window/audio. Never clamp, stretch, or proportionally synthesize timing.
- Register the upstream segment callback for lifecycle compatibility, but copy/validate preview values only when the caller explicitly supplies `on_segment`. Product worker/evidence calls omit it because preview is not accepted state.
- Frozen R1/P1 windows are contiguous `[0,15000) ...`, non-overlapping, and cover the audio. Every window supplies exactly one source segment. Reazon uses its legal top-level timing; Parakeet uses positive-duration word anchors and deterministic zero-duration text attachment without creating timing.
- Final text is byte-conserved, valid UTF-8, non-empty, ordered, audio-bounded, at most 96 Unicode scalar values and 15000 ms per cue. Protocol v1's existing Emitter remains authoritative for text bytes, segment count, and event-line bytes.
- Accumulate all windows before emitting one atomic `segmentsReplace`. Cancellation or any backend/policy/protocol failure before it leaves zero accepted output/recovery segments.
- Evidence freezes manifest/comparator/input lock/runner/worker/runtime/model/candidate/device/PATH/modules/raw hashes. A partial structured failure publishes attempted duration/time only; it must not be labeled with full-case RTF. Both engines publish independent dispositions.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Window is empty, reversed, out of audio, or sample offset overflows | Stable backend error; no accepted output |
| Window-local source/word timing is invalid or translates outside the window | Reject; no clamp or synthetic duration |
| Unrequested raw preview is malformed | Ignore it as ineligible observation; validate the copied final result |
| R1 top-level range is zero-duration, or P1 has no legal anchor/text conservation | Stable policy/backend failure; zero final segments |
| Cue exceeds 96 scalars / 15000 ms, replacement exceeds protocol limits | Fail closed before emitting replacement |
| A frozen case returns identity-valid structured failure with complete trace | Keep the failed row, continue remaining matrix cases, publish non-qualified disposition |
| Manifest/comparator/binary/model/device/PATH/module/raw identity drifts | Evidence invalid; rerun affected cases |
| Failure occurs before full audio is attempted | Publish attempted-through duration/RTF only, never full-case RTF |

### 5. Good / Base / Bad Cases

- **Good:** one frozen identity completes or validly fails all short/medium/long-v2 rows; publisher recomputes shared metrics, proves text/cue/protocol constraints, and emits sanitized independent results.
- **Base:** a candidate completes some cases but a later native range or policy contract fails with a complete trace; publish `stop-revise`, keep the other engine independent, and leave routes disabled.
- **Bad:** persist giant previews, distribute text proportionally over time, clamp a zero-duration range, mix binaries across cases, report a partial attempt as full-case performance, or promote one engine because the paired engine passed.

### 6. Tests Required

- Pure policy CTest: contiguous/final windows, UTF-8/scalar count, 96/15000 boundaries, Reazon top-level-only timing, Parakeet positive/zero anchor ownership, ordering/bounds, text conservation, empty output.
- Fake ABI/backend: repeated calls on one session, per-call callback reset/result free, window offset exactly once, later-window failures, ignored unrequested previews, exact-once session close.
- Worker contract: no raw preview, monotonic progress, exactly one replacement then completed, post-ready policy error with zero output, protocol text/count/event-line rejection, unchanged Qwen/VAD/Vulkan/default-off behavior.
- Real Rust host: atomic replacement/recovery/ASS success, post-ready policy failure with zero segments, cancellation/reap within two seconds and zero accepted partial output.
- Publisher: frozen identity/privacy/window/module/PATH/error mutations, result-promotion rejection, shared comparator recomputation, partial-vs-full RTF labeling, and byte-identical double generation.

### 7. Wrong vs Correct

```text
Wrong: a callback preview is inside a 15-second request, so save it and repair its timing later.
Correct: previews are ineligible; validate only the copied final result and atomically emit policy-approved output.

Wrong: divide failed inference time by the full long-v2 duration and publish that as CUDA RTF.
Correct: publish attempted time and attempted-through duration; full-case RTF exists only after full inference coverage.
```

## Scenario: Native ReazonSpeech Pad30 VAD Windows

### 1. Scope / Trigger

Use this contract for ReazonSpeech candidates that call the pinned CrispASR VAD C ABI and then transcribe each returned speech window through one reused session. The reviewed R2 identity is `R2-vad12-pad30-overlap-top-level-v1`; it is a development candidate only and does not enable Release/default routing, VAD delivery, or a T14/T15 algorithm handoff.

### 2. Signatures

```cpp
std::vector<AudioWindow> CrispAsrBackend::detect_reazon_vad_windows(
    const std::filesystem::path& vad_model_path);

Result CrispAsrBackend::transcribe_window(AudioWindow window, ...);

inline constexpr std::int64_t reazon_vad_core_max_duration_ms = 12'000;
inline constexpr std::int64_t reazon_vad_padded_max_duration_ms = 12'060;
inline constexpr std::int64_t reazon_vad_max_adjacent_overlap_ms = 60;
```

Frozen inference environment:

```text
CRISPASR_SESSION_UNIFIED_DISPATCH=0
CRISPASR_PARAKEET_STREAM_THRESHOLD=13
```

Evidence publication emits independent `qualityDisposition` and `relativeSelection`; a failed row records actual attempted/completed window counts, `attemptedThroughMs`, partial-attempt timing, and a derived failure subtype/fingerprint.

### 3. Contracts

- Keep the pinned Q8_0 model/runtime, CUDA development device, Silero `30ms` speech pad, threshold `0.5`, minimum speech `250ms`, minimum silence `100ms`, and energy-minimum 12-second rechunking.
- `crispasr_vad_slices` applies final padding after rechunking. Convert each returned float endpoint to integer milliseconds exactly once, then derive the PCM offsets as `ms * 16`. Do not separately validate float-derived sample offsets: binary float noise can turn a legal `60ms` boundary into a spurious `961`-sample overlap.
- The unpadded core cap is `12000ms`; padded inference windows are `<=12060ms`. Starts and ends must strictly increase, ranges must stay inside audio, only adjacent ABI-native overlap `<=60ms` is legal, and non-adjacent overlap is rejected.
- Each legal padded window receives exactly one direct `parakeet_transcribe_ex` call on one session. Unified dispatch, streamed/reactive fallback, fixed windows, caller-created overlap, ownership rewriting, dedup, stitching and gap-fill are absent from this identity.
- Each window supplies exactly one legal top-level result. Preserve source text byte-for-byte; enforce UTF-8, nondecreasing cue starts, window/audio bounds, 96 Unicode scalars, 15000ms and protocol-v1 replacement limits.
- The worker emits no raw preview, accumulates all results, then emits one atomic `segmentsReplace` and `completed`. Every failure before replacement leaves zero accepted output.
- Raw source/result text, paths, audio, models, binaries and stderr remain under the canonical ignored task-local root. Tracked evidence contains only identities, hashes, aggregate metrics and sanitized failure provenance.
- Failure-code equality is not proof of the same failure class. Derive and bind the subtype, window index/range, local source range and result-trace hash. Relative selection may treat R1/R2 failures as the same class only when the reviewed subtype fingerprint matches the immutable authority.
- Formal performance uses full-case RTF only for completed coverage. A partial failure publishes `partial-attempt`, the exact `attemptedThroughMs`, and no full-case RTF.
- The reviewed result is `stop-revise + better-than-r1` from medium-v1 CER reduction. Long-v2 still fails on the same reviewed `zero_duration_top_level_result` class; short/medium retain semantic gaps. Therefore the route stays disabled and no accepted algorithm handoff exists.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| ABI float endpoint has sub-millisecond/sample noise | Round once to ms; derive actual inference samples from ms |
| Canonical window exceeds `12060ms`, adjacent overlap exceeds `60ms`, or any non-adjacent overlap exists | `crispasr_vad_result_invalid`; zero accepted output |
| VAD returns zero without distinguishable cause | Neutral `crispasr_vad_no_result`; never guess “no speech” |
| VAD asset is missing, wrong size or wrong hash | Stable pre-ready rejection |
| Source result is empty/multiple/invalid UTF-8/zero-duration/outside its window | Stable candidate failure before replacement |
| Replacement validation or serialization fails after `ready` | Emit exactly one structured `error`; no replacement/completed |
| Error code matches R1 but subtype/range/timing/trace fingerprint differs | New safety failure; suppress every relative reason |
| Candidate fails after 61 completed windows on the 62nd attempt | Record zero-based index `61`, `62 attempted / 61 completed`, and the real attempted frontier |
| Identity/harness/module/PATH/protocol trace is invalid or incomplete | Invalid evidence; repair and reacquire, never publish as candidate failure |

### 5. Good / Base / Bad Cases

- **Good:** one frozen identity completes the required `1 cold + 3 warm / 1 / 1` matrix; every row binds worker/runtime/model/VAD/device/PATH/modules/tools/raw hashes, source/final conservation and deterministic shared-T01 metrics.
- **Base:** long-v2 returns an identity-valid zero-duration top-level failure after partial coverage; publish the partial attempt truthfully, retain any valid R1-relative improvement, and keep the route disabled.
- **Bad:** reject a legal boundary from direct float-to-sample noise, call every `crispasr_result_invalid` the same failure class, synthesize a full-case RTF from partial coverage, or promote `better-than-r1` into release qualification.

### 6. Tests Required

- Backend/fake ABI: exact `[510970,522930] / [522870,533630]` boundary passes as `60ms`; `61ms`, `12061ms`, non-adjacent overlap, invalid asset, zero result and exact-once free/reset/session lifecycle fail correctly.
- Policy/worker: bounded overlap/gaps, one result per window, UTF-8/96/15000/text conservation, exact progress, no previews, one replacement, structured protocol failure and unchanged Parakeet/Qwen/default-off lanes.
- Rust host: separate R2-only required manifest lanes for success, pre-ready negative, post-ready VAD/protocol/policy and cancellation; exact recovery/ASS equality, reap, gate release and zero partial output.
- Publisher: complete role matrix, raw/source/final hashes, ms/sample window derivation, path/reparse containment, module/device/PATH identity, partial/full RTF, subtype/fingerprint mutation rejection, result-promotion rejection and byte-identical double publication.
- Required validation includes protocol-only, CT2 CPU, CT2 CUDA development, task-local R2 CTest, full Rust/release check, frontend tests/build, benchmark self-check/tests, privacy/ignore/task/diff/no-staged checks.

### 7. Wrong vs Correct

```text
Wrong: ABI floats imply a 961-sample overlap, so reject the window before inference.
Correct: convert ABI endpoints to canonical milliseconds once; the actual inference windows overlap by 60ms / 960 samples.

Wrong: R1 and R2 both emitted crispasr_result_invalid, so the failure class is unchanged.
Correct: derive and bind zero_duration_top_level_result plus its window/local timing and trace fingerprint before applying the R1-relative rule.
```

## Scenario: Native Kotoba Bounded-Stride Overlap

### 1. Scope / Trigger

Use this contract for the accepted native Kotoba algorithm identity `kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1`. It applies only to `kotoba-faster-whisper -> ctranslate2`; ordinary faster-whisper, protocol v1, the Tauri host, Python legacy/default routing, downloader, package, and UI remain unchanged.

### 2. Signatures

```cpp
struct CandidateAConfig {
  int max_source_frames = 3000;
  int max_applied_seek_frames = 0;
};

CandidateAConfig kotoba_k2_config();  // 1500 source, 1000 max applied
std::int64_t kotoba_k2_applied_seek_frames(
    std::int64_t proposed,
    std::int64_t remaining,
    std::int64_t maximum);
std::int64_t kotoba_k2_owner_window_index(
    const std::vector<std::int64_t>& window_starts_ms,
    std::int64_t segment_start_ms);
```

Ignored K2 raw traces include candidate/ownership identity, parsed/proposed/applied advances, source overlap, ownership interval, progress frontier, count conservation, per-parsed-segment exact tuple/trace hashes, resolved owner index, and `emitted|non-owner|exact-duplicate` disposition.

### 3. Contracts

- Keep Kotoba's 1500-frame source window, padded 3000-frame model/timestamp range, Japanese prompt, beam 5, temperature 0, no previous-text history, no VAD, and reviewed CUDA device-0/FLOAT16 identity.
- Speech proposed advance is `min(parsedAdvance, sourceWindowFrames)`; no-speech proposed advance is the current source window. Applied advance is exactly `min(proposedAdvance, 1000, remainingFrames)`. A full source window therefore overlaps the next decode by at least 500 frames / 5000ms.
- Decoded starts define ownership. Non-final window `i` owns `[S[i], S[i+1])`; the final window owns `[S[last], audioDuration)`. A start exactly at a boundary belongs to the later window. Resolve recorded owner indices against the complete decoded-start chain; never assume a future segment belongs only to `i+1`.
- Buffer one current window until advance/ownership is known. Filter non-owner segments, remove only exact `(startMs, endMs, text)` duplicates, validate unchanged bounds/nondecreasing starts, then emit callbacks. Do not clip, stretch, synthesize, fuzzy-merge, reference-match, or fill gaps.
- Progress equals each committed ownership frontier and ends once at exact duration.
- The adapter derives disposition categories from ownership and prior emitted tuple hashes; it does not trust editable category labels/counts. `exact-duplicate` requires `tupleSha256 == duplicateTargetSha256` and an already emitted identical tuple.
- Tracked publication recomputes metrics through T01, binds the K2 input/correction/tool/runtime/model identities plus every ignored raw SHA-256, publishes all seven prior K1 coordinate statuses, and contains no transcript/token/path data.
- K2's accepted development result is an algorithm/cache input only. It does not enable a production route or qualify a runtime pack.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Applied advance differs from the exact frozen formula | Reject evidence as a different candidate identity |
| Full non-final 1500-frame window overlaps by less than 500 frames | Reject evidence |
| Ownership intervals are noncontiguous, boundary ownership changes, or owner index differs from complete start-chain resolution | Reject evidence |
| Owned unique segment is labeled non-owner/duplicate, non-owner is emitted, category counts differ, or duplicate target differs | Reject evidence |
| Top-level emitted segment sequence differs from emitted dispositions in text/timing/tokens/trace hash | Reject evidence |
| Progress differs from ownership frontiers, regresses, duplicates final completion, or misses exact duration | Reject evidence |
| Short/medium/long order, 1+3/1/1 samples, lock, executable/worker/DLL/model/device/corpus, or raw hash differs | Publish no result |
| Any case fails CER/RTF/wall/RSS/timeline/semantic-gap gate | Complete the full matrix, publish `stop-revise`, keep native Kotoba disabled |

### 5. Good / Base / Bad Cases

- **Good:** one frozen K2 CUDA identity completes all three cases; adapter independently derives stride, ownership, disposition, progress, runtime, raw hashes, and shared T01 metrics; deterministic JSON/Markdown publishes an accepted algorithm input.
- **Base:** complete evidence passes structural identity but one mandatory quality gate fails; publish `stop-revise` and return to planning without K3 or a waiver.
- **Bad:** trust raw disposition labels/counts, accept `applied <= cap` instead of exact formula, assume every future owner is `i+1`, omit raw hashes, use midpoint ownership, or let a final cleanup hide callback/output divergence.

### 6. Tests Required

- C++ vectors cover ordinary/K1 isolation, `1500->1000`, shorter parsed advance, no-speech, final partial, zero advance, exact boundary, future owner beyond `i+1`, gap #3/#6 latest-start versus midpoint, exact-only dedup, same-time different text, unchanged timing, and progress.
- Protocol-only, CPU CT2, and pinned CUDA CTest lanes remain independently green.
- Real Rust-host Kotoba CUDA success, pre-ready malformed snapshot, CPU-only `cuda_not_built`, cancellation/reap, recovery, and active-gate tests remain green.
- Publisher mutation tests coordinate stride/frontier changes, forge ownership/disposition/count/duplicate fields, mutate runtime/corpus/path/candidate identities, run actual publication twice, compare bytes, bind raw hashes, and scan sanitized output for private data.
- Run the complete short 1-cold+3-warm, medium once, and long-v2 once matrix regardless of earlier outcome; reassess all seven K1 coordinates without pre-waiver.

### 7. Wrong vs Correct

```text
Wrong: appliedAdvance <= min(proposed, 1000, remaining), so call it K2.
Correct: appliedAdvance == min(proposed, 1000, remaining), and every downstream seek/overlap/ownership/progress field reproduces that exact chain.

Wrong: trust disposition="non-owner" and adjusted counts, then score the reduced top-level output.
Correct: derive ownership and exact-duplicate status independently, require category counts to match derived categories, and bind the accepted raw bytes by SHA-256.
```

## Scenario: Native CTranslate2 Development CUDA Evidence

### 1. Scope / Trigger

Use this contract when the existing native CTranslate2 Whisper worker is given an ignored-local development CUDA build for faster model-backed iteration. This lane proves truthful execution and relative speed on one declared machine; it does not qualify a runtime pack, release route, subtitle quality, installer input, downloader, or device matrix.

### 2. Signatures

```cpp
// CMake option: HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT=ON
// CMake preset: windows-x64-ct2-cuda-development

enum class ExecutionDevice { Cpu, Cuda };
enum class ExecutionComputeType { Int8, Float16 };

struct BackendExecutionConfig {
  ExecutionDevice device;
  ExecutionComputeType compute_type;
  int device_index;
};

BackendExecutionConfig cpu_execution_config();   // CPU / INT8 / index 0
BackendExecutionConfig cuda_execution_config();  // CUDA / FLOAT16 / index 0
```

The protocol request remains v1 with `device="cpu" | "cuda"`. The existing CTranslate2 evidence runner accepts the development device out of band, and the stdlib publisher freezes modules then publishes paired measurements from ignored raw JSON.

### 3. Contracts

- The primary Windows development identity uses the pinned CTranslate2 source, CUDA 12.8, exact architecture `8.6`, `WITH_CUDA=ON`, `CUDA_DYNAMIC_LOADING=ON`, and `WITH_CUDNN=OFF`. It must not download, install, link, or load cuDNN.
- The CUDA-enabled worker is the same worker used for paired CPU measurements. CPU remains INT8; CUDA is device 0/FLOAT16. Algorithm, model, tokenizer, protocol, and source identity stay fixed, and there is no automatic CPU fallback.
- CUDA setup is fail-closed before `ready`: CPU-only builds return `cuda_not_built`; missing device 0 returns `cuda_device_unavailable`; unsupported FP16 returns `cuda_compute_type_unsupported`; driver/runtime failure returns `cuda_runtime_failed`; CUDA model construction failure returns `cuda_model_load_failed`. `ready.device="cuda"` is legal only after explicit CUDA model construction succeeds.
- Device identity comes from CUDA Driver API queries bound to the loaded `nvcuda.dll`, not caller-provided labels. Raw evidence records GPU name, compute capability, driver/API versions, executable/DLL/model/config/audio hashes, and actual loaded modules.
- CUDA child processes use an ordered restricted PATH: task-local runner/bin, locked CUDA Toolkit `bin`, then Windows System32. CUDA DLLs are not copied into tracked or publishable output.
- Run separate completed CPU and CUDA discovery processes under the same CUDA-enabled binary. Derive shared, CPU-only, and CUDA-only required module sets, freeze them, then rerun every formal measurement from clean processes. Discovery rows never enter performance medians.
- Formal short-v1 and locked first-120s measurements each use separate CPU/GPU processes with one backend and exactly `1 cold + 3 warm`. The publisher uses the median of the three warm inference RTF values. Both GPU medians must be `<= 0.80 * CPU median` for `development-gpu-ready`.
- `development-gpu-unavailable` accepts only a validated configure/build failure envelope or structured pre-ready CUDA runtime/device/compute/model-construction failure. Completed CUDA with either sample missing the 20% threshold is `development-gpu-no-speedup`. Missing/incomplete/drifted evidence publishes no result.
- CER, confirmed gaps, segmentation, and timeline quality are not read and never choose the development device. GPU RTF `<=0.5` is reported only as a future release diagnostic.
- Tracked output contains only sanitized locks, hashes, aggregate timings, root roles, limitations, and one development result. Models, audio, transcripts, raw module paths, binaries, build trees, and raw JSON stay under the exact ignored task-local root.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| CPU-only worker receives CUDA | Structured `cuda_not_built` before `ready`; no fallback |
| Driver/runtime/device 0 unavailable | Safe pre-ready CUDA error; eligible for a validated unavailable envelope |
| Device 0 lacks FP16 | `cuda_compute_type_unsupported` before `ready` |
| Requested CUDA resolves or attests as CPU | Reject evidence and worker/host route equality |
| Caller-supplied GPU label differs from queried device | Ignore the label; bind queried CUDA Driver API identity |
| cuDNN module loads in the primary identity | Reject evidence |
| Shared or device-specific required module/hash/root/PATH differs | Reject publication; do not publish unavailable |
| Formal row differs in worker/runner/model/config/audio identity | Reject the evidence set |
| Formal process lacks exactly one cold plus three warm completed generations | Publish no result |
| Either GPU warm median is above `0.80 * CPU` after valid completion | `development-gpu-no-speedup` |
| Subtitle quality fails while GPU speed evidence passes | Keep `development-gpu-ready`; continue quality work on GPU |

### 5. Good / Base / Bad Cases

- **Good:** one no-cuDNN CUDA-enabled worker completes separate CPU/CUDA discovery, freezes actual module sets, reruns both samples as `1 cold + 3 warm`, attests device 0 from the driver API, and deterministically publishes the paired speed decision.
- **Base:** CUDA cannot configure or fails before `ready` with a validated runtime/device/model-construction envelope; publish `development-gpu-unavailable` and keep CPU/protocol builds unchanged.
- **Bad:** trust `device="cuda"`, a CLI GPU name, sibling DLL filenames, one cold run, or subtitle CER as proof; copy CUDA DLLs into tracked output; treat missing raw files or a validator error as GPU unavailable; or represent development evidence as a release pack.

### 6. Tests Required

- Configure/build/test protocol-only, CPU CT2, and opt-in CUDA CT2 presets; the first two must not require CUDA environment input.
- Unit-test CPU default mapping, CUDA device 0/FLOAT16 mapping, CPU-only `cuda_not_built`, unsupported device/compute failure, no fallback, and truthful `ready.device`.
- Evidence tests assert queried GPU/driver identity, restricted PATH roots, separate discovery rows, shared/CPU-only/CUDA-only module sets, no cuDNN, actual loaded-module hashes, cold process wall, completed generation traces, and four formal raw hashes.
- Publisher mutation tests reject device/compute/GPU/module/PATH/worker/model/config/audio/repeat/timing/raw-path/failure-envelope drift and correlated root rewrites; run twice and require byte-identical output.
- Rust model-backed tests cover CUDA success, deterministic CPU-only `cuda_not_built`, ready-derived cancellation within two seconds, recovery, reap, and active-gate release.
- Run the full Rust suite, `pnpm build`, benchmark self-check/tests, `git diff --check`, privacy scans, and active/archive `git check-ignore` assertions.

### 7. Wrong vs Correct

```text
Wrong: request device=cuda, observe a fast run, and declare the GPU lane ready.
Correct: construct CUDA device 0/FLOAT16 explicitly, query the real device through nvcuda, freeze loaded module sets, then compare both locked samples with independent 1-cold/3-warm processes.

Wrong: a CUDA validation error or subtitle-quality failure means fall back to CPU.
Correct: invalid evidence publishes no result; subtitle quality remains GPU-side algorithm work. CPU fallback is authorized only by validated unavailable or completed no-speedup evidence.
```

## Scenario: Native Candidate B Silero V6 Evidence

> Historical exception: this archived T06 candidate retained its reviewed stop-after-failure matrix. The general full-matrix rule above applies prospectively from T10 and does not rewrite archived evidence.

### 1. Scope / Trigger

Use this contract when ordinary `faster-whisper` is measured with the native Candidate B VAD stage. It applies to the development CPU evidence path only; it does not enable Release routing, model download, packaging, GPU execution, or a Python fallback.

### 2. Signatures

```cpp
CTranslate2WhisperBackend(
    model_path,
    CandidateAConfig,
    std::optional<std::filesystem::path> vad_model_path);

TranscriptionResult transcribe(
    audio_path,
    ProgressCallback,
    SegmentCallback,
    CancellationCallback);
```

Candidate B is active only when the locked VAD model path is supplied. The protocol request remains v1; `useVad` and its existing `vadConfig` are inputs, not new protocol fields.

### 3. Contracts

- The only executor is the pinned official ONNX Runtime `1.28.0` Windows x64 CPU runtime. The backend creates one direct CPU session with inter-op/intra-op threads `1`, CPU arena disabled, explicit CPU execution provider, and no custom ops or provider abstraction.
- The VAD asset is the exact faster-whisper v1.2.1 `silero_vad_v6.onnx` identity. Its inputs are `input/h/c`; recurrent state is carried across ordered rows and calls of at most `10,000` rows. A hash, schema, runtime, ORT run, non-finite output, interval, or timestamp-restoration failure is fail-closed. Candidate A is never silently retried.
- Audio is verified mono 16 kHz PCM16 and converted with division by `32768.0`. Rows use `512` samples plus `64` previous-context samples, including the full zero tail frame when divisible. Hysteresis is threshold `0.5`, negative threshold `0.35`, minimum speech `0ms`, infinite maximum speech, minimum silence `2000ms`, and speech padding `400ms` with the pinned half-gap merge behavior.
- Retained padded intervals are concatenated in source order. CT2 decodes the compressed stream with the selected timestamp-driven/no-history/beam-1 configuration. Compressed timestamps and progress are restored through the cumulative-silence map using the pinned integer/half-even `10ms` semantics, then validated against the verified source WAV duration.
- `useVad=false` may exercise the existing Candidate A diagnostic path but is not Candidate B qualification evidence. A supplied VAD configuration that changes the frozen Candidate B identity is rejected rather than silently accepted.
- Candidate B raw evidence must contain the actual CPU identity, the exact two-entry restricted PATH policy, canonical roots identity, actual loaded module set and file hashes, and module-layout identity. Runtime modules beside the measurement runner are distinguished from the required-but-not-necessarily-loaded `onnxruntime_providers_shared.dll`; OpenMP must resolve from the locked Windows System32 root. Sibling filenames alone do not prove loading.
- A single lock/config/executable/DLL/model/runtime identity covers all retained samples. Raw traces and canonical paths stay below the exact ignored task-local `research/local/` root. The adapter validates identity and recomputes quality metrics through the shared T01 comparator; the publisher never trusts mutable adapted metric fields.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| VAD asset hash, ORT version, input/output schema, type, or shape differs | Fail closed with a stable Candidate B error before scoring |
| ORT session/run fails or returns non-finite probability/state | Fail closed; never retry Candidate A |
| PCM shape, tail padding, recurrent state, threshold, or interval is invalid | Reject the sample and retain the failure trace |
| Restored start is at/after source WAV end, or restored range is non-positive | Fail closed; do not synthesize timing |
| `useVad=true` config differs from the locked Candidate B config | Reject with config-identity drift; do not measure under a new config |
| Loaded module is absent, has a different hash, or resolves outside the locked runner/System32 layout | Reject the evidence even when sibling DLLs exist |
| CPU identity or the ordered restricted PATH/root identity differs | Reject or classify as a separate evidence set |
| Completed/failed/derived/negative row mutates manifest, case/audio/model, lock/config, runner/DLL/VAD, CPU/modules/PATH, metrics, or timeout identity | Mutation validator rejects publication |
| Mandatory large-v3 short/medium/long gate fails | Stop Candidate B as `stop-revise`; do not run long/other models or claim qualification |
| Candidate B medium/long has a confirmed speech gap `>=1500ms` | Preserve the authoritative result and classify `stop-revise`; do not package ORT/VAD or enable routing |

### 5. Good / Base / Bad Cases

- **Good:** one locked direct ORT CPU session produces raw VAD probabilities, source intervals, restored CT2 traces, actual loaded-module/PATH evidence, and T01-recomputed short/medium metrics under one identity; deterministic publication records a truthful `stop-revise` when a gap remains.
- **Base:** no-VAD Candidate A or an unattempted model is retained only as separate diagnostic/blocked evidence; Candidate B stops after its first mandatory case failure.
- **Bad:** use the batched `160ms/30s` VAD policy, current Python VAD settings, Silero V4, a silent Candidate A fallback, reference-derived hole repair, synthetic timestamps, sibling-DLL presence as loaded-module proof, or a correlated fake module root that is not rejected.

### 6. Tests Required

Native Candidate B tests must assert:

- exact PCM scaling, full tail padding, `512/64` rows, recurrent carry, `10,000`-row batching, probability/state goldens, hysteresis intervals, padding/merge, compressed-to-source restoration, and monotonic original-source progress;
- exact `0.35` JSON serialization, frozen config rejection, VAD hash/schema errors, forced ORT failure, non-finite output handling, and no-fallback behavior;
- actual CPU identity, ordered two-entry restricted PATH, canonical PATH-root identity, loaded module names/hashes/paths, runner-relative local modules, System32 OpenMP, optional providers-shared semantics, and rejection of correlated module-root rewrites;
- adapter/publisher mutation rejection for all model/runtime/config/metric/timeout and failed/derived/negative identities, plus byte-identical double publication;
- replacement short `1 cold + 3 warm` and medium/long sample counts, T01 recomputation, stop-after-gap behavior, ignored raw containment, privacy scans, and all-model `blocked-not-run` preservation.

### 7. Wrong vs Correct

```text
Wrong: verify that onnxruntime.dll exists beside the worker and publish a generic CPU/PATH claim.
Correct: record GetModuleFileNameEx-derived module paths and hashes, bind local modules to the runner root and OpenMP to locked System32, then reject any identity mutation before T01 scoring.

Wrong: round restored float seconds with `int(round(seconds, 2) * 1000)` or retry Candidate A after ORT failure.
Correct: restore using the pinned integer sample/half-even 10 ms rule and fail closed on ORT/VAD errors.
```

## Anti-Patterns

- Committing model weights or venv contents
- Silent Kotoba cache “ready” without `preprocessor_config.json`
- Changing job snapshot shape without cross-layer type updates
- Adding GPU-only code paths without documenting CPU/optional install reality
- Reimplementing benchmark metrics, using an unbound/cross-model Python row, or using Python performance to relax native absolute gates
- Publishing native derived/negative evidence outside the same identity validator used for authoritative results
- Trusting pre-adapted metric JSON instead of recomputing sanitized publication from the authoritative local manifest/ASS
- Requiring CT2/model inputs for protocol-only builds, using locale-dependent Windows model paths, or extending Kotoba preprocessor readiness to ordinary Whisper
- Treating raw Qwen character ranges, session sentinel timing, or one giant top-level segment as subtitle-ready output
- Hard-coding exact-once cleanup or CPU-backend claims instead of deriving them from counts, params, and loaded modules
- Stopping a frozen model candidate after one quality gate fails instead of completing short-v1 / medium-v1 / long-v2
- Using qualification-grade immutable locks for open-ended exploration, guessing model-loaded contracts from no-model tests, or creating successive lock versions instead of running one bounded unscored discovery first
- Using a model-independent/default Whisper feature size instead of the exact loaded model `n_mels`
