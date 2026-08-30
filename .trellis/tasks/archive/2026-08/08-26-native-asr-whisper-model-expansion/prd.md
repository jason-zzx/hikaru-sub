# Expand Native Faster-Whisper models after T18

> **当前状态：实现、独立检查与人工验收均已通过。** 任务等待用户单独授权提交与 finish-work 归档。

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
- Production implementation/cutover 以已验收并归档的 T18 稳定 large-v3 CPU 路线为基线。
- 本任务完成前，T08R、T11、Parakeet/Reazon 新候选和 T14/T15 默认不抢占其优先级；用户另行明确调整时除外。

## Authority And Dependencies

- 依赖 T18 已发布并验证的 large-v3 CTranslate2 CPU worker/runtime、T12 model manager、T16 availability metadata 和 T17 visible/unavailable UI。
- 复用 T13 final CPU runtime artifact；只有确实需要模型兼容代码变化时才发布新 runtime revision，并必须保持 large-v3 regression 通过。
- 用户 `.asr-benchmark` 仍是质量诊断真值，但 Python quality parity 不作为这些模型的支持门禁。
- Ordinary Whisper 模型必须读取各自 exact CT2 model 的 `n_mels`，支持官方 80/128 Mel contract，并接受 `vocabulary.txt` 或 `vocabulary.json`；不得套用 Kotoba-only `preprocessor_config.json` readiness。

## Confirmed Baseline And Delivered Outcome

- T12 model manager、T16 runtime/settings、T17 frontend migration 与 T18 release cutover 均已完成并归档。
- schema-v1 manifest 现包含七个精确 Faster-Whisper identity；六个扩展模型均已从 `postMvpUnavailable` 切换为独立可下载/可运行状态，其他引擎仍保持 deferred。
- 前端继续复用 `ASR_ENGINE_MODELS`，`large-v3` 保持默认；未新增第二套模型注册表、下载器、command family 或 Python fallback。
- 真实 `large-v2` 证据推翻了“无需修改 worker”的初始假设：通用 single-leading-timestamp source-window fallback 已加入，未按模型名分支，并冻结为 `hikaru-asr-windows-x64-cpu-v2`。
- Systran `tiny/base/small/medium/large-v2` 与 `large-v3`、canonical `dropbox-dash/large-v3-turbo` 的全部 28 个必需文件均按 immutable revision、size 和 SHA-256 验证；ordinary Whisper 仍不要求 `preprocessor_config.json`。
- 所有七模型短音频、`large-v2` 超过 10 分钟音频、host success/cancel/reap、CTest、完整 Rust/frontend/build、runtime/package 和 installed/portable 验证均通过；用户已确认最终人工测试通过。

## Activation Gate

- T18 已建立并通过稳定 Native large-v3 CPU baseline，且已完成归档；激活依赖门槛已满足。
- 本任务按父任务顺序激活；不得重新吸收或重做 T16/T17/T18 的已交付职责。

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

- [x] T18 已提供稳定的 Native large-v3 CPU production baseline。
- [x] 六个模型均具备精确、非 floating 的 model manifest identity、license 和 atomic readiness 测试。
- [x] 六个模型均能通过 revised CTranslate2 CPU worker 加载并完成短音频端到端转录。
- [x] `large-v2` 通过超过 10 分钟日语音频功能 smoke。
- [x] 所有启用模型输出非空、UTF-8 合法、时间有序、正时长且 audio-bounded，无 protocol/text-conservation failure。
- [x] large-v3 现有 Native MVP 路线、取消、崩溃、恢复和 installed/portable 行为无回归。
- [x] T16/T17 对每个模型提供独立准确的 availability 和下载状态；不存在隐藏模型或 silent Python fallback。
- [x] Python parity、GPU qualification 和完整字幕质量矩阵未被重新引入为支持前置条件；已知质量指标被记录为诊断。
- [x] 相关 worker CTest、Rust tests、frontend tests、`pnpm build`、installed/portable smoke 与用户人工测试通过。

最终自动化与包体证据见 `research/final-trellis-check-report.md`；用户在本轮明确确认人工测试通过。

## Out Of Scope

- Kotoba、Qwen3、Parakeet、ReazonSpeech。
- CUDA/Vulkan runtime packs 和 GPU routing/qualification。
- 新 Whisper 算法 discovery、reference repair 或 Python parity optimization。
- macOS、Linux、ARM 和多任务并发。
