import { describe, expect, it } from "vitest";
import type { SubtitleCue } from "../types";
import {
  collectOverlappingCueIds,
  CPS_MAX,
  cuesOverlap,
  LINE_MAX_CHARS,
  LINES_MAX,
  runQcChecks,
} from "./subtitleQc";

function cue(
  id: string,
  startMs: number,
  endMs: number,
  primaryText: string,
  style = "Default",
): SubtitleCue {
  return { id, startMs, endMs, primaryText, style, layer: 0 };
}

describe("cuesOverlap / collectOverlappingCueIds", () => {
  it("treats touching endpoints as non-overlap", () => {
    expect(cuesOverlap(cue("a", 0, 1000, ""), cue("b", 1000, 2000, ""))).toBe(
      false,
    );
    expect(cuesOverlap(cue("a", 0, 1001, ""), cue("b", 1000, 2000, ""))).toBe(
      true,
    );
  });

  it("returns other ids that overlap the active cue", () => {
    const cues = [
      cue("a", 0, 1000, "a"),
      cue("b", 500, 1500, "b"),
      cue("c", 2000, 3000, "c"),
    ];
    expect([...collectOverlappingCueIds(cues, "a")]).toEqual(["b"]);
    expect(collectOverlappingCueIds(cues, null).size).toBe(0);
    expect(collectOverlappingCueIds(cues, "missing").size).toBe(0);
  });
});

describe("runQcChecks", () => {
  it("flags empty text after stripping tags", () => {
    const issues = runQcChecks([cue("a", 0, 1000, "{\\b1}  ")], {
      durationMs: 10_000,
      knownStyles: ["Default"],
    });
    expect(issues.some((i) => i.rule === "empty" && i.cueId === "a")).toBe(true);
  });

  it("flags bad timing and beyond duration", () => {
    const issues = runQcChecks(
      [cue("a", 2000, 1000, "x"), cue("b", 0, 5000, "y")],
      { durationMs: 4000, knownStyles: ["Default"] },
    );
    expect(issues.some((i) => i.rule === "bad-timing" && i.cueId === "a")).toBe(
      true,
    );
    expect(
      issues.some((i) => i.rule === "beyond-duration" && i.cueId === "b"),
    ).toBe(true);
  });

  it("skips beyond-duration when duration unknown", () => {
    const issues = runQcChecks([cue("a", 0, 99999, "y")], {
      durationMs: 0,
      knownStyles: ["Default"],
    });
    expect(issues.some((i) => i.rule === "beyond-duration")).toBe(false);
  });

  it("flags overlap but not tight gaps", () => {
    const issues = runQcChecks(
      [
        cue("a", 0, 1000, "a"),
        cue("b", 900, 2000, "b"),
        cue("c", 2001, 3000, "c"),
      ],
      { durationMs: 10_000, knownStyles: ["Default"] },
    );
    expect(issues.filter((i) => i.rule === "overlap")).toHaveLength(1);
    expect(issues.some((i) => (i.rule as string) === "tight-gap")).toBe(false);
  });

  it("flags nested / non-adjacent overlaps too", () => {
    // A 容器区间包住 B、C：B、C 都与 A 重叠，但 B-C 并不相邻重叠
    const issues = runQcChecks(
      [
        cue("a", 0, 10_000, "a"),
        cue("b", 1000, 2000, "b"),
        cue("c", 3000, 4000, "c"),
      ],
      { durationMs: 20_000, knownStyles: ["Default"] },
    );
    const overlapIds = issues
      .filter((i) => i.rule === "overlap")
      .map((i) => i.cueId);
    expect(overlapIds).toEqual(["b", "c"]);
  });

  it("flags high CPS, long line, many lines", () => {
    const long = "x".repeat(LINE_MAX_CHARS + 1);
    const many = "a\nb\nc\nd";
    const dense = "x".repeat(CPS_MAX + 1);
    const issues = runQcChecks(
      [
        cue("a", 0, 1000, dense),
        cue("b", 2000, 3000, long),
        cue("c", 4000, 5000, many),
      ],
      { durationMs: 10_000, knownStyles: ["Default"] },
    );
    expect(issues.some((i) => i.rule === "high-cps" && i.cueId === "a")).toBe(
      true,
    );
    expect(issues.some((i) => i.rule === "long-line" && i.cueId === "b")).toBe(
      true,
    );
    expect(issues.some((i) => i.rule === "many-lines" && i.cueId === "c")).toBe(
      true,
    );
    expect(LINES_MAX).toBe(2);
  });

  it("flags unknown style only when style library is non-empty", () => {
    const withLib = runQcChecks([cue("a", 0, 1000, "hi", "Missing")], {
      durationMs: 10_000,
      knownStyles: ["Default"],
    });
    expect(withLib.some((i) => i.rule === "unknown-style")).toBe(true);

    const noLib = runQcChecks([cue("a", 0, 1000, "hi", "Missing")], {
      durationMs: 10_000,
      knownStyles: [],
    });
    expect(noLib.some((i) => i.rule === "unknown-style")).toBe(false);
  });

  it("returns empty for clean cues", () => {
    const issues = runQcChecks([cue("a", 0, 2000, "ok")], {
      durationMs: 10_000,
      knownStyles: ["Default"],
    });
    expect(issues).toEqual([]);
  });
});
