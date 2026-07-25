# 原生 ASR 迁移实施总计划

> 状态：父任务总体规划完成，等待评审。当前不创建子任务、不启动实现。

## Execution Policy

- 本父任务保存总需求、总体设计、任务地图和跨任务门禁，通常不执行 `task.py start`。
- 子任务按阶段及时创建，不一次性把 15 个任务全部置为活跃；创建近期任务时使用 `--parent <parent-dir> --no-start`。
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
  T05 -> (T06 -> T07) + (T08 -> T09 + T10)

Gate 3: distribution and UI
  T02 + T03 -> T11 + T12
  T05 + T11 + T12 -> T13 -> T14

Gate 4: release cutover
  T06..T14 -> T15
```

Allowed parallel groups:

- T02 and T03 after T01.
- T06 and T08 after T05.
- T07, T09 and T10 after their shared backends stabilize.
- T11 and T12 after model/runtime formats are proven; they may overlap engine productization.

## Task Map

### Phase 0 - Baseline And Feasibility

#### T01 - Establish Native ASR Benchmark Baseline

Suggested slug: `native-asr-benchmark-baseline`

Deliverables:

- Define short (<30s), medium (5-15m) and long (>60m) Japanese corpus categories, including silence, background audio, rapid dialogue, long continuous speech and named entities.
- Use only redistributable fixtures in the repository; keep private/large local corpus paths ignored and record reproducible metadata rather than media contents.
- Capture current Python engine output, segment timing, CER inputs, RTF, peak RAM/VRAM and cold-start measurements.
- Add a repeatable comparison/report format consumed by later tasks.

Depends on: none.

Exit criteria:

- All five current Python engines have a documented baseline or an explicit dependency/model limitation.
- Quality calculations and timing comparison are repeatable.
- No private media, credentials or model weights enter source control.

Validation:

```text
Existing Python sidecar tests
Baseline harness self-checks
Manual model-backed benchmark report
```

Rollback point: no production path changes.

#### T02 - Prove CTranslate2 Whisper And Kotoba PoC

Suggested slug: `native-asr-ctranslate2-poc`

Deliverables:

- Minimal pinned CMake build using CTranslate2 C++ Whisper API.
- Run large-v3 and Kotoba v2.0 on representative Japanese audio.
- Prove tokenizer, mel, timestamp decode and segment output direction.
- Measure CPU runtime footprint, RTF and memory without changing application defaults.

Depends on: T01.

Exit criteria:

- Both engines produce legal Japanese segment timelines.
- Kotoba-specific files and 15-second behavior are understood.
- No unresolved licensing or binary-distribution blocker.

Rollback point: discard PoC without touching production ASR.

#### T03 - Prove CrispASR Three-Engine PoC

Suggested slug: `native-asr-crispasr-poc`

Deliverables:

- Pin CrispASR and exercise its public C ABI.
- Run Parakeet JA Q8_0, ReazonSpeech Q8_0 and Qwen3-ASR Q4_K with ForcedAligner Q4_K.
- Record segment/progress callback behavior, long-audio limits, runtime footprint and model licenses.

Depends on: T01.

Exit criteria:

- All three engines produce legal Japanese timelines.
- Qwen3 timing comes from the aligner, not synthetic averaging.
- Known long-audio coverage gaps and required compensation are evidence-backed.

Rollback point: discard PoC without affecting CT2 work or production ASR.

**Gate 0:** Stop the migration and revise the architecture if any required engine has no viable native CPU path, Qwen3 alignment is unusable, or runtime/package limits are clearly unattainable.

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

- Implement WAV validation, log-mel extraction, tokenizer/prompt loading, 30-second windowing, timestamp-token parsing, no-speech/failure handling and optional alignment.
- Preserve beam size 5, CPU int8, language detection and VAD time restoration.
- Normalize chunk overlap into stable segments and emit monotonic progress.
- Add tokenizer/timestamp golden tests and model-backed quality/performance report.

Depends on: T02, T05.

Exit criteria:

- CER degradation <=0.5 absolute percentage points.
- CPU RTF degradation <=10% against baseline.
- No invalid/overflow timeline segments on the corpus.

Rollback point: retain Python faster-whisper as development default.

#### T07 - Productize Kotoba And Legacy CT2 Cache Compatibility

Suggested slug: `native-asr-kotoba-compatibility`

Deliverables:

- Add Kotoba's 15-second chunks, Japanese language and no-previous-text conditioning.
- Keep `preprocessor_config.json` readiness Kotoba-only.
- Resolve valid old Hugging Face CTranslate2 snapshots without copying them.
- Verify overlap merge and long-audio behavior against baseline.

Depends on: T06.

Exit criteria:

- Kotoba meets CT2 quality/timing gates.
- Ordinary faster-whisper readiness is not tightened accidentally.
- Old valid CT2 caches are reusable and malformed caches fail safely.

Rollback point: disable only Kotoba native routing.

### Phase 3 - CrispASR Productization

#### T08 - Build CrispASR Backend Core

Suggested slug: `native-asr-crispasr-backend`

Deliverables:

- Wrap the pinned public session/result/progress/segment/alignment C ABI subset.
- Map callbacks to protocol events with cancellation and safe ownership.
- Share audio/VAD/result normalization without engine-specific product hacks.
- Record ABI/library commit in runtime manifest.

Depends on: T03, T05.

Exit criteria:

- Backend opens/closes sessions safely and maps deterministic fake/native results to JSONL.
- ABI errors, invalid models and cancellation do not crash the host application.

Rollback point: keep all CrispASR engine routes disabled.

#### T09 - Productize Parakeet And ReazonSpeech

Suggested slug: `native-asr-parakeet-reazon`

Deliverables:

- Route Parakeet JA Q8_0 and ReazonSpeech Q8_0 through the shared backend.
- Validate native timestamps, subtitle segment size and long-audio coverage.
- Port only the minimum gap detection/backfill or Japanese segmentation proven necessary by T01/T03 corpus failures.
- Use `segmentsReplace` for any final correction pass.

Depends on: T08.

Exit criteria:

- Each engine has CER degradation <=1 absolute percentage point.
- No new confirmed speech gap >=1.5 seconds.
- No Q4 Parakeet repeated-loop default is introduced.

Rollback point: engines switch independently; one failure does not disable the other.

#### T10 - Productize Qwen3 With ForcedAligner

Suggested slug: `native-asr-qwen3-aligner`

Deliverables:

- Treat Qwen3 1.7B Q4_K and ForcedAligner 0.6B Q4_K as one model product.
- Chunk long audio, run text inference, align words/characters, restore global offsets and deduplicate overlap.
- Fail when alignment is missing/invalid; never synthesize whole-audio timestamps.
- Aggregate progress from completed audio blocks.

Depends on: T08.

Exit criteria:

- CER degradation <=1 absolute percentage point.
- Start-time median <=150 ms and P95 <=500 ms.
- Missing companion, alignment failure, leading silence and chunk-boundary cases are tested.

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
- Produce a Windows x64 CPU runtime artifact with worker, DLLs, manifest, licenses and SHA-256.
- Add verified preparation to `pnpm release:local` and portable packaging.
- Compile only required ASR capabilities and measure setup/portable/unpacked size.

Depends on: T02, T03, T04.

Exit criteria:

- End-user packaging never invokes CMake.
- Setup <=80 MB, portable <=90 MB and unpacked CPU runtime <=250 MB.
- CPU runtime works in installed and portable layouts with zero bundled model weights.

Rollback point: do not alter production packaging until artifact verification and size gates pass.

#### T13 - Migrate Runtime Dependency And Settings Backend

Suggested slug: `native-asr-runtime-settings-backend`

Deliverables:

- Replace production Python/venv dependency kinds with CPU runtime, future GPU placeholders, models, downloads and app cache.
- Keep CPU runtime built-in/non-cleanable; preserve probe vs measure and async `spawn_blocking` cleanup.
- Migrate settings by ignoring legacy Python paths and mapping known engine/model/device values.
- Update command/types/wrappers as one cross-layer contract where required.

Depends on: T05, T11, T12.

Exit criteria:

- Installed/portable path, legacy settings, probe, measure and cleanup tests pass.
- Production dependency probe no longer searches for Python 3.11 or venv.
- Cleanup remains bounded and does not recursively scan during probe.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

Rollback point: preserve old settings fields as ignored input until migration is proven; avoid destructive settings rewrites.

### Phase 5 - Frontend Migration

#### T14 - Migrate ASR Runtime And Model UX

Suggested slug: `native-asr-frontend-migration`

Deliverables:

- Replace Python setup panel with native runtime/model status and actions.
- Show CPU as built in; expose only devices supported by engine and installed runtime.
- Preserve current transcribe polling/document guards and model-download progress flow.
- Remove production copy referencing Python, venv, pip and service directories.
- Cover old settings/default fallback and companion download aggregation.

Depends on: T11, T13; engine/device metadata from T06-T10 must be stable.

Exit criteria:

- Existing transcription and ASS generation behavior remains intact.
- Device/model UI tests and `pnpm build` pass.
- No raw invoke or duplicate runtime state is introduced.

Validation:

```bash
pnpm test
pnpm build
```

Rollback point: UI can continue exposing the legacy setup path until backend contracts are stable; do not ship a mixed UI/runtime contract.

**Gate 3:** Do not enter release cutover until native model delivery, CPU runtime packaging, settings migration and frontend UX work together on both installed and portable layouts. Any contract mismatch returns to T11-T14.

### Phase 6 - Integration And Release Cutover

#### T15 - Qualify And Cut Over Native ASR Release

Suggested slug: `native-asr-release-cutover`

This task is a release gate, not a place to finish missing engine implementation.

Deliverables:

- Run the complete five-engine short/medium/long corpus matrix and publish quality/performance/ memory results.
- Verify cancel, crash, recovery, offline cached-model use, installed and portable behavior.
- Switch production packaging/default routes only for qualified engines; stop bundling Python sidecar/runtime/venv.
- Verify setup/portable/runtime size, third-party licenses and zero bundled model weights.
- Remove or stop packaging obsolete production setup resources while retaining source-level legacy baseline for one stable release cycle.
- Update README/notices and, only after architecture lands, update `AGENTS.md` and `.trellis/spec/{asr,tauri,frontend}`.
- Run final cross-child contract review against the parent PRD.

Depends on: T06, T07, T09, T10, T11, T12, T13, T14.

Exit criteria:

- Every parent acceptance criterion is evidenced or explicitly blocks release.
- All required test commands and worker CTest pass.
- No unresolved P0/P1 quality, data-loss, path-security or license issue.
- Any failed engine is returned to its owning child task rather than patched ad hoc here.

Final validation:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
# Native worker CMake configure/build + CTest commands are fixed by T04/T12.
```

