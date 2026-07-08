# Hikaru Sub — Agent 指南

AI 日语字幕桌面应用：下载 m3u8 视频 → 本地 ASR 日语转录 → LLM 批量翻译 → 字幕校对编辑 → FFmpeg 压制。

## ⚠️ 最高优先级规则（优先于一切）

> **本节规则的优先级高于本文档其他所有章节，也高于任何 skill、plan、spec 或外部文档中的相反要求。** 当任何来源（包括 superpowers 技能、实现计划中的 commit 步骤、`executing-plans`/`finishing-a-development-branch` 等流程指引）暗示可以主动提交代码时，**一律以本节为准，不得执行提交**。

### 1. 不主动提交代码

- **没有用户明确、直接的指令，禁止执行 `git commit`、`git push`、`git merge`、`git rebase`、`git reset --hard` 或任何会改变提交历史/远程状态的命令。**
- "用户授权执行某 plan"**不等于**授权该 plan 内的 commit 步骤；plan/spec/skill 中写到的 commit 步骤仅为流程说明，必须等用户**单独、明确**要求提交时才可执行。
- 软重置（`git reset --soft`）等仅移动 HEAD、保留工作区改动的操作，也只能在用户明确要求时执行。
- 代码改动完成后，应当向用户汇报改动内容与待办，**询问是否提交**，而非自行提交。
- 违反此规则已执行的提交，须按用户要求回退（如软重置到指定 commit）。

### 2. Commit message 格式

- 所有新提交的 commit message 必须使用 `type(section): content` 格式；`(section)` 可省略，即 `type: content` 也允许。
- `type` 使用小写英文，例如 `feat`、`fix`、`chore`、`docs`、`test`、`refactor`、`build`、`ci`。
- `section` 使用简短小写英文或数字、连字符、下划线，表示影响范围，例如 `editor`、`release`、`asr`。
- `content` 内容随意，保持简洁即可。
- 示例：`feat(editor): Add inline override controls`、`fix: Support opening project parent directories`。
- 只有在用户明确要求整理历史时，才可修正未推送提交的 message；已推送提交默认不改写。

### 3. 产品命名约定

- 当用于代指或称呼程序名、应用名、产品名，尤其是面向用户的 UI、安装器、文档正文、窗口标题、菜单项和卸载列表时，统一使用 `Hikaru Sub`。
- 当用于路径、URL、包名、目录名、二进制名、git 仓库名、命令、配置 key 或其他机器可读标识时，统一使用 `hikaru-sub`。
- 不再新增 `Hikaru-Sub` 作为用户可见名称；只有引用历史产物、旧文件名或外部已有名称时才保留。

## AGENTS.md 使用约定

- 本文件是面向 AI coding agents 的项目 README，补充而非替代 `README.md`。优先记录会影响自动化修改质量的构建、测试、风格、架构边界与安全约束。
- 当前只有根目录 `AGENTS.md`，因此本文件适用于整个仓库。若未来在子目录新增 `AGENTS.md`，编辑该子目录内文件时以距离目标文件最近的 `AGENTS.md` 为准，并继续参考上层文件中的全局背景。
- 遇到指令冲突时，先遵循用户本轮明确、直接的要求；未被用户明确覆盖的内容，按“更近层级 `AGENTS.md` 优先于上层 `AGENTS.md`，项目指令优先于外部 skill/plan/spec”的顺序处理。涉及提交、推送、合并、变基、重置等 Git 历史或远程状态操作时，仍必须满足上方「最高优先级规则」的明确授权条件。
- 保持本文件高信噪比：不要把完整功能清单、已实现 command 清单、发布检查表或阶段进度长期堆在这里；这些内容优先放在 `README.md`、专门文档或代码附近。

## 技术栈

