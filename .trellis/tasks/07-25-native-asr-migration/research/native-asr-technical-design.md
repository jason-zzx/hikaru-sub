# Hikaru Sub 原生 ASR 技术方案

> 状态：提案
> 日期：2026-07-25
> 首期平台：Windows x64
> 目标运行时：CTranslate2 + CrispASR，安装包内置 CPU runtime，ASR 模型按需下载
>
> **规划与协议更新（2026-08-02）：** 本文保留技术架构、调研依据和历史提案；任务编号、Gate、GPU 开发顺序和发布阻塞规则以同目录最新 `prd.md`、`design.md`、`implement.md` 为准。开发 CTranslate2 CUDA 已提前为 T07；正式 CUDA/Vulkan packs 与资格分别为 T14/T15。本文第 6 节的旧 `modelPaths`/`computeType`/`ready` JSON 示例仅为历史草案，最终 wire contract 以 T04 `prd.md`、`design.md` 和其产出的 `native-asr/docs/protocol-v1.md` 为准；后文原“阶段 6/后续 GPU”顺序也不再作为执行任务地图。
>
> **资格规则更新（2026-08-20）：** 后续所有 native ASR model-backed qualification 统一使用 `native-gpu-authoritative-v1` GPU profile。匹配同模型、同算法 identity 的 CPU route 以 `qualificationSource=inherited-from-gpu` 继承 GPU disposition，不再采集 CPU CER/S/D/I/RTF/RSS；本文后续 CPU quality/performance 矩阵、CPU ceiling、GPU-required 和 CPU fallback 文字仅为历史提案，不再是当前资格标准。CPU 编译、协议、打包、路径和非模型 smoke 仍需独立验证。
>
> **ordinary Whisper 状态更新（2026-08-25）：** T06R 已以 `stop-revise / non-qualified` handoff 关闭，未产生正式 candidate 或双 anchor 六行矩阵。其后续 T06D 只做一次 bounded、promotion-ineligible execution-parity discovery：先从 exact loaded model 学习动态合同（large-v3 为 128 Mel），再复现 Python/native anchors；只有 model-valid causal attribution 才允许另建质量候选任务。Discovery、candidate acquisition 与 qualification 必须分离。

## 1. 结论摘要

Hikaru Sub 的发布版 ASR 从 Python sidecar 迁移为原生进程，保留当前前端引擎名称、Tauri command 和任务快照协议，避免让 React 感知底层推理框架变化。

最终分工：

| 当前引擎 | 原生运行时 | 原因 |
|---|---|---|
| `faster-whisper` | CTranslate2 | 当前模型本身就是 CTranslate2 格式；最容易保持速度、模型缓存和解码行为 |
| `kotoba-faster-whisper` | CTranslate2 | 继续使用 `kotoba-whisper-v2.0-faster`，按官方模型卡与真值实测选择分块/解码算法 |
| `parakeet` | CrispASR | 直接运行 Parakeet JA GGUF，避免 PyTorch/NeMo |
| `qwen3-asr` | CrispASR + Qwen3 ForcedAligner | 保留 Qwen3-ASR 1.7B 文本质量与强制对齐时间轴 |
| `reazonspeech-nemo` | CrispASR | 直接运行 ReazonSpeech NeMo v2 GGUF，避免 PyTorch/NeMo |

核心决策：

1. **安装包内置两套 CPU 推理能力，但不内置任何 ASR 权重。**
2. **Whisper 家族统一走 CTranslate2；CrispASR 的 Whisper 能力不作为默认路径。**
3. **Tauri 继续拥有进程、任务、下载、路径和恢复快照；原生 worker 只做推理。**
4. **原生推理继续放在独立子进程，不把 C++ FFI 直接链接进 Tauri 主进程。**
5. **移除生产版 Python 3.11、venv、pip、PyTorch、NeMo 和 FastAPI 依赖。**
6. **CPU runtime 随安装包发布；Vulkan/CUDA 作为可选受管 runtime pack 按需下载。**
7. **首期保持现有 `start_asr` / `get_asr_progress` / `cancel_asr` 等前端接口。**

### 1.1 证据与实现来源层级

1. 用户提供的 `.asr-benchmark` WAV+ASS 及其校验 manifest 是文本、语音区间和时间轴的唯一质量真值。
2. 原生算法优先采用官方文档、稳定 public API 和模型卡，其次采用当前维护良好的社区推荐实践。
3. 候选算法通过同一真值的绝对 CER、confirmed speech gap、时间轴、Qwen 对齐、性能和资源实测选择。
4. 当前 Python 实现和输出仅用于理解产品合同、发现已知问题与诊断/历史对照；不作为期望输出、相对 CER/RTF gate 或 reference 修补来源。
5. React/Tauri command、`AsrJobSnapshot`、取消、恢复、路径和安全合同是独立且必须保持的产品权威。

T01 的绝对预算已获用户评审并冻结：CER `<=0.35` per engine/case；CPU inference RTF `<=1.0`；GPU-accelerated inference RTF `<=0.5`；short cold process wall `<=120s`；CTranslate2 RSS `<=6 GiB`；CrispASR RSS `<=12 GiB`；无 VRAM gate。T02/T03 必须直接对 ground truth 评估，不得以 Python parity 宣称通过。

---

## 2. 目标与非目标

### 2.1 目标

- 覆盖当前项目的五个 ASR 引擎，不因去 Python 而删减现有模型。
- 安装后无需配置 Python 或执行 pip，即可在 CPU 上加载已下载模型。
- 模型权重与应用安装包解耦，用户只下载实际使用的模型。
- 保持当前转录任务的：
  - 进度查询；
  - 取消；
  - 分段结果；
  - 异常恢复 JSON；
  - 完成后原子写入 ASS；
  - 应用退出时终止子进程。
- 保持 installed / portable 目录语义和 `deps/` 受管依赖约定。
- 为后续 Vulkan、CUDA runtime pack 留出稳定扩展点，但不让 GPU 包进入主安装包。
- 用固定版本、固定哈希和可重复构建替代运行时安装依赖。

