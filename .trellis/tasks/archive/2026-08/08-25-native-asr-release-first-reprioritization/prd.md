# Reprioritize native ASR for earliest release

## Goal

将 Native ASR 迁移从“字幕质量达到 Python legacy 非回退后才能发布”改为“先发布安全、可运行、无需 Python 的最小 Native ASR 版本，再持续优化字幕质量”。首版以缩短交付路径为最高优先级，字幕质量比较保留为诊断和后续迭代依据，不再作为首版发布阻塞门禁。

本任务只调整 Trellis 任务内容、优先级和依赖关系，不修改生产代码、不运行模型、不启动后续实现任务。

## Confirmed Facts

- Native worker protocol、Rust job host、CTranslate2 production worker seam、取消/恢复和开发 CUDA seam 已完成并归档。
- 已有 large-v3 Candidate A 在用户 benchmark 的 short-v1、medium-v1、long-v2 上具备可执行、合法时间轴和可接受的旧绝对质量/CPU 性能证据；它仅因后来采用的“逐指标不劣于 Python legacy”质量政策被标记为 `stop-revise`。
- 当前路线把 ordinary Faster-Whisper 双 anchor、GPU-only qualification、完整多引擎质量矩阵和 optional GPU packs 放在发布前，已成为主要交付阻塞。
- 模型管理、CPU runtime packaging、runtime/settings、frontend 和 release cutover 仍未完成；这些是“不依赖 Python 的 Native ASR”真正需要的产品化工作。
- Qwen3、Kotoba、Parakeet、ReazonSpeech 和 GPU pack 均可在首版之后独立迭代，不需要阻塞一个可用的 CPU Native MVP。
- 用户进一步确认：其余 Faster-Whisper 模型必须纳入明确 child，并作为 T18 之后第一优先级。

## Product Decision

用户已确认首个 Native MVP 固定为：

- Windows x64；
- bundled CPU runtime；
- 仅启用 `faster-whisper / large-v3`；
- 使用现有 Candidate A 的稳定算法/worker seam，不再开启新的 Whisper 字幕质量发现或 parity 任务；
- short-v1、medium-v1、long-v2 质量指标继续发布，但只作为已知限制和回归观察，不要求不劣于 Python legacy；
- 不包含 CUDA/Vulkan pack，不要求 `large-v2` anchor，不要求 Kotoba/Qwen/Parakeet/ReazonSpeech 通过；
- 其他现有模型保持可见但标记为“Native 暂不可用/后续支持”，不得静默回退到 Python；
- 首版发布包不携带 Python runtime、venv、FastAPI、PyTorch 或 NeMo。

## Requirements

### R1 - Replace quality-first release governance

- 首版发布资格不再依赖 `python-legacy-cuda-v1` 逐指标非回退、GPU-only model qualification 或完整三 case quality pass。
- 历史 benchmark、Candidate A/K2 等 disposition 保持不可变；父任务只新增前瞻性 `mvp-eligible-with-known-quality-limitations` 解释，不改写归档 evidence。
- 字幕质量仍需记录和公开已知限制，但不阻塞首版，除非发现结果为空、时间轴非法、文本损坏或模型无法稳定完成等功能性故障。

### R2 - Define the minimum release lane

- 首版只要求一条可运行的 Native ASR 路线。
- 推荐路线为 `faster-whisper / large-v3 / CPU`，复用已完成的 CTranslate2 worker 与 Candidate A evidence。
- 首版不要求 large-v2 或其余 Whisper 模型获得资格，也不要求 GPU runtime。
- 可见但未纳入 MVP 的模型必须明确不可用，不得隐藏或静默使用 Python。

### R3 - Preserve non-negotiable safety and product contracts

以下门禁继续阻塞发布，不因降低字幕质量优先级而放宽：

- worker protocol、任务状态和 `AsrJobSnapshot` 兼容；
- 单任务、取消、进程树回收、异常退出和恢复快照；
- 合法 UTF-8、非空文本、正时长且 audio-bounded 的时间轴；
- 模型/runtime identity、hash、原子安装、路径 containment 和 cleanup 边界；
- installed/portable、离线已缓存模型、许可证、隐私和零捆绑模型权重；
- 发布包无需 Python/venv/FastAPI/PyTorch/NeMo。

### R4 - Shorten the critical path

首版 critical path 调整为：

1. T12 model manager：先完成 large-v3 所需 CT2 identity/download/readiness；其他模型条目可延期。
2. T13 CPU runtime package：从 provisional-only 调整为首版最终 CPU runtime artifact owner，完成可复现构建、manifest、license、hash、installed/portable smoke 和体积验证。
3. T16 runtime/settings backend：不再等待 T14/T15；只接入 bundled CPU runtime、MVP model 和 unavailable metadata。
4. T17 frontend migration：展示 CPU 内置、large-v3 可用、其他模型 Native 暂不可用，移除生产 Python setup UI。
5. T18 release cutover：集成上述结果、运行产品合同测试并切换首版 Native 默认路线。
6. Post-MVP P1 Faster-Whisper expansion：立即支持 `tiny/base/small/medium/large-v2/large-v3-turbo`。

T14/T15 GPU packs/qualification、T08R Kotoba、T11 Qwen3 和其他 engine quality work 全部移出首版 critical path，并排在 Faster-Whisper expansion 之后。

### R5 - Reprioritize existing planning children

- 父任务、T12 和 T13 提升为 P1。
- `08-26-native-asr-whisper-model-expansion` 创建为 post-MVP P1，目标覆盖 `tiny/base/small/medium/large-v2/large-v3-turbo`，并排在所有其他 post-MVP work 之前。
- T08R 与 T11 保持 P3，并明确为 Whisper expansion 之后的 quality/engine expansion。
- 不创建新的 ordinary Whisper quality-revision、execution-parity 或 discovery task；扩展任务复用 released CT2 route。
- 后续 T16/T17/T18 在本次路线评审通过后按新的依赖创建；T14/T15 延后到 Native MVP 和 Faster-Whisper expansion 之后。

### R6 - Keep changes planning-only

- 只修改父任务、本任务和当前 planning children 的 task artifacts。
- 不编辑归档 task artifacts、`.trellis/spec/` 或产品代码。
- 不启动任何实现 child，不提交 Git。

## Acceptance Criteria

- [x] 用户已确认首个 Native MVP 采用 `faster-whisper / large-v3 / CPU-only` 范围。
- [x] 父任务 PRD/design/implement 明确以最早安全发布为最高优先级，并移除字幕质量 parity、双 anchor 和 GPU qualification 对首版的阻塞。
- [x] Candidate A 被前瞻性描述为 `mvp-eligible-with-known-quality-limitations`，历史 `stop-revise` evidence 保持不变。
- [x] 首版 critical path 只包含 T12、T13、T16、T17、T18，且 T16 不再依赖 T15。
- [x] T12 和 T13 的 PRD 已收窄/调整为首版 large-v3 模型交付与最终 CPU runtime 交付。
- [x] T08R 与 T11 明确为 post-MVP、P3、非阻塞任务。
- [x] 父任务 acceptance criteria 保留安全、兼容、路径、恢复、许可证和无 Python 交付门禁，但将字幕质量指标改为诊断性回归记录。
- [x] T14/T15 和其他模型扩展明确延后到 MVP 发布后，未被误写为删除或永久放弃。
- [x] 已创建 P1 `08-26-native-asr-whisper-model-expansion`，明确覆盖其余六个 Faster-Whisper 模型并位于 T18 后第一顺位。
- [x] Trellis metadata、JSON、task topology、archive immutability 和 `git diff --check` 验证通过。

## Out of Scope

- 修改或执行 Native ASR 代码。
- 重新运行 benchmark、获取新模型结果或修复字幕质量。
- 创建/启动 T16～T18 或 GPU pack tasks。
- 修改归档 evidence 或 `.trellis/spec/asr/quality-guidelines.md`；规范更新留给实际产品路线落地后的 owning task。
- Git commit、push、merge、rebase 或历史修改。

## Decision Recorded

- 首个 Native MVP 采用 `faster-whisper / large-v3 / CPU-only` 单路线。
- 首版不等待其他 CTranslate2 模型、Kotoba、Qwen3、Parakeet、ReazonSpeech 或 GPU pack。
- T18 后第一优先级是扩展 `tiny/base/small/medium/large-v2/large-v3-turbo`，之后才进入其他 engine/GPU work。
- 字幕质量 parity 改为诊断性证据；功能合法性、安全、完整产品流程和无 Python 交付继续作为硬门禁。
