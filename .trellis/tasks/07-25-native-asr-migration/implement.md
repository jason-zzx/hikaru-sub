# 原生 ASR 迁移实施总计划

> 状态：父任务保持 `planning`。路线已从 quality-first multi-engine qualification 改为 release-first Native MVP。首版只交付 `faster-whisper / large-v3 / CPU`；字幕质量 parity、多引擎和 GPU packs 全部后移。

## Execution Policy

- 父任务保存总需求、设计、任务地图和跨任务门禁，通常不执行 `task.py start`。
- 当前只启动 Native MVP critical path 的 owning child。
- 每个 child 在启动前完成自己的 PRD/design/implement 和上下文清单。
- 父子关系只表达交付物归属；依赖必须写入 child 规划。
- 不修改归档 evidence，不再创建 ordinary Whisper quality/parity/discovery task。
- 未经用户单独明确授权不得 commit、push、merge、rebase、reset 或 archive with commit。

## Completed Foundation

以下归档工作继续作为 MVP 基础，不需要重做：

| Area | Archived result used by MVP |
|---|---|
| T01 benchmark | 用户 WAV+ASS 真值、指标和隐私合同 |
| T02/T03 feasibility | CTranslate2/CrispASR runtime 可行性历史；MVP 只消费 CT2 |
| T04 protocol | protocol v1、limits、fake worker |
| T05 Rust host | single job、JSONL reducer、cancel/crash/recovery |
| T06/T07 | production CT2 worker seam、Candidate A、CPU/CUDA development evidence |
| T08～T11 history | post-MVP 模型/质量证据，不进入 MVP critical path |
| T06R/T06D | non-qualified/invalid-evidence closure；不再触发新 Whisper 质量任务 |

Candidate A 历史 `stop-revise` 不改写。当前父任务只新增 `mvp-eligible-with-known-quality-limitations` 的 release disposition。

## MVP Gate Overview

```text
T12 model manager [done] + T13 CPU runtime [done]
                         |
                         v
T16 runtime/settings backend [done]
                         |
                         v
T17 frontend migration [done]
                         |
                         v
T18 Native MVP release [accepted; archive before 08-26]
                         |
                         v
08-26 Faster-Whisper model expansion [next after T18 archive]
```

T18 is accepted. Archive this child during finish-work before activating the post-MVP Faster-Whisper expansion; after that archive, `08-26-native-asr-whisper-model-expansion` is the next executable child. Its P1 priority does not authorize parallel activation while T18 remains active.

## Critical-Path Children

### T12 - Build Native ASR MVP Model Manager

Status: completed and archived.

Directory: `.trellis/tasks/08-20-native-asr-model-manager`

MVP deliverables:

- Freeze exact large-v3 CT2 revision, files, URL/source roles, size, SHA-256, license and attribution.
- Implement official/China source resolution, `.part` resume, verification, atomic install and readiness.
- Reuse valid old CT2 snapshot after exact validation.
- Keep manifest schema extensible, but do not block MVP on other CT2/GGUF/Qwen entries.
- Cover installed/portable roots and cleanup containment.

Depends on: archived T02 CT2 format/route and existing managed-path contracts.

Exit criteria:

- large-v3 download/readiness path is production-ready and fully tested.
- no incomplete, wrong-hash or framework cache is reported ready.
- post-MVP model entries remain explicitly deferred.

Rollback: retain current downloader/default Python path until T18.

### T13 - Build Final Native ASR MVP CPU Runtime Package

Status: completed and archived.

Directory: `.trellis/tasks/08-20-native-asr-cpu-runtime-package`

MVP deliverables:

- Pin CTranslate2/oneDNN/toolchain/runtime dependencies.
- Produce final Windows x64 CPU worker/DLL/manifest/license/hash artifact.
- Compile only large-v3 CT2 + protocol capabilities needed by MVP.
- Integrate verified artifact preparation for installed/portable/release workflows.
- Verify no model weights and no Python/CrispASR/GPU/rejected VAD dependencies enter the artifact.
- Run package identity, missing/wrong DLL, path isolation and cached-model functional smoke.
- Measure setup/portable/unpacked sizes.

Depends on: archived T04 protocol, T05 host and T06 production worker seam.

Exit criteria:

- artifact is reproducible and attested as the final MVP runtime input.
- end-user packaging never runs CMake.
- installed/portable short and >10-minute model-backed functional smoke can be executed with T12-ready large-v3.

Rollback: production package remains Python legacy until T18.

## Current Sequence

### T16 - Migrate Native MVP Runtime And Settings Backend

Status: completed and archived.

Suggested slug: `native-asr-runtime-settings-backend`

Deliverables:

- Replace production Python/venv dependency kinds with built-in CPU runtime, large-v3 model, downloads and app cache.
- Consume exact T12 model identity and T13 runtime artifact.
- Ignore legacy Python paths on load and stop serializing them.
- Expose large-v3 available/unavailable state and non-MVP model metadata.
- Preserve probe vs measure, async `spawn_blocking`, portable paths and bounded cleanup.

Depends on: T12 + T13. T15 is not a dependency.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

Rollback: keep old settings fields as ignored input; do not destructively rewrite user configuration.

### T17 - Migrate Native MVP Runtime And Model UX

Status: completed and archived.

Suggested slug: `native-asr-frontend-migration`

Deliverables:

- Replace Python setup UI with built-in CPU runtime and model status.
- Show large-v3 as the only Native MVP route.
- Keep all other existing models visible and disabled with a clear post-MVP explanation.
- Preserve model download progress, task polling, document guards and ASS generation.
- Remove production Python/venv/pip/service-directory copy.

