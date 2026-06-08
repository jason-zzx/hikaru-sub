# Hikaru-Sub

AI 字幕桌面应用：本地 ASR 转录、大模型翻译、字幕编辑与 FFmpeg 压制。

## 技术栈

- **桌面**: Tauri 2 + Rust
- **前端**: React 19 + TypeScript + Vite
- **样式**: Tailwind CSS 4
- **状态**: Zustand
- **包管理**: pnpm workspace

## 环境要求

- Node.js 20+
- pnpm 10+
- Rust（[安装指南](https://www.rust-lang.org/learn/get-started)）
- Linux / WSL2 额外依赖：[Tauri prerequisites](https://tauri.app/start/prerequisites/)
- FFmpeg（PATH 或可配置路径）
- Python 3.10+（ASR sidecar，后续阶段）

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
src/                 React 前端
src-tauri/           Tauri Rust 后端
packages/ass-core/   ASS 字幕解析库（workspace）
asr-service/         Python ASR sidecar（后续）
```

## 工作流

1. 导入视频 → 2. ASR 转录 → 3. AI 翻译 → 4. 字幕校对 → 5. 一键压制
