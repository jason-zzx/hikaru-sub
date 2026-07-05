import type { AssStyle } from "./types";

/** 行内 override 相对 Dialogue Style 的可选覆盖。空对象表示完全沿用 base。 */
export interface AssInlineOverrides {
  bold?: boolean | number;
  italic?: boolean;
  underline?: boolean;
  strikeOut?: boolean;
  primaryColor?: string;
  /** CSS alpha 0–1；由 \\alpha / \\1a 设置。 */
  primaryAlpha?: number;
  /** CSS alpha 0–1；由 \\3a 设置。 */
  outlineAlpha?: number;
  /** CSS alpha 0–1；由 \\4a 设置。 */
  backAlpha?: number;
  fontSize?: number;
  fontName?: string;
  scaleX?: number;
  scaleY?: number;
  spacing?: number;
  outline?: number;
  shadow?: number;
  outlineColor?: string;
  backColor?: string;
}

export interface AssTextRun {
  text: string;
  inline: AssInlineOverrides;
  /** 受 \\r / \\rName 影响的有效 Style 基准。 */
  style: AssStyle;
}

export interface AssTextLine {
  runs: AssTextRun[];
}

export interface ParseAssTextOptions {
  /** \\rStyleName 时解析目标样式。 */
  resolveStyle?: (name: string) => AssStyle | undefined;
}

const ASS_COLOR_RE = /^&H([0-9A-Fa-f]+)&?/;

function normalizeAssColor(raw: string): string {
  const m = raw.match(ASS_COLOR_RE);
  if (!m) return "&H00FFFFFF";
  return `&H${m[1].padStart(8, "0").toUpperCase()}`;
}

/** ASS \\alpha 字节 → CSS alpha（0 不透明，1 全透明）。 */
function assAlphaByteToCss(aa: number): number {
  return (255 - Math.max(0, Math.min(255, aa))) / 255;
}

function parseAlphaValue(raw: string): number | undefined {
  const m = raw.match(ASS_COLOR_RE);
  if (!m) return undefined;
  const hex = m[1];
  const val = parseInt(hex, 16);
  if (!Number.isFinite(val)) return undefined;
  // \alpha / \Xa carry the alpha byte as the value: a 1–2 digit value is the
  // byte itself; a full &HAABBGGRR value uses the high byte (AA).
  const aa = hex.length > 2 ? (val >>> 24) & 0xff : val & 0xff;
  return assAlphaByteToCss(aa);
}

class ParserState {
  dialogueStyle: AssStyle;
  base: AssStyle;
  inline: AssInlineOverrides = {};

  constructor(dialogueStyle: AssStyle) {
    this.dialogueStyle = dialogueStyle;
    this.base = dialogueStyle;
  }

  resetToStyle(style: AssStyle) {
    this.base = style;
    this.inline = {};
  }

  snapshotInline(): AssInlineOverrides {
    return { ...this.inline };
  }
}

