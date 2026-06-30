import { describe, expect, it } from "vitest";
import type { AssStyle, SubtitleCue } from "@hikaru/ass-core";
import type { PreviewFontFile } from "../types";
import { selectLibassPreviewFonts } from "./libassFontSelection";

function font(fileName: string): PreviewFontFile {
  return {
    fileName,
    path: `C:\\Windows\\Fonts\\${fileName}`,
    url: `http://127.0.0.1/font/${fileName}`,
  };
}

function style(fontName: string): AssStyle {
  return {
    name: "Primary",
    fontName,
    fontSize: 48,
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
    shadow: 0,
    alignment: 2,
    marginL: 20,
    marginR: 20,
    marginV: 40,
    encoding: 1,
  };
}

describe("selectLibassPreviewFonts", () => {
  it("prefers fonts that match ASS style names and avoids preloading the whole system font list", () => {
    const fonts = [
      font("arial.ttf"),
      font("NotoSansSC-Regular.otf"),
      font("NotoSansSC-Thin.otf"),
      ...Array.from({ length: 40 }, (_, index) => font(`Other${index}.ttf`)),
    ];

    const selected = selectLibassPreviewFonts(fonts, [
      style("Noto Sans SC Thin"),
    ]);

    expect(selected.defaultFont).toBe("Noto Sans SC Thin");
    expect(selected.fontUrls[0]).toBe(
      "http://127.0.0.1/font/NotoSansSC-Thin.otf",
    );
    expect(selected.fontUrls.length).toBeLessThan(fonts.length);
  });

  it("adds a small CJK fallback when style fonts are not found", () => {
    const selected = selectLibassPreviewFonts(
      [font("arial.ttf"), font("msyh.ttc"), font("simsun.ttc")],
      [style("Missing Font")],
    );

    expect(selected.defaultFont).toBe("Microsoft YaHei");
    expect(selected.fontUrls).toEqual(["http://127.0.0.1/font/msyh.ttc"]);
  });

  it("preloads multiple font files that belong to the requested ASS family", () => {
    const selected = selectLibassPreviewFonts(
      [
        font("NotoSansSC-Regular.otf"),
        font("NotoSansSC-Bold.otf"),
        font("NotoSansSC-Thin.otf"),
        font("arial.ttf"),
      ],
      [style("Noto Sans SC")],
    );

    expect(selected.fontUrls).toEqual([
      "http://127.0.0.1/font/NotoSansSC-Regular.otf",
      "http://127.0.0.1/font/NotoSansSC-Bold.otf",
      "http://127.0.0.1/font/NotoSansSC-Thin.otf",
    ]);
  });

  it("includes ASS inline override fonts from current cue text", () => {
    const cues: SubtitleCue[] = [
      {
        id: "cue-1",
        startMs: 0,
        endMs: 1000,
        primaryText: "{\\fnInline Font}本文",
        secondaryText: "译文",
        style: "Primary",
        layer: 0,
      },
    ];

    const selected = selectLibassPreviewFonts(
      [font("PrimaryFont-Regular.otf"), font("InlineFont-Regular.otf")],
      [style("Primary Font")],
      { cues, mergeMode: "inline" },
    );

    expect(selected.fontUrls).toContain(
      "http://127.0.0.1/font/InlineFont-Regular.otf",
    );
  });
});
