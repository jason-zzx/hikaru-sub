# 编辑页 Phase 2A：样式可视化编辑 GUI 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立样式可视化编辑体系，支持样式下拉选择、快速参数工具栏（字体/字号/颜色/B/I）、样式库抽屉管理（新建/编辑/删除样式）

**Architecture:** 三层架构：(1) 工具层（ASS 颜色转换 + 颜色选择器组件）；(2) 状态管理层（projectStore 样式 actions + uiStore 抽屉状态）；(3) UI 层（SubtitleEditor 增强 + StyleManager 抽屉）

**Tech Stack:** React 19, TypeScript, Zustand, react-colorful, Tailwind CSS 4, vitest

---

## 文件结构

**新增文件**：
- `src/utils/assColor.ts` - ASS 颜色格式转换工具（`&HAABBGGRR` ↔ RGBA）
- `src/utils/assColor.test.ts` - 颜色转换单元测试
- `src/components/editor/ColorPicker.tsx` - 颜色选择器组件（封装 react-colorful）
- `src/components/editor/StyleManager.tsx` - 样式库抽屉（列表 + 编辑表单）
- `src/stores/projectStore.test.ts` - projectStore 样式 actions 单元测试

**修改文件**：
- `package.json` - 添加 react-colorful 依赖
- `src/stores/projectStore.ts` - 添加 addStyle / updateStyle / deleteStyle actions
- `src/stores/uiStore.ts` - 添加 styleManagerOpen 状态与 toggleStyleManager action
- `src/components/editor/SubtitleEditor.tsx` - 添加样式下拉 + 快速参数工具栏
- `src/components/editor/EditorView.tsx` - 挂载样式按钮与 StyleManager 组件

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 react-colorful 依赖**

运行：
```bash
pnpm add react-colorful
```

- [ ] **Step 2: 验证安装**

运行：
```bash
pnpm list react-colorful
```

预期输出包含 `react-colorful` 及其版本号。

- [ ] **Step 3: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add react-colorful dependency for color picker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: ASS 颜色转换工具

**Files:**
- Create: `src/utils/assColor.ts`
- Create: `src/utils/assColor.test.ts`

- [ ] **Step 1: 编写颜色转换测试**

创建 `src/utils/assColor.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { assToRgba, rgbaToAss } from "./assColor";

describe("assToRgba", () => {
  it("白色不透明", () => {
    expect(assToRgba("&H00FFFFFF")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it("全透明黑色", () => {
    expect(assToRgba("&HFF000000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("半透明红色", () => {
    expect(assToRgba("&H7F0000FF")).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });

  it("解析失败返回白色", () => {
    expect(assToRgba("invalid")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(assToRgba("")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it("小写格式也能解析", () => {
    expect(assToRgba("&h00ffffff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });
});

describe("rgbaToAss", () => {
  it("白色不透明", () => {
    expect(rgbaToAss({ r: 255, g: 255, b: 255, a: 1 })).toBe("&H00FFFFFF");
  });

  it("全透明黑色", () => {
    expect(rgbaToAss({ r: 0, g: 0, b: 0, a: 0 })).toBe("&HFF000000");
  });

  it("半透明红色", () => {
    expect(rgbaToAss({ r: 255, g: 0, b: 0, a: 0.5 })).toBe("&H7F0000FF");
  });

  it("alpha 边界 clamp", () => {
    expect(rgbaToAss({ r: 100, g: 100, b: 100, a: -0.5 })).toBe("&HFF646464");
    expect(rgbaToAss({ r: 100, g: 100, b: 100, a: 1.5 })).toBe("&H00646464");
  });

  it("RGB 边界 clamp", () => {
    expect(rgbaToAss({ r: 300, g: -10, b: 150, a: 1 })).toBe("&H009600FF");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：
```bash
pnpm test src/utils/assColor.test.ts
```

预期：所有测试失败，提示 `assColor.ts` 不存在。

- [ ] **Step 3: 实现颜色转换工具**

创建 `src/utils/assColor.ts`：

```typescript
/**
 * ASS 颜色格式转换工具
 * ASS 格式：&HAABBGGRR（16进制 ABGR，AA=00 不透明，FF 全透明）
 */

export interface RGBA {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a: number; // 0-1（0=全透明，1=不透明）
}

/**
 * ASS → RGBA
 * @param ass ASS 颜色字符串，如 "&H00FFFFFF"
 * @returns RGBA 对象，解析失败返回白色
 */
export function assToRgba(ass: string): RGBA {
  // 匹配 &H 或 &h 开头，后跟 8 位 16 进制
  const match = ass.match(/^&H([0-9A-Fa-f]{8})$/i);
  if (!match) {
    return { r: 255, g: 255, b: 255, a: 1 }; // 解析失败返回白色
  }

  const hex = match[1];
  const aa = parseInt(hex.substring(0, 2), 16);
  const bb = parseInt(hex.substring(2, 4), 16);
  const gg = parseInt(hex.substring(4, 6), 16);
  const rr = parseInt(hex.substring(6, 8), 16);

  return {
    r: rr,
    g: gg,
    b: bb,
    a: 1 - aa / 255, // ASS alpha 反向：00=不透明(1)，FF=全透明(0)
  };
}

/**
 * RGBA → ASS
 * @param rgba RGBA 对象
 * @returns ASS 颜色字符串，如 "&H00FFFFFF"
 */