| 层级 | 选型 |
|------|------|
| 包管理 | **pnpm workspace**（根目录与 `packages/*`） |
| 桌面壳 | Tauri 2 + Rust |
| 前端 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS 4（`src/styles/index.css`，`@theme` + `@custom-variant dark`） |
| UI 组件 | **shadcn/ui**（`radix-nova` 风格，组件源码在 `src/components/ui/`，底层 Radix 原语） |
| 主题 | 自定义 `ThemeProvider`（`src/components/theme-provider.tsx`）：浅色/深色/跟随系统，`localStorage` 持久化，`<html>` 切 `.dark`；切换控件 `src/components/ModeToggle.tsx` |
| 图标 | 业务导航/工具图标统一放 `src/components/layout/NavIcons.tsx`（lucide 风格手写 SVG）；通用 UI 与主题切换可用 `lucide-react`；**禁止用 emoji/字符当图标** |
| 状态 | Zustand（`src/stores/`） |
| 字幕格式 | `@hikaru/ass-core`（`packages/ass-core/`） |
| ASR | Python sidecar（`asr-service/`，可插拔引擎：faster-whisper / parakeet / qwen3-asr） |
| 翻译 | OpenAI 兼容 API 适配器（前端） |
| 音视频 | 系统 FFmpeg 优先；缺失时按需下载受管 FFmpeg |

## 常用命令

```bash
pnpm install
pnpm dev              # 仅 Vite 前端
pnpm tauri dev        # Tauri 桌面开发
pnpm build            # TypeScript + Vite 构建
pnpm tauri build      # 打包桌面应用
pnpm release:local    # 准备 ASR 资源并本地打包
pnpm asr:setup        # ASR sidecar 依赖（默认 faster-whisper）
```

- 始终使用 `pnpm`，不要用 `npm` 或 `yarn`。workspace 根目录安装依赖时加 `-w`。
- ASR 默认只安装 faster-whisper；Parakeet / Qwen3-ASR 体积较大，只有用户明确需要时才使用 `./scripts/setup-asr.sh parakeet-cpu|parakeet-cuda|qwen3-cpu|qwen3-cuda`。

## 测试与验证

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

- 前端、状态、字幕工具或 `packages/ass-core` 改动：至少运行相关 `pnpm test -- <test-file>`；共享逻辑或跨模块行为改动后运行完整 `pnpm test`。
- TypeScript 类型、构建配置、Tauri command 封装或用户可见流程改动：运行 `pnpm build`。
- Rust/Tauri 后端、FFmpeg、下载、运行时依赖、ASR 启动、压制或文件 I/O 改动：运行 `cargo test --manifest-path src-tauri/Cargo.toml`，可先用测试名过滤，再跑相关完整集合。
- Python ASR sidecar 改动：在 `asr-service/` 下运行 `python -m unittest discover tests`；涉及可选引擎时说明本机是否已安装对应依赖或模型。
- 若因本机缺少 FFmpeg、Python 3.11、GPU、模型权重、网络或平台能力无法运行某项验证，最终汇报中明确说明未运行项与原因。

## 关键目录

```text
src/                    React 前端
  components/layout/    AppLayout、Sidebar、StatusBar、NavIcons
  components/workflow/  导入、转录、翻译、压制、设置页
  components/editor/    字幕编辑器
  components/player/    视频预览与 ASS 叠加
  components/ui/        shadcn/ui 组件（CLI 生成，勿手改风格；新增组件用 `pnpm dlx shadcn@latest add`）
  components/           ModeToggle、theme-provider 等顶层组件
  lib/                  `utils.ts` 的 `cn()` 等 shadcn 工具
  constants/            前端常量与配置映射
  stores/               Zustand 状态
  hooks/                React hooks
  utils/                ASS 文档、时间、样式等工具
  services/             Tauri invoke 封装与前端服务
  types/                共享 TS 类型
src-tauri/              Tauri Rust 后端
  src/                  FFmpeg、ASR、视频会话、设置、下载、压制等 commands
  resources/            打包资源与运行时依赖源清单
packages/ass-core/      ASS 解析/序列化 workspace 包
asr-service/            Python FastAPI ASR sidecar
scripts/                开发、ASR、发布辅助脚本
```