### 2.2 首期非目标

- 不在首期支持 macOS、Linux 或 ARM。
- 不把原生推理库直接 FFI 到 Tauri 主进程。
- 不支持多个 ASR 任务同时运行；同一时间只允许一个活跃推理任务。
- 不新增任意第三方自定义模型导入 UI。
- 不要求 CrispASR 输出与 NeMo/qwen-asr Python 逐字节一致，但必须通过质量门槛。
- 不在首期让同一个 Whisper 模型自动在 CTranslate2 与 CrispASR 之间切换。
- 不在主安装包内置 CUDA runtime 或任一 ASR 模型。

---

## 3. 当前实现与迁移边界

### 3.1 当前数据流

```text
React TranscribeView
  -> Tauri start_asr
  -> src-tauri/src/asr.rs 拉起 Python main.py
  -> FastAPI /transcribe
  -> JobManager 后台线程
  -> engines/registry.py 创建 Python 引擎
  -> 轮询 /jobs/{jobId}
  -> React 将 AsrSegment 转为 SubtitleCue
  -> React 根据视频分辨率写最终 ASS
```

当前职责：

| 层 | 现有职责 |
|---|---|
| React | 引擎/模型选择、模型管理 UI、进度轮询、ASS 文档生成 |
| Tauri | Python sidecar 生命周期、HTTP 代理、恢复快照兜底、运行依赖管理 |
| Python sidecar | 引擎注册、模型下载、推理、分块、VAD、任务状态、最小 ASS 写出 |

### 3.2 关键现有文件

| 文件 | 当前作用 | 迁移后的处理 |
|---|---|---|
| `src-tauri/src/asr.rs` | Python sidecar + HTTP 代理 | 改为原生任务管理和 worker 进程协议 |
| `src-tauri/src/asr_setup.rs` | Python/venv/pip 一键配置 | 生产路径删除；由原生 runtime 状态替代 |
| `src-tauri/src/dependencies.rs` | FFmpeg/Python/venv/模型缓存管理 | 改为 FFmpeg、原生 runtime pack、模型和缓存管理 |
| `asr-service/` | Python 推理实现 | 迁移期间作为当前实现诊断参考和开发回退保留，不作为 native 算法模板或质量真值 |
| `src/constants/asr.ts` | 引擎与模型列表 | 保留引擎 ID，模型描述改为原生模型清单 |
| `src/components/workflow/AsrEngineSetupPanel.tsx` | Python 引擎依赖配置 | 替换为原生 runtime 状态与可选 GPU pack 管理 |
| `src/components/workflow/TranscribeView.tsx` | 转录 UI 和任务轮询 | 尽量不改任务协议，只调整设备选项和提示 |
| `src/types/index.ts` | ASR/运行依赖 IPC 类型 | 保持任务快照；替换 Python setup 类型 |
| `src-tauri/resources/runtime-dependency-sources.json` | 运行依赖下载源 | 移除 Python/pip 概念，增加可选原生 runtime pack |
| `scripts/prepare-asr-resource.mjs` | 复制 Python 模板进 Tauri 资源 | 替换为准备并校验原生 CPU runtime |
| `scripts/package-portable.mjs` | 复制发布资源到 portable | 改为复制原生 CPU runtime 和模型清单 |

### 3.3 必须保留的现有 IPC 合同

首期保持以下命令名称：

- `list_asr_engines`
- `start_asr`
- `get_asr_progress`
- `cancel_asr`
- `check_asr_model`
- `download_asr_model`
- `get_model_download_progress`

保持以下任务状态：

```text
pending -> running -> completed | failed | cancelled
```

保持 `AsrJobSnapshot` 字段：

```text
id
status
progress
durationMs
processedMs
segmentCount
detectedLanguage
error
segments?
```

这样 `TranscribeView` 的轮询、文档 guard、任务栏状态和完成后 ASS 生成流程无需重写。

---

## 4. 目标架构

```text
┌──────────────────────────────────────────────────────────┐
│ React                                                    │
│ TranscribeView / ModelManager / RuntimeDependenciesPanel │
└───────────────────────────┬──────────────────────────────┘
                            │ Tauri invoke
┌───────────────────────────▼──────────────────────────────┐
│ Tauri Rust                                               │
│                                                          │
│ AsrState                                                 │
│ ├─ 单活跃任务状态                                         │
│ ├─ worker 子进程生命周期                                  │
│ ├─ JSONL 事件解析                                         │
│ ├─ 取消 / 崩溃收尾                                        │
│ ├─ recovery snapshot / minimal ASS                       │
│ └─ 前端轮询快照                                           │
│                                                          │
│ Model manager                                            │
│ ├─ 固定模型清单                                           │
│ ├─ 下载 / 断点续传 / SHA-256                              │
│ ├─ 多文件模型原子就绪                                     │
│ └─ official / China mirror                               │
└───────────────────────────┬──────────────────────────────┘
                            │ stdin request + stdout JSONL
┌───────────────────────────▼──────────────────────────────┐
│ hikaru-asr-worker.exe（独立 C++ 进程）                    │
│                                                          │
│ ├─ CTranslate2 backend                                   │
│ │  ├─ faster-whisper                                     │
│ │  └─ Kotoba Whisper                                     │
│ │                                                        │
│ ├─ CrispASR C ABI backend                                │
│ │  ├─ Parakeet JA                                        │
│ │  ├─ ReazonSpeech                                       │
│ │  └─ Qwen3-ASR + ForcedAligner                          │
│ │                                                        │
│ └─ 共享音频/VAD/分段归一化                                │
└──────────────────────────────────────────────────────────┘
```

### 4.1 为什么使用独立 C++ worker

