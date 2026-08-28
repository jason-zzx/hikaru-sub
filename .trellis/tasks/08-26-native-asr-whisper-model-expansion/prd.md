# Expand Native Faster-Whisper models after T18

> **当前状态：阻塞。** T16 已完成；必须先完成并归档 T17 frontend migration 与 T18 release cutover，之后才能激活本任务。这里的 P1 仅表示“首个 post-MVP 优先级”，不表示当前下一项工作。

## Goal

在首个 `faster-whisper / large-v3 / CPU` Native MVP 发布后，立即把其余六个现有 Faster-Whisper 模型纳入同一 CTranslate2 CPU 产品路线：

- `tiny`
- `base`
- `small`
- `medium`
- `large-v2`
- `large-v3-turbo`

本任务是 Native MVP 之后的第一优先级，先于 Kotoba、Qwen3、Parakeet、ReazonSpeech 和 GPU runtime packs。它复用已发布 worker/runtime/model-manager/settings/frontend 架构，不重新开启 Python parity、Whisper discovery 或 GPU qualification 循环。

## Priority And Sequence

- Priority: P1。
- Roadmap position: `T18 Native MVP -> Faster-Whisper model expansion -> other post-MVP engines/GPU`。
- 可在 T18 前完成详细规划和非侵入性准备，但 production implementation/cutover 以 T18 已稳定发布的 large-v3 CPU 路线为基线。
- 本任务完成前，T08R、T11、Parakeet/Reazon 新候选和 T14/T15 默认不抢占其优先级；用户另行明确调整时除外。

## Authority And Dependencies

- 依赖 T18 已发布并验证的 large-v3 CTranslate2 CPU worker/runtime、T12 model manager、T16 availability metadata 和 T17 visible/unavailable UI。
- 复用 T13 final CPU runtime artifact；只有确实需要模型兼容代码变化时才发布新 runtime revision，并必须保持 large-v3 regression 通过。
- 用户 `.asr-benchmark` 仍是质量诊断真值，但 Python quality parity 不作为这些模型的支持门禁。
- Ordinary Whisper 模型必须读取各自 exact CT2 model 的 `n_mels`，支持官方 80/128 Mel contract，并接受 `vocabulary.txt` 或 `vocabulary.json`；不得套用 Kotoba-only `preprocessor_config.json` readiness。

## Confirmed Current Baseline

- T12 model manager 与 T13 final CPU runtime 已完成并归档；当前 Native model manifest 仍只包含 `large-v3`。
- T16 runtime/settings 已完成并归档；T17 frontend migration 与 T18 release cutover 尚未创建或完成。T17 是当前下一任务，T18 必须在 T17 后执行，本任务必须继续阻塞到 T18 完成归档。
- Rust model manager 已把本任务的六个模型标记为 `postMvpUnavailable`，并已具备多 entry manifest、独立 readiness、断点续传、hash 校验和原子发布能力。
- 前端 `ASR_ENGINE_MODELS` 已列出全部六个模型，因此本任务不需要新增第二套模型注册表。
- 已发布 worker 源码按模型读取 `n_mels`，接受 80/128 Mel，并接受 `vocabulary.txt` 或 `vocabulary.json`；ordinary Whisper 不要求 `preprocessor_config.json`。因此默认假设无需修改或重建 worker，真实模型 smoke 才能推翻该假设。
- Hugging Face 当前可冻结的仓库 revision 已确认：Systran 的 `tiny/base/small/medium/large-v2` 与 canonical `dropbox-dash/faster-whisper-large-v3-turbo`。实现时仍须重新获取每个必需文件的精确 size/SHA-256 并验证许可证来源，不能依赖 floating `main` 或重定向 alias。

## Activation Gate

- 本任务可以在 T18 前完成详细规划、模型 identity 调研和不改变生产行为的准备。
- 生产实现与启用必须等待 T18 建立稳定的 Native large-v3 CPU baseline；若用户决定提前实施，必须先显式调整父任务顺序和本任务边界，不能在本任务中顺手吸收 T16/T17/T18。

## Requirements

### R1 - Add exact model delivery identities

- 在 T12 manifest architecture 中为六个模型分别冻结 backend、variant、revision、必需文件角色、URL/source、精确大小、SHA-256、许可证和 attribution。
- 每个模型独立 readiness；一个模型缺失、损坏或下载失败不得影响 large-v3 或其他已安装模型。
- 复用 official/China source、`.part`、resume、hash verification、atomic install、legacy CT2 snapshot 和 bounded cleanup 合同。

### R2 - Reuse the released CT2 runtime

- 默认复用 T13/T18 已发布的 CTranslate2 CPU worker，不新增 backend、Python dependency、CrispASR、ORT/VAD 或 GPU runtime。
- 验证每个模型的 Mel、vocabulary、tokenizer、model window 和 load contract。
- 若必须修改 worker，冻结新的 runtime identity，并对 large-v3 和全部已启用模型运行回归；不得以模型文件名猜测配置。

### R3 - Functional model enablement

- 六个模型必须分别完成模型下载/readiness、worker load、短音频端到端转录和合法结果验证。
- `large-v2` 额外完成一次超过 10 分钟日语音频功能 smoke。
- 输出必须非空、UTF-8 合法、时间有序、正时长且 audio-bounded，并保持 protocol、cancel、crash 和 recovery 合同。
- CER、S/D/I、semantic gaps 和相对 Python legacy 指标继续记录为诊断，不要求逐项非回退。
- 空结果、非法时间轴、文本损坏、模型无法稳定加载或无法完成规定 smoke 仍阻止对应模型启用。

### R4 - Backend/settings/frontend integration

- 扩展 T16 model availability metadata，使每个模型独立表示 downloading/ready/available/unavailable/error。
- 扩展 T17 UI：通过功能门禁的模型从“后续支持”切换为可选择；失败模型继续可见并说明原因。
- 保持现有 command、`AsrJobSnapshot`、下载进度、任务轮询和 ASS 生成合同。
- 不得隐藏失败模型或静默回退 Python。

### R5 - Independent rollout and rollback

- 每个模型独立启用；一个模型失败不影响 large-v3 或其他已通过模型。
- 模型 manifest/runtime revision/settings/UI 必须保持向后兼容，回退不得删除用户模型、项目、字幕或设置。
- 发布说明列出各模型的可用状态和已知质量限制。

## Acceptance Criteria

- [ ] T18 已提供稳定的 Native large-v3 CPU production baseline，或用户已明确批准并记录新的父任务执行顺序。
- [ ] 六个模型均具备精确、非 floating 的 model manifest identity、license 和 atomic readiness 测试。
- [ ] 六个模型均能通过 released/revised CTranslate2 CPU worker 加载并完成短音频端到端转录。
- [ ] `large-v2` 通过超过 10 分钟日语音频功能 smoke。
- [ ] 所有启用模型输出非空、UTF-8 合法、时间有序、正时长且 audio-bounded，无 protocol/text-conservation failure。
- [ ] large-v3 现有 Native MVP 路线、取消、崩溃、恢复和 installed/portable 行为无回归。
- [ ] T16/T17 对每个模型提供独立准确的 availability 和下载状态；不存在隐藏模型或 silent Python fallback。
- [ ] Python parity、GPU qualification 和完整字幕质量矩阵未被重新引入为支持前置条件；已知质量指标被记录为诊断。
- [ ] 相关 worker CTest、Rust tests、frontend tests、`pnpm build` 和 installed/portable smoke 通过。

## Out Of Scope

- Kotoba、Qwen3、Parakeet、ReazonSpeech。
- CUDA/Vulkan runtime packs 和 GPU routing/qualification。
- 新 Whisper 算法 discovery、reference repair 或 Python parity optimization。
- macOS、Linux、ARM 和多任务并发。
