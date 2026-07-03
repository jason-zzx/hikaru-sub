# 编辑页快捷键体系设计

- 日期：2026-07-02
- 状态：设计已与用户逐节确认，待编写实现计划
- 对应 README 待优化项：「编辑页功能完善：快捷键操作（上下切换字幕、时间轴左右移动）」

## 背景与目标

编辑页目前仅有 `Ctrl+S/Z/Y` 三个全局快捷键（`EditorView.tsx` 单个 `useEffect` 监听）与时间轴滚轮操作，无法支撑 Aegisub 式的键盘校对工作流。本设计建立完整的快捷键体系：字幕导航、播放头控制、对轴打点、编辑操作，以及统一的焦点感知分发层。

同时修复现存 bug：全局 `Ctrl+Z` 监听无焦点判断，在文本框内打字时按 `Ctrl+Z` 会拦截浏览器原生文本撤销、直接回滚整个字幕列表数据。

### 范围（本期 = 清单 A+B+C）

- A. 字幕导航与播放快捷键
- B. 对轴快捷键（打点、边界跳转、逐帧步进）
- C. 编辑操作快捷键 + 焦点感知分发基础设施 + 键位速查浮层

### 明确不做（已与用户确认）

| 项目 | 去向 |
|------|------|
| D. 样式可视化编辑 GUI | 二期 |
| F. 细节修缮（时间输入校验、alert/confirm 换 toast、新建 id 撞车） | 二期 |
| E. 行内标签插入按钮 GUI（Aegisub 式 B/I 按钮） | 三期 |
| 标签字面显示（`{\b1}` 在列表/编辑框原样展示） | 已天然实现，无需立项 |
| `Ctrl+M` 合并字幕、光标处拆分字幕 | 不做 / 二期再议 |
| 字幕开始/结束时间的键盘微调（±100ms 类） | 不做（对轴靠打点完成） |
| 步长可配置、键位自定义 | 不做（键位表写死） |

## 架构（已确认：方案 1 集中式自建）

单一 `keydown` 分发器 + 声明式键位表 + 纯函数动作层。不引入第三方快捷键库。

### 新增模块

| 文件 | 职责 |
|------|------|
| `src/components/editor/hotkeys.ts` | 声明式键位表：`{ combo, scope, actionId, description }[]`；scope ∈ `global`（框内外都生效）/ `outside-input`（仅焦点不在输入框时）/ `inside-input`（仅输入框内）；速查浮层直接消费这份数据 |
| `src/hooks/useEditorHotkeys.ts` | 分发器 hook，挂在 EditorView（进入编辑页注册 window keydown，离开卸载）：combo 匹配 → 作用域过滤 → IME 保护 → 执行动作并 `preventDefault` |
| `src/services/editorActions.ts` | 纯函数动作层，只依赖入参不碰 store：`selectAdjacentCue(cues, selectedId, offset)`、`findSubtitleBoundary(cues, currentMs, direction)`（收集全部 cue 的 start/end 排序去重后二分）、`frameStepTarget(currentMs, fps, frames)` 等 |
| `src/components/editor/HotkeyHelpOverlay.tsx` | `?` 呼出的键位速查浮层，列出键位表全部条目 |

### 焦点与 IME 规则（分发器统一实现）

- `isEditableTarget(target)`：`<input>`、`<textarea>`、`contentEditable` 视为「框内」。
- `e.isComposing === true` 时一律不处理（日文/中文 IME 组词期间 Enter 确认候选、方向键选字不得被拦截）。
- 匹配成功才 `preventDefault`；未匹配的按键完全放行。

### Store 改动

- `playbackStore` 新增：
  - `fps: number | null`：视频加载时获取；null 时前端按 30fps 回退计算。
  - `playUntilMs: number | null`：R 键「播放当前句」的自动停止点。
- `projectStore`：无改动（`updateCue` / `addCue` / `deleteCue` 已够用；撤销历史机制不变）。

### Rust 改动（唯一后端改动）

