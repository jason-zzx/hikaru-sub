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
 * Preserves Name / MarginL / MarginR / MarginV / Effect from the cue model.
 */
export function formatDialogueEventLine(cue: SubtitleCue): string {
  const fields = [
    cue.layer,
    formatAssTime(cue.startMs),
    formatAssTime(cue.endMs),
    cue.style || "Default",
    cue.name ?? "",
    cue.marginL ?? 0,
    cue.marginR ?? 0,
    cue.marginV ?? 0,
    cue.effect ?? "",
    toAssText(cue.primaryText),
  ];
  return `Dialogue: ${fields.join(",")}`;
}

/**
 * Strictly parse one complete `Dialogue:` line into a physical cue.
 * Rejects Comment lines, missing fields, non-numeric layer/margins, invalid times.
 * Stores Name / margins / Effect on the cue.
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
  const marginL = parseStrictInt(head[5] ?? "");
  const marginR = parseStrictInt(head[6] ?? "");
  const marginV = parseStrictInt(head[7] ?? "");
  if (
    layer === null ||
    startMs === null ||
    endMs === null ||
    marginL === null ||
    marginR === null ||
    marginV === null
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
    name: head[4] ?? "",
    marginL,
    marginR,
    marginV,
    effect: head[8] ?? "",
  };
}
