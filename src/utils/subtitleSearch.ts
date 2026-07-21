import type { SubtitleCue } from "../types";

export interface SubtitleFilters {
  /** undefined / empty = all styles */
  style?: string;
  emptyOnly?: boolean;
  timeRange?: { startMs?: number; endMs?: number };
}

/** Strip ASS override blocks `{...}` and collapse whitespace for empty checks. */
export function stripAssTags(text: string): string {
  return text.replace(/\{[^}]*\}/g, "");
}

export function isVisuallyEmptyText(text: string): boolean {
  return stripAssTags(text).replace(/\s+/g, "").length === 0;
}

export function matchesFilters(
  cue: SubtitleCue,
  filters: SubtitleFilters = {},
): boolean {
  if (filters.style && cue.style !== filters.style) return false;
  if (filters.emptyOnly && !isVisuallyEmptyText(cue.primaryText)) return false;

  const range = filters.timeRange;
  if (range) {
    const start = range.startMs;
    const end = range.endMs;
    // Intersect with [startMs, endMs]: cue overlaps filter window.
    if (start !== undefined && cue.endMs < start) return false;
    if (end !== undefined && cue.startMs > end) return false;
  }
  return true;
}

function textMatchesQuery(text: string, query: string): boolean {
  if (!query) return true;
  return text.toLowerCase().includes(query.toLowerCase());
}

/**
 * Match cue ids by optional case-insensitive substring on `primaryText` plus filters.
 * Empty query + filters still returns the filter set (pure filter navigation).
 * Empty query + no filters returns all cue ids.
 */
export function collectMatches(
  cues: readonly SubtitleCue[],
  query: string,
  filters: SubtitleFilters = {},
): string[] {
  const q = query.trim();
  return cues
    .filter(
      (cue) =>
        matchesFilters(cue, filters) && textMatchesQuery(cue.primaryText, q),
    )
    .map((cue) => cue.id);
}

/** dir +1 = next, -1 = previous; wraps around. Empty matchIds → null. */
export function findAdjacentMatch(
  matchIds: readonly string[],
  currentCueId: string | null,
  dir: 1 | -1,
): string | null {
  if (matchIds.length === 0) return null;
  if (matchIds.length === 1) return matchIds[0] ?? null;

  const idx = currentCueId ? matchIds.indexOf(currentCueId) : -1;
  if (idx < 0) {
    return dir === 1
      ? (matchIds[0] ?? null)
      : (matchIds[matchIds.length - 1] ?? null);
  }
  const next = (idx + dir + matchIds.length) % matchIds.length;
  return matchIds[next] ?? null;
}

/** Literal case-insensitive replace of all occurrences of query in primaryText. */
export function applyReplace(
  text: string,
  query: string,
  replaceText: string,
): string {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let out = "";
  let i = 0;
  while (i < text.length) {
    const hit = lower.indexOf(needle, i);
    if (hit < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, hit) + replaceText;
    i = hit + q.length;
  }
  return out;
}

export function replaceInCues(
  cues: readonly SubtitleCue[],
  matchIds: readonly string[],
  query: string,
  replaceText: string,
): SubtitleCue[] {
  if (matchIds.length === 0 || !query.trim()) return cues as SubtitleCue[];
  const idSet = new Set(matchIds);
  let changed = false;
  const next = cues.map((cue) => {
    if (!idSet.has(cue.id)) return cue;
    const primaryText = applyReplace(cue.primaryText, query, replaceText);
    if (primaryText === cue.primaryText) return cue;
    changed = true;
    return { ...cue, primaryText };
  });
  return changed ? next : (cues as SubtitleCue[]);
}
