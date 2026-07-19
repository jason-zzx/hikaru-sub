import type { TimelineDragEdge } from "../../services/editorActions";
import type { SubtitleCue } from "../../types";

export interface TimelineCueRect {
  cue: SubtitleCue;
  lane: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TimelineHit =
  | { kind: "edge"; cue: SubtitleCue; edge: TimelineDragEdge }
  | { kind: "body"; cue: SubtitleCue }
  | { kind: "empty" };

export interface ClippedCueRect {
  x: number;
  width: number;
  showStartHandle: boolean;
  showEndHandle: boolean;
}

/** Return a centered view start when a target time falls outside the viewport. */
export function revealTimelineTime(
  viewStartMs: number,
  viewportWidth: number,
  msPerPixel: number,
  targetTimeMs: number,
): number {
  const viewEndMs = viewStartMs + viewportWidth * msPerPixel;
  if (targetTimeMs >= viewStartMs && targetTimeMs <= viewEndMs) {
    return viewStartMs;
  }
  return Math.max(0, targetTimeMs - (viewportWidth * msPerPixel) / 2);
}

/** Clip a cue rect to the visible viewport so scrolled-off start/end shrink width. */
export function clipVisibleCueRect(
  rect: { x: number; width: number },
  viewportWidth: number,
): ClippedCueRect | null {
  const left = Math.max(0, rect.x);
  const right = Math.min(viewportWidth, rect.x + rect.width);
  const width = right - left;
  if (width <= 0) return null;
  return {
    x: left,
    width,
    showStartHandle: rect.x >= 0,
    showEndHandle: rect.x + rect.width <= viewportWidth,
  };
}

export function hitTestTimelineCue(
  rects: TimelineCueRect[],
  x: number,
  y: number,
  edgeHandleWidth = 6,
  viewportWidth?: number,
): TimelineHit {
  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const rect = rects[index];
    const clipped =
      viewportWidth === undefined
        ? {
            x: rect.x,
            width: rect.width,
            showStartHandle: true,
            showEndHandle: true,
          }
        : clipVisibleCueRect(rect, viewportWidth);
    if (!clipped) continue;

    const insideX = x >= clipped.x && x <= clipped.x + clipped.width;
    const insideY = y >= rect.y && y <= rect.y + rect.height;
    if (!insideX || !insideY) continue;

    const canSplitHandles =
      clipped.showStartHandle &&
      clipped.showEndHandle &&
      clipped.width <= edgeHandleWidth * 2;
    if (canSplitHandles) {
      return {
        kind: "edge",
        cue: rect.cue,
        edge: x <= clipped.x + clipped.width / 2 ? "start" : "end",
      };
    }
    if (clipped.showStartHandle && x <= clipped.x + edgeHandleWidth) {
      return { kind: "edge", cue: rect.cue, edge: "start" };
    }
    if (
      clipped.showEndHandle &&
      x >= clipped.x + clipped.width - edgeHandleWidth
    ) {
      return { kind: "edge", cue: rect.cue, edge: "end" };
    }
    return { kind: "body", cue: rect.cue };
  }
  return { kind: "empty" };
}
