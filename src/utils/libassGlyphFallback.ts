import { SECONDARY_STYLE, type AssStyle, type SubtitleCue } from "@/lib/ass";
import { normalizeFontLookupName } from "./fontFamilyAliases";

const CJK_SEQUENCE_RE =
  /[\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]+/gu;

interface TextFallbackState {
  dialogueStyle: AssStyle;
  currentStyle: AssStyle;
  inlineFontName?: string;
}

interface ApplyLibassGlyphFallbackArgs {
  cues: SubtitleCue[];
  styles: AssStyle[];
  mergeMode: "inline" | "separate";
  fallbackFontName?: string;
  glyphCoverage?: LibassGlyphCoverageMap;
}

export interface LibassGlyphCoverageEntry {
  checkedCodePoints: number[];
  missingCodePoints: number[];
}

export type LibassGlyphCoverageMap = Record<string, LibassGlyphCoverageEntry>;

function sanitizeFontName(fontName: string): string {
  return fontName.trim().replace(/[{}]/g, "");
}

function sameFont(left: string, right: string): boolean {
  return normalizeFontLookupName(left) === normalizeFontLookupName(right);
}

export function libassGlyphCoverageKey(fontName: string): string {
  return normalizeFontLookupName(fontName);
}

function fontTag(fontName: string): string {
  return `{\\fn${sanitizeFontName(fontName)}}`;
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

function updateStateFromOverrideBlock(
  block: string,
  state: TextFallbackState,
  styles: AssStyle[],
): void {
  for (const tag of block.split("\\").filter(Boolean)) {
    if (tag === "r") {
      state.currentStyle = state.dialogueStyle;
      state.inlineFontName = undefined;
      continue;
    }

    if (/^r/i.test(tag)) {
      state.currentStyle =
        findStyle(styles, tag.slice(1)) ?? state.dialogueStyle;
      state.inlineFontName = undefined;
      continue;
    }

    const fontMatch = tag.match(/^fn(.+)/i);
    if (fontMatch) {
      state.inlineFontName = sanitizeFontName(fontMatch[1]);
    }
  }
}

function effectiveFontName(state: TextFallbackState): string {
  return state.inlineFontName ?? state.currentStyle.fontName;
}

function applyFallbackToPlainText(
  text: string,
  state: TextFallbackState,
  fallbackFontName: string,
  glyphCoverage: LibassGlyphCoverageMap | undefined,
): string {
  const currentFont = effectiveFontName(state);
  if (sameFont(currentFont, fallbackFontName)) {
    return text;
  }

  const coverage = glyphCoverage?.[libassGlyphCoverageKey(currentFont)];
  if (!coverage) return text;

  const checked = new Set(coverage.checkedCodePoints);
  const missing = new Set(coverage.missingCodePoints);
  let result = "";
  let fallbackRun = "";

  const flushFallback = () => {
    if (!fallbackRun) return;
    result += `${fontTag(fallbackFontName)}${fallbackRun}${fontTag(currentFont)}`;
    fallbackRun = "";
  };

  for (const char of Array.from(text)) {
    const codePoint = char.codePointAt(0);
    if (
      codePoint !== undefined &&
      checked.has(codePoint) &&
      missing.has(codePoint)
    ) {
      fallbackRun += char;
      continue;
    }

    flushFallback();
    result += char;
  }

  flushFallback();
  return result;
}

function applyFallbackToText(
  text: string,
  baseStyle: AssStyle | null,
  styles: AssStyle[],
  fallbackFontName: string,
  glyphCoverage: LibassGlyphCoverageMap | undefined,
): string {
  if (!baseStyle) return text;

  let result = "";
  let plainStart = 0;
  const state: TextFallbackState = {
    dialogueStyle: baseStyle,
    currentStyle: baseStyle,
  };

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue;

    const blockEnd = text.indexOf("}", index + 1);
    if (blockEnd === -1) continue;

    result += applyFallbackToPlainText(
      text.slice(plainStart, index),
      state,
      fallbackFontName,
      glyphCoverage,
    );

    const block = text.slice(index, blockEnd + 1);
    result += block;
    updateStateFromOverrideBlock(block.slice(1, -1), state, styles);
    index = blockEnd;
    plainStart = blockEnd + 1;
  }

  result += applyFallbackToPlainText(
    text.slice(plainStart),
    state,
    fallbackFontName,
    glyphCoverage,
  );
  return result;
}

