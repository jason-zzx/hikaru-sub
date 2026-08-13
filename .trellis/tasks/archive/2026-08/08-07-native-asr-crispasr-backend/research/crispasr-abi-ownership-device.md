# CrispASR v0.8.22 ABI, ownership, and device findings

## Scope and method

Read-only inspection only. No model inference was run. Evidence comes from the pinned v0.8.22 source snapshot under this task, the archived T03 public-ABI PoC, and the current native worker/host code.

## Final planning resolutions

The reviewed `prd.md` / `design.md` supersede any narrower implementation suggestion below: verify the exact permitted runtime DLL hash before loading; keep device validation private to the backend; collect full module identities at post-session/post-transcribe/post-align checkpoints in the evidence runner; publish no resolved-device claim; use one CUDA-enabled runtime identity for both formal CPU/GPU rows; and treat complete Qwen aligner discovery failure as family-unavailable evidence while missing inputs remain no-result blockers.

Pinned identity already established by T03:

- tag/version `v0.8.22`, commit `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`;
- public session-header SHA-256 `cdefd19f6f208ed3f77f31c1cc8df19224c1c81ed5e0e6064650a827000c68df`;
- CPU runtime DLL SHA-256 `aa5d08f8cfe459727764bbe724b0780a75bd4167043c9cf63fd0fb43c2a559de`.

Evidence: `.trellis/tasks/archive/2026-08/07-25-native-asr-crispasr-poc/research/abi-contract.md:5-11`.

## Exact minimum public ABI subset

Use runtime symbol resolution rather than a direct compile/link dependency. The official Windows library archive omitted `include/crispasr_session.h`, while T03 successfully compiled against the pinned source header and resolved exports from the DLL at runtime (`abi-contract.md:11`). Runtime binding also gives a deterministic structured failure when the DLL, dependency, or export set is wrong.

### Common session path

Required for all three routes:

```text
crispasr_session_available_backends
crispasr_session_open_with_params
crispasr_session_backend
crispasr_session_set_progress_callback
crispasr_session_set_segment_callback
crispasr_session_transcribe_lang
crispasr_session_result_n_segments
crispasr_session_result_segment_text
crispasr_session_result_segment_t0
crispasr_session_result_segment_t1
crispasr_session_result_n_words
crispasr_session_result_word_text
crispasr_session_result_word_t0
crispasr_session_result_word_t1
crispasr_session_result_word_p
crispasr_session_result_free
crispasr_session_close
```

Public declarations are visible at:

- callback contracts: `.trellis/tasks/08-07-native-asr-crispasr-backend/research/local/upstream/CrispASR-cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/include/crispasr_session.h:64-97`;
- session open/transcribe: same file `:214-240`;
- final segment/word getters: same file `:310-318`;
- result cleanup: same file `:336` (immediately after the shown getter block; implementation at `src/crispasr_c_api.cpp:7404-7406`);
- session cleanup implementation: `src/crispasr_c_api.cpp:9501-9523` and following backend-specific cleanup.

T09 must not bind `crispasr_session_set_token_callback`. Token callbacks cannot directly produce legal timed protocol segments, T10/T11 own model-specific assembly, and the frozen T09 lifecycle registers/resets exactly the progress and segment setters only.

### Qwen aligner capability

Required only for `qwen3-asr`:

```text
crispasr_align_words_abi
crispasr_align_result_n_words
crispasr_align_result_word_text
crispasr_align_result_word_t0
crispasr_align_result_word_t1
crispasr_align_result_free
```

Evidence: pinned header `include/crispasr_session.h:273-280`.

The aligner returns a flat sequence of borrowed text plus centisecond ranges. It does **not** return protocol-ready source-segment grouping. T03 had to apply pinned upstream grouping policy after copying the alignment entries; that policy belongs to T11, not the T09 shared ABI layer (`abi-contract.md:105-114`).

### GPU selection capability

Additional public export for the ignored-local development GPU lane:

```text
crispasr_set_gpu_backend("cuda" | "vulkan")
```

It must be called before session open. Evidence: pinned header `include/crispasr_session.h:210-212`; implementation `src/crispasr_c_api.cpp:3753-3757`.

## Open-parameter ABI hazard

**Severity: high.** `crispasr_open_params_v1` is only forward-declared by the public header but its concrete v2 layout lives in implementation source:

```c
struct crispasr_open_params_v1 {
  int abi_version;
  int n_threads;
  int use_gpu;
  int verbosity;
  int flash_attn;
  int n_gpu_layers;
  int reserved[6];
};
```

