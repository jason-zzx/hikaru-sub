# 设计：最近工作视频与首页续接

## 总览

全部改动在前端（React/TS），无 Rust、无 capabilities 变更。三个新增生产模块 + 两处重构复用。

## 1. 最近列表存储 `src/services/recentVideos.ts`（新增）

- 载体：**localStorage**（key `hikaru-sub:recent-videos`）。与 ThemeProvider、editorPaneLayout 同一持久化方式；portable 模式下 WebView2 数据目录在 `<exe>/webview`，跟随绿色版迁移。不进 `settings.json`，避免 Rust 改动。
- 条目（在记录时从 `VideoSession` 快照派生路径，首页渲染时无需再推导）：

```ts
interface RecentVideoEntry {
  videoPath: string;
  transcribedAssPath: string;
  translatedAssPath: string;
  lastOpenedAt: number; // epoch ms
}
```

- API：`listRecentVideos()`（解析失败 → 空数组）、`recordRecentVideo(session)`（按 videoPath 去重、unshift、截断 10 条）、`removeRecentVideo(videoPath)`。
- 测试：参考现有 localStorage 相关测试写法，覆盖去重/截断/损坏 JSON/移除。

## 2. 共享打开流程 `src/services/openVideo.ts`（新增，自 ImportView 提取）

```ts
type OpenVideoResult =
  | {
      ok: true;
      hasSubtitleDocument: boolean;
      recovery: RecoveryRestoreResult;
    }
  | { ok: false; cancelled: true }
  | { ok: false; changed: true }
  | { ok: false; error: string };

async function openVideoSession(videoPath: string): Promise<OpenVideoResult>
```

`hasSubtitleDocument` 是打开后导航的唯一依据：同目录字幕加载成功或恢复快照成功均为 `true`。字幕种类只在共享流程内部用于 translated → transcribed 回退，不暴露为结果字段。

流程：捕获 `captureProjectDocumentGuard` → `confirmDiscardUnsavedChanges` → `prepareVideoSession` → guard 仍有效时才执行 `withDiscardedSubtitleRecovery` + `setSession` → 优先加载 translated、其次 transcribed（`parseAss(..., { mergeBilingual: false })`）→ `restoreSubtitleRecovery(session)` → 成功后 `recordRecentVideo(session)`。准备视频和读取 ASS 的异步边界前后由共享流程检查 guard；恢复服务在内部为当前 session 捕获自己的 document guard，并在文件读取、确认和写入边界检查。当前文档或会话已变化时返回 `{ ok: false, changed: true }`，不得用过期结果覆盖新编辑或新会话。

- `ImportView.handleSelectVideo` 改为调用它，保留自身的 pick/busy/error 展示；行为不变。
- 外部字幕导入编排（EditorView 中 `handleSelectSubtitleFile` 的核心：确认 → `loadAssText` + `getVideoInfo` → `parseExternalSubtitleDocument` → `loadAssDocument({kind:"translated", path:null})` + `markDirty`）提取为同文件内 `importExternalSubtitle(videoPath, subtitlePath)`，EditorView 与拖放 hook 共用；EditorView 保留 seek/notify 等 UI 逻辑。

## 3. WelcomeView 改造

保持现有四卡片不动，下方新增两个区块：

- **继续当前工作**（`projectStore.session` 存在时）：文件名 + 下一步按钮。可见性用 `pathExists` 在挂载时查一次（session.transcribedAssPath / translatedAssPath）；已载入字幕文档时直接进入编辑器，仅磁盘字幕存在时先调用 `openVideoSession` 完成加载再进入编辑器，完全无字幕时显示 `开始转录`。
- **最近打开**（列表非空时）：每行 = 文件名、父目录路径（较小弱化文本，单行 `truncate`，`title` 保留完整视频路径）、相对时间（手写 `formatRelativeTime`，复用现有时间工具风格，不引库）、`已转录`/`已翻译` 状态标记（挂载时对条目内存储路径 `pathExists`）、移除按钮。点击行 → `openVideoSession(entry.videoPath)` → 成功则按 `hasSubtitleDocument` 跳转 editor / transcribe；视频不存在、打开失败或异步期间文档已变化时用 `@tauri-apps/plugin-dialog` 的 `message()` 提示（沿用 confirmDiscardUnsavedChanges 的原生对话框模式，不新增 toast 体系）。

## 4. 全局拖放 `src/hooks/useGlobalFileDrop.ts`（新增，AppLayout 挂载）

- `getCurrentWindow().onDragDropEvent`，仅处理 `drop`，取 `payload.paths` 第一个可识别项。监听注册是异步的：effect 清理必须标记 disposed，旧回调先检查 disposed；注册晚于卸载完成时立即调用返回的 unlisten，避免 React StrictMode 的短暂重复处理与遗留监听。
- 按扩展名分类（视频扩展名列表从 `tauri.ts` 导出复用；字幕 ass/srt）：
  - 视频 → `openVideoSession` → 成功按 `hasSubtitleDocument` 跳转（editor / transcribe）。
  - ass/srt → 有 session：`importExternalSubtitle` → 选中并 seek 第一条 cue → `setStep("editor")`；无 session：`message("请先导入视频再拖入字幕文件")`。
  - 其他扩展名：忽略。
- 错误统一 `message()` 提示。Tauri 2 默认 `dragDropEnabled: true`，配置无需改。

## 关键决策记录

| 决策点 | 选择 | 理由 |
|---|---|---|
| 最近列表存储 | localStorage | 与现有持久化一致、零 Rust 改动、portable 跟随 |
| 字幕存在性判定 | 记录时快照派生路径 + 渲染时 pathExists | 避免前端重复实现 Rust 命名规则（canonicalize/stem） |
| SRT 拖放 | 支持 | `parseExternalSubtitleDocument` 已支持 SRT，零额外解析器成本 |
| 错误提示 | 原生 `message()` 对话框 | 项目无全局 toast；不为本特性新增通知体系 |
| 打开后跳转 | `hasSubtitleDocument` → editor，否则 transcribe | 同目录字幕与恢复快照统一判断；导入页维持现状不跳转 |

## 兼容性 / 回滚

- 纯新增 + 两处行为等价重构；localStorage 数据失败即空列表，无迁移负担。
- 回滚 = 还原 WelcomeView / ImportView / EditorView / AppLayout，删除 3 个新文件。
