# 编辑页 Phase 2B：细节修缮与反馈收口

- 日期：2026-07-04
- 状态：已按当前实现行为同步，验证中
- 来源：
  - Phase 2A 留待后续项：保存状态指示器、时间输入严格校验、cue id 去重、删除按钮移除 confirm
  - 快捷键设计二期 F：时间输入校验、`alert` / `confirm` 换轻量反馈、新建 id 撞车处理

## 背景与目标

编辑页一期与 Phase 2A 已覆盖快捷键、样式选择、快速 ASS 标签、样式库抽屉等核心能力，但仍有几处会影响日常校对手感的粗糙点：

- 保存成功/失败依赖浏览器原生 `alert()`，会打断编辑工作流。
- 编辑面板删除按钮仍使用 `confirm()`；快捷键 Delete 已经是直接删除且可撤销，两者行为不一致。
- 时间输入解析失败时会回退到 `0ms`，误操作风险高。
- 新建字幕直接使用 `createId()`，没有在 `addCue` 前检查 id 撞车。
- 编辑页只有右下角临时「未保存」悬浮提示，缺少稳定的顶部保存状态。

本期目标是把这些细节收口成一致、可测试、不中断输入的编辑体验。

## 范围（完整 Phase 2B）

**本期实现**：

- 编辑页顶部保存状态：显示「已保存」/「未保存」/「保存中…」/「保存失败」
- 时间输入归一化：采用 Aegisub 式固定掩码输入，数字覆盖当前槽位，删除键只移动光标；分钟/秒溢出自动进位，倒序区间自动钳平，不用错误提示打断输入
- cue id 去重：所有新增字幕在 `addCue` 前检查现有 id，最多重试 3 次
- 删除按钮移除 `confirm()`：直接删除，依赖现有撤销/重做恢复
- 编辑页轻量反馈：保存失败、删除、新建 id 失败使用 `EditorToast`；保存成功只回到顶部「已保存」状态，不再用 `alert()` / `confirm()`

**明确不做**：

- 不做自动保存。
- 不引入全局通知系统；本期只做编辑页局部反馈。
- 不新增撤销 toast 按钮；删除后的恢复继续使用现有 `Ctrl+Z` / 播放控制栏撤销按钮。
- 不改变快捷键设计中「打点不拦截异常区间」的决策；`Ctrl+3/4` 仍可写入任意当前播放时间。
- 不重构 `projectStore` 的撤销模型；样式撤销、跨模块任务队列等留给后续整体打磨。

## 架构

采用“小型工具层 + 轻量 UI 接入”的方案，避免把校验和反馈逻辑继续堆在 `SubtitleEditor.tsx` 中。

### 新增模块

| 文件 | 职责 |
|------|------|
| `src/utils/timeInput.ts` | Aegisub 式时间掩码输入、10ms 精度格式化、溢出进位与区间归一化 |
| `src/components/editor/EditorToast.tsx` | 编辑页局部轻量反馈组件，支持 success / error / info |

### 修改模块

| 文件 | 改动 |
|------|------|
| `src/services/editorActions.ts` | 新增唯一 id 生成包装、删除后邻近选择纯函数 |
| `src/hooks/useEditorHotkeys.ts` | Insert / Delete 接入唯一 id 与删除反馈；options 增加 `onNotify` |
| `src/components/editor/EditorView.tsx` | 顶部保存状态、toast 状态、保存时移除 `alert()` |
| `src/components/editor/SubtitleEditor.tsx` | 接入 Aegisub 式 10ms 精度时间输入、唯一 id 新建、删除按钮直接删除、接收 `onNotify` |
| `src/components/editor/SubtitleList.tsx` | 左侧字幕列表开始/结束时间显示保持 10ms 精度 |
| `tests/SubtitleEditorBehavior.test.ts` | 删除旧的 confirm 断言，改为禁止 `confirm(` |
| `src/services/editorActions.test.ts` | 覆盖唯一 id 重试与删除后选择 |
| `src/utils/timeInput.test.ts` | 覆盖时间掩码键盘行为、溢出进位、倒序钳平与 10ms 精度格式化 |
| `tests/SubtitleListBehavior.test.ts` | 覆盖左侧字幕列表使用 10ms 精度时间显示 |