Rollback point: restore the previous production package inputs and per-engine route without rewriting user projects or deleting caches. Never require a destructive settings/model migration for rollback.

**Gate 4:** Archive the parent only after T15 passes and all 15 child tasks are independently archived.

## Cross-Task Review Checklist

- [ ] Command/state/type names remain aligned across worker, Rust and TypeScript.
- [ ] Parent engine-route table matches model manifest and UI metadata.
- [ ] Every engine has model-backed quality evidence and legal timestamps.
- [ ] Qwen3 readiness and execution always include the ForcedAligner.
- [ ] Portable/installed roots and cleanup boundaries are covered.
- [ ] Probe performs no recursive storage scan.
- [ ] Runtime/model downloads are pinned, hashed and atomically installed.
- [ ] CPU package contains runtime only, no model weights.
- [ ] Python legacy remains development-only during the agreed rollback window.
- [ ] Current-state specs are updated only when their owning architecture change lands.
- [ ] No child was treated as complete with failing or unavailable mandatory checks.

## Parent Review Gate

Before creating Stage 0 child tasks:

- [ ] User reviews and approves `prd.md`, `design.md` and this task map.
- [ ] Confirm T01-T03 are the first creation batch.
- [ ] Keep parent status at `planning`; start only T01 when its child artifacts are ready.
