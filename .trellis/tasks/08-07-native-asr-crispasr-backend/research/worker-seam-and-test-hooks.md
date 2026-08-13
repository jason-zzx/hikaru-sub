# Smallest reusable worker seam for the shared CrispASR backend

## Executive recommendation

Add one concrete `CrispAsrBackend` module that mirrors the existing concrete CTranslate2 backend shape, dynamically loads the pinned CrispASR DLL, owns one session, copies all callback/result data, and returns route-neutral native capabilities. Dispatch it from the already validated `Backend::CrispAsr` branch in `main.cpp`.

Final planning review refined this initial seam: no public partial `ExecutionAttestation`; exact runtime hash and minimum device invariant stay private, while the evidence runner captures full checkpoint identities. Preserve nested source-segment/word ownership, extract the existing WAV reader into one neutral shared module, use one CrispASR compile gate with explicit task-local `cmake -S/-B` commands instead of a tracked task-rooted preset, and reuse one generalized Rust model-backed launch helper with separate CT2 environment and CrispASR JSON input decoders.

Do **not** add a virtual backend hierarchy, factory, second worker process, protocol revision, or Tauri/React contract. Do not refactor the working CTranslate2 implementation beyond the minimum dispatch split.

Recommended tracked source shape:

```text
native-asr/src/crispasr_backend.hpp
native-asr/src/crispasr_backend.cpp
native-asr/tests/crispasr_backend_tests.cpp
native-asr/tests/fake_crispasr_abi.cpp   # tiny fake DLL, no inference
```

CMake/test declarations are the only other native files that need changes. Rust changes should stay inside the existing `asr_worker.rs` test module for model-backed host evidence.

## Why this is the smallest seam

### Existing concrete pattern is already sufficient

The CTranslate2 backend already establishes the desired object boundary:

- public constructor plus pimpl: `native-asr/src/ctranslate2_whisper.hpp:285-313`;
- implementation-owned state: `native-asr/src/ctranslate2_whisper.cpp:1446-1526`;
- constructor performs execution/model initialization before `ready`: `:1528-1541`;
- `transcribe(audio_path, on_progress, on_segment, is_cancelled)` returns an owned result: `:1563-1569`;
- structured backend errors use `BackendError(code, message)`: header `:214-221`.

One parallel concrete class is cheaper and safer than introducing an interface with one current consumer. The shared aspect is that all three CrispASR protocol engines parameterize this one class; it does not mean CTranslate2 and CrispASR need a common inheritance tree.

### Protocol and host are already CrispASR-ready

No protocol v1 change is needed:

- `Engine::{Parakeet, ReazonSpeechNemo, Qwen3Asr}`, `Backend::CrispAsr`, `ModelRole::Aligner`, and `EventType::SegmentsReplace` already exist: `native-asr/include/hikaru_asr/protocol.hpp:14-25`;
- engine/backend routing is fixed before worker dispatch: `native-asr/src/protocol.cpp:186-195`, `:421-426`;
- Qwen requires model+aligner roles, while other routes accept only model: `native-asr/src/protocol.cpp:436-463`;
- ready must match requested backend/device, progress is monotonic, and both incremental/final replacement segments are bounded and ordered: `native-asr/src/protocol.cpp:600-653`;
- native tests already cover the three CrispASR routes and Qwen aligner requirement: `native-asr/tests/protocol_tests.cpp:78-104`;
- Rust mirrors the same route matrix and roles: `src-tauri/src/asr_worker.rs:329-372`;
- Rust already parses/applies `segmentsReplace`: `src-tauri/src/asr_worker.rs:1023-1053`, `:1243-1269`.

The current missing piece is only the worker dispatch: `native-asr/src/main.cpp:140-147` rejects every non-CTranslate2 route.

## Recommended public module shape

Keep upstream opaque handles and function pointers private to the `.cpp`. Expose only Hikaru-owned types.

