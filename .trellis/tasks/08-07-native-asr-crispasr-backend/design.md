# T09 CrispASR Backend Core — Technical Design

## 1. Design goals

T09 adds one deep CrispASR module behind the existing worker dispatch seam. The module hides DLL loading, the fragile pinned ABI layout, opaque handle ownership, callback copying, audio validation, result copying, Qwen aligner capability, and execution attestation behind one request-scoped interface. `main.cpp` remains the sole owner of protocol events. Rust remains the sole owner of worker process lifecycle and hard cancellation.

The design intentionally does not add a generic backend hierarchy: CTranslate2 and CrispASR have different model formats, result capabilities, device proof, and failure modes, while only `main.cpp` calls either implementation. A common interface would be a hypothetical seam with one caller and would enlarge the surface without reducing duplicated policy.

## 2. Existing seams reused

- Protocol engine/backend/model-role validation: `native-asr/src/protocol.cpp` and `include/hikaru_asr/protocol.hpp` already define all three CrispASR engines, `Backend::CrispAsr`, `ModelRole::Aligner`, `segmentsReplace`, legal event ordering, and Qwen's required aligner role.
- Protocol output: the existing `Emitter` in `native-asr/src/main.cpp` remains the only JSONL serializer/validator.
- Worker process lifecycle: `NativeAsrHost` in `src-tauri/src/asr_worker.rs` remains unchanged outside test-only real-worker input seams.
- CTranslate2 route: retain existing construction, errors, callbacks, tests, and release/default behavior.
- Ground-truth/evidence logic: reuse T01 benchmark comparison and the T03/T03C locked identities; do not create another CER/gap implementation.

## 3. Tracked source shape

Minimum expected product/test files:

```text
native-asr/src/wav_audio.hpp
native-asr/src/wav_audio.cpp
native-asr/src/crispasr_backend.hpp
native-asr/src/crispasr_backend.cpp
native-asr/tests/fake_crispasr_abi.cpp
native-asr/tests/crispasr_backend_tests.cpp
native-asr/src/main.cpp
native-asr/CMakeLists.txt
src-tauri/src/asr_worker.rs               # test-only real-worker inputs/tests
```

Task-local evidence tooling/artifacts live under:

```text
.trellis/tasks/08-07-native-asr-crispasr-backend/research/
  crispasr-development-lock.md
  crispasr-development-raw-index.json
  crispasr-development-report.md
  crispasr-backend-handoff.md
  evidence/crispasr-development.json
  run_crispasr_development.py
  publish_crispasr_development.py
  test_publish_crispasr_development.py
  local/                                  # ignored builds, DLLs, models, audio, raw JSON
```

No frontend, product Tauri command, downloader, settings, installer, portable resource, capability, or Python sidecar source is changed.

## 4. CrispASR module interface

The interface exposes only Hikaru-owned types; upstream opaque handles and function pointers stay private to the implementation.

```cpp
namespace hikaru_asr::crisp {

class BackendError : public std::runtime_error {
 public:
  BackendError(std::string code, std::string message);
  const std::string& code() const noexcept;
};

struct BackendConfig {
  Engine engine;
  Device device;
  std::filesystem::path audio_path;
  std::filesystem::path model_path;
  std::optional<std::filesystem::path> aligner_path;
  std::filesystem::path library_path;
};

struct NativeWord {
  std::string text;
  std::int64_t start_ms;
  std::int64_t end_ms;
};

struct NativeSegment {
  std::string text;
  std::int64_t raw_start_ms;
  std::int64_t raw_end_ms;
  std::vector<NativeWord> words;  // preserves upstream per-segment ownership
};

struct AlignmentEntry {
  std::string text;
  std::int64_t start_ms;
  std::int64_t end_ms;
};

struct Result {
  std::vector<NativeSegment> source_segments;
  std::vector<AlignmentEntry> alignment;  // Qwen raw ForcedAligner entries only
};

using ProgressCallback = std::function<void(std::int64_t processed_ms)>;
using SegmentCallback = std::function<void(const Segment& segment)>;

class CrispAsrBackend {
 public:
  explicit CrispAsrBackend(BackendConfig config);
  ~CrispAsrBackend();

  CrispAsrBackend(const CrispAsrBackend&) = delete;
  CrispAsrBackend& operator=(const CrispAsrBackend&) = delete;

  std::int64_t duration_ms() const;
  Result transcribe(
      const ProgressCallback& on_progress = {},
      const SegmentCallback& on_segment = {});

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace hikaru_asr::crisp
```

