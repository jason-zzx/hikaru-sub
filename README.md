# Hikaru-Sub

AI 字幕桌面应用：本地 ASR 转录、大模型翻译、字幕编辑与 FFmpeg 压制。

## 当前进度

✅ **已实现**：
- 项目管理（创建/打开项目，`.hikaru` 元数据）
- FFmpeg 集成（音轨提取、视频信息获取）
- Python ASR sidecar（faster-whisper 适配器 + HTTP 进度 API）
- 转录工作流（音频提取 → ASR 转录 → 生成单语 ASS）
- OpenAI 兼容翻译管线（批量翻译 + 上下文窗口 + 术语表）
- 翻译工作流（配置界面 + 进度显示 → 生成双语 ASS）
- 设置页（FFmpeg/Python 路径、ASR 引擎、翻译 API、高级配置）
- ASS 文件持久化（自动保存/加载字幕文件）

🚧 **进行中**：
- 字幕编辑器（列表、时间轴、播放同步、撤销重做）
- FFmpeg 压制（硬/软字幕输出向导）

## 技术栈

- **桌面**: Tauri 2 + Rust
- **前端**: React 19 + TypeScript + Vite
- **样式**: Tailwind CSS 4
- **状态**: Zustand
- **包管理**: pnpm workspace
- **ASR**: Python sidecar（faster-whisper）
- **翻译**: OpenAI 兼容 API 适配器

## 环境要求

- Node.js 20+
- pnpm 10+
- Rust（[安装指南](https://www.rust-lang.org/learn/get-started)）
- FFmpeg（PATH 或可配置路径）
- Python 3.10+（ASR sidecar）
- 可选：CUDA（faster-whisper GPU 加速）

## 开发

```bash
pnpm install
pnpm dev          # 仅前端
pnpm tauri dev    # 桌面开发模式
pnpm build        # 构建前端
pnpm tauri build  # 打包应用
```

## 项目结构

```
src/                          # React 前端
  components/
    layout/                   # 布局、侧边栏、状态栏
    workflow/                 # 导入、转录、翻译、设置页
    editor/                   # 字幕编辑器（待实现）
    player/                   # 视频预览（待实现）
  stores/                     # Zustand 状态管理
  services/                   # Tauri 命令封装 + 翻译服务
src-tauri/                    # Tauri Rust 后端
  src/
    ffmpeg.rs                 # FFmpeg 检测、音轨提取、视频信息
    asr.rs                    # ASR sidecar 进程管理 + HTTP 代理
    ass.rs                    # ASS 文件读写
    project.rs                # 项目元数据管理
    settings.rs               # 全局设置持久化
packages/ass-core/            # ASS 解析/序列化库（workspace）
asr-service/                  # Python ASR sidecar
  main.py                     # FastAPI HTTP 服务
  server.py                   # 路由定义
  jobs.py                     # 后台转录任务管理
  engines/                    # ASR 引擎抽象与实现
```

## 工作流

1. **导入视频** → 创建 `.hikaru` 项目目录
2. **转录** → 提取音轨 → faster-whisper 转录 → 生成单语 ASS
3. **翻译** → OpenAI 兼容 API 批量翻译 → 生成双语 ASS（`.translated.ass`）
4. **编辑**（待实现）→ 字幕校对、时间轴调整
5. **压制**（待实现）→ FFmpeg 硬/软字幕输出


## 核心功能

### 转录配置
- 引擎选择：faster-whisper（支持 CPU/CUDA/auto）
- 模型选择：tiny/base/small/medium/large-v2/large-v3
- 自动模型下载与 CUDA 回退
- 实时进度显示与任务取消

### 翻译配置
- OpenAI 兼容 API（支持 OpenAI、DeepSeek、Ollama 等）
- **批量翻译条数**（5-50，默认 25）：控制每次 API 请求的字幕数量
- **上下文窗口**（1-10，默认 2）：每批前后附加参考字幕，提高术语一致性
- **自定义 Prompt**：附加在系统提示词后的额外要求
- **术语表 Glossary**：强制特定词汇译法（格式：`原文 -> 译文`）
- 批量失败自动降级为单条重试

### 文件管理
- **项目元数据**：`.hikaru/project.json`（与视频同目录）
- **转录字幕**：`subtitles.ass`（单语原文）
- **翻译字幕**：`subtitles.translated.ass`（双语字幕）
- **音频缓存**：`audio.wav`（16kHz 单声道 WAV）

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
- 每条时间轴生成两行 Dialogue（同时间戳），兼容所有 ASS 播放器

## 已实现的 Tauri Commands

| Command | 功能 |
|---------|------|
| `create_project` | 初始化 `.hikaru` 项目 |
| `open_project` | 加载已有项目元数据 |
| `check_ffmpeg` | 检测 FFmpeg 可用性与版本 |
| `extract_audio` | 提取 16kHz WAV 音轨 + 进度事件 |
| `get_video_info` | 获取视频分辨率、时长 |
| `list_asr_engines` | 列出 ASR sidecar 可用引擎 |
| `start_asr` | 启动转录任务 |
| `get_asr_progress` | 获取转录进度与片段 |
| `cancel_asr` | 取消转录任务 |
| `save_ass_text` | 保存 ASS 文本到文件 |
| `load_ass_text` | 加载 ASS 文件内容 |
| `get_settings` / `set_settings` | 全局配置读写 |
