import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  formatDialogueEventLine,
  parseDialogueEventLine,
  type SubtitleCue,
} from "@/lib/ass";
import {
  copyCueRows,
  createUniqueCueId,
  deleteCuesById,
  type CreateIdFn,
  type CueListActionResult,
} from "./editorActions";

const FALLBACK_DURATION_MS = 2000;

/**
 * Line-by-line paste: valid Dialogue lines keep ASS fields; other non-empty
 * lines become 2s fallback rows after the selected cue.
 */
export function buildPasteFromClipboardText(
  cues: SubtitleCue[],
  clipboardText: string,
  targetId: string | null,
  createIdFn?: CreateIdFn,
): CueListActionResult | null {
  const lines = clipboardText
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const targetIndex = targetId
    ? cues.findIndex((cue) => cue.id === targetId)
    : -1;
  const baseCue = targetIndex >= 0 ? cues[targetIndex] : null;

  const existingAndCreated = [...cues];
  const pasted: SubtitleCue[] = [];
  let fallbackCursorMs = baseCue?.endMs ?? null;

  for (const line of lines) {
    const id = createUniqueCueId(existingAndCreated, createIdFn);
    if (!id) return null;

    const assCue = parseDialogueEventLine(line, id);
    if (assCue) {
      existingAndCreated.push(assCue);
      pasted.push(assCue);
      continue;
    }

    // Plain-text fallback needs a selected base cue for timing/style.
    if (!baseCue || fallbackCursorMs === null) continue;

    const fallback: SubtitleCue = {
      id,
      startMs: fallbackCursorMs,
      endMs: fallbackCursorMs + FALLBACK_DURATION_MS,
      primaryText: line,
      style: baseCue.style,
      layer: baseCue.layer,
      name: baseCue.name,
      marginL: baseCue.marginL,
      marginR: baseCue.marginR,
      marginV: baseCue.marginV,
      effect: baseCue.effect,
    };
    fallbackCursorMs = fallback.endMs;
    existingAndCreated.push(fallback);
    pasted.push(fallback);
  }

  if (pasted.length === 0) return null;

  const insertIndex = targetIndex >= 0 ? targetIndex + 1 : cues.length;
  return {
    cues: [
      ...cues.slice(0, insertIndex),
      ...pasted,
      ...cues.slice(insertIndex),
    ],
    selectedCueIds: pasted.map((cue) => cue.id),
  };
}

async function writeSelectedCues(
  cues: SubtitleCue[],
  selectedIds: string[],
  emptyError: string,
  failPrefix: string,
): Promise<
  | { ok: true; copied: SubtitleCue[] }
  | { ok: false; error: string }
> {
  const copied = copyCueRows(cues, selectedIds);
  if (copied.length === 0) return { ok: false, error: emptyError };
  try {
    await writeText(copied.map(formatDialogueEventLine).join("\n"));
    return { ok: true, copied };
  } catch (err) {
    return {
      ok: false,
      error: `${failPrefix}${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function copyCuesToSystemClipboard(
  cues: SubtitleCue[],
  selectedIds: string[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const result = await writeSelectedCues(
    cues,
    selectedIds,
    "没有可复制的字幕行",
    "复制失败：",
  );
  if (!result.ok) return result;
  return { ok: true, count: result.copied.length };
}

export async function cutCuesToSystemClipboard(
  cues: SubtitleCue[],
  selectedIds: string[],
): Promise<
  | { ok: true; listResult: CueListActionResult }
  | { ok: false; error: string }
> {
  const result = await writeSelectedCues(
    cues,
    selectedIds,
    "没有可剪切的字幕行",
    "剪切失败：",
  );
  if (!result.ok) return result;
  return { ok: true, listResult: deleteCuesById(cues, selectedIds) };
}

export async function pasteCuesFromSystemClipboard(
  cues: SubtitleCue[],
  targetId: string | null,
  createIdFn?: CreateIdFn,
): Promise<
  | { ok: true; listResult: CueListActionResult }
  | { ok: false; error?: string }
> {
  let text: string;
  try {
    text = await readText();
  } catch {
    return { ok: false };
  }
  if (typeof text !== "string" || text.trim() === "") return { ok: false };

  const listResult = buildPasteFromClipboardText(
    cues,
    text,
    targetId,
    createIdFn,
  );
  if (!listResult) return { ok: false };
  return { ok: true, listResult };
}