Interface invariants:

- Construction validates the route/roles and regular non-empty files, reads and owns verified 16 kHz mono PCM16 audio, verifies the exact generated permitted runtime DLL size/SHA-256 before loading, binds the export table, opens exactly one explicit logical backend session with private fixed 16-thread G1 params, validates `session_backend`, and enforces the development-only pre-`ready` runtime/device invariant internally. Exact model/aligner hashes are validated by the runner or Rust test decoder before worker launch, not exposed as backend interface fields.
- ReazonSpeech explicitly opens upstream backend `parakeet`; filenames never select the route.
- Qwen requires an aligner path at construction. The file/identity can be checked before `ready`; full aligner load is proven only during `transcribe` because the pinned ABI has no aligner-open handle.
- `transcribe` owns callbacks and copied result data. It exposes no cooperative cancellation parameter because the pinned ABI cannot honor it.
- `source_segments` is the single authoritative copied session shape and preserves nested word ownership. Non-Qwen protocol output is derived from its validated raw timing; Qwen timing remains ineligible.
- Qwen `source_segments` plus raw `alignment` preserve capability without leaking upstream handles or accepting timing. The worker derives the fixed policy error from the validated engine; the result carries no duplicate policy flag.

## 5. Private ABI adapter

`crispasr_backend.cpp` dynamically loads the pinned Windows DLL with an explicit absolute path and safe DLL search flags. It binds only the approved public subset listed in `research/crispasr-abi-ownership-device.md`.

The private implementation declares the pinned `crispasr_open_params_v1` v2 layout and uses `static_assert` for the wrapper's own size, alignment, and field offsets. Because that cannot prove a loaded DLL used the same private layout, the exact permitted development runtime DLL size/SHA-256 is verified before `LoadLibraryExW`; required exports are then bound. After the pinned CUDA runtime is built, CMake receives its reviewed size/hash as required development cache inputs and generates a private runtime-identity header consumed by the backend. The fake-ABI test target alone uses a test-only compile definition to bypass runtime hashing while separately testing the hash validator; production/development worker targets cannot bypass it. T03's official CPU DLL is historical ABI reference only. No upstream struct, identity, or function-table type appears in the public header.

Stable wrapper error codes:

| Stage | Code |
|---|---|
| DLL missing/dependency load failure | `crispasr_library_load_failed` |
| required export/layout drift | `crispasr_abi_mismatch` |
| explicit logical backend absent | `crispasr_backend_unavailable` |
| opened backend differs | `crispasr_backend_mismatch` |
| model/session open failure | `crispasr_model_load_failed` |
| unsupported/missing route role | existing `missing_model_role` / `unexpected_model_role` |
| unsupported T09 VAD request | `crispasr_vad_not_implemented` |
| transcribe null | `crispasr_transcribe_failed` |
| copied result invalid | `crispasr_result_invalid` |
| aligner null | `crispasr_alignment_failed` |
| aligned entries invalid | `crispasr_alignment_invalid` |
| Qwen policy intentionally deferred | `qwen_timeline_policy_not_implemented` |
| CUDA envelope cannot be attested | `crispasr_device_unavailable` |

Wrapper-owned stderr may contain stable stages/codes and sanitized identities only; it never includes callback/result/alignment text, model bytes, credentials, or complete user-controlled paths. Upstream verbosity is fixed to zero, but direct upstream stderr cannot be intercepted reliably, so retained model-backed worker logs stay ignored-local and are scanned for private transcript/path/credential sentinels before a row is accepted. Stdout receives only stable protocol-safe codes/messages.

## 6. Ownership and cleanup order

Normal success, structured failure, invalid result, and early initialization follow one RAII order for resources actually acquired:

1. copy every callback/result/alignment string immediately;
2. clear registered external callbacks while callback context is alive;
3. destroy callback context;
4. free created alignment result exactly once;
5. free created session result exactly once;
6. close opened session exactly once;
7. unload the DLL after all handles/callbacks are gone.

