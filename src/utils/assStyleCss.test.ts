import { describe, expect, it } from "vitest";
import { createDefaultScriptInfo, createDefaultStyles } from "@/lib/ass";
import type { AssStyle, SubtitleCue } from "@/lib/ass";
import {
  assFontWeight,
  assAlignmentToPlacement,
  assStyleToCss,
  buildTextShadow,
  findAssStyle,
  previewScaleX,
  resolveAssRenderItems,
  scaleAssFontSize,
  scaleAssLength,
} from "./assStyleCss";
import { assInlineToCss } from "./assRunCss";

const viewport = { width: 960, height: 540 };
const scriptInfo = createDefaultScriptInfo("Test", 1920, 1080);

function style(overrides: Partial<AssStyle> = {}): AssStyle {
  return { ...createDefaultStyles()[0], ...overrides };
}

describe("assStyleCss", () => {
  it("finds a style by name and falls back to Primary", () => {
    const styles = createDefaultStyles();

    expect(findAssStyle(styles, "Secondary").name).toBe("Secondary");
    expect(findAssStyle(styles, "Missing").name).toBe("Primary");
  });

  it("scales ASS lengths by axis using PlayRes", () => {
    expect(scaleAssLength(54, "y", scriptInfo, viewport)).toBe(27);
    expect(scaleAssLength(20, "x", scriptInfo, viewport)).toBe(10);
  });

  it("maps ASS font size to CSS pixels using renderer point scaling", () => {
    expect(scaleAssFontSize(54, scriptInfo, viewport)).toBe(19.98);
  });

  it("slightly narrows browser subtitle text when ASS ScaleX is neutral", () => {
    expect(previewScaleX(100)).toBe(0.95);
    expect(previewScaleX(110)).toBe(1.1);
  });

  it("maps ASS numpad alignment to placement", () => {
    expect(assAlignmentToPlacement(1)).toEqual({ vertical: "bottom", horizontal: "left" });
    expect(assAlignmentToPlacement(5)).toEqual({ vertical: "middle", horizontal: "center" });
    expect(assAlignmentToPlacement(9)).toEqual({ vertical: "top", horizontal: "right" });
  });

  it("uses left and right margins for horizontal center alignment", () => {
    const css = assStyleToCss(style({ alignment: 2 }), scriptInfo, viewport);

    expect(css.left).toBe(10);
    expect(css.right).toBe(10);
    expect(css.textAlign).toBe("center");
    expect(css.transform ?? "").not.toContain("translateX");
  });

  it("maps common style fields to CSS", () => {
    const css = assStyleToCss(
      style({
        fontName: "Noto Sans SC",
        fontSize: 54,
        primaryColor: "&H0000F5F5",
        bold: true,
        italic: true,
        underline: true,
        strikeOut: true,
        spacing: 4,
        scaleX: 110,
        scaleY: 90,
      }),
      scriptInfo,
      viewport,
    );

    expect(css.fontFamily).toContain("Noto Sans SC");
    expect(css.fontSize).toBe(19.98);
    expect(css.color).toBe("#F5F500");
    expect(css.fontWeight).toBe(700);
    expect(css.fontStyle).toBe("italic");
    expect(css.textDecorationLine).toBe("underline line-through");
    expect(css.letterSpacing).toBe(2);
    expect(css.transform).toContain("scale(1.1, 0.9)");
  });

  it("applies the default horizontal width compensation to neutral ScaleX", () => {
    const css = assStyleToCss(
      style({
        scaleX: 100,
        scaleY: 100,
      }),
      scriptInfo,
      viewport,
    );

    expect(css.transform).toBe("scale(0.95, 1)");
  });

  it("keeps ASS outline in text shadow so the white fill is not swallowed", () => {
    const css = assStyleToCss(
      style({
        outline: 2,
        shadow: 1,
        outlineColor: "&H00000000",
        backColor: "&H80000000",
      }),
      scriptInfo,
      viewport,
    );

    expect(css.WebkitTextStroke).toBeUndefined();
    expect(css.textShadow).toContain("-1px 0px 0 #000000");
    expect(css.textShadow).toContain("1px 1px 0 rgba(0, 0, 0, 0.498)");
  });

  it("builds text shadow from ASS outline and shadow", () => {
    const shadow = buildTextShadow(
      style({
        outline: 2,
        shadow: 1,
        outlineColor: "&H00000000",
        backColor: "&H80000000",
      }),
      scriptInfo,
      viewport,
    );

    expect(shadow).toContain("-1px 0px 0 #000000");
    expect(shadow).toContain("1px 1px 0 rgba(0, 0, 0, 0.498)");
  });

  it("resolves one render item for inline mode", () => {
    const cue: SubtitleCue = {
      id: "1",
      startMs: 0,
      endMs: 1000,
      primaryText: "原文",
      secondaryText: "译文",
      style: "Primary",
      layer: 0,
    };

    expect(resolveAssRenderItems(cue, createDefaultStyles(), "inline")).toEqual([
      {
        key: "1-inline",
        text: "译文 / 原文",
        style: createDefaultStyles()[0],
      },
    ]);
  });

  it("falls back to the first ASS document style when a referenced style is missing", () => {
    const first = style({ name: "DocumentFirst", fontName: "Document Font" });
    const resolved = findAssStyle([first], "MissingStyle");
    expect(resolved).toBe(first);
  });

  it("does not add Noto Sans SC as a hidden style-level font fallback", () => {
    const css = assStyleToCss(
      style({ name: "Primary", fontName: "Document Font" }),
      scriptInfo,
      viewport,
    );
    expect(css.fontFamily).toBe('"Document Font", sans-serif');
    expect(String(css.fontFamily)).not.toContain("Noto Sans SC");
  });

  it("prefers the libass-selected Noto Sans SC thin face for non-bold subtitles", () => {
    const css = assStyleToCss(
      style({ name: "Primary", fontName: "Noto Sans SC", bold: false }),
      scriptInfo,
      viewport,
    );

    expect(css.fontFamily).toBe(
      '"Noto Sans SC", sans-serif',
    );
    expect(css.fontWeight).toBe(100);
    expect(assFontWeight("Noto Sans SC", false)).toBe(100);
  });

  it("does not force thin weight for other font families", () => {
    const css = assStyleToCss(
      style({ name: "Primary", fontName: "Arial", bold: false }),
      scriptInfo,
      viewport,
    );

    expect(css.fontFamily).toBe('"Arial", sans-serif');
    expect(css.fontWeight).toBe(400);
    expect(assFontWeight("Arial", false)).toBe(400);
  });

  it("maps changed style metrics dynamically", () => {
    const css = assStyleToCss(
      style({
        fontName: "Arial",
        fontSize: 80,
        scaleX: 90,
        scaleY: 110,
        spacing: 3,
        outline: 4,
        shadow: 3,
      }),
      scriptInfo,
      viewport,
    );

    expect(css.fontSize).toBe(29.6);
    expect(css.transform).toContain("scale(0.9, 1.1)");
    expect(css.letterSpacing).toBe(1.5);
    expect(css.textShadow).toContain("-2px 0px 0 #000000");
    expect(css.textShadow).toContain("2px 2px 0 rgba(0, 0, 0, 0.498)");
  });

  it("does not add Noto Sans SC as a hidden inline font fallback", () => {
    const base = style({ name: "Primary", fontName: "Document Font" });
    const css = assInlineToCss(
      base,
      { fontName: "Inline Font" },
      scriptInfo,
      viewport,
    );
    expect(css.fontFamily).toBe('"Inline Font", sans-serif');
    expect(String(css.fontFamily)).not.toContain("Noto Sans SC");
  });

  it("resolves two render items for separate mode", () => {
    const cue: SubtitleCue = {
      id: "1",
      startMs: 0,
      endMs: 1000,
      primaryText: "原文",
      secondaryText: "译文",
      style: "Primary",
      layer: 0,
    };

    const items = resolveAssRenderItems(cue, createDefaultStyles(), "separate");

    expect(items).toHaveLength(2);
    expect(items[0].key).toBe("1-primary");
    expect(items[0].style.name).toBe("Primary");
    expect(items[1].key).toBe("1-secondary");
    expect(items[1].style.name).toBe("Secondary");
  });
});
