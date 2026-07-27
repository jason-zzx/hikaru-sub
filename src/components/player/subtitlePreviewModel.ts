import {
  formatAssTime,
  parseAssTime,
  type SubtitleCue,
} from "@/lib/ass";
import {
  findSegmentStopCue,
  type SegmentStop,
} from "@/stores/playbackStore";
import { isCueActiveAtTime } from "@/components/editor/timelineModel";

export type SubtitlePreviewRendererMode = "auto" | "libass" | "css";

interface LibassFontKeyArgs {
  defaultFont?: string;
  glyphFallbackFont?: string;
  fontUrls: string[];
  availableFonts?: Record<string, string>;
}

export function getLibassFontKey({
  defaultFont,
  glyphFallbackFont,
  fontUrls,
  availableFonts = {},
}: LibassFontKeyArgs): string {
  const availableFontEntries = Object.entries(availableFonts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, url]) => `${name}:${url}`);

  return [
    defaultFont ?? "",
    glyphFallbackFont ?? "",
    ...fontUrls,
    ...availableFontEntries,
  ].join("\n");
}

export function findPreviewCue(
  cues: SubtitleCue[],
  activeCueId: string | null,
  currentTimeMs: number,
): SubtitleCue | null {
  if (activeCueId) {
    return cues.find((cue) => cue.id === activeCueId) ?? null;
  }
  return cues.find((cue) => isCueActiveAtTime(cue, currentTimeMs)) ?? null;
}

/**
 * 暂停态预览钉帧：有效段播停点优先返回启动段播的 cue，即使播放期间选择
 * 已由 undo/redo 改变；普通暂停则在播放头仍位于选中句闭区间内时返回选中句。
 * 其余情况返回 null，预览回归按播放头时间命中（空档即空白）。
 */
export function resolvePausedPreviewCueId(
  cues: SubtitleCue[],
  selectedCueId: string | null,
  currentTimeMs: number,
  segmentStop: SegmentStop | null,
): string | null {
  if (segmentStop !== null && currentTimeMs === segmentStop.stopMs) {
    const stoppedCue = findSegmentStopCue(cues, segmentStop);
    if (stoppedCue) return stoppedCue.id;
  }
  if (!selectedCueId) return null;
  const cue = cues.find((item) => item.id === selectedCueId);
  return cue && isCueActiveAtTime(cue, currentTimeMs) ? selectedCueId : null;
}

/**
 * 段播停点按左极限渲染 tracker 已确认的命中集合。仅当当前编辑时间或
 * ASS 厘秒量化无法覆盖该帧时，才调整临时 cue 的起止时间；不改文档数据。
 */
export function resolveSegmentStopPreview(
  cues: SubtitleCue[],
  cueIds: readonly string[] | null,
  stopMs: number,
) {
  if (cueIds === null) return null;

  const renderTimeMs = Math.max(
    0,
    parseAssTime(formatAssTime(stopMs)) - 1,
  );
  const activeIds = new Set(cueIds);
  const previewCues = cues
    .filter((cue) => activeIds.has(cue.id))
    .map((cue) => {
      const serializedStartMs = parseAssTime(formatAssTime(cue.startMs));
      const serializedEndMs = parseAssTime(formatAssTime(cue.endMs));
      const startMs =
        serializedStartMs > renderTimeMs
          ? Math.max(0, renderTimeMs - 10)
          : cue.startMs;
      const endMs =
        serializedEndMs <= renderTimeMs ? renderTimeMs + 10 : cue.endMs;
      return startMs === cue.startMs && endMs === cue.endMs
        ? cue
        : { ...cue, startMs, endMs };
    });

  return { cues: previewCues, renderTimeMs };
}

export function getLibassRenderTimeMs(
  cues: SubtitleCue[],
  activeCueId: string | null,
  currentTimeMs: number,
): number {
  if (!activeCueId) return currentTimeMs;
  const cue = cues.find((item) => item.id === activeCueId);
  if (!cue) return currentTimeMs;

  const serializedStartMs = parseAssTime(formatAssTime(cue.startMs));
  const serializedEndMs = parseAssTime(formatAssTime(cue.endMs));
  if (serializedEndMs <= serializedStartMs) return serializedStartMs;
  return Math.min(serializedStartMs + 1, serializedEndMs - 1);
}

export function shouldUseCssFallback(
  rendererMode: SubtitlePreviewRendererMode,
  libassAvailable: boolean,
  fallbackReason: string | null,
): boolean {
  return rendererMode === "css" || !libassAvailable || fallbackReason !== null;
}
