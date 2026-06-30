# Hikaru-Sub

日语 AI 字幕桌面应用：m3u8 视频下载 → 本地 ASR 日语转录 → LLM 批量翻译 → 字幕校对编辑 → FFmpeg 压制。

## 当前进度

✅ **已实现**：
- m3u8 视频下载（Rust 分片并发优先、FFmpeg 兼容回退；单 URL / 分离音视频；AES-128 加密 VOD；自定义请求头；自动并发与 HTTP/2；进度与取消；完成后可导入项目）
- 项目管理（创建/打开项目，`.hikaru` 元数据；打开时支持选择视频目录或 `.hikaru` 目录）
- FFmpeg 集成（音轨提取、视频信息获取、音频波形提取、H.265/HEVC 等不兼容编码代理视频转码）
- Python ASR sidecar（faster-whisper + NVIDIA Parakeet + Qwen3-ASR 日语适配器 + VAD 预处理 + HTTP 进度 API）
- 转录工作流（音频提取 → ASR 转录 → 生成单语 ASS）
- OpenAI 兼容翻译管线（批量翻译 + 上下文窗口 + 术语表）
- 翻译工作流（配置界面 + 进度显示 → 生成 `.translated.ass`）
- 设置页（FFmpeg/Python 路径、ASR 引擎、翻译 API、高级配置）
- ASS 文件持久化（自动保存/加载；保留 `[V4+ Styles]` 与 PlayRes；转录时按视频分辨率写入）
- 字幕编辑器（视频播放 + libass 优先字幕预览 + CSS 明示兜底 + 行内 override 标签渲染 + 字幕列表 + 编辑面板 + 局部缩放时间轴 + 音频波形 + 撤销重做；播放时按视频帧时间同步预览；inline 模式 UI 单行展示 `译文 / 原文`）
- FFmpeg 压制（硬字幕 MP4 / 软字幕 MKV；导出策略、原片码率探测、硬件 H.264 编码器自动选择；进度与取消；压制前使用当前内存字幕生成临时 ASS）
- libass 预览（编辑页使用 jASSUB/libass WASM 渲染当前内存 ASS；按视频帧时间同步；自动发现系统字体并预加载 ASS 样式、同族权重与行内 `\fn` 字体；不可用时回退 CSS 并在预览区提示；FFmpeg/libass 单帧路径保留作诊断与视觉回归）
- 编辑页视频播放（本地 HTTP 媒体服务 + Range；全平台统一，支持 seek）
- 视频代理转码（480p 全关键帧 H.264，带缓存和进度显示，用于精准 seek）
- VAD 高级配置（faster-whisper 透传内置 Silero VAD 参数；Parakeet / Qwen3-ASR 独立 VAD 切分语音段，失败自动降级）

🚧 **待优化**：
1. 首页增加显示最近项目列表
2. 翻译页进度条显示优化
3. 翻译页支持单独配置每批翻译条数、上下文条数、自定义 prompt 和术语表、字幕合并模式（当前使用全局设置）
4. 编辑页功能完善：
   - 快捷键操作（上下切换字幕、时间轴左右移动）
   - 字幕样式可视化编辑（字体、颜色、位置等 GUI，当前需在编辑框手写 ASS 标签）
5. libass 预览继续增加自动化视觉回归样本与跨平台校准

## 技术栈

- **桌面**: Tauri 2 + Rust
- **前端**: React 19 + TypeScript + Vite
- **样式**: Tailwind CSS 4
- **状态**: Zustand
- **包管理**: pnpm workspace
- **ASR**: Python sidecar（faster-whisper / Parakeet / Qwen3-ASR + VAD）
- **翻译**: OpenAI 兼容 API 适配器

## 环境要求

