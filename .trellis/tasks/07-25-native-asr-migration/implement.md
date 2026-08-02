# 原生 ASR 迁移实施总计划

> 状态：父任务保持 `planning`；T01～T03 均已完成并归档，Gate 0 backend/runtime feasibility 已关闭；T04～T06 已创建并进入规划。父任务不直接启动实现。

## Execution Policy

- 本父任务保存总需求、总体设计、任务地图和跨任务门禁，通常不执行 `task.py start`。
- 子任务按阶段及时创建，不一次性把 17 个任务全部置为活跃；创建近期任务时使用 `--parent <parent-dir> --no-start`。
- 每个子任务在启动前必须完成自己的 `prd.md`、`design.md`、`implement.md` 和上下文清单。
- 任务树不表达依赖。下表的 `Depends on` 必须复制到对应子任务规划。
- 一个子任务只有在自己的验收和相关质量检查通过后才能归档。
- 本仓库未经用户单独明确授权不得提交。归档使用 `task.py archive <task> --no-commit`。

## Phase And Gate Overview

```text
Gate 0: feasibility
  T01 -> T02 + T03

Gate 1: native task foundation
  T02 + T03 -> T04 -> T05

Gate 2: engine productization
  T05 -> T06 -> T07 + (T08 -> T09 + T10)

Gate 3: models, CPU/GPU runtime and UI
  T02 + T03 -> T11
  T06 -> T12
  T06 + T08 + T12 -> T13
  T07 + T09 + T10 + T13 -> T14
  T05 + T11 + T12 + T14 -> T15 -> T16

Gate 4: release cutover
  T06..T16 -> T17
```

Allowed parallel groups:

- T02 and T03 after T01.
- T06 after T05; T07 and T08 may overlap after T06 creates the production worker entry point.
- T09 and T10 may overlap after T08 stabilizes the CrispASR core.
- T11 may start from the proven model formats and overlap engine productization; T12 waits for T06 to create the production worker target, then may overlap T07/T08～T10.
- T13 after the shared CT2/CrispASR cores and CPU package contract stabilize; T14 after engine pipelines and GPU packs are measurable.
- GPU pack failure records `stop-revise` and omits that pack from release without blocking the qualified CPU route.

## Task Map

### Phase 0 - Ground Truth And Feasibility

#### T01 - Establish Native ASR Benchmark Ground Truth

Suggested slug: `native-asr-benchmark-baseline`

Deliverables:

- Freeze the user-provided `.asr-benchmark` short/medium/long WAV+ASS identities, reference semantics, privacy rules and metric schema as the only quality truth.
- Record the confirmed 24.102s/8, 498.872s/165 and 4144.235s/908 Dialogue metadata without copying local subtitle text or media.
- Implement shared absolute CER, confirmed-speech-gap, timeline, Qwen alignment, timing, performance and resource scoring.
- Publish the user-reviewed frozen absolute budgets: CER `<=0.35` per engine/case; CPU RTF `<=1.0`; GPU-accelerated RTF `<=0.5`; short cold wall `<=120s`; CTranslate2 RSS `<=6 GiB`; CrispASR RSS `<=12 GiB`; no VRAM gate.
- Capture current Python engine results only as optional diagnostic/current-implementation references; publish `python-reference-report.md` only after valid runs.

Depends on: none.

Exit criteria:

- Ground-truth manifest/reference/metrics and deterministic comparison are reviewed and reusable by T02/T03.
- Hard gates retain 0 invalid timeline, 0 confirmed gap `>=1.5s`, and Qwen median/P95 limits.
- Python limitations are documented but do not block native quality comparison.
- No private media, ASS text, credentials, absolute paths or model weights enter source control.

Validation:

```text
Existing Python sidecar tests
Ground-truth harness self-checks
Local authoritative manifest validation
Optional Python reference report
```

Rollback point: no production path changes.

#### T02 - Prove CTranslate2 Whisper And Kotoba PoC

