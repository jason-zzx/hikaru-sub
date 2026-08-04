# 原生 ASR 迁移实施总计划

> 状态：父任务保持 `planning`；T01～T05 已完成并归档，Gate 0/1 已关闭；T06 已选择并经独立复核第三闭合分支 `migration-handoff-stop-revise`，其 Candidate B reviewed checkpoint 已停止但未资格化。Candidate A selected CPU candidate 因 large-v3 long-v1 7 个 confirmed gap 为 `stop-revise`；后续唯一 Candidate B direct ORT 1.28.0 CPU + faster-whisper 1.2.1 Silero V6 已实现并经最后 path-binding review 重冻结：short 全通过，但 medium 仍有 1 个 confirmed gap，因此在 long 前停止为 `stop-revise`。large-v2 与其余模型保持 `blocked-not-run`，ORT/VAD 不进入 T13 package input，native faster-whisper route 保持 disabled。T07 development CUDA 已完成并记录 `development-gpu-ready`；当前下一步为 T08 Kotoba，重复字幕质量迭代使用该 GPU lane。这不构成 GPU-required 或发布资格结论，父任务不直接启动实现。

## Execution Policy

- 本父任务保存总需求、总体设计、任务地图和跨任务门禁，通常不执行 `task.py start`。
- 子任务按阶段及时创建，不一次性把 18 个任务全部置为活跃；创建近期任务时使用 `--parent <parent-dir> --no-start`。
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

Gate 2: engine productization + development acceleration
  T05 -> T06 CPU diagnosis/device decision
  T06 CPU checkpoint -> T07 development CUDA -> T08
  T06 -> T09 CrispASR core + development GPU -> T10 + T11

Gate 3: models, CPU/GPU runtime and UI
  T02 + T03 -> T12
  T06 -> T13
  T06 + T07 + T08 + T10 + T11 + T13 -> T14
  T06 + T07 + T08 + T10 + T11 + T14 -> T15
  T05 + T12 + T13 + T15 -> T16 -> T17

Gate 4: release cutover
  T06..T17 -> T18
```

Allowed parallel groups:

- T02 and T03 after T01.
- T06 after T05. T07 starts after T06 exposes the production-worker seam and completes the CPU root-cause checkpoint; it does not depend on proving a CPU ceiling and does not wait for a GPU-required decision.
- T08 Kotoba follows T07. T07 is now `development-gpu-ready` with short-v1/locked-120s GPU-to-CPU warmed-median ratios `0.1090/0.1313`, so repeated T08 quality iteration stays on GPU even when CER/gap/timeline gates fail. This does not imply that ordinary native faster-whisper is qualified or enabled.
- T10 and T11 may overlap after T09 stabilizes both the CrispASR core and its ignored-local development GPU seam. An attested, repeatably faster GPU seam remains the development device through CER/gap/segmentation/alignment failures; required CPU regression and final publishable-device gates remain separate.
- T12 may start from proven model formats and overlap engine productization; T13 waits for the T06 production worker, then may overlap T08～T11.
- T14 starts after final backend/device inputs and the CPU package contract stabilize; T15 starts after engine pipelines and formal GPU packs are measurable.
- T07/T09 development GPU artifacts are ignored-local evidence only. Formal GPU pack failure in T14/T15 records `stop-revise` and omits that pack without blocking unrelated qualified CPU routes.

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

**Gate 0:** Closed for backend/runtime feasibility. T04/T05 may proceed because CT2 and CrispASR can execute safely in isolated native processes. Route quality blockers are mandatory inputs to T06/T08/T10/T11 and still prevent production promotion; a future finding of fundamental ABI, license or package non-viability reopens Gate 0.

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
- Enumerate all current ordinary faster-whisper models (`tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, `large-v3-turbo`). The T06 CPU branch measures the complete matrix; a reviewed `gpu-required-pending` branch keeps provisional dispositions and assigns the complete CUDA matrix to T15; a reviewed `migration-handoff-stop-revise` branch may hand off complete worker/evidence/host/protocol/downstream materials while preserving provisional dispositions and `blocked-not-run` models. `large-v3` and `large-v2` Japanese audio over 10 minutes remain hard route gates in either qualification branch, including the current V4/seed/session regression cases.
- Treat current Python parameters and private fork as diagnostics, not required native algorithms.
- Before closing a CPU performance failure, run the same-binary minimized RTF matrix and record per-window prompt/history/prefix/generated tokens, feature/generate timing, seek/overlap, fallback count, threads and oneDNN/OpenMP/module/ISA evidence.
- Normalize overlap into stable segments, emit monotonic progress, and publish model-backed absolute quality/performance/resource results.