function collectTextChecks(
  text: string,
  baseStyle: AssStyle | null,
  styles: AssStyle[],
  fallbackFontName: string,
  checks: Map<string, { fontName: string; codePoints: Set<number> }>,
): void {
  if (!baseStyle) return;

  let plainStart = 0;
  const state: TextFallbackState = {
    dialogueStyle: baseStyle,
    currentStyle: baseStyle,
  };

  const collectPlainText = (plain: string) => {
    const fontName = effectiveFontName(state);
    if (sameFont(fontName, fallbackFontName)) return;
    for (const match of plain.matchAll(CJK_SEQUENCE_RE)) {
      for (const char of Array.from(match[0])) {
        const codePoint = char.codePointAt(0);
        if (codePoint === undefined) continue;
        const key = libassGlyphCoverageKey(fontName);
        const existing = checks.get(key) ?? {
          fontName,
          codePoints: new Set<number>(),
        };
        existing.codePoints.add(codePoint);
        checks.set(key, existing);
      }
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue;
    const blockEnd = text.indexOf("}", index + 1);
    if (blockEnd === -1) continue;

    collectPlainText(text.slice(plainStart, index));
    updateStateFromOverrideBlock(text.slice(index + 1, blockEnd), state, styles);
    index = blockEnd;
    plainStart = blockEnd + 1;
  }

  collectPlainText(text.slice(plainStart));
}

export function collectLibassGlyphFontChecks({
  cues,
  styles,
  mergeMode,
  fallbackFontName,
}: ApplyLibassGlyphFallbackArgs): Array<{
  fontName: string;
  codePoints: number[];
}> {
  const fallback = sanitizeFontName(fallbackFontName ?? "");
  if (!fallback) return [];
  const checks = new Map<string, { fontName: string; codePoints: Set<number> }>();

  for (const cue of cues) {
    collectTextChecks(
      cue.primaryText,
      findStyle(styles, cue.style),
      styles,
      fallback,
      checks,
    );
    if (cue.secondaryText !== undefined) {
      collectTextChecks(
        cue.secondaryText,
        mergeMode === "separate"
          ? findStyle(styles, SECONDARY_STYLE)
          : findStyle(styles, cue.style),
        styles,
        fallback,
        checks,
      );
    }
  }

  return [...checks.values()].map((check) => ({
    fontName: check.fontName,
    codePoints: [...check.codePoints],
  }));
}

export function applyLibassGlyphFallbackToCues({
  cues,
  styles,
  mergeMode,
  fallbackFontName,
  glyphCoverage,
}: ApplyLibassGlyphFallbackArgs): SubtitleCue[] {
  const fallback = sanitizeFontName(fallbackFontName ?? "");
  if (!fallback) return cues;

  return cues.map((cue) => {
    const primaryStyle = findStyle(styles, cue.style);
    const secondaryStyle =
      mergeMode === "separate" ? findStyle(styles, SECONDARY_STYLE) : primaryStyle;

    return {
      ...cue,
      primaryText: applyFallbackToText(
        cue.primaryText,
        primaryStyle,
        styles,
        fallback,
        glyphCoverage,
      ),
      secondaryText:
        cue.secondaryText === undefined
          ? undefined
          : applyFallbackToText(
              cue.secondaryText,
              secondaryStyle,
              styles,
              fallback,
              glyphCoverage,
            ),
    };
  });
}
