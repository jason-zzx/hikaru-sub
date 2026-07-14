<p align="center">
  <img src="public/app-icon.svg" alt="Hikaru Sub" width="128" height="128">
</p>

# Hikaru Sub

Hikaru Sub 是一款面向日语视频的 AI 字幕桌面应用，将视频获取、本地语音转录、LLM 翻译、字幕校对和成片输出串成一条工作流。

当前桌面发行以 Windows 为主，提供 NSIS 安装包和 portable zip。macOS 与 Linux 暂未发布。

## 核心能力

- **获取视频**：打开本地视频，或下载单路/分离音视频的 m3u8；支持常见加密 VOD、自定义请求头、进度显示和取消。
- **选取片段**：通过静帧核对起止位置，选择快速软切或精确硬切，并可将结果设为新的工作视频。
- **本地日语转录**：使用 faster-whisper、kotoba-faster-whisper、Parakeet 或 Qwen3-ASR，在本机生成带时间轴的日语 ASS 字幕。
- **批量翻译**：调用 OpenAI 兼容 API，结合上下文窗口、自定义提示词和术语表，为字幕补充译文。
- **字幕校对**：在视频、字幕预览、音频波形和多泳道时间轴中修改文本、时间、样式与 ASS 行内标签，并支持撤销、重做和 Aegisub 式快捷键。
- **双语排版**：默认将字幕保存为 `译文 / 原文`，也可将原文与译文保存为同时间轴的分离双行。
- **输出成片**：生成硬字幕 MP4，或将 ASS 作为可切换软字幕封装进 MKV。
- **按需准备依赖**：优先复用系统 FFmpeg 和 Python 3.11，缺失时经确认下载受管副本；ASR 模型同样按需下载。

## 支持功能

1. **下载或导入**：下载 m3u8，或直接选择本地视频。
2. **切片**：裁出需要处理的片段，并决定是否把它设为当前工作视频。
3. **转录**：提取音轨，通过本地 ASR 生成日语 `*.transcribed.ass`。
4. **翻译**：调用已配置的翻译服务，生成双语 `*.translated.ass`。
5. **编辑**：校对文本与时间轴，调整字幕样式并保存 ASS。
6. **压制**：输出硬字幕 MP4 或软字幕 MKV。

打开视频时，Hikaru Sub 会优先加载同目录的翻译字幕，其次加载转录字幕。ASS 是字幕在转录、翻译、编辑与压制阶段之间的统一交换格式。

## 获取与运行

### Windows

从 [GitHub Releases](https://github.com/jason-zzx/hikaru-sub/releases) 获取最新构建：

- **Setup 安装包**：运行 setup 并按向导安装。
- **Portable zip压缩包**：完整解压到可写目录，然后直接运行程序。

Windows 构建目前未做代码签名，首次运行时可能出现 Microsoft SmartScreen 提示。详细的打包范围、已知限制和发布验证步骤见 [桌面发布手册](docs/release.md)。

### 首次使用

发布包不会捆绑 FFmpeg、Python、ASR Python 依赖或模型权重。首次触发相关功能时，Hikaru Sub 会先复用设置路径或系统依赖；仍不可用时，再显示下载内容、大小、来源和保存位置并请求确认。

使用转录前，在「设置」中选择 ASR 引擎并配置依赖，再检查或下载对应模型。使用翻译前，需要配置 OpenAI 兼容 API 的地址、模型和凭据。

日语 ASR 在本机运行；翻译会把字幕文本发送到用户配置的 API 服务。视频、转录字幕和翻译字幕保存在用户选择的位置或视频同目录，临时音频与代理视频位于应用缓存。

依赖解析顺序、portable 目录、下载源、存储清理和故障排查见 [运行时依赖手册](docs/runtime-dependencies.md)。

## 开发

### 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面壳 | Tauri 2 + Rust |
| 前端 | React 19 + TypeScript + Vite |
| UI | Tailwind CSS 4 + shadcn/ui |
| 状态 | Zustand |
| 字幕 | `src/lib/ass` + ASS |
| ASR | Python FastAPI sidecar |
| 音视频 | FFmpeg / ffprobe |

### 环境要求

- Node.js 20+
- pnpm 10+
- Rust stable
- Python 3.11（开发或调试 ASR 时需要）
- FFmpeg（运行完整媒体工作流时需要，也可由应用按需准备）
- 可选 NVIDIA CUDA（运行部分 ASR 引擎的 GPU 版本时需要）

始终使用 pnpm 安装项目依赖：

```bash
pnpm install
```

### 启动

启动完整 Tauri 桌面应用：

```bash
pnpm tauri dev
```

只启动 Vite 前端：

```bash
pnpm dev
```

为源码开发环境配置默认的 faster-whisper / kotoba-faster-whisper 依赖：

```bash
pnpm asr:setup
```

Parakeet、Qwen3-ASR、CPU/CUDA profile 和 sidecar HTTP API 见 [ASR 服务文档](asr-service/README.md)。

### 验证与构建

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

构建桌面包：

```bash
pnpm tauri build
```

具体到不同改动范围的验证要求、架构边界和编码规范见 [AGENTS.md](AGENTS.md)。

## 文档

- [许可证](LICENSE)：Hikaru Sub 自有源代码采用 Apache License 2.0。
- [第三方声明](THIRD_PARTY_NOTICES.md)：FFmpeg、Python、ASR 依赖和模型权重的许可证边界与发布要求。
- [领域词汇表](CONTEXT.md)：工作视频、视频会话、字幕条目、双语模式和压制等领域概念的统一含义。
- [桌面发布手册](docs/release.md)：Windows 打包、GitHub Release 和发布验证。
- [运行时依赖手册](docs/runtime-dependencies.md)：FFmpeg、Python、ASR 环境、模型、下载源与缓存管理。
- [ASR 服务文档](asr-service/README.md)：引擎行为、模型、HTTP API 和诊断日志。
- [Agent 指南](AGENTS.md)：面向 coding agents 的项目约束、架构和测试要求。

功能请求、缺陷和后续计划统一通过 [GitHub Issues](https://github.com/jason-zzx/hikaru-sub/issues) 跟踪。