```cpp
namespace hikaru_asr::crisp {

struct Word {
  std::int64_t start_ms;
  std::int64_t end_ms;
  std::string text;
};

struct NativeSegment {
  std::string text;
  std::int64_t raw_start_ms;
  std::int64_t raw_end_ms;
  std::vector<Word> words;
};

struct AlignmentWord {
  std::int64_t start_ms;
  std::int64_t end_ms;
  std::string text;
};

struct Result {
  std::vector<NativeSegment> source_segments;
  std::vector<AlignmentWord> alignment;  // Qwen only; raw copied entries
};

using ProgressCallback = std::function<void(std::int64_t processed_ms)>;
using SegmentCallback = std::function<void(const Segment&)>;

class CrispAsrBackend {
 public:
  explicit CrispAsrBackend(BackendConfig config);
  ~CrispAsrBackend();

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

This is a capability/result boundary, not a subtitle-policy boundary:

- the core returns one copied source-segment shape with native words nested under their owning segment;
- Qwen additionally returns copied raw ForcedAligner entries;
- T10/T11 remain responsible for deciding how native words/alignment become subtitle segments;
- protocol emission may use only entries that already satisfy protocol shape; it must never fabricate duration.

A separate `CrispAsrLibrary` public class is unnecessary. Keep the `LoadLibraryExW` handle and function table inside `Impl`, as T03 did at `.trellis/tasks/archive/2026-08/07-25-native-asr-crispasr-poc/research/poc-src/src/main.cpp:287-359`.

## Dispatch shape in `main.cpp`

Preserve the CTranslate2 branch behavior and exit codes. The lowest-risk split is:

```text
run_worker(request)
  if backend == CTranslate2 -> existing body, unchanged
  if backend == CrispAsr and compile gate enabled -> run_crispasr(request)
  otherwise -> existing route_not_implemented / exit 2
