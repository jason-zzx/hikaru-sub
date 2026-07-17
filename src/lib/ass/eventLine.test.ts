import { describe, expect, it } from "vitest";
import { formatDialogueEventLine, parseDialogueEventLine } from "./eventLine";
import { cuesToEvents } from "./bilingual";
import { parseAss } from "./parse";
import { serializeAss } from "./serialize";
import { createDefaultDocument } from "./defaults";
import type { SubtitleCue } from "./types";

function cue(partial: Partial<SubtitleCue> & Pick<SubtitleCue, "id">): SubtitleCue {
  return {
    startMs: 0,
    endMs: 2600,
    primaryText: "hello",
    style: "Primary",
    layer: 0,
    ...partial,
  };
}

describe("formatDialogueEventLine", () => {
  it("formats a complete Dialogue line with defaults", () => {
    expect(formatDialogueEventLine(cue({ id: "1", layer: 0 }))).toBe(
      "Dialogue: 0,0:00:00.00,0:00:02.60,Primary,,0,0,0,,hello",
    );
  });

  it("converts real newlines to \\N and keeps commas in Text", () => {
    const line = formatDialogueEventLine(
      cue({
        id: "1",
        primaryText: "a,b\nc",
        startMs: 1000,
        endMs: 2000,
        style: "Secondary",
        layer: 2,
      }),
    );
    expect(line).toBe(
      "Dialogue: 2,0:00:01.00,0:00:02.00,Secondary,,0,0,0,,a,b\\Nc",
    );
  });
});

describe("parseDialogueEventLine", () => {
  it("parses valid Dialogue lines including commas in Text", () => {
    const parsed = parseDialogueEventLine(
      "Dialogue: 1,0:00:01.00,0:00:02.50,Primary,,0,0,0,,a,b\\Nc",
      "new",
    );
    expect(parsed).toEqual({
      id: "new",
      layer: 1,
      startMs: 1000,
      endMs: 2500,
      style: "Primary",
      primaryText: "a,b\nc",
      name: "",
      marginL: 0,
      marginR: 0,
      marginV: 0,
      effect: "",
    });
  });

  it("rejects Comment, malformed prefixes, and invalid times/fields", () => {
    expect(
      parseDialogueEventLine(
        "Comment: 0,0:00:00.00,0:00:01.00,Primary,,0,0,0,,x",
        "id",
      ),
    ).toBeNull();
    expect(parseDialogueEventLine("not a dialogue", "id")).toBeNull();
    expect(
      parseDialogueEventLine(
        "Dialogue: x,0:00:00.00,0:00:01.00,Primary,,0,0,0,,x",
        "id",
      ),
    ).toBeNull();
    expect(
      parseDialogueEventLine(
        "Dialogue: 0,bad,0:00:01.00,Primary,,0,0,0,,x",
        "id",
      ),
    ).toBeNull();
    expect(
      parseDialogueEventLine(
        "Dialogue: 0,0:00:00.00,0:00:01.00,Primary,,0,0,0",
        "id",
      ),
    ).toBeNull();
    expect(
      parseDialogueEventLine(
        "Dialogue: 0,0:00:00.00,0:00:01.00,,0,0,0,,x",
        "id",
      ),
    ).toBeNull();
  });

  it("round-trips through format including optional Dialogue fields", () => {
    const original = cue({
      id: "keep",
      layer: 3,
      startMs: 12340,
      endMs: 15000,
      style: "Secondary",
      primaryText: "译 / 原, ok",
      name: "Narrator",
      marginL: 5,
      marginR: 6,
      marginV: 7,
      effect: "Scroll up;50;1",
    });
    const line = formatDialogueEventLine(original);
    expect(line).toBe(
      "Dialogue: 3,0:00:12.34,0:00:15.00,Secondary,Narrator,5,6,7,Scroll up;50;1,译 / 原, ok",
    );
    expect(parseDialogueEventLine(line, "fresh")).toEqual({
      ...original,
      id: "fresh",
    });
  });
});

describe("order-preserving serialization", () => {
  it("preserves cue array order when preserveOrder is set", () => {
    const cues: SubtitleCue[] = [
      cue({ id: "late", startMs: 5000, endMs: 6000, primaryText: "late" }),
      cue({ id: "early", startMs: 0, endMs: 1000, primaryText: "early" }),
    ];
    const events = cuesToEvents(cues, { preserveOrder: true, mergeMode: "inline" });
    expect(events.map((e) => e.text)).toEqual(["late", "early"]);

    const doc = { ...createDefaultDocument(), cues };
    const sorted = serializeAss(doc);
    const ordered = serializeAss(doc, { preserveOrder: true });
    expect(sorted.indexOf("early")).toBeLessThan(sorted.indexOf("late"));
    expect(ordered.indexOf("late")).toBeLessThan(ordered.indexOf("early"));
  });
});

describe("physical ASS Dialogue field round-trip", () => {
  it("parseAss + serializeAss retains Layer/Name/margins/Effect", () => {
    const source = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Primary,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 2,0:00:01.00,0:00:02.00,Primary,Actor,10,20,30,Banner;5,hello
Dialogue: 0,0:00:03.00,0:00:04.00,Primary,,0,0,0,,world
`;
    const parsed = parseAss(source, { mergeBilingual: false });
    expect(parsed.cues).toHaveLength(2);
    expect(parsed.cues[0]).toMatchObject({
      layer: 2,
      name: "Actor",
      marginL: 10,
      marginR: 20,
      marginV: 30,
      effect: "Banner;5",
      primaryText: "hello",
    });
    expect(parsed.cues[1]).toMatchObject({
      layer: 0,
      name: "",
      marginL: 0,
      marginR: 0,
      marginV: 0,
      effect: "",
      primaryText: "world",
    });

    const roundTripped = parseAss(
      serializeAss(parsed, { preserveOrder: true, mergeMode: "inline" }),
      { mergeBilingual: false },
    );
    expect(roundTripped.cues.map(({ id: _id, ...rest }) => rest)).toEqual(
      parsed.cues.map(({ id: _id, ...rest }) => rest),
    );
  });
});
