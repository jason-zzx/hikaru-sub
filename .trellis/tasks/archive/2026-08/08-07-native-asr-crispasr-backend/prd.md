# Build CrispASR backend core

## Goal

Add the shared CrispASR backend core to the existing isolated `hikaru-asr-worker` so later Parakeet/ReazonSpeech and Qwen3-ASR productization tasks can reuse one safe, testable native execution path. T09 also establishes an ignored-local development GPU lane; it does not qualify an engine, change Release/default routing, or solve model-specific subtitle quality.

## Background

- T04/T05 already provide protocol v1, fake-worker coverage, the Rust job host, process-tree cancellation, recovery snapshots, and unchanged React/Tauri job contracts.
- T03 proved that pinned CrispASR v0.8.22 and its public Windows x64 CPU C ABI can execute Parakeet, ReazonSpeech, Qwen3-ASR, and ForcedAligner model paths in an isolated process.
- T03C is the current `long-v2` quality authority: ReazonSpeech is `proceed-with-named-risks`; Parakeet and Qwen remain `stop-revise`. Those dispositions are inputs to T10/T11, not T09 acceptance gates.
- T06 provides the production worker entry point and CTranslate2 backend pattern. Existing CTranslate2 behavior must remain unchanged.
- Release/default remains Python legacy until later engine, runtime-pack, routing, UI, and release-cutover tasks pass their own gates.
- Pinned CrispASR v0.8.22 exposes `crispasr_set_gpu_backend()` only as a preference and has no public resolved-compute-device getter; `crispasr_session_backend()` reports the logical model family, not CPU/CUDA/Vulkan execution.
- The pinned session ABI has no cooperative cancellation function. In-flight cancellation remains T05 hard process-tree termination, so ABI destructors cannot be required to run after cancellation.

## Requirements

### R1 — Shared backend scope

- Add one CrispASR backend implementation behind the existing worker route dispatch for `parakeet`, `reazonspeech-nemo`, and `qwen3-asr`.
- Keep model-specific segmentation, CER improvement, long-form compensation, and Qwen alignment policy owned by T10/T11.
- Reuse the existing worker protocol and host contracts instead of introducing another process or protocol.

### R2 — Public ABI and ownership safety

- Use only the pinned public CrispASR C ABI subset required for session creation, model loading, audio submission, transcription, progress/results, clearing registered external callbacks through their setters, and cleanup. Do not bind unrelated global progress/stream reset exports.
- Make ownership and lifetime rules explicit for sessions, result handles, strings/arrays, callbacks, and model resources.
- Invalid ABI/library/model combinations must fail with structured errors rather than crash or corrupt the host process.

### R3 — Protocol mapping

- Map backend readiness, monotonic progress, incremental segments when available, final `segmentsReplace` when results are corrected, completion, and structured errors to protocol v1.
- Preserve stdout JSONL discipline. Wrapper-owned stderr must not contain callback/result/alignment text, model bytes, credentials, or complete user-controlled paths; upstream verbosity stays zero, and retained model-backed stderr is private ignored-local evidence subject to privacy scans.
- Never synthesize Qwen timestamps when ForcedAligner output is unavailable or invalid.
- Under the approved strict boundary, T09 copies Qwen source results and raw ForcedAligner entries as backend capabilities but does not implement T11's character grouping/timeline policy. Raw entries require only non-negative, non-reversed ranges as unchanged capability evidence; they have no audio-end upper bound, are not clipped, and are never accepted as protocol subtitle timing. Evidence records the maximum tail overrun as a diagnostic risk. Until T11 supplies that policy, a real Qwen worker request completes backend/alignment ownership checks only by returning a stable structured post-backend `qwen_timeline_policy_not_implemented` failure with zero accepted timed output.

### R4 — Lifecycle and failure isolation

- Preserve one worker process per transcription job and T05 process-tree cancellation semantics.
- Every successfully acquired resource is released exactly once on success, structured failure, invalid output, and early initialization failure; resources never acquired have release count zero. Callback reset is required only after external callback registration completed, and every exact-once claim is derived from acquired/released counters.
- In-flight cancellation relies on Rust process-tree termination and OS process reclamation; T09 must not claim that `crispasr_session_close` or result destructors execute after hard termination.
- Backend failures must not require React or Tauri command-shape changes.

### R5 — Route and model readiness

- The worker validates route-specific model/aligner roles plus regular, non-empty files before `ready`; the model-backed runner and Rust test-input decoder validate exact locked size/SHA-256 before launching the worker. Missing/non-regular worker inputs fail before `ready`, while identity mismatch fails test/evidence setup before launch.
- Qwen readiness requires both the ASR model and ForcedAligner identity. Because the pinned ABI has no aligner-open handle, aligner load/content/execution failures discovered by `crispasr_align_words_abi` fail after `ready` with zero accepted timed output.
- The backend selected for a request must come from the validated protocol engine/backend route, never from model filenames or directory heuristics.

### R6 — Development GPU lane