Depends on: T02, T04, T05.

Exit criteria:

- CPU branch: `large-v3` and required `large-v2` long-audio cases meet T01 CPU CER/RTF/resource gates, and every other model receives a measured disposition.
- GPU-required branch: the same-binary matrix proves a CPU ceiling, independent review accepts the device decision, and T06 publishes a `gpu-required-pending` handoff to T14/T15. T07 remains the shared post-checkpoint development lane and may already be complete; ordinary faster-whisper stays disabled until T15 qualifies the full CUDA matrix.
- Migration-handoff branch: when the production worker, selected CPU baseline, reviewed Candidate B stop-revise evidence, Python non-gating comparison, deterministic publishers, host/protocol tests and downstream handoff are complete without proving qualification, T06 may complete as `migration-handoff-stop-revise`; this is not a product qualification or GPU-required decision, and the completed seam hands off first to T07 development CUDA before T08.
- CPU `stop-revise` is final only after the root-cause matrix; it never makes ordinary faster-whisper optional or qualifies a GPU route.
- No invalid/overflow timeline segments or confirmed speech gaps `>=1.5s` on any model qualified by the CPU branch.
- Large-v2 long-audio remains a mandatory regression case: T06 owns it on the CPU branch, while T15 owns it on the GPU-required branch.

Rollback point: retain Python faster-whisper as development default.

T06 checkpoint: Candidate A remains a separate historical provisional `stop-revise` set (short CER `0.3583`, medium RTF `1.100`, unscored long timeout). The warmed same-binary matrix rejects an inherent CPU ceiling and identifies full-history prefill as the dominant regression. A bounded same-binary short beam 1/5 selection then chose timestamp/no-history/beam 1 (`0.2667` CER, `0.632` RTF, 0 timeline/gap) over beam 5 (`0.3583`, `0.811`); beam 3/10 were not activated. The selected identity passes authoritative large-v3 short/medium, while long-v1 passes CER/RTF/RSS/timeline but fails with 7 confirmed gaps. The sole Candidate B then implemented direct official ORT 1.28.0 CPU and ordinary faster-whisper 1.2.1 Silero V6. Last-review replacement lock `e687ead6...` binds actual CPU/module paths, restricted PATH roots `77f4714a...`, and fixed module layout `a650e185...`; the 21-case mutation matrix rejects the correlated all-module/all-root rewrite. Short passes (`0.2667` CER, `0.654` warm RTF, `29.544s` cold, `3.44 GB`, 0 timeline/gap), medium passes CER `0.1055`, RTF `0.599`, RSS `3.44 GB` and timeline 0 but fails with 1 confirmed gap. Candidate B is `stop-revise`; long-v1, large-v2, other models, T07 and GPU were not run, route remains disabled, and ORT/VAD is excluded from T13 package input.

#### T07 - Integrate Development CTranslate2 CUDA Execution

Suggested slug: `native-asr-ctranslate2-cuda-development`

This is an early development lane, not a managed runtime pack or release qualification task.

Deliverables:

- Build the pinned CTranslate2 source with the declared Windows CUDA 12.8 toolkit below an ignored task-local root. The primary development identity follows the upstream 4.8.0 Windows CMake shape with `WITH_CUDA=ON` and `WITH_CUDNN=OFF`; cuDNN 9.10.2 is reviewed but not downloaded/installed unless a separately reviewed root-cause revision requires a new build identity. Do not alter the main installer, portable ZIP or trusted runtime manifests.
- Reuse the same `hikaru-asr-worker`, protocol v1, CTranslate2 backend and selected algorithm; add only resolved `device=cuda` execution required by the existing route matrix.
- Record actual GPU model/driver, loaded CUDA/CT2 modules and requested/resolved device rather than trusting a device string; the primary no-cuDNN identity rejects unexpected `cudnn*.dll` modules.
- Run paired CPU/GPU diagnostics on short-v1 and the locked medium-v1 first-120s slice. Each sample/device uses `1 cold + 3 warm`; both GPU warmed median RTF values must be at most `80%` of the paired CPU median to retain GPU for T08. Report the release target `RTF <=0.5` separately.
- Preserve T05 process isolation, cancellation and stdout/stderr contracts.

