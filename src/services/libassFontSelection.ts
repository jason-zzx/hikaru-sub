import {
  getCueDisplay,
  parseAssTextLines,
  SECONDARY_STYLE,
  type AssStyle,
  type SubtitleCue,
} from "@hikaru/ass-core";
import type { PreviewFontFile } from "../types";
import {
  canonicalFontFamilyName,
  cjkFallbackPriority,
  isKnownCjkFontName,
  normalizeFontLookupName,
} from "../utils/fontFamilyAliases";

const MAX_PRELOAD_FONTS = 12;

const CJK_TEXT_RE =
  /[\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/u;

export interface LibassPreviewFontSelection {
  fontUrls: string[];
  fontFiles: PreviewFontFile[];
  availableFonts: Record<string, string>;
  defaultFont?: string;
  glyphFallbackFont?: string;
}

interface SelectLibassPreviewFontsOptions {
  cues?: SubtitleCue[];
  mergeMode?: "inline" | "separate";
}

function inferFallbackFamily(fileName: string): string | null {
  return canonicalFontFamilyName(fileName);
}

function fontLookupNames(font: PreviewFontFile): string[] {
  return [
    font.displayName ?? "",
    ...(font.familyNames ?? []),
    ...(font.fontNames ?? []),
    font.fileName,
    inferFallbackFamily(font.fileName) ?? "",
  ].filter((name) => name.trim().length > 0);
}

function stripHiddenFontPrefix(fontName: string): string {
  return fontName.trim().replace(/^\.+/u, "").trim();
}

function uniqueFontNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function metadataFontNames(font: PreviewFontFile): string[] {
  return uniqueFontNames([
    font.displayName ?? "",
    ...(font.familyNames ?? []),
    ...(font.fontNames ?? []),
  ]);
}

function libassRenderFontName(
  font: PreviewFontFile,
  requestedFontName: string,
): string {
  const requested = requestedFontName.trim();
  const requestedKey = normalizeFontLookupName(requested);
  const metadataNames = metadataFontNames(font);

  if (metadataNames.some((name) => name === requested)) {
    return requested;
  }

  const canonical = canonicalFontFamilyName(requested);
  if (
    canonical &&
    (requestedKey === normalizeFontLookupName(canonical) || !/\s/u.test(requested))
  ) {
    return canonical;
  }

  const metadataMatch = metadataNames.find(
    (name) => normalizeFontLookupName(name) === requestedKey,
  );
  if (metadataMatch) return metadataMatch;

  return requested;
}

function styleFontMatchRank(font: PreviewFontFile, styleFontName: string): number | null {
  const style = normalizeFontLookupName(styleFontName);
  if (style.length === 0) return null;

  let best: number | null = null;
  for (const fontName of fontLookupNames(font)) {
    const file = normalizeFontLookupName(fontName);
    if (!file) continue;

    let rank: number | null = null;
    if (file === style) {
      rank = 0;
    } else if (file.includes(style) || style.includes(file)) {
      rank = 1;
    } else {
      const fileFamily = canonicalFontFamilyName(fontName);
      const styleFamily = canonicalFontFamilyName(styleFontName);
      if (
        fileFamily !== null &&
        styleFamily !== null &&
        fileFamily.toLowerCase() === styleFamily.toLowerCase()
      ) {
        rank = 2;
      }
    }

    if (rank !== null && (best === null || rank < best)) {
      best = rank;
    }
  }

  return best;
}

export function findBestPreviewFontFile(
  fonts: PreviewFontFile[],
  fontName: string,
): PreviewFontFile | null {
  return (
    fonts
      .map((font, index) => ({
        font,
        index,
        rank: styleFontMatchRank(font, fontName),
      }))
      .filter(
        (
          match,
        ): match is { font: PreviewFontFile; index: number; rank: number } =>
          match.rank !== null,
      )
      .sort(
        (left, right) => left.rank - right.rank || left.index - right.index,
      )[0]?.font ?? null
  );
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

function isCjkCapableFontName(fontName: string): boolean {
  return isKnownCjkFontName(fontName);
}

function preferredFontNameForMatch(
  font: PreviewFontFile,
  requestedFontName: string,
): string {
  return libassRenderFontName(font, requestedFontName);
}

function exactAvailableFontNames(font: PreviewFontFile): string[] {
  return uniqueFontNames(fontLookupNames(font));
}

function compatibilityAvailableFontNames(font: PreviewFontFile): string[] {
  return uniqueFontNames(fontLookupNames(font).map(stripHiddenFontPrefix));
}

function setAvailableFont(
  availableFonts: Record<string, string>,
  name: string,
  url: string,
): void {
  if (Object.prototype.hasOwnProperty.call(availableFonts, name)) return;
  availableFonts[name] = url;
}

function buildAvailableFonts(fonts: PreviewFontFile[]): Record<string, string> {
  const availableFonts: Record<string, string> = {};

  for (const font of fonts) {
    for (const name of exactAvailableFontNames(font)) {
      setAvailableFont(availableFonts, name, font.url);
    }
  }

  for (const font of fonts) {
    for (const name of compatibilityAvailableFontNames(font)) {
      setAvailableFont(availableFonts, name, font.url);
    }
  }

  return availableFonts;
}

function containsCjkText(text: string): boolean {
  return CJK_TEXT_RE.test(text);
}

function cuesContainCjkText(
  cues: SubtitleCue[],
  mergeMode: "inline" | "separate",
): boolean {
  return cues.some((cue) => {
    const display = getCueDisplay(cue, mergeMode);
    return display.mode === "single"
      ? containsCjkText(display.text)
      : containsCjkText(display.primaryText) ||
          containsCjkText(display.secondaryText);
  });
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

function selectBestCjkFallbackFont(
  fonts: PreviewFontFile[],
): PreviewFontFile | null {
  let best: { font: PreviewFontFile; priority: number; index: number } | null =
    null;

  for (const [index, font] of fonts.entries()) {
    const candidates = fontLookupNames(font).filter(isCjkCapableFontName);
    if (candidates.length === 0) continue;

    const priority = Math.min(...candidates.map(cjkFallbackPriority));
    if (
      !best ||
      priority < best.priority ||
      (priority === best.priority && index < best.index)
    ) {
      best = { font, priority, index };
    }
  }

  return best?.font ?? null;
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
  const mergeMode = options.mergeMode ?? "inline";
  const needsCjkFallback = options.cues
    ? cuesContainCjkText(options.cues, mergeMode)
    : false;
  let matchedStyleDefaultFont: string | undefined;
  let fallbackDefaultFont: string | undefined;

  for (const styleFontName of styleFontNames) {
    const matches = fonts
      .map((font, index) => ({
        font,
        index,
        rank: styleFontMatchRank(font, styleFontName),
      }))
      .filter(
        (
          match,
        ): match is { font: PreviewFontFile; index: number; rank: number } =>
          match.rank !== null,
      )
      .sort(
        (left, right) => left.rank - right.rank || left.index - right.index,
      );

    for (const { font: match } of matches) {
      pushUnique(selected, seenUrls, match);
      const renderFontName = preferredFontNameForMatch(match, styleFontName);
      matchedStyleDefaultFont ??= renderFontName;
      if (selected.length >= MAX_PRELOAD_FONTS) break;
    }
    if (selected.length >= MAX_PRELOAD_FONTS) break;
  }

  const fallbackFont = selectBestCjkFallbackFont(fonts);
  if (fallbackFont) {
    pushUnique(selected, seenUrls, fallbackFont);
    fallbackDefaultFont = libassRenderFontName(
      fallbackFont,
      fallbackFont.displayName?.trim() ||
        fallbackFont.familyNames?.[0]?.trim() ||
        inferFallbackFamily(fallbackFont.fileName) ||
        fallbackFont.fileName,
    );
  }

  if (selected.length === 0 && fonts.length <= MAX_PRELOAD_FONTS) {
    for (const font of fonts) {
      pushUnique(selected, seenUrls, font);
    }
  }

  const defaultFont = matchedStyleDefaultFont ?? fallbackDefaultFont;
  const glyphFallbackFont = needsCjkFallback ? fallbackDefaultFont : undefined;

  return {
    fontUrls: selected.map((font) => font.url),
    fontFiles: selected,
    availableFonts: buildAvailableFonts(selected),
    defaultFont,
    glyphFallbackFont,
  };
}
