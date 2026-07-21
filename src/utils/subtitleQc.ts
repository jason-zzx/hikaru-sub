import type { SubtitleCue } from "../types";
import { isVisuallyEmptyText, stripAssTags } from "./subtitleSearch";

export const CPS_MAX = 20;
export const LINE_MAX_CHARS = 42;
export const LINES_MAX = 2;

export type QcRule =
  | "empty"
  | "bad-timing"
  | "beyond-duration"
  | "overlap"
  | "high-cps"
  | "long-line"
  | "many-lines"
  | "unknown-style";

export interface QcIssue {
  cueId: string;
  rule: QcRule;
  /** 中文简述，含行号 */
  message: string;
}

export interface QcOptions {
  durationMs: number;
  knownStyles: readonly string[];
}

/** Strict overlap; touching endpoints (end == start) do not count. */
export function cuesOverlap(
  a: Pick<SubtitleCue, "startMs" | "endMs">,
  b: Pick<SubtitleCue, "startMs" | "endMs">,
): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/** Ids of cues that overlap the active cue (excludes active itself). */
export function collectOverlappingCueIds(
  cues: readonly SubtitleCue[],
  activeCueId: string | null,
): Set<string> {
  const out = new Set<string>();
  if (!activeCueId) return out;
  const active = cues.find((c) => c.id === activeCueId);
  if (!active) return out;
  for (const cue of cues) {
    if (cue.id === activeCueId) continue;
    if (cuesOverlap(active, cue)) out.add(cue.id);
  }
  return out;
}

function lineCharStats(text: string): { maxLineChars: number; lineCount: number } {
  const lines = stripAssTags(text).replace(/\\N/gi, "\n").split(/\r?\n/);
  return {
    maxLineChars: Math.max(...lines.map((line) => line.length)),
    lineCount: lines.length,
  };
}

function charCountForCps(text: string): number {
  return stripAssTags(text).replace(/\\N/gi, "").replace(/\s+/g, "").length;
}

/**
 * Pure QC over physical Dialogue rows. All issues are warnings.
 * durationMs <= 0 skips beyond-duration. knownStyles empty skips unknown-style
 * (matches list coloring: only flag when style library is non-empty).
 */
export function runQcChecks(
  cues: readonly SubtitleCue[],
  opts: QcOptions,
): QcIssue[] {
  const issues: QcIssue[] = [];
  const lineNo = new Map(cues.map((cue, i) => [cue.id, i + 1] as const));
  const styleSet =
    opts.knownStyles.length > 0 ? new Set(opts.knownStyles) : null;
  const addIssue = (cue: SubtitleCue, rule: QcRule, message: string) => {
    issues.push({
      cueId: cue.id,
      rule,
      message: `#${lineNo.get(cue.id) ?? 0} ${message}`,
    });
  };

  for (const cue of cues) {
    if (isVisuallyEmptyText(cue.primaryText)) {
      addIssue(cue, "empty", "空字幕");
    }

    if (cue.endMs <= cue.startMs) {
      addIssue(cue, "bad-timing", "结束时间不大于开始时间");
    }

    if (opts.durationMs > 0 && cue.endMs > opts.durationMs) {
      addIssue(cue, "beyond-duration", "超出视频时长");
    }

    const duration = cue.endMs - cue.startMs;
    if (duration > 0) {
      const cps = (charCountForCps(cue.primaryText) * 1000) / duration;
      if (cps > CPS_MAX) {
        addIssue(cue, "high-cps", `每秒字符数过高 (${cps.toFixed(1)})`);
      }
    }

    const { maxLineChars, lineCount } = lineCharStats(cue.primaryText);
    if (maxLineChars > LINE_MAX_CHARS) {
      addIssue(cue, "long-line", `单行过长 (${maxLineChars} 字)`);
    }
    if (lineCount > LINES_MAX) {
      addIssue(cue, "many-lines", `换行过多 (${lineCount} 行)`);
    }

    if (styleSet && !styleSet.has(cue.style)) {
      addIssue(cue, "unknown-style", `未知样式「${cue.style}」`);
    }
  }

  // Overlap sweep: sort by start; track the earlier cue with the max end.
  // Any cue starting before that max end overlaps it — catches nested /
  // non-adjacent overlaps (A 0-10s, B 1-2s, C 3-4s: C overlaps A) that
  // pure adjacent-pair comparison misses. Each cue reported at most once.
  const ordered = [...cues].sort((a, b) =>
    a.startMs !== b.startMs ? a.startMs - b.startMs : a.endMs - b.endMs,
  );
  let maxEndCue: SubtitleCue | null = null;
  for (const cue of ordered) {
    if (maxEndCue && cue.startMs < maxEndCue.endMs) {
      addIssue(
        cue,
        "overlap",
        `与 #${lineNo.get(maxEndCue.id) ?? 0} 时间重叠`,
      );
    }
    if (!maxEndCue || cue.endMs > maxEndCue.endMs) maxEndCue = cue;
  }

  return issues;
}