- CTranslate2 提供一等 C++ Whisper API。
- CrispASR 提供统一 C ABI session API。
- C++ worker 可直接调用两套库，避免维护不成熟的 Rust CTranslate2 wrapper。
- worker 崩溃、非法模型、驱动异常或原生库访问违规不会带崩 Tauri/WebView。
- Tauri 可通过终止子进程可靠取消推理，不依赖每个后端都正确响应取消回调。
- worker 不监听端口，不保留 FastAPI/HTTP 服务，减少一层网络代理和端口管理。

### 4.2 为什么任务管理留在 Rust

- `download.rs`、`clip.rs`、`burn.rs` 已有成熟的 Rust job 模式。
- 文件路径、portable、受管依赖、提权和清理本来就在 Rust。
- 模型下载无需启动推理 runtime。
- worker 只处理单个请求，退出后不会遗留 HTTP job 状态。
- 恢复快照可继续写到当前音频 workspace：

```text
<workspace>/asr-jobs/<jobId>.json
```

---

## 5. 引擎与模型路由

### 5.1 固定路由

```text
faster-whisper          -> ctranslate2
kotoba-faster-whisper   -> ctranslate2
parakeet                -> crispasr / parakeet-ja
qwen3-asr               -> crispasr / qwen3-1.7b + qwen3-forced-aligner
reazonspeech-nemo       -> crispasr / reazonspeech
```

首期不根据设备、模型大小或性能测试自动更换 backend。同一个引擎 ID 的结果必须稳定可预测。

### 5.2 模型建议

| 引擎 | 模型 | 默认原生格式 | 参考体积 | 时间戳策略 |
|---|---|---|---:|---|
| faster-whisper | tiny/base/small/medium/large-v2/large-v3/large-v3-turbo | CTranslate2 | 随模型变化 | Whisper segment timestamp；需要时调用 CT2 align |
| Kotoba | `kotoba-tech/kotoba-whisper-v2.0-faster` | CTranslate2 FP16 权重 | 约 1.41 GiB | Whisper segment timestamp |
| Parakeet | `parakeet-tdt-0.6b-ja-q8_0.gguf` | GGUF Q8_0 | 约 710 MB | TDT 原生词/帧时间戳 |
| Qwen3 | `qwen3-asr-1.7b-q4_k.gguf` | GGUF Q4_K | 约 1.3 GB | 文本模型本身不作为最终时间轴来源 |
| Qwen3 aligner | `qwen3-forced-aligner-0.6b-q4_k.gguf` | GGUF Q4_K | 约 500 MB | 强制对齐，属于 Qwen3 必需 companion |
| ReazonSpeech | `reazonspeech-nemo-v2-q8_0.gguf` | GGUF Q8_0 | 约 704 MB | RNNT 原生时间戳 |

体积是上游当前模型清单的近似值，正式发布必须由锁定后的模型 manifest 写入精确 `sizeBytes` 和 SHA-256。

### 5.3 量化选择原则

- Parakeet JA 默认 **Q8_0**：上游说明其 TDT 输出在测试中与 F16 一致；Q4_K 的 TDT 解码存在重复循环风险，不作为默认。
- ReazonSpeech 默认 **Q8_0**：优先保持日语识别和时间戳稳定性。
- Qwen3-ASR 1.7B 默认 **Q4_K**：控制总模型体积；必须和 ForcedAligner 一起验证。
- CTranslate2 CPU 默认 `int8` 计算，CUDA 默认 `float16`；模型文件是否静态量化由模型 manifest 决定。

---

## 6. Worker 进程协议

### 6.1 请求

Tauri 启动 worker 后，通过 stdin 写入一行 JSON：

```json
{
  "protocolVersion": 1,
  "jobId": "job-id",
  "engine": "qwen3-asr",
  "backend": "crispasr",
  "modelPaths": [
    ".../qwen3-asr-1.7b-q4_k.gguf",
    ".../qwen3-forced-aligner-0.6b-q4_k.gguf"
  ],
  "audioPath": ".../audio.wav",
  "device": "cpu",
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

约束：

- 路径通过 JSON stdin 传入，不拼接 shell 命令。
- worker 不自行选择下载源，也不接受远程 URL。
- worker 只允许读取 Tauri 已解析并验证的本地音频和模型路径。
- stdout 只输出 JSONL 协议；诊断日志写 stderr。

### 6.2 事件

```json
{"event":"ready","protocolVersion":1,"backend":"crispasr"}
{"event":"progress","processedMs":25000,"durationMs":120000}
{"event":"segment","startMs":1200,"endMs":3400,"text":"こんにちは"}
{"event":"segmentsReplace","segments":[...]}
{"event":"completed","durationMs":120000,"detectedLanguage":"ja"}
{"event":"error","code":"model_load_failed","message":"..."}
```

事件语义：

| 事件 | Tauri 行为 |
|---|---|
| `ready` | 确认 worker/runtime 正常启动 |
| `progress` | 单调更新 `processedMs` 与 `progress` |
| `segment` | 追加一个新片段 |
| `segmentsReplace` | 替换已累计片段，用于分块合并、去重或最终 backfill |
| `completed` | 标记完成、写恢复快照和最小 ASS |
| `error` | 标记失败并保留已产生片段 |

### 6.3 取消与崩溃

- `cancel_asr` 设置任务取消标志并终止 worker 进程树。
- worker 支持回调取消时可先优雅退出，但 Tauri 仍保留强制终止兜底。
- 进程非零退出且没有 `error` 事件时，Tauri 生成受控错误：

```text
原生 ASR worker 异常退出（backend=..., exitCode=...）
```

- stderr 只进入受管诊断日志，不直接完整显示给用户。
- 已产生片段写入恢复 JSON，取消状态不写最终完成 ASS。

### 6.4 并发限制

首期 `AsrState` 只允许一个活跃推理任务。开始第二个任务时返回明确错误，不排队也不同时加载两个大模型。

原因：

- 当前 UI 本身只有一个转录任务。
- 防止 Qwen3、Parakeet 等同时占满 RAM/VRAM。
- 简化取消、退出清理和 runtime 切换。

---

## 7. CTranslate2 Whisper 实现

### 7.1 目标

原生 CTranslate2 路径实现 Whisper 所需的完整上层链路，但算法权威不是当前 faster-whisper 私有实现。实现顺序为官方 CTranslate2/Whisper 文档与稳定 API、模型卡、维护良好的社区实践，再由 `.asr-benchmark` ground truth 实测选择。

当前 Python 参数、VAD、分块、backfill 与私有 fork 只作为诊断和回归案例。当前 `faster-whisper==1.2.1`、`ctranslate2==4.8.0` 中 `large-v2` + `ja` + `>=600000ms` 的 V4/seed/session/语义路径必须在 T06 被覆盖，但不要求原生复刻。

原生结果仍须提供合法 segment timestamps、language detection 与可追溯的时间轴。

### 7.2 原生管线

```text
16 kHz mono PCM WAV
  -> VAD slices
  -> log-mel features
  -> tokenizer/prompt
  -> CTranslate2 Whisper encode/generate
  -> timestamp token decode
  -> slice offset restore
  -> overlap merge/dedupe
  -> AsrSegment
