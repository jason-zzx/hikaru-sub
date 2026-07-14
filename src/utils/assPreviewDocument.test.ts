import { describe, expect, it } from "vitest";
import {
  createDefaultScriptInfo,
  createDefaultStyles,
  SECONDARY_STYLE,
  type AssStyle,
  type SubtitleCue,
} from "@/lib/ass";
import { buildPreviewAssText } from "./assPreviewDocument";
import type { LibassGlyphCoverageMap } from "./libassGlyphFallback";

function stylesWithFonts(fonts: Record<string, string>): AssStyle[] {
  return createDefaultStyles().map((style) => ({
    ...style,
    fontName: fonts[style.name] ?? style.fontName,
  }));
}

describe("buildPreviewAssText", () => {
  const arialMissingChineseCoverage: LibassGlyphCoverageMap = {
    arial: {
      checkedCodePoints: [0x4e2d, 0x6587, 0x8bd1],
      missingCodePoints: [0x4e2d, 0x6587, 0x8bd1],
    },
  };

  it("serializes the current in-memory ASS document for inline preview", () => {
    const cues: SubtitleCue[] = [
      {
        id: "cue-1",
        startMs: 1000,
        endMs: 2500,
        primaryText: "原文",
        secondaryText: "译文",
        style: "Primary",
        layer: 0,
      },
    ];

    const text = buildPreviewAssText({
      cues,
      styles: createDefaultStyles(),
      scriptInfo: createDefaultScriptInfo("Preview", 1280, 720),
      mergeMode: "inline",
    });

    expect(text).toContain("PlayResX: 1280");
    expect(text).toContain("PlayResY: 720");
    expect(text).toContain("Dialogue:");
    expect(text).toContain("译文 / 原文");
  });

  it("adds render-only font fallback tags for CJK text rendered by a Latin style", () => {
    const styles = stylesWithFonts({ Primary: "Arial" });
    const cues: SubtitleCue[] = [
      {
        id: "cue-1",
        startMs: 1000,
        endMs: 2500,
        primaryText: "English 中文 text",
        style: "Primary",
        layer: 0,
      },
    ];

    const text = buildPreviewAssText({
      cues,
      styles,
      scriptInfo: createDefaultScriptInfo("Preview", 1280, 720),
      mergeMode: "inline",
      libassFallbackFontName: "Microsoft YaHei",
      libassGlyphCoverage: arialMissingChineseCoverage,
    });

    expect(text).toContain("Style: Primary,Arial");
    expect(text).toContain(
      "English {\\fnMicrosoft YaHei}中文{\\fnArial} text",
    );
    expect(styles.find((style) => style.name === "Primary")?.fontName).toBe(
      "Arial",
    );
  });

  it("adds render-only fallback tags to the secondary style text in separate mode", () => {
    const styles = stylesWithFonts({
      Primary: "Arial",
      [SECONDARY_STYLE]: "Arial",
    });
    const cues: SubtitleCue[] = [
      {
        id: "cue-1",
        startMs: 1000,
        endMs: 2500,
        primaryText: "English line",
        secondaryText: "中文译文",
        style: "Primary",
        layer: 0,
      },
    ];

    const text = buildPreviewAssText({
      cues,
      styles,
      scriptInfo: createDefaultScriptInfo("Preview", 1280, 720),
      mergeMode: "separate",
      libassFallbackFontName: "Microsoft YaHei",
      libassGlyphCoverage: arialMissingChineseCoverage,
    });

    expect(text).toContain("Style: Primary,Arial");
    expect(text).toContain("Style: Secondary,Arial");
    expect(text).toContain("Dialogue: 0,0:00:01.00,0:00:02.50,Primary");
    expect(text).toContain("Dialogue: 0,0:00:01.00,0:00:02.50,Secondary");
    expect(text).toContain("{\\fnMicrosoft YaHei}中文译文{\\fnArial}");
  });

  it("does not add fallback tags when the effective font already supports CJK", () => {
    const styles = stylesWithFonts({ Primary: "Microsoft YaHei" });
    const cues: SubtitleCue[] = [
      {
        id: "cue-1",
        startMs: 1000,
        endMs: 2500,
        primaryText: "中文 text",
        style: "Primary",
        layer: 0,
      },
    ];

    const text = buildPreviewAssText({
      cues,
      styles,
      scriptInfo: createDefaultScriptInfo("Preview", 1280, 720),
      mergeMode: "inline",
      libassFallbackFontName: "Microsoft YaHei",
      libassGlyphCoverage: {
        microsoftyahei: {
          checkedCodePoints: [0x4e2d, 0x6587],
          missingCodePoints: [],
        },
      },
    });

    expect(text).toContain("Dialogue:");
    expect(text).toContain("中文 text");
    expect(text).not.toContain("\\fnMicrosoft YaHei");
  });

  it("trusts the selected font until glyph coverage has been checked", () => {
    const styles = stylesWithFonts({ Primary: "Unknown CJK Font" });
    const cues: SubtitleCue[] = [
      {
        id: "cue-1",
        startMs: 1000,
        endMs: 2500,
        primaryText: "中文 text",
        style: "Primary",
        layer: 0,
      },
    ];

    const text = buildPreviewAssText({
      cues,
      styles,
      scriptInfo: createDefaultScriptInfo("Preview", 1280, 720),
      mergeMode: "inline",
      libassFallbackFontName: "Microsoft YaHei",
    });

    expect(text).toContain("中文 text");
    expect(text).not.toContain("\\fnMicrosoft YaHei");
  });

  it("keeps localized font names in preview ASS when no glyph fallback is needed", () => {
    const styles = stylesWithFonts({ Primary: ".苹方-简" });
    const cues: SubtitleCue[] = [
      {
        id: "cue-1",
        startMs: 1000,
        endMs: 2500,
        primaryText: "{\\fnメイリオ}日本語{\\fn.苹方-简}中文",
        style: "Primary",
        layer: 0,
      },
    ];

    const text = buildPreviewAssText({
      cues,
      styles,
      scriptInfo: createDefaultScriptInfo("Preview", 1280, 720),
      mergeMode: "inline",
    });

    expect(text).toContain("Style: Primary,.苹方-简");
    expect(text).toContain("{\\fnメイリオ}日本語{\\fn.苹方-简}中文");
    expect(styles.find((style) => style.name === "Primary")?.fontName).toBe(
      ".苹方-简",
    );
  });
});
