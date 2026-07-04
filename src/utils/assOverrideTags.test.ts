import { describe, expect, it } from "vitest";
import { applyToggleOverrideTag } from "./assOverrideTags";

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