```

需要实现的 faster-whisper 上层能力：

- 读取 `preprocessor_config.json`；
- log-mel 特征提取；
- 读取 `tokenizer.json`；
- Whisper special/language/timestamp token 解析；
- 30 秒窗口和 seek 推进；
- no-speech、重复和解码失败处理；
- segment timestamp 解析；
- 可选 `align()`；
- VAD 后的时间映射。

实现依赖建议：

- FFT：固定使用一个小型 BSD/MIT 兼容库，不引入 FFTW GPL 依赖。
- tokenizer：使用能直接读取 Hugging Face `tokenizer.json` 的固定版本原生库，不自行重写 BPE。
- JSON：worker 使用单一轻量 JSON 库处理 request/config/tokenizer metadata。

### 7.3 faster-whisper 配置来源

当前项目的 beam 5、VAD、CPU int8、CUDA float16 与日语配置只作为 current-implementation reference 记录。原生默认值依据官方 API/模型卡和维护良好的社区推荐提出，并用 T01 真值评估绝对质量、性能与资源后选择；不以参数一致或 Python 输出一致为 gate。

### 7.4 Kotoba 配置来源

固定模型仍为 `kotoba-tech/kotoba-whisper-v2.0-faster`，Kotoba-only readiness 继续要求 `preprocessor_config.json`。15 秒分块、无前文条件和日语 prompt 是当前 Python 诊断事实；原生实现以 pinned model card/stable API 为首要来源，并通过 T01 ground truth 选择。普通 faster-whisper 模型不得扩大 preprocessor 要求。

### 7.5 VAD

由于 CPU runtime 同时包含 CrispASR，可在其稳定 public VAD API 适用时复用该能力。`useVad` 和 VAD config 仍是产品输入合同，但算法与 fallback 不复制 Python：按官方/社区实践提出候选，并对 T01 真值验证 legal timeline、confirmed speech coverage、质量和性能。共享 VAD companion 模型仍按 model manifest/hash 管理。

---

## 8. CrispASR 引擎实现

### 8.1 调用边界

worker 只使用 CrispASR 公共 C ABI，不依赖 CLI 文本输出：

- `crispasr_session_open_explicit`
- `crispasr_session_transcribe*`
- `crispasr_session_set_progress_callback`
- `crispasr_session_set_segment_callback`
- `crispasr_session_result_*`
- `crispasr_align_words_abi`
- `crispasr_session_close`

这样可以直接获得结构化 segment/word 时间戳，并映射到 worker JSONL 事件。

### 8.2 Parakeet JA

- backend：`parakeet-ja`
- 默认模型：Q8_0
- 优先使用 CrispASR 的 JA 长音频路径和原生 TDT 时间戳。
- VAD 参数复用当前 UI 字段。
- 输出先经过基本校验：
  - 非空文本；
  - `endMs > startMs`；
  - 时间戳限制在音频时长；
  - 按时间排序；
  - 去除完全重复片段。

当前 Python Parakeet 含自定义分块/gap backfill/日语分段，Parakeet、Qwen3 与 ReazonSpeech 都可能通过 `TranscriptSegmentRefresh` 最终替换 preview；这些是诊断事实，不是原生模板。先按 CrispASR 官方/模型卡/维护良好社区路径对 ground truth 实测，只有真值证明存在系统缺口且来源层级支持时才增加最小补偿。任何最终修正统一使用 `segmentsReplace`。

### 8.3 ReazonSpeech

- backend：`reazonspeech`
- 默认模型：Q8_0
- 使用 CrispASR 的 RNNT 结果和原生时间戳。
- 按 CrispASR 官方/模型卡推荐路径对短、中、长 ground truth 选择 VAD/分块/分段。
- 当前 Python 在 `<60s` 使用 whole audio、`>=60s` 使用 45s chunk/2s overlap，并可能以 final refresh 替换 preview；这些仅作为诊断回归案例。
- 直接对参考文本、speech regions 和字幕时间轴评估质量与片段长度，不追求 Python 输出一致。

### 8.4 Qwen3-ASR

Qwen3-ASR 的目标不是只返回整段文本，而是保持当前“1.7B ASR + ForcedAligner”的产品定义。

固定模型组合：

```text
qwen3-asr-1.7b-q4_k.gguf
qwen3-forced-aligner-0.6b-q4_k.gguf
```

流程：

```text
音频
  -> Qwen3-ASR 文本
  -> Qwen3 ForcedAligner
  -> 字/词时间戳
  -> 日语字幕片段组装
