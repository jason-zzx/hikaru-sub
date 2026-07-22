import { describe, expect, it } from "vitest";
import {
  hasOverlappingCues,
  serializeSrt,
  stripAssText,
} from "./subtitleExport";
import type { SubtitleCue } from "@/lib/ass";

function cue(partial: Partial<SubtitleCue>): SubtitleCue {
  return {
    id: "c1",
    startMs: 0,
    endMs: 1000,
    primaryText: "text",
    style: "Default",
    layer: 0,
    ...partial,
  };
}

describe("stripAssText", () => {
  it("removes override blocks and converts line breaks", () => {
    expect(
      stripAssText(
        "{\\an8\\fs20}你好\\N{\\i1}世界{\\i0}\\h!\\\\路径\\\\h",
      ),
    ).toBe("你好\n世界 !\\路径\\h");
  });
});

describe("serializeSrt", () => {
  it("emits numbered blocks with comma millis, sorted by start", () => {
    const srt = serializeSrt([
      cue({ id: "b", startMs: 61_500, endMs: 62_000, primaryText: "第二" }),
      cue({ id: "a", startMs: 1_234, endMs: 3_456, primaryText: "第一\\N行" }),
    ]);
    expect(srt).toBe(
      "1\n00:00:01,234 --> 00:00:03,456\n第一\n行\n\n" +
        "2\n00:01:01,500 --> 00:01:02,000\n第二\n",
    );
  });

  it("pads hours beyond 99 without truncating", () => {
    const srt = serializeSrt([
      cue({ startMs: 100 * 3_600_000, endMs: 100 * 3_600_000 + 1 }),
    ]);
    expect(srt).toContain("100:00:00,000 --> 100:00:00,001");
  });
});

describe("hasOverlappingCues", () => {
  it("detects same-range separate-lines pairs", () => {
    expect(
      hasOverlappingCues([
        cue({ id: "a", startMs: 0, endMs: 1000 }),
        cue({ id: "b", startMs: 0, endMs: 1000 }),
      ]),
    ).toBe(true);
    expect(
      hasOverlappingCues([
        cue({ id: "a", startMs: 0, endMs: 1000 }),
        cue({ id: "b", startMs: 1000, endMs: 2000 }),
      ]),
    ).toBe(false);
  });

  it("detects overlap when one cue contains another", () => {
    expect(
      hasOverlappingCues([
        cue({ id: "outer", startMs: 0, endMs: 10_000 }),
        cue({ id: "inner", startMs: 1000, endMs: 2000 }),
        cue({ id: "later", startMs: 3000, endMs: 4000 }),
      ]),
    ).toBe(true);
  });
});