T09 binds exactly two external callbacks: progress and segment; token callbacks are not required. The fake ABI records acquired/create/free/close/registration/reset counters so exact-once claims are derived conditionally: close/free equals one only when the corresponding resource was acquired/created, otherwise zero, and reset count equals the number of successfully registered external setters (normally two).

Hard cancellation is different: Rust terminates the worker process tree. No cleanup counter or destructor claim is published for the killed process; tests prove terminal `cancelled`, bounded exit, and no orphan, not ABI close callbacks.

## 7. Audio and path handling

Move the existing RIFF/WAVE PCM16/mono/16 kHz reader unchanged into a neutral `wav_audio.hpp/.cpp` module and link both CTranslate2 and CrispASR to it. The shared module owns normalized float samples, duration rounding, format validation, and audio error code/message. Thin backend wrappers translate the shared error without changing existing CT2 externally observed codes. Existing CT2 fixtures plus new cross-backend goldens prove accepted/rejected formats and duration did not drift.

Before passing model/aligner/audio paths to the narrow upstream API, remove only the Windows verbatim `\\?\` / `\\?\UNC\` spelling as the existing CT2 boundary does, then pass UTF-8. The Rust host remains responsible for canonical managed-root validation. Tests include non-ASCII and UNC/verbatim spellings.

## 8. Worker dispatch and event flow

`run_worker` performs a narrow backend switch:

```text
Backend::CTranslate2 -> run_ctranslate2(request)  # existing behavior preserved
Backend::CrispAsr    -> run_crispasr(request)     # only when compile gate enabled
```

`run_crispasr` flow:

1. Require engine/backend equality already validated by protocol.
2. Reject `useVad=true` and Vulkan before backend construction.
3. Extract exact `model` and optional/required `aligner` roles.
4. Build `BackendConfig` from request plus worker-local `crispasr.dll`.
5. Construct backend; constructor errors emit a pre-`ready` error and exit `2` or `20` consistently.
6. Enforce the internal development runtime invariant. A CUDA request against an unapproved/CPU-only runtime or without the minimum post-session-open CUDA module checkpoint fails before `ready`; no fallback.
7. Emit `ready { backend: crispasr, device: request.device, durationMs }`. This device value is the protocol request match under the frozen development envelope, not a first-class ABI-resolved compute-device claim.
8. Register callbacks and run transcription.
   - Non-Qwen eligible preview segments may emit `segment`.
   - Qwen callback timing is ineligible and is never emitted.
   - Progress is normalized/clamped/monotonic when callbacks fire; silence is allowed.
9. Independently copy and validate final results.
   - Non-Qwen preview/final difference emits one `segmentsReplace`.
   - Qwen runs the aligner, copies source texts and raw entries, then emits `error(qwen_timeline_policy_not_implemented)` with zero timed output.
10. Non-Qwen success emits `completed` with language `ja`.

After `ready`, every error is emitted through the same `Emitter` sequence state; pre-ready serialization is not reused after the sequence starts.

## 9. Device configuration and attestation

T09 supports CPU and ignored-local CUDA; Vulkan remains unimplemented.

Frozen candidate G1 changes only device execution:

| Field | CPU lane | CUDA lane |
|---|---:|---:|
| `abi_version` | 2 | 2 |
| `n_threads` | 16 | 16 |
| `use_gpu` | 0 | 1 |
| `verbosity` | 0 | 0 |
| `flash_attn` | 0 | 0 |
| `n_gpu_layers` | 0 | -1 |
| preference | none | `crispasr_set_gpu_backend("cuda")` before open |

Formal CPU/GPU rows use the same CUDA-enabled CrispASR DLL and worker/runner identity in fresh processes. This isolates device selection while keeping source, model, audio, route, threads, flash-attention, and code fixed.

Because the ABI has no resolved-device getter, external attestation requires all of:

- exact CUDA-enabled source/build/DLL identity;
- CUDA request/open params and preference;
- checkpointed module identities after session open, after transcription, and after Qwen alignment where applicable; each identity binds sanitized root role, relative name/path, size, and SHA-256;
- CUDA Driver API query of device 0 name, compute capability, and driver/API version;
- paired speed matrix meeting the family-specific threshold;
- negative/mutation tests rejecting CPU-only DLLs, removed or role-swapped modules, relabeled params, device-field rewrites, and correlated root rewrites.

Discovery runs execute each family's complete session path (including Qwen ForcedAligner), establish required shared/CPU-only/CUDA-only checkpoint envelopes, and explicitly record `resolvedComputeDeviceAvailable=false`. Formal measurements and real-host CUDA smoke start only after the matching family envelope is frozen. Module presence alone never yields a development result; speed alone never compensates for invalid identity.

## 10. Family-scoped performance evidence

Two independent evidence sets are published:

### `parakeet-family`

- representative engine: `reazonspeech-nemo`;
- upstream backend: `parakeet`;
- inputs: short-v1 and the locked first 120 seconds of medium-v1;
- each device/sample: one cold generation plus three warm generations.

### `qwen3-family`

- representative engine: `qwen3-asr` plus required ForcedAligner;
- upstream backend: `qwen3`;
- same short/120-second repeat structure;
- inference time is the measured wall interval around session transcription plus raw ForcedAligner execution;
- a performance-eligible row requires non-null session and aligner results, ordered copied source segments and raw entries, exact terminal policy identity, and zero accepted timing. Backend fake-ABI tests bind conditional cleanup counters, while the real Rust-host worker smoke independently proves the structured `qwen_timeline_policy_not_implemented` exit with zero `segment`, `segmentsReplace`, or `completed` output; performance rows do not duplicate host lifecycle counters.
- raw alignment allows any `0 <= start <= end`, including zero-duration entries, with no audio-end upper bound. This preserves unchanged ForcedAligner capability evidence only: raw values are not clipped or promoted to accepted timing, and each generation plus the sanitized family result records the maximum tail overrun. T11—not T09—owns grouped protocol legality.

For each family:

```text
GPU warm median RTF(short) <= 0.80 * CPU warm median RTF(short)
AND
GPU warm median RTF(120s) <= 0.80 * CPU warm median RTF(120s)
    => development-gpu-ready