```

规则：

- 两个文件共同构成模型“已下载”。
- ForcedAligner 缺失或失败时任务失败，不伪造整段平均时间戳。
- 继续使用分块，避免长音频注意力导致 OOM。
- 分块后对齐结果恢复到全局时间轴，并做 overlap 去重。
- 进度以已完成音频块的 `endMs` 为准。

---

## 9. 共享字幕分段与结果归一化

worker 输出的最终公共模型仍是：

```text
AsrSegment {
  startMs,
  endMs,
  text
}
```

公共归一化只做必要工作：

- 裁剪到 `[0, durationMs]`；
- 删除空文本和无效时间区间；
- 按时间排序；
- 去除完全重复片段；
- 合并分块重叠造成的明确重复；
- 保护日语标点不被错误插入空格。

不在 native worker 中生成 `SubtitleCue`、ASS Style 或双语结构。最终 ASS 文档继续由 React 的 `src/lib/ass/` 生成。

为保持崩溃恢复，Tauri 可继续在任务完成时写一个最小 ASS；该文件只作为恢复输出，React 完成流程仍会使用视频分辨率和默认样式重新序列化正式字幕。

---

## 10. 模型清单与下载管理

### 10.1 新模型 manifest

新增：

```text
src-tauri/resources/asr-model-sources.json
```

建议结构：

```json
{
  "schemaVersion": 1,
  "models": [
    {
      "engine": "qwen3-asr",
      "model": "Qwen/Qwen3-ASR-1.7B",
      "backend": "crispasr",
      "variant": "q4_k",
      "license": "Apache-2.0",
      "files": [
        {
          "role": "model",
          "fileName": "qwen3-asr-1.7b-q4_k.gguf",
          "officialUrl": "...",
          "chinaUrl": "...",
          "sha256": "...",
          "sizeBytes": 0
        },
        {
          "role": "aligner",
          "fileName": "qwen3-forced-aligner-0.6b-q4_k.gguf",
          "officialUrl": "...",
          "chinaUrl": "...",
          "sha256": "...",
          "sizeBytes": 0
        }
      ]
    }
  ]
}
```

要求：

- 生产构建不使用 floating `main` 作为唯一锁定依据。
- URL、revision、SHA-256、精确体积在发布前由锁定脚本生成。
- manifest 是可信的内置数据，但下载响应和文件内容仍需校验。
- 模型许可证和 attribution 信息随条目记录。

### 10.2 路径布局

```text
<install>/deps/models/
├─ ctranslate2/
│  ├─ faster-whisper-large-v3/
│  └─ kotoba-whisper-v2.0/
├─ crispasr/
│  ├─ parakeet-ja/
│  ├─ reazonspeech/
│  └─ qwen3-asr-1.7b/
└─ shared/
   └─ vad/
```

`deps/` 仍在 exe 同级；portable 继续使用 portable exe 同级目录，不移动到系统 AppData。

### 10.3 下载规则

- 下载由 Rust 管理，不调用 CrispASR `-m auto`。
- `.part` 临时文件写入 `deps/downloads`。
- 下载结束后校验大小和 SHA-256，再原子移动到模型目录。
- 多文件模型在所有文件就绪后才写 `model.json` 完成标记。
- 同一模型的重复下载请求合并为一个 job。
- 服务器支持 Range 时断点续传；不支持时安全重下。
- 下载失败不删除已经验证完成的 companion 文件。
- 日志不记录完整敏感 URL/header；当前模型均为公开地址。

### 10.4 旧缓存兼容

当前模型位于：

```text
deps/models/huggingface
```

迁移策略：

1. CTranslate2 模型解析器先检查新目录；
2. 再检查旧 Hugging Face snapshot 是否包含当前必需文件；
3. 找到有效旧缓存时直接使用，不强制复制或重新下载；
4. 新下载统一进入新目录；
5. 设置页“ASR 模型缓存”统计整个 `deps/models`，不再只统计 `huggingface` 子目录。

CrispASR GGUF 与旧 NeMo/qwen-asr 权重格式不同，不能复用旧权重；UI 应提示新原生模型需要单独下载，旧模型可由用户在确认后清理。

---

## 11. Runtime 分发

### 11.1 安装包内置 CPU runtime

建议资源布局：

```text
src-tauri/resources/native-asr/windows-x64/cpu/
├─ hikaru-asr-worker.exe
├─ ctranslate2.dll / 必需 CPU 依赖
├─ crispasr.dll / ggml CPU 依赖
├─ runtime-manifest.json
└─ licenses/
```

运行时解析顺序：

```text
可选受管 GPU pack
  -> 安装包内置 CPU runtime
```

CPU runtime 属于应用资源：

- 安装后始终可用；
- 设置页显示“内置”；
- 不提供单独清理按钮；
- 随应用升级整体替换。

### 11.2 可选 GPU pack

```text
<install>/deps/asr-runtime/
├─ vulkan/current/
└─ cuda/current/
```

建议：

| Pack | 内容 | 适用 |
|---|---|---|
| CPU | CTranslate2 CPU + CrispASR CPU | 安装包内置，所有用户 |
| Vulkan | CrispASR Vulkan | AMD/Intel/NVIDIA；主要加速非 Whisper 引擎 |
| CUDA | CTranslate2 CUDA + CrispASR CUDA | NVIDIA；按需下载 |

`auto` 设备选择：

- CTranslate2：已安装 CUDA pack 且可用时用 CUDA，否则 CPU。
- CrispASR：CUDA 可用优先 CUDA，其次已安装 Vulkan，否则 CPU。
- GPU runtime 加载失败时自动回退内置 CPU，并向 UI 返回一次非致命提示。

### 11.3 构建与锁定

新增原生构建目录：

```text
native-asr/
├─ CMakeLists.txt
├─ cmake/
└─ src/
   ├─ main.cpp
   ├─ protocol.cpp
   ├─ ctranslate2_backend.cpp
   ├─ whisper_pipeline.cpp
   └─ crispasr_backend.cpp
