# Hikaru Sub

日语 AI 字幕桌面应用：m3u8 视频下载 → 本地 ASR 日语转录 → LLM 批量翻译 → 字幕校对编辑 → FFmpeg 压制。

## 当前进度

✅ **已实现**：
- m3u8 视频下载（Rust 分片并发优先、FFmpeg 兼容回退；单 URL / 分离音视频；AES-128 加密 VOD；自定义请求头；自动并发与 HTTP/2；进度与取消；完成后可打开视频继续转录）
- 文件中心视频会话（打开视频即准备运行时缓存；优先加载同目录 `*.translated.ass`，不存在时回退 `*.transcribed.ass`）
- FFmpeg 集成（系统优先、缺失时按需下载受管 FFmpeg；音轨提取、视频信息获取、音频波形提取、H.265/HEVC 等不兼容编码代理视频转码）
- Python ASR sidecar（faster-whisper + NVIDIA Parakeet + Qwen3-ASR 日语适配器 + VAD 预处理 + HTTP 进度 API）
- 转录工作流（音频提取 → ASR 转录 → 生成单语 ASS）
- OpenAI 兼容翻译管线（批量翻译 + 上下文窗口 + 术语表）
- 翻译工作流（配置界面 + 进度显示 → 生成 `*.translated.ass`）
- 设置页（运行时依赖下载源与存储清理、ASR 引擎、翻译 API、高级配置）
- ASS 文件持久化（自动保存/加载；保留 `[V4+ Styles]` 与 PlayRes；转录时按视频分辨率写入）
- 字幕编辑器（视频播放 + libass 优先字幕预览 + CSS 明示兜底 + 行内 override 标签渲染 + 样式下拉/快速参数工具栏/更多标签面板/样式库抽屉 + 字幕列表右键菜单/多选行操作 + 编辑面板 + 可拖拽边界的多泳道时间轴 + 固定音频波形 + 撤销重做 + Aegisub 式快捷键体系（字幕导航、逐帧/边界播放头控制、Ctrl+3/4 对轴打点、整行复制/剪切/粘贴、Enter 提交跳转、? 键位速查）；播放时按视频帧时间同步预览；inline 模式 UI 单行展示 `译文 / 原文`）
- FFmpeg 压制（硬字幕 MP4 / 软字幕 MKV；导出策略、原片码率探测、硬件 H.264 编码器自动选择；进度与取消；压制前使用当前内存字幕生成临时 ASS）
- libass 预览（编辑页使用 jASSUB/libass WASM 渲染当前内存 ASS；按视频帧时间同步；自动发现系统字体并预加载 ASS 样式、同族权重与行内 `\fn` 字体；不可用时回退 CSS 并在预览区提示；FFmpeg/libass 单帧路径保留作诊断与视觉回归）
- 编辑页视频播放（本地 HTTP 媒体服务 + Range；全平台统一，支持 seek）
- 视频代理转码（480p 全关键帧 H.264，带缓存和进度显示，用于精准 seek）
- VAD 语音检测预处理配置（faster-whisper 透传内置 Silero VAD 参数；Parakeet / Qwen3-ASR 独立 VAD 切分语音段，失败自动降级）

🚧 **待优化**：
1. 首页增加显示最近视频列表
2. 翻译页进度条显示优化
3. 翻译页支持单独配置每批翻译条数、上下文条数、自定义 prompt 和术语表、字幕合并模式（当前使用全局设置）
4. libass 预览继续增加自动化视觉回归样本与跨平台校准

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
- FFmpeg（PATH/自定义路径优先；缺失时客户端按需下载受管副本）
- Python 3.11（系统/自定义路径优先；ASR 配置时缺失则按需下载受管 Python 3.11）
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

## 发布客户端

当前发布目标先收敛到 Windows 安装包与 portable zip；macOS workflow 已暂时注释，待 macOS 资源布局验证完成后再恢复。Linux 客户端会在 Windows/macOS 发布链路稳定后再加入。

### 本地打包

```bash
pnpm release:local
```

该命令用于发布机，会准备 ASR 服务资源、执行 Tauri 打包并追加 portable zip，不会下载或捆绑 FFmpeg。当前 Windows 会生成 NSIS 安装包与 portable zip，产物分别位于 `src-tauri/target/release/bundle/nsis/` 和 `src-tauri/target/release/bundle/portable/`。Linux 本地包不属于首期支持范围。

### GitHub Release