### 数据流

```
用户编辑时间 / 新建 / 删除 / 保存
  → timeInput.ts 或 editorActions.ts 纯函数处理
  → SubtitleEditor / useEditorHotkeys / EditorView 调用 store action
  → EditorView 统一展示顶部保存状态与 EditorToast
  → 现有 isDirty、撤销栈、libass 预览继续响应 store 变化
```

## 详细设计

### 一、顶部保存状态

`EditorView` 增加编辑页顶部工具条，位于主编辑网格上方。工具条保持低干扰，不做营销式横幅：

- 左侧：当前编辑区摘要，如「字幕编辑」与字幕数量。
- 右侧：保存状态 pill，并保留当前编辑页已有的操作入口（如样式管理）。
- 状态文本：
  - `saving === true`：`保存中…`
  - `saveError !== null`：`保存失败`
  - `saving === false && saveError === null && isDirty === true`：`未保存`
  - `saving === false && saveError === null && isDirty === false`：`已保存`

状态颜色：

- 已保存：success
- 未保存：warning
- 保存中：text-muted
- 保存失败：danger

保存开始时清空 `saveError` 并设置 `saving = true`。保存成功后调用 `markSaved()`，清空 `saveError`，顶部状态回到「已保存」，不额外显示成功 toast。保存失败时不调用 `markSaved()`，保留 dirty，设置 `saveError`，显示 toast「保存失败：错误摘要」。错误摘要统一取 `err instanceof Error ? err.message : String(err)`。

原右下角固定「未保存」悬浮提示移除。`StatusBar` 中的全局「未保存」提示保留，因为它属于全应用底栏状态，不与编辑页顶部状态冲突。

### 二、编辑页轻量反馈

新增 `EditorToast`，只由 `EditorView` 持有和渲染。

接口：

```typescript
export type EditorToastVariant = "success" | "error" | "info";

export interface EditorToastMessage {
  id: number;
  variant: EditorToastVariant;
  text: string;
}

interface EditorToastProps {
  message: EditorToastMessage | null;
  onClose: () => void;
}
```

`EditorView` 内提供：

```typescript
const notify = (variant: EditorToastVariant, text: string) => {
  toastIdRef.current += 1;
  setToast({ id: toastIdRef.current, variant, text });
};
```

行为：

- 新 toast 替换旧 toast。
- success / info 默认 2500ms 后消失。
- error 默认 4000ms 后消失，也可以手动关闭。
- toast 文案使用简体中文。
- 不引入第三方依赖。

使用场景：

- 保存失败：error「保存失败：...」
- 删除字幕：info「已删除字幕，可按 Ctrl+Z 撤销」
- 新建 id 失败：error「新建字幕失败：无法生成唯一 ID」

### 三、Aegisub 式时间输入

把 `SubtitleEditor.tsx` 中的 `formatTimeInput` / `parseTimeInput` 移到 `src/utils/timeInput.ts`，并把时间框改为固定掩码输入。时间框内的字符串始终保持 `HH:MM:SS.CS` 长度与分隔符，用户不能通过 Backspace / Delete 删除字符；数字输入只覆盖一个数字槽位。

#### 格式化

```typescript
export function formatTimeInput(ms: number): string;
```

输出固定为 `HH:MM:SS.CS`，例如：

- `0` → `00:00:00.00`
- `1234` → `00:00:01.23`
- `3723450` → `01:02:03.45`

#### 掩码键盘行为

```typescript
export const TIME_INPUT_TEMPLATE = "00:00:00.00";
export const TIME_INPUT_DIGIT_INDEXES = [0, 1, 3, 4, 6, 7, 9, 10] as const;

export type TimeInputEditResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  handled: boolean;
};

export function normalizeTimeInputValue(value: string): string;

export function snapTimeInputCaret(position: number): number;

export function applyTimeInputKey(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  key: string,
): TimeInputEditResult;
```

规则：

