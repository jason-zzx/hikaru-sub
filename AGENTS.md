# Hikaru-Sub — Agent 指南

AI 字幕桌面应用：导入视频 → 本地 ASR 转录 → LLM 批量翻译 → 字幕校对编辑 → FFmpeg 压制。

## 技术栈

| 层级 | 选型 |
|------|------|
| 包管理 | **pnpm workspace**（根目录与 `packages/*`） |
| 桌面壳 | Tauri 2 + Rust |
| 前端 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS 4（`src/styles/index.css`） |
| 状态 | Zustand（`src/stores/`） |
| 字幕格式 | `@hikaru/ass-core`（`packages/ass-core/`） |
| ASR | Python sidecar（`asr-service/`，可插拔引擎） |
| 翻译 | OpenAI 兼容 API 适配器（前端） |
| 音视频 | 系统 FFmpeg（首期） |

## 常用命令

```bash
pnpm install
pnpm dev              # 仅 Vite 前端
pnpm tauri dev        # Tauri 桌面开发
pnpm build            # 构建前端
pnpm tauri build      # 打包桌面应用
```

**始终使用 pnpm**，不要用 npm/yarn。workspace 根目录安装依赖时加 `-w`。

## 目录结构

```
src/                          # React 前端
  components/
    layout/                   # AppLayout、Sidebar、StatusBar
    workflow/                 # 导入、转录、翻译、压制、设置
    editor/                   # 字幕编辑器
    player/                   # 视频预览 + ASS 叠加
  stores/                     # ui、project、playback、task
  services/                   # Tauri invoke 封装
  types/                      # 共享 TS 类型
src-tauri/                    # Rust 后端
  src/
    ffmpeg.rs                 # FFmpeg 检测与调用
    asr.rs                    # ASR sidecar 进程管理 + HTTP 代理
    project.rs                # .hikaru/project.json
    settings.rs               # 全局设置持久化
packages/ass-core/              # ASS 解析/序列化（workspace 包）
asr-service/                  # Python ASR sidecar（FastAPI HTTP）
  main.py                     # 入口：选端口 + uvicorn + stdout 就绪协议
  server.py                   # FastAPI 路由
  jobs.py                     # JobManager：后台线程转录 + 进度/取消
  engines/                    # AsrEngine 抽象 + faster-whisper + registry
```

## 架构边界

- **Tauri Rust**：文件 I/O、FFmpeg、启动 ASR sidecar、项目元数据
- **React**：全部 UI、ASS 文本编辑、翻译 API 调用
- **Python sidecar**：ASR 推理，通过 HTTP localhost 通信，不阻塞 UI
- **ass-core**：ASS 是唯一字幕数据交换格式；内存模型为 `SubtitleCue`，保存时展开为双语 Dialogue 行

```mermaid
flowchart LR
  Video --> FFmpeg --> ASR --> ASS --> Translate --> Editor --> Burn
```

## 核心数据模型

### 项目 `.hikaru/project.json`

与视频同目录的 `.hikaru/` 文件夹，含 `project.json`、`audio.wav`、`subtitles.ass`。

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

双语 ASS 默认：`Primary`（原文偏下）+ `Secondary`（译文偏上），同时间轴两行 Dialogue。

## Tauri Commands

| Command | 职责 |
|---------|------|
| `create_project` | 初始化 `.hikaru/project.json` |
| `open_project` | 加载已有项目 |
| `check_ffmpeg` | 检测 FFmpeg |
| `get_settings` / `set_settings` | 全局配置 |
| `extract_audio` | FFmpeg 提取 16kHz WAV + 进度事件 |
| `path_exists` | 判断文件/目录是否存在 |
| `list_asr_engines` | 列出 sidecar 已注册引擎及可用性（按需拉起 sidecar） |
| `start_asr` | 创建转录任务，返回 jobId |
| `get_asr_progress` | 轮询任务进度/片段 |
| `cancel_asr` | 取消转录任务 |
| `save_ass` / `load_ass` | ASS 读写（待实现） |
| `burn_subtitles` | FFmpeg 压制（待实现） |

新增 command 时：在 `src-tauri/src/` 实现 → `lib.rs` 注册 → `src/services/tauri.ts` 封装 → 更新 capabilities 权限。

## 编码规范

1. **最小改动**：只改与任务相关的文件，不顺手重构
2. **遵循现有风格**：命名、目录、import 路径（`@/`、`@hikaru/ass-core`）
3. **类型优先**：前后端共享概念在 `src/types/` 与 `ass-core` 保持一致
4. **不提交密钥**：API Key 走 keychain/设置，不进源码
5. **中文 UI 文案**：用户面向字符串用简体中文
6. **图标用 SVG**：UI 图标一律使用 SVG（统一放 `src/components/layout/NavIcons.tsx`，lucide 风格 `stroke="currentColor"`），不要用 emoji/字符当图标，避免跨平台字形缺失渲染成方块
7. **不编辑计划文件**：`.cursor/plans/` 下的方案文档除非用户明确要求

## 分阶段实现（当前进度）

- [x] 项目脚手架（Tauri + React + Tailwind + Zustand + pnpm workspace）
- [x] `ass-core`：ASS 解析/序列化、双语展开/合并
- [x] 项目管理 + FFmpeg 音轨提取（含 FFmpeg 捆绑/分层解析）
- [x] 导入工作流 UI（ImportView：选视频 → 建项目 → 进入转录）
- [x] 设置页 UI（SettingsView：FFmpeg/Python 路径、默认引擎、翻译 API/Key）
- [x] Python ASR sidecar（AsrEngine 抽象 + faster-whisper 适配器 + HTTP 进度 API）
- [x] 转录工作流 UI（TranscribeView：音轨提取 + 转录进度 + 生成单语 ASS cue；Rust 侧 sidecar 管理与 start_asr）
- [ ] OpenAI 兼容翻译管线 + 翻译 UI（TranslateView）
- [ ] 字幕编辑器（EditorView：列表、时间轴、播放同步、撤销重做）
- [ ] FFmpeg 压制（BurnView 输出向导）
- [ ] 错误处理、任务队列、安装脚本等整体打磨

## 首期不做

在线协作、OCR 硬字幕提取、多音轨选择、macOS 公证/商店发布。