Suggested slug: `native-asr-ctranslate2-poc`

Deliverables:

- Minimal pinned CMake build using CTranslate2 C++ Whisper API.
- Run large-v3 and Kotoba v2.0 on T01 authoritative cases; T02 remains a general CT2 feasibility scope.
- Choose tokenizer/mel/timestamp/decode direction from official APIs/model cards and maintained community practice, then measure against ground truth.
- Record current Python outputs only as optional diagnostics; their absence or parity does not decide feasibility.
- Measure CPU runtime footprint, RTF and memory without changing application defaults.

Depends on: T01 ground-truth contract and metric handoff; optional Python reference is not required.

Exit criteria:

- Both engines produce legal Japanese segment timelines and ground-truth measurements.
- Kotoba model-card/readiness obligations are understood without treating current Python chunking as the native template.
- PoC reports measured/pass/fail/blocked against the frozen T01 gates, without treating Python diagnostics as expected output or claiming later productization gates are complete.
- No unresolved licensing or binary-distribution blocker.

Rollback point: discard PoC without touching production ASR.

Verified T02 Gate 0 result:

- Pinned CTranslate2 4.8.0 + oneDNN 3.1.1 Windows x64 CPU runtime is viable for both large-v3 and Kotoba without Python/CUDA; all six short/medium/long runs have legal token-derived timelines and stay within CPU RTF/RSS budgets.
- Current minimal fixed-window algorithm is `stop-revise`: large-v3 short misses CER (`0.3583 > 0.35`), and both routes fail medium/long confirmed-speech-gap gates. Only Kotoba short passes every gate.
- T06 may continue with CTranslate2 as backend candidate, but must revise long-form seek/VAD/segmentation/decode behavior and remeasure against T01 before productization.

#### T03 - Prove CrispASR Three-Engine PoC

Suggested slug: `native-asr-crispasr-poc`

Deliverables:

- Pin CrispASR and exercise its public C ABI.
- Run Parakeet JA Q8_0, ReazonSpeech Q8_0 and Qwen3-ASR Q4_K with ForcedAligner Q4_K on T01 authoritative cases.
- Record segment/progress/final-refresh behavior, long-audio limits, runtime footprint and model licenses; current Parakeet, Qwen3 and ReazonSpeech refresh behavior is diagnostic only.
- Select chunking/VAD/segmentation from official/model-card/maintained community guidance and ground-truth results, not Python parity.

Depends on: T01 ground-truth contract and metric handoff; optional Python reference is not required.

Exit criteria:

- All three engines produce legal Japanese timelines and direct ground-truth measurements or explicit native blockers.
- Qwen3 timing comes from the aligner, not synthetic averaging.
- Known long-audio coverage gaps and required compensation are ground-truth and authoritative-source backed.
- Each route reports measured/pass/fail/blocked against the frozen T01 gates without claiming later productization work is complete.

Rollback point: discard PoC without affecting CT2 work or production ASR.

Verified T03 Gate 0 result:

- CrispASR v0.8.22 public CPU C ABI, callback/reset/cleanup lifecycle and all three model routes are executable under one immutable Windows x64 binary/runtime identity.
- Reazon passes frozen text/performance/timeline/gap gates through the public `parakeet` backend but remains `proceed-with-named-risks` because its top-level output is one oversized segment and native words are mostly zero-duration.
- Parakeet is `stop-revise` after all three cases fail CER and top-level output remains one giant segment, despite useful native word getters.
- Qwen is `stop-revise`: short text/performance pass but ForcedAligner start timing fails severely; medium/long upstream-grouped zero-duration source segments fail closed. Synthetic timing remains prohibited.

**Gate 0:** Closed for backend/runtime feasibility. T04/T05 may proceed because CT2 and CrispASR can execute safely in isolated native processes. Route quality blockers are mandatory inputs to T06/T07/T09/T10 and still prevent production promotion; a future finding of fundamental ABI, license or package non-viability reopens Gate 0.