Depends on: T04/T05 plus the T06 production-worker seam and completed CPU root-cause checkpoint; it does not require T06 task completion.

Exit criteria:

- The ignored-local CUDA build loads on the declared machine and produces legal protocol output through the existing host.
- Actual GPU execution and loaded modules are attested; CPU execution mislabeled as CUDA fails closed.
- Diagnostic evidence is explicitly non-publishable and does not claim downloader, fallback, pack reproducibility or release qualification.
- Publish exactly one development result: `development-gpu-ready` when actual CUDA execution is attested and both sample GPU warmed medians are at most `80%` of CPU; `development-gpu-unavailable` only from a validated configure/build/load/device failure envelope; or `development-gpu-no-speedup` when valid CUDA execution completes but either sample misses the `20%` speedup. Invalid/incomplete evidence publishes no result. CER, confirmed gaps, segmentation and timeline quality do not affect this result.
- Proving a CPU ceiling is not an activation condition. `RTF <=0.5` remains a T15 publishable-pack gate rather than a hard requirement for retaining a development GPU path that is already faster than CPU; all formal seven-model qualification/publication remains T15 work.

Rollback point: delete only ignored development CUDA outputs and keep the CPU worker/protocol unchanged.

Verified T07 result:

- `development-gpu-ready` on RTX 3070 device 0/FLOAT16, CUDA 12.8.93, CTranslate2 4.8.0, `WITH_CUDNN=OFF`.
- short-v1 CPU/GPU warmed median RTF `0.577901/0.062971` (`0.1090` ratio).
- locked medium-v1 first-120s CPU/GPU warmed median RTF `0.591635/0.077707` (`0.1313` ratio).
- CUDA-only module set: `nvcuda.dll`, `cublas64_12.dll`, `cublasLt64_12.dll`; no cuDNN. Development evidence is non-publishable and quality-independent.

#### T08 - Productize Kotoba And Legacy CT2 Cache Compatibility

Suggested slug: `native-asr-kotoba-compatibility`

Deliverables:

- Implement Kotoba behavior from its pinned model card/stable APIs and T01 ground-truth results; current Python 15-second/no-context behavior remains diagnostic reference.
- Keep `preprocessor_config.json` readiness Kotoba-only.
- Resolve valid old Hugging Face CTranslate2 snapshots without copying them.
- Verify overlap and long-audio behavior directly against ground truth.

Depends on: T06 and a reviewed T07 result of `development-gpu-ready`, `development-gpu-unavailable` or `development-gpu-no-speedup`. T07 is a development-order and performance decision, not a Kotoba subtitle-quality or release-qualification result.

Exit criteria:

- Kotoba quality iteration uses the T07 CUDA lane whenever its result is `development-gpu-ready`; CER, confirmed gaps, segmentation or timeline failures stay on GPU. CPU is retained only for required regression/fallback evidence, or when T07 records GPU unavailable/no speedup.
- Kotoba meets T01 user-reviewed absolute quality/timing/resource gates on its selected candidate device.
- Ordinary faster-whisper readiness is not tightened accidentally.
- Old valid CT2 caches are reusable and malformed caches fail safely.

Rollback point: disable only Kotoba native routing.

### Phase 3 - CrispASR Productization

#### T09 - Build CrispASR Backend Core

Suggested slug: `native-asr-crispasr-backend`

Deliverables:

- Wrap the pinned public session/result/progress/segment/alignment C ABI subset.
- Map callbacks to protocol events with cancellation and safe ownership.
- Share audio/VAD/result normalization selected from stable CrispASR APIs and ground-truth evidence, without Python-parity product hacks.
- Establish an ignored-local CrispASR development GPU execution path on the declared machine, preferring CUDA when supported; record requested/resolved device and actual loaded modules, and fail closed on CPU execution mislabeled as accelerated.
- Record ABI/library commit in runtime manifest.

Depends on: T03, T05, T06 production-worker seam.

Exit criteria:

- Backend opens/closes sessions safely and maps deterministic fake/native results to JSONL.
- Publish `development-gpu-ready`, `development-gpu-unavailable` or `development-gpu-no-speedup` using the same paired warmed CPU/GPU performance rule as T07. Subtitle quality does not affect this development-device result; the path is not a managed pack or release qualification artifact.
- ABI errors, invalid models and cancellation do not crash the host application.