Evidence:

- public forward declaration: pinned header `include/crispasr_session.h:38-40`;
- concrete layout and semantics: `src/crispasr_c_api.cpp:3760-3770`;
- T03's independently declared exact v2 layout: `.trellis/tasks/archive/2026-08/07-25-native-asr-crispasr-poc/research/poc-src/src/main.cpp:32-43`.

Recommendation: keep this exact declaration private to `crispasr_backend.cpp`, `static_assert` total size/alignment and field offsets, and pin both source commit and header/source hashes in CMake. Do not expose this upstream struct through Hikaru's backend interface.

## Route-to-upstream-backend mapping

The protocol route must remain authoritative; do not call `crispasr_detect_backend_from_gguf` for dispatch.

| Hikaru engine | Explicit CrispASR backend string | Reason |
|---|---|---|
| `parakeet` | `parakeet` | direct pinned session backend |
| `reazonspeech-nemo` | `parakeet` | pinned CLI/detection maps the Reazon GGUF to `parakeet`; opening as `reazonspeech` exposed an upstream alias inconsistency |
| `qwen3-asr` | `qwen3` | direct pinned session backend |

T03 evidence for Reazon's required alias: `abi-contract.md:62`, and route discussion `abi-contract.md:98-103`.

After open, copy `crispasr_session_backend()` and require it to equal the explicit expected upstream backend before emitting `ready`.

## Ownership and lifetime rules

| Value | Ownership rule | Required wrapper behavior |
|---|---|---|
| loaded DLL module | wrapper-owned | `FreeLibrary` only after all sessions/results/callbacks are gone |
| `crispasr_session*` | caller-owned | close exactly once with `crispasr_session_close`; null is safe |
| `crispasr_session_result*` | caller-owned | copy all used fields, then free exactly once |
| result segment/word strings | borrowed from result | copy immediately to `std::string`; never retain across result free |
| `crispasr_align_result*` | caller-owned | copy entries, then free exactly once |
| aligner text strings | borrowed from aligner result | copy before aligner result free |
| callback text | borrowed for callback duration only | copy synchronously before callback returns |
| callback `user_data` | stored, not copied | keep context alive through transcribe; clear callback registrations before context destruction |
| PCM input | caller-owned during call | keep the decoded `std::vector<float>` alive until transcribe/alignment returns |

Evidence:

- upstream callback pointer lifetime: pinned header `include/crispasr_session.h:76-85`;
- upstream callback storage: `src/crispasr_c_api.cpp:4833-4853`;
- result deletion: `src/crispasr_c_api.cpp:7404-7406`;
- session cleanup: `src/crispasr_c_api.cpp:9501-9523`;
- T03 exact-once evidence: archived `abi-contract.md:79-90` and `crispasr-poc-report.md:119-123`;
- T03 scope guard registered callbacks at `poc-src/src/main.cpp:535-539` and cleared them before context destruction at `:542-548`.

Important nuance: setting segment/token callbacks to null restores CrispASR's internal default callbacks rather than leaving them absent (`src/crispasr_c_api.cpp:4841-4853`). That is safe only while the session is alive because the restored `user_data` is the session itself. Therefore reset external callbacks first, destroy callback context second, close session third, unload DLL last.

## Failure mapping

The public session ABI mostly reports failure as null pointers or integer sentinels; it does not provide a structured error object. Do not copy arbitrary native diagnostics to stdout. Use stable wrapper-owned codes and keep native detail on stderr.

Recommended stage codes:

| Stage | Stable code |
|---|---|
| DLL missing/unloadable | `crispasr_library_load_failed` |
| required export missing | `crispasr_abi_mismatch` |
| requested logical backend absent | `crispasr_backend_unavailable` |
| upstream backend mismatch after open | `crispasr_backend_mismatch` |
| model file invalid or session open null | `crispasr_model_load_failed` |
| transcribe returns null | `crispasr_transcribe_failed` |
| result getter shape/timing invalid | `crispasr_result_invalid` |
| required Qwen aligner missing | existing protocol `missing_model_role` before backend construction |
| aligner returns null | `crispasr_alignment_failed` |
| aligned data cannot support legal output | `crispasr_alignment_invalid` |
| requested accelerated device cannot be attested | `crispasr_device_unavailable` |

## Cancellation

**Severity: medium, known limitation.** Pinned v0.8.22 exposes no cooperative cancellation/abort API (`abi-contract.md:123`). Do not invent a cancellation callback that implies mid-call interruption. The real cancellation contract remains termination of the one-worker-per-job process tree in the Rust host (`src-tauri/src/asr_worker.rs:712-758`). Backend code may check cancellation before open/before transcribe/after return for deterministic unit tests, but the only reliable in-flight stop is process termination.