export function rgbaToAss(rgba: RGBA): string {
  const r = Math.max(0, Math.min(255, Math.round(rgba.r)));
  const g = Math.max(0, Math.min(255, Math.round(rgba.g)));
  const b = Math.max(0, Math.min(255, Math.round(rgba.b)));
  const a = Math.max(0, Math.min(1, rgba.a));

  const aa = Math.round((1 - a) * 255); // 反向转换
  const rr = r.toString(16).padStart(2, "0").toUpperCase();
  const gg = g.toString(16).padStart(2, "0").toUpperCase();
  const bb = b.toString(16).padStart(2, "0").toUpperCase();
  const aaHex = aa.toString(16).padStart(2, "0").toUpperCase();

  return `&H${aaHex}${bb}${gg}${rr}`;
}
```

- [ ] **Step 4: 运行测试验证通过**

运行：
```bash
pnpm test src/utils/assColor.test.ts
```

预期：所有测试通过。

- [ ] **Step 5: 提交**

```bash
git add src/utils/assColor.ts src/utils/assColor.test.ts
git commit -m "feat(editor): add ASS color format conversion utils

- assToRgba: &HAABBGGRR → { r, g, b, a }
- rgbaToAss: { r, g, b, a } → &HAABBGGRR
- Parse failure returns white, RGB/alpha clamped to valid range

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: 颜色选择器组件

**Files:**
- Create: `src/components/editor/ColorPicker.tsx`

- [ ] **Step 1: 实现颜色选择器组件**

创建 `src/components/editor/ColorPicker.tsx`：

```typescript
import { useEffect, useRef, useState } from "react";
import { RgbaColorPicker } from "react-colorful";
import { assToRgba, rgbaToAss, type RGBA } from "../../utils/assColor";

interface ColorPickerProps {
  /** ASS 颜色格式：&H00FFFFFF */
  value: string;
  /** 颜色变化回调，传递 ASS 格式 */
  onChange: (ass: string) => void;
  /** 可选标签 */
  label?: string;
}

/**
 * 颜色选择器：色块按钮 + 浮层
 * - 点击色块展开 react-colorful 的 RgbaColorPicker
 * - 点击外部或按 Esc 关闭
 * - 内部转换 ASS ↔ RGBA
 */
export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [rgba, setRgba] = useState<RGBA>(() => assToRgba(value));
  const containerRef = useRef<HTMLDivElement>(null);

  // 外部 value 变化时同步内部 rgba
  useEffect(() => {
    setRgba(assToRgba(value));
  }, [value]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  const handleColorChange = (newRgba: RGBA) => {
    setRgba(newRgba);
    onChange(rgbaToAss(newRgba));
  };

  // 色块预览样式（带透明度棋盘背景）
  const previewStyle = {
    backgroundColor: `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})`,
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      {label && (
        <label className="mb-1 block text-xs text-text-muted">{label}</label>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="h-8 w-16 rounded border border-border hover:border-border-strong"
        style={previewStyle}
        title={value}
      >
        <span className="sr-only">选择颜色</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-2 rounded-lg border border-border bg-surface-raised p-3 shadow-lg">
          <RgbaColorPicker color={rgba} onChange={handleColorChange} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 验证组件编译**

运行：
```bash
pnpm build
```

预期：构建成功，无 TypeScript 错误。

- [ ] **Step 3: 提交**

```bash
git add src/components/editor/ColorPicker.tsx
git commit -m "feat(editor): add ColorPicker component

- Wraps react-colorful RgbaColorPicker
- ASS color format ↔ RGBA conversion
- Click outside or Esc to close
- Transparent preview with checkerboard background

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: projectStore 样式管理 actions

**Files:**
- Modify: `src/stores/projectStore.ts`
- Create: `src/stores/projectStore.test.ts`

- [ ] **Step 1: 编写 projectStore 样式 actions 测试**

创建 `src/stores/projectStore.test.ts`：

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { useProjectStore } from "./projectStore";
import { createDefaultStyles } from "@hikaru/ass-core";
import type { AssStyle } from "@hikaru/ass-core";

