import type { AssStyle } from "@/lib/ass";
import { describe, expect, it } from "vitest";
import {
  applyToggleOverrideTag,
  applyAttributeOverrideTag,
  restoreTagForStyle,
  colorOverrideStartTag,
  applyAlignmentReplace,
  findEffectiveAlignment,
} from "./assOverrideTags";

describe("applyToggleOverrideTag", () => {
  it("wraps selected text with start and end tags", () => {
    expect(
      applyToggleOverrideTag("hello world", 6, 11, {
        startTag: "{\\b1}",
        endTag: "{\\b0}",
      }),
    ).toEqual({
      text: "hello {\\b1}world{\\b0}",
      selectionStart: 21,
      selectionEnd: 21,
    });
  });

  it("inserts a start tag when no same override is open before the cursor", () => {
    expect(
      applyToggleOverrideTag("hello ", 6, 6, {
        startTag: "{\\i1}",
        endTag: "{\\i0}",
      }),
    ).toEqual({
      text: "hello {\\i1}",
      selectionStart: 11,
      selectionEnd: 11,
    });
  });

  it("inserts an end tag when the latest same override before the cursor is open", () => {
    expect(
      applyToggleOverrideTag("{\\u1}hello", 10, 10, {
        startTag: "{\\u1}",
        endTag: "{\\u0}",
      }),
    ).toEqual({
      text: "{\\u1}hello{\\u0}",
      selectionStart: 15,
      selectionEnd: 15,
    });
  });

  it("ignores unrelated open tags when deciding whether to close", () => {
    expect(
      applyToggleOverrideTag("{\\b1}hello", 10, 10, {
        startTag: "{\\i1}",
        endTag: "{\\i0}",
      }),
    ).toEqual({
      text: "{\\b1}hello{\\i1}",
      selectionStart: 15,
      selectionEnd: 15,
    });
  });
});

const STYLE: AssStyle = {
  name: "Primary",
  fontName: "Noto Sans CJK JP",
  fontSize: 54,
  primaryColor: "&H00FFFFFF",
  secondaryColor: "&H000000FF",
  outlineColor: "&H00000000",
  backColor: "&H80000000",
  bold: false,
  italic: false,
  underline: false,
  strikeOut: false,
  scaleX: 100,
  scaleY: 100,
  spacing: 0,
  angle: 0,
  borderStyle: 1,
  outline: 2,
  shadow: 1,
  alignment: 2,
  marginL: 10,
  marginR: 10,
  marginV: 40,
  encoding: 1,
};

describe("applyAttributeOverrideTag", () => {
  it("inserts the start tag when there is no selection", () => {
    expect(
      applyAttributeOverrideTag("hello world", 6, 6, {
        startTag: "{\\bord4}",
        restoreTag: "{\\bord2}",
      }),
    ).toEqual({
      text: "hello {\\bord4}world",
      selectionStart: 14,
      selectionEnd: 14,
    });
  });

  it("wraps selected text with the start and restore tags", () => {
    expect(
      applyAttributeOverrideTag("hello world", 6, 11, {
        startTag: "{\\3c&H000000FF}",
        restoreTag: "{\\3c&H00000000}",
      }),
    ).toEqual({
      text: "hello {\\3c&H000000FF}world{\\3c&H00000000}",
      selectionStart: 41,
      selectionEnd: 41,
    });
  });

  it("does not invent a restore tag when style defaults are unavailable", () => {
    expect(
      applyAttributeOverrideTag("hello world", 6, 11, {
        startTag: "{\\shad3}",
      }),
    ).toEqual({
      text: "hello {\\shad3}world",
      selectionStart: 14,
      selectionEnd: 14,
    });
  });
});

describe("restoreTagForStyle", () => {
  it("builds restore tags from the current ASS style", () => {
    expect(restoreTagForStyle("fontName", STYLE)).toBe("{\\fnNoto Sans CJK JP}");
    expect(restoreTagForStyle("fontSize", STYLE)).toBe("{\\fs54}");
    expect(restoreTagForStyle("primaryColor", STYLE)).toBe("{\\c&HFFFFFF\\1a&H00}");
    expect(restoreTagForStyle("outlineColor", STYLE)).toBe("{\\3c&H000000\\3a&H00}");
    expect(restoreTagForStyle("backColor", STYLE)).toBe("{\\4c&H000000\\4a&H80}");
    expect(restoreTagForStyle("outline", STYLE)).toBe("{\\bord2}");
    expect(restoreTagForStyle("shadow", STYLE)).toBe("{\\shad1}");
    expect(restoreTagForStyle("alignment", STYLE)).toBe("{\\an2}");
  });

  it("formats decimal outline and shadow values without unnecessary trailing zeroes", () => {
    expect(restoreTagForStyle("outline", { ...STYLE, outline: 2.5 })).toBe(
      "{\\bord2.5}",
    );
    expect(restoreTagForStyle("shadow", { ...STYLE, shadow: 0 })).toBe(
      "{\\shad0}",
    );
  });

  it("returns undefined when the style is missing or alignment is invalid", () => {
    expect(restoreTagForStyle("primaryColor", undefined)).toBeUndefined();
    expect(restoreTagForStyle("alignment", { ...STYLE, alignment: 10 })).toBeUndefined();
  });
});

describe("colorOverrideStartTag", () => {
  it("splits the color into a 6-digit \\Xc (BGR) and a separate \\Xa alpha", () => {
    expect(colorOverrideStartTag("primaryColor", "&H800000F8")).toBe(
      "{\\c&H0000F8\\1a&H80}",
    );
    expect(colorOverrideStartTag("outlineColor", "&H000000FF")).toBe(
      "{\\3c&H0000FF\\3a&H00}",
    );
    expect(colorOverrideStartTag("backColor", "&H80000000")).toBe(
      "{\\4c&H000000\\4a&H80}",
    );
  });

  it("emits \\Xa&H00 for opaque colors so prior alpha is reset", () => {
    expect(colorOverrideStartTag("primaryColor", "&H00FFFFFF")).toBe(
      "{\\c&HFFFFFF\\1a&H00}",
    );
  });
});

describe("applyAlignmentReplace", () => {
  it("prepends the alignment tag and strips a standalone existing \\an", () => {
    expect(applyAlignmentReplace("{\\an2}hello", 8)).toEqual({
      text: "{\\an8}hello",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it("strips \\an inside a multi-tag block and cleans empty blocks", () => {
    expect(applyAlignmentReplace("{\\c&H00FFFFFF\\an2}hello", 8)).toEqual({
      text: "{\\an8}{\\c&H00FFFFFF}hello",
      selectionStart: 20,
      selectionEnd: 20,
    });
  });

  it("prepends when no existing alignment is present", () => {
    expect(applyAlignmentReplace("hello", 8)).toEqual({
      text: "{\\an8}hello",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });
});

describe("findEffectiveAlignment", () => {
  it("returns the last \\an value found in the text", () => {
    expect(findEffectiveAlignment("{\\an8}hello", 2)).toBe(8);
    expect(findEffectiveAlignment("hello{\\an8}{\\an1}", 2)).toBe(1);
  });

  it("falls back to the provided default when no \\an is present", () => {
    expect(findEffectiveAlignment("hello", 2)).toBe(2);
    expect(findEffectiveAlignment("hello")).toBeUndefined();
  });
});
