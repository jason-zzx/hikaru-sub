# Revise native ASR migration child roadmap

## Goal

根据已归档的 `python-legacy-cuda-v1` native 重评结果，重排 `.trellis/tasks/07-25-native-asr-migration` 的后续子任务，使项目先恢复至少一条可发布的质量路线并冻结模型身份，再进入 runtime pack、设置、前端和发布切换；本任务只修改 Trellis 规划和创建下一批 planning children，不修改生产代码或运行模型。

## Background

- 当前父任务已有 14 个归档子任务，另有本路线重排任务；T11～T18 尚未创建。
- `08-19-native-asr-legacy-quality-reevaluation` 已确认当前 large-v3 Candidate A、Kotoba K2、Parakeet P1、ReazonSpeech R2 和 Qwen T03C 的 observed legacy-relative disposition 均为 `stop-revise`。
- Parakeet、ReazonSpeech、Qwen 的正式 native model/companion mapping 仍待 T12，因此 identity-aware disposition 为 `baseline-incomplete`；这不消除其已观察到的质量或结构失败。
- ordinary Faster-Whisper 仍是首个 native release 的 mandatory route；large-v3 与 large-v2 是独立硬 anchor。
- 用户已批准采用此前建议的质量优先、subset-first 路线：未通过的非 mandatory 模型继续可见但不可用，不阻塞已通过路线。
- 详细 authority 与目标 task map 位于 `research/roadmap-authority.md`。

## Requirements

### R1 - Reconcile the parent with current authority

- 更新父任务 `prd.md`、`design.md`、`implement.md` 中仍把 Candidate A/K2 旧门禁结果当作当前下游接受输入的文字。
- 历史 T06/T08/T10/T10R/T03C artifacts 保持不可变；父任务只前瞻性引用归档重评 authority。
- 父任务明确记录：当前没有 subtitle-quality qualified native candidate，production/default 仍为 Python legacy。

### R2 - Adopt quality-first subset release governance

- ordinary Faster-Whisper 保持首个 native release mandatory；large-v3 与 large-v2 anchor 必须各自完成同模型 Python baseline 非回退矩阵。
- Kotoba 与 Qwen 只有新候选通过后才进入 pack/route qualification。
- Parakeet P1 与 ReazonSpeech R2 首版保持 visible-but-unavailable；本批不创建 P2/R3，也不把 pending T12 mapping 误写为唯一 blocker。
- T18 可以发布非空的 qualified subset，但不得省略 ordinary Faster-Whisper mandatory route，不得隐藏或静默 Python fallback 未通过模型。

### R3 - Add two explicit quality-revision workstreams

在父任务地图中新增：

- **T06R - Ordinary Faster-Whisper quality revision**：新候选 identity，修复逐项 S/D/I/CER 回退，完成 large-v3 与 large-v2 short-v1/medium-v1/long-v2 anchor matrices，保留 T07 仅作为开发 GPU seam，正式设备/pack qualification 仍归 T14/T15。
- **T08R - Kotoba K3 quality revision**：继承 K2 已审查的 bounded-stride/ownership/dedup 安全合同，建立新 K3 identity 并完成三 case legacy-relative 矩阵；不得修改 K2 历史结论或通过 reference-based repair 获得通过。

### R4 - Correct T11-T18 ordering and dependencies

- T12 作为立即并行的模型身份/下载 authority，冻结 CT2、GGUF 和 Qwen companion mapping。
- T11 可以从 T09 capability 开始开发，但 final publication 必须消费 T12 冻结的 Qwen + ForcedAligner mapping。
- T13 只建立 provisional CPU packaging pipeline；最终 worker/runtime identity 由 T18 基于接受的 engine identities 重建和冻结。
- T14/T15 在 T12/T13 完成且至少一个 selected engine 有 accepted final algorithm input 前不得开始；只消费 T06R/T08R/T11 中已通过的 lane，Parakeet/Reazon 默认 omitted。
- T16 依赖 T12/T13/T15；T17 依赖 T12/T16 和稳定 qualification metadata；T18 最后执行并把失败模型保留为 visible/unavailable。
- 父子关系不代表 dependency；每个新 child PRD 必须写明自己的依赖边界。

### R5 - Create only the next planning batch

本任务实现阶段创建但不启动以下五个父任务 children，状态保持 `planning`：

1. `native-asr-whisper-quality-revision`（T06R）；
2. `native-asr-model-manager`（T12）；
3. `native-asr-qwen3-aligner`（T11）；
4. `native-asr-kotoba-quality-revision`（T08R）；
5. `native-asr-cpu-runtime-package`（T13）。

每个 child 至少具有非占位 `prd.md`，记录目标、前置 authority、范围、验收边界和不得提前声称的 release 结论。不得 `task.py start`。

### R6 - Remove fixed child-count assumptions

- 父任务不再声明“固定 18 个子任务”或“18 个子任务全部归档”作为完成条件。
- 完成条件改为：T18 通过、所有 required children 已独立验收归档、所有 optional/deferred lanes 有明确 qualified/omitted/unsupported disposition。
- 路线重排、correction、baseline、reassessment 等治理/evidence child 可以存在，而不会导致父任务数字合同失真。

### R7 - Keep the change planning-only and auditable

- 不修改 `src/`、`src-tauri/`、`asr-service/`、`native-asr/` 或发布配置。
- 不运行 native inference、模型下载、CMake、pnpm build 或 Cargo test。
- 不编辑归档 task artifacts。
- 所有新 task slug、parent link、status 和依赖说明必须可通过 Trellis task metadata 与文档复核。

## Acceptance Criteria

- [x] 父任务 PRD/design/implement 对五个最新候选的状态与归档 legacy-relative handoff 一致，不再把 Candidate A/K2 旧结论当作当前 accepted downstream input。
- [x] 父任务明确采用 ordinary Faster-Whisper mandatory + 其他模型 qualified-subset/visible-unavailable 的发布治理。
- [x] T06R 与 T08R 在父任务 task map、dependency graph、gate 和 rollback 中有独立位置，且不重写 T06/T08 历史 evidence。
- [x] T11 final evidence 对 T12 Qwen/ForcedAligner mapping 有显式依赖；T14/T15 只消费 accepted final lanes。
- [x] T13 被描述为 provisional packaging pipeline，T18 保留最终 rebuild/attestation ownership。
- [x] Parakeet P2/ReazonSpeech R3 明确 deferred，本批没有创建对应 child。
- [x] 五个 next-batch child directories 已链接到父任务，均为 `planning`、未启动、无占位 PRD，并分别记录可测试的 scope/dependencies。
- [x] T14～T18 未在本批创建，仍由父任务 map 在 gate 满足后增量创建。
- [x] 父任务固定“18 children”假设已全部移除，改为 required/optional disposition 驱动的完成条件。
- [x] 归档 task 路径没有修改；Trellis metadata 无重复 child；`task.py validate`、JSON 解析和 `git diff --check` 通过。

## Out of Scope

- 实现或运行 T06R、T08R、T11、T12、T13。
- 创建/实现 T14～T18。
- 创建 Parakeet P2 或 ReazonSpeech R3。
- 修改产品代码、模型、runtime artifact、生产 route、设置或 UI。
- 提交、推送、归档或启动任何任务，除非用户后续单独明确授权。

## Decision Recorded

- 采用质量优先、subset-first 路线，但 ordinary Faster-Whisper 仍是 mandatory release route。
- 下一 planning batch 为 T06R、T12、T11、T08R、T13；T14～T18 按 gate 增量创建。
- Parakeet/Reazon 的下一候选推迟到首条 native 路线稳定后或用户另行要求。
