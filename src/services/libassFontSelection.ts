import {
  getCueDisplay,
  parseAssTextLines,
  SECONDARY_STYLE,
  type AssStyle,
  type SubtitleCue,
} from "@hikaru/ass-core";
import type { PreviewFontFile } from "../types";

const MAX_PRELOAD_FONTS = 12;

const CJK_FALLBACKS: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /notosanssc|notosanscjksc/i, family: "Noto Sans SC" },
  { pattern: /notosansjp|notosanscjkjp/i, family: "Noto Sans CJK JP" },
  { pattern: /sourcehansanssc|sourcehansc/i, family: "Source Han Sans SC" },
  { pattern: /sourcehansansjp|sourcehanjp/i, family: "Source Han Sans JP" },
  { pattern: /msyh/i, family: "Microsoft YaHei" },
  { pattern: /simsun/i, family: "SimSun" },
  { pattern: /simhei/i, family: "SimHei" },
  { pattern: /meiryo/i, family: "Meiryo" },
  { pattern: /msgothic|msmincho/i, family: "MS Gothic" },
  { pattern: /yugoth|yumin/i, family: "Yu Gothic" },
  { pattern: /hiragino/i, family: "Hiragino Sans" },
  { pattern: /pingfang/i, family: "PingFang SC" },
];

export interface LibassPreviewFontSelection {
  fontUrls: string[];
  defaultFont?: string;
}

interface SelectLibassPreviewFontsOptions {
  cues?: SubtitleCue[];
  mergeMode?: "inline" | "separate";
}

function normalizeFontName(value: string): string {
  return value
    .replace(/\.[^.]+$/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

function matchesStyleFont(fileName: string, styleFontName: string): boolean {
  const file = normalizeFontName(fileName);
  const style = normalizeFontName(styleFontName);
  return style.length > 0 && (file.includes(style) || style.includes(file));
}

function findStyle(styles: AssStyle[], styleName?: string): AssStyle | null {
  if (!styleName) return styles[0] ?? null;
  return (
    styles.find(
      (style) => style.name.toLowerCase() === styleName.toLowerCase(),
    ) ??
    styles[0] ??
    null
  );
}

function inferFallbackFamily(fileName: string): string | null {
  const compact = normalizeFontName(fileName);
  return CJK_FALLBACKS.find((fallback) => fallback.pattern.test(compact))
    ?.family ?? null;
}

function pushUnique(
  selected: PreviewFontFile[],
  seenUrls: Set<string>,
  font: PreviewFontFile,
): void {
  if (seenUrls.has(font.url)) return;
  seenUrls.add(font.url);
  selected.push(font);
}

function pushFontName(fontNames: string[], seenNames: Set<string>, fontName: string) {
  const trimmed = fontName.trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (seenNames.has(key)) return;
  seenNames.add(key);
  fontNames.push(trimmed);
}

function collectCueFontNames(
  cues: SubtitleCue[],
  styles: AssStyle[],
  mergeMode: "inline" | "separate",
): string[] {
  const fontNames: string[] = [];
  const seenNames = new Set<string>();

  const collectText = (text: string, baseStyle: AssStyle | null) => {
    if (!baseStyle) return;
    const lines = parseAssTextLines(text, baseStyle, {
      resolveStyle: (name) => findStyle(styles, name) ?? undefined,
    });
    for (const line of lines) {
      for (const run of line.runs) {
        pushFontName(fontNames, seenNames, run.style.fontName);
        if (run.inline.fontName) {
          pushFontName(fontNames, seenNames, run.inline.fontName);
        }
      }
    }
  };

  for (const cue of cues) {
    const display = getCueDisplay(cue, mergeMode);
    if (display.mode === "single") {
      collectText(display.text, findStyle(styles, cue.style));
    } else {
      collectText(display.primaryText, findStyle(styles, cue.style));
      collectText(display.secondaryText, findStyle(styles, SECONDARY_STYLE));
    }
  }

  return fontNames;
}

export function selectLibassPreviewFonts(
  fonts: PreviewFontFile[],
  styles: AssStyle[],
  options: SelectLibassPreviewFontsOptions = {},
): LibassPreviewFontSelection {
  const selected: PreviewFontFile[] = [];
  const seenUrls = new Set<string>();
  const seenNames = new Set<string>();
  const styleFontNames: string[] = [];
  for (const style of styles) {
    pushFontName(styleFontNames, seenNames, style.fontName);
  }
  if (options.cues) {
    for (const fontName of collectCueFontNames(
      options.cues,
      styles,
      options.mergeMode ?? "inline",
    )) {
      pushFontName(styleFontNames, seenNames, fontName);
    }
  }
  let defaultFont: string | undefined;

  for (const styleFontName of styleFontNames) {
    for (const match of fonts.filter((font) =>
      matchesStyleFont(font.fileName, styleFontName),
    )) {
      pushUnique(selected, seenUrls, match);
      defaultFont ??= styleFontName;
      if (selected.length >= MAX_PRELOAD_FONTS) break;
    }
    if (selected.length >= MAX_PRELOAD_FONTS) break;
  }

  for (const font of fonts) {
    const fallbackFamily = inferFallbackFamily(font.fileName);
    if (!fallbackFamily) continue;
    pushUnique(selected, seenUrls, font);
    defaultFont ??= fallbackFamily;
    break;
  }

  if (selected.length === 0 && fonts.length <= MAX_PRELOAD_FONTS) {
    for (const font of fonts) {
      pushUnique(selected, seenUrls, font);
    }
  }

  return {
    fontUrls: selected.map((font) => font.url),
    defaultFont,
  };
}