valid GPU execution but either comparison fails
    => development-gpu-no-speedup
validated family discovery/configure/build/session-load/aligner-load/device failure before formal measurement
    => development-gpu-unavailable
invalid/incomplete/drifted/missing-input evidence
    => publish no result and keep T09 incomplete
```

CER, gaps, top-level segmentation, accepted Qwen timing, and alignment accuracy are not read by the device decision. T03C dispositions are copied into the handoff as downstream risks, not recomputed as T09 gates.

## 11. Frozen evidence runner contract

`hikaru-asr-crispasr-tests` is also the sole model-backed acquisition executable:

```text
hikaru-asr-crispasr-tests.exe --run-development-evidence
  --phase discovery|formal
  --family parakeet-family|qwen3-family
  --device cpu|cuda
  --sample short-v1|medium-v1-first-120s
  --input-lock <tracked-lock>
  --library <ignored-crispasr.dll>
  --model <ignored-model.gguf>
  [--aligner <ignored-aligner.gguf>]
  --audio <ignored-authoritative-or-derived.wav>
  --output <canonical-task-local-ignored-raw.json>
```

The mode—not caller-provided repeat flags—freezes acquisition:

- `discovery`: exactly one fresh process, one session, one generation; captures all module checkpoints and never enters performance medians;
- `formal`: exactly one fresh process, one session, four sequential generations with repeat index `0`/`cold` then `1..3`/`warm`;
- any missing, duplicate, failed, or reordered formal generation invalidates the entire row;
- retrying creates a new attempt identity and reruns all four generations; attempts are never mixed or cherry-picked.

Raw output is written atomically below the exact canonical ignored root. Exit `0` means a structurally complete row was written; exit `20` means a complete validated discovery/unavailable envelope was written; exit `2` means invocation/input/identity rejection and is not evidence; exit `74` means atomic output failed. Fixed host timeouts are 600 seconds for discovery, 300 seconds for short formal, and 1800 seconds for 120-second formal; timeout/process evidence is retained but cannot be relabeled unavailable unless it matches a separately reviewed envelope.

One stdlib `run_crispasr_development.py` orchestrator has three explicit modes and is runnable before the native runner exists:

- `prepare-runtime`: validate required source/toolchain inputs, execute the exact structured upstream CUDA-runtime configure/build argv frozen in the input lock, and capture ignored raw logs. On success, write an ignored prepared-runtime identity and stop. An independent review copies its size/hash/build identities into the tracked lock before the next phase.
- `prepare-worker`: require the reviewed runtime identity from the tracked lock, execute the locked Hikaru configure/build argv with that identity as private CMake inputs, and capture ignored logs. On success, write an ignored prepared worker/runner identity and stop. An independent review freezes worker/runner/formal-runtime identities into the lock before acquisition.
- `acquire`: require both reviewed identities, invoke all four discovery processes, then invoke a family's four formal processes only when both CPU/CUDA discovery rows are measurement-eligible. A valid unavailable discovery skips that family's formal rows.

A validated non-timeout configure/build failure in either prepare phase atomically writes one sanitized `hikaru-crispasr-development-pre-runner-failure-v1` attempt file per family plus acquisition-index entries, binding family, stage, shared attempt identity, input-lock/source/toolchain/command-role hashes, nonzero exit code, and stdout/stderr log size/SHA-256/privacy status. Missing executables/toolchain/source, timeout-only failures, or log/privacy drift produce no result. Successful two-phase preparation yields 4 discovery plus 0, 4, or 8 formal processes; a validated shared prepare failure yields two family pre-runner attempt files and no runner rows. The orchestrator enforces canonical paths, fixed timeouts, fresh attempt IDs, exact output names/exit categories, and sanitized acquisition-index generation. It does not calculate benchmark metrics or family results.

## 12. Build design

Add one default-off option:

```cmake
HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=OFF
```

For T09, CrispASR development requires `HIKARU_ASR_BUILD_CT2_WORKER=ON`; this keeps the one existing worker executable and avoids refactoring target topology before a CrispASR-only build is needed. CPU/CUDA selection is runtime/open-param behavior under the frozen DLL identity, not a second wrapper compile gate.

Build sequencing is explicit: first freeze source/model/audio/toolchain identities; then build CrispASR separately below ignored task-local storage from the exact pinned source; then review/freeze the produced CUDA-enabled DLL/common-runtime hashes; finally configure/build the Hikaru worker/runner with those hashes as required private CMake inputs. Hikaru CMake generates the private runtime-identity header and does not `add_subdirectory` the upstream project. This prevents circular identity claims and GGML/CMake option collisions with CTranslate2.

Add targets:

```text
hikaru-asr-wav-audio                 shared verified WAV module
hikaru-asr-crispasr                 static wrapper module
hikaru-asr-fake-crispasr-abi        fake DLL
hikaru-asr-fake-crispasr-abi-broken fake DLL with one required export omitted
hikaru-asr-crispasr-tests           no-model self-check + model evidence runner
```

The worker links the wrapper only when the CrispASR gate is enabled. Default protocol and existing CT2 presets remain unchanged. Do not commit a task-rooted CMake preset; configure the ignored task-local build with explicit `cmake -S/-B -D...` commands or an ignored `CMakeUserPresets.json`, avoiding stale active-task paths after archive.

## 13. Rust host test seam

Keep separate `#[cfg(test)]` CT2 and CrispASR input decoders; the CrispASR decoder reads one ignored-local JSON path from `HIKARU_ASR_CRISPASR_INPUTS`. Generalize the existing common launch helper to accept an exact vector of model roles/paths. Reuse one `NativeAsrHost` launch/poll/recovery/cancellation state machine; do not add a sibling lifecycle launcher.