- 时间文本固定为 `HH:MM:SS.CS`，分隔符位置固定：`2`、`5` 是冒号，`8` 是点号。
- 可编辑槽位只有数字位置：`0, 1, 3, 4, 6, 7, 9, 10`。
- 数字键 `0-9`：替换光标当前或之后的第一个数字槽位，然后光标移动到下一个数字槽位；若已在最后一个数字槽位，光标停在末尾。
- `Backspace`：不删除字符，只把光标移动到前一个数字槽位；若已在第一个数字槽位，光标停在开头。
- `Delete`：不删除字符，只把光标移动到下一个数字槽位；若已在最后一个数字槽位，光标停在末尾。
- `ArrowLeft` / `ArrowRight`、鼠标点击和 Tab 聚焦保留浏览器默认光标行为；若光标停在分隔符上，下一次数字、`Backspace` 或 `Delete` 会按相邻数字槽位处理。
- 输入法组词期间不处理自定义按键逻辑，沿用现有 `isComposing` 保护。
- 粘贴和其他 DOM 输入变化不模拟逐槽键入；`onChange` 会立即提取数字并用 `normalizeTimeInputValue` 恢复固定格式。

`normalizeTimeInputValue` 用于从旧数据或异常 DOM 输入恢复固定格式：

- 提取输入中的数字，按 `HHMMSSCS` 顺序填入 8 个数字槽位。
- 数字不足时右侧补 `0`。
- 数字过多时截断到 8 位。
- 重新插入固定分隔符。

#### 解析、进位与区间归一化

```typescript
export type TimeParseResult =
  | { ok: true; valueMs: number; normalized: string }
  | { ok: false; message: string };

export function parseTimeInput(input: string): TimeParseResult;
```

`parseTimeInput` 先调用 `normalizeTimeInputValue`，再解析固定格式。分钟或秒大于等于 60 时不报错，而是直接按毫秒总量进位后重新格式化，例如：

- `00:60:00.00` → `01:00:00.00`
- `00:00:60.00` → `00:01:00.00`

小时范围为 `0-99`。超过 `99:59:59.99` 时钳到最大值，这是当前 UI 固定 `HH` 显示的自然边界，足够覆盖本项目字幕校对场景。

```typescript
export type TimeRangeNormalized = {
  startMs: number;
  endMs: number;
  startText: string;
  endText: string;
};

export function normalizeTimeRange(
  startInput: string,
  endInput: string,
  changedField: "start" | "end" = "end",
): TimeRangeNormalized;
```

规则：

- 开始时间和结束时间都通过 `parseTimeInput` 归一化。
- 若结束时间早于开始时间，把用户刚修改的字段钳到另一个字段：改结束时间时 `end = start`，改开始时间时 `start = end`。
- 不展示 inline error，不阻断 blur / Enter；时间框始终回到合法固定格式。

`SubtitleEditor` 的 blur 行为拆分：

- 文本框 blur：只提交文本草稿，不强制解析时间。
- 时间框 blur：归一化并提交时间字段。
- 文本框 Enter「提交并下一条」：先归一化时间，再提交并跳转。

这样既保持 Aegisub 式快速覆盖输入，又避免错误提示打断连续校对。

### 四、cue id 去重

`editorActions.ts` 增加通用唯一 id 生成工具与两个业务包装。

```typescript
export type CreateIdFn = () => string;

export function createUniqueCueId(
  existingCues: SubtitleCue[],
  createIdFn?: CreateIdFn,
  maxAttempts?: number,
): string | null;
```

规则：

- 默认 `createIdFn` 使用 `@hikaru/ass-core` 的 `createId`。
- 默认最多尝试 3 次。
- 每次生成后检查 `existingCues.some((cue) => cue.id === id)`。
- 3 次都撞车时返回 `null`，调用方不执行 `addCue`。

业务包装：

```typescript
export function createCueAtPlayheadWithUniqueId(
  currentTimeMs: number,
  existingCues: SubtitleCue[],
  createIdFn?: CreateIdFn,
): SubtitleCue | null;

export function appendCueAfterWithUniqueId(
  cue: SubtitleCue,
  existingCues: SubtitleCue[],
  createIdFn?: CreateIdFn,
): SubtitleCue | null;
```

