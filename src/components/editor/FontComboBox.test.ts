import { describe, expect, it } from "vitest";
import { findMatchingFontIndex, fontOptionsWithCurrent } from "./FontComboBox";

describe("findMatchingFontIndex", () => {
  const fonts = ["Arial", "Noto Sans SC", "Microsoft YaHei", "Yu Gothic"];

  it("prefers the first font that starts with the typed value", () => {
    expect(findMatchingFontIndex(fonts, "mi")).toBe(2);
  });

  it("falls back to containing matches", () => {
    expect(findMatchingFontIndex(fonts, "sans")).toBe(1);
  });

  it("returns -1 when there is no usable query or match", () => {
    expect(findMatchingFontIndex(fonts, "")).toBe(-1);
    expect(findMatchingFontIndex(fonts, "missing")).toBe(-1);
  });
});

describe("fontOptionsWithCurrent", () => {
  it("does not move the selected font to the first option", () => {
    expect(
      fontOptionsWithCurrent("Microsoft YaHei", [
        "Arial",
        "Noto Sans SC",
        "Microsoft YaHei",
      ]),
    ).toEqual(["Arial", "Noto Sans SC", "Microsoft YaHei"]);
  });

  it("keeps a missing selected font available without changing known order", () => {
    expect(fontOptionsWithCurrent("Custom Font", ["Arial", "Noto Sans SC"])).toEqual([
      "Arial",
      "Noto Sans SC",
      "Custom Font",
    ]);
  });
});