Real-host obligations:

- Reazon CPU and attested CUDA success through `ready -> segment/replace? -> completed`;
- Qwen CPU/CUDA `ready -> qwen_timeline_policy_not_implemented` with zero accepted timed output;
- missing/non-regular/hash-mismatched model or aligner failure before `ready`, plus unloadable/invalid aligner execution failure after `ready` with zero accepted output;
- CUDA request against CPU-only runtime fails before `ready`;
- ready-derived hard cancellation exits within two seconds, leaves no completed output, and reaps the process tree;
- release/default code never reads the test-only environment inputs.

## 14. Deterministic fake ABI tests

The fake DLL covers without models:

- export binding and missing-export rejection;
- explicit route/backend mapping including Reazon -> `parakeet`;
- open/transcribe/align null errors;
- callback borrowed-text copying and reset ordering;
- exact-once result/align/session cleanup on every normal exit;
- silent, monotonic, and regressing progress behavior;
- preview==final and preview!=final replacement behavior;
- invalid/unsorted/out-of-bounds result failure;
- Qwen aligner requirement, raw-entry copying, unbounded non-negative/non-reversed raw tail retention, maximum-tail-overrun reporting, reversed/negative rejection, strict policy error, and zero timed output;
- CPU/CUDA open-param vectors and CPU-only-CUDA rejection;
- Unicode/verbatim path handling and WAV format parity.