- Establish an ignored-local CrispASR development GPU path on the declared Windows machine, preferring CUDA when the pinned CrispASR build supports it.
- Because the pinned public ABI cannot report a resolved compute device, the approved T09 development lane uses an external attestation envelope: forced backend preference, GPU-enabled build identity, required loaded GPU modules/device identity, paired speed evidence, and coordinated mutation rejection. It must not claim a first-class ABI-resolved device.
- CPU execution mislabeled as accelerated must fail closed under that evidence envelope.
- Evaluate the two real CrispASR execution families independently: `parakeet-family` uses ReazonSpeech as the representative `parakeet` backend route; `qwen3-family` uses Qwen3-ASR plus its required ForcedAligner as the representative `qwen3` route.
- For each family, compare paired CPU/GPU short-v1 and locked medium-v1 first-120-second samples with one cold plus three warm runs per device. Qwen timing includes both session transcription and ForcedAligner execution but does not require T11 grouping policy to succeed.
- Each family independently publishes exactly one development result: `development-gpu-ready` when both GPU warmed-median RTF values are at most 80% of paired CPU; `development-gpu-no-speedup` when valid GPU execution misses that rule; or `development-gpu-unavailable` only from a validated family discovery/configure/build/session-load/aligner-load/device failure envelope before formal measurement.
- A tracked stdlib acquisition orchestrator must be runnable before the native runner exists. Preparation has two reviewed phases: build/freeze the upstream CUDA runtime identity, then build/freeze the Hikaru worker/runner against that locked runtime identity. A validated non-timeout configure/build failure in either phase atomically emits indexed sanitized pre-runner failure envelopes for both families. Only after both identities are reviewed/frozen may the orchestrator run family discovery/formal acquisition through the native runner.
- Missing benchmark audio, model, aligner, toolchain, or other required local input is not evidence that a GPU is unavailable. Invalid, incomplete, drifted, timeout-only, or missing-input evidence publishes no result, blocks T09 acceptance/archive, and must be repaired or explicitly replanned with the user.
- T10 follows only `parakeet-family`; T11 follows only `qwen3-family`. One family cannot enable or disable the other's development device.
- CER, gaps, segmentation, and alignment quality do not decide either development-device result. They remain mandatory downstream quality inputs.

### R7 — Evidence and distribution boundary

- Freeze source/library commit, build flags, compiler/runtime identity, worker/runner hashes, model identities, device, checkpointed loaded modules, and benchmark input lock for retained model-backed evidence. T03's CPU DLL is historical ABI reference only; all formal CPU/GPU rows use one byte-identical CUDA-enabled worker/runner/runtime identity.
- Freeze an independently reviewed sanitized raw acquisition index immediately after measurement, binding each discovery/formal attempt file by family, case, device, role, size, and SHA-256 before aggregation. A formal file embeds the exact cold/warm repeat sequence, which the publisher validates internally. Publication rejects missing, extra, renamed, duplicate, reparse/symlink, or hash-drifted raw inputs.
- Development GPU artifacts and downloaded models remain ignored-local and are not installer, portable ZIP, managed runtime-pack, or T14/T15 qualification inputs.
- Do not add CrispASR/CUDA binaries, model weights, private benchmark media/text, credentials, or absolute user paths to source control.

### R8 — Compatibility and rollback

- Existing CTranslate2 routes and tests remain behaviorally unchanged.
- All CrispASR native routes remain disabled in Release/default after T09, regardless of development-device outcome.
- Rollback consists of disabling/removing the CrispASR backend route while retaining protocol, Rust host, and Python legacy behavior.

## Acceptance Criteria

- [x] A pinned CrispASR backend core builds in the existing native worker project without changing protocol v1 or Tauri/React contracts.
- [x] Deterministic fake-ABI tests cover session ownership, acquired-resource cleanup, route validation, progress normalization, segment/final replacement mapping, ABI/model errors, and Qwen aligner-required failure; separate Rust-host tests cover hard process cancellation/reap without claiming killed-process destructors executed.
- [x] Parakeet, ReazonSpeech, and Qwen route requests reach the shared backend through explicit validated dispatch; Qwen can fail after valid alignment capability with zero timed output until T11 supplies grouping policy, and no model-specific product quality behavior is pre-implemented.
- [x] Existing protocol, fake-worker, CTranslate2 CPU/CUDA, Rust host, and frontend build/test baselines remain green; the normal CT2 Release worker explicitly rejects a CrispASR request as `route_not_implemented`, and its CMake cache keeps CrispASR development disabled.
- [x] Model-backed smoke evidence runs through the real Rust host without leaking benchmark text, weights, credentials, or machine-specific paths into tracked artifacts.
- [x] The two family-scoped development device assessments are produced by the frozen runner contract, deterministic, mutation-checked, independently reviewable, and each publishes exactly one truthful result under its own frozen identity; a no-result state is incomplete and cannot be accepted or archived.
- [x] CPU execution cannot be accepted as GPU through request labels, environment mutation, module-role swaps, or evidence field rewrites.
- [x] No production/default routing, installer, portable package, managed runtime pack, downloader, settings, or UI change is made.
- [x] T10/T11 receive a handoff containing the stable backend interface, supported result/timestamp capabilities, development-device result, known limitations, and authoritative T03C quality dispositions.

## Out of Scope

- Qualifying or enabling any CrispASR engine for production.
- Fixing Parakeet CER or giant-segment behavior.
- Fixing ReazonSpeech segmentation/zero-duration word behavior.
- Fixing Qwen medium/long segment legality or ForcedAligner accuracy.
- Formal CUDA/Vulkan runtime packs, fallback policy, installer/portable integration, model download UI, settings migration, or release cutover.
- Re-running or rewriting T03/T03C historical evidence except for narrowly required T09 smoke/performance input.
