import { fromAssText, toAssText } from "./bilingual";
import { formatAssTime, parseAssTime } from "./time";
import type { SubtitleCue } from "./types";

/** ASS Dialogue fields before Text: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect */
const PRE_TEXT_FIELD_COUNT = 9;

const ASS_TIME_RE = /^\d+:\d{1,2}:\d{1,2}[.,]\d{1,3}$/;

function parseStrictAssTime(input: string): number | null {
  const trimmed = input.trim();
  if (!ASS_TIME_RE.test(trimmed)) return null;
  return parseAssTime(trimmed);
}

function parseStrictInt(input: string): number | null {
  const trimmed = input.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Serialize one physical cue to a canonical Dialogue event line.
 * Name/margins/effect are always blank/zero (editor model has no such fields).
 */
export function formatDialogueEventLine(cue: SubtitleCue): string {
  const fields = [
    cue.layer,
    formatAssTime(cue.startMs),
    formatAssTime(cue.endMs),
    cue.style || "Default",
    "",
    0,
    0,
    0,
    "",
    toAssText(cue.primaryText),
  ];
  return `Dialogue: ${fields.join(",")}`;
}

/**
 * Strictly parse one complete `Dialogue:` line into a physical cue.
 * Rejects Comment lines, missing fields, non-numeric layer/margins, invalid times.
 * Unsupported Name/margins/Effect are accepted but not stored on the cue.
 */
export function parseDialogueEventLine(
  line: string,
  id: string,
): SubtitleCue | null {
  const trimmed = line.trim();
  if (!/^Dialogue\s*:/i.test(trimmed)) return null;

  const colon = trimmed.indexOf(":");
  const raw = trimmed.slice(colon + 1);
  const parts = raw.split(",");
  if (parts.length < PRE_TEXT_FIELD_COUNT + 1) return null;

  const head = parts.slice(0, PRE_TEXT_FIELD_COUNT).map((s) => s.trim());
  const text = parts.slice(PRE_TEXT_FIELD_COUNT).join(",").replace(/^\s+/, "");

  const layer = parseStrictInt(head[0] ?? "");
  const startMs = parseStrictAssTime(head[1] ?? "");
  const endMs = parseStrictAssTime(head[2] ?? "");
  const style = head[3];
  if (style === undefined || style === "") return null;
  // Name/margins/Effect accepted for field count but not stored on the cue.
  if (
    layer === null ||
    startMs === null ||
    endMs === null ||
    ![head[5], head[6], head[7]].every((m) => /^-?\d+$/.test(m ?? ""))
  ) {
    return null;
  }

  return {
    id,
    startMs,
    endMs,
    primaryText: fromAssText(text),
    style,
    layer,
  };
}
