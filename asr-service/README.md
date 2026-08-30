# ASR Sidecar（开发与历史回退源码）

此目录保留 Hikaru Sub 旧版 Python ASR sidecar，用于开发、历史引擎研究、诊断和一个稳定发布周期的回退证据。当前桌面生产路线使用随应用提供的独立 Native CTranslate2 CPU worker，支持 manifest 锁定的 Faster-Whisper `tiny / base / small / medium / large-v2 / large-v3 / large-v3-turbo`；发布包不再包含、复制或启动此 Python sidecar。

以下 HTTP API、Python 引擎和安装说明只适用于源码开发或有意进行的历史路径排障，不代表当前发布版能力。

## 目录结构

```
asr-service/
├── main.py            # 入口：选端口、启动 uvicorn、stdout 打印就绪端口
├── server.py          # FastAPI 应用与路由
├── jobs.py            # JobManager：后台线程转录、进度跟踪、取消
├── schemas.py         # HTTP 请求模型
├── engines/
│   ├── base.py        # AsrEngine 抽象、AsrSegment、Transcription
│   ├── faster_whisper.py  # 长/短路径路由、模型下载与转录适配
│   ├── faster_whisper_model.py  # faster-whisper 1.2.1 长音频生成循环 fork
│   ├── silero_v4.py   # large-v2 长音频使用的受管 Silero V4 资产与 VAD
│   ├── whisper_runtime.py  # Whisper-family 推理锁、seed 所有权与故障门禁
│   ├── kotoba_faster_whisper.py  # Kotoba Whisper v2.0 的 faster-whisper 薄适配器
│   ├── parakeet.py    # NVIDIA NeMo Parakeet 日语适配器（re-export chunking）
│   ├── qwen3_asr.py   # Qwen3-ASR 日语适配器（自带 ForcedAligner 字级时间戳）
│   ├── reazonspeech_nemo.py  # ReazonSpeech NeMo v2（短音频整段 + 长音频 45s 分块，RNN-T 时间戳）
│   ├── hf_download.py # 所有引擎共用的 Hugging Face snapshot 下载适配
│   ├── chunking.py    # 引擎无关的分块/合并/字幕组装工具（parakeet/qwen3 共用）
│   ├── vad.py         # Silero VAD 封装，供 Parakeet / Qwen3-ASR 预切分语音段
│   └── registry.py    # 引擎注册表
├── requirements.txt                # faster-whisper / kotoba-faster-whisper 依赖
├── requirements-nemo.txt           # 共享 NeMo ASR 核心（Parakeet / ReazonSpeech）
├── requirements-parakeet.txt       # 兼容入口 → requirements-nemo.txt
├── requirements-parakeet-cpu.txt   # CPU torch + torchaudio + NeMo
├── requirements-parakeet-cuda.txt  # CUDA 12.6 torch + torchaudio + NeMo
├── requirements-reazonspeech.txt      # torch + NeMo（profile 选择 CPU/CUDA wheel 源）
├── requirements-qwen3.txt          # qwen-asr 本体（不含 torch）
├── requirements-qwen3-cpu.txt      # CPU torch + qwen-asr
└── requirements-qwen3-cuda.txt     # CUDA 12.6 torch + qwen-asr
```

## 安装

源码开发此 sidecar 需要 Python 3.11。生产桌面应用不检测或下载 Python，也不创建 `deps/asr-service/.venv`；以下脚本仅用于开发环境和手动排障。

### 开发/排障：使用安装脚本

在仓库根目录执行（自动创建 `asr-service/.venv`）：

```bash
./scripts/setup-asr.sh              # faster-whisper / kotoba-faster-whisper 依赖
./scripts/setup-asr.sh parakeet-cuda  # 额外安装 Parakeet（CUDA torch）
./scripts/setup-asr.sh qwen3-cuda     # 额外安装 Qwen3-ASR（CUDA torch）
./scripts/setup-asr.sh reazonspeech-cuda  # 额外安装 ReazonSpeech（CUDA torch）
pnpm asr:setup                      # 同上，通过 pnpm 调用
pnpm asr:setup -- parakeet-cuda
```

| 场景 | 命令 |
|------|------|
| 日常开发（faster-whisper / kotoba-faster-whisper 依赖） | `./scripts/setup-asr.sh` |
| 有 N 卡、想试 Parakeet | `./scripts/setup-asr.sh parakeet-cuda` |
| 无 GPU 但想试 Parakeet（CPU，慢且重） | `./scripts/setup-asr.sh parakeet-cpu` |
| 让脚本按 GPU 选择 Parakeet 的 torch | `./scripts/setup-asr.sh parakeet` |
| 有 N 卡、想试 Qwen3-ASR | `./scripts/setup-asr.sh qwen3-cuda` |
| 无 GPU 但想试 Qwen3-ASR（CPU） | `./scripts/setup-asr.sh qwen3-cpu` |
| 让脚本按 GPU 选择 Qwen3 的 torch | `./scripts/setup-asr.sh qwen3` |
| 有 N 卡、想试 ReazonSpeech | `./scripts/setup-asr.sh reazonspeech-cuda` |
| 无 GPU 但想试 ReazonSpeech（CPU，慢） | `./scripts/setup-asr.sh reazonspeech-cpu` |
| 让脚本按 GPU 选择 ReazonSpeech 的 torch | `./scripts/setup-asr.sh reazonspeech` |

