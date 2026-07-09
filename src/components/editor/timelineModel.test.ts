import { describe, expect, it } from "vitest";
import { clipVisibleCueRect, hitTestTimelineCue } from "./timelineModel";
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

  it("does not treat clipped viewport edges as missing start/end handles", () => {
    // Start scrolled just past left edge: visible block begins at x=0, but true start is off-screen.
    // Unclipped start-handle zone is [-3, 3]; click at 2 would wrongly hit "start" without clipping.
    const leftClipped = [{ cue, lane: 0, x: -3, y: 20, width: 200, height: 24 }];
    expect(hitTestTimelineCue(leftClipped, 2, 30, 6, 800)).toEqual({
      kind: "body",
      cue,
    });
    expect(hitTestTimelineCue(leftClipped, 194, 30, 6, 800)).toEqual({
      kind: "edge",
      cue,
      edge: "end",
    });

    // End scrolled just past right edge: unclipped end-handle zone is [797, 803].
    // Click at 798 would wrongly hit "end" without clipping to the viewport.
    const rightClipped = [{ cue, lane: 0, x: 700, y: 20, width: 103, height: 24 }];
    expect(hitTestTimelineCue(rightClipped, 702, 30, 6, 800)).toEqual({
      kind: "edge",
      cue,
      edge: "start",
    });
    expect(hitTestTimelineCue(rightClipped, 798, 30, 6, 800)).toEqual({
      kind: "body",
      cue,
    });
  });
});

describe("clipVisibleCueRect", () => {
  it("keeps fully visible cues unchanged", () => {
    expect(clipVisibleCueRect({ x: 40, width: 120 }, 400)).toEqual({
      x: 40,
      width: 120,
      showStartHandle: true,
      showEndHandle: true,
    });
  });

  it("shortens width when cue start is scrolled past the left edge", () => {
    // Cue 0–3000ms at 10ms/px → width 300; view starts at 1000ms → x = -100
    expect(clipVisibleCueRect({ x: -100, width: 300 }, 800)).toEqual({
      x: 0,
      width: 200,
      showStartHandle: false,
      showEndHandle: true,
    });
  });

  it("clips cue that extends past the right edge", () => {
    expect(clipVisibleCueRect({ x: 700, width: 300 }, 800)).toEqual({
      x: 700,
      width: 100,
      showStartHandle: true,
      showEndHandle: false,
    });
  });

  it("clips cues that span the entire viewport", () => {
    expect(clipVisibleCueRect({ x: -50, width: 1000 }, 800)).toEqual({
      x: 0,
      width: 800,
      showStartHandle: false,
      showEndHandle: false,
    });
  });

  it("returns null when cue is completely outside the viewport", () => {
    expect(clipVisibleCueRect({ x: -200, width: 50 }, 800)).toBeNull();
    expect(clipVisibleCueRect({ x: 900, width: 50 }, 800)).toBeNull();
  });
});