```

构建规则：

- 固定 CTranslate2 tag/commit。
- 固定 CrispASR tag/commit。
- 固定 MSVC、CMake、Ninja 和依赖版本。
- CI 产出带 manifest 和 SHA-256 的 CPU runtime zip。
- `pnpm release:local` 在 Tauri 打包前下载或读取本地 runtime artifact，并校验哈希。
- 不在普通用户机器上执行 CMake 编译。

### 11.4 安装包体积预算

已知参考：

- Hikaru Sub v0.4.0 setup：约 6.7 MB。
- CrispASR v0.8.22 CPU CLI zip：约 6.1 MB。
- CrispASR v0.8.22 CPU library 包：约 37.7 MB。
- 当前安装后的 `ctranslate2` Python 包目录约 60 MB，但原生裁剪构建体积需实测。

先前“约 13～15 MB”的估计只适用于直接捆绑 CrispASR CPU CLI，不包含 CTranslate2 和结构化 C ABI 集成。该方案无法可靠满足现有增量 segment/progress 协议，因此本方案不以 15 MB 为硬目标。

首期体积门槛：

| 项目 | 门槛 |
|---|---:|
| Windows setup | 不超过 80 MB |
| Portable ZIP | 不超过 90 MB |
| 解压后的 CPU ASR runtime | 不超过 250 MB |
| 安装包内 ASR 模型权重 | 0 |

若 ASR-only 静态裁剪后可将 setup 压到 50 MB 以下则采用，但不为节省几十 MB 牺牲进度、取消、时间戳和崩溃隔离。

CUDA pack 参考体积约 691 MB，不进入主安装包。

---

## 12. 运行依赖 UI 与设置迁移

### 12.1 RuntimeDependencyKind

目标类型：

```text
ffmpeg
asrCpuRuntime
asrVulkanRuntime
asrCudaRuntime
asrModels
downloads
appCache
```

删除生产 UI 中：

```text
python311
asrVenv
```

状态语义：

- CPU runtime：内置、始终就绪、不可清理。
- Vulkan/CUDA：未安装/就绪，可下载和清理。
- 模型：按模型独立管理；存储面板继续聚合显示占用。

继续遵守：

- `probe_runtime_dependencies` 只探测状态、路径和版本。
- 递归磁盘占用只在 `measure_runtime_dependency_storage` 中执行。
- 清理仍使用 async + `spawn_blocking`。
- 清理路径必须限制在 exe 同级 `deps/` 下。

### 12.2 AppSettings

删除或忽略生产设置：

```text
pythonPath
asrServicePath
```

保留：

```text
asrEngine
asrModel
asrDevice
runtimeSourceMode
```

旧 `settings.json` 迁移：

- 静默丢弃 `pythonPath` 和 `asrServicePath`。
- 保留现有 `asrEngine`、`asrModel` 和 `asrDevice`。
- 如果旧模型 ID 仍是当前 ID，映射到新的原生模型条目。
- 未知旧模型回退到对应引擎默认模型，而不是让设置加载失败。

### 12.3 前端

- `AsrEngineSetupPanel` 替换为“ASR 运行时”面板。
- 不再显示 Python、venv、pip 或 ASR 服务目录。
- CPU runtime 显示“已内置”。
- 根据引擎和已安装 pack 动态显示设备：
  - `自动`
  - `CPU`
  - `CUDA（已安装时）`
  - `Vulkan（仅 CrispASR 引擎且已安装时）`
- 引擎 ID 暂不改名，避免破坏设置与测试；用户文案可去掉 Python 框架名称说明。

---

## 13. 代码改动地图

### 13.1 新增

```text
.trellis/tasks/07-25-native-asr-migration/research/native-asr-technical-design.md
native-asr/
src-tauri/src/asr_worker.rs
src-tauri/src/asr_models.rs
src-tauri/resources/asr-model-sources.json
src-tauri/resources/native-asr/
scripts/prepare-native-asr-runtime.mjs
scripts/lock-asr-model-sources.mjs
```

具体实现时若 `asr.rs` 仍可保持可读，不强制提前拆成更多模块。

### 13.2 修改

```text
src-tauri/src/asr.rs
src-tauri/src/dependencies.rs
src-tauri/src/settings.rs
src-tauri/src/lib.rs
src-tauri/tauri.conf.json
src-tauri/Cargo.toml
src/types/index.ts
src/services/tauri.ts
src/constants/asr.ts
src/constants/asrSetup.ts
src/constants/runtimeDependencies.ts
src/components/workflow/TranscribeView.tsx
src/components/workflow/AsrEngineSetupPanel.tsx 或其替代组件
src/components/workflow/RuntimeDependenciesPanel.tsx
scripts/package-portable.mjs
package.json
THIRD_PARTY_NOTICES.md
AGENTS.md
.trellis/spec/asr/
.trellis/spec/tauri/
```

`AGENTS.md` 和 `.trellis/spec/` 只在原生架构实际落地并验证后更新，避免当前代码尚未迁移时让规范与实现脱节。

### 13.3 最终删除或停止打包

```text
src-tauri/src/asr_setup.rs
src-tauri/resources/asr-service/
scripts/prepare-asr-resource.mjs
发布版 Python 运行依赖清单
```

仓库根 `asr-service/` 在迁移期保留为：

- 行为基线；
- 质量对比工具；
- 开发回退实现。

完成至少一个稳定版本后，再决定是否归档或删除。

---

## 14. 分阶段实施

### 阶段 0：基准真值与原生 PoC

目标：先冻结用户权威材料和共享指标，再证明核心模型可用，不改产品默认路径。

- 校验 `.asr-benchmark` short/medium/long WAV+ASS identity、参考标注和隐私边界。
- 以真值计算绝对 CER、confirmed speech gap、时间轴、Qwen 对齐、性能和资源；T01 的预算与 per-case coverage 已经用户评审冻结。
- 可选记录每个 Python 引擎的当前实现输出/时间/资源作为诊断，不因缺失而阻塞 native comparison。
- 构建 CPU 原生 PoC，跑通 CT2 large-v3/Kotoba 与 CrispASR Parakeet/Reazon/Qwen3+Aligner。
- 算法方向依据官方/模型卡/维护良好社区实践，并用同一 ground truth 实测选择。

退出门槛：五个引擎均有合法原生时间轴或明确 native blocker；Qwen3 不使用伪造时间戳；PoC 对冻结预算报告 measured/pass/fail/blocked，但不冒充后续产品化 gate 完成。

### 阶段 1：Worker 协议与 Rust 任务管理

- 实现 stdin/stdout JSONL protocol v1。
- 在 Rust 中实现单活跃 job、事件解析、取消、退出清理。
- 保持现有 Tauri command 和 `AsrJobSnapshot`。
- 使用 fake worker 完成无模型 CI 测试。
- 保留 Python sidecar feature flag 供开发对比。

退出门槛：无模型测试可覆盖 success/progress/replace/error/cancel/crash。

### 阶段 2：CTranslate2 Whisper 正式接入

- 从官方/模型卡/维护良好社区实践实现并选择 audio/mel/tokenizer/window/timestamp/VAD/decode 链路。
- 接入 faster-whisper 产品模型和旧缓存探测，T06 显式验证 large-v2 日语长音频特殊路径对应的回归材料。
- 接入 Kotoba 模型卡要求。
- 直接对 T01 ground truth 评估绝对质量、时间轴、性能和资源；Python 仅诊断。

退出门槛：CTranslate2 路径达到 T01 用户评审后冻结的绝对门槛和产品合同，不要求复刻 Python 算法。

### 阶段 3：CrispASR 三个引擎正式接入

- Parakeet JA Q8_0。
- ReazonSpeech Q8_0。
- Qwen3-ASR 1.7B Q4_K + ForcedAligner Q4_K。
- 使用 CrispASR segment/progress callback。
- 只迁移被测试证明仍有必要的日语分段/backfill 逻辑。

退出门槛：长音频无系统性漏段，Qwen3 时间轴通过对齐测试。

### 阶段 4：原生模型下载与 UI

- 引入 `asr-model-sources.json`。
- Rust 模型下载、哈希、原子安装和旧缓存查找。
- 替换 Python setup UI。
- 更新 runtime storage/probe/cleanup。
- 设置迁移。

退出门槛：全新安装机器只通过应用 UI 即可下载模型并 CPU 转录。

### 阶段 5：发布包切换

- 主安装包内置 CPU runtime。
- portable 包包含相同 CPU runtime。
- 停止打包 Python sidecar 模板。
- 发布版不再探测或下载 Python 3.11。
- 更新 notices、README、AGENTS 和 Trellis specs。

退出门槛：离线安装后，使用已缓存模型可直接转录；安装包中无 Python/PyTorch/NeMo。

### 阶段 6：可选 GPU pack

- CrispASR Vulkan pack。
- CTranslate2 + CrispASR CUDA pack。
- 设备自动选择和回退。
- 独立测量下载体积、显存和兼容性。

GPU pack 不阻塞 CPU 原生版发布。

---

## 15. 验证方案

### 15.1 测试语料

至少覆盖：

- 30 秒以内清晰日语；
- 5～15 分钟普通视频；
- 60 分钟以上长音频；
- 动画/影视对白；
- 音乐或环境音背景；
- 长静音；
- 快速连续对白；
- 数字、英文、人名和专有名词；
- 连续语音超过 30 秒；
- 音量较低的对白。

### 15.2 质量指标

| 指标 | 门槛来源/状态 |
|---|---|
| 各引擎 CER | 每个 engine/case `<=0.35`，直接对用户 reference |
| 推理 RTF | 纯 CPU `<=1.0`；CUDA/Vulkan 等 GPU 加速路径 `<=0.5` |
| Short cold process wall | `<=120s` |
| Peak RSS | CTranslate2 `<=6 GiB`；CrispASR `<=12 GiB`；无 VRAM gate |
| 长音频覆盖 | 0 个持续 `>=1.5s`、reference 确认含语音的漏段 |
| 无效时间轴 | 0 个 `end <= start`、负起点或非单调片段 |
| 越界时间轴 | 0 个超出音频时长的片段 |
| Qwen3 起始时间误差 | 中位数不高于 150 ms，P95 不高于 500 ms |
| 取消响应 | 发出取消后 2 秒内 worker 退出 |
| 崩溃恢复 | worker 异常退出后可读到最后一次已保存快照 |

T01 预算已获用户评审并冻结。T02/T03 必须按更新后的 manifest identity 直接报告 measured/pass/fail/blocked；Python reference 继续仅作 current diagnostics。

### 15.3 自动化测试

Rust：

- 引擎到 backend/model 的固定路由。
- 模型多文件就绪判断。
- SHA-256 和原子安装。
- 旧 HF cache 探测。
- JSONL protocol 解析。
- progress 单调性。
- `segmentsReplace` 行为。
- worker 非零退出。
- 取消时终止进程树。
- recovery snapshot 路径与读写。
- portable/install runtime 路径。
- runtime probe 不递归扫盘。
- cleanup 不越出 `deps/`。

前端：

- 引擎/模型默认值不漂移。
- 设备选项按 backend/runtime 可用性变化。
- 旧设置迁移。
- CPU runtime 显示内置且不可清理。
- Python setup UI 消失。
- 模型 companion 下载进度聚合。

Worker：

- protocol request validation。
- WAV 格式校验。
- 无效模型路径错误。
- segment 时间轴归一化。
- CTranslate2 tokenizer/timestamp golden tests。
- CrispASR result getter 到 JSONL 的映射。

常规验证命令：

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

原生 worker 另运行 CMake/CTest；完整模型测试放在手动或带模型缓存的专用 CI，不让普通 CI 下载数 GB 权重。

---

## 16. 风险与缓解

### 16.1 CTranslate2 只有底层 Whisper API

风险：CTranslate2 C++ 提供 encode/generate/align，但 faster-whisper 的音频、tokenizer、VAD、窗口和 fallback 仍需实现。

缓解：

- 从官方 CTranslate2/Whisper 文档、稳定 API、模型卡和维护良好社区实现锁定候选算法；
- 为 timestamp token、窗口推进和 Kotoba 写 golden tests；
- 用 T01 ground truth 比较候选，不用 Python 参数或输出 parity 作 gate；
- 将当前 large-v2 长音频特殊路径保留为 T06 regression case；
- 阶段 2 不通过就不替换当前默认引擎。

### 16.2 CrispASR API 变化快

风险：CrispASR 项目更新频繁，C ABI 和模型 registry 可能变化。

缓解：

- 固定 tag + commit；
- worker 只使用经过确认的 C ABI 子集；
- 构建产物写入 CrispASR commit 和 ABI version；
- 升级必须重新跑五引擎回归矩阵。

### 16.3 Qwen3 时间戳

风险：Qwen3 文本运行成功不等于字幕时间轴可用。

缓解：

- ForcedAligner 是必需 companion；
- 模型状态必须同时检查 ASR 和 aligner；
- 对齐失败直接失败，不输出虚假整段字幕；
- 专门测试前导静音和分块边界。

### 16.4 Parakeet 长音频漏段

风险：Python 当前已有复杂 backfill，说明长音频覆盖是实际问题。

缓解：

- 使用 CrispASR 最新 JA 长音频路径；
- 用当前问题音频做回归；
- 仅在需要时迁移最小 gap detection/backfill；
- 保留最终 `segmentsReplace` 协议。

### 16.5 CPU runtime 体积超过早期估算

风险：结构化 C ABI library + CTranslate2 会大于单独 CrispASR CLI 的 6.1 MB。

缓解：

- 阶段 0 先构建并测量；
- 只编译 ASR 所需 backend，排除 TTS/音乐等无关能力；
- Release/LTO/strip；
- CPU runtime 上限 250 MB 解压、80 MB setup；
- 模型权重始终不进入安装包。

### 16.6 模型许可证

风险：runtime 为宽松许可证不代表所有模型可无条件再分发。

缓解：

- 模型按需下载而非随应用再分发；
- manifest 记录许可证和 attribution；
- 需要用户接受的模型在下载前明确提示；
- 更新 `THIRD_PARTY_NOTICES.md`，不依赖 CrispASR registry 的默认文案作为唯一合规来源。

### 16.7 GPU runtime 重复依赖

风险：CTranslate2 CUDA 与 CrispASR CUDA 可能各自携带大型 CUDA 库。

缓解：

- GPU pack 独立于首期 CPU 发布；
- 尽量在统一构建中共享兼容的 CUDA DLL；
- 不在用户机器存在系统 CUDA 的前提下做硬依赖；
- 若无法安全共享，优先保证可重复部署，再接受可选 pack 体积。

---

## 17. 回退策略

迁移期间保留两条内部路径：

```text
native（目标默认）
python-legacy（仅开发/诊断）
```

规则：

- 发布包不携带 Python runtime 和 venv。
- `python-legacy` 只允许源码开发环境或用户手动配置已有 sidecar。
- 每个引擎只有通过质量门槛后才切换默认。
- 若某个 CrispASR 引擎未达标，只回退该引擎，不阻塞已经完成的 CTranslate2 Whisper 迁移。
- Python 源码至少保留一个稳定发布周期，之后再决定归档。

---

## 18. 完成定义

满足以下条件后，原生 ASR 迁移才算完成：

- 五个当前引擎均有原生 CPU 路径。
- Whisper/Kotoba 使用 CTranslate2；Parakeet/Qwen3/Reazon 使用 CrispASR。
- Qwen3 模型状态包含 ForcedAligner。
- 安装包内置 CPU runtime，不含 ASR 权重。
- 全新安装不需要 Python、pip、PyTorch 或 NeMo。
- 当前 React ASR job/ASS 流程保持可用。
- 转录进度、取消、异常退出和恢复快照通过测试。
- portable 与 installed 路径均通过测试。
- 模型下载具备固定来源、大小、SHA-256 和原子安装。
- 运行依赖设置页不再出现 Python/venv。
- setup/portable 体积满足预算。
- `pnpm test`、`pnpm build`、`cargo test` 和 worker CTest 通过。
- 完成第三方许可证和 notices 检查。

---

## 19. 调研依据

- CTranslate2 Whisper C++ API：
  <https://github.com/OpenNMT/CTranslate2/blob/master/include/ctranslate2/models/whisper.h>
- faster-whisper：CTranslate2 backend 与 benchmark：
  <https://github.com/SYSTRAN/faster-whisper>
- Kotoba Whisper v2.0 CTranslate2 模型：
  <https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-faster>
- Kotoba Whisper v2.0 GGML 模型：
  <https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-ggml>
- CrispASR：
  <https://github.com/CrispStrobe/CrispASR>
- CrispASR v0.8.22 Windows runtime：
  <https://github.com/CrispStrobe/CrispASR/releases/tag/v0.8.22>
- CrispASR C ABI：
  <https://github.com/CrispStrobe/CrispASR/blob/v0.8.22/include/crispasr.h>
- CrispASR session C ABI：
  <https://github.com/CrispStrobe/CrispASR/blob/v0.8.22/include/crispasr_session.h>
- CrispASR 模型 registry：
  <https://github.com/CrispStrobe/CrispASR/blob/v0.8.22/src/crispasr_model_registry.cpp>
- Parakeet JA GGUF：
  <https://huggingface.co/cstr/parakeet-tdt-0.6b-ja-GGUF>
- ReazonSpeech NeMo v2 GGUF：
  <https://huggingface.co/cstr/reazonspeech-nemo-v2-GGUF>
- Qwen3-ASR 1.7B GGUF：
  <https://huggingface.co/cstr/qwen3-asr-1.7b-GGUF>
- Qwen3 ForcedAligner GGUF：
  <https://huggingface.co/cstr/qwen3-forced-aligner-0.6b-GGUF>
