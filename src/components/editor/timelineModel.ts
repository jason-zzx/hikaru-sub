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

export function hitTestTimelineCue(
  rects: TimelineCueRect[],
  x: number,
  y: number,
  edgeHandleWidth = 6,
): TimelineHit {
  for (let index = rects.length - 1; index >= 0; index -= 1) {
    const rect = rects[index];
    const insideX = x >= rect.x && x <= rect.x + rect.width;
    const insideY = y >= rect.y && y <= rect.y + rect.height;
    if (!insideX || !insideY) continue;
    if (rect.width <= edgeHandleWidth * 2) {
      return {
        kind: "edge",
        cue: rect.cue,
        edge: x <= rect.x + rect.width / 2 ? "start" : "end",
      };
    }
    if (x <= rect.x + edgeHandleWidth) {
      return { kind: "edge", cue: rect.cue, edge: "start" };
    }
    if (x >= rect.x + rect.width - edgeHandleWidth) {
      return { kind: "edge", cue: rect.cue, edge: "end" };
    }
    return { kind: "body", cue: rect.cue };
  }
  return { kind: "empty" };
}