Depends on: T12 model metadata + T16 backend contract.

Validation:

```bash
pnpm test
pnpm build
```

Rollback: do not ship mixed legacy/new UI and backend contracts.

### T18 - Qualify And Cut Over Native ASR MVP Release

Status: accepted. Archive this child before activating `08-26-native-asr-whisper-model-expansion`.

Directory: `.trellis/tasks/08-28-native-asr-release-cutover`

Suggested slug: `native-asr-release-cutover`

This is an integration/release gate, not a place to add models or fix subtitle quality.

Deliverables:

- Consume and verify exact T12 large-v3 identity and T13 final runtime artifact.
- Run short and >10-minute installed/portable/offline cached-model functional smoke.
- Verify command/state contracts, cancel, crash, recovery, paths, settings migration and zero silent Python fallback.
- Enable only `faster-whisper / large-v3 / CPU` as Native available/default.
- Keep every other existing model visible/unavailable.
- Stop packaging Python sidecar/runtime/venv and obsolete setup resources.
- Verify setup/portable/runtime size, zero bundled models, licenses and attribution.
- Update README/notices and, after architecture lands, update `AGENTS.md` and `.trellis/spec/{asr,tauri,frontend}`.

Depends on: T12 + T13 + T16 + T17 and archived T04/T05/T06 foundation.

Exit criteria:

- Every parent MVP acceptance criterion is evidenced.
- No unresolved P0/P1 functional, data-loss, path-security, privacy or license issue.
- Known Candidate A quality limitations are disclosed but do not fail parity.
- Full required test commands pass.

Final validation:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
# T13-owned worker CMake/CTest and model-backed smoke commands
```

Rollback: restore previous package inputs/default route without deleting user models, projects, settings or subtitles.

## Post-MVP Work

### First Post-MVP P1 - Expand Native Faster-Whisper Model Support

Status: next executable child after the accepted T18 task is archived; keep it planning until that archive completes.

Directory: `.trellis/tasks/08-26-native-asr-whisper-model-expansion`

Roadmap position: immediately after T18 and before all other post-MVP engine/GPU work.

Deliverables:

- Add exact manifest/readiness entries for `tiny`, `base`, `small`, `medium`, `large-v2` and `large-v3-turbo`.
- Reuse the released CTranslate2 CPU worker/runtime by default; validate each model's exact 80/128 Mel and vocabulary contract.
- Run independent download/load/short-audio functional smoke for all six models and >10-minute Japanese smoke for large-v2.
- Extend T16/T17 availability and download UI so each passing model becomes selectable independently.
- Keep quality metrics diagnostic; do not reintroduce Python parity, discovery or GPU qualification as support gates.
- Preserve large-v3, cancel/crash/recovery and installed/portable behavior.

Depends on: completed T18 Native MVP and the released T12/T13/T16/T17 contracts.

Exit criteria:

- all six models pass functional gates and are independently available;
- large-v3 remains regression-free;
- no model silently falls back to Python;
- one model failure cannot disable another released model.

### Later P3 - T08R Kotoba K3 Quality

- Priority P3.
- Keeps K2 safety mechanics and strict quality goals.
- Starts after the P1 Faster-Whisper model expansion unless the user explicitly reprioritizes it.
- Failure cannot block or revoke large-v3 CPU release.

### Later P3 - T11 Qwen3 With ForcedAligner

- Priority P3.
- Requires a future T12 manifest expansion freezing Qwen + ForcedAligner pair.
- Starts after the P1 Faster-Whisper model expansion unless explicitly reprioritized.
- Failure cannot block or revoke large-v3 CPU release.

### Other engines

- Parakeet/ReazonSpeech new candidates.
- Any future Kotoba/Qwen release qualification.

Each receives an independent child and release disposition after the P1 Faster-Whisper model expansion unless explicitly reprioritized.

### T14/T15 - Optional GPU Packs And Qualification

- Create only after the P1 Faster-Whisper model expansion completes, unless the user explicitly reprioritizes GPU work.
- CUDA/Vulkan attempts are independent optional product increments.
- GPU results never retroactively control the released CPU MVP route.

## MVP Cross-Task Review Checklist

- [x] Only large-v3 is runnable; all other model IDs remain visible/unavailable.
- [x] Command/state/type names align across worker, Rust and TypeScript.
- [x] Model download is pinned, hashed, atomic and path-contained.
- [x] Final CPU artifact is reproducible, attested and contains no models/Python/CrispASR/GPU dependencies.
- [x] Worker output is non-empty, UTF-8 valid, ordered, positive-duration and audio-bounded.
- [x] Cancel exits within two seconds; crash/recovery/active-gate behavior remains covered.
- [x] Installed/portable roots, probe/measure/cleanup and offline cached-model behavior pass.
- [x] UI removes Python setup and never silently falls back to Python.
- [x] Candidate A historical evidence remains unchanged; known quality limitations are diagnostic.
- [x] Setup/portable/runtime sizes and third-party notices pass.
- [x] T14/T15 and optional engine quality tasks are absent from the MVP dependency chain.
- [x] Specs are updated only when their owning architecture changes land.

## Parent Completion Gate

Archive the parent only after:

- T12, T13, T16, T17 and T18 are independently accepted and archived;
- T18 enables the large-v3 CPU Native MVP and removes packaged Python dependencies;
- `08-26-native-asr-whisper-model-expansion` is independently accepted/archived after enabling the six remaining Faster-Whisper models;
- every later engine/GPU lane is explicitly recorded as deferred/non-blocking;
- final cross-task review and required validations pass.