新建参数保持现状：

- Insert /「在当前位置新建字幕」：起点为播放头，时长 2s，文本「新建字幕」，`Primary`，`layer = 0`
- Enter 在最后一条追加：起点接当前行结束，时长 2s，空文本，继承当前 cue 的 `style` 与 `layer`

所有新增入口都必须改用唯一 id 包装：

- `SubtitleEditor.handleAdd`
- `SubtitleEditor.commitAndNext` 的最后一条追加
- `useEditorHotkeys` 的 Insert 动作

### 五、删除按钮移除 confirm

新增纯函数统一删除后的选中策略：

```typescript
export function selectCueAfterDelete(
  cuesBeforeDelete: SubtitleCue[],
  deletedId: string,
): SubtitleCue | null;
```

规则：

- 删除中间行后选中原位置的下一行。
- 删除最后一行后选中新的最后一行。
- 删除唯一一行后选中 `null`。
- 找不到 `deletedId` 时返回 `null`。

`SubtitleEditor` 删除按钮与快捷键 Delete 使用同一策略：

1. 读取删除前的 `cues`。
2. 计算删除后的目标选中 cue。
3. 调用 `deleteCue(id)`。
4. 设置 `selectedCueId` 为目标 cue id 或 `null`。
5. 清除 `playUntilMs`。
6. 显示 info toast「已删除字幕，可按 Ctrl+Z 撤销」。

不再调用 `confirm()`。删除仍进入现有 `projectStore` 撤销栈，因此 `Ctrl+Z` 和播放控制栏撤销按钮都可以恢复。

### 六、`alert()` / `confirm()` 替换边界

本期必须移除编辑页相关原生弹窗：

- `EditorView.handleSave` 不再调用 `alert()`。
- `SubtitleEditor.handleDelete` 不再调用 `confirm()`。

非本期边界：

- `StyleManager` 中已有的 `ConfirmDialog` 是自定义组件，不是浏览器原生 `confirm()`，可保留。
- 其他 workflow 页面如果存在未来弹窗，不纳入 Phase 2B，除非它们位于编辑页保存/删除路径上。

## 错误处理与边界情况

- **保存失败**：顶部状态显示「保存失败」，保留 dirty，不覆盖 ASS 文件路径状态，toast 展示错误摘要。
- **重复保存点击**：`saving === true` 时保存按钮或快捷键保存直接 no-op，避免并发写文件。
- **空字幕保存**：保持现有行为，`project` / `projectDir` 缺失或 `cues.length === 0` 时不保存，不弹窗。
- **时间输入溢出**：分钟/秒溢出自动进位，字段本身保持 `HH:MM:SS.CS` 固定形态。
- **倒序时间区间**：用户通过时间输入提交时把刚修改字段钳到另一个字段，不弹错、不阻断操作。
- **id 连续撞车**：不新增字幕，toast 报错，不改变选中项。
- **删除后撤销**：恢复由现有撤销栈负责；本期不新增 toast 内撤销按钮。
- **toast 重复触发**：新消息替换旧消息，避免堆叠遮挡编辑区。

## 测试策略

### 单元测试

`src/utils/timeInput.test.ts`：

- `formatTimeInput(3723450)` 输出 `01:02:03.45`
- `normalizeTimeInputValue("01020345")` 输出 `01:02:03.45`
- `normalizeTimeInputValue("1a2b3")` 输出 `12:30:00.00`
- `applyTimeInputKey("00:00:00.00", 0, 0, "1")` 输出 `10:00:00.00`，光标移动到 `1`
- `applyTimeInputKey("10:00:00.00", 1, 1, "2")` 输出 `12:00:00.00`，光标移动到 `3`
- `applyTimeInputKey("12:00:00.00", 1, 1, "Backspace")` 不改变 value，光标移动到 `0`
- `applyTimeInputKey("12:00:00.00", 1, 1, "Delete")` 不改变 value，光标移动到 `3`
- `parseTimeInput("00:60:00.00")` 成功并归一化为 `01:00:00.00`
- `normalizeTimeRange("00:00:02.00", "00:00:01.00", "end")` 返回 `startMs = 2000`、`endMs = 2000`

`src/services/editorActions.test.ts`：

- `createUniqueCueId` 第一次生成唯一 id 时返回该 id。
- 前两次撞车、第三次唯一时返回第三次 id。
- 连续 3 次撞车时返回 `null`。
- `createCueAtPlayheadWithUniqueId` 保持现有新建参数。
- `appendCueAfterWithUniqueId` 保持现有追加参数。
- `selectCueAfterDelete` 覆盖删除中间、删除最后、删除唯一、找不到 id。

### 行为/组件测试

沿用当前项目的 vitest 风格：

- `SubtitleEditorBehavior.test.ts`：
  - 保留 IME、Esc、Enter、聚焦请求等现有行为约束。
  - 删除按钮断言改为 `SubtitleEditor.tsx` 不包含 `confirm(`。
  - 断言组件使用唯一 id 新建函数。
- 新增或扩展 `EditorView` 行为约束测试：
  - `EditorView.tsx` 不包含 `alert(`。
  - `handleSave` 路径包含保存状态与 toast 更新。
- `useEditorHotkeys.test.ts`：
  - Insert 使用唯一 id 包装。
  - Delete 使用 `selectCueAfterDelete` 并触发 `onNotify`。
- `SubtitleListBehavior.test.ts`：
  - 左侧字幕列表使用本地 `formatTime`，显示 10ms 精度。

### 手动测试清单

- 修改字幕文本后顶部状态变为「未保存」。
- 保存成功后顶部状态变为「已保存」，不额外弹成功 toast。
- 模拟保存失败后顶部状态为「保存失败」，dirty 保留。
- 时间输入框中按数字会覆盖当前数字槽位并向右移动一格。
- 时间输入框中按 Backspace / Delete 不会删除字符，只移动光标。
- 时间输入 `00:60:00.00` blur 后自动进位为 `01:00:00.00`。
- 结束时间早于开始时间时，刚修改的字段被钳到另一个字段。
- 左侧字幕列表显示两位厘秒，如 `0:01.23`。
- 点击删除按钮直接删除，`Ctrl+Z` 可恢复。
- Insert、空态新建、最后一条 Enter 追加都不会生成重复 id。

## 文件清单

新增：

- `src/utils/timeInput.ts`
- `src/utils/timeInput.test.ts`
- `src/components/editor/EditorToast.tsx`
- `tests/SubtitleListBehavior.test.ts`

修改：

- `src/services/editorActions.ts`
- `src/services/editorActions.test.ts`
- `src/hooks/useEditorHotkeys.ts`
- `src/hooks/useEditorHotkeys.test.ts`
- `src/components/editor/EditorView.tsx`
- `src/components/editor/SubtitleEditor.tsx`
- `src/components/editor/SubtitleList.tsx`
- `tests/SubtitleEditorBehavior.test.ts`

无需改动：

- `packages/ass-core`
- Rust / Tauri 后端
- `.cursor/plans/`
- 全局任务队列和下载/转录/翻译/压制 workflow

## 依赖

- 不新增 npm 依赖。
- 继续使用 React、Zustand、Vitest 与现有 Tailwind 样式体系。

## 实现顺序建议

1. `timeInput.ts` Aegisub 式 10ms 精度掩码行为与单元测试。
2. `editorActions.ts` 唯一 id 与删除后选择纯函数测试。
3. `EditorToast.tsx` 与 `EditorView` 保存状态/反馈接入。
4. `SubtitleEditor.tsx` 时间归一化、新建唯一 id、删除无 confirm。
4a. `SubtitleList.tsx` 开始/结束时间显示保持 10ms 精度。
5. `useEditorHotkeys.ts` Insert / Delete 行为与通知接入。
6. 更新行为约束测试，确保 `alert(` / `confirm(` 不再出现在编辑页相关路径。
7. 运行相关 vitest 与前端构建检查。