`get_video_info` 的 `VideoInfo` 补 `fps` 字段：解析 ffprobe `r_frame_rate`，失败回退 `avg_frame_rate`，再失败返回 null。前端 `src/types` 的 `VideoInfo` 同步。fps 始终按**原片路径**探测（代理转码不改帧率）。

### 组件改动

- `EditorView.tsx`：删除现有快捷键 `useEffect`，改用 `useEditorHotkeys()`；挂载速查浮层。
- `SubtitleEditor.tsx`：草稿提交模型改造（见行为决策 1）；`Enter` / `Shift+Enter` / `Esc` 处理。
- `VideoPlayer.tsx`：`timeupdate` 中检查 `playUntilMs` 到点自动暂停；视频加载时调 `get_video_info` 将 fps 写入 playbackStore。
- `PlaybackControls.tsx`：按钮 title 补充快捷键标注（顺带，不改行为）。
- `SubtitleList.tsx`：无改动（选中项滚动跟随已实现）。

## 键位表（v2 最终版）

### 导航与选择

| 按键 | 作用域 | 动作 |
|------|--------|------|
| `↑` / `↓` | 框外 | 选中上一条/下一条字幕，视频 seek 到其起点（与点击列表一致） |
| `Alt+↑` / `Alt+↓` | 全局 | 同上（手不离编辑框切句） |
| `Home` / `End` | 框外 | 跳到第一条/最后一条 |
| `PgUp` / `PgDn` | 框外 | 向上/向下跳 10 条 |

### 播放头控制（与 Aegisub 一致：方向键组只操作播放头）

| 按键 | 作用域 | 动作 |
|------|--------|------|
| `空格` | 框外 | 播放/暂停 |
| `←` / `→` | 框外 | 上一帧/下一帧（按视频实际 fps；帧中心对齐） |
| `Alt+←` / `Alt+→` | 框外 | 快速跳帧 ±10 帧（Aegisub「fast jump step」默认值） |
| `Ctrl+←` / `Ctrl+→` | 框外 | 跳至上一个/下一个字幕边界（全部 cue 的开始/结束时间点；只动播放头，不改选中） |
| `R` | 框外 | 播放当前字幕段：seek 到选中 cue 起点，播到终点自动暂停；播放中再按 = 中断 |

### 对轴打点

| 按键 | 作用域 | 动作 |
|------|--------|------|
| `Ctrl+3` | 全局 | 当前播放位置写入选中字幕**开始时间**（Aegisub 习惯） |
| `Ctrl+4` | 全局 | 当前播放位置写入选中字幕**结束时间** |

### 编辑操作

| 按键 | 作用域 | 动作 |
|------|--------|------|
| `Enter` | 框内 | 提交当前编辑并跳到下一条；**在最后一条时追加新行**（见行为决策 2） |
| `Shift+Enter` | 框内 | 插入换行 |
| `Esc` | 框内 | 放弃未提交草稿，恢复为 store 当前值并失焦 |
| `Insert` | 框外 | 在播放头位置新建字幕（沿用现有新建参数：时长 2s、占位文本「新建字幕」、`Primary` 样式），并新增自动选中 + 聚焦编辑框 |
| `Delete` | 框外 | 删除选中字幕，不弹确认（`Ctrl+Z` 可恢复） |

### 系统

| 按键 | 作用域 | 动作 |
|------|--------|------|
| `Ctrl+S` | 全局 | 保存 |
| `Ctrl+Z` / `Ctrl+Y`（含 `Ctrl+Shift+Z`） | 框外 | 撤销/重做；框内不拦截，放行浏览器原生文本撤销（修复现有 bug） |
| `?` | 框外 | 键位速查浮层（`e.key === "?"`，即 Shift+/） |

## 关键行为决策

