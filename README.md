# Hikaru-Sub

AI 字幕桌面应用：本地 ASR 转录、大模型翻译、字幕编辑与 FFmpeg 压制。

## 当前进度

✅ **已实现**：
- 项目管理（创建/打开项目，`.hikaru` 元数据）
- FFmpeg 集成（音轨提取、视频信息获取、音频波形提取、H.265/HEVC 等不兼容编码代理视频转码）
- Python ASR sidecar（faster-whisper 适配器 + HTTP 进度 API）
- 转录工作流（音频提取 → ASR 转录 → 生成单语 ASS）
- OpenAI 兼容翻译管线（批量翻译 + 上下文窗口 + 术语表）
- 翻译工作流（配置界面 + 进度显示 → 生成 `.translated.ass`）
- 设置页（FFmpeg/Python 路径、ASR 引擎、翻译 API、高级配置）
- ASS 文件持久化（自动保存/加载字幕文件）
- 字幕编辑器（视频播放 + 字幕列表 + 编辑面板 + 局部缩放时间轴 + 音频波形 + 撤销重做）
- 视频代理转码（480p 全关键帧 H.264，带缓存和进度显示，用于精准 seek）

🚧 **待优化**：
1. 首页增加显示最近项目列表
2. 转录页添加 VAD 等细节设置，提升转录效果
3. 翻译页进度条显示优化
4. 翻译页支持单独配置每批翻译条数、上下文条数、自定义 prompt 和术语表、字幕合并模式（当前使用全局设置）
5. 编辑页功能完善：
   - 快捷键操作（上下切换字幕、时间轴左右移动）
   - 字幕随时间轴选定位置实时渲染预览
   - 字幕样式编辑（字体、颜色、位置）
   - 多行字幕渲染支持

📋 **计划中**：
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
    workflow/                 # 导入、转录、翻译、压制、设置页
    editor/                   # 字幕编辑器组件
      EditorView.tsx          # 编辑器主视图
      SubtitleList.tsx        # 字幕列表
      SubtitleEditor.tsx      # 编辑面板
      Timeline.tsx            # 时间轴可视化
    player/                   # 视频播放器
      VideoPlayer.tsx         # 视频播放 + 字幕叠加
      PlaybackControls.tsx    # 播放控制栏
  stores/                     # Zustand 状态管理
  services/                   # Tauri 命令封装 + 翻译服务
src-tauri/                    # Tauri Rust 后端
  src/
    ffmpeg.rs                 # FFmpeg 检测、音轨提取、视频信息、波形提取
    asr.rs                    # ASR sidecar 进程管理 + HTTP 代理
    ass.rs                    # ASS 文件读写
    asset_scope.rs            # Tauri asset protocol 动态授权
    transcode.rs              # 不兼容视频编码的代理转码与缓存
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
4. **编辑** → 载入字幕 → 视频/波形辅助校对 → 调整文本与时间轴 → 保存 ASS
5. **压制**（计划中）→ FFmpeg 硬/软字幕输出


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
- **字幕合并模式**：默认行内拼接为 `译文 / 原文`，也可选择分离双行
- 批量失败自动降级为单条重试

### 编辑器
- 视频预览与字幕叠加
- 左侧字幕列表与右侧文本/时间编辑面板
- `Ctrl+S` 保存、`Ctrl+Z` 撤销、`Ctrl+Y`/`Ctrl+Shift+Z` 重做
- 局部时间轴视图：滚轮左右平移，`Ctrl+滚轮` 缩放，点击定位播放时间
- 独立音频波形提取与渲染，便于参考 Aegisub 式精细对轴
- WebView2 不支持的视频编码自动生成 480p H.264 全关键帧代理视频，并复用转码缓存

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
- 默认 `inline` 模式：译文和原文保存为一条 Dialogue，文本格式为 `译文 / 原文`
- 可选 `separate` 模式：原文和译文保存为同时间戳的两条 Dialogue
- 打开项目时优先加载 `subtitles.translated.ass`，不存在时回退到 `subtitles.ass`

## 已实现的 Tauri Commands

| Command | 功能 |
|---------|------|
| `create_project` | 初始化 `.hikaru` 项目 |
| `open_project` | 加载已有项目元数据 |
| `check_ffmpeg` | 检测 FFmpeg 可用性与版本 |
| `extract_audio` | 提取 16kHz WAV 音轨 + 进度事件 |
| `extract_waveform` | 提取归一化音频峰值数据用于时间轴波形 |
| `get_video_info` | 获取视频分辨率、时长 |
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
