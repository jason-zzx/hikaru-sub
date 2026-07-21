import { describe, expect, it } from "vitest";
import type { SubtitleCue } from "../types";
import {
  applyReplace,
  collectMatches,
  findAdjacentMatch,
  isVisuallyEmptyText,
  matchesFilters,
  replaceInCues,
  stripAssTags,
} from "./subtitleSearch";

function cue(
  id: string,
  primaryText: string,
  overrides: Partial<SubtitleCue> = {},
): SubtitleCue {
  return {
    id,
    startMs: 0,
    endMs: 1000,
    primaryText,
    style: "Default",
    layer: 0,
    ...overrides,
  };
}

describe("stripAssTags / isVisuallyEmptyText", () => {
  it("strips override blocks", () => {
    expect(stripAssTags("{\\b1}hi{\\b0}")).toBe("hi");
  });

  it("treats tag-only / whitespace as empty", () => {
    expect(isVisuallyEmptyText("")).toBe(true);
    expect(isVisuallyEmptyText("   ")).toBe(true);
    expect(isVisuallyEmptyText("{\\an8}")).toBe(true);
    expect(isVisuallyEmptyText("{\\b1}  {\\b0}")).toBe(true);
    expect(isVisuallyEmptyText("a")).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("filters by style, emptyOnly, and time intersection", () => {
    const c = cue("a", "text", {
      style: "Secondary",
      startMs: 1000,
      endMs: 2000,
    });
    expect(matchesFilters(c, { style: "Secondary" })).toBe(true);
    expect(matchesFilters(c, { style: "Default" })).toBe(false);
    expect(matchesFilters(c, { emptyOnly: true })).toBe(false);
    expect(matchesFilters(cue("b", ""), { emptyOnly: true })).toBe(true);
    expect(matchesFilters(c, { timeRange: { startMs: 1500, endMs: 2500 } })).toBe(
      true,
    );
    expect(matchesFilters(c, { timeRange: { startMs: 2001 } })).toBe(false);
    expect(matchesFilters(c, { timeRange: { endMs: 999 } })).toBe(false);
  });
});

describe("collectMatches", () => {
  const cues = [
    cue("a", "Hello World", { startMs: 0, endMs: 1000 }),
    cue("b", "hello again", { startMs: 1000, endMs: 2000, style: "Alt" }),
    cue("c", "{\\b1}other{\\b0}", { startMs: 2000, endMs: 3000 }),
  ];

  it("matches case-insensitively on primaryText", () => {
    expect(collectMatches(cues, "HELLO")).toEqual(["a", "b"]);
  });

  it("empty query returns all (or filtered) ids", () => {
    expect(collectMatches(cues, "")).toEqual(["a", "b", "c"]);
    expect(collectMatches(cues, "", { style: "Alt" })).toEqual(["b"]);
  });

  it("combines query and filters", () => {
    expect(collectMatches(cues, "hello", { style: "Alt" })).toEqual(["b"]);
  });
});

describe("findAdjacentMatch", () => {
  it("wraps and handles missing current", () => {
    expect(findAdjacentMatch([], "a", 1)).toBeNull();
    expect(findAdjacentMatch(["a"], "x", 1)).toBe("a");
    expect(findAdjacentMatch(["a", "b", "c"], null, 1)).toBe("a");
    expect(findAdjacentMatch(["a", "b", "c"], null, -1)).toBe("c");
    expect(findAdjacentMatch(["a", "b", "c"], "b", 1)).toBe("c");
    expect(findAdjacentMatch(["a", "b", "c"], "c", 1)).toBe("a");
    expect(findAdjacentMatch(["a", "b", "c"], "a", -1)).toBe("c");
  });
});

describe("applyReplace / replaceInCues", () => {
  it("replaces all case-insensitive occurrences literally", () => {
    expect(applyReplace("AaA", "a", "x")).toBe("xxx");
    expect(applyReplace("Hello", "ell", "IPP")).toBe("HIPPo");
    expect(applyReplace("nope", "", "x")).toBe("nope");
  });

  it("only rewrites matched cues' primaryText", () => {
    const cues = [
      cue("a", "foo bar", { style: "Default", name: "n", marginL: 1 }),
      cue("b", "baz", { startMs: 50, endMs: 60 }),
    ];
    const next = replaceInCues(cues, ["a"], "foo", "qux");
    expect(next[0]).toMatchObject({
      id: "a",
      primaryText: "qux bar",
      style: "Default",
      name: "n",
      marginL: 1,
    });
    expect(next[1]).toBe(cues[1]);
  });

  it("returns original array when nothing changes", () => {
    const cues = [cue("a", "keep")];
    expect(replaceInCues(cues, ["a"], "zzz", "x")).toBe(cues);
  });
});
