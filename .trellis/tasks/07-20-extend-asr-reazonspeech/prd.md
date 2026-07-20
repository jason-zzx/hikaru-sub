# 扩展 ASR 模型与 ReazonSpeech 引擎

## Goal

扩展 Hikaru Sub 的日语本地转录能力：为现有 faster-whisper 引擎增加
Whisper large-v3-turbo 选项，并新增可选择、可安装、可下载模型且能参与现有
转录工作流的 ReazonSpeech NeMo v2 引擎。

## Background

- 当前 ASR sidecar 已通过引擎注册表统一暴露 faster-whisper、
  kotoba-faster-whisper、Parakeet 和 Qwen3-ASR。
- faster-whisper 与 Kotoba 使用默认依赖档位；Parakeet 与 Qwen3-ASR 使用独立的
  CPU/CUDA 可选依赖档位。
- 模型状态、下载和转录已经由统一的 sidecar job/API 驱动，受管模型缓存固定在
  Hugging Face 缓存目录中。
- 当前 `faster-whisper>=1.1.1` 已原生识别 `large-v3-turbo` 短名称，无需新增
  faster-whisper 运行依赖。
- ReazonSpeech NeMo v2 与现有 Parakeet 同属 NeMo 生态；官方要求
  `nemo_toolkit[asr]>=2.6.1`，现有 NeMo 2.7.3 与 PyTorch CPU/CUDA 档位可复用。
- 官方 ReazonSpeech 模型为约 2.48 GB 的单一 `.nemo` 权重，支持 CPU/CUDA、
  自带分段时间戳，并声明可直接处理数小时日语音频。

## Requirements

- faster-whisper 模型列表新增 `large-v3-turbo`，沿用现有 faster-whisper
  下载、缓存检测、设备选择、VAD 和转录流程。
- 新增引擎 ID `reazonspeech-nemo`，仅提供模型
  `reazon-research/reazonspeech-nemo-v2`，并注册到 sidecar 的引擎列表。
- ReazonSpeech 引擎应接入现有设置、依赖准备、模型下载状态、下载进度、转录进度、
  取消和错误展示流程。
- 模型下载在 Windows 无开发者模式下不得因 Hugging Face 缓存 symlink
  （WinError 1314）失败；所有引擎共用在 Windows 固定单 worker 的 HF 下载 helper。
- ReazonSpeech 所需大型依赖保持按需安装，并提供 CPU、CUDA 和自动设备选择；
  NeMo 核心版本约束与 Parakeet 共享维护，但 ReazonSpeech 使用独立的最小
  CPU/CUDA requirements，不引用 Parakeet CPU/CUDA profile，也不因复用而直接安装
  其非必要依赖（如 `torchaudio`）。
- 不依赖运行时从 GitHub 安装官方辅助包；引擎直接复用 NeMo/Hugging Face 缓存，
  避免绕过应用的官方源/中国大陆镜像策略。
- ReazonSpeech 输出须按其 RNN-T subword 时间戳规则转换为现有
  `AsrSegment`/ASS 工作流接受的日语时间轴片段。
- ReazonSpeech 首期按官方行为将完整音频一次性交给模型，不启用固定分块或 VAD；
  前端选择该引擎时不显示 VAD 配置，避免产生无效设置。
- 转录任务在推理前探测并展示音频总时长；NeMo 阻塞推理期间不伪造增量进度，
  推理返回后按结果片段更新并完成任务。
- 推理期间收到取消请求时保留请求状态；NeMo 调用返回后任务转为 `cancelled`，
  不保存本次完整转录结果。UI 文案须说明取消不是即时中断。
- 开发目录 `asr-service/` 与发布资源中的 sidecar 内容保持一致。
- 实现验证允许按需安装 ReazonSpeech 的 NeMo/PyTorch 依赖并下载约 2.48 GB 模型；
  应使用短日语音频完成至少一次真实模型加载与时间戳转录冒烟测试。

## Acceptance Criteria

- [ ] 用户可在 faster-whisper 模型选择中选择 large-v3-turbo，完成模型检测、下载和转录。
- [ ] 用户可选择 ReazonSpeech NeMo v2 引擎及其唯一模型，并看到准确的依赖就绪状态。
- [ ] 未安装 ReazonSpeech 可选依赖时，sidecar 仍可启动，其他引擎不受影响。
- [ ] ReazonSpeech setup 只安装 sidecar 基础依赖、PyTorch 与共享 NeMo ASR 核心；
  不下载 Parakeet 模型，也不把 `torchaudio` 声明为 ReazonSpeech 直接依赖。
- [ ] ReazonSpeech 模型可下载到受管 Hugging Face 缓存，下载完成后的状态检测准确；
  Windows 无开发者模式下不因 WinError 1314 失败；faster-whisper / Parakeet /
  Qwen3 / ReazonSpeech 均走同一下载 helper。
- [ ] ReazonSpeech 可在 CPU、CUDA 和自动设备选择下输出带有效起止时间的日语字幕片段。
- [ ] ReazonSpeech 使用原生整段推理；推理期间进度保持真实且不伪造，返回后正常完成。
- [ ] ReazonSpeech 推理期间的取消请求在阻塞调用返回后生效，任务最终为 `cancelled`，
  不写出完整结果，且 UI 明确提示该限制。
- [ ] 选择 ReazonSpeech 时不显示 VAD 配置，提交到 sidecar 的 VAD 参数不影响其原生推理。
- [ ] 新增引擎不会改变现有 ASR 引擎的默认选择或行为。
- [ ] 前端、Rust/Tauri 和 Python sidecar 的相关自动化测试通过。
- [ ] 在本机可用设备路径上完成真实 ReazonSpeech 模型冒烟测试，确认模型加载、
  日语文本和有效分段时间戳；另一设备路径至少由自动化测试覆盖并注明未实机验证。

## Out of Scope

- 更换默认 ASR 引擎或默认模型。
- 捆绑模型权重、Python、PyTorch 或 NeMo 到安装包。
- 扩展非日语源语言选择。
- ReazonSpeech 的分块/VAD 转录、增量推理进度或强制中断 NeMo 推理。
