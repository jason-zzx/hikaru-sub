import { describe, expect, it } from "vitest";
import type { SubtitleCue } from "@/lib/ass";
import { getCueListColumnVisibility } from "./cueListColumns";

function cue(partial: Partial<SubtitleCue> & Pick<SubtitleCue, "id">): SubtitleCue {
  return {
    startMs: 0,
    endMs: 1000,
    primaryText: "text",
    style: "Primary",
    layer: 0,
    ...partial,
  };
}

describe("getCueListColumnVisibility", () => {
  it("shows only always-visible columns when all Dialogue fields are default", () => {
    const visibility = getCueListColumnVisibility([
      cue({ id: "a" }),
      cue({ id: "b", primaryText: "other" }),
    ]);
    expect(visibility.columns).toEqual([
      "index",
      "start",
      "end",
      "style",
      "text",
    ]);
  });

  it("inserts optional columns in ASS Format order when any cue is non-default", () => {
    const visibility = getCueListColumnVisibility([
      cue({ id: "a", layer: 1, name: "Actor", marginL: 10, effect: "Banner" }),
      cue({ id: "b", marginR: 5, marginV: 8 }),
    ]);
    expect(visibility.columns).toEqual([
      "index",
      "layer",
      "start",
      "end",
      "style",
      "name",
      "marginL",
      "marginR",
      "marginV",
      "effect",
      "text",
    ]);
    expect(visibility.columns).toHaveLength(11);
    expect(visibility.gridTemplate.includes("minmax(0, 1fr)")).toBe(true);
    expect(visibility.gridTemplate.includes("max-content")).toBe(true);
    expect(visibility.gridTemplate.includes("fit-content(6rem)")).toBe(true);
  });

  it("shows a margin column only when that margin is non-zero on any cue", () => {
    const visibility = getCueListColumnVisibility([
      cue({ id: "a", marginV: 12 }),
    ]);
    expect(visibility.columns).toEqual([
      "index",
      "start",
      "end",
      "style",
      "marginV",
      "text",
    ]);
  });
});
