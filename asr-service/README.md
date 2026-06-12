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
│   ├── parakeet.py    # NVIDIA NeMo Parakeet 日语适配器
│   └── registry.py    # 引擎注册表
└── requirements.txt
```

## 安装

需要 Python 3.10+。

```bash
cd asr-service
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

GPU 加速（faster-whisper CUDA）需另行安装匹配的 CUDA / cuDNN，详见 faster-whisper 文档。

### 可选：NVIDIA Parakeet 日语模型

`parakeet` 引擎使用 `nvidia/parakeet-tdt_ctc-0.6b-ja`，依赖 NVIDIA NeMo 与 PyTorch。为避免影响默认 faster-whisper 安装，Parakeet 依赖单独安装：

```bash
pip install -r requirements.txt
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126
pip install -r requirements-parakeet.txt
```

NeMo 2.7.x 需要 `torch>=2.6.0`，旧的 `cu121` wheel 源可能只解析到过旧版本；NVIDIA 驱动较新时优先使用 `cu126`。如果只使用 CPU，可按 PyTorch 官方指引安装 CPU 版本 torch。未安装 NeMo 时 sidecar 仍可启动，但 `/engines` 会将 `parakeet` 标为不可用。

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
  "computeType": null
}
```

- `device`：`auto` / `cpu` / `cuda`
- `language`：`auto` 或 `null` 表示自动检测
- `computeType`：留空时按设备推导（cpu→int8，cuda→float16）
- `parakeet` 引擎当前针对日语模型，语言固定按 `ja` 返回；会优先读取 NeMo char timestamps，再按日语标点、长度和停顿重新切分字幕段。

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