Rollback point: keep all CrispASR engine routes disabled.

#### T10 - Productize Parakeet And ReazonSpeech

Suggested slug: `native-asr-parakeet-reazon`

Deliverables:

- Route Parakeet JA Q8_0 and ReazonSpeech Q8_0 through the shared backend.
- Validate native timestamps, subtitle segment size and short/medium/long coverage against T01 truth.
- Use T09's development GPU path for repeated model-backed quality iteration whenever its result is `development-gpu-ready`; CER, gap and segmentation failures stay on GPU. Reserve CPU runs for required regression/fallback evidence, final candidate gates, or a T09 unavailable/no-speedup result.
- Start from official/model-card/maintained community guidance; add only compensation demonstrated necessary by ground-truth failures.
- Support final `segmentsReplace` when the selected pipeline performs a final correction; do not assume refresh is Parakeet-only. Current Reazon `>=60s` 45s/2s-overlap behavior is a diagnostic regression case, not a required native algorithm.

Depends on: T09.

Exit criteria:

- Each engine meets T01 user-reviewed absolute CER/RTF/resource budgets.
- No confirmed speech gap `>=1.5s` and no invalid/out-of-bounds timeline.
- No Q4 Parakeet repeated-loop default is introduced.

Rollback point: engines switch independently; one failure does not disable the other.

#### T11 - Productize Qwen3 With ForcedAligner

Suggested slug: `native-asr-qwen3-aligner`

Deliverables:

- Treat Qwen3 1.7B Q4_K and ForcedAligner 0.6B Q4_K as one model product.
- Select chunking/alignment/segmentation from official/model-card/maintained community guidance and ground-truth results; Python synthetic or refresh behavior is diagnostic only.
- Use T09's development GPU path for repeated Qwen3/ForcedAligner quality iteration whenever its result is `development-gpu-ready`; CER, gap and alignment failures stay on GPU. Reserve CPU runs for required regression/fallback evidence, final candidate gates, or a T09 unavailable/no-speedup result.
- Fail when alignment is missing/invalid; never synthesize timestamps.
- Aggregate progress and allow a final `segmentsReplace` when required by the chosen pipeline.

Depends on: T09.

Exit criteria:

- Qwen3 meets T01 user-reviewed absolute CER/RTF/resource budgets.
- Start-time median <=150 ms and P95 <=500 ms against authoritative ASS timing.
- Missing companion, alignment failure, leading silence and chunk-boundary cases are tested; timeline remains legal.

Rollback point: disable only Qwen3 native routing.

**Gate 2:** Each engine is promoted independently only after its quality report passes. Failed CrispASR routes do not block already-qualified CT2 routes during development.

### Phase 4 - Models, Runtime And Settings Backend

#### T12 - Build Native Model Manifest And Downloader

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

#### T13 - Produce Reproducible CPU Runtime Package

Suggested slug: `native-asr-cpu-runtime-package`

Deliverables:

- Pin CTranslate2, CrispASR, compiler, CMake, Ninja and native dependencies.
- Build the reproducible CPU runtime packaging pipeline and a provisional integration artifact with worker/DLL/manifest/license/SHA-256 shape; do not claim its executable identity is final before accepted engine identities land.
- Add verified artifact preparation hooks for `pnpm release:local` and portable packaging without switching production inputs.
- Compile only required ASR capabilities and measure provisional setup/portable/unpacked size.
- Define the T18 final rebuild/attestation input contract so accepted engine source/device identities produce the immutable release artifacts.

Depends on: T04, T06.

Exit criteria:

- End-user packaging never invokes CMake.
- The packaging pipeline is reproducible and a provisional protocol/backend smoke artifact works in installed and portable layouts with zero bundled model weights.
- Provisional size measurement demonstrates the CPU budget is plausible; T18 must rebuild and re-attest the final worker after all accepted engine code lands.
- No provisional hash or executable is represented as the final release identity.

Rollback point: do not alter production packaging until artifact verification and size gates pass.

#### T14 - Build Optional GPU Runtime Packs

Suggested slug: `native-asr-gpu-runtime-packs`

Deliverables:

