import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  const path = fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("editor style visual editing integration", () => {
  it("adds a style dropdown and quick ASS override toolbar to SubtitleEditor", () => {
    const source = readSource("src/components/editor/SubtitleEditor.tsx");

    expect(source).toContain("assStyles");
    expect(source).toContain("updateCue(selectedCue.id, { style:");
    expect(source).toContain("applyAttributeTag");
    expect(source).toContain("applyToggleOverrideTag");
    expect(source).toContain("FontComboBox");
    expect(source).toContain("updateCuePreview");
    expect(source).toContain("handleTextChange");
    expect(source).toContain("{\\\\fn");
    expect(source).toContain("{\\\\fs");
    expect(source).toContain("{\\\\b");
    expect(source).toContain("{\\\\i");
    expect(source).toContain("{\\\\u1}");
    expect(source).toContain("{\\\\s1}");
    expect(source).toContain("ColorPicker");
    expect(source).toContain("activeTextFieldRef");
    expect(source).toContain("deferChange");
    expect(source).toContain("快速样式标签");
  });

  it("shows an empty style dropdown when the referenced style no longer exists", () => {
    const source = readSource("src/components/editor/SubtitleEditor.tsx");

    // 不合成失效样式选项；Select 以空占位显示（Aegisub 行为）
    expect(source).not.toContain("value: selectedCue.style");
    expect(source).toContain('placeholder=""');

    const selectSource = readSource("src/components/ui/Select.tsx");
    expect(selectSource).toContain("placeholder ?? value");
  });

  it("adds a ColorPicker backed by react-colorful and ASS color conversion", () => {
    const source = readSource("src/components/editor/ColorPicker.tsx");

    expect(source).toContain("RgbaColorPicker");
    expect(source).toContain("assToRgba");
    expect(source).toContain("rgbaToAss");
    expect(source).toContain("hexDraft");
    expect(source).toContain("透明度");
    expect(source).toContain("if (open) return");
  });

  it("adds a StyleManager drawer with full ASS style groups", () => {
    const source = readSource("src/components/editor/StyleManager.tsx");

    expect(source).toContain("样式管理");
    expect(source).toContain("新建样式");
    expect(source).toContain("字体");
    expect(source).toContain("颜色");
    expect(source).toContain("边框与阴影");
    expect(source).toContain("位置与边距");
    expect(source).toContain("高级");
    expect(source).toContain("createDefaultStyles");
    expect(source).toContain("ASS_ENCODING_OPTIONS");
    expect(source).toContain("Shift-JIS");
    expect(source).toContain("GB2312");
    expect(source).toContain("usePreviewFontNames");
    expect(source).toContain("FontComboBox");
    expect(source).toContain('step="0.1"');
  });

  it("prompts to cascade style renames to referencing cues (Aegisub-style)", () => {
    const source = readSource("src/components/editor/StyleManager.tsx");

    expect(source).toContain("renameStyle");
    expect(source).toContain("pendingRename");
    expect(source).toContain("commitNameEdit");
    expect(source).toContain("resolveRename");
    expect(source).toContain("ConfirmDialog");
    expect(source).toContain("同步更新这些字幕的样式引用");
    expect(source).toContain('"yes"');
    expect(source).toContain('"no"');
    expect(source).toContain('"cancel"');
  });

  it("exposes renameStyle with cascade support in the project store", () => {
    const source = readSource("src/stores/projectStore.ts");

    expect(source).toContain("renameStyle:");
    expect(source).toContain("renameStyle: (oldName, newName, cascade)");
  });

  it("sizes react-colorful controls for the compact editor popover", () => {
    const source = readSource("src/styles/index.css");

    expect(source).toContain(".subtitle-color-picker .react-colorful__pointer");
    expect(source).toContain("height: 14px");
    expect(source).toContain(".subtitle-color-picker .react-colorful__alpha");
  });

  it("mounts StyleManager from EditorView", () => {
    const source = readSource("src/components/editor/EditorView.tsx");

    expect(source).toContain("StyleManager");
    expect(source).toContain("toggleStyleManager");
  });
});
