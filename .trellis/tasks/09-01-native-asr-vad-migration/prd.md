# Add Native ASR VAD support

## Goal

在 Qwen3、Parakeet 和 ReazonSpeech 三条模型路线完成并冻结后，在 Qwen child 已冻结的必需 CPU VAD 基础上，迁移其他生产路线与通用配置实际需要的 VAD 行为和模型资产，使 VAD 在独立 Native worker 中固定使用 CPU 运行且不依赖 Python、PyTorch 或 sidecar。

## Background

- v0.4.1 的 Python 路线曾使用 Silero VAD 或引擎专用分块策略；当前 Qwen、Parakeet 与 ReazonSpeech 均已交付必需 CPU Silero。Faster-Whisper/Kotoba 的额外 VAD 需求与通用配置仍待本 child 盘点，不默认所有引擎采用同一策略。
- 三条前置模型 child 均已完成并归档：Qwen 于 2026-09-09、Parakeet 于 2026-09-15、ReazonSpeech 于 2026-09-23。本 child 复用已冻结的模型/runtime/交付与失败合同，不重新实现或重复验收已交付的必需 VAD。
- 前置顺序条件已满足，但本 child 仍处于 planning，尚未获准实施；现有 implement.jsonl/check.jsonl 为空，design.md/implement.md 尚未编写。后续须先明确适用矩阵与配置语义，再经用户批准启动。
- 通用 VAD 会改变模型输入、进度和取消边界；不改变 Qwen 已批准的 LIS/插值、Parakeet 上游切片/实际音频再次转录或 ReazonSpeech pure-RNNT endpoint/PCM-support 合同，不重新引入已完成模型的字幕质量研究。

## Requirements

1. 在三条模型 child 完成后，先读取 Qwen 已冻结的 CPU VAD 模型/runtime/交付与失败合同作为依赖，再盘点四类生产路线实际需要的 VAD：Faster-Whisper/Kotoba、Qwen3、Parakeet、ReazonSpeech；不默认所有引擎共享同一策略。
2. 冻结适用引擎、启用策略、参数、模型文件、revision、size、SHA-256、许可证和 CPU runtime 合同。
3. VAD 固定使用 CPU；主请求的 `cpu|cuda|auto` 只选择 ASR 模型设备，不新增 VAD device 字段、CUDA runtime 或设备 UI。
4. CPU ASR 路线验证 `CPU VAD -> CPU ASR`，CUDA ASR 路线验证 `CPU VAD -> CUDA ASR`；两条路径使用同一 VAD identity 和 window 偏移合同。
5. 复用现有请求 `useVad`/`vadConfig` 兼容边界；不支持的参数必须明确拒绝或由后端返回权威原因。
6. VAD 输出窗口必须非负、非逆序、audio-bounded，并保留从窗口到最终 cue 的可追溯时间偏移；偏移只能应用一次。
7. VAD 已显式启用时，缺模型、缺 runtime 或执行失败必须结构化失败，不得静默关闭 VAD、退化为不同算法、回退 Python或生成 synthetic gap fill/timing。
8. 资产接入受管下载、校验、离线复用、修复和清理；probe 不递归计算磁盘占用。
9. 保持模型下载、转录进度、取消、恢复、安装版/portable 和已发布非 VAD 路线无回归。

## Acceptance Criteria

- [ ] VAD 适用矩阵和每条路线的启用/禁用语义被冻结并写入后端权威能力；VAD device 固定为 CPU。
- [ ] exact VAD model/CPU-runtime identity、来源、哈希和许可证合同完整；不新增独立 VAD CUDA runtime，不捆绑或按设备复制 VAD 权重。现有 CrispASR CUDA CLI 中在 CPU 执行的 Silero 实现与 CPU 支撑代码不属于 VAD GPU 路线。
- [ ] `CPU VAD -> CPU ASR` 与 `CPU VAD -> CUDA ASR` 均通过 short/medium/long、静音、leading/trailing silence、无语音、碎片语音和取消门禁。
- [ ] 所有 accepted cue 时间轴可追溯到合法 VAD window + 模型输出，不新增 synthetic repair；Qwen 沿用用户已批准的上游 LIS/插值，不将旧 raw-only 规则套回该路线。
- [ ] 无 Python、venv、PyTorch 或 sidecar fallback。
- [ ] 已完成模型的非 VAD 基线和现有 CPU/CUDA 路线无回归。

## Out Of Scope

- 在 Qwen3、Parakeet 或 ReazonSpeech 完成前提前实施本 child 的通用/其他引擎 VAD；Qwen child 的最小 CPU VAD 前置已获批准，不受此禁令约束。
- 应用版本发布、Kotoba K3、多 GPU、Vulkan 或非 Windows 平台。
- 为没有产品需要的引擎预建通用 VAD 抽象。
- VAD CUDA 加速、VAD 设备选择或 VAD CUDA runtime pack。
