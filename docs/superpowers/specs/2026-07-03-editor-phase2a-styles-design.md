# 编辑页 Phase 2A：样式可视化编辑 GUI

- 日期：2026-07-03
- 状态：设计已完成，待编写实现计划
- 对应 README 待优化项：「编辑页字幕样式可视化编辑（字体、颜色、位置等 GUI，当前需在编辑框手写 ASS 标签）」

## 背景与目标

当前编辑器支持完整的 ASS 样式系统（22 个参数），但缺少可视化编辑界面：

- 新建字幕固定使用 `Primary` 样式，无法在 UI 选择其他样式
- 样式参数（字体、颜色、对齐等）需手写 ASS override 标签（如 `{\fn微软雅黑\fs48}`）
- 无全局样式管理入口，只能手动编辑 ASS 文件的 `[V4+ Styles]` 段

本期建立样式可视化编辑体系，参考 Aegisub 的混合方案：

- **编辑面板增强**：样式下拉选择 + 快速参数工具栏（字体/字号/颜色/B/I）
- **样式库抽屉**：右侧滑出，管理项目所有样式（新建/编辑/删除）

## 范围（Phase 2A）

**本期实现**：
- 编辑面板样式下拉 + 快速参数工具栏（字体名、字号、主颜色、粗体/斜体按钮）
- 样式库抽屉（样式列表 + 编辑表单，分组折叠面板）
- ASS 颜色格式转换工具（`&HAABBGGRR` ↔ RGBA）
- 颜色选择器组件（封装 `react-colorful`，支持 Alpha 通道）

**Phase 2B 留待后续**（细节修缮）：
- 保存状态指示器（编辑页顶部显示「未保存」/「已保存」）
- 时间输入严格校验（限制字符、自动补零）
- id 生成去重检查（`addCue` 前检查，重试最多 3 次）
- 删除按钮移除 confirm（直接删除，可撤销）

## 架构

### 新增模块

| 文件 | 职责 |
|------|------|
| `src/components/editor/StyleManager.tsx` | 样式库抽屉：右侧滑出，显示样式列表 + 编辑表单 |
| `src/components/editor/ColorPicker.tsx` | 颜色选择器封装（`react-colorful` + ASS 格式转换） |
| `src/utils/assColor.ts` | ASS 颜色格式转换：`&HAABBGGRR` ↔ `{ r, g, b, a }` |

### 修改模块

| 文件 | 改动 |
|------|------|
| `src/components/editor/SubtitleEditor.tsx` | 时间编辑下方加样式下拉（独占一行）+ 快速参数工具栏（字体/字号/颜色/B/I 按钮）；快速参数修改生成 override 标签插入光标位置 |
| `src/components/editor/EditorView.tsx` | 顶部或右上角加「样式」按钮，点击切换抽屉；挂载 `<StyleManager>` 组件 |
| `src/stores/projectStore.ts` | 新增 `addStyle` / `updateStyle` / `deleteStyle` actions |
| `src/stores/uiStore.ts` | 新增 `styleManagerOpen: boolean` 状态与 `toggleStyleManager()` action |
| `package.json` | 新增依赖：`react-colorful` |

### 数据流

```
用户操作（编辑面板下拉 / 快速参数 / 样式库表单）
  → projectStore.updateCue({ style }) 或文本插入 override 标签
  → projectStore.addStyle / updateStyle / deleteStyle
  → projectStore.markDirty()
  → Ctrl+S 保存时 assStyles 写入 ASS [V4+ Styles] 段
  → libass 预览实时刷新
```

## 详细设计

### 一、编辑面板增强（SubtitleEditor）

**布局**（时间编辑下方新增两行）：

1. **样式选择**（独占一行）
   - 下拉列表显示 `assStyles` 中所有样式名
   - 当前选中项为 `selectedCue.style`
   - 切换时调用 `updateCue(id, { style: newStyleName })`
   - 若 `selectedCue.style` 不在 `assStyles` 中（样式已删除或改名未同步），下拉显示为空（不合成失效名称选项，Aegisub 行为），用户可重新选择