1. **草稿提交模型改造**（SubtitleEditor 唯一实质重构）：现状是草稿同步 `useEffect` 依赖 `selectedCue` 对象引用，`Ctrl+3/4` 打点更新 cue 后草稿文本会被覆盖丢失。改为**文本草稿仅在 `selectedCue.id` 变化时重置，时间字段实时跟随 store 值**——打点后时间框即时刷新、文本草稿保留。
2. **Enter 在最后一条追加新行**：start = 当前 cue 的 `endMs`，end = start + 2000ms，文本为空，`style` / `layer` 继承当前 cue，id 用 ass-core `createId()`；自动选中新行、seek 到其起点、编辑框保持聚焦（`addCue` 按 startMs 排序，追加行自然落在末尾）。
3. **`Delete` 键删除不弹 confirm**（撤销可恢复）；编辑面板上的删除按钮暂保留原 `confirm()`，二期 F 统一换 toast 时一并处理。
4. **打点不做时间合法性拦截**：`Ctrl+4` 打在开始时间之前也照写（与 Aegisub 一致），异常区间在时间轴上可见，由用户自行修正。
5. **播放当前句**：R → seek 到起点 + `playUntilMs = endMs` + 播放；`timeupdate` 到点自动暂停并清除；播放中再按 R、手动暂停、切换选中项均清除 `playUntilMs`。
6. **逐帧 seek 取帧中心**：`targetMs = (floor(currentMs × fps / 1000) + n + 0.5) × 1000 / fps`，避免落在帧边界上的显示抖动；用 floor 不用 round，确保从帧中心位置步进时恰好落在相邻帧中心（round 会导致前进跳一帧、后退卡原地）；结果 clamp 到 `[0, durationMs]`。
7. **空态 no-op**：无选中 cue 或无字幕时，R、打点、`Delete`、`Enter` 跳转等动作静默不执行，不报错。
8. **播放中手动导航自洽**：`↑/↓` 切换会 seek 到目标 cue 起点，播放中 `timeupdate` 的自动选中逻辑（仅播放时启用）随之选中同一条，无冲突。

## 数据流

```
window keydown
  → useEditorHotkeys（combo 匹配 + scope 过滤 + isComposing 保护）
  → editorActions 纯函数计算目标（新选中 id / 目标时间 / 新 cue）
  → playbackStore / projectStore 更新
  → 现有组件响应（列表滚动跟随、VideoPlayer seek、libass 预览刷新）
```

## 边界情况

- fps 探测失败（null）：按 30fps 回退，仅影响帧步进粒度，不阻塞其他功能。
- 撤销后 `selectedCueId` 指向已删除 cue：现有 `find` 返回 undefined、面板显示「未选中」，自愈，无需处理。
- 字幕边界跳转在首/末边界之外：clamp 到最近边界；无字幕时 no-op。
- `Alt+←` 在 WebView 可能触发历史后退：匹配成功即 `preventDefault`，编辑页为 SPA 无路由历史，风险可忽略。
- 播放头恰好等于边界时间点：边界跳转需严格 `<` / `>` 比较（±1ms 容差），避免原地踏步。

## 测试策略

沿用现有 vitest：

- `editorActions` 纯函数单测：相邻选择（首尾边界、空列表）、字幕边界跳转（重叠 cue、正好落在边界上）、帧步进计算（23.976fps、fps=null 回退）。
- 分发器单测：combo 匹配、三种 scope 过滤（模拟焦点在 textarea 内外）、`isComposing` 跳过、未匹配按键不 `preventDefault`。
- SubtitleEditor 草稿模型测试：切换 id 重置草稿、打点后时间跟随而文本不丢、Enter 提交并跳转、最后一条 Enter 追加行参数、Esc 恢复。

## 文件清单

新增：

- `src/components/editor/hotkeys.ts`
- `src/hooks/useEditorHotkeys.ts`
- `src/services/editorActions.ts`
- `src/components/editor/HotkeyHelpOverlay.tsx`
- 对应测试文件

修改：

- `src/components/editor/EditorView.tsx`（移除旧快捷键 effect）
- `src/components/editor/SubtitleEditor.tsx`（草稿模型 + Enter/Esc）
- `src/components/player/VideoPlayer.tsx`（playUntilMs 自动停 + fps 获取）
- `src/components/player/PlaybackControls.tsx`（title 标注）
- `src/stores/playbackStore.ts`（fps、playUntilMs）
- `src-tauri/src/ffmpeg.rs`（VideoInfo.fps）
- `src/types/index.ts`（VideoInfo.fps）