`faster-whisper / kotoba-faster-whisper` 共用该依赖；Kotoba 使用 `kotoba-tech/kotoba-whisper-v2.0-faster`，无需安装额外 Python 依赖。普通 faster-whisper 的项目自维护生成循环以 `faster-whisper==1.2.1` 为兼容基线，并固定使用已验证的 `ctranslate2==4.8.0`；Kotoba 自身的最低运行时能力要求仍为 `>=1.1.1`。

使用自定义 ASR 服务目录时，应先确保目录中的 `engines/registry.py` 已注册 Kotoba 且包含 `engines/kotoba_faster_whisper.py`。依赖配置结束时会验证实际选择的引擎；只有 faster-whisper 可用、但 Kotoba 缺失时，配置任务会明确失败。

**默认不会安装 Parakeet / Qwen3-ASR / ReazonSpeech。** 这些引擎依赖 NeMo / qwen-asr + PyTorch，体积大。ReazonSpeech 使用独立的 `requirements-reazonspeech.txt`（共享 `requirements-nemo.txt`，不直接声明 torchaudio），CPU/CUDA setup profile 负责选择对应的 PyTorch wheel 源。非 N 卡环境请勿安装 CUDA 版；sidecar 仍可正常启动，`/engines` 会将未安装的引擎标为不可用。

### 手动安装

```bash
cd asr-service
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # faster-whisper / kotoba-faster-whisper 依赖
```

可选 Parakeet（须先装好 `requirements.txt`）：

```bash
pip install -r requirements-parakeet-cpu.txt    # CPU 版 torch，无 nvidia-cudnn 等
pip install -r requirements-parakeet-cuda.txt     # CUDA 12.6 torch（需 NVIDIA GPU）
```

可选 Qwen3-ASR（须先装好 `requirements.txt`）：

```bash
pip install -r requirements-qwen3-cpu.txt    # CPU 版 torch
pip install -r requirements-qwen3-cuda.txt     # CUDA 12.6 torch（需 NVIDIA GPU）
```

GPU 加速（faster-whisper / kotoba-faster-whisper CUDA）需另行安装匹配的 CUDA / cuDNN，详见 faster-whisper 文档；与 Parakeet / Qwen3-ASR 的 torch 安装相互独立。

## 模型缓存与镜像

桌面端启动 sidecar 时会把 `HF_HOME` 指向受管模型缓存目录，安装版通常为 `deps/models/huggingface`。当用户在设置页选择中国大陆镜像时，sidecar 还会接收 `HF_ENDPOINT=https://hf-mirror.com`；官方源则不设置 `HF_ENDPOINT`。

faster-whisper 系列模型只有在缓存目录包含 `config.json`、`model.bin`、`tokenizer.json` 和 `vocabulary.*` 时才视为已下载。普通 `large-v2` 还要求受管缓存 `$HF_HOME/hikaru-sub/silero-vad-v4/silero_vad.onnx` 存在并通过固定 SHA-256 校验；模型下载确认流程会从 Silero VAD `v4.0` 的固定提交下载该约 1.8 MiB 资产，中国大陆源使用项目配置的 GitHub 代理。资产不会进入 git 或应用资源。Kotoba 还必须包含 `preprocessor_config.json`（128 维特征配置）；手动复制或下载中断导致该文件缺失时，模型状态会保持“未下载”，以避免到推理阶段才因特征维度不匹配失败。其他普通 faster-whisper 模型不强制要求 `preprocessor_config.json` 或 V4 资产。

模型下载进度快照会返回 `hfEndpoint`、`hfHome` 和 `debugLogPath`，桌面端「模型状态」区域会显示下载源与诊断日志路径。`hf-mirror.com` 可能按出口 IP 重定向到 Hugging Face 原站；如果用户选择中国大陆镜像但仍下载失败，应查看 `asr-debug.log` 中的 `model_download_*` 事件，并考虑切换官方源、自定义稳定 endpoint，或确保模型下载流量全程走中国大陆出口。

## 运行

```bash
python main.py --host 127.0.0.1 --port 0
```

`--port 0` 时自动选取空闲端口。服务就绪后向 stdout 打印一行 JSON 供调用方捕获端口：