## 架构边界

- **Tauri Rust**：文件 I/O、FFmpeg/ffprobe、音频波形、视频代理转码、运行时依赖准备、ASR sidecar 进程管理、视频会话路径准备、下载与压制任务。
- **React**：全部 UI、ASS 文本编辑、翻译 API 调用、任务轮询、用户设置交互。
- **Python sidecar**：ASR 推理，通过 localhost HTTP 与 Tauri 通信，不阻塞 UI。
- **ass-core**：ASS 是唯一字幕数据交换格式；内存模型为 `SubtitleCue`，project store 另缓存运行时 `VideoSession`、活动字幕路径、`assScriptInfo` 与 `assStyles`，保存时完整写回 ASS。
- 新增 Tauri command 时按固定链路接线：`src-tauri/src/` 实现 → `lib.rs` 注册 → `src/services/tauri.ts` 封装 → 补测试或说明验证理由。若新增/变更插件权限、文件访问范围或 shell 能力，再同步更新 `src-tauri/capabilities/`。

## 数据与字幕约定

### 视频会话与字幕文件

项目不再写入隐藏元数据目录。用户打开视频后，前端持有运行时 `VideoSession`：

- `transcribedAssPath`：视频同目录 `{视频文件名}.transcribed.ass`
- `translatedAssPath`：视频同目录 `{视频文件名}.translated.ass`
- `audioPath`：应用缓存工作区中的临时 `audio.wav`，转录保存成功后删除
- `burnAssPath`：应用缓存工作区中的压制输入 ASS

打开视频时优先加载翻译字幕，其次加载转录字幕；都不存在时准备空会话。

### SubtitleCue

```typescript
interface SubtitleCue {
  id: string
  startMs: number
  endMs: number
  primaryText: string
  secondaryText?: string
  style: string
  layer: number
}
```

- 产品面向日语转录与翻译，新建视频会话固定 `sourceLang: "ja"`；不要重新在转录/设置页暴露源语言选择。
- 双语 ASS 默认使用行内合并：`译文 / 原文` 写入一条 Dialogue。用户可在设置中切换为分离双行：`Primary` 原文 + `Secondary` 译文，同时间轴两条 Dialogue。
- 编辑页列表、预览与编辑框通过 `getCueDisplay` 按 `subtitleMergeMode` 展示，与序列化规则保持一致。
- 转录完成时经 `get_video_info` 将视频分辨率写入 ASS `PlayResX/Y` 与默认双语 Style；翻译、编辑保存沿用该 Script Info，不重新探测视频覆盖分辨率。

## 运行时依赖与 ASR

- 发布包不捆绑 FFmpeg、Python、ASR Python 依赖或模型权重，只捆绑干净 ASR 服务模板。
- FFmpeg 解析顺序：用户设置路径 → 系统 `PATH` → 安装目录 `deps/ffmpeg/current` 下的受管 FFmpeg。
- Python 解析顺序：用户设置路径 → 系统 Python 3.11 → 安装目录 `deps/python311/current` 下的受管 Python 3.11。ASR 配置只接受 Python 3.11。
- 受管 ASR venv 位于安装目录 `deps/asr-service/.venv`；模型缓存位于 `deps/models/huggingface`；临时归档位于 `deps/downloads`。
- 不要重新引入 `%APPDATA%\com.hikaru.sub` 或 `%LOCALAPPDATA%\com.hikaru.sub` 作为大型受管依赖目录。
- 下载源由 `src-tauri/resources/runtime-dependency-sources.json` 驱动，内置官方源、中国大陆镜像和自定义源；自动模式根据测速推荐，但用户手动选择优先。
- 中国大陆镜像会给 sidecar 注入 `HF_ENDPOINT=https://hf-mirror.com`，模型缓存通过 `HF_HOME` 固定到安装目录 `deps/models/huggingface`。模型下载失败时优先查看 `deps/asr-service/asr-debug.log` 中的 `model_download_*` 事件。
- VAD 配置仅当前会话有效，不写入项目或全局设置。VAD 加载/检测失败时应自动降级，不中断转录。