### Phase 1 - Worker Protocol And Rust Task Foundation

#### T04 - Build Worker Protocol And Fake Worker

Suggested slug: `native-asr-worker-protocol`

Deliverables:

- Create the focused `native-asr/` project and protocol v1 request/event types.
- Implement request validation, stdout JSONL discipline and stderr diagnostics.
- Provide deterministic fake-worker scenarios for success, progress, segment replacement, structured error, malformed output, crash and cancellation.
- Add CTest protocol and normalization coverage without model downloads.

Depends on: T02, T03.

Exit criteria:

- Protocol behavior is versioned and tested independently of real models.
- Fake worker can drive every host lifecycle branch needed by T05.

Rollback point: protocol has no production command wiring yet.

#### T05 - Replace HTTP Proxy With Native Rust Job Host

Suggested slug: `native-asr-rust-job-host`

Deliverables:

- Implement single-active-job state and worker process lifecycle in Rust.
- Preserve existing Tauri command names and `AsrJobSnapshot` shape.
- Parse/reduce JSONL events, write recovery snapshots, terminate the process tree on cancel/exit and classify abnormal exits.
- Keep a development-only Python legacy path for comparison.
- Cover all lifecycle branches with the fake worker.

Depends on: T04.

Exit criteria:

- Success/progress/replace/error/cancel/crash tests pass without models.
- Cancellation exits within two seconds in tests.
- React contracts require no product-flow rewrite.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

Rollback point: keep production default on Python legacy until engine gates pass.

**Gate 1:** Do not productize model backends until host lifecycle and recovery behavior are deterministic under fake-worker tests.

### Phase 2 - CTranslate2 Productization

#### T06 - Productize CTranslate2 Faster-Whisper

Suggested slug: `native-asr-ctranslate2-whisper`

Deliverables:

- Create the production `hikaru-asr-worker` CMake executable/entry point on top of T04's protocol library; fake worker remains a separate test-only target.
- Implement product-model WAV/features/tokenizer/prompt/window/timestamp/no-speech/alignment behavior from official CTranslate2/Whisper sources and maintained recommendations.
- Enumerate and measure every current ordinary faster-whisper model (`tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, `large-v3-turbo`) against T01 ground truth; `large-v3` and `large-v2` Japanese audio over 10 minutes are hard promotion gates, including the current V4/seed/session special-path regression cases.
- Treat current Python parameters and private fork as diagnostics, not required native algorithms.
- Normalize overlap into stable segments, emit monotonic progress, and publish model-backed absolute quality/performance/resource results.

Depends on: T02, T04, T05.

Exit criteria:

- `large-v3` and the required `large-v2` long-audio cases meet T01 user-reviewed absolute CER/RTF/resource budgets.
- Every other current model receives a measured `qualified`, `stop-revise` or `unsupported-for-native-release` disposition; failure of a non-default model does not block a qualified native faster-whisper route.
- No invalid/overflow timeline segments or confirmed speech gaps `>=1.5s` on qualified models.
- Large-v2 long-audio behavior is validated even if the selected native algorithm differs from Python.

Rollback point: retain Python faster-whisper as development default.

#### T07 - Productize Kotoba And Legacy CT2 Cache Compatibility

Suggested slug: `native-asr-kotoba-compatibility`

Deliverables:

- Implement Kotoba behavior from its pinned model card/stable APIs and T01 ground-truth results; current Python 15-second/no-context behavior remains diagnostic reference.
- Keep `preprocessor_config.json` readiness Kotoba-only.
- Resolve valid old Hugging Face CTranslate2 snapshots without copying them.
- Verify overlap and long-audio behavior directly against ground truth.

Depends on: T06.

Exit criteria:

- Kotoba meets T01 user-reviewed absolute quality/timing/resource gates.
- Ordinary faster-whisper readiness is not tightened accidentally.
- Old valid CT2 caches are reusable and malformed caches fail safely.

Rollback point: disable only Kotoba native routing.

### Phase 3 - CrispASR Productization

#### T08 - Build CrispASR Backend Core

Suggested slug: `native-asr-crispasr-backend`

Deliverables:

- Wrap the pinned public session/result/progress/segment/alignment C ABI subset.
- Map callbacks to protocol events with cancellation and safe ownership.
- Share audio/VAD/result normalization selected from stable CrispASR APIs and ground-truth evidence, without Python-parity product hacks.
- Record ABI/library commit in runtime manifest.

Depends on: T03, T05, T06.

Exit criteria:

- Backend opens/closes sessions safely and maps deterministic fake/native results to JSONL.
- ABI errors, invalid models and cancellation do not crash the host application.

Rollback point: keep all CrispASR engine routes disabled.

#### T09 - Productize Parakeet And ReazonSpeech

Suggested slug: `native-asr-parakeet-reazon`

Deliverables:

- Route Parakeet JA Q8_0 and ReazonSpeech Q8_0 through the shared backend.
- Validate native timestamps, subtitle segment size and short/medium/long coverage against T01 truth.
- Start from official/model-card/maintained community guidance; add only compensation demonstrated necessary by ground-truth failures.
- Support final `segmentsReplace` when the selected pipeline performs a final correction; do not assume refresh is Parakeet-only. Current Reazon `>=60s` 45s/2s-overlap behavior is a diagnostic regression case, not a required native algorithm.

Depends on: T08.

Exit criteria:

- Each engine meets T01 user-reviewed absolute CER/RTF/resource budgets.
- No confirmed speech gap `>=1.5s` and no invalid/out-of-bounds timeline.
- No Q4 Parakeet repeated-loop default is introduced.

Rollback point: engines switch independently; one failure does not disable the other.

#### T10 - Productize Qwen3 With ForcedAligner

Suggested slug: `native-asr-qwen3-aligner`

Deliverables:

- Treat Qwen3 1.7B Q4_K and ForcedAligner 0.6B Q4_K as one model product.
- Select chunking/alignment/segmentation from official/model-card/maintained community guidance and ground-truth results; Python synthetic or refresh behavior is diagnostic only.
- Fail when alignment is missing/invalid; never synthesize timestamps.
- Aggregate progress and allow a final `segmentsReplace` when required by the chosen pipeline.

Depends on: T08.

Exit criteria:

- Qwen3 meets T01 user-reviewed absolute CER/RTF/resource budgets.
- Start-time median <=150 ms and P95 <=500 ms against authoritative ASS timing.
- Missing companion, alignment failure, leading silence and chunk-boundary cases are tested; timeline remains legal.

Rollback point: disable only Qwen3 native routing.

**Gate 2:** Each engine is promoted independently only after its quality report passes. Failed CrispASR routes do not block already-qualified CT2 routes during development.

### Phase 4 - Models, Runtime And Settings Backend

#### T11 - Build Native Model Manifest And Downloader

Suggested slug: `native-asr-model-manager`

Deliverables:

- Add versioned `asr-model-sources.json` with fixed revision, URL, size, SHA-256, license and file roles.
- Implement official/China source resolution, safe `.part` resume, verification, atomic moves and multi-file readiness markers.
- Coalesce duplicate model downloads and preserve verified companion files after partial failure.
- Measure all of `deps/models`, including legacy cache, without marking incompatible weights ready.

Depends on: T02, T03.

Exit criteria:

- Routing/readiness/hash/atomic-install/legacy-cache/portable-path tests pass.
- Cleanup cannot escape managed `deps/`.
- No floating `main` is the sole release lock.

Rollback point: retain existing model downloader while native engines remain development-only.

#### T12 - Produce Reproducible CPU Runtime Package

Suggested slug: `native-asr-cpu-runtime-package`

Deliverables:

- Pin CTranslate2, CrispASR, compiler, CMake, Ninja and native dependencies.
- Build the reproducible CPU runtime packaging pipeline and a provisional integration artifact with worker/DLL/manifest/license/SHA-256 shape; do not claim its executable identity is final before T06～T10 land.
- Add verified artifact preparation hooks for `pnpm release:local` and portable packaging without switching production inputs.
- Compile only required ASR capabilities and measure provisional setup/portable/unpacked size.
- Define the T17 final rebuild/attestation input contract so accepted T06～T10 source identities produce the immutable release artifact.

Depends on: T04, T06.

Exit criteria:

- End-user packaging never invokes CMake.
- The packaging pipeline is reproducible and a provisional protocol/backend smoke artifact works in installed and portable layouts with zero bundled model weights.
- Provisional size measurement demonstrates the CPU budget is plausible; T17 must rebuild and re-attest the final worker after all accepted engine code lands.
- No provisional hash or executable is represented as the final release identity.

Rollback point: do not alter production packaging until artifact verification and size gates pass.

#### T13 - Build Optional GPU Runtime Packs

Suggested slug: `native-asr-gpu-runtime-packs`

Deliverables:

- Produce separately versioned Windows x64 CUDA and Vulkan runtime packs from the pinned native worker/backends without placing either pack in the main installer or portable ZIP.
- Keep CT2 CUDA and CrispASR CUDA/Vulkan dependencies isolated under `deps/asr-runtime/{cuda,vulkan}/current` with exact manifest, DLL, compiler, driver-floor, size, SHA-256, license and attribution identities.
- Reuse protocol v1 resolved device values (`cpu`, `cuda`, `vulkan`); do not introduce a second worker protocol or backend-specific host executable.
- Add deterministic pack preparation/verification suitable for managed download; end-user machines never compile native dependencies.

Depends on: T06, T08, T12.

Exit criteria:

- CUDA and Vulkan are each attempted and independently recorded as `candidate-built` or `stop-revise` with immutable build/load/license evidence; one failed candidate does not prevent T13 completion.
- Every `candidate-built` pack is reproducible, hash-verified, contains no models, and can load its intended backend on a declared target machine.
- CUDA/Vulkan DLL discovery cannot shadow unrelated system/application binaries or escape the managed pack root.
- Main setup/portable artifacts remain CPU-only and within their existing size budgets.
- Missing, invalid or `stop-revise` pack identity fails closed before worker launch.

Rollback point: remove the affected optional pack artifact/manifest; the bundled CPU runtime remains unchanged.

#### T14 - Qualify GPU Routing And Acceleration

Suggested slug: `native-asr-gpu-qualification`

Deliverables:

- Rebuild each T13 `candidate-built` pack from the final accepted T06～T10 source/config identities, freeze executable/DLL/manifest hashes, and use only that exact identity for qualification.
- Implement capability probing and resolved routing for the rebuilt candidate packs: CTranslate2 uses qualified CUDA or CPU; CrispASR uses qualified CUDA, then qualified Vulkan, then CPU.
- Record T13 `stop-revise`/unbuilt candidates as omitted without attempting to route them.
- Validate actual loaded modules and device execution rather than trusting a requested device string.
- Run the applicable T01 short/medium/long engine matrix on explicit hardware/driver identities; preserve the same CER/timeline/gap/Qwen gates and require accelerated inference RTF `<=0.5`.
- Verify pack-load/runtime failure produces one nonfatal notice and automatically retries the bundled CPU path without losing job/recovery semantics.
- Publish an independent `qualified`, `stop-revise` or `omitted-no-candidate` decision for CUDA and Vulkan; no non-qualified pack blocks CPU cutover.

Depends on: T07, T09, T10, T13.

Exit criteria:

- Every publishable pack is rebuilt from final accepted engine sources and meets its quality, timeline, accelerated RTF, fallback, immutable identity and license gates on the declared matrix.
- No VRAM gate is invented; measured VRAM may be reported as diagnostic metadata.
- CPU results remain unchanged in kind and CPU fallback passes lifecycle tests.
- Unsupported hardware/driver combinations are explicit and never presented as accelerated.

Rollback point: mark only the failing pack `stop-revise` and remove it from the release manifest; keep CPU and other qualified packs available.

#### T15 - Migrate Runtime Dependency And Settings Backend

Suggested slug: `native-asr-runtime-settings-backend`

Deliverables:

- Replace production Python/venv dependency kinds with built-in CPU runtime, qualified optional GPU packs, models, downloads and app cache.
- Integrate only the exact T14-qualified GPU pack hashes into the trusted runtime-source manifest and existing managed downloader: `.part`/resume where supported, exact size/SHA-256 verification, atomic activation under `deps/asr-runtime/{cuda,vulkan}/current`, and rollback that preserves the prior valid pack.
- Keep CPU runtime built-in/non-cleanable; keep GPU packs managed/downloadable/cleanable; preserve probe vs measure and async `spawn_blocking` cleanup.
- Migrate settings by ignoring legacy Python paths and mapping known engine/model/device values; unavailable GPU selections resolve to CPU with one nonfatal notice.
- Expose per-model native qualification metadata without removing any current model identity.
- Update command/types/wrappers as one cross-layer contract where required.

Depends on: T05, T11, T12, T14.

Exit criteria:

- Installed/portable path, legacy settings, pack source/download/resume/hash/atomic update/rollback, probe, measure and cleanup tests pass.
- Production dependency probe no longer searches for Python 3.11 or venv and does not recursively measure storage.
- Cleanup remains bounded under managed `deps/`; built-in CPU cannot be deleted.
- Failed/uninstalled GPU packs and unqualified models cannot be selected as runnable native routes.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

Rollback point: preserve old settings fields as ignored input until migration is proven; avoid destructive settings rewrites.

### Phase 5 - Frontend Migration

#### T16 - Migrate ASR Runtime And Model UX

Suggested slug: `native-asr-frontend-migration`

Deliverables:

- Replace Python setup panel with native CPU/GPU runtime and model status/actions.
- Show CPU as built in and qualified GPU packs as optional; expose runnable devices only when the engine, pack and qualification metadata agree.
- Continue displaying every current model. Show native qualification state and disable or explain unavailable native routes instead of hiding models or silently falling back to Python.
- Preserve current transcribe polling/document guards and model-download progress flow.
- Remove production copy referencing Python, venv, pip and service directories.
- Cover old settings/default fallback and companion download aggregation.

Depends on: T11, T15; engine/model/device metadata from T06-T10 and T14 must be stable.

Exit criteria:

- Existing transcription and ASS generation behavior remains intact.
- Every current model remains visible with accurate runnable/unsupported state.
- Device/model UI tests and `pnpm build` pass.
- No raw invoke or duplicate runtime state is introduced.

Validation:

```bash
pnpm test
pnpm build
```

Rollback point: UI can continue exposing the legacy setup path until backend contracts are stable; do not ship a mixed UI/runtime contract.

**Gate 3:** Do not enter release cutover until native model delivery, CPU packaging, GPU pack decisions, settings migration and frontend UX work together on installed and portable layouts. A `stop-revise` GPU pack is omitted and does not block this gate; any CPU or shared contract mismatch returns to T11-T16.

### Phase 6 - Integration And Release Cutover

#### T17 - Qualify And Cut Over Native ASR Release

Suggested slug: `native-asr-release-cutover`

This task is a release gate, not a place to finish missing engine or GPU implementation.

Deliverables:

- Run the complete five-engine short/medium/long authoritative CPU ground-truth matrix and the publishable GPU pack matrices; publish absolute quality/performance/resource results plus optional Python diagnostics.
- Verify cancel, crash, recovery, CPU fallback, offline cached-model use, installed and portable behavior.
- Switch production packaging/default routes only for qualified engines and packs; stop bundling Python sidecar/runtime/venv.
- Freeze a complete source/dependency/compiler/algorithm-config input lock, rebuild and attest the final immutable CPU runtime from accepted T06～T10 identities, and re-verify every publishable GPU artifact matches the exact T14-qualified hash; then verify setup/portable/runtime sizes, third-party licenses and zero bundled model weights while CUDA/Vulkan remain optional external packs.
- Remove or stop packaging obsolete production setup resources while retaining source-level legacy baseline for one stable release cycle.
- Update README/notices and, only after architecture lands, update `AGENTS.md` and `.trellis/spec/{asr,tauri,frontend}`.
- Run final cross-child contract review against the parent PRD.

Depends on: T06, T07, T09, T10, T11, T12, T13, T14, T15, T16.

Exit criteria:

- Every parent acceptance criterion is evidenced or explicitly blocks release.
- All required test commands and worker CTest pass.
- No unresolved P0/P1 quality, data-loss, path-security or license issue on the CPU baseline or any publishable GPU pack.
- Failed engines return to their owning child; failed GPU packs are omitted according to T14 rather than patched ad hoc here.

Final validation:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
# Native worker CMake configure/build + CTest commands are fixed by T04/T12/T13.
```

Rollback point: restore the previous production package inputs and per-engine/pack route without rewriting user projects or deleting caches. Never require a destructive settings/model migration for rollback.

**Gate 4:** Archive the parent only after T17 passes and all 17 child tasks are independently archived.

## Cross-Task Review Checklist

- [ ] Command/state/type names remain aligned across worker, Rust and TypeScript.
- [ ] Parent engine-route table matches model manifest and UI metadata.
- [ ] Every engine has model-backed quality evidence directly against T01 ground truth and legal timestamps; Python parity is not used as a gate.
- [ ] Qwen3 readiness and execution always include the ForcedAligner.
- [ ] Portable/installed roots and cleanup boundaries are covered.
- [ ] Probe performs no recursive storage scan.
- [ ] Runtime/model downloads are pinned, hashed and atomically installed.
- [ ] CPU package and optional GPU packs contain runtime only, no model weights; GPU packs are not bundled in the main installer.
- [ ] GPU routing proves actual loaded acceleration, preserves CPU fallback and omits failed packs without blocking CPU release.
- [ ] Every current model remains visible in T16 with qualification-driven availability; no unsupported model silently falls back to Python.
- [ ] Python legacy remains development-only during the agreed rollback window.
- [ ] Current-state specs are updated only when their owning architecture change lands.
- [ ] No child was treated as complete with failing or unavailable mandatory checks.

## Parent Review Gate

Stage 0 child-task creation:

- [x] User reviewed and approved the parent `prd.md`, `design.md` and task map.
- [x] T01-T03 were the first creation batch; all three have independently reviewable artifacts, are completed and archived, and their handoffs remain authoritative.
- [x] T02 proved the CTranslate2 backend/runtime viable while recording the current fixed-window algorithm as `stop-revise`.
- [x] T03 proved the CrispASR ABI/runtime viable, with Reazon `proceed-with-named-risks` and Parakeet/Qwen `stop-revise`; Gate 0 backend/runtime feasibility is closed.
- [x] User approved adding T13/T14 as normal-numbered GPU development tasks while keeping CPU release independent from failed GPU packs.
- [x] User approved T06 hard gates for `large-v3` and `large-v2` long audio; all models remain visible in T16 even when native qualification fails.
- [x] T04-T06 were created as the next planning batch and linked to this parent.
- [x] T04 completed protocol/limits/fake-worker implementation, independent check, commit and archive.
- [x] T05 completed generic Rust host/active gate/reducer/recovery/process-tree lifecycle, independent check, commit and archive; Gate 1 is closed.
- [x] T06 manifests consume final T04 protocol/limits, T05 durable Tauri host spec and archived host evidence; its scope includes only focused Rust test-module additions for real-worker compatibility.
- [ ] Keep T06 in `planning` until final input/candidate/model/license lockability is reviewed and the user explicitly starts T06.