```json
{"event": "ready", "host": "127.0.0.1", "port": 53124}
```

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查，返回版本 |
| GET | `/engines` | 列出已注册引擎及依赖可用性 |
| GET | `/models/status` | 检查指定引擎/模型是否已在本地缓存 |
| POST | `/models/download` | 创建模型下载任务，返回 `jobId` |
| GET | `/models/download/{job_id}` | 查询模型下载进度、下载源和诊断日志路径 |
| POST | `/transcribe` | 创建转录任务，返回 `jobId` |
| GET | `/jobs/{id}` | 查询任务状态/进度/片段（`?segments=false` 仅看进度） |
| POST | `/jobs/{id}/cancel` | 取消任务 |

### POST /transcribe

请求体（camelCase）：

```json
{
  "audioPath": "/path/to/cache/workspace/audio.wav",
  "engine": "parakeet",
  "model": "nvidia/parakeet-tdt_ctc-0.6b-ja",
  "device": "auto",
  "language": "ja",
  "computeType": null,
  "useVad": true,
  "vadConfig": {
    "threshold": 0.5,
    "minSpeechDurationMs": 500,
    "minSilenceDurationMs": 300,
    "speechPadMs": 400,
    "maxSegmentDurationMs": 25000
  }
}
```

- `device`：`auto` / `cpu` / `cuda`
- `language`：`auto` 或 `null` 表示自动检测
- `computeType`：普通短音频通常在留空时按设备推导（cpu→int8，cuda→float16）；唯一例外是普通 `faster-whisper` 的日语 `large-v2`、WAV 时长不足 10 分钟、且值为留空/`auto`/`default` 时，有效非 CPU 设备使用已验证的 `int8_float16`，CPU 使用 `int8`。显式值始终保留。若调用方先执行了无法得知语言/时长的公共 `load()`，转录时仅在计算精度不匹配时释放旧模型并重载一次。日语 `large-v2` 长音频路径固定使用 CUDA/auto `int8_float16`，CPU 与 auto 回退使用 `int8`。
- `useVad` / `vadConfig`：可选 VAD 高级配置。普通 faster-whisper 的短音频路径与 Kotoba 继续透传到上游 Silero V6；日语 `large-v2` 且 WAV 时长至少 10 分钟时使用受管 Silero V4，默认 threshold `0.45`、最短语音 `250ms`、最短静音 `3000ms`、padding `900ms`，启用会话 VAD 后以请求值覆盖。Parakeet / Qwen3-ASR 用 `engines/vad.py` 先切分语音段，再逐段转录。`reazonspeech-nemo` 忽略 VAD；短音频整段推理，≥60s 音频固定 45s 分块。
- 普通 `faster-whisper` 仅对日语、模型 key `large-v2`、WAV 时长 `>=600000ms` 启用长音频语义路径：在长模型加载前固定调用 `ctranslate2.set_random_seed(0)`，V4 压缩后只执行一次 decode/alignment，使用项目维护的生成循环携带日语 blend/标点 prompt，并仅修复对齐词证实的 30 秒硬空洞。短音频继续使用上游 `WhisperModel`、V6、原有 prompt 与 segment 选项，不启用 V4、长 prompt 或全局词时间戳，也不调用随机种子 API；其中只有上述日语 `large-v2` 默认非 CPU 计算精度改为 `int8_float16`。其他模型、其他语言与 Kotoba 的计算精度和转录行为不变。
- 产品 HTTP 转录路径由 `JobManager` 强制使用 `whisper_inference_session`，锁定 `faster-whisper` / `kotoba-faster-whisper` 的 handle 创建与完整惰性迭代。直接 Python 调用这些引擎时，调用方也必须用该 session 包住 handle 创建和完整迭代；长音频未包裹时会在设置 seed `0` 前明确失败。若长音频结束后的非零 seed 恢复失败，当前 sidecar 的 Whisper 运行时会进入 poisoned 状态，后续两种 Whisper 引擎均拒绝推理，必须重启 sidecar；非 Whisper 引擎不受影响。
- `kotoba-faster-whisper` 仅支持 `kotoba-tech/kotoba-whisper-v2.0-faster`，自身要求 `faster-whisper>=1.1.1`；共享 `requirements.txt` 因普通 faster-whisper 的长音频生成循环兼容性固定安装 `faster-whisper==1.2.1` 与 `ctranslate2==4.8.0`。Kotoba 复用下载、缓存、CPU/CUDA、上游 VAD 与 segment 时间戳，但不要求 V4 资产并继续使用上游原生生成循环；转录固定传入 `chunk_length=15` 和 `condition_on_previous_text=False`。
- `reazonspeech-nemo` 仅支持 `reazon-research/reazonspeech-nemo-v2`。输入须为项目约定的 16 kHz / 16-bit / mono PCM WAV。<60s 音频整段交给 NeMo RNN-T，按官方 subword 时间戳规则分段；≥60s 音频按 45 秒块（2 秒重叠）逐块解码（模型内置 ALSD beam search 的整段耗时随时长二次增长，且整段激活显存在 8GB 显卡约 20 分钟即溢出），复用 `engines/chunking.py` 合并去重，每块完成后上报进度并检查取消，收尾以 `TranscriptSegmentRefresh` 下发最终列表替换预览片段。缓存完成标记为 `reazonspeech-nemo-v2.nemo`。
- `parakeet` 引擎当前针对日语模型，语言固定按 `ja` 返回；会优先读取 NeMo char timestamps，再按日语标点、长度和停顿重新切分字幕段（`engines/chunking.py`）。长音频分块合并时会合并重叠文本而非简单取长弃短。

  **Gap backfill**（缓解漏句与重叠碎片）：
  - 主路径：相邻字幕间隙 ≥2.5s 时补转；另按 Silero 语音活动覆盖率扫描未覆盖区间。
  - 逐窗口 `apply_gap_backfill`：在 gap 内 supersede 主路径残留碎片，并用 context 补转补全间隙内容。
  - 第二轮 context backfill 带 padding，窗口结果裁切到 gap 后再合并。
  - 收尾 `dedupe_transcript_segments` 去同文重叠与尾缀子串重复；`TranscriptSegmentRefresh` 用最终列表替换任务预览片段。

  VAD + backfill 已完成长音频完整性增强，最终片段列表会在写入前统一去重与刷新。