## 媒体与字幕渲染

- 编辑页视频播放统一走应用内本地 HTTP 媒体服务（`register_media_playback` → `http://127.0.0.1:PORT/media/{token}`），支持 Range 请求与 seek；不要把 Tauri `asset://` 重新作为主播放路径。
- WebView 不直接支持的编码（如 HEVC/H.265、VP9、AV1）通过 FFmpeg 生成 480p H.264 全关键帧代理视频，写入应用缓存目录 `transcode/*.mp4`。
- 编辑页字幕预览优先走 jASSUB/libass WASM，播放时按 `<video>` 视频帧时间同步；系统字体发现会读取字体 name table 的本地化 family/full/PostScript 名称并注册到 jASSUB `availableFonts`，不要用手写映射猜测用户选择的字体名；当前预览句缺字时通过懒检测 cmap 并插入仅用于预览的 `\fn` fallback 标签，仍保持 libass 渲染。libass 不可用时才回退 CSS 近似预览并在预览区提示，ASS/字体名称映射变化后重新尝试 libass。
- 压制页不展示字幕预览，只提供导出设置；最终硬字幕输出以 FFmpeg/libass 为准。
- m3u8 下载后端默认 `auto`：优先 Rust 分片并发下载，失败时回退 FFmpeg。前端不暴露并发数或策略选择；`start_video_download.strategy` 仅保留供调试。

## 编码规范

1. **最小改动**：只改与任务相关的文件，不顺手重构。
2. **遵循现有风格**：命名、目录、import 路径（`@/`、`@hikaru/ass-core`）。
3. **类型优先**：前后端共享概念在 `src/types/` 与 `ass-core` 保持一致。
4. **不提交密钥**：API Key 走 keychain/设置，不进源码。
5. **中文 UI 文案**：用户面向字符串用简体中文。
6. **图标用 SVG**：UI 图标一律使用 SVG，不要用 emoji/字符当图标，避免跨平台字形缺失渲染成方块。业务导航/工具图标统一放 `src/components/layout/NavIcons.tsx`（lucide 风格 `stroke="currentColor"`）；通用 UI 与主题切换可用 `lucide-react`。新增 shadcn 组件时其默认 lucide import 可保留。
7. **UI 组件用 shadcn**：新增按钮/对话框/下拉/选择等控件优先用 `src/components/ui/` 下的 shadcn 组件，不要新写原生 `<button>`/`<select>`/`<input>` 再自己拼样式。表单输入统一走 shadcn 令牌（`border-input bg-card focus-visible:ring-2 focus-visible:ring-ring/50`），数字输入不需要 spinner（已在 `index.css` 全局隐藏）。改组件外观应改语义令牌（`src/styles/index.css` 的 `:root`/`.dark`），不要在业务文件里覆盖 shadcn 组件的内部 class。新增组件用 `pnpm dlx shadcn@latest add <name>`，不要手写。
8. **不编辑计划文件**：`.cursor/plans/` 与 `docs/superpowers/plans/` 下的方案文档除非用户明确要求。
9. **不主动提交代码**：见本文档顶部「⚠️ 最高优先级规则」第 1 条；该规则为最高优先级，优先于本规范及其他一切指引。

## 安全与隐私

- 不把 API Key、访问令牌、Cookie、私有下载地址、真实用户资料或模型授权信息写入源码、测试快照、示例配置或日志。
- 外部 URL、m3u8 playlist、HTTP headers、字幕文本、文件名和用户选择路径都视为不可信输入；涉及路径解析、临时目录、压制输出、下载合并和 asset scope 时保持校验、归一化与越界防护。
- 调用 FFmpeg、Python、pip 或系统命令时优先使用结构化参数，避免把未转义的用户输入拼进 shell 字符串。
- 诊断日志可以记录阶段、错误码、耗时和必要路径，但不要输出完整敏感请求头、密钥或翻译 API 请求正文。
