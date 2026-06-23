# Hikaru-Sub — Agent 指南

AI 日语字幕桌面应用：下载 m3u8 视频 → 本地 ASR 日语转录 → LLM 批量翻译 → 字幕校对编辑 → FFmpeg 压制。

## 技术栈

| 层级 | 选型 |
|------|------|
| 包管理 | **pnpm workspace**（根目录与 `packages/*`） |
| 桌面壳 | Tauri 2 + Rust |
| 前端 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS 4（`src/styles/index.css`） |
| 状态 | Zustand（`src/stores/`） |
| 字幕格式 | `@hikaru/ass-core`（`packages/ass-core/`） |
| ASR | Python sidecar（`asr-service/`，可插拔引擎：faster-whisper / parakeet） |
| 翻译 | OpenAI 兼容 API 适配器（前端） |
| 音视频 | 系统 FFmpeg（首期） |

## 常用命令

```bash
pnpm install
pnpm dev              # 仅 Vite 前端
pnpm tauri dev        # Tauri 桌面开发
pnpm build            # 构建前端
pnpm tauri build      # 打包桌面应用
./scripts/setup-asr.sh        # ASR sidecar（默认 faster-whisper）
```

**始终使用 pnpm**，不要用 npm/yarn。workspace 根目录安装依赖时加 `-w`。

### ASR sidecar 依赖

Python 3.10+。`./scripts/setup-asr.sh` 默认安装 **faster-whisper** 引擎；**Parakeet 仅在使用 `parakeet` / `parakeet-cpu` / `parakeet-cuda` 参数时安装**。

| 场景 | 命令 |
|------|------|
| 日常开发（默认） | `./scripts/setup-asr.sh` 或 `pnpm asr:setup` |
| 有 NVIDIA GPU、试 Parakeet | `./scripts/setup-asr.sh parakeet-cuda` |
| 无 GPU 但想试 Parakeet | `./scripts/setup-asr.sh parakeet-cpu` |

手动安装见 `asr-service/README.md`。

## 目录结构

```
src/                          # React 前端
  components/
    layout/                   # AppLayout、Sidebar、StatusBar
    workflow/                 # 导入、转录、翻译、压制、设置
    editor/                   # 字幕编辑器
    player/                   # 视频预览 + ASS 叠加
  stores/                     # ui、project、playback、task
  hooks/                      # useSubtitleMergeMode 等
  utils/                      # ASS 文档组装等
  services/                   # Tauri invoke 封装
  types/                      # 共享 TS 类型
src-tauri/                    # Rust 后端
  src/
    ffmpeg.rs                 # FFmpeg 检测、音轨提取、视频信息、波形提取
    asr.rs                    # ASR sidecar 进程管理 + HTTP 代理
    ass.rs                    # ASS 文件读写
    asset_scope.rs            # Tauri asset protocol 动态授权（非视频播放主路径）
    media_server.rs           # 本地 HTTP 媒体服务（编辑页视频 Range 播放）
    project.rs                # .hikaru/project.json
    settings.rs               # 全局设置持久化
    transcode.rs              # 不兼容视频编码的代理视频转码与缓存
    download.rs               # 下载 command、任务状态、FFmpeg fallback 与策略编排
    hls_types.rs              # 分片计划类型、自动并发配置、取消令牌
    hls_playlist.rs           # m3u8 解析、URL 解析、AES-128 规划、分片计划构建
    hls_fetch.rs              # HTTP headers、Range 请求、流式分片下载与重试
    hls_download.rs           # HTTP/2 共享 client、并发调度、临时文件组装与 remux
packages/ass-core/              # ASS 解析/序列化（workspace 包）
asr-service/                  # Python ASR sidecar（FastAPI HTTP）
  main.py                     # 入口：选端口 + uvicorn + stdout 就绪协议
  server.py                   # FastAPI 路由
  jobs.py                     # JobManager：后台线程转录 + 进度/取消
  requirements-parakeet*.txt    # 可选 Parakeet 依赖（cpu / cuda 分轨）
  engines/                    # AsrEngine 抽象 + faster-whisper + parakeet + vad + registry
scripts/
  setup-asr.sh                # ASR 虚拟环境与依赖安装脚本
```