- `qwen3-asr` 引擎模型为 `Qwen/Qwen3-ASR-1.7B`，默认携带 `Qwen/Qwen3-ForcedAligner-0.6B` 产出字级时间戳，语言固定按 `ja` 返回。长音频自动分块转录，复用 `engines/chunking.py` 合并去重；CPU 用 `torch.float32`、CUDA 用 `torch.bfloat16`。模型下载为双权重（ASR + aligner），由引擎层封装为单一逻辑模型。

响应：

```json
{ "jobId": "a1b2c3...", "status": "pending" }
```

### GET /jobs/{id}

```json
{
  "id": "a1b2c3...",
  "status": "running",
  "progress": 0.42,
  "durationMs": 600000,
  "processedMs": 252000,
  "segmentCount": 120,
  "detectedLanguage": "ja",
  "error": null,
  "segments": [
    { "startMs": 0, "endMs": 1200, "text": "..." }
  ]
}
```

`status` 取值：`pending` / `running` / `completed` / `failed` / `cancelled`。

## 调试日志

诊断实现见 `diagnostics.py`（JSONL 事件、`HIKARU_ASR_TRACE_MS_RANGE` 时间窗过滤、`*_in_trace` 片段 diff）。

手动运行 sidecar 或显式测试 legacy 回退路径时可写入 `asr-debug.log`。当前生产 Native 路线不创建或读取 `deps/asr-service/asr-debug.log`。

手动调试时可设置：

```bash
export HIKARU_ASR_DEBUG_LOG=/tmp/asr-debug.jsonl
export HIKARU_ASR_DEBUG_DETAIL=1   # 设为 0 可关闭逐段 dump
export HIKARU_ASR_TRACE_MS_RANGE=8000-14000  # 可选：诊断关注的时间窗（毫秒）
python main.py
```

Parakeet 相关事件包括：

- `parakeet_chunk_segments_raw` / `parakeet_chunk_segments_merged`：每块原始与合并后字幕
- `parakeet_merge_duplicate`：重叠去重时的文本合并（含 `inTraceRange`）
- `parakeet_supplemental_append`：backfill 新增片段（未判为重复时）
- `parakeet_*_in_trace`：在 `HIKARU_ASR_TRACE_MS_RANGE` 窗口内的片段快照与前后 diff
- `parakeet_backfill_windows` / `parakeet_backfill_*_segments`：gap + 覆盖率补转窗口与结果
- `job_segment_refresh_in_trace`：写入 ASS 前最终 refresh 列表在关注窗口内的片段

模型下载相关事件包括：

- `model_download_queued` / `model_download_start` / `model_download_completed` / `model_download_error`
- 事件字段会包含 `hfEndpoint`、`hfHome`、`debugLogPath`；镜像或重定向问题优先从这些字段确认实际环境。

## 扩展新引擎

1. 在 `engines/` 下实现 `AsrEngine` 子类（`load()` + `transcribe()`），通过惰性导入处理可选依赖。
2. 在 `engines/registry.py` 的 `_REGISTRY` 中注册。
3. 补充 sidecar 单元测试，并在源码环境中验证对应 Python profile。
4. 若要把引擎加入桌面产品，必须另建独立 Native/runtime/model/frontend 发布任务；不要通过 `pnpm asr:prepare-resource` 把此目录重新复制进发布包，也不要把 Python availability 当作生产支持依据。