- Produce separately versioned Windows x64 CUDA and Vulkan runtime packs from the pinned native worker/backends without placing either pack in the main installer or portable ZIP.
- Keep CT2 CUDA and CrispASR CUDA/Vulkan dependencies isolated under `deps/asr-runtime/{cuda,vulkan}/current` with exact manifest, DLL, compiler, driver-floor, size, SHA-256, license and attribution identities.
- Reuse protocol v1 resolved device values (`cpu`, `cuda`, `vulkan`); do not introduce a second worker protocol or backend-specific host executable.
- Add deterministic pack preparation/verification suitable for managed download; end-user machines never compile native dependencies.

Depends on: completed T06 CPU/device decision, T07 CTranslate2 development CUDA result, T09 CrispASR development GPU result, accepted T08/T10/T11 engine inputs, and the T13 packaging contract.

Exit criteria:

- CUDA and Vulkan are each attempted and independently recorded as `candidate-built` or `stop-revise` with immutable build/load/license evidence; one failed candidate does not prevent T14 completion.
- Every `candidate-built` pack is reproducible, hash-verified, contains no models, and can load its intended backend on a declared target machine.
- CUDA/Vulkan DLL discovery cannot shadow unrelated system/application binaries or escape the managed pack root.
- Main setup/portable artifacts remain CPU-only and within their existing size budgets.
- Missing, invalid or `stop-revise` pack identity fails closed before worker launch.

Rollback point: remove the affected optional pack artifact/manifest; the bundled CPU runtime remains unchanged.

#### T15 - Qualify GPU Routing And Acceleration

Suggested slug: `native-asr-gpu-qualification`

Deliverables:

- Rebuild each T14 `candidate-built` pack from final accepted engine source/config/device identities, freeze executable/DLL/manifest hashes, and use only that exact identity for qualification.
- Implement capability probing and resolved routing for the rebuilt candidate packs. Engines with a qualified CPU route may fall back to CPU; ordinary faster-whisper proven GPU-required is unavailable/explained when qualified CUDA is absent.
- Record T14 `stop-revise`/unbuilt candidates as omitted without attempting to route them.
- Validate actual loaded modules and device execution rather than trusting a requested device string.
- Run the applicable T01 short/medium/long engine matrix on explicit hardware/driver identities; preserve the same CER/timeline/gap/Qwen gates and require accelerated inference RTF `<=0.5`.
- When T06 records `gpu-required-pending`, T15 explicitly owns the complete seven-model ordinary faster-whisper CUDA dispositions: `large-v3` and `large-v2` short/medium/long remain hard gates, including authoritative large-v2 long-v1; the other five models receive measured `qualified`, `stop-revise` or `unsupported-for-native-release` results.
- Verify pack-load/runtime failure produces one nonfatal notice: engines with a qualified CPU route retry that bundled CPU path without losing job/recovery semantics, while ordinary faster-whisper proven GPU-required becomes unavailable without launching its unqualified CPU route.
- Publish an independent `qualified`, `stop-revise` or `omitted-no-candidate` decision for CUDA and Vulkan; no non-qualified pack blocks CPU cutover.

Depends on: completed T06 CPU/device decision, T07, T08, T10, T11, and T14. T07 is consumed as development evidence regardless of whether ordinary faster-whisper becomes `gpu-required-pending`; this dependency never requires T06 to contain GPU qualification evidence.

Exit criteria:

- Every publishable pack is rebuilt from final accepted engine sources and meets its quality, timeline, accelerated RTF, fallback, immutable identity and license gates on the declared matrix.
- No VRAM gate is invented; measured VRAM may be reported as diagnostic metadata.
- CPU results remain unchanged in kind; CPU fallback passes where the engine has a qualified CPU route, and GPU-required route unavailability passes lifecycle/UI contract tests.
- Unsupported hardware/driver combinations are explicit and never presented as accelerated.

Rollback point: mark only the failing pack `stop-revise` and remove it from the release manifest; keep CPU and other qualified packs available.

#### T16 - Migrate Runtime Dependency And Settings Backend

Suggested slug: `native-asr-runtime-settings-backend`

Deliverables:

- Replace production Python/venv dependency kinds with built-in CPU runtime, qualified optional GPU packs, models, downloads and app cache.
- Integrate only the exact T15-qualified GPU pack hashes into the trusted runtime-source manifest and existing managed downloader: `.part`/resume where supported, exact size/SHA-256 verification, atomic activation under `deps/asr-runtime/{cuda,vulkan}/current`, and rollback that preserves the prior valid pack.
- Keep CPU runtime built-in/non-cleanable; keep GPU packs managed/downloadable/cleanable; preserve probe vs measure and async `spawn_blocking` cleanup.
- Migrate settings by ignoring legacy Python paths and mapping known engine/model/device values; unavailable GPU selections resolve to a qualified CPU route when one exists, otherwise the route is unavailable with one clear notice.
- Expose per-model native qualification metadata without removing any current model identity.
- Update command/types/wrappers as one cross-layer contract where required.

Depends on: T05, T12, T13, T15.

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

#### T17 - Migrate ASR Runtime And Model UX

Suggested slug: `native-asr-frontend-migration`

Deliverables:

- Replace Python setup panel with native CPU/GPU runtime and model status/actions.
- Show CPU as built in and qualified GPU packs as optional; expose runnable devices only when the engine, pack and qualification metadata agree.
- Continue displaying every current model. Show native qualification state and disable or explain unavailable native routes instead of hiding models or silently falling back to Python.
- Preserve current transcribe polling/document guards and model-download progress flow.
- Remove production copy referencing Python, venv, pip and service directories.
- Cover old settings/default fallback and companion download aggregation.

Depends on: T12, T16; engine/model/device metadata from T06～T11 and T15 must be stable.

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

**Gate 3:** Do not enter release cutover until native model delivery, CPU packaging, GPU pack decisions, settings migration and frontend UX work together on installed and portable layouts. A `stop-revise` GPU pack is omitted and does not block unrelated CPU routes; an ordinary faster-whisper GPU-required decision must have a T15-qualified CUDA pack. Any shared contract mismatch returns to T12～T17.

### Phase 6 - Integration And Release Cutover

#### T18 - Qualify And Cut Over Native ASR Release

Suggested slug: `native-asr-release-cutover`

This task is a release gate, not a place to finish missing engine or GPU implementation.

Deliverables:

- Run the complete five-engine short/medium/long authoritative matrix on every selected publishable device; publish absolute quality/performance/resource results plus optional Python diagnostics.
- Verify cancel, crash, recovery, qualified CPU fallback or GPU-required unavailability, offline cached-model use, installed and portable behavior.
- Switch production packaging/default routes only for qualified engines and packs; stop bundling Python sidecar/runtime/venv.
- Freeze a complete source/dependency/compiler/algorithm-config input lock, rebuild and attest the final immutable CPU runtime from accepted engine identities, and re-verify every publishable GPU artifact matches the exact T15-qualified hash; then verify setup/portable/runtime sizes, third-party licenses and zero bundled model weights while CUDA/Vulkan remain external packs.
- Remove or stop packaging obsolete production setup resources while retaining source-level legacy baseline for one stable release cycle.
- Update README/notices and, only after architecture lands, update `AGENTS.md` and `.trellis/spec/{asr,tauri,frontend}`.
- Run final cross-child contract review against the parent PRD.

Depends on: T06, T07, T08, T10, T11, T12, T13, T14, T15, T16, T17.

Exit criteria:

- Every parent acceptance criterion is evidenced or explicitly blocks release.
- All required test commands and worker CTest pass.
- No unresolved P0/P1 quality, data-loss, path-security or license issue on the CPU baseline or any publishable GPU pack.
- Failed engines return to their owning child; failed GPU packs are omitted according to T15 rather than patched ad hoc here.