推送 `v*` 标签会触发 `.github/workflows/release.yml`：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流当前只构建 Windows 产物，并上传 NSIS setup 与 portable zip 到 GitHub Release 草稿。也可以从 GitHub Actions 手动运行 `Release Desktop Clients`，输入已存在的 tag/ref；工作流会检出该 ref，并创建或更新同名 Release 草稿。macOS Intel 与 macOS Apple Silicon matrix 已保留为注释，待 macOS 验证通过后重新启用。

发布包会包含 ASR 服务模板，但不包含 FFmpeg、Python、ASR Python 依赖或模型权重。安装版与 portable 版都会在首次使用相关功能时优先复用系统 FFmpeg/Python 3.11；如缺失，会弹出确认窗口后下载到 exe 所在目录下的 `deps/` 受管依赖目录，不使用 `%APPDATA%\com.hikaru.sub` 或 `%LOCALAPPDATA%\com.hikaru.sub` 存放这些大型依赖。下载源支持自动测速推荐、官方源、中国大陆镜像和自定义源；设置页可查看受管依赖占用并清理 FFmpeg、Python 3.11、ASR venv、模型缓存和临时下载缓存。

当前发布限制：

- Windows 当前发布 NSIS setup 与 portable zip，不发布 MSI。MSI 的安装目录选择 UI 暂不作为首选安装体验。
- Windows 包未做代码签名，可能出现 SmartScreen 提示。
- macOS 包暂不发布；恢复后会先使用 ad-hoc signing，notarization 另行处理。
- Linux 包暂不发布。

### Windows 安装包验证

在 Windows 发布机执行 `pnpm release:local` 后，应确认：

1. `src-tauri/target/release/bundle/nsis/` 下存在 Hikaru Sub NSIS setup，`src-tauri/target/release/bundle/portable/` 下存在 Hikaru Sub portable zip，且干净 bundle 目录下没有新生成的 MSI。
2. 解压 portable zip 后直接运行 `hikaru-sub.exe`；首次触发受管依赖下载时，FFmpeg、Python 3.11、ASR venv、模型缓存和临时下载缓存应写入该 exe 同级的 `deps/` 目录。
3. 运行 NSIS setup，可选择安装目录；如果用户未手动修改目录，安装开始时会将 Tauri 目录页的默认值重定向到 `%LOCALAPPDATA%\Programs\hikaru-sub`，安装完成后从开始菜单或安装目录启动应用。
4. 首次启动与切换到「下载」「导入」「转录」「压制」页面时不应长时间卡住；这些页面会复用 FFmpeg 检测缓存，不会自动下载 FFmpeg。
5. 进入「转录」页不会自动启动 ASR sidecar；点击「检测引擎状态」或开始转录时才会拉起 sidecar。
6. 进入「压制」页不会自动探测原片码率/编码器；点击「检测原片参数」后才会运行 ffprobe/编码器探测。
7. 检测 ASR、配置 ASR、FFmpeg/ffprobe 相关操作不应弹出转瞬即逝的终端窗口。
8. 如果本机没有系统 FFmpeg，点击「下载」「转录」「压制」中的 FFmpeg 相关操作时，应出现依赖确认窗口，显示 FFmpeg、预计大小、安装目录 `deps/` 下的保存位置和当前下载源；取消时原操作不继续，确认后下载完成并继续原操作。
9. 如果本机没有 Python 3.11，设置页点击「配置当前引擎依赖」时，应先出现 Python 3.11 依赖确认窗口；确认后下载并解压受管 Python 3.11 归档到安装目录 `deps/python311/current/`，再继续创建 ASR venv 和安装引擎依赖。
10. 设置页「运行时依赖」区域可切换官方源/中国大陆镜像/自动推荐，点击「重新测速」会更新推荐源；清理按钮只删除安装目录 `deps/` 下的受管依赖，不应删除用户手动配置的外部路径。
11. 如果本机曾运行开发版，安装版 ASR 依赖配置不应继续指向项目源码目录下的 `asr-service/.venv`；一键配置完成后应指向安装目录下的 managed `deps/asr-service/.venv`。
12. 使用受管 FFmpeg 完成一次转录后，若 `deps/ffmpeg/current/ffprobe.exe` 存在，不应再提示“无法读取视频分辨率，字幕 PlayRes 已使用默认 1920×1080”。
13. 下载 ASR 模型时，「模型状态」区域应显示实际下载源和诊断日志路径；中国大陆镜像模式下应能在日志中看到 `HF_ENDPOINT=https://hf-mirror.com` 与 `HF_HOME=<安装目录>/deps/models/huggingface`。

