import { cuesToEvents } from "./bilingual";
import { formatAssTime } from "./time";
import type {
  AssDocument,
  AssEvent,
  AssScriptInfo,
  AssStyle,
  SerializeOptions,
} from "./types";

const STYLE_FORMAT =
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";

const EVENT_FORMAT =
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";

function assBool(value: boolean): string {
  return value ? "-1" : "0";
}

function styleLine(s: AssStyle): string {
  const fields = [
    s.name,
    s.fontName,
    s.fontSize,
    s.primaryColor,
    s.secondaryColor,
    s.outlineColor,
    s.backColor,
    assBool(s.bold),
    assBool(s.italic),
    assBool(s.underline),
    assBool(s.strikeOut),
    s.scaleX,
    s.scaleY,
    s.spacing,
    s.angle,
    s.borderStyle,
    s.outline,
    s.shadow,
    s.alignment,
    s.marginL,
    s.marginR,
    s.marginV,
    s.encoding,
  ];
  return `Style: ${fields.join(",")}`;
}

function eventLine(e: AssEvent): string {
  const fields = [
    e.layer,
    formatAssTime(e.startMs),
    formatAssTime(e.endMs),
    e.style,
    e.name,
    e.marginL,
    e.marginR,
    e.marginV,
    e.effect,
    e.text,
  ];
  return `${e.kind}: ${fields.join(",")}`;
}

function scriptInfoLines(info: AssScriptInfo): string[] {
  const lines = [
    "[Script Info]",
    `Title: ${info.title}`,
    `ScriptType: ${info.scriptType}`,
    `WrapStyle: ${info.wrapStyle}`,
    `ScaledBorderAndShadow: ${info.scaledBorderAndShadow ? "yes" : "no"}`,
    `PlayResX: ${info.playResX}`,
    `PlayResY: ${info.playResY}`,
  ];
  for (const [key, value] of Object.entries(info.extra)) {
    lines.push(`${key}: ${value}`);
  }
  return lines;
}

/** 将文档序列化为 ASS 文本（cue 展开为双语 Dialogue）。 */
export function serializeAss(
  doc: AssDocument,
  options: SerializeOptions = {},
): string {
  const events = cuesToEvents(doc.cues, options);
  const sections: string[] = [];

  sections.push(scriptInfoLines(doc.scriptInfo).join("\n"));

  const styleSection = [
    "[V4+ Styles]",
    STYLE_FORMAT,
    ...doc.styles.map(styleLine),
  ];
  sections.push(styleSection.join("\n"));

  const eventSection = ["[Events]", EVENT_FORMAT, ...events.map(eventLine)];
  sections.push(eventSection.join("\n"));

  return sections.join("\n\n") + "\n";
}