Final validation:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
# Native worker CMake configure/build + CTest commands are fixed by T04/T13/T14.
```

Rollback point: restore the previous production package inputs and per-engine/pack route without rewriting user projects or deleting caches. Never require a destructive settings/model migration for rollback.

**Gate 4:** Archive the parent only after T18 passes and all 18 child tasks are independently archived.

## Cross-Task Review Checklist

- [ ] Command/state/type names remain aligned across worker, Rust and TypeScript.
- [ ] Parent engine-route table matches model manifest and UI metadata.
- [ ] Every engine has model-backed quality evidence directly against T01 ground truth and legal timestamps; Python parity is not used as a gate.
- [ ] Qwen3 readiness and execution always include the ForcedAligner.
- [ ] Portable/installed roots and cleanup boundaries are covered.
- [ ] Probe performs no recursive storage scan.
- [ ] Runtime/model downloads are pinned, hashed and atomically installed.
- [ ] CPU package and optional GPU packs contain runtime only, no model weights; GPU packs are not bundled in the main installer.
- [ ] GPU routing proves actual loaded acceleration, preserves qualified CPU fallback, enforces GPU-required route unavailability, and omits failed packs without blocking unrelated CPU release routes.
- [ ] Every current model remains visible in T17 with qualification-driven availability; no unsupported model silently falls back to Python.
- [ ] Python legacy remains development-only during the agreed rollback window.
- [ ] Current-state specs are updated only when their owning architecture change lands.
- [ ] No child was treated as complete with failing or unavailable mandatory checks.

## Parent Review Gate

Stage 0 child-task creation:

- [x] User reviewed and approved the parent `prd.md`, `design.md` and task map.
- [x] T01-T03 were the first creation batch; all three have independently reviewable artifacts, are completed and archived, and their handoffs remain authoritative.
- [x] T02 proved the CTranslate2 backend/runtime viable while recording the current fixed-window algorithm as `stop-revise`.
- [x] T03 proved the CrispASR ABI/runtime viable, with Reazon `proceed-with-named-risks` and Parakeet/Qwen `stop-revise`; Gate 0 backend/runtime feasibility is closed.
- [x] User approved moving development GPU integration earlier: normal-numbered T07 provides CTranslate2 CUDA development immediately after the T06 CPU checkpoint and before T08 regardless of CPU-ceiling outcome; T09 provides the CrispASR development GPU seam before T10/T11. Formal packs/qualification remain T14/T15, and development GPU evidence never substitutes for release evidence.
- [x] User approved T06 hard gates for `large-v3` and `large-v2` long audio; ordinary faster-whisper remains mandatory and all models remain visible in T17 even when native qualification fails.
- [x] T07 completed the ignored-local CTranslate2 CUDA lane and independently froze `development-gpu-ready`; T08 now uses GPU for repeated subtitle-quality iteration, while T14/T15 remain the only pack/release qualification owners.
- [x] T04-T06 were created as the next planning batch and linked to this parent.
- [x] T04 completed protocol/limits/fake-worker implementation, independent check, commit and archive.
- [x] T05 completed generic Rust host/active gate/reducer/recovery/process-tree lifecycle, independent check, commit and archive; Gate 1 is closed.
- [x] T06 manifests consume final T04 protocol/limits, T05 durable Tauri host spec and archived host evidence; its scope includes only focused Rust test-module additions for real-worker compatibility.
- [x] T06 `start-gate-lock.md` records Candidate A, one conditional Candidate B asset, seven immutable model revisions/weight hashes/MIT licenses, Tiny remote-only status and the ignored active/archive local root.
- [x] T06 start-gate planning update is reviewed; the user authorized committing it and starting T06 immediately afterwards.
- [x] T06 Candidate A implementation and independent check completed a truthful provisional baseline: short CER and medium/long CPU performance block promotion; Candidate B was not activated; six remaining models are `blocked-not-run`.
- [x] T06 same-binary warmed CPU RTF diagnostic gate is implemented and measured; A/B pass while C fails, so no inherent CPU ceiling or GPU-required handoff is claimed.
- [x] T06 bounded short beam selection chose beam 1/no-history and froze a separate selected identity. It passed authoritative large-v3 short/medium, then completed long-v1 with passing CER/RTF/RSS/timeline but 7 confirmed gaps; selected CPU status is `stop-revise` and all other models remain `blocked-not-run`.
- [x] T06 Candidate B planning lock selects only official ORT 1.28.0 Windows x64 CPU and ordinary faster-whisper 1.2.1 Silero V6, records exact asset/attribution/package identities, and passes an ignored-local direct CPU/no-custom-op smoke.
- [x] T06 Candidate B direct session/focused CTest/final path-bound identity and deterministic T01 short/medium publication are complete. Short passes, medium fails with 1 confirmed gap, so Candidate B is `stop-revise`; long/other models/T07 were not run and ORT/VAD is not a T13 package input.
- [x] T06 reran the same-corpus Python `large-v3` CPU diagnostics with the development interpreter and application HF_HOME. The sanitized report records short CER `0.358`/warm inference RTF `0.886`/1 timeline error, medium CER `0.099`/1 timeline error/1 gap, and long CER `0.295`/0 timeline errors/1 gap; these remain non-gating diagnostics and do not replace absolute native gates.