function applyTag(
  raw: string,
  state: ParserState,
  resolveStyle?: (name: string) => AssStyle | undefined,
): void {
  if (!raw) return;

  if (raw === "r") {
    state.resetToStyle(state.dialogueStyle);
    return;
  }
  if (raw.startsWith("r")) {
    const styleName = raw.slice(1);
    const resolved = styleName ? resolveStyle?.(styleName) : undefined;
    state.resetToStyle(resolved ?? state.dialogueStyle);
    return;
  }

  let m = raw.match(/^b(-?\d+)?$/i);
  if (m) {
    if (m[1] === undefined) state.inline.bold = true;
    else if (m[1] === "-1") delete state.inline.bold;
    else if (m[1] === "0") state.inline.bold = false;
    else if (m[1] === "1") state.inline.bold = true;
    else state.inline.bold = Number(m[1]);
    return;
  }

  m = raw.match(/^i(-?\d+)?$/i);
  if (m) {
    if (!m[1] || m[1] === "1") state.inline.italic = true;
    else if (m[1] === "-1") delete state.inline.italic;
    else if (m[1] === "0") state.inline.italic = false;
    return;
  }

  m = raw.match(/^u(-?\d+)?$/i);
  if (m) {
    if (!m[1] || m[1] === "1") state.inline.underline = true;
    else if (m[1] === "-1") delete state.inline.underline;
    else if (m[1] === "0") state.inline.underline = false;
    return;
  }

  m = raw.match(/^s(-?\d+)?$/i);
  if (m) {
    if (!m[1] || m[1] === "1") state.inline.strikeOut = true;
    else if (m[1] === "-1") delete state.inline.strikeOut;
    else if (m[1] === "0") state.inline.strikeOut = false;
    return;
  }

  m = raw.match(/^fscx(-?\d+)/i);
  if (m) {
    state.inline.scaleX = Number(m[1]);
    return;
  }

  m = raw.match(/^fscy(-?\d+)/i);
  if (m) {
    state.inline.scaleY = Number(m[1]);
    return;
  }

  m = raw.match(/^fsp(-?\d+)/i);
  if (m) {
    state.inline.spacing = Number(m[1]);
    return;
  }

  m = raw.match(/^bord(-?\d+(?:\.\d+)?)/i);
  if (m) {
    state.inline.outline = Number(m[1]);
    return;
  }

  m = raw.match(/^shad(-?\d+(?:\.\d+)?)/i);
  if (m) {
    state.inline.shadow = Number(m[1]);
    return;
  }

  m = raw.match(/^fs(\d+)/i);
  if (m) {
    state.inline.fontSize = Number(m[1]);
    return;
  }

  m = raw.match(/^fn(.+)/i);
  if (m) {
    state.inline.fontName = m[1].trim();
    return;
  }

  m = raw.match(/^1c(&H[0-9A-Fa-f]+&?)/i);
  if (m) {
    state.inline.primaryColor = normalizeAssColor(m[1]);
    return;
  }

  m = raw.match(/^c(&H[0-9A-Fa-f]+&?)/i);
  if (m) {
    state.inline.primaryColor = normalizeAssColor(m[1]);
    return;
  }

  m = raw.match(/^3c(&H[0-9A-Fa-f]+&?)/i);
  if (m) {
    state.inline.outlineColor = normalizeAssColor(m[1]);
    return;
  }

  m = raw.match(/^4c(&H[0-9A-Fa-f]+&?)/i);
  if (m) {
    state.inline.backColor = normalizeAssColor(m[1]);
    return;
  }

  m = raw.match(/^3a(&H[0-9A-Fa-f]+&?)/i);
  if (m) {
    const alpha = parseAlphaValue(m[1]);
    if (alpha !== undefined) state.inline.outlineAlpha = alpha;
    return;
  }

  m = raw.match(/^4a(&H[0-9A-Fa-f]+&?)/i);
  if (m) {
    const alpha = parseAlphaValue(m[1]);
    if (alpha !== undefined) state.inline.backAlpha = alpha;
    return;
  }

  m = raw.match(/^1a(&H[0-9A-Fa-f]+&?)/i);
  if (m) {
    const alpha = parseAlphaValue(m[1]);
    if (alpha !== undefined) state.inline.primaryAlpha = alpha;
    return;
  }

  m = raw.match(/^alpha(&H[0-9A-Fa-f]+&?)/i);
  if (m) {
    const alpha = parseAlphaValue(m[1]);
    if (alpha !== undefined) state.inline.primaryAlpha = alpha;
    return;
  }

  // 不支持：pos, move, fad, k, an, t, clip, p 等 — 预览忽略，编辑区仍保留原文
}

function applyOverrideBlock(
  block: string,
  state: ParserState,
  resolveStyle?: (name: string) => AssStyle | undefined,
): void {
  for (const tag of block.split("\\").filter(Boolean)) {
    applyTag(tag, state, resolveStyle);
  }
}

function inlineKey(inline: AssInlineOverrides): string {
  return JSON.stringify(inline);
}

function appendText(
  runs: AssTextRun[],
  text: string,
  inline: AssInlineOverrides,
  style: AssStyle,
) {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (
    last &&
    inlineKey(last.inline) === inlineKey(inline) &&
    last.style === style
  ) {
    last.text += text;
    return;
  }
  runs.push({ text, inline: { ...inline }, style });
}

/**
 * 将 ASS Dialogue 文本解析为带行内样式的行/段列表，供预览渲染。
 * 不修改原始字符串；未知标签块在预览中不产生效果。
 */
export function parseAssTextLines(
  text: string,
  dialogueStyle: AssStyle,
  options: ParseAssTextOptions = {},
): AssTextLine[] {
  const state = new ParserState(dialogueStyle);
  const lines: AssTextLine[] = [{ runs: [] }];

  const currentRuns = () => lines[lines.length - 1].runs;
  const snap = () => ({
    inline: state.snapshotInline(),
    style: state.base,
  });

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === "{") {
      const end = text.indexOf("}", i + 1);
      if (end === -1) {
        const s = snap();
        appendText(currentRuns(), ch, s.inline, s.style);
        continue;
      }
      applyOverrideBlock(text.slice(i + 1, end), state, options.resolveStyle);
      i = end;
      continue;
    }

    if (ch === "\\" && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === "N") {
        lines.push({ runs: [] });
        i += 1;
        continue;
      }
      if (next === "n") {
        const s = snap();
        appendText(currentRuns(), "\n", s.inline, s.style);
        i += 1;
        continue;
      }
      if (next === "h") {
        const s = snap();
        appendText(currentRuns(), "\u00A0", s.inline, s.style);
        i += 1;
        continue;
      }
      if (next === "\\") {
        const s = snap();
        appendText(currentRuns(), "\\", s.inline, s.style);
        i += 1;
        continue;
      }
    }

    const s = snap();
    appendText(currentRuns(), ch, s.inline, s.style);
  }

  return lines.filter((line) => line.runs.length > 0);
}