## 架构边界

- **Tauri Rust**：文件 I/O、FFmpeg、音频波形、视频代理转码、启动 ASR sidecar、项目元数据
- **React**：全部 UI、ASS 文本编辑、翻译 API 调用
- **Python sidecar**：ASR 推理，通过 HTTP localhost 通信，不阻塞 UI
- **ass-core**：ASS 是唯一字幕数据交换格式；内存模型为 `SubtitleCue`；`projectStore` 另缓存 `assScriptInfo` 与 `assStyles`（`[V4+ Styles]` 与 PlayRes 等），保存时完整写回 ASS

**PlayRes 与样式**：转录完成时经 `get_video_info` 将视频分辨率写入 ASS `PlayResX/Y` 与默认双语 Style；翻译、编辑保存沿用该 Script Info，不重新探测视频覆盖分辨率。编辑页预览为简化 HTML 叠加（非 libass 真渲染），与压制成品样式仍可能有差异。

```mermaid
flowchart LR
  Download --> Import --> Video --> FFmpeg --> ASR --> ASS --> Translate --> Editor --> Burn
```

## 核心数据模型

### 项目 `.hikaru/project.json`

与视频同目录的 `.hikaru/` 文件夹，含 `project.json`、`audio.wav`、`subtitles.ass`。翻译后字幕保存为 `subtitles.translated.ass`。

### SubtitleCue（逻辑字幕条）

```typescript
interface SubtitleCue {
  id: string
  startMs: number
  endMs: number
  primaryText: string      // 原文
  secondaryText?: string   // 译文
  style: string
  layer: number
}
```

双语 ASS 默认使用行内合并：`译文 / 原文` 写入一条 Dialogue。用户可在设置中切换为分离双行：`Primary`（原文）+ `Secondary`（译文），同时间轴两行 Dialogue。编辑页列表、预览与编辑框通过 `getCueDisplay` 按 `subtitleMergeMode` 展示单行或双行，与序列化规则一致。

**源语言**：产品面向日语转录与翻译，新建项目固定 `sourceLang: "ja"`；转录与翻译 UI 不再暴露源语言选择。旧项目中的其他 `sourceLang` 仍可打开。

### ASR 引擎

- `faster-whisper`：默认引擎，模型列表为 tiny/base/small/medium/large-v2/large-v3。
- `parakeet`：NVIDIA NeMo 日语引擎，模型为 `nvidia/parakeet-tdt_ctc-0.6b-ja`。依赖较重，须显式执行 `./scripts/setup-asr.sh parakeet`（或 `parakeet-cpu` / `parakeet-cuda`）安装；未安装时 sidecar 仍可启动但该引擎显示不可用。该引擎优先读取 NeMo char timestamps，并按日语标点、长度和停顿重新切分字幕段。
- Parakeet 经 VAD 预切分和 gap backfill 后，当前真实转录效果已基本可接受，仅偶发少量句子遗漏；但时轴精度明显不如 faster-whisper，后续优化方案待定。

### VAD 预处理

转录页提供统一的 VAD（语音活动检测）高级配置，`use_vad` 与 `vad_config` 经 `start_asr` 透传到 sidecar，各引擎按原生方式集成：

- **faster-whisper**：透传 `vad_parameters` 到内置 Silero VAD（始终 `vad_filter=True`，`use_vad=True` 时用自定义参数）。
- **Parakeet**：用独立 `engines/vad.py`（Silero VAD via `torch.hub`，`trust_repo=True`）预切分语音段，长段按 `max_segment_duration_ms` 带重叠切分后逐段转录，缓解长音频 TDT 不稳定导致的遗漏。
- 两引擎共享同一套 camelCase 配置；`schemas.VadConfig` 负责 camelCase→snake_case 转换，引擎内部读取 snake_case 键。
- VAD 加载/检测失败时自动降级（Parakeet 回退固定分块，faster-whisper 回退默认参数），不中断转录。
- VAD 配置仅当前会话有效，不写入项目/全局设置。

