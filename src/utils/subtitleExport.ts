import type { SubtitleCue } from "@/lib/ass";

/** 去除 ASS 行内标签，并将换行、硬空格和转义反斜杠转换为纯文本。 */
export function stripAssText(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\([Nnh\\])/g, (_, escape: string) => {
      if (escape === "N" || escape === "n") return "\n";
      if (escape === "h") return " ";
      return "\\";
    });
}

function formatSrtTime(totalMs: number): string {
  const ms = Math.max(0, Math.round(totalMs));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/** 按物理 Dialogue 行导出 SRT：一条 cue 一个条目，按开始时间稳定排序。 */
export function serializeSrt(cues: SubtitleCue[]): string {
  const sorted = [...cues].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );
  const blocks = sorted.map((cue, index) => {
    const text = stripAssText(cue.primaryText).trim();
    return [
      String(index + 1),
      `${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}`,
      text,
    ].join("\n");
  });
  return `${blocks.join("\n\n")}\n`;
}

/** 是否存在时间段重叠的 cue（Separate Lines 文档导出 SRT 会产生重叠条目）。 */
export function hasOverlappingCues(cues: SubtitleCue[]): boolean {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  return sorted.some(
    (cue, index) => index > 0 && cue.startMs < sorted[index - 1].endMs,
  );
}
