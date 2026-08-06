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

Use this contract whenever a Python or native ASR candidate is measured for migration feasibility. User-provided `.asr-benchmark` WAV+ASS pairs are the only text, speech-region, and timeline truth; current Python output is diagnostic only.

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

Use the exact signatures and ABI version from the locked headers; the names above define the required proof surface, not a wrapper API.

### 3. Contracts

- Manifest case keys are safe relative WAV/ASS paths plus hashes, WAV shape, duration class, Dialogue count, positive per-case coverage tags, source/license/authorization, and `ass-dialogue-v1` derivation metadata. Inline reference text/segments are forbidden.
- Validation parses ASS locally and derives private reference text/segments/speech intervals in memory. Tracked reports contain only stable IDs, hashes, aggregate metrics, coverage, and limitations.
- `TranscriptSegmentRefresh` replaces the complete preview list before scoring for every engine.
- Native Whisper evidence distinguishes the supplied source slice from the padded model timestamp range. A 15-second seek slice may still use the model's 30-second timestamp-token range; record both `sourceWindowDurationMs` and `modelWindowDurationMs` per trace.
- A token-derived end inside the model range may be bounded to the verified WAV end only when raw evidence retains the original end, final end, token IDs, trace hash, and an explicit bound flag. A segment starting at/after WAV end still fails. Do not use bounding to repair missing speech.
- Native evidence records immutable model file sizes/SHA-256, input-lock SHA-256, executable SHA-256, environment, and ignored raw/result hashes. Raw transcripts/traces may be written only below the exact canonical task-local ignored root; substring path checks are insufficient.
- Native ordinary Whisper reads `n_mels` from the loaded CT2 model and supports exactly the official 80- and 128-mel shapes. Ordinary snapshots accept either `vocabulary.txt` or `vocabulary.json`; `preprocessor_config.json` remains Kotoba-only. The native Kotoba profile requires a non-empty preprocessor file plus loaded `n_mels == 128`, uses a maximum 15-second source window with the 30-second model/timestamp range, beam 5, no previous-text history, and timestamp-driven seek. Kotoba `useVad=true` fails before `ready` until a separately reviewed candidate exists.
- On Windows, the Rust host may supply a canonical `\\?\` model path. CTranslate2 4.8.0 cannot open that spelling directly: the worker removes only the extended-path prefix at the CT2 boundary and passes UTF-8 bytes (`u8string()`), while the host remains responsible for canonical managed-root validation.
- CT2 model-backed builds verify the pinned clean source commit plus required CT2/oneDNN/pocketfft file identities and build the tokenizer with `cargo --locked --offline`. Protocol/fake-worker-only builds disable the model backend explicitly rather than requiring local inference inputs.
- One shared native identity validator must cover every completed, failed, derived, and negative record before scoring or publication. It binds manifest/case/audio, lock, executable, required DLLs, route model/aligner, CPU/GPU params, loaded modules, and restricted-PATH policy. Never merge rows from different executable/DLL/lock identities into one evidence set.
- CrispASR CPU claims require public CPU-forced open params plus actual loaded-module inventory under a restricted PATH; DLL filenames alone do not prove which backend ran.
- CrispASR callback contexts are reset on every success/error exit before destruction. Result/alignment/session cleanup evidence records created/free/close counts and derives exact-once status from those counts; do not publish a hard-coded boolean.
- Qwen3 raw CJK character ranges are not subtitle segments. Preserve them, tokenize/group with the exact pinned upstream ranges and source-segment semantics, and accept only legal ForcedAligner-derived grouped segments. Session getter sentinel timing remains explicitly ineligible. A zero-duration final group fails closed; it is not repaired by synthetic expansion.
- Native top-level segments and nested word timing are separate capabilities. Report both distributions. One broad top-level segment can mathematically hide confirmed gaps but does not prove subtitle-scale segmentation readiness.
- Controlled failed evidence retains the failing trace and source/model bounds. Validators reject empty placeholder traces, and the benchmark adapter must refuse failed evidence. An externally terminated long run with no atomic token result is process evidence only: keep its binary/lock/timeout/termination identity separate, mark it unscored, and never merge it into completed rows.
- A sanitized publisher must recompute CER/timeline/gaps from the authoritative manifest/ASS through the shared T01 implementation; it must not trust mutable pre-adapted metric fields. Any inference source/config/binary/DLL/model identity change invalidates affected measurements and requires rerunning them before publication.
- When an authoritative reference identity changes, inventory every backend and result family that consumed the superseded identity, including completed, failed, diagnostic, derived, and currently inactive routes. Preserve historical artifacts, then publish an identity-bound supersession or an explicit validated-unscored disposition for every authoritative row before any parent/spec/handoff may claim the migration uses the new reference. Correcting only the currently active backend is incomplete.
- Missing confirmed-speech regions are semantic and gating by default. A region is diagnostic-only when every overlapping reference cue, after NFKC normalization and removal of whitespace, Unicode punctuation/symbols, and `ー` / `〜` / `~`, is exactly 1..6 repeats of one unit from `あ`, `う`, `え`, `お`, `ん`, `うん`, or `うあ`. Excluded regions remain in CER and publish separately; `はい`, laughter, mixed/lexical cues, and unknown forms remain semantic.
- Product qualification stops after a mandatory gate fails for candidates whose required matrix ends at that gate. T08 Kotoba K1/K2 are explicit full-matrix candidates: short-v1, medium-v1, and long-v2 are all scored under one frozen inference identity even after an earlier failure; only the complete matrix publishes `accepted-kotoba-algorithm-input` or `stop-revise`. Partial prefixes remain diagnostic and identify the next case. Every later Kotoba candidate requires a newly reviewed identity that addresses the complete observed failure profile.
- Frozen native gates: CER `<=0.35` per engine/case; CPU inference RTF `<=1.0`; accelerated GPU inference RTF `<=0.5`; short cold wall `<=120s`; peak RSS `<=6 GiB` for CTranslate2 or `<=12 GiB` for CrispASR; zero invalid/out-of-bounds segments; zero semantic confirmed-speech gaps `>=1500ms`; Qwen3 ForcedAligner median `<=150ms` and P95 `<=500ms`. No VRAM gate is defined.
- Python references never establish expected output, relative CER/RTF gates, or missing annotations.

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
| Derived or negative record bypasses the shared identity validator | Reject publication even when its status/timeline looks valid |
| CrispASR CPU run uses implicit/default GPU params | CPU gate is ineligible until rerun with explicit CPU params and module attestation |
| Qwen raw character range is zero-duration | Retain as raw provenance; validate only after exact pinned source-segment grouping |
| Qwen grouped final segment is zero-duration or session-native/synthetic | Fail closed with zero accepted timeline |
| Callback context exits without all registered callbacks reset | Reject lifecycle evidence |
| Created result/alignment/session count does not match free/close count | Reject exact-once claim |
| Failed envelope has no complete matching trace | Reject the evidence; do not summarize it as a blocker |
| Long model process hits an external timeout before atomic raw publication | Record timeout/process identity separately and unscored; do not invent token traces or merge with completed rows |
| Final CT2 source/config/binary identity differs from measured rows | Invalidate and rerun the affected minimum authoritative cases before publication |
| Mandatory default-model gate fails | Stop the candidate ladder unless the reviewed next candidate addresses that failure class; mark remaining models `blocked-not-run` |
| Ordinary CT2 model exposes neither 80 nor 128 mels, or lacks both vocabulary formats | Reject as model contract mismatch; do not apply Kotoba readiness rules to repair it |
| Coverage tag is absent or unconfirmed | Leave it absent and report the corpus-wide gap |

### 5. Good / Base / Bad Cases

- **Good:** native candidate uses the validated manifest identity, one exact lock/binary/DLL/model evidence set, shared recomputed metrics, and frozen absolute gates; source/model windows, CPU modules, Qwen raw-to-grouped provenance, and any WAV-end bound remain auditable. Python data is shown only as supplemental diagnostics.
- **Base:** Python medium/long diagnostics are missing, an engine returns one broad legal segment, or a mandatory native long run times out before atomic publication; comparison reports the limitation and leaves incomplete evidence unscored.
- **Bad:** regenerate reference text from a Python transcript, trust editable adapted metrics without recomputation, compare only against Python parity, average cases to hide one failing case, run every model after the mandatory algorithm gate already failed, add VAD to fix a CER/RTF blocker, treat runtime feasibility or one broad segment as subtitle readiness, publish derived/negative records without identity validation, treat Qwen character ranges as final cues, use a source-slice duration as the model timestamp range, or commit private media/raw results.

### 6. Tests Required

```bash
python scripts/asr-benchmark.py self-check
python scripts/asr-benchmark.py validate --manifest asr-service/benchmarks/corpus.example.json
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
cd asr-service && python -m unittest discover tests
```

Assert ASS fail-closed parsing, exact S/D/I CER counts, timing provenance, per-case coverage union, refresh replacement, deterministic sanitized Markdown, ignored raw outputs, and path/privacy rejection. Gap tests must cover approved punctuation/elongation/repetition forms, `はい`, laughter, mixed lexical cues, multiple overlapping cues, CER retention, and deterministic separate semantic/excluded diagnostics. Native Whisper harnesses additionally assert distinct source/model windows, verified-WAV end bounding with raw provenance, start-after-audio failure, exact model/lock/binary identity, canonical output containment, and complete failed-trace validation.

Native CTranslate2 production harnesses additionally assert:

- official 80- and 128-mel goldens, both ordinary vocabulary formats, and no ordinary preprocessor requirement;
- timestamp-driven seek, leading silence, final partial windows, consecutive timestamps, source-end bounding and start-after-audio rejection;
- pinned clean CT2/oneDNN/pocketfft identities, offline locked tokenizer build, and a protocol-only configure with the CT2 backend disabled;
- Rust-host real-worker success, structured pre-ready failure/recovery and process-tree cancellation through test-only env injection;
- publisher mutation rejection for model/runtime/config/metrics/timeout identities and byte-identical regenerated output.

Native CrispASR harnesses additionally assert:

- mutation rejection for case/audio/manifest/lock/executable/DLL/model/aligner/CPU params/modules/PATH across completed, failed, derived, and negative records;
- exact pinned CJK punctuation/mixed-script token counts and source-segment grouping;
- Qwen session getter timing is ineligible and all accepted timing is ForcedAligner-derived;
- real missing/corrupt/unloadable/empty/malformed/invalid-audio negatives accept zero timed output;
- callback reset on success and error, plus created/free/close count-derived exact-once cleanup;
- short cold + three warm samples, medium/long attempts or complete failed evidence, single final evidence identity, and byte-identical sanitized publication.

### 7. Wrong vs Correct

```text
Wrong: native passes because it differs from Python by less than 1%, because the runtime can execute all models, or because one broad segment covers the whole speech interval.
Correct: native passes only when each route/case meets the frozen absolute gates against validated WAV+ASS ground truth, with one enforced lock/binary/DLL/model identity, auditable native timing, and separately reported subtitle-scale segmentation risks.

Wrong: after the mandatory model fails CER/RTF, run every model anyway or add VAD because it is the next planned feature.
Correct: stop the rejected algorithm, keep remaining models `blocked-not-run`, and activate a new candidate only when it addresses the observed failure class and has a newly frozen identity.

Wrong: use every Qwen aligner character range as a cue, expand zero-duration ranges, or publish session getter sentinel timing.
Correct: retain raw ranges, reproduce the exact pinned upstream source grouping, accept only legal ForcedAligner-derived final segments, and fail closed otherwise.
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
- Reimplementing benchmark metrics or using Python parity as native quality truth
- Publishing native derived/negative evidence outside the same identity validator used for authoritative results
- Trusting pre-adapted metric JSON instead of recomputing sanitized publication from the authoritative local manifest/ASS
- Requiring CT2/model inputs for protocol-only builds, using locale-dependent Windows model paths, or extending Kotoba preprocessor readiness to ordinary Whisper
- Treating raw Qwen character ranges, session sentinel timing, or one giant top-level segment as subtitle-ready output
- Hard-coding exact-once cleanup or CPU-backend claims instead of deriving them from counts, params, and loaded modules