### 视频编辑兼容策略

编辑页通过应用内 **本地 HTTP 媒体服务**（`register_media_playback` → `http://127.0.0.1:PORT/media/{token}`）播放视频，支持 Range 请求与 seek；Linux WebKit 无法经 Tauri `asset://` 正常播放音视频，故全平台统一走 HTTP。`probe_video_playback` 判断容器/编解码是否需代理转码；WebView 不直接支持的编码（如 HEVC/H.265、VP9、AV1）会通过 FFmpeg 生成 480p H.264 全关键帧代理视频：

```text
-vf scale=-2:480 -c:v libx264 -preset ultrafast -g 1 -crf 22 -c:a aac -b:a 128k -movflags +faststart
```

代理视频写入应用缓存目录 `transcode/*.mp4`，用于快速 seek；时间轴另行提取音频波形用于细致对轴。

### m3u8 视频下载

下载页（`DownloadView`）支持单 URL 或分离音视频 URL、自定义请求头、保存目录选择与完成后一键导入项目。后端策略默认为 `auto`：优先 Rust 分片并发下载，失败时回退 FFmpeg。

**分片并发流程**（`hls_*` + `download.rs`）：

1. 解析 VOD m3u8 → 构建 `HlsMediaPlan`（init 段、媒体分片、Byte-Range、AES-128 解密信息）
2. 预取加密密钥；按 CPU 核数自动并发（`clamp(核数×2, 8, 32)`），每 job 共享一个 HTTP/2 `reqwest` client
3. 并发下载分片到临时目录（保留 URL 原始扩展名如 `.cmfv`/`.ts`，便于调试）；明文分片流式写盘，AES-128 媒体分片整段缓冲解密
4. 流式拼接 `video.bin`/`audio.bin` → FFmpeg `-c copy` remux 为最终文件
5. 分离模式音视频并行下载，共享同一 semaphore 上限

**加密与兼容**：

- 支持 AES-128-CBC 加密 VOD（如 Niconico domand fMP4）
- `EXT-X-MAP` 在 `EXT-X-KEY` 之后时 init 段为明文（按 playlist 行序判定，符合 HLS 规范）
- 直播、无法解析的播放列表、分片策略失败等场景自动回退 FFmpeg
- 下载过程支持取消；取消时清理子进程与临时目录

前端不暴露并发数或策略选择；`start_video_download` 的 `strategy` 参数保留供调试，缺省 `auto`。

## 已实现 Tauri Commands

| Command | 职责 |
|---------|------|
| `create_project` | 初始化 `.hikaru/project.json` |
| `open_project` | 加载已有项目 |
| `check_ffmpeg` | 检测 FFmpeg |
| `get_settings` / `set_settings` | 全局配置 |
| `extract_audio` | FFmpeg 提取 16kHz WAV + 进度事件 |
| `extract_waveform` | 提取音频波形峰值数据 |
| `path_exists` | 判断文件/目录是否存在 |
| `list_asr_engines` | 列出 sidecar 已注册引擎及可用性（按需拉起 sidecar） |
| `start_asr` | 创建转录任务，返回 jobId |
| `get_asr_progress` | 轮询任务进度/片段 |
| `cancel_asr` | 取消转录任务 |
| `check_asr_model` | 检查本地 ASR 模型状态 |
| `download_asr_model` | 下载 ASR 模型 |
| `get_model_download_progress` | 获取 ASR 模型下载进度 |
| `save_ass_text` / `load_ass_text` | ASS 文件读写 |
| `get_video_info` | 获取视频分辨率、时长等元信息 |
| `register_media_playback` | 注册本地视频到媒体 HTTP 服务，返回可播放 URL |
| `probe_video_playback` | 探测 WebView 是否需代理转码（容器/音视频编码） |
| `allow_asset_path` | 将路径加入 Tauri asset scope（保留，非视频主路径） |
| `detect_video_codec` | 检测视频编码格式 |
| `start_transcode` | 启动代理视频转码 |
| `check_transcode_progress` | 查询代理视频转码状态 |
| `stop_transcode` | 清理转码任务记录 |
| `probe_download_media` | 探测 m3u8 流（视频/音频/扩展名） |
| `start_video_download` | 启动 m3u8 下载，返回 jobId |
| `get_video_download_progress` | 轮询下载进度 |
| `cancel_video_download` | 取消下载并清理部分输出 |

