import { createId } from "./defaults";
import type { SubtitleCue } from "./types";

/** ASR 引擎输出的时间片段（与 sidecar `AsrSegment` 对齐）。 */
export interface AsrSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/** AsrSegment[] 转单语 cue（primaryText 为原文，无译文）。 */
export function segmentsToCues(
  segments: AsrSegment[],
  style = "Primary",
): SubtitleCue[] {
  return segments.map((seg) => ({
    id: createId(),
    startMs: seg.startMs,
    endMs: seg.endMs,
    primaryText: seg.text.trim(),
    style,
    layer: 0,
  }));
}

export interface MergeOptions {
  /** 短于此时长（ms）的 cue 尝试与相邻合并 */
  minDurationMs?: number;
  /** 允许合并的最大间隔（ms） */
  maxGapMs?: number;
  /** 合并文本时的连接符 */
  joiner?: string;
}

/**
 * 合并过短 cue：将时长不足的 cue 并入下一条（间隔在阈值内、样式相同）。
 * 仅作用于 primaryText，适用于 ASR 后处理阶段（此时通常无译文）。
 */
export function mergeShortCues(
  cues: SubtitleCue[],
  options: MergeOptions = {},
): SubtitleCue[] {
  const minDurationMs = options.minDurationMs ?? 500;
  const maxGapMs = options.maxGapMs ?? 200;
  const joiner = options.joiner ?? "";
  if (cues.length === 0) return [];

  const sorted = [...cues].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );
  const result: SubtitleCue[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    const tooShort = current.endMs - current.startMs < minDurationMs;
    const gap = next.startMs - current.endMs;
    const sameStyle = current.style === next.style;
    if (tooShort && sameStyle && gap <= maxGapMs) {
      current = {
        ...current,
        endMs: Math.max(current.endMs, next.endMs),
        primaryText: [current.primaryText, next.primaryText]
          .filter((t) => t.trim() !== "")
          .join(joiner),
      };
    } else {
      result.push(current);
      current = { ...next };
    }
  }
  result.push(current);
  return result;
}

function wrapLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  const hasSpaces = /\s/.test(line.trim());
  const out: string[] = [];

  if (hasSpaces) {
    let buf = "";
    for (const word of line.split(/\s+/)) {
      if (buf === "") {
        buf = word;
      } else if ((buf + " " + word).length <= maxChars) {
        buf += " " + word;
      } else {
        out.push(buf);
        buf = word;
      }
    }
    if (buf) out.push(buf);
  } else {
    for (let i = 0; i < line.length; i += maxChars) {
      out.push(line.slice(i, i + maxChars));
    }
  }
  return out.join("\n");
}

function wrapText(text: string, maxChars: number): string {
  return text
    .split("\n")
    .map((line) => wrapLine(line, maxChars))
    .join("\n");
}

export interface SplitOptions {
  /** 每行最大字符数（中文约 15、日文约 18） */
  maxCharsPerLine?: number;
  /** 是否同时处理译文 */
  includeSecondary?: boolean;
}

/**
 * 拆分过长行：在不改变时间轴的前提下，为超过阈值的文本插入换行。
 */
export function splitLongCues(
  cues: SubtitleCue[],
  options: SplitOptions = {},
): SubtitleCue[] {
  const maxChars = options.maxCharsPerLine ?? 18;
  const includeSecondary = options.includeSecondary ?? true;
  return cues.map((cue) => ({
    ...cue,
    primaryText: wrapText(cue.primaryText, maxChars),
    secondaryText:
      includeSecondary && cue.secondaryText
        ? wrapText(cue.secondaryText, maxChars)
        : cue.secondaryText,
  }));
}
