import type { AssStyle } from "@hikaru/ass-core";

export interface ToggleOverrideTag {
  startTag: string;
  endTag: string;
}

export interface ToggleOverrideResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function commandName(tag: string): string {
  const match = tag.match(/\\([A-Za-z]+)/);
  return match?.[1] ?? "";
}

function isCommandOpenBeforeCursor(text: string, tag: ToggleOverrideTag): boolean {
  const command = commandName(tag.startTag);
  if (!command) return false;

  const pattern = new RegExp(
    `\\{[^}]*\\\\${escapeRegExp(command)}([01])[^}]*\\}`,
    "g",
  );
  let open = false;
  for (const match of text.matchAll(pattern)) {
    open = match[1] === "1";
  }
  return open;
}

export function applyToggleOverrideTag(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  tag: ToggleOverrideTag,
): ToggleOverrideResult {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));

  if (start !== end) {
    const nextText =
      text.slice(0, start) +
      tag.startTag +
      text.slice(start, end) +
      tag.endTag +
      text.slice(end);
    const nextCursor = end + tag.startTag.length + tag.endTag.length;
    return {
      text: nextText,
      selectionStart: nextCursor,
      selectionEnd: nextCursor,
    };
  }

  const nextTag = isCommandOpenBeforeCursor(text.slice(0, start), tag)
    ? tag.endTag
    : tag.startTag;
  const nextText = text.slice(0, start) + nextTag + text.slice(start);
  const nextCursor = start + nextTag.length;
  return {
    text: nextText,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

export interface AttributeOverrideTag {
  startTag: string;
  restoreTag?: string;
}

export type AttributeOverrideKind =
  | "fontName"
  | "fontSize"
  | "primaryColor"
  | "outlineColor"
  | "backColor"
  | "outline"
  | "shadow"
  | "alignment";

function formatAssNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function validAlignment(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 9;
}

export function applyAttributeOverrideTag(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  tag: AttributeOverrideTag,
): ToggleOverrideResult {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));

  if (start !== end && tag.restoreTag) {
    const nextText =
      text.slice(0, start) +
      tag.startTag +
      text.slice(start, end) +
      tag.restoreTag +
      text.slice(end);
    const nextCursor = end + tag.startTag.length + tag.restoreTag.length;
    return {
      text: nextText,
      selectionStart: nextCursor,
      selectionEnd: nextCursor,
    };
  }

  const nextText = text.slice(0, start) + tag.startTag + text.slice(start);
  const nextCursor = start + tag.startTag.length;
  return {
    text: nextText,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

export type ColorOverrideKind =
  | "primaryColor"
  | "outlineColor"
  | "backColor";

const COLOR_TAG_PREFIX: Record<ColorOverrideKind, { c: string; a: string }> = {
  primaryColor: { c: "c", a: "1a" },
  outlineColor: { c: "3c", a: "3a" },
  backColor: { c: "4c", a: "4a" },
};

/** Split an ASS color `&HAABBGGRR` into BGR (6 hex) and alpha byte (2 hex). */
function splitAssColorChannels(assColor: string): { bgr: string; alpha: string } {
  const hex = assColor.trim().replace(/^&H/i, "").replace(/&$/, "");
  const padded = hex.padStart(8, "0").toUpperCase();
  return {
    bgr: `${padded.slice(2, 4)}${padded.slice(4, 6)}${padded.slice(6, 8)}`,
    alpha: padded.slice(0, 2),
  };
}

/**
 * Build a color override start tag with the alpha split into a separate `\Xa`
 * tag and `\Xc` reduced to 6-digit BGR. libass/jASSUB do not reliably apply the
 * alpha byte embedded in `\Xc`; the Aegisub convention (BGR color + `\Xa`)
 * renders in both libass and the CSS fallback.
 */
export function colorOverrideStartTag(
  kind: ColorOverrideKind,
  assColor: string,
): string {
  const { c, a } = COLOR_TAG_PREFIX[kind];
  const { bgr, alpha } = splitAssColorChannels(assColor);
  return `{\\${c}&H${bgr}\\${a}&H${alpha}}`;
}

/**
 * Replace the line's alignment: strip every existing `\an[1-9]` command (and
 * clean up empty override blocks), then prepend `{\anN}` at the very front.
 * Alignment is a paragraph-level property, so it replaces rather than stacks.
 */
export function applyAlignmentReplace(
  text: string,
  alignment: number,
): ToggleOverrideResult {
  const tag = `{\\an${alignment}}`;
  const stripped = text.replace(/\\an[1-9]/g, "").replace(/\{\s*\}/g, "");
  const nextText = tag + stripped;
  const leading = stripped.match(/^\{[^}]*\}/);
  const contentStart = tag.length + (leading ? leading[0].length : 0);
  return {
    text: nextText,
    selectionStart: contentStart,
    selectionEnd: contentStart,
  };
}

/** Last `\an[1-9]` value in the text, falling back to the provided default. */
export function findEffectiveAlignment(
  text: string,
  fallback?: number,
): number | undefined {
  const matches = [...text.matchAll(/\\an([1-9])/g)];
  if (matches.length > 0) return Number(matches[matches.length - 1][1]);
  return fallback;
}

export function restoreTagForStyle(
  kind: AttributeOverrideKind,
  style: AssStyle | undefined,
): string | undefined {
  if (!style) return undefined;

  switch (kind) {
    case "fontName":
      return style.fontName ? `{\\fn${style.fontName}}` : undefined;
    case "fontSize":
      return `{\\fs${Math.round(style.fontSize)}}`;
    case "primaryColor":
      return colorOverrideStartTag("primaryColor", style.primaryColor);
    case "outlineColor":
      return colorOverrideStartTag("outlineColor", style.outlineColor);
    case "backColor":
      return colorOverrideStartTag("backColor", style.backColor);
    case "outline":
      return `{\\bord${formatAssNumber(style.outline)}}`;
    case "shadow":
      return `{\\shad${formatAssNumber(style.shadow)}}`;
    case "alignment":
      return validAlignment(style.alignment)
        ? `{\\an${style.alignment}}`
        : undefined;
  }
}
