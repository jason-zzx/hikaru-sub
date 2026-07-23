import { describe, expect, it } from "vitest";
import {
  createDefaultStyles,
  parseAss,
  serializeAss,
  type AssDocument,
  type SerializeOptions,
  type SubtitleCue,
} from "@/lib/ass";

/** Translation boundary: logical cues -> serialize(options) -> parse physical rows. */
function expandToPhysicalRows(
  logical: SubtitleCue[],
  base: AssDocument,
  options: SerializeOptions,
): SubtitleCue[] {
  const serialized = serializeAss(
    { ...base, cues: logical },
    { ...options, preserveOrder: true },
  );
  return parseAss(serialized, { mergeBilingual: false }).cues;
}

describe("translation physical boundary", () => {
  const base = parseAss(
    [
      "[Script Info]",
      "Title: t",
      "ScriptType: v4.00+",
      "PlayResX: 1920",
      "PlayResY: 1080",
      "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      "Style: Primary,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1",
      "Style: Secondary,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1",
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:00.00,0:00:02.00,Primary,,0,0,0,,源文",
    ].join("\n"),
    { mergeBilingual: false },
  );

  const logical: SubtitleCue[] = [
    {
      id: "1",
      startMs: 0,
      endMs: 2000,
      primaryText: "源文",
      secondaryText: "译文",
      style: "Primary",
      layer: 0,
    },
  ];

  it("uses equal default vertical margins for bilingual styles", () => {
    expect(createDefaultStyles().map((style) => style.marginV)).toEqual([40, 40]);
  });

  it("inline mode uses translation-first order and the fixed separator", () => {
    const physical = expandToPhysicalRows(logical, base, {
      mergeMode: "inline",
    });
    expect(physical).toHaveLength(1);
    expect(physical[0].primaryText).toBe("译文 / 源文");
    expect(physical[0].secondaryText).toBeUndefined();
  });

  it("inline mode supports source-first order", () => {
    const physical = expandToPhysicalRows(logical, base, {
      mergeMode: "inline",
      textOrder: "source-first",
    });
    expect(physical[0].primaryText).toBe("源文 / 译文");
  });

  it("separate mode emits translation first by default", () => {
    const physical = expandToPhysicalRows(logical, base, { mergeMode: "separate" });
    expect(physical).toHaveLength(2);
    expect(physical.map((c) => c.style)).toEqual(["Secondary", "Primary"]);
    expect(physical.map((c) => c.primaryText)).toEqual(["译文", "源文"]);
    expect(physical.every((c) => c.secondaryText === undefined)).toBe(true);
  });

  it("separate mode supports source-first order", () => {
    const physical = expandToPhysicalRows(logical, base, {
      mergeMode: "separate",
      textOrder: "source-first",
    });
    expect(physical.map((c) => c.style)).toEqual(["Secondary", "Primary"]);
    expect(physical.map((c) => c.primaryText)).toEqual(["源文", "译文"]);
  });

  it("translation-only mode omits source-only cues", () => {
    const physical = expandToPhysicalRows(
      [logical[0], { ...logical[0], id: "missing", secondaryText: undefined }],
      base,
      { mergeMode: "translation-only" },
    );
    expect(physical.map((c) => c.primaryText)).toEqual(["译文"]);
    expect(physical[0].style).toBe("Primary");
  });

  it("preserves source cue order while expanding bilingual output", () => {
    const reordered = [
      { ...logical[0], id: "later", startMs: 5000, endMs: 6000, primaryText: "后文" },
      { ...logical[0], id: "earlier", startMs: 0, endMs: 1000, primaryText: "前文" },
    ];
    const physical = expandToPhysicalRows(reordered, base, { mergeMode: "inline" });

    expect(physical.map((cue) => cue.primaryText)).toEqual([
      "译文 / 后文",
      "译文 / 前文",
    ]);
  });
});
