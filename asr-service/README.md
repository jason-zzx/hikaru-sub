# ASR Sidecar

Hikaru-Sub 的本地语音转写服务，作为独立 Python 子进程运行，通过 localhost HTTP 与 Tauri 主进程通信。ASR 推理隔离在此进程，避免阻塞 UI 且便于更换模型/引擎。

## 目录结构

```
asr-service/
├── main.py            # 入口：选端口、启动 uvicorn、stdout 打印就绪端口
├── server.py          # FastAPI 应用与路由
├── jobs.py            # JobManager：后台线程转录、进度跟踪、取消
├── schemas.py         # HTTP 请求模型
├── engines/
│   ├── base.py        # AsrEngine 抽象、AsrSegment、Transcription
│   ├── faster_whisper.py  # 首个适配器
│   ├── parakeet.py    # NVIDIA NeMo Parakeet 日语适配器（re-export chunking）
│   ├── qwen3_asr.py   # Qwen3-ASR 日语适配器（自带 ForcedAligner 字级时间戳）
│   ├── chunking.py    # 引擎无关的分块/合并/字幕组装工具（parakeet/qwen3 共用）
│   ├── vad.py         # Silero VAD 封装，供 Parakeet / Qwen3-ASR 预切分语音段
│   └── registry.py    # 引擎注册表
├── requirements.txt                # faster-whisper 引擎（默认）
├── requirements-parakeet.txt       # NeMo 本体（不含 torch）
├── requirements-parakeet-cpu.txt   # CPU torch + NeMo
├── requirements-parakeet-cuda.txt  # CUDA 12.6 torch + NeMo
├── requirements-qwen3.txt          # qwen-asr 本体（不含 torch）
├── requirements-qwen3-cpu.txt      # CPU torch + qwen-asr
└── requirements-qwen3-cuda.txt     # CUDA 12.6 torch + qwen-asr
```

## 安装

需要 Python 3.10+。

### 推荐：使用安装脚本

在仓库根目录执行（自动创建 `asr-service/.venv`）：

```bash
./scripts/setup-asr.sh              # 默认：faster-whisper
./scripts/setup-asr.sh parakeet-cuda  # 额外安装 Parakeet（CUDA torch）
./scripts/setup-asr.sh qwen3-cuda     # 额外安装 Qwen3-ASR（CUDA torch）
pnpm asr:setup                      # 同上，通过 pnpm 调用
pnpm asr:setup -- parakeet-cuda
```

| 场景 | 命令 |
|------|------|
| 日常开发（默认引擎） | `./scripts/setup-asr.sh` |
| 有 N 卡、想试 Parakeet | `./scripts/setup-asr.sh parakeet-cuda` |
| 无 GPU 但想试 Parakeet（CPU，慢且重） | `./scripts/setup-asr.sh parakeet-cpu` |
| 让脚本按 GPU 选择 Parakeet 的 torch | `./scripts/setup-asr.sh parakeet` |
| 有 N 卡、想试 Qwen3-ASR | `./scripts/setup-asr.sh qwen3-cuda` |
| 无 GPU 但想试 Qwen3-ASR（CPU） | `./scripts/setup-asr.sh qwen3-cpu` |
| 让脚本按 GPU 选择 Qwen3 的 torch | `./scripts/setup-asr.sh qwen3` |

**默认不会安装 Parakeet / Qwen3-ASR。** 这些引擎依赖 NeMo / qwen-asr + PyTorch，体积大。非 N 卡环境请勿安装 CUDA 版；sidecar 仍可正常启动，`/engines` 会将未安装的引擎标为不可用。

### 手动安装

```bash
cd asr-service
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # faster-whisper
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

GPU 加速（faster-whisper CUDA）需另行安装匹配的 CUDA / cuDNN，详见 faster-whisper 文档；与 Parakeet / Qwen3-ASR 的 torch 安装相互独立。

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
| POST | `/transcribe` | 创建转录任务，返回 `jobId` |
| GET | `/jobs/{id}` | 查询任务状态/进度/片段（`?segments=false` 仅看进度） |
| POST | `/jobs/{id}/cancel` | 取消任务 |

### POST /transcribe

请求体（camelCase）：

```json
{
  "audioPath": "/path/to/.hikaru/audio.wav",
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
- `computeType`：留空时按设备推导（cpu→int8，cuda→float16）
- `useVad` / `vadConfig`：可选 VAD 高级配置。faster-whisper 透传到内置 Silero VAD；Parakeet / Qwen3-ASR 用 `engines/vad.py` 先切分语音段，再逐段转录。
- `parakeet` 引擎当前针对日语模型，语言固定按 `ja` 返回；会优先读取 NeMo char timestamps，再按日语标点、长度和停顿重新切分字幕段。VAD + gap backfill 后转录完整性基本可接受，但仍可能有少量遗漏，且时轴精度弱于 faster-whisper。
- `qwen3-asr` 引擎模型为 `Qwen/Qwen3-ASR-1.7B`，默认携带 `Qwen/Qwen3-ForcedAligner-0.6B` 产出字级时间戳，语言固定按 `ja` 返回；文本质量与时轴精度优于 Parakeet。长音频自动分块转录，复用 `engines/chunking.py` 合并去重；CPU 用 `torch.float32`、CUDA 用 `torch.bfloat16`。模型下载为双权重（ASR + aligner），由引擎层封装为单一逻辑模型。

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

## 扩展新引擎

1. 在 `engines/` 下实现 `AsrEngine` 子类（`load()` + `transcribe()`），通过惰性导入处理可选依赖。
2. 在 `engines/registry.py` 的 `_REGISTRY` 中注册。
3. 前端 `/engines` 即可列出，无需改动其余代码。