### 运行时依赖与下载源

- FFmpeg 解析顺序：用户配置路径 → 系统 `PATH` → 安装目录 `deps/ffmpeg/current` 下的受管 FFmpeg；缺失时由相关工作流弹出下载确认。
- Python 解析顺序：用户配置路径 → 系统 Python 3.11（Windows 会尝试 `py -3.11` 等启动器）→ 安装目录 `deps/python311/current` 下的受管 Python 3.11；ASR 配置流程只接受 Python 3.11。
- ASR venv 位于 `deps/asr-service/.venv`，模型缓存位于 `deps/models/huggingface`，临时归档位于 `deps/downloads`。这些目录都跟随用户选择的安装目录。
- 如果用户把 Hikaru Sub 安装到 `C:\Program Files` 等当前用户不可写目录，准备/清理受管依赖前会先尝试以管理员权限重启；取消 UAC 时会提示重新以管理员身份运行或安装到当前用户可写目录。
- 内置下载源清单位于 `src-tauri/resources/runtime-dependency-sources.json`，二进制归档以 SHA-256 和大小锁定。中国大陆镜像当前覆盖 FFmpeg、Python 3.11、PyPI、PyTorch wheels 与 Hugging Face endpoint。
- `hf-mirror.com` 可能按出口 IP 重定向到 Hugging Face 原站。若用户选择中国大陆镜像但模型下载仍失败，应优先查看模型状态显示的诊断日志；必要时切换到官方源、自定义稳定 endpoint，或确保模型下载流量全程走中国大陆出口。

### ASR sidecar 依赖

打包后的客户端可在「设置 → 日语转录（ASR）默认」中点击「配置当前引擎依赖」。Hikaru Sub 会先检测系统或自定义 Python 3.11；如不可用，则在确认后下载可重定位的受管 Python 3.11 归档并解压到安装目录 `deps/python311/current/`。随后会复制随应用提供的 ASR 服务模板、创建/复用安装目录 `deps/asr-service/.venv` 下的虚拟环境并安装所选引擎依赖。模型权重仍在同一区域的「模型状态」中单独检测与下载，不随依赖配置一起安装。安装版会忽略明显指向源码仓库 `asr-service/.venv` 的旧开发路径，避免复用开发环境缓存。

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
      InlineOverridePanel.tsx # 常用 ASS 行内 override 标签面板
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
    project.rs                # 视频会话与字幕路径准备
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

1. **导入视频** → 准备视频运行时会话
2. **日语转录** → 提取音轨 → ASR 转录（源语言固定日语）→ 生成 `*.transcribed.ass`
3. **翻译** → OpenAI 兼容 API 批量翻译 → 生成 `*.translated.ass`
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
- 压制前将当前内存字幕序列化到运行时缓存中的压制输入 ASS，包含未保存编辑
- 输出文件名自动生成（`{视频名}.burned.mp4` / `{视频名}.subbed.mkv`），按模式固定扩展名，不可自定义
- 硬字幕支持“高质量 / 接近原片 / 自定义码率”导出策略；策略会同步视频码率、编码器、CRF 与 preset
- 点击「检测原片参数」后会探测原视频码率与 FFmpeg 可用编码器，自动优先选择平台合适的硬件 H.264 编码器（Windows：NVENC / QSV / AMF；macOS：VideoToolbox；Linux：NVENC / QSV），不可用时回退 libx264
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
- 模型状态与引擎状态均为显式检测；进入转录页不会自动启动 ASR sidecar
- 实时进度显示与任务取消
- Parakeet 优先使用 NeMo char timestamps，并按日语标点、长度和停顿重新切分字幕段
- Parakeet + VAD/gap backfill 已完成长音频完整性增强，并复用 chunking 共享模块合并去重
- Qwen3-ASR 自带 ForcedAligner 产出字级时间戳，长音频自动分块转录并复用 chunking 共享模块合并去重
- **VAD 语音检测预处理配置**（可选，对三个引擎均生效）：
  - 勾选「启用 VAD 语音检测预处理」后显示下方参数；faster-whisper 透传内置 Silero VAD 参数，Parakeet / Qwen3-ASR 用 VAD 切分语音段后逐段转录
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
- 左侧字幕列表与右侧文本/时间编辑面板；字幕列表支持多选、右键插入/重复/分割/删除、互换 2 行、合并所选行，以及整行复制/剪切/粘贴
- 右上角保存按钮与 `Ctrl+S` 保存；`Ctrl+Z` 撤销、`Ctrl+Y`/`Ctrl+Shift+Z` 重做
- Aegisub 式快捷键：`↑/↓` 切换字幕、`←/→` 逐帧、`Alt+←/→` 快跳 10 帧、`Ctrl+←/→` 字幕边界跳转、`R` 播放当前句、`Ctrl+3/4` 打点、`Insert`/`Delete` 增删、`Ctrl+C/X/V` 整行复制/剪切/粘贴、`Enter` 提交跳下一条（末条追加）、`Esc` 放弃草稿、`?` 键位速查；编辑框内自动放行文本输入与原生撤销
- 样式可视化编辑：编辑面板支持样式下拉、字体/字号/主色、B/I/U/S 快速标签，以及更多标签面板（文字/描边/阴影颜色、描边粗细、阴影距离、`\an1-9` 对齐）；样式库抽屉支持新建、删除和编辑 ASS 样式的字体、颜色、边框、对齐与边距
- 局部时间轴视图：波形与刻度固定在顶部；字幕泳道可独立上下滚动；滚轮左右平移，`Ctrl+滚轮` 缩放，点击定位播放时间
- 时间轴字幕支持拖拽左右边界调整开始/结束时间，拖过另一端时自动互换起止；重叠字幕以多泳道展示，便于并行对轴
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