2. **快速参数工具栏**（样式下拉下方单独一行）
   - 字体名下拉（常用字体 + 系统字体列表，可复用 `discover_preview_fonts`）
   - 字号输入框（`<input type="number">`，范围 1-200）
   - 颜色选择器按钮（显示色块，点击弹出 `ColorPicker` 浮层）
   - 粗体按钮（B 图标，toggle）
   - 斜体按钮（I 图标，toggle）

**快速参数交互**：

- 修改快速参数后，生成 ASS override 标签插入**当前光标位置**（或选区起点）
  - 字体名：`{\fnArial}`
  - 字号：`{\fs48}`
  - 颜色：`{\c&H00FFFFFF&}`（主颜色）
  - 粗体：`{\b1}` 或 `{\b0}`
  - 斜体：`{\i1}` 或 `{\i0}`
- 不修改 `cue.style`，仅在文本中插入标签
- 插入后保持编辑框聚焦，光标移到标签之后

### 二、样式库抽屉（StyleManager）

**布局结构**（右侧滑出，宽度约 400-500px）：

- **顶部**：
  - 标题「样式管理」+ 关闭按钮（X 图标）
  - 「新建样式」按钮

- **中部**：样式列表
  - 每个样式显示为卡片或列表项：样式名 + 主颜色预览色块
  - 点击样式项展开编辑表单（同一抽屉内滚动到表单区域）
  - 每个样式项右侧有「删除」图标按钮

- **底部**：编辑表单
  - 选中某样式时展开，显示样式名输入框 + 分组折叠面板
  - 未选中时显示「选择或新建样式以开始编辑」提示

**样式列表交互**：

- 删除样式：直接从 `assStyles` 移除，不弹确认
- 删除后，引用该样式的字幕 `cue.style` 保留原值（由 ASS 回退到默认样式 `assStyles[0]`）
- 允许删除任意样式（包括 Primary/Secondary）

**编辑表单**（分组折叠面板）：

1. **样式名**（顶部固定）
   - 文本输入框，编辑现有样式时可修改名称
   - 新建样式时检查名称冲突，若重复显示红色提示「样式名已存在」并置灰保存按钮

2. **字体**（默认展开）
   - 字体名（下拉 + 手动输入）
   - 字号（number input，1-200）
   - 粗体、斜体、下划线、删除线（4 个 checkbox）
   - 缩放 X、缩放 Y（number input，50-200，百分比）
   - 间距（number input，-10 到 50，step=0.5）
   - 旋转（number input，-360 到 360，度）

3. **颜色**（默认展开）
   - 主颜色（`primaryColor`）
   - 次颜色（`secondaryColor`）
   - 边框颜色（`outlineColor`）
   - 背景色（`backColor`）
   - 每个颜色配一个色块按钮 + `ColorPicker` 浮层

4. **边框与阴影**（默认折叠）
   - 边框样式（下拉或 radio：1=描边+阴影，3=不透明方框）
   - 边框宽度（outline，number input，0-100）
   - 阴影深度（shadow，number input，0-100）

5. **位置与边距**（默认折叠）
   - 对齐方式（alignment）：3×3 网格可视化选择器（numpad 布局：1-9）
   - 左边距（marginL，0-100）
   - 右边距（marginR，0-100）
   - 垂直边距（marginV，0-100）

6. **高级**（默认折叠）
   - 编码（encoding，number input，默认 1，一般不改）

**保存逻辑**：

- 表单实时同步到 `projectStore.assStyles`（受控组件）
- 修改后自动 `markDirty()`
- 用户 `Ctrl+S` 保存时写入 ASS 文件 `[V4+ Styles]` 段

### 三、颜色选择器（ColorPicker）

**组件接口**：

```typescript
interface ColorPickerProps {
  value: string;           // ASS 格式：&H00FFFFFF
  onChange: (ass: string) => void;
}
```

**实现细节**：

- 封装 `react-colorful` 的 `RgbaColorPicker`
- 内部转换：ASS ↔ RGBA（调用 `assColor.ts` 工具）
- 浮层定位：点击色块按钮展开，点击外部或按 Esc 关闭
- 显示当前颜色的预览色块（带 Alpha 透明度）

### 四、ASS 颜色转换（assColor.ts）

**工具函数**：

```typescript
/**
 * ASS 颜色格式：&HAABBGGRR（16进制 ABGR）
 * - AA：Alpha（00=不透明，FF=全透明）
 * - BB、GG、RR：蓝、绿、红
 */
export function assToRgba(ass: string): { r: number; g: number; b: number; a: number };

/**
 * RGBA → ASS 格式
 * - a: 0-1（0=全透明，1=不透明）转换为 00-FF（00=不透明，FF=全透明）
 */
export function rgbaToAss(rgba: { r: number; g: number; b: number; a: number }): string;
```

**边界处理**：

- `assToRgba` 解析失败时返回白色 `{ r: 255, g: 255, b: 255, a: 1 }`
- `rgbaToAss` 保证输出格式为 `&HAABBGGRR`（8 位 16 进制，大写）

### 五、状态管理改动

**projectStore**：

```typescript
// 新增 actions
addStyle: (style: AssStyle) => void;
updateStyle: (name: string, updates: Partial<AssStyle>) => void;
deleteStyle: (name: string) => void;
```

- 删除样式时，不修改引用该样式的 `cues` 数组（保留 `cue.style` 原值）
- 样式修改触发 `markDirty()`，但**不进入撤销历史**（撤销仅针对 `cues`）

**uiStore**：

```typescript
styleManagerOpen: boolean;
toggleStyleManager: () => void;
```

- 控制样式库抽屉的展开/关闭状态

**SubtitleEditor 内部状态**：

- 无需新增 state，快速参数直接操作文本框内容（插入 override 标签）
- 样式下拉受控于 `selectedCue.style`

**StyleManager 内部状态**：

```typescript
const [editingStyleName, setEditingStyleName] = useState<string | null>(null);
const [tempStyle, setTempStyle] = useState<AssStyle | null>(null);
```

- `editingStyleName`：当前展开编辑的样式名
- `tempStyle`：编辑中的临时样式对象，保存时写入 `projectStore.assStyles`

## 关键行为决策

1. **样式下拉不强制回退**：若 `cue.style` 引用的样式已删除或改名（未同步），下拉显示为空（不合成失效名称选项，Aegisub 行为），`cue.style` 数据保留原值，由 ASS 规范自动使用默认样式（`assStyles[0]`）渲染，不强制修改 `cue.style`。

1a. **重命名被引用样式需确认**（实现期新增）：重命名被字幕引用的样式时弹三选项确认框——「是」同步更新所有引用（进撤销历史）；「否」仅改样式名（引用悬空，下拉显示为空）；「取消」回滚名称。无引用时静默重命名。

2. **快速参数插入标签到光标位置**：修改字体/字号/颜色/B/I 后，生成 override 标签插入当前光标位置（或选区起点），插入后光标移到标签之后，保持编辑框聚焦。

3. **删除样式不弹确认**：样式库抽屉中删除样式直接生效，不弹确认框，引用该样式的字幕自动使用 ASS 默认样式。

4. **样式修改不进撤销历史**：`updateStyle` / `addStyle` / `deleteStyle` 触发 `markDirty()` 但不推入撤销栈，撤销/重做仅针对字幕内容（`cues` 数组）。

5. **对齐方式可视化选择器**：用 3×3 网格按钮展示 numpad 1-9 布局（1=左下，2=底部居中，...，9=右上），当前值高亮显示。

6. **颜色选择器支持 Alpha 通道**：使用 `react-colorful` 的 `RgbaColorPicker`，完整支持透明度调节；ASS Alpha 通道转换正确（00=不透明 → a=1，FF=全透明 → a=0）。

7. **样式名冲突检查**：新建样式时检查 `assStyles` 中是否已存在同名样式，若冲突在输入框下方显示红色提示「样式名已存在」并置灰保存按钮。

8. **空样式列表自动补充**：若 `assStyles` 为空（异常情况），自动补充 Primary/Secondary 默认样式（调用 `createDefaultStyles()`）。

## 错误处理与边界情况

- **样式名冲突**：新建时检查重复，提示并置灰保存按钮。
- **删除样式后字幕引用**：保留 `cue.style` 原值，由 ASS 规范回退默认样式。
- **快速参数插入**：光标在开头/中间/有选区均正确插入，插入后光标移到标签之后。
- **颜色格式异常**：`assToRgba` 解析失败返回白色，`rgbaToAss` 保证格式正确。
- **空样式列表**：自动补充 Primary/Secondary 默认样式（调用 `createDefaultStyles()`）。

## 测试策略

**单元测试**（vitest）：

- `assColor.ts`：
  - `assToRgba("&H00FFFFFF")` → `{ r: 255, g: 255, b: 255, a: 1 }`
  - `assToRgba("&HFF000000")` → `{ r: 0, g: 0, b: 0, a: 0 }`（全透明黑）
  - `rgbaToAss({ r: 255, g: 0, b: 0, a: 0.5 })` → `&H807F0000FF`（半透明红）
  - 解析失败返回白色
- `projectStore` actions：
  - `addStyle` 正确追加到 `assStyles`
  - `updateStyle` 按名称更新样式参数
  - `deleteStyle` 从 `assStyles` 移除，不修改 `cues`
  - 样式操作触发 `markDirty()`

**组件测试**：

- `SubtitleEditor`：
  - 样式下拉切换更新 `cue.style`
  - 快速参数按钮插入正确的 override 标签到光标位置
- `StyleManager`：
  - 新建样式追加到 `assStyles`
  - 编辑样式同步到 store
  - 删除样式从列表移除
  - 样式名冲突检查生效
- `ColorPicker`：
  - 点击展开/关闭浮层
  - 颜色变更触发 `onChange` 并传递正确 ASS 格式

**集成测试**：

- 编辑样式 → 保存 → 重新打开项目 → 样式保留
- 删除样式 → 引用该样式的字幕仍可正常编辑和保存
- 快速参数插入标签 → libass 预览实时生效

**手动测试清单**：

- 样式库抽屉滑出动画流畅
- 颜色选择器在不同字段（主颜色、边框色等）正常工作
- 对齐方式 3×3 网格点击正确设置 alignment 值（1-9）
- 快速参数按钮在不同光标位置正确插入标签
- 分组折叠面板展开/折叠状态保留

## 文件清单

**新增**：

- `src/components/editor/StyleManager.tsx`
- `src/components/editor/ColorPicker.tsx`
- `src/utils/assColor.ts`
- 对应测试文件（`*.test.ts` / `*.test.tsx`）

**修改**：

- `src/components/editor/SubtitleEditor.tsx`
- `src/components/editor/EditorView.tsx`
- `src/stores/projectStore.ts`
- `src/stores/uiStore.ts`
- `package.json`

**无需改动**：

- `packages/ass-core`（AssStyle 类型已完整，序列化逻辑无需改动）
- Rust 后端（样式管理纯前端逻辑）
- libass 预览（已支持 ASS styles，无需改动）

## 依赖

- **新增**：`react-colorful`（颜色选择器库）
- **现有**：`@hikaru/ass-core`（AssStyle 类型定义）、`zustand`（状态管理）、`immer`（不可变更新）

## 实现顺序建议

1. **工具层**：`assColor.ts` + 单元测试
2. **颜色选择器**：`ColorPicker.tsx` + 组件测试
3. **状态管理**：`projectStore` 新增 actions + 单元测试
4. **编辑面板增强**：`SubtitleEditor` 样式下拉 + 快速参数工具栏 + 组件测试
5. **样式库抽屉**：`StyleManager.tsx` 样式列表 + 编辑表单 + 组件测试
6. **集成**：`EditorView` 挂载样式按钮和抽屉 + 集成测试
7. **手动测试**：完整工作流验证