计划中 command：`burn_subtitles`（FFmpeg 压制输出向导）。

新增 command 时：在 `src-tauri/src/` 实现 → `lib.rs` 注册 → `src/services/tauri.ts` 封装 → 更新 capabilities 权限。

## 编码规范

1. **最小改动**：只改与任务相关的文件，不顺手重构
2. **遵循现有风格**：命名、目录、import 路径（`@/`、`@hikaru/ass-core`）
3. **类型优先**：前后端共享概念在 `src/types/` 与 `ass-core` 保持一致
4. **不提交密钥**：API Key 走 keychain/设置，不进源码
5. **中文 UI 文案**：用户面向字符串用简体中文
6. **图标用 SVG**：UI 图标一律使用 SVG（统一放 `src/components/layout/NavIcons.tsx`，lucide 风格 `stroke="currentColor"`），不要用 emoji/字符当图标，避免跨平台字形缺失渲染成方块
7. **不编辑计划文件**：`.cursor/plans/` 下的方案文档除非用户明确要求
8. **不主动提交代码**：没有用户明确要求，不允许主动执行 `git commit` 或 `git push`

## 分阶段实现（当前进度）

- [x] 项目脚手架（Tauri + React + Tailwind + Zustand + pnpm workspace）
- [x] `ass-core`：ASS 解析/序列化、双语展开/合并
- [x] 项目管理 + FFmpeg 音轨提取（含 FFmpeg 捆绑/分层解析）
- [x] 导入工作流 UI（ImportView：选视频 → 建项目 → 进入转录；支持打开已有项目并加载 ASS）
- [x] 设置页 UI（SettingsView：FFmpeg/Python 路径、默认引擎、翻译 API/Key、翻译高级配置）
- [x] Python ASR sidecar（AsrEngine 抽象 + faster-whisper / parakeet 适配器 + HTTP 进度 API）
- [x] 转录工作流 UI（TranscribeView：音轨提取 + 转录进度 + 生成单语 ASS；使用视频实际分辨率，不强制换行）
- [x] OpenAI 兼容翻译管线 + 翻译 UI（TranslateView：批量翻译 + 进度显示 + 术语表/自定义 prompt 支持）
- [x] ASS 文件持久化（转录后自动保存，打开项目时自动加载）
- [x] ASS 元数据持久化（`[V4+ Styles]` + PlayRes；转录写入、翻译/编辑沿用；打开项目 `loadAssDocument`）
- [x] 字幕合并模式配置（默认行内 `译文 / 原文`；编辑 UI 与 ASS 序列化一致）
- [x] 字幕编辑器（EditorView：视频播放 + 字幕列表 + 编辑面板 + 局部缩放时间轴 + 音频波形 + 撤销重做）
- [x] 视频播放兼容处理（本地 HTTP 媒体服务 + Range；不兼容编码生成 480p H.264 全关键帧代理视频并缓存）
- [x] VAD 预处理（统一配置 UI；faster-whisper 透传内置 VAD，Parakeet 独立 Silero VAD 预切分；失败自动降级）
- [x] 日语专用化（源语言固定 ja；移除转录/设置页源语言选择）
- [x] m3u8 视频下载（DownloadView；Rust 分片并发 + AES-128 + 自动并发/HTTP/2；FFmpeg fallback）
- [ ] FFmpeg 压制（BurnView 输出向导）
- [ ] 错误处理、任务队列、安装脚本等整体打磨

## 首期不做

在线协作、OCR 硬字幕提取、多音轨选择、macOS 公证/商店发布。