Protocol route tests remain in `protocol_tests.cpp`; process cancellation remains a host/process test. Do not duplicate those state machines inside the backend suite.

## 15. Evidence publication

Ignored raw JSON binds family, case, sample/repeat, model/aligner/audio identities, input lock, executable/worker/DLLs, source/build/toolchain, open params, loaded modules, CUDA device, PATH roots, timing, lifecycle counters, and expected Qwen policy status. It may contain raw text only under the exact ignored local root.

Immediately after acquisition, write a sanitized tracked `crispasr-development-raw-index.json` containing one entry per pre-runner/discovery/formal attempt file: row role, family, case/device where applicable, phase/stage, attempt identity, relative raw identifier, size, and SHA-256. A formal attempt file embeds all four generations; the publisher validates repeat indices/order/completeness inside that file. Freeze/review the index before aggregation.

The tracked publisher:

- verifies every raw byte against the frozen acquisition index before parsing and rejects missing, extra, duplicate, renamed, symlink/reparse, or hash-drifted inputs;
- validates every row through one identity validator before aggregation, including pre-runner failure stage/command/exit/log/privacy identities and the required two-family shared-attempt pairing;
- binds the raw-index hash into both family results and the final handoff;
- derives medians and result categories from raw rows rather than trusting labels;
- accepts no transcript, token, segment text, private path, credential, or model bytes;
- runs twice to byte-identical JSON/Markdown;
- mutation-tests identity roles, counts, timing, params, modules, device, roots, raw hashes, pre-runner command/stage/exit/log/shared-family pairing, failure categories, and result promotion.

## 16. Rollout and rollback

T09 is development-only. `src-tauri/src/asr.rs`, product native-host activation, runtime probing, model manifest/downloader, settings, UI, installer, and portable packaging remain unchanged. Release/default therefore continues Python legacy even when the T09 worker build succeeds.

Rollback deletes/disables the default-off CrispASR compile gates and ignored-local build/evidence outputs. Existing protocol, CTranslate2 routes, Rust host, and Python legacy behavior remain intact.

## 17. Decisions and trade-offs

- **D1:** Concrete `CrispAsrBackend`, not a backend hierarchy; depth comes from hiding ABI/lifecycle complexity behind one interface.
- **D2:** Dynamic export binding, not direct link; required because the official package omitted the session header and because fail-closed ABI mismatch is part of the contract.
- **D3:** Strict Qwen capability boundary; T11 owns grouping and legal timeline policy.
- **D4:** Family-scoped GPU results; one model family cannot authorize or block the other.
- **D5:** External development attestation is accepted despite no resolved-device getter; formal production proof remains T14/T15.
- **D6:** Hard cancellation proves process reclamation, not ABI destructor execution.
- **D7:** Extract the existing nontrivial WAV trust-boundary parser unchanged into one neutral module now that two native backends consume it; preserve CT2 external error behavior with thin wrappers and golden tests.
- **D8:** Reject T09 VAD requests rather than silently ignoring them or pre-building unproven T10/T11 policy.
- **D9:** Keep the worker target nested under the existing CT2 build for T09, use one CrispASR development compile gate, and avoid committed task-rooted presets; a CrispASR-only worker topology is deferred until a real packaging task requires it.