- Node.js 20+
- pnpm 10+
- Rust（[安装指南](https://www.rust-lang.org/learn/get-started)）
- FFmpeg（PATH 或可配置路径）
- Python 3.10+（ASR sidecar）
- 可选：CUDA（faster-whisper GPU 加速；Parakeet / Qwen3-ASR 需单独安装 CUDA 版依赖）

## 开发

```bash
pnpm install
./scripts/setup-asr.sh        # ASR 依赖（默认 faster-whisper）
pnpm dev          # 仅前端
pnpm tauri dev    # 桌面开发模式
pnpm build        # 构建前端
pnpm tauri build  # 打包应用
```

### ASR sidecar 依赖

`./scripts/setup-asr.sh` 默认安装 **faster-whisper** 引擎（`requirements.txt`）。Parakeet（NeMo + PyTorch）与 Qwen3-ASR（qwen-asr + PyTorch）体积较大，**须显式传参**才会安装：

| 场景 | 命令 |
|------|------|
| 日常开发（默认） | `./scripts/setup-asr.sh` 或 `pnpm asr:setup` |
| 有 NVIDIA GPU、试 Parakeet | `./scripts/setup-asr.sh parakeet-cuda` |
| 无 GPU 但想试 Parakeet | `./scripts/setup-asr.sh parakeet-cpu` |
| 有 NVIDIA GPU、试 Qwen3-ASR | `./scripts/setup-asr.sh qwen3-cuda` |
| 无 GPU 但想试 Qwen3-ASR | `./scripts/setup-asr.sh qwen3-cpu` |

亦可用 `pnpm asr:setup -- qwen3-cuda`。已误装引擎时：`./scripts/setup-asr.sh --recreate`。详情见 `asr-service/README.md`。

## 项目结构

```
src/                          # React 前端
  components/
    layout/                   # 布局、侧边栏、状态栏
    workflow/                 # 导入、转录、翻译、压制、设置页
    editor/                   # 字幕编辑器组件
      EditorView.tsx          # 编辑器主视图
      SubtitleList.tsx        # 字幕列表
      SubtitleEditor.tsx      # 编辑面板
      Timeline.tsx            # 时间轴可视化
    player/                   # 视频播放器
      VideoPlayer.tsx         # 视频播放 + 字幕叠加
      SubtitlePreview.tsx     # libass 优先 / CSS 兜底的字幕预览入口
      LibassSubtitleOverlay.tsx # jASSUB/libass WASM 预览
      AssSubtitleOverlay.tsx  # CSS 兜底字幕叠加容器
      AssStyledText.tsx       # 行内 override 标签 span 渲染
      PlaybackControls.tsx    # 播放控制栏
  utils/
    assPreviewDocument.ts     # 当前内存字幕 → 预览 ASS 文本
    assStyleCss.ts            # ASS Style → CSS 兜底映射
    assRunCss.ts              # 行内 override → span CSS
    videoDisplayRect.ts       # object-fit 画面区域计算
  hooks/
    useVideoDisplayRect.ts    # 视频真实渲染区域跟踪
  stores/                     # Zustand 状态管理
  services/                   # Tauri 命令封装 + 翻译服务
src-tauri/                    # Tauri Rust 后端
  src/
    ffmpeg.rs                 # FFmpeg 检测、音轨提取、视频信息、波形提取
    asr.rs                    # ASR sidecar 进程管理 + HTTP 代理
    ass.rs                    # ASS 文件读写
    asset_scope.rs            # Tauri asset protocol 动态授权
    media_server.rs           # 本地 HTTP 媒体服务（编辑页视频播放）
    fonts.rs                  # 系统字体发现与预览字体 URL 注册
    preview.rs                # FFmpeg/libass 单帧字幕渲染（诊断/校准）
    transcode.rs              # 不兼容视频编码的代理转码与缓存
    download.rs               # m3u8 下载 command、任务状态与策略编排
    hls_playlist.rs           # m3u8 解析与分片计划
    hls_fetch.rs              # 分片 HTTP 下载与 AES 解密
    hls_download.rs           # 并发调度与媒体组装
    hls_types.rs              # 下载类型与自动并发配置
    project.rs                # 项目元数据管理
    settings.rs               # 全局设置持久化
packages/ass-core/            # ASS 解析/序列化库（workspace）
  src/assTags.ts              # ASS 行内 override 标签解析
asr-service/                  # Python ASR sidecar
  main.py                     # FastAPI HTTP 服务
  server.py                   # 路由定义
  jobs.py                     # 后台转录任务管理
  requirements-parakeet*.txt    # 可选 Parakeet（cpu / cuda）
  requirements-qwen3*.txt       # 可选 Qwen3-ASR（cpu / cuda）
  engines/                    # ASR 引擎抽象与实现（faster-whisper / parakeet / qwen3-asr / chunking / vad）
scripts/
  setup-asr.sh                # ASR 依赖安装（推荐）
```

## 工作流

0. **下载**（可选）→ 从 m3u8 下载音视频到本地

默认 `auto` 策略：解析 VOD m3u8 后按 CPU 核数自动并发（8–32）下载分片，共享 HTTP/2 连接；支持 Byte-Range 与 AES-128-CBC 加密流（如 Niconico domand fMP4）。分片按播放列表顺序流式拼接为临时媒体文件，再用 FFmpeg `-c copy` remux。直播或分片策略无法处理时自动回退 FFmpeg 兼容模式。

1. **导入视频** → 创建 `.hikaru` 项目目录
2. **日语转录** → 提取音轨 → ASR 转录（源语言固定日语）→ 生成单语 ASS
3. **翻译** → OpenAI 兼容 API 批量翻译 → 生成双语 ASS（`.translated.ass`）
4. **编辑** → 载入字幕 → 视频/波形辅助校对 → 调整文本与时间轴 → 保存 ASS
5. **压制** → FFmpeg 硬字幕 MP4 或软字幕 MKV 输出


## 核心功能

### m3u8 下载
- 单 URL 或分离音视频 URL；可粘贴自定义 HTTP 请求头（如 Referer、Cookie）
- 自动选择输出扩展名；分离模式分别下载后由 FFmpeg 合并
- Rust 分片路径：自动并发、流式写盘、临时分片保留原始扩展名
- 加密 VOD：AES-128-CBC；init 段按 KEY/MAP 行序判断是否解密
- 进度轮询与取消；失败或不可解析时回退 FFmpeg
- 下载完成后可打开保存目录或直接进入导入流程

### 字幕压制
- 硬字幕 MP4（libass 渲染字幕 + H.264 重新编码）与软字幕 MKV（ASS 字幕轨封装）
- 压制前将当前内存字幕序列化为 `.hikaru/burn.input.ass`，包含未保存编辑
- 输出文件名自动生成（`{视频名}.burned.mp4` / `{视频名}.subbed.mkv`），按模式固定扩展名，不可自定义
- 硬字幕支持“高质量 / 接近原片 / 自定义码率”导出策略；策略会同步视频码率、编码器、CRF 与 preset
- 硬字幕会探测原视频码率与 FFmpeg 可用编码器，自动优先选择平台合适的硬件 H.264 编码器（Windows：NVENC / QSV / AMF；macOS：VideoToolbox；Linux：NVENC / QSV），不可用时回退 libx264
- 可手动选择编码器、视频码率、CRF、preset 与字体目录；软字幕仅 MKV
- 同一时刻仅允许一个压制任务；终态后自动清理任务记录
- 全局任务轮询（`useBurnJobPoller`）：切换页面后仍更新底部状态栏进度
- 进度轮询、取消（仅清理运行中的输出）、完成后打开输出位置
- 应用退出时终止运行中的 FFmpeg 子进程，避免孤儿进程
- 压制页仅展示导出设置；字体目录用于最终硬字幕压制时帮助 FFmpeg/libass 找到 ASS 指定字体

### 转录配置（日语源语言）
- 源语言固定为日语（`ja`），转录页不提供语言选择
- 引擎选择：faster-whisper（支持 CPU/CUDA/auto）
- 可选引擎：parakeet（NVIDIA NeMo `nvidia/parakeet-tdt_ctc-0.6b-ja`，日语专用）
- 可选引擎：qwen3-asr（`Qwen/Qwen3-ASR-1.7B` + `Qwen/Qwen3-ForcedAligner-0.6B`，2026 年日语 ASR SOTA，自带字级时间戳；CPU float32 / CUDA bfloat16）
- 模型选择：faster-whisper 为 tiny/base/small/medium/large-v2/large-v3
- 自动模型下载与 CUDA 回退
- 实时进度显示与任务取消
- Parakeet 优先使用 NeMo char timestamps，并按日语标点、长度和停顿重新切分字幕段
- Parakeet + VAD/gap backfill 已完成长音频完整性增强，并复用 chunking 共享模块合并去重
- Qwen3-ASR 自带 ForcedAligner 产出字级时间戳，长音频自动分块转录并复用 chunking 共享模块合并去重
- **VAD 高级配置**（可选，对三个引擎均生效）：
  - 启用 VAD 预处理：faster-whisper 透传内置 Silero VAD 参数；Parakeet / Qwen3-ASR 用 VAD 切分语音段后逐段转录，缓解长音频遗漏
  - 语音阈值（threshold）：0.0-1.0，默认 0.5
  - 最小语音段长度：过滤短噪声，默认 500ms
  - 最小静音间隔：语音段分割灵敏度，默认 300ms
  - 最大语音段长度（Parakeet / Qwen3-ASR 专用）：长段切分阈值，默认 25s
  - VAD 加载失败时自动降级（Parakeet / Qwen3-ASR 回退固定分块，faster-whisper 回退默认参数）

### 翻译配置
- OpenAI 兼容 API（支持 OpenAI、DeepSeek、Ollama 等）
- **批量翻译条数**（5-50，默认 25）：控制每次 API 请求的字幕数量
- **上下文窗口**（1-10，默认 2）：每批前后附加参考字幕，提高术语一致性
- **自定义 Prompt**：附加在系统提示词后的额外要求
- **术语表 Glossary**：强制特定词汇译法（格式：`原文 -> 译文`）
- **字幕合并模式**：默认行内拼接为 `译文 / 原文`，也可选择分离双行
- 批量失败自动降级为单条重试

### 编辑器
- 视频预览与字幕叠加（经 `register_media_playback` 本地 HTTP 流；`subtitleMergeMode=inline` 时单行显示 `译文 / 原文`）
- 左侧字幕列表与右侧文本/时间编辑面板
- `Ctrl+S` 保存、`Ctrl+Z` 撤销、`Ctrl+Y`/`Ctrl+Shift+Z` 重做
- 局部时间轴视图：滚轮左右平移，`Ctrl+滚轮` 缩放，点击定位播放时间
- 独立音频波形提取与渲染，便于参考 Aegisub 式精细对轴
- 不兼容编码自动生成 480p H.264 全关键帧代理视频，并复用转码缓存
- 保存 ASS 时沿用转录/翻译阶段的 Script Info 与 Styles（含 PlayRes），不重新探测视频覆盖分辨率

#### 字幕预览渲染（libass 优先，CSS 兜底）

编辑页优先通过 jASSUB/libass WASM 渲染当前内存 ASS。播放时预览跟随 `<video>` 的视频帧时间，优先使用 `requestVideoFrameCallback`，不支持时回退到 `requestAnimationFrame`。若 libass WASM 或字体注册不可用，编辑页会回退到 CSS 近似预览，并在预览区显示提示；ASS 文本、字体集合或渲染模式变化后会清除回退状态并重新尝试 libass。压制页不展示字幕预览，只保留导出设置；最终硬字幕输出仍以 FFmpeg/libass 为准。

**实现架构**

```
SubtitleCue + assStyles + assScriptInfo
        ↓
resolveAssDocumentForSave + serializeAss
        ↓
SubtitlePreview
        ├─ 编辑页：LibassSubtitleOverlay（jASSUB/libass WASM）
        └─ CSS 兜底：AssSubtitleOverlay + AssStyledText

诊断 / 视觉回归：render_subtitle_preview_frame（FFmpeg ass filter）
```

**字体发现**

- `discover_preview_fonts` 会枚举系统字体目录，并通过本地 HTTP 媒体服务把 `.ttf` / `.otf` / `.ttc` / `.otc` 注册给浏览器端 libass。
- 编辑页会按 ASS Style 字体名、当前字幕行内 `\fn` 覆盖，以及匹配字体家族的多个权重文件选择预加载字体，减少预览与最终压制在字重选择上的差异。
- 压制页填写的字体目录会作为最终硬字幕压制的补充字体源。
- 字体缺失时 libass 会按运行环境回退；预览区会保留提示，便于定位字体差异。

**画面区域**

- 视频使用 `object-fit: contain`，容器比例与视频不一致时会出现黑边。
- 编辑页通过 `useVideoDisplayRect` 按视频 intrinsic 尺寸计算真实画面矩形，字幕预览只覆盖该矩形。
- 压制页不再展示字幕预览，避免与最终导出设置混在同一工作区。

**CSS 兜底覆盖范围**

CSS 兜底仍解析常用 Style 与行内 override 标签，用于 libass 不可用时维持可编辑体验。它支持字体、字号、颜色、粗斜体、描边、阴影、九宫格对齐、边距、缩放、字距、`\N` 换行、`\r` 重置/切换 Style 等常用字段；不支持定位动画、卡拉 OK、精细换行、旋转、轴向描边/阴影等 libass 高级行为。

**触发时机**

- 编辑页播放中：按 `<video>` 视频帧时间显示字幕。
- 编辑页暂停时：优先显示列表选中的字幕，便于校对样式。
- 压制页：不显示字幕预览，只展示输出模式、导出策略、编码、码率、字体目录和任务进度。

### 文件管理
- **项目元数据**：`.hikaru/project.json`（与视频同目录）
- **转录字幕**：`subtitles.ass`（单语原文）
- **翻译字幕**：`subtitles.translated.ass`（双语字幕）
- **音频缓存**：`audio.wav`（16kHz 单声道 WAV）
- **代理视频缓存**：应用缓存目录下的 `transcode/*.mp4`

## 核心数据模型

### SubtitleCue（内存字幕条目）

```typescript
interface SubtitleCue {
  id: string
  startMs: number
  endMs: number
  primaryText: string      // 原文
  secondaryText?: string   // 译文
  style: string            // ASS 样式名
  layer: number
}
```

### 双语 ASS 策略

- **Style `Primary`**：原文样式（偏下方显示）
- **Style `Secondary`**：译文样式（偏上方显示）
- 默认 `inline` 模式：译文和原文保存为一条 Dialogue，文本格式为 `译文 / 原文`；编辑页列表/预览/编辑框同步按单行展示
- 可选 `separate` 模式：原文和译文保存为同时间戳的两条 Dialogue
- **PlayRes**：转录保存 ASS 时从 `get_video_info` 写入视频分辨率；翻译与编辑保存沿用，不在编辑阶段重算
- 打开项目时优先加载 `subtitles.translated.ass`，不存在时回退到 `subtitles.ass`；`parseAss` 后 `loadAssDocument` 保留 styles 与 scriptInfo

## 已实现的 Tauri Commands

| Command | 功能 |
|---------|------|
| `create_project` | 初始化 `.hikaru` 项目 |
| `open_project` | 加载已有项目元数据 |
| `check_ffmpeg` | 检测 FFmpeg 可用性与版本 |
| `extract_audio` | 提取 16kHz WAV 音轨 + 进度事件 |
| `extract_waveform` | 提取归一化音频峰值数据用于时间轴波形 |
| `get_video_info` | 获取视频分辨率、时长 |
| `discover_preview_fonts` | 枚举系统/补充字体并注册为预览可访问 URL |
| `render_subtitle_preview_frame` | 使用 FFmpeg/libass 渲染硬字幕单帧图，用于诊断与视觉回归 |
| `register_media_playback` | 注册本地视频到媒体 HTTP 服务，返回可播放 URL |
| `probe_video_playback` | 探测是否需代理转码（容器/音视频编码） |
| `path_exists` | 判断文件或目录是否存在 |
| `list_asr_engines` | 列出 ASR sidecar 可用引擎 |
| `start_asr` | 启动转录任务 |
| `get_asr_progress` | 获取转录进度与片段 |
| `cancel_asr` | 取消转录任务 |
| `check_asr_model` | 检查本地 ASR 模型是否可用 |
| `download_asr_model` | 启动 ASR 模型下载任务 |
| `get_model_download_progress` | 获取模型下载进度 |
| `save_ass_text` | 保存 ASS 文本到文件 |
| `load_ass_text` | 加载 ASS 文件内容 |
| `get_settings` / `set_settings` | 全局配置读写 |
| `allow_asset_path` | 将视频或代理文件路径加入 Tauri asset scope |
| `detect_video_codec` | 检测视频编码格式 |
| `start_transcode` | 启动不兼容视频编码的代理视频转码 |
| `check_transcode_progress` | 查询代理转码是否完成 |
| `stop_transcode` | 停止并清理转码任务记录 |
| `probe_download_media` | 探测 m3u8 媒体流（视频/音频/扩展名） |
| `start_video_download` | 启动 m3u8 下载任务 |
| `get_video_download_progress` | 查询下载进度 |
| `cancel_video_download` | 取消下载并清理部分文件 |
| `probe_burn_video` | 探测压制推荐参数（原视频码率、可用编码器） |
| `start_burn_subtitles` | 启动字幕压制/封装任务 |
| `get_burn_progress` | 查询压制进度 |
| `cancel_burn` | 取消压制并清理部分输出 |
