import { describe, expect, it } from "vitest";
import {
  type AssStyle,
  type SubtitleCue,
} from "@/lib/ass";
import type { PreviewFontFile } from "../types";
import {
  findBestPreviewFontFile,
  selectLibassPreviewFonts,
} from "./libassFontSelection";

function font(
  fileName: string,
  names: Partial<
    Pick<PreviewFontFile, "displayName" | "familyNames" | "fontNames">
  > = {},
): PreviewFontFile {
  return {
    fileName,
    path: `C:\\Windows\\Fonts\\${fileName}`,
    url: `http://127.0.0.1/font/${fileName}`,
    ...names,
  } as PreviewFontFile;
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

  it("keeps the matched style font as the libass default when glyph fallback is needed", () => {
    const cues: SubtitleCue[] = [
      {
        id: "cue-1",
        startMs: 0,
        endMs: 1000,
        primaryText: "中文会在 Arial 中缺字",
        style: "Primary",
        layer: 0,
      },
    ];

    const selected = selectLibassPreviewFonts(
      [font("arial.ttf"), font("msyh.ttc")],
      [style("Arial")],
      { cues, mergeMode: "inline" },
    );

    expect(selected.fontUrls).toEqual([
      "http://127.0.0.1/font/arial.ttf",
      "http://127.0.0.1/font/msyh.ttc",
    ]);
    expect(selected.defaultFont).toBe("Arial");
    expect(selected.glyphFallbackFont).toBe("Microsoft YaHei");
  });

  it("matches localized family names discovered from the font name table", () => {
    const selected = selectLibassPreviewFonts(
      [
        font("SourceHanSansSC-Regular.otf", {
          displayName: "思源黑体 CN",
          familyNames: ["思源黑体 CN", "Source Han Sans SC"],
        }),
        font("msyh.ttc", {
          displayName: "微软雅黑",
          familyNames: ["微软雅黑", "Microsoft YaHei"],
        }),
      ],
      [style("思源黑体 CN")],
      {
        cues: [
          {
            id: "cue-1",
            startMs: 0,
            endMs: 1000,
            primaryText: "中文",
            style: "Primary",
            layer: 0,
          },
        ],
        mergeMode: "inline",
      },
    );

    expect(selected.fontUrls[0]).toBe(
      "http://127.0.0.1/font/SourceHanSansSC-Regular.otf",
    );
    expect(selected.defaultFont).toBe("思源黑体 CN");
    expect(selected.availableFonts).toMatchObject({
      "思源黑体 CN": "http://127.0.0.1/font/SourceHanSansSC-Regular.otf",
      "Source Han Sans SC":
        "http://127.0.0.1/font/SourceHanSansSC-Regular.otf",
    });
  });

  it("uses a libass-friendly family when a Japanese localized font name is selected", () => {
    const selected = selectLibassPreviewFonts(
      [
        font("meiryo.ttc", {
          displayName: "メイリオ",
          familyNames: ["メイリオ", "Meiryo"],
        }),
        font("msyh.ttc", {
          displayName: "微软雅黑",
          familyNames: ["微软雅黑", "Microsoft YaHei"],
        }),
      ],
      [style("メイリオ")],
      {
        cues: [
          {
            id: "cue-1",
            startMs: 0,
            endMs: 1000,
            primaryText: "日本語と中文",
            style: "Primary",
            layer: 0,
          },
        ],
        mergeMode: "inline",
      },
    );

    expect(selected.fontUrls[0]).toBe("http://127.0.0.1/font/meiryo.ttc");
    expect(selected.defaultFont).toBe("メイリオ");
    expect(selected.availableFonts).toMatchObject({
      メイリオ: "http://127.0.0.1/font/meiryo.ttc",
      Meiryo: "http://127.0.0.1/font/meiryo.ttc",
    });
  });

  it("registers hidden localized PingFang names without rewriting the selected family", () => {
    const selected = selectLibassPreviewFonts(
      [
        font("PingFang.ttc", {
          displayName: ".苹方-简",
          familyNames: [".苹方-简", ".PingFang SC", "PingFang SC"],
          fontNames: [
            ".苹方-简",
            ".PingFang SC",
            "PingFangSC-Regular",
            "PingFang SC",
          ],
        }),
      ],
      [style(".苹方-简")],
      {
        cues: [
          {
            id: "cue-1",
            startMs: 0,
            endMs: 1000,
            primaryText: "中文",
            style: "Primary",
            layer: 0,
          },
        ],
        mergeMode: "inline",
      },
    );

    expect(selected.fontUrls).toEqual(["http://127.0.0.1/font/PingFang.ttc"]);
    expect(selected.defaultFont).toBe(".苹方-简");
    expect(selected.availableFonts).toMatchObject({
      ".苹方-简": "http://127.0.0.1/font/PingFang.ttc",
      ".PingFang SC": "http://127.0.0.1/font/PingFang.ttc",
      "PingFangSC-Regular": "http://127.0.0.1/font/PingFang.ttc",
      "PingFang SC": "http://127.0.0.1/font/PingFang.ttc",
    });
  });

  it("matches leading-dot localized family names directly", () => {
    const pingFang = font("PingFang.ttc", {
      displayName: ".苹方-简",
      familyNames: [".苹方-简"],
      fontNames: [".苹方-简"],
    });

    expect(findBestPreviewFontFile([pingFang], ".苹方-简")).toBe(pingFang);

    const selected = selectLibassPreviewFonts([pingFang], [style(".苹方-简")]);

    expect(selected.fontUrls).toEqual(["http://127.0.0.1/font/PingFang.ttc"]);
    expect(selected.defaultFont).toBe(".苹方-简");
  });

  it("does not let leading-dot compatibility names override exact discovered names", () => {
    const selected = selectLibassPreviewFonts(
      [
        font("VisiblePingFang.ttc", {
          displayName: "苹方-简",
          familyNames: ["苹方-简"],
          fontNames: ["苹方-简"],
        }),
        font("HiddenPingFang.ttc", {
          displayName: ".苹方-简",
          familyNames: [".苹方-简"],
          fontNames: [".苹方-简"],
        }),
      ],
      [style("苹方-简")],
      {
        cues: [
          {
            id: "cue-1",
            startMs: 0,
            endMs: 1000,
            primaryText: "{\\fn.苹方-简}中文",
            style: "Primary",
            layer: 0,
          },
        ],
        mergeMode: "inline",
      },
    );

    expect(selected.availableFonts["苹方-简"]).toBe(
      "http://127.0.0.1/font/VisiblePingFang.ttc",
    );
    expect(selected.availableFonts[".苹方-简"]).toBe(
      "http://127.0.0.1/font/HiddenPingFang.ttc",
    );
  });

  it("matches Microsoft YaHei to the Windows msyh font before generic CJK fallbacks", () => {
    const cues: SubtitleCue[] = [
      {
        id: "cue-1",
        startMs: 0,
        endMs: 1000,
        primaryText: "微软雅黑中文",
        style: "Primary",
        layer: 0,
      },
    ];

    const selected = selectLibassPreviewFonts(
      [font("malgun.ttf"), font("msyh.ttc"), font("simsun.ttc")],
      [style("Microsoft YaHei")],
      { cues, mergeMode: "inline" },
    );

    expect(selected.fontUrls[0]).toBe("http://127.0.0.1/font/msyh.ttc");
    expect(selected.defaultFont).toBe("Microsoft YaHei");
  });

  it("uses the canonical family as the libass default for file-style CJK aliases", () => {
    const selected = selectLibassPreviewFonts(
      [font("msyh.ttc")],
      [style("msyh")],
    );

    expect(selected.fontUrls).toEqual(["http://127.0.0.1/font/msyh.ttc"]);
    expect(selected.defaultFont).toBe("Microsoft YaHei");
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