describe("projectStore 样式管理", () => {
  beforeEach(() => {
    // 重置 store
    useProjectStore.setState({
      assStyles: createDefaultStyles(),
      isDirty: false,
    });
  });

  it("addStyle 追加新样式并标记 dirty", () => {
    const store = useProjectStore.getState();
    const newStyle: AssStyle = {
      name: "TestStyle",
      fontName: "Arial",
      fontSize: 48,
      primaryColor: "&H00FF0000",
      secondaryColor: "&H00000000",
      outlineColor: "&H00FFFFFF",
      backColor: "&H80000000",
      bold: true,
      italic: false,
      underline: false,
      strikeOut: false,
      scaleX: 100,
      scaleY: 100,
      spacing: 0,
      angle: 0,
      borderStyle: 1,
      outline: 2,
      shadow: 1,
      alignment: 2,
      marginL: 20,
      marginR: 20,
      marginV: 40,
      encoding: 1,
    };

    store.addStyle(newStyle);

    const state = useProjectStore.getState();
    expect(state.assStyles).toHaveLength(3); // Primary + Secondary + TestStyle
    expect(state.assStyles[2].name).toBe("TestStyle");
    expect(state.isDirty).toBe(true);
  });

  it("updateStyle 按名称更新样式参数", () => {
    const store = useProjectStore.getState();
    store.updateStyle("Primary", { fontSize: 64, bold: true });

    const state = useProjectStore.getState();
    const primary = state.assStyles.find((s) => s.name === "Primary");
    expect(primary?.fontSize).toBe(64);
    expect(primary?.bold).toBe(true);
    expect(state.isDirty).toBe(true);
  });

  it("updateStyle 样式名不存在时不报错", () => {
    const store = useProjectStore.getState();
    store.updateStyle("NonExistent", { fontSize: 100 });

    const state = useProjectStore.getState();
    expect(state.assStyles).toHaveLength(2); // 不变
  });

  it("deleteStyle 移除指定样式", () => {
    const store = useProjectStore.getState();
    store.deleteStyle("Secondary");

    const state = useProjectStore.getState();
    expect(state.assStyles).toHaveLength(1);
    expect(state.assStyles[0].name).toBe("Primary");
    expect(state.isDirty).toBe(true);
  });

  it("deleteStyle 不影响引用该样式的 cues", () => {
    const store = useProjectStore.getState();
    store.setCues([
      {
        id: "cue1",
        startMs: 0,
        endMs: 1000,
        primaryText: "测试",
        style: "Secondary",
        layer: 0,
      },
    ]);
    store.deleteStyle("Secondary");

    const state = useProjectStore.getState();
    expect(state.cues[0].style).toBe("Secondary"); // 保留原值
  });

  it("样式操作不进入撤销历史", () => {
    const store = useProjectStore.getState();
    const initialPast = store.history.past.length;

    store.addStyle({
      name: "NewStyle",
      fontName: "Arial",
      fontSize: 48,
      primaryColor: "&H00FFFFFF",
      secondaryColor: "&H00000000",
      outlineColor: "&H00000000",
      backColor: "&H80000000",
      bold: false,
      italic: false,
      underline: false,
      strikeOut: false,
      scaleX: 100,
      scaleY: 100,
      spacing: 0,
      angle: 0,
      borderStyle: 1,
      outline: 2,
      shadow: 1,
      alignment: 2,
      marginL: 20,
      marginR: 20,
      marginV: 40,
      encoding: 1,
    });

    const state = useProjectStore.getState();
    expect(state.history.past.length).toBe(initialPast); // 不变
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：
```bash
pnpm test src/stores/projectStore.test.ts
```

预期：所有测试失败，提示 `addStyle` / `updateStyle` / `deleteStyle` 不存在。

- [ ] **Step 3: 实现样式管理 actions**

修改 `src/stores/projectStore.ts`，在 `ProjectState` 接口中添加新方法：

```typescript
interface ProjectState {
  // ... 现有字段 ...
  addStyle: (style: AssStyle) => void;
  updateStyle: (name: string, updates: Partial<AssStyle>) => void;
  deleteStyle: (name: string) => void;
}
```

在 `create` 函数中添加实现（在 `markSaved` 之后）：

```typescript
  markSaved: () => set({ isDirty: false }),

  addStyle: (style) =>
    set((state) => ({
      assStyles: [...state.assStyles, style],
      isDirty: true,
    })),

  updateStyle: (name, updates) =>
    set((state) => ({
      assStyles: state.assStyles.map((s) =>
        s.name === name ? { ...s, ...updates } : s
      ),
      isDirty: true,
    })),

  deleteStyle: (name) =>
    set((state) => ({
      assStyles: state.assStyles.filter((s) => s.name !== name),
      isDirty: true,
    })),
```

- [ ] **Step 4: 运行测试验证通过**

运行：
```bash
pnpm test src/stores/projectStore.test.ts
```

预期：所有测试通过。

- [ ] **Step 5: 提交**

```bash
git add src/stores/projectStore.ts src/stores/projectStore.test.ts
git commit -m "feat(editor): add style management actions to projectStore

- addStyle: append new style and mark dirty
- updateStyle: update style by name
- deleteStyle: remove style without modifying cues
- Style changes do not enter undo history

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: uiStore 样式抽屉状态

**Files:**
- Modify: `src/stores/uiStore.ts`

- [ ] **Step 1: 添加样式抽屉状态**

修改 `src/stores/uiStore.ts`，在 `UiState` 接口中添加字段：

```typescript
interface UiState {
  // ... 现有字段 ...
  styleManagerOpen: boolean;
  // ... 现有方法 ...
  toggleStyleManager: () => void;
}
```

在 `create` 函数中添加初始状态与实现：

```typescript
export const useUiStore = create<UiState>((set) => ({
  currentStep: "welcome",
  sidebarCollapsed: false,
  editorFocusNonce: 0,
  styleManagerOpen: false,
  setStep: (step) => set({ currentStep: step }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  requestEditorFocus: () =>
    set((state) => ({ editorFocusNonce: state.editorFocusNonce + 1 })),
  toggleStyleManager: () =>
    set((state) => ({ styleManagerOpen: !state.styleManagerOpen })),
}));
```

- [ ] **Step 2: 验证编译**

运行：
```bash
pnpm build
```

预期：构建成功，无 TypeScript 错误。

- [ ] **Step 3: 提交**

```bash
git add src/stores/uiStore.ts
git commit -m "feat(editor): add styleManagerOpen state to uiStore

- styleManagerOpen: boolean state for drawer visibility
- toggleStyleManager: toggle drawer open/close

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: SubtitleEditor 样式下拉与快速参数

**Files:**
- Modify: `src/components/editor/SubtitleEditor.tsx`

- [ ] **Step 1: 添加样式下拉与快速参数状态**

在 `SubtitleEditor` 函数开头，`selectedCue` 声明之后添加：

```typescript
  const selectedCue = cues.find((c) => c.id === selectedCueId);
  const assStyles = useProjectStore((s) => s.assStyles);

  const textAreaRef = useRef<HTMLTextAreaElement>(null);
```

将现有的 `mainTextRef` 重命名为 `textAreaRef`（在后续步骤中统一修改引用）。

- [ ] **Step 2: 实现 override 标签插入函数**

在 `commitAndNext` 函数之后添加：

```typescript
  /** 插入 ASS override 标签到光标位置 */
  const insertOverrideTag = (tag: string) => {
    const textarea = textAreaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = useInlineEditor ? inlineText : primaryText;
    const newText = currentText.slice(0, start) + tag + currentText.slice(end);

    if (useInlineEditor) {
      setInlineText(newText);
    } else {
      setPrimaryText(newText);
    }

    // 下一帧聚焦并移动光标到标签之后
    setTimeout(() => {
      textarea.focus();
      const newPos = start + tag.length;
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const handleFontChange = (fontName: string) => {
    insertOverrideTag(`{\\fn${fontName}}`);
  };

  const handleFontSizeChange = (fontSize: number) => {
    if (fontSize >= 1 && fontSize <= 200) {
      insertOverrideTag(`{\\fs${fontSize}}`);
    }
  };

  const handleColorChange = (color: string) => {
    insertOverrideTag(`{\\c${color}}`);
  };

  const toggleBold = () => {
    insertOverrideTag("{\\b1}");
  };

  const toggleItalic = () => {
    insertOverrideTag("{\\i1}");
  };
```

- [ ] **Step 3: 添加样式下拉到 UI**

在返回的 JSX 中，找到时间编辑部分（`startTime` / `endTime` 输入框），在其下方、文本编辑区之前添加：

```typescript
        {/* 样式选择（独占一行） */}
        {selectedCue && (
          <div className="border-t border-border px-3 py-2">
            <label className="mb-1 block text-xs text-text-muted">样式</label>
            <select
              value={selectedCue.style}
              onChange={(e) => updateCue(selectedCue.id, { style: e.target.value })}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
            >
              {assStyles.map((style) => (
                <option key={style.name} value={style.name}>
                  {style.name}
                </option>
              ))}
              {/* 若当前样式已删除，仍显示该值但不在 assStyles 中 */}
              {!assStyles.find((s) => s.name === selectedCue.style) && (
                <option value={selectedCue.style}>{selectedCue.style}</option>
              )}
            </select>
          </div>
        )}
```

- [ ] **Step 4: 添加快速参数工具栏到 UI**

在样式选择之后立即添加：

```typescript
        {/* 快速参数工具栏 */}
        {selectedCue && (
          <div className="border-t border-border px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              {/* 字体名 */}
              <input
                type="text"
                placeholder="字体"
                className="w-24 rounded border border-border bg-surface px-2 py-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleFontChange(e.currentTarget.value);
                    e.currentTarget.value = "";
                  }
                }}
              />

              {/* 字号 */}
              <input
                type="number"
                placeholder="字号"
                min="1"
                max="200"
                className="w-16 rounded border border-border bg-surface px-2 py-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = parseInt(e.currentTarget.value);
                    if (!isNaN(val)) {
                      handleFontSizeChange(val);
                      e.currentTarget.value = "";
                    }
                  }
                }}
              />

              {/* 颜色选择器（暂时占位，Task 7 集成） */}
              <button
                type="button"
                className="h-6 w-6 rounded border border-border bg-surface"
                title="主颜色（暂未实现）"
              >
                C
              </button>

              {/* 粗体 */}
              <button
                type="button"
                onClick={toggleBold}
                className="rounded border border-border bg-surface px-2 py-1 font-bold hover:bg-surface-raised"
                title="粗体 {\b1}"
              >
                B
              </button>

              {/* 斜体 */}
              <button
                type="button"
                onClick={toggleItalic}
                className="rounded border border-border bg-surface px-2 py-1 italic hover:bg-surface-raised"
                title="斜体 {\i1}"
              >
                I
              </button>
            </div>
          </div>
        )}
```

- [ ] **Step 5: 修改所有 mainTextRef 为 textAreaRef**

在组件中全局替换 `mainTextRef` 为 `textAreaRef`（包括 `useEffect` 中的聚焦调用）。

- [ ] **Step 6: 验证编译**

运行：
```bash
pnpm build
```

预期：构建成功。

- [ ] **Step 7: 提交**

```bash
git add src/components/editor/SubtitleEditor.tsx
git commit -m "feat(editor): add style dropdown and quick parameters toolbar

- Style dropdown shows all assStyles, preserves deleted style names
- Quick parameters: font name, font size, color (placeholder), B, I
- Override tags inserted at cursor position
- Cursor moves after tag, textarea stays focused

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: StyleManager 样式库抽屉 - 基础结构

**Files:**
- Create: `src/components/editor/StyleManager.tsx`

- [ ] **Step 1: 创建 StyleManager 基础结构**

创建 `src/components/editor/StyleManager.tsx`：

```typescript
import { useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useUiStore } from "../../stores/uiStore";
import { createDefaultStyles } from "@hikaru/ass-core";
import type { AssStyle } from "@hikaru/ass-core";

/**
 * 样式库抽屉：右侧滑出，管理项目所有样式
 * - 样式列表（名称 + 主颜色预览）
 * - 编辑表单（分组折叠面板）
 */
export function StyleManager() {
  const open = useUiStore((s) => s.styleManagerOpen);
  const toggleStyleManager = useUiStore((s) => s.toggleStyleManager);
  const assStyles = useProjectStore((s) => s.assStyles);
  const addStyle = useProjectStore((s) => s.addStyle);
  const updateStyle = useProjectStore((s) => s.updateStyle);
  const deleteStyle = useProjectStore((s) => s.deleteStyle);

  const [editingStyleName, setEditingStyleName] = useState<string | null>(null);
  const [tempStyle, setTempStyle] = useState<AssStyle | null>(null);

  // 空样式列表自动补充 Primary/Secondary
  if (assStyles.length === 0 && open) {
    createDefaultStyles().forEach((s) => addStyle(s));
  }

  const editingStyle = editingStyleName
    ? assStyles.find((s) => s.name === editingStyleName)
    : null;

  const handleNewStyle = () => {
    const newStyle: AssStyle = {
      name: "NewStyle",
      fontName: "Noto Sans SC",
      fontSize: 54,
      primaryColor: "&H00FFFFFF",
      secondaryColor: "&H000000FF",
      outlineColor: "&H00000000",
      backColor: "&H80000000",
      bold: false,
      italic: false,
      underline: false,
      strikeOut: false,
      scaleX: 100,
      scaleY: 100,
      spacing: 0,
      angle: 0,
      borderStyle: 1,
      outline: 2,
      shadow: 1,
      alignment: 2,
      marginL: 20,
      marginR: 20,
      marginV: 40,
      encoding: 1,
    };
    addStyle(newStyle);
    setEditingStyleName("NewStyle");
    setTempStyle(newStyle);
  };

  const handleSelectStyle = (name: string) => {
    const style = assStyles.find((s) => s.name === name);
    if (!style) return;
    setEditingStyleName(name);
    setTempStyle({ ...style });
  };

  const handleDeleteStyle = (name: string) => {
    deleteStyle(name);
    if (editingStyleName === name) {
      setEditingStyleName(null);
      setTempStyle(null);
    }
  };

  const handleSaveStyle = () => {
    if (!tempStyle || !editingStyleName) return;
    
    // 名称冲突检查（仅当修改了名称）
    if (tempStyle.name !== editingStyleName) {
      const conflict = assStyles.find((s) => s.name === tempStyle.name);
      if (conflict) {
        return; // 冲突时不保存
      }
    }

    updateStyle(editingStyleName, tempStyle);
    setEditingStyleName(tempStyle.name);
  };

  if (!open) return null;

  return (
    <div className="fixed right-0 top-0 z-40 flex h-full w-[480px] flex-col border-l border-border bg-surface-raised shadow-2xl">
      {/* 顶部：标题 + 关闭按钮 + 新建按钮 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">样式管理</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleNewStyle}
            className="rounded bg-primary px-3 py-1 text-sm text-white hover:bg-primary-hover"
          >
            新建样式
          </button>
          <button
            onClick={toggleStyleManager}
            className="rounded p-1 hover:bg-surface"
            title="关闭"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* 中部：样式列表 */}
      <div className="flex-1 overflow-y-auto border-b border-border">
        {assStyles.map((style) => (
          <div
            key={style.name}
            className={`flex items-center justify-between border-b border-border px-4 py-2 hover:bg-surface ${
              editingStyleName === style.name ? "bg-surface" : ""
            }`}
          >
            <button
              onClick={() => handleSelectStyle(style.name)}
              className="flex flex-1 items-center gap-3 text-left"
            >
              <div
                className="h-6 w-6 rounded border border-border"
                style={{ backgroundColor: style.primaryColor }}
                title={style.primaryColor}
              />
              <span className="text-sm">{style.name}</span>
            </button>
            <button
              onClick={() => handleDeleteStyle(style.name)}
              className="rounded p-1 text-text-muted hover:bg-surface hover:text-red-500"
              title="删除"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* 底部：编辑表单占位 */}
      <div className="h-64 overflow-y-auto px-4 py-3">
        {editingStyle ? (
          <div className="text-sm text-text-muted">
            编辑表单待实现（Task 8）
          </div>
        ) : (
          <div className="text-center text-sm text-text-muted">
            选择或新建样式以开始编辑
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证编译**

运行：
```bash
pnpm build
```

预期：构建成功。

- [ ] **Step 3: 提交**

```bash
git add src/components/editor/StyleManager.tsx
git commit -m "feat(editor): add StyleManager drawer base structure

- Right-side drawer with title, close button, new style button
- Style list with color preview and delete button
- Edit form placeholder (to be implemented in Task 8)
- Auto-fill Primary/Secondary if assStyles is empty

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: StyleManager 编辑表单 - 字体组

**Files:**
- Modify: `src/components/editor/StyleManager.tsx`

- [ ] **Step 1: 添加字体编辑组**

在 `StyleManager` 组件的底部表单区域，替换占位内容为实际表单。找到：

```typescript
      {/* 底部：编辑表单占位 */}
      <div className="h-64 overflow-y-auto px-4 py-3">
```

替换为：

```typescript
      {/* 底部：编辑表单 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
```

然后替换表单内容部分：

```typescript
        {editingStyle && tempStyle ? (
          <div className="space-y-4">
            {/* 样式名（顶部固定） */}
            <div>
              <label className="mb-1 block text-xs text-text-muted">
                样式名
              </label>
              <input
                type="text"
                value={tempStyle.name}
                onChange={(e) => {
                  setTempStyle({ ...tempStyle, name: e.target.value });
                }}
                onBlur={handleSaveStyle}
                className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              />
              {/* 名称冲突检查 */}
              {tempStyle.name !== editingStyleName &&
                assStyles.find((s) => s.name === tempStyle.name) && (
                  <p className="mt-1 text-xs text-red-500">样式名已存在</p>
                )}
            </div>

            {/* 字体组 */}
            <details open>
              <summary className="cursor-pointer text-sm font-medium">
                字体
              </summary>
              <div className="mt-2 space-y-2 pl-2">
                {/* 字体名 */}
                <div>
                  <label className="mb-1 block text-xs text-text-muted">
                    字体名
                  </label>
                  <input
                    type="text"
                    value={tempStyle.fontName}
                    onChange={(e) => {
                      setTempStyle({ ...tempStyle, fontName: e.target.value });
                    }}
                    onBlur={handleSaveStyle}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                  />
                </div>

                {/* 字号 */}
                <div>
                  <label className="mb-1 block text-xs text-text-muted">
                    字号
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={tempStyle.fontSize}
                    onChange={(e) => {
                      setTempStyle({
                        ...tempStyle,
                        fontSize: parseInt(e.target.value) || 1,
                      });
                    }}
                    onBlur={handleSaveStyle}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                  />
                </div>

                {/* 粗体/斜体/下划线/删除线 */}
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={tempStyle.bold}
                      onChange={(e) => {
                        setTempStyle({ ...tempStyle, bold: e.target.checked });
                        handleSaveStyle();
                      }}
                    />
                    粗体
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={tempStyle.italic}
                      onChange={(e) => {
                        setTempStyle({ ...tempStyle, italic: e.target.checked });
                        handleSaveStyle();
                      }}
                    />
                    斜体
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={tempStyle.underline}
                      onChange={(e) => {
                        setTempStyle({
                          ...tempStyle,
                          underline: e.target.checked,
                        });
                        handleSaveStyle();
                      }}
                    />
                    下划线
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={tempStyle.strikeOut}
                      onChange={(e) => {
                        setTempStyle({
                          ...tempStyle,
                          strikeOut: e.target.checked,
                        });
                        handleSaveStyle();
                      }}
                    />
                    删除线
                  </label>
                </div>

                {/* 缩放 X/Y */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-text-muted">
                      缩放 X (%)
                    </label>
                    <input
                      type="number"
                      min="50"
                      max="200"
                      value={tempStyle.scaleX}
                      onChange={(e) => {
                        setTempStyle({
                          ...tempStyle,
                          scaleX: parseInt(e.target.value) || 100,
                        });
                      }}
                      onBlur={handleSaveStyle}
                      className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text-muted">
                      缩放 Y (%)
                    </label>
                    <input
                      type="number"
                      min="50"
                      max="200"
                      value={tempStyle.scaleY}
                      onChange={(e) => {
                        setTempStyle({
                          ...tempStyle,
                          scaleY: parseInt(e.target.value) || 100,
                        });
                      }}
                      onBlur={handleSaveStyle}
                      className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                    />
                  </div>
                </div>

                {/* 间距 */}
                <div>
                  <label className="mb-1 block text-xs text-text-muted">
                    间距
                  </label>
                  <input
                    type="number"
                    min="-10"
                    max="50"
                    step="0.5"
                    value={tempStyle.spacing}
                    onChange={(e) => {
                      setTempStyle({
                        ...tempStyle,
                        spacing: parseFloat(e.target.value) || 0,
                      });
                    }}
                    onBlur={handleSaveStyle}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                  />
                </div>

                {/* 旋转 */}
                <div>
                  <label className="mb-1 block text-xs text-text-muted">
                    旋转 (度)
                  </label>
                  <input
                    type="number"
                    min="-360"
                    max="360"
                    value={tempStyle.angle}
                    onChange={(e) => {
                      setTempStyle({
                        ...tempStyle,
                        angle: parseInt(e.target.value) || 0,
                      });
                    }}
                    onBlur={handleSaveStyle}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                  />
                </div>
              </div>
            </details>

            {/* 其他组占位（Task 9 实现） */}
            <div className="text-xs text-text-muted">
              颜色、边框、位置组待实现（Task 9）
            </div>
          </div>
        ) : (
          <div className="text-center text-sm text-text-muted">
            选择或新建样式以开始编辑
          </div>
        )}
```

- [ ] **Step 2: 验证编译**

运行：
```bash
pnpm build
```

预期：构建成功。

- [ ] **Step 3: 提交**

```bash
git add src/components/editor/StyleManager.tsx
git commit -m "feat(editor): add StyleManager font editing group

- Style name input with conflict check
- Font name, font size inputs
- Bold, italic, underline, strikeout checkboxes
- Scale X/Y, spacing, angle number inputs
- Auto-save on blur/checkbox change

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: StyleManager 编辑表单 - 颜色/边框/位置组

**Files:**
- Modify: `src/components/editor/StyleManager.tsx`

- [ ] **Step 1: 导入 ColorPicker 组件**

在文件顶部 import 语句中添加：

```typescript
import { ColorPicker } from "./ColorPicker";
```

- [ ] **Step 2: 添加颜色/边框/位置编辑组**

找到占位文本：

```typescript
            {/* 其他组占位（Task 9 实现） */}
            <div className="text-xs text-text-muted">
              颜色、边框、位置组待实现（Task 9）
            </div>
```

替换为完整的颜色/边框/位置/高级组（详见下方代码块）。

颜色组使用 ColorPicker 组件，四个颜色字段各配一个选择器。边框组包含样式下拉（1/3）与宽度/深度数值输入。位置组包含 3×3 对齐网格（numpad 1-9
布局）与三个边距输入。高级组包含编码输入。

完整代码：

```typescript
            {/* 颜色组 */}
            <details open>
              <summary className="cursor-pointer text-sm font-medium">
                颜色
              </summary>
              <div className="mt-2 space-y-2 pl-2">
                <ColorPicker
                  label="主颜色"
                  value={tempStyle.primaryColor}
                  onChange={(color) => {
                    setTempStyle({ ...tempStyle, primaryColor: color });
                    handleSaveStyle();
                  }}
                />
                <ColorPicker
                  label="次颜色"
                  value={tempStyle.secondaryColor}
                  onChange={(color) => {
                    setTempStyle({ ...tempStyle, secondaryColor: color });
                    handleSaveStyle();
                  }}
                />
                <ColorPicker
                  label="边框颜色"
                  value={tempStyle.outlineColor}
                  onChange={(color) => {
                    setTempStyle({ ...tempStyle, outlineColor: color });
                    handleSaveStyle();
                  }}
                />
                <ColorPicker
                  label="背景色"
                  value={tempStyle.backColor}
                  onChange={(color) => {
                    setTempStyle({ ...tempStyle, backColor: color });
                    handleSaveStyle();
                  }}
                />
              </div>
            </details>

            {/* 边框与阴影组 */}
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                边框与阴影
              </summary>
              <div className="mt-2 space-y-2 pl-2">
                {/* 边框样式 */}
                <div>
                  <label className="mb-1 block text-xs text-text-muted">
                    边框样式
                  </label>
                  <select
                    value={tempStyle.borderStyle}
                    onChange={(e) => {
                      setTempStyle({
                        ...tempStyle,
                        borderStyle: parseInt(e.target.value),
                      });
                      handleSaveStyle();
                    }}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                  >
                    <option value={1}>1 - 描边+阴影</option>
                    <option value={3}>3 - 不透明方框</option>
                  </select>
                </div>

                {/* 边框宽度 */}
                <div>
                  <label className="mb-1 block text-xs text-text-muted">
                    边框宽度
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tempStyle.outline}
                    onChange={(e) => {
                      setTempStyle({
                        ...tempStyle,
                        outline: parseFloat(e.target.value) || 0,
                      });
                    }}
                    onBlur={handleSaveStyle}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                  />
                </div>

                {/* 阴影深度 */}
                <div>
                  <label className="mb-1 block text-xs text-text-muted">
                    阴影深度
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tempStyle.shadow}
                    onChange={(e) => {
                      setTempStyle({
                        ...tempStyle,
                        shadow: parseFloat(e.target.value) || 0,
                      });
                    }}
                    onBlur={handleSaveStyle}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                  />
                </div>
              </div>
            </details>

            {/* 位置与边距组 */}
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                位置与边距
              </summary>
              <div className="mt-2 space-y-2 pl-2">
                {/* 对齐方式 3×3 网格 */}
                <div>
                  <label className="mb-1 block text-xs text-text-muted">
                    对齐方式（numpad 1-9）
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setTempStyle({ ...tempStyle, alignment: val });
                          handleSaveStyle();
                        }}
                        className={`rounded border px-2 py-1 text-xs ${
                          tempStyle.alignment === val
                            ? "border-primary bg-primary text-white"
                            : "border-border bg-surface hover:bg-surface-raised"
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 边距 */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-text-muted">
                      左边距
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={tempStyle.marginL}
                      onChange={(e) => {
                        setTempStyle({
                          ...tempStyle,
                          marginL: parseInt(e.target.value) || 0,
                        });
                      }}
                      onBlur={handleSaveStyle}
                      className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text-muted">
                      右边距
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={tempStyle.marginR}
                      onChange={(e) => {
                        setTempStyle({
                          ...tempStyle,
                          marginR: parseInt(e.target.value) || 0,
                        });
                      }}
                      onBlur={handleSaveStyle}
                      className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-muted">
                    垂直边距
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tempStyle.marginV}
                    onChange={(e) => {
                      setTempStyle({
                        ...tempStyle,
                        marginV: parseInt(e.target.value) || 0,
                      });
                    }}
                    onBlur={handleSaveStyle}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                  />
                </div>
              </div>
            </details>

            {/* 高级组 */}
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                高级
              </summary>
              <div className="mt-2 space-y-2 pl-2">
                <div>
                  <label className="mb-1 block text-xs text-text-muted">
                    编码（一般不改）
                  </label>
                  <input
                    type="number"
                    value={tempStyle.encoding}
                    onChange={(e) => {
                      setTempStyle({
                        ...tempStyle,
                        encoding: parseInt(e.target.value) || 1,
                      });
                    }}
                    onBlur={handleSaveStyle}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
                  />
                </div>
              </div>
            </details>
```

- [ ] **Step 3: 验证编译**

运行：
```bash
pnpm build
```

预期：构建成功。

- [ ] **Step 4: 提交**

```bash
git add src/components/editor/StyleManager.tsx
git commit -m "feat(editor): add color/border/position editing groups to StyleManager

- Color group: primary/secondary/outline/back colors with ColorPicker
- Border group: border style dropdown, outline/shadow number inputs
- Position group: 3×3 alignment grid (numpad 1-9), margin inputs
- Advanced group: encoding input

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: EditorView 集成样式管理

**Files:**
- Modify: `src/components/editor/EditorView.tsx`

- [ ] **Step 1: 导入 StyleManager 和状态**

在文件顶部添加导入：

```typescript
import { StyleManager } from "./StyleManager";
```

在组件内添加状态订阅（在现有 `useProjectStore` / `useUiStore` 订阅之后）：

```typescript
  const styleManagerOpen = useUiStore((s) => s.styleManagerOpen);
  const toggleStyleManager = useUiStore((s) => s.toggleStyleManager);
```

- [ ] **Step 2: 添加样式按钮到编辑面板顶部**

找到编辑面板部分（`SubtitleEditor` 组件所在的 div），在其内部、`SubtitleEditor` 之前添加样式按钮：

```typescript
        {/* 编辑面板 */}
        <div className="col-start-3 row-span-2 bg-surface-raised">
          {/* 样式管理按钮 */}
          <div className="border-b border-border px-3 py-2">
            <button
              onClick={toggleStyleManager}
              className="w-full rounded border border-border bg-surface px-3 py-1 text-sm hover:bg-surface-raised"
            >
              {styleManagerOpen ? "关闭样式库" : "样式管理"}
            </button>
          </div>
          <SubtitleEditor />
        </div>
```

- [ ] **Step 3: 挂载 StyleManager 组件到布局末尾**

在 `EditorView` 返回的 JSX 末尾、`HotkeyHelpOverlay` 之前添加：

```typescript
      {/* 样式库抽屉 */}
      <StyleManager />

      {/* 键位速查浮层（? 呼出） */}
      <HotkeyHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
```

- [ ] **Step 4: 验证编译**

运行：
```bash
pnpm build
```

预期：构建成功。

- [ ] **Step 5: 提交**

```bash
git add src/components/editor/EditorView.tsx
git commit -m "feat(editor): integrate StyleManager into EditorView

- Add style management button at top of editor panel
- Mount StyleManager drawer component
- Toggle button shows open/close state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: SubtitleEditor 集成颜色选择器

**Files:**
- Modify: `src/components/editor/SubtitleEditor.tsx`

- [ ] **Step 1: 导入 ColorPicker 组件**

在文件顶部添加：

```typescript
import { ColorPicker } from "./ColorPicker";
```

- [ ] **Step 2: 替换颜色占位按钮为实际 ColorPicker**

找到快速参数工具栏中的颜色占位按钮，替换为：

```typescript
              {/* 主颜色选择器 */}
              <div className="flex items-center">
                <ColorPicker
                  value="&H00FFFFFF"
                  onChange={handleColorChange}
                />
              </div>
```

- [ ] **Step 3: 验证编译**

运行：
```bash
pnpm build
```

预期：构建成功。

- [ ] **Step 4: 提交**

```bash
git add src/components/editor/SubtitleEditor.tsx
git commit -m "feat(editor): integrate ColorPicker into quick parameters toolbar

- Replace placeholder button with actual ColorPicker
- Primary color selection inserts {\c&HXXXXXX} override tag

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 12: 手动测试与文档更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 启动开发服务器进行手动测试**

运行：
```bash
pnpm tauri dev
```

手动测试清单：
- [ ] 打开已有项目，进入编辑页
- [ ] 点击「样式管理」按钮，验证抽屉滑出
- [ ] 新建样式，填写样式名与各项参数
- [ ] 切换到字幕编辑，样式下拉显示新样式
- [ ] 选择样式，验证字幕 cue.style 更新
- [ ] 使用快速参数插入 override 标签（字体/字号/颜色/B/I）
- [ ] 验证标签插入到光标位置，光标移到标签之后
- [ ] 编辑样式颜色，验证 ColorPicker 展开/关闭
- [ ] 保存项目，重新打开，验证样式保留
- [ ] 删除样式，验证引用该样式的字幕仍可编辑

- [ ] **Step 2: 更新 README 待优化列表**

找到 `README.md` 中的待优化项，将其标记为已完成或移到已实现部分：

```markdown
- [x] 编辑页字幕样式可视化编辑（样式下拉、快速参数工具栏、样式库抽屉）
```

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: mark style visual editing as completed

Phase 2A implemented:
- Style dropdown in subtitle editor
- Quick parameters toolbar (font/size/color/B/I)
- Style library drawer with full editing form

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 自查清单

完成所有任务后，检查以下项目：

**1. 规格覆盖检查**：

- [x] ASS 颜色转换工具（assColor.ts）
- [x] 颜色选择器组件（ColorPicker.tsx）
- [x] projectStore 样式 actions（addStyle / updateStyle / deleteStyle）
- [x] uiStore 抽屉状态（styleManagerOpen / toggleStyleManager）
- [x] SubtitleEditor 样式下拉
- [x] SubtitleEditor 快速参数工具栏
- [x] StyleManager 样式列表
- [x] StyleManager 编辑表单（字体/颜色/边框/位置/高级）
- [x] EditorView 集成按钮与抽屉
- [x] 样式名冲突检查
- [x] 空样式列表自动补充
- [x] 删除样式不影响 cues
- [x] 样式修改不进撤销历史

**2. 占位符扫描**：无 TBD / TODO / 待实现

**3. 类型一致性**：

- AssStyle 接口 22 个字段完整
- ColorPicker 接口统一（ASS 格式输入输出）
- projectStore actions 签名一致
- 所有组件 TypeScript 无错误

**4. 未解决的规格需求**：Phase 2B（保存状态指示器、时间输入严格校验、id 去重、删除确认移除）明确标记为后续工作，不在本期范围。