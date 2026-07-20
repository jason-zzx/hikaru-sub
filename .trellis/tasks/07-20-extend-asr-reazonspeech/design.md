# 技术设计

## 1. 范围与决策

本任务在现有 ASR 插件体系内完成两项扩展：

1. faster-whisper 增加 `large-v3-turbo` 模型选项，不改变引擎实现与默认模型。
2. 新增 `reazonspeech-nemo` 引擎，仅支持
   `reazon-research/reazonspeech-nemo-v2`。

ReazonSpeech 首期采用官方原生整段推理，不接入 VAD、固定分块或流式推理。依赖、
模型和转录仍经过现有 React -> Tauri -> Python sidecar 链路，不新增 Tauri command
或 HTTP API。

## 2. 跨层数据流

```text
设置/转录页
  -> 选择 engine=reazonspeech-nemo + 唯一 model
  -> resolveAsrSetupProfile(reazonspeech-cpu|reazonspeech-cuda)
  -> Tauri asr_setup 安装共用 NeMo/PyTorch requirements
  -> sidecar /engines 验证新引擎可用

ModelManager
  -> /models/status
  -> ReazonSpeechNemoEngine.is_model_downloaded
  -> /models/download
  -> Hugging Face snapshot_download(HF_HOME/HF_ENDPOINT)

转录页
  -> 现有 start_asr / POST /transcribe
  -> JobManager 预探测 WAV 时长
  -> ReazonSpeechNemoEngine 原生整段推理
  -> RNN-T subword timestamps -> AsrSegment[]
  -> 现有 job snapshot / ASS 输出流程
```

边界字段保持不变：引擎和模型仍为字符串，job/model/setup snapshot 的 camelCase
JSON 契约不增加字段。

## 3. faster-whisper 模型

`src/constants/asr.ts` 的 faster-whisper 列表新增 `large-v3-turbo`。当前
`faster-whisper>=1.1.1` 已将该短名称映射到上游 CTranslate2 模型，因此：

- 不新增 Python requirement；
- 不新增独立引擎；
- 复用现有模型缓存完整性检查、下载、VAD、设备与 compute type；
- 不改变 `large-v3` 默认值。

补前端常量测试，确认选项存在且默认值未变化。

## 4. ReazonSpeech sidecar 引擎

新增 `engines/reazonspeech_nemo.py`，实现 `AsrEngine`：

- `name = "reazonspeech-nemo"`；
- 默认且唯一模型为 `reazon-research/reazonspeech-nemo-v2`；
- 未传入该模型 ID 时明确报错，不静默加载其他 NeMo 模型；
- `is_available()` 仅做 `nemo`/`torch` 模块探测，避免列表查询触发重型导入；
- `load()` 使用 `EncDecRNNTBPEModel.from_pretrained`，支持 `cpu`、`cuda`、
  `auto`；显式 CUDA 不可用时返回可操作错误；
- `transcribe()` 读取项目约定的 16 kHz、16-bit PCM WAV，转为 float tensor，按
  官方实现增加 0.5 秒静音 padding，一次性调用 NeMo
  `model.transcribe(..., return_hypotheses=True)`；
- `compute_type` 与 `language` 对该日语 NeMo 引擎无效，输出语言固定为 `ja`；
- `use_vad`/`vad_config` 被忽略，保证自定义 sidecar 客户端传入时仍是原生推理。

音频不符合项目 WAV 契约时返回 `AsrError`，不新增 librosa/soundfile 依赖来扩大
输入格式。格式转换继续由 Tauri/FFmpeg 音频提取层负责。

### 4.1 时间戳转换

适配器实现 ReazonSpeech 官方 Apache-2.0 解码规则并在源码及
`THIRD_PARTY_NOTICES.md` 标注来源：

- 从 hypothesis 的 `y_sequence` 与 `timestamp` 读取 subword 及 step；
- 去除 SentencePiece 起始空白 marker；
- 使用官方 `0.08 s/step` 与 `0.5 s` padding 偏移计算时间；
- 按句末标点、逗号、subword 数和 0.5 秒停顿生成 segment；
- 转为毫秒并校验 `end_ms > start_ms`、非空文本及音频范围。

缺失或错位的时间戳视为模型契约错误并明确失败，不降级成整段均分字幕，避免生成
看似成功但不可校对的错误时间轴。

### 4.2 原生推理进度与取消

`JobManager` 已在调用引擎前探测音频时长。ReazonSpeech 的阻塞 NeMo 调用期间：

- `durationMs` 有值；
- `processedMs`/`progress` 保持真实值，不用计时器伪造；
- cancel endpoint 只设置现有事件；
- 引擎在推理前与返回后检查 cancel；若推理期间请求取消，则不产出 segments，
  `JobManager` 最终写入 `cancelled`，不生成完整 ASS。

前端在 ReazonSpeech 描述中说明“原生整段推理，取消将在当前推理返回后生效”。不修改
通用 job 状态机，也不通过杀 sidecar 强制中断。

## 5. 模型下载与缓存

模型仓库的完成标记为 `reazonspeech-nemo-v2.nemo`：

- `is_model_downloaded()` 用 `huggingface_hub.try_to_load_from_cache` 检查该文件；
- `download_model()` 经共享 helper 调用 `snapshot_download`，写入现有 `HF_HOME`；
  仅 `allow_patterns=[reazonspeech-nemo-v2.nemo]`，不下载 README 等无关文件；
  中国大陆源继续由 Tauri 注入 `HF_ENDPOINT`；
- 下载失败沿用现有 DownloadManager、镜像提示和诊断日志。

### 5.1 共享 HF 下载辅助（`engines/hf_download.py`）

将引擎无关的 Hugging Face 下载逻辑集中到 `snapshot_download_repo`：

- 可选 `tqdm_class` 字节进度适配（faster-whisper / ReazonSpeech 使用；
  Parakeet / Qwen3 仍可在下载完成后 walk 目录上报体积）；
- Windows 上首次调用即设置 `max_workers=1`，避免无开发者模式时的并发
  symlink 探测竞态；其他平台沿用 Hugging Face Hub 默认 worker 数；
- 不在应用层探测 hub 私有缓存状态或扫描异常链，下载失败直接由调用方包装展示。

**调用方（实现后全部统一）**：faster-whisper、kotoba（经 faster-whisper）、
ReazonSpeech、Parakeet、Qwen3-ASR。不要再在各引擎内直接调用裸
`huggingface_hub.snapshot_download`，以免 Windows 缓存 symlink 行为再次分叉。

说明：1314 是 Windows + hub 缓存布局的平台问题，不是 ReazonSpeech 独有；
整仓/多文件并发下载更容易复现。共享 helper 的目的是所有引擎同一套兜底，
而不是只修新引擎。

## 6. 依赖准备

新增 setup profile 字符串：

- `reazonspeech-cpu`
- `reazonspeech-cuda`

依赖文件按“共享核心、设备入口独立”组织：

- 新增 `requirements-nemo.txt`，集中维护
  `nemo_toolkit[asr]==2.7.3`、`fsspec==2024.12.0` 与
  `huggingface_hub>=0.23.0`；
- `requirements-parakeet.txt` 改为兼容入口，只引用 `requirements-nemo.txt`；
- 新增 `requirements-reazonspeech.txt`：`torch>=2.6.0` +
  `-r requirements-nemo.txt`；CPU/CUDA setup profile 共用此文件，并由 profile
  选择对应的 PyTorch wheel source；
- Parakeet CPU/CUDA 文件继续保留自身的 `torchaudio` 声明和兼容入口，不改变现有行为。

因此 ReazonSpeech 不引用 `requirements-parakeet-cpu.txt` / `-cuda.txt`，不会仅因
复用而直接安装 `torchaudio`，也不会下载 Parakeet 模型。`nemo_toolkit[asr]` 自身的
官方 ASR extra 仍会安装其声明的传递依赖；不手工裁剪这些依赖，否则会形成未受支持的
NeMo 安装组合。根 `requirements.txt` 仍是共享 sidecar 基础环境，包含 FastAPI、
Uvicorn、Pydantic 和默认 faster-whisper 引擎；同一受管 venv 面向应用全部引擎，
不为 ReazonSpeech 创建第二个 venv。

前端 `auto` 根据现有 NVIDIA GPU 探测选择 ReazonSpeech profile。Rust profile 映射到：

- CPU: `requirements.txt` + `requirements-reazonspeech.txt`，使用 CPU wheel source
- CUDA: `requirements.txt` + `requirements-reazonspeech.txt`，使用 CUDA wheel source

`scripts/setup-asr.sh` 增加 `reazonspeech`、`reazonspeech-cpu`、
`reazonspeech-cuda` 参数及日志。Tauri 的 PyTorch source 判断加入 ReazonSpeech
requirements 文件名，profile 验证仍要求具体 engine 对应，防止依赖安装不完整却误报
成功。不会安装未发布到包索引的 `reazonspeech-nemo-asr` GitHub 源包。

## 7. 前端行为

- 引擎列表增加 `ReazonSpeech NeMo`；模型列表仅一个官方模型。
- 设置页说明其复用 NeMo 可选依赖、CPU 较慢且 CUDA 推荐。
- 转录页说明原生整段推理与延迟取消语义。
- ReazonSpeech 被选中时不渲染 VAD 卡片；切换到其他引擎后原有会话态 VAD 设置仍在，
  不写入持久设置，也不改变其他引擎行为。
- ModelManager、引擎可用性检测、开始前模型下载确认继续复用现有组件。

## 8. 开发树与发布资源

`asr-service/` 是开发源。实现完成后将以下行为文件同步到
`src-tauri/resources/asr-service/`：

- 新引擎与共享下载辅助模块（`hf_download.py`）；
- 已改走 helper 的 faster-whisper / Parakeet / Qwen3；
- registry；
- requirement 注释；
- sidecar README。

测试仅保留在开发树。同步后对相关文件执行差异检查，避免发布模板遗漏引擎。

## 9. 兼容性、回退与许可

- 旧设置继续使用原引擎/模型；默认仍是 faster-whisper `large-v3`。
- 不改变 HTTP/IPC schema、缓存根目录或运行时源 manifest。
- 所有引擎模型下载统一经 `snapshot_download_repo`：进度策略可按引擎保持
  （tqdm 字节 vs 完成后 walk），Windows 统一使用单 worker。
- 未安装 NeMo 时新引擎显示不可用，但 sidecar 与其他引擎正常启动。
- 回退只需移除新 engine/profile/选项；已有 Hugging Face 缓存可由现有模型缓存清理
  流程处理，不做迁移。
- ReazonSpeech 代码和模型为 Apache-2.0；本地时间戳适配明确记录上游来源与修改。
  large-v3-turbo 转换模型按其 MIT model card 记录到第三方声明。

## 10. 验证设计

自动化覆盖：

- faster-whisper 新选项与默认不变；
- ReazonSpeech engine/model/profile 映射；
- 缺依赖时 registry 仍可加载；
- 模型缓存 marker、下载进度适配与 `hf_download` 的 Windows 单 worker 参数；
- Parakeet/Qwen3 经 helper 下载的单测接线；
- CPU/CUDA/auto 设备分支（mock torch/NeMo）；
- subword 时间戳、起始空白、分段、非法 timestamp；
- 原生推理忽略 VAD、延迟取消且不产出结果；
- Rust requirements/profile/engine 验证与 CUDA profile；
- 发布资源与开发源关键文件同步。

真实冒烟测试使用官方 ReazonSpeech demo 音频，先转为项目标准 WAV，再通过新引擎完成
模型下载、缓存检测、CUDA 加载与转录。当前机器为 RTX 3070 8 GB；若 CUDA OOM，
回退 CPU 并记录 CUDA 未通过实机验证，不把自动化 mock 当作实机成功。
