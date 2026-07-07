import { describe, expect, it } from "vitest";
import { hitTestTimelineCue } from "./timelineModel";
import type { SubtitleCue } from "../../types";

const cue: SubtitleCue = {
  id: "a",
  startMs: 0,
  endMs: 1000,
  primaryText: "a",
  style: "Primary",
  layer: 0,
};

describe("hitTestTimelineCue", () => {
  const rects = [{ cue, lane: 0, x: 10, y: 20, width: 100, height: 24 }];

  it("detects left and right resize handles", () => {
    expect(hitTestTimelineCue(rects, 12, 30)).toEqual({
      kind: "edge",
      cue,
      edge: "start",
    });
    expect(hitTestTimelineCue(rects, 108, 30)).toEqual({
      kind: "edge",
      cue,
      edge: "end",
    });
  });

  it("detects cue body and empty areas", () => {
    expect(hitTestTimelineCue(rects, 60, 30)).toEqual({ kind: "body", cue });
    expect(hitTestTimelineCue(rects, 60, 80)).toEqual({ kind: "empty" });
  });

  it("splits overlapping handles on very narrow cues", () => {
    const narrowRects = [{ cue, lane: 0, x: 10, y: 20, width: 8, height: 24 }];

    expect(hitTestTimelineCue(narrowRects, 12, 30)).toEqual({
      kind: "edge",
      cue,
      edge: "start",
    });
    expect(hitTestTimelineCue(narrowRects, 17, 30)).toEqual({
      kind: "edge",
      cue,
      edge: "end",
    });
  });
});