## Progress and final-result mapping

**Severity: medium.** The progress callback is monotonic by contract for supported chunked paths, but it is not universal, and T03 observed zero progress callbacks even on long runs (`crispasr-poc-report.md:123`). Therefore:

1. normalize callback sample counts as `processed_ms = floor(processed * 1000 / 16000)` and clamp to `[last_processed_ms, duration_ms]`;
2. emit no progress event when the callback is silent;
3. let segment end times advance product progress in the existing Rust host (`src-tauri/src/asr_worker.rs:1224-1237`);
4. completion remains the final 100% transition.

Observed segment callbacks matched final getters, but correction/replacement was not observed (`crispasr-poc-report.md:122`). The wrapper should still retain copied preview segments, copy final getters, compare the two, and request `segmentsReplace` whenever the final sequence differs.

## Device selection and attestation

### What the pin actually exposes

- `use_gpu=0` forces CPU; T03 attested CPU with `n_gpu_layers=0`, `flash_attn=0`, restricted PATH, and loaded-module inventory (`crispasr-poc-report.md:29`).
- `use_gpu!=0` means "GPU when available", not "GPU required" (`src/crispasr_c_api.cpp:3760-3769`).
- GPU opens lazily call `ggml_backend_load_all()` (`src/crispasr_c_api.cpp:1569-1575`, `:2376-2377`).
- source builds accept `GGML_CUDA`; Parakeet and Qwen link `ggml-cuda` when enabled (`src/CMakeLists.txt:1034-1037`, `:1065-1067`). Reazon uses the Parakeet backend.
- `crispasr_set_gpu_backend("cuda")` is a preference, not a strict requirement. If no preferred device is found, upstream warns and falls back to automatic selection (`src/core/gpu_backend_pref.h:62-68`, `:117-123`).
- no public export returns the resolved compute device. `crispasr_session_backend()` returns the logical model backend only.

### Review finding: false acceleration attribution

**Severity: high.** A request label plus successful session open is insufficient to claim CUDA/Vulkan. Upstream can silently fall back, and the public ABI has no resolved-device getter.

Minimum fail-closed development policy:

1. CPU lane: `use_gpu=0`, `n_gpu_layers=0`, no GPU preference.
2. CUDA lane: call `crispasr_set_gpu_backend("cuda")`, use `use_gpu=1`, and keep the CUDA build/runtime in ignored-local task storage.
3. Enumerate loaded modules after session open using the same PSAPI pattern proven by T03 (`poc-src/src/main.cpp:818-832`). Require the frozen CUDA module/runtime envelope; absence means `development-gpu-unavailable`.
4. Record requested device, module identities, worker/DLL hashes, CUDA toolchain identity, and paired benchmark inputs.
5. Run the mandatory mutation checks: CPU-only DLL under a CUDA request, removed/renamed CUDA module, CPU open params relabeled as CUDA, and evidence-field rewrite. Each must fail.
6. Publish `development-gpu-ready` only from the PRD's paired warmed-median RTF rule. Module presence alone never produces `ready` status.

Residual limitation: module presence plus a preferred backend still does not provide a first-class public "this graph executed on CUDA" getter. That is acceptable only for the ignored-local development result combined with performance and mutation evidence; it is not a production routing proof.

## Residual risks

1. **High — no public resolved-device getter.** Development GPU evidence can be made fail-closed, but the ABI itself cannot provide production-grade device attestation.
2. **High — public package/header mismatch.** The Windows archive omitted the session header, and the open-params layout is implementation-defined source. Every build must pin hashes and fail on export/layout drift.
3. **High — Qwen output policy boundary.** The ABI provides raw aligner entries, not protocol-ready grouped segments. T09 must expose capability without silently implementing T11 policy.
4. **Medium — aligner readiness.** The public ABI has no separate aligner-open handle; an unloadable aligner is discovered only when `crispasr_align_words_abi` is called. Pre-`ready` validation can prove file/identity presence, not full aligner execution.
5. **Medium — progress may remain silent.** Product progress must continue to tolerate no backend progress callbacks.
6. **Medium — path encoding.** CrispASR accepts narrow `const char*` paths and uses narrow file opens. The Rust host may provide Windows canonical verbatim paths; use the existing `\\?\`/UNC normalization logic before calling the DLL and add a non-ASCII path test.