CSS 兜底仍解析常用 Style 与行内 override 标签，用于 libass 不可用时维持可编辑体验。它支持字体、字号、颜色、粗斜体、描边、阴影、Style 级九宫格对齐、边距、缩放、字距、`\N` 换行、`\r` 重置/切换 Style 等常用字段；行内 `\an` 会保留在文本中但不做 CSS 位置近似。不支持定位动画、卡拉 OK、精细换行、旋转、轴向描边/阴影等 libass 高级行为。

**触发时机**

- 编辑页播放中：按 `<video>` 视频帧时间显示字幕。
- 编辑页暂停时：优先显示列表选中的字幕，便于校对样式。
- 压制页：不显示字幕预览，只展示输出模式、导出策略、编码、码率、字体目录和任务进度。

### 文件管理
- **视频会话**：运行时对象，不写入项目元数据文件
- **转录字幕**：`{视频文件名}.transcribed.ass`（单语原文，与视频同目录）
- **翻译字幕**：`{视频文件名}.translated.ass`（双语字幕，与视频同目录）
- **音频缓存**：应用缓存工作区下的 `audio.wav`（16kHz 单声道 WAV，转录保存成功后删除）
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
- 打开视频时优先加载同目录 `{视频文件名}.translated.ass`，不存在时回退到 `{视频文件名}.transcribed.ass`；`parseAss` 后 `loadAssDocument` 保留 styles 与 scriptInfo

## 已实现的 Tauri Commands

| Command | 功能 |
|---------|------|
| `prepare_video_session` | 根据视频路径准备运行时会话与标准字幕路径 |
| `path_exists` | 检查文件或目录是否存在 |
| `delete_cached_audio` | 删除当前会话的缓存音轨 |
| `check_ffmpeg` | 检测 FFmpeg 可用性与版本 |
| `extract_audio` | 提取 16kHz WAV 音轨 + 进度事件 |
| `extract_waveform` | 提取归一化音频峰值数据用于时间轴波形 |
| `get_video_info` | 通过共享 ffprobe 解析器获取视频分辨率、时长 |
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
| `get_model_download_progress` | 获取模型下载进度、下载源与 sidecar 诊断日志路径 |
| `save_ass_text` | 保存 ASS 文本到文件 |
| `load_ass_text` | 加载 ASS 文件内容 |
| `get_settings` / `set_settings` | 全局配置读写 |
| `probe_runtime_dependencies` | 探测 FFmpeg、Python 3.11、ASR venv、模型缓存和下载缓存状态 |
| `prepare_runtime_dependency` | 按需下载/安装受管 FFmpeg 或 Python 3.11 |
| `get_runtime_dependency_progress` | 查询运行时依赖准备进度 |
| `cancel_runtime_dependency` | 取消运行时依赖准备任务 |
| `cleanup_runtime_dependency` | 清理安装目录 `deps/` 下的受管依赖或下载缓存 |
| `probe_download_sources` | 对下载源测速并保存自动推荐源 |
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