```

The existing stdout discipline must remain centralized through `Emitter`, which validates and serializes every event before writing JSONL (`native-asr/src/main.cpp:33-50`). Existing exit meanings should remain:

- `2`: rejection before `ready`;
- `20`: structured backend/runtime failure;
- `74`: protocol event emission failure.

Evidence: `native-asr/src/main.cpp:140-153`, `:191-223`, `:230-239`.

### CrispASR route sequence

1. Resolve the explicit protocol roles; never infer route from filenames.
2. Normalize Windows canonical `\\?\` paths using the already proven helper logic at `native-asr/src/main.cpp:89-97` before passing narrow C strings to CrispASR.
3. Validate audio as 16 kHz mono PCM16 and decode to float PCM.
4. Validate model is a regular file. Qwen must have a regular-file aligner before backend construction.
5. Verify the exact permitted `crispasr.dll` size/SHA-256, then load it from the worker directory with safe DLL-search flags and bind all required exports.
6. Verify advertised logical backends and open one explicit session. Reazon uses upstream backend string `parakeet`.
7. Verify `crispasr_session_backend()` matches the expected upstream backend.
8. Enforce the internal minimum development device invariant. An unapproved/CPU-only runtime under CUDA fails before `ready`; full checkpoint identities remain evidence-runner data.
9. Construct `Emitter`, then emit `ready { backend: crispasr, device: request.device }`; this is request equality under the frozen development envelope, not a resolved-device getter claim.
10. Register callback guards and call `transcribe_lang(..., "ja")`.
11. Copy final result getters. If preview callbacks differ from the final eligible segment sequence, emit one `segmentsReplace`.
12. For Qwen, call the required aligner and copy its flat entries; fail closed if unavailable/invalid.
13. Emit `completed` only after all protocol-eligible output and cleanup-sensitive copying succeeds.

## Review finding: Qwen policy boundary

**Severity: high.** T09's PRD simultaneously requires the Qwen route behind worker dispatch and defers Qwen alignment/grouping policy to T11. The public aligner returns flat character/word entries, not source-grouped protocol segments. T03's accepted Qwen timeline required an explicit pinned grouping algorithm, and medium/long still failed closed.

Therefore the stable T09 backend interface must carry both raw source segments and raw alignment entries. Planning must choose one explicit T09 worker behavior:

1. **strict boundary (smallest and recommended):** the Qwen route reaches the shared backend, proves session/alignment ownership, and returns a structured post-backend failure when no already-legal protocol timeline exists; T11 later supplies grouping policy; or
2. **completed Qwen job in T09:** move the exact grouping rule into T09, which is a scope transfer from T11 and must be stated as such.

Silently accepting session-native Qwen timing or inventing non-zero durations is not acceptable.

## Progress and replacement mapping seam

Do not put protocol JSON construction inside `CrispAsrBackend`. The backend should report Hikaru `Segment` values through callbacks and return copied final values. `run_crispasr` owns protocol events, matching the existing CTranslate2 pattern at `native-asr/src/main.cpp:195-213`.

Normalization rules:

- upstream callback centiseconds convert with checked `* 10` to milliseconds;
- progress sample counts convert against 16 kHz, clamp to duration, and preserve monotonicity;
- callbacks copy text before returning;
- invalid/unsorted/out-of-bounds callback items are not emitted and turn into a structured backend failure;
- final result is independently copied and validated;
- any difference between emitted preview and final eligible sequence produces `segmentsReplace`.

The protocol layer already validates replacement count, order, and duration bounds (`native-asr/src/protocol.cpp:634-646`).

## Audio/path reuse decision

The current verified WAV parser is private inside `ctranslate2_whisper.cpp` (`native-asr/src/ctranslate2_whisper.cpp:65-68`, `:119-190`), while only duration is public (`:1089-1090`). CrispASR needs the actual float PCM.

Final plan: move the existing parser unchanged into one neutral `wav_audio` module and let both backends wrap its structured audio failures. Preserve CT2 externally observed error codes and fixtures so the extraction is behavior-neutral.

Do not call CrispASR with arbitrary WAV bytes or introduce FFmpeg into the worker. The trust-boundary validation must remain.

Path risk: Rust canonicalization can yield Windows verbatim paths (`src-tauri/src/asr_worker.rs:187-206`, `:298-305`), while CrispASR consumes narrow `const char*` model paths and uses narrow file APIs. Reuse the existing verbatim-prefix stripping semantics and add a Unicode/UNC test rather than creating a new path policy.

## CMake boundary

Current target facts:

- protocol/fake targets build unconditionally: `native-asr/CMakeLists.txt:66-79`;
- the real `hikaru-asr-worker` is currently created only inside `HIKARU_ASR_BUILD_CT2_WORKER`: `:81-98`, `:260-261`;
- CTranslate2 core/tests are separate static/executable targets: `:241-264`;
- CTest registers one backend self-check when CT2 is enabled: `:310-324`;
- default protocol preset has CT2 off, and only explicit CT2 presets enable it: `native-asr/CMakePresets.json:10-42`.

Minimal T09 addition:

```text
HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=OFF
```

For T09, require `HIKARU_ASR_BUILD_CT2_WORKER=ON` when this option is enabled. That keeps one existing worker executable and avoids a premature CrispASR-only worker configuration. Add:

```text
hikaru-asr-wav-audio            STATIC wav_audio.cpp
hikaru-asr-crispasr             STATIC crispasr_backend.cpp
hikaru-asr-fake-crispasr-abi    SHARED fake_crispasr_abi.cpp
hikaru-asr-fake-crispasr-broken SHARED fake_crispasr_abi.cpp (required export omitted)
hikaru-asr-crispasr-tests       EXE crispasr_backend_tests.cpp
CTest: crispasr-backend-core
```

The wrapper should dynamically load the separately pinned CPU/CUDA CrispASR runtime; do not `add_subdirectory` the entire upstream project into Hikaru's CMake graph. This avoids cache-option collisions with the already complex pinned CTranslate2 build and lets one worker binary test CPU and CUDA DLL identities.

Do not add a tracked task-rooted preset. Configure the ignored task-local build with explicit `cmake -S/-B` arguments or an ignored `CMakeUserPresets.json`. Keep `windows-x64-release` and existing CT2 presets unchanged and add a negative test/cache assertion that normal CT2 Release keeps the CrispASR gate off and rejects the route.

## Deterministic native test seam

A tiny fake ABI DLL is the smallest no-model way to cover the required lifecycle and mapping behavior. It should export only the bound subset and expose deterministic scenarios through the model filename or a test-only control export that the production wrapper never binds.

Minimum cases:

1. all required exports load; one session/result closes/frees exactly once;
2. missing export -> `crispasr_abi_mismatch` before ready;
3. session open null -> model-load structured error;
4. transcribe null -> structured error and session cleanup;
5. callback text is copied; callbacks are cleared before context destruction;
6. callback progress regression is normalized/rejected deterministically;
7. preview equals final -> no replacement;
8. preview differs from final -> one final replacement sequence;
9. invalid final segment -> fail closed;
10. Qwen missing aligner rejected before session open;
11. Qwen align result null/invalid -> no accepted timed output and exact cleanup;
12. requested CUDA with CPU-only fake module envelope -> device failure before ready.

Protocol route/sequence cases already live in `protocol_tests.cpp`; do not duplicate them in the backend suite. Process-tree cancellation already has fake-worker and real-worker host tests.

## Rust host model-backed seam

The real-host test harness is reusable, but its env parser is CT2-specific:

- `ProductionWorkerInputs` assumes one model and CT2-specific device/engine restrictions: `src-tauri/src/asr_worker.rs:1563-1651`;
- `production_launch` constructs only a single `model` role: `:1654-1683`;
- the selected-device host smoke already starts the real worker and validates terminal snapshot/segments through the real host: `:2146-2214`;
- real cancellation waits for `ready`, terminates the process, and proves no completed output: `:2368-2416`.

Do not widen the CT2 parser and risk its baselines. Add a sibling ignored-local parser using CrispASR-specific env variables:

```text
HIKARU_ASR_CRISPASR_INPUTS=<ignored-local JSON containing worker, locked model/optional aligner, audio/optional cancelAudio, device, and engine>
```

Reuse `NativeAsrHost`, `ResolvedNativeLaunch`, `FAKE_WORKER_TEST_LOCK`, terminal polling, stderr capture, and cancellation. Generalize the existing common launch helper to accept `Vec<(role, path)>`; keep the CT2 environment decoder and one CrispASR JSON decoder, but do not add a sibling lifecycle launcher.

No `src-tauri/tests` integration directory is needed; these seams already live in the `asr_worker.rs` test module.

## Release/default boundary

The product route is already safe if left untouched:

- `asr.rs` explicitly states Python/default routing remains the HTTP sidecar: `src-tauri/src/asr.rs:1-4`;
- native host activation is debug-only through `HIKARU_ASR_FAKE_WORKER`: `:106-122`;
- release builds return no native host and reject debug launch resolution: `:124-126`, `:213-219`;
- `start_asr` uses the native host only when that debug host exists, otherwise it follows legacy Python: `:600-630`.

T09 does not need an `asr.rs` production-routing edit. Model-backed tests instantiate `NativeAsrHost` directly.

## Review findings

1. **High — GPU device cannot be proven by the public ABI alone.** Keep accelerated routes behind the single ignored-local compile gate and fail closed on checkpointed module/performance/mutation evidence without a resolved-device claim.
2. **High — Qwen completion would pull T11 grouping policy into T09.** Preserve raw capability in the interface and make the worker behavior explicit.
3. **High — session ABI packaging/layout is fragile.** Dynamic-load an exact pinned subset; reject any export/layout drift before inference.
4. **Medium — current real-worker CMake target is nested under the CT2 option.** For T09, require CT2 worker ON rather than refactoring target topology; revisit only if a CrispASR-only worker becomes a real requirement.
5. **Medium — progress callbacks may be silent.** Segment/final/completed transitions must remain sufficient.
6. **Medium — canonical Windows path form may not be accepted by narrow upstream file APIs.** Reuse the existing prefix normalizer and test Unicode/UNC.
7. **Low — observed preview/final equality does not prove replacement never occurs.** Always compare and support `segmentsReplace`.

## Residual risks

- No public resolved-device getter remains the largest development-device evidence limitation.
- No separate ForcedAligner model-open ABI means full aligner validity is learned only at alignment time.
- Qwen medium/long legality remains a T11 blocker; T09 must not convert it into a core-backend failure claim.
- Reazon's official upstream session backend string is counterintuitive (`parakeet`) and needs an explicit unit assertion to prevent regression.
- A dynamic CUDA runtime has transitive DLL dependencies; direct DLL presence checks must include the complete frozen dependency/module envelope.
- If the shared WAV parser is extracted, CTranslate2 audio error codes and parsing behavior require a no-diff self-check.
