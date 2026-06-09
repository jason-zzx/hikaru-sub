import { eventsToCues, fromAssText } from "./bilingual";
import { createDefaultScriptInfo } from "./defaults";
import { parseAssTime } from "./time";
import type {
  AssDocument,
  AssEvent,
  AssScriptInfo,
  AssStyle,
  ParseOptions,
} from "./types";

const STYLE_FORMAT_DEFAULT = [
  "Name", "Fontname", "Fontsize", "PrimaryColour", "SecondaryColour",
  "OutlineColour", "BackColour", "Bold", "Italic", "Underline", "StrikeOut",
  "ScaleX", "ScaleY", "Spacing", "Angle", "BorderStyle", "Outline", "Shadow",
  "Alignment", "MarginL", "MarginR", "MarginV", "Encoding",
];

const EVENT_FORMAT_DEFAULT = [
  "Layer", "Start", "End", "Style", "Name",
  "MarginL", "MarginR", "MarginV", "Effect", "Text",
];

type Section = "info" | "styles" | "events" | "other";

function num(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : fallback;
}

/** ASS 中 -1 表示 true，0 表示 false。 */
function bool(value: string | undefined): boolean {
  return num(value, 0) !== 0;
}

function splitFormat(line: string): string[] {
  const colon = line.indexOf(":");
  const body = colon >= 0 ? line.slice(colon + 1) : line;
  return body.split(",").map((s) => s.trim());
}

/** 按字段名取值（大小写不敏感）。 */
function pick(
  fields: string[],
  values: string[],
  name: string,
): string | undefined {
  const idx = fields.findIndex((f) => f.toLowerCase() === name.toLowerCase());
  return idx >= 0 ? values[idx] : undefined;
}

function parseStyleLine(fields: string[], line: string): AssStyle {
  const colon = line.indexOf(":");
  const raw = line.slice(colon + 1);
  // Style 字段不含逗号文本，普通 split 即可
  const values = raw.split(",").map((s) => s.trim());
  const get = (name: string) => pick(fields, values, name);
  return {
    name: get("Name") ?? "Default",
    fontName: get("Fontname") ?? "Arial",
    fontSize: num(get("Fontsize"), 48),
    primaryColor: get("PrimaryColour") ?? "&H00FFFFFF",
    secondaryColor: get("SecondaryColour") ?? "&H000000FF",
    outlineColor: get("OutlineColour") ?? "&H00000000",
    backColor: get("BackColour") ?? "&H00000000",
    bold: bool(get("Bold")),
    italic: bool(get("Italic")),
    underline: bool(get("Underline")),
    strikeOut: bool(get("StrikeOut")),
    scaleX: num(get("ScaleX"), 100),
    scaleY: num(get("ScaleY"), 100),
    spacing: num(get("Spacing"), 0),
    angle: num(get("Angle"), 0),
    borderStyle: num(get("BorderStyle"), 1),
    outline: num(get("Outline"), 2),
    shadow: num(get("Shadow"), 0),
    alignment: num(get("Alignment"), 2),
    marginL: num(get("MarginL"), 10),
    marginR: num(get("MarginR"), 10),
    marginV: num(get("MarginV"), 10),
    encoding: num(get("Encoding"), 1),
  };
}

function parseEventLine(
  fields: string[],
  line: string,
  kind: AssEvent["kind"],
): AssEvent {
  const colon = line.indexOf(":");
  const raw = line.slice(colon + 1);
  // Text 为最后一列且可含逗号：按字段数限制切分
  const textIdx = fields.findIndex((f) => f.toLowerCase() === "text");
  const limit = textIdx >= 0 ? textIdx : fields.length - 1;
  const parts = raw.split(",");
  const head = parts.slice(0, limit).map((s) => s.trim());
  const text = parts.slice(limit).join(",").replace(/^\s+/, "");
  const values = [...head, text];
  const get = (name: string) => pick(fields, values, name);
  return {
    kind,
    layer: num(get("Layer"), 0),
    startMs: parseAssTime(get("Start") ?? "0:00:00.00"),
    endMs: parseAssTime(get("End") ?? "0:00:00.00"),
    style: get("Style") ?? "Default",
    name: get("Name") ?? "",
    marginL: num(get("MarginL"), 0),
    marginR: num(get("MarginR"), 0),
    marginV: num(get("MarginV"), 0),
    effect: get("Effect") ?? "",
    text: get("Text") ?? "",
  };
}

function applyScriptInfo(info: AssScriptInfo, key: string, value: string): void {
  switch (key.toLowerCase()) {
    case "title":
      info.title = value;
      break;
    case "scripttype":
      info.scriptType = value;
      break;
    case "playresx":
      info.playResX = num(value, info.playResX);
      break;
    case "playresy":
      info.playResY = num(value, info.playResY);
      break;
    case "wrapstyle":
      info.wrapStyle = num(value, info.wrapStyle);
      break;
    case "scaledborderandshadow":
      info.scaledBorderAndShadow = /^yes$/i.test(value.trim());
      break;
    default:
      info.extra[key] = value;
  }
}

/** 解析 ASS 文本为文档（默认合并双语 Dialogue 为 cue）。 */
export function parseAss(input: string, options: ParseOptions = {}): AssDocument {
  const scriptInfo = createDefaultScriptInfo();
  const styles: AssStyle[] = [];
  const events: AssEvent[] = [];
  let styleFormat = STYLE_FORMAT_DEFAULT;
  let eventFormat = EVENT_FORMAT_DEFAULT;
  let section: Section = "other";

  const lines = input.split(/\r\n|\r|\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\uFEFF/, "");
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith(";")) continue;

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const header = trimmed.slice(1, -1).toLowerCase();
      if (header.includes("script info")) section = "info";
      else if (header.includes("styles")) section = "styles";
      else if (header.includes("events")) section = "events";
      else section = "other";
      continue;
    }

    if (section === "info") {
      const colon = trimmed.indexOf(":");
      if (colon > 0) {
        applyScriptInfo(
          scriptInfo,
          trimmed.slice(0, colon).trim(),
          trimmed.slice(colon + 1).trim(),
        );
      }
      continue;
    }

    if (section === "styles") {
      if (/^Format\s*:/i.test(trimmed)) {
        styleFormat = splitFormat(trimmed);
      } else if (/^Style\s*:/i.test(trimmed)) {
        styles.push(parseStyleLine(styleFormat, trimmed));
      }
      continue;
    }

    if (section === "events") {
      if (/^Format\s*:/i.test(trimmed)) {
        eventFormat = splitFormat(trimmed);
      } else if (/^Dialogue\s*:/i.test(trimmed)) {
        events.push(parseEventLine(eventFormat, trimmed, "Dialogue"));
      } else if (/^Comment\s*:/i.test(trimmed)) {
        events.push(parseEventLine(eventFormat, trimmed, "Comment"));
      }
    }
  }

  const mergeBilingual = options.mergeBilingual ?? true;
  const cues = mergeBilingual
    ? eventsToCues(events, options)
    : events
        .filter((e) => e.kind === "Dialogue")
        .map((e, i) => ({
          // 不合并：逐条 Dialogue 成 cue
          id: `cue_seq_${i}`,
          startMs: e.startMs,
          endMs: e.endMs,
          primaryText: fromAssText(e.text),
          style: e.style,
          layer: e.layer,
        }));

  return { scriptInfo, styles, cues };
}
