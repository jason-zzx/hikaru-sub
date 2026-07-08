import { describe, expect, it } from "vitest";
import {
  isKnownCjkFontName,
  normalizeFontLookupName,
} from "./fontFamilyAliases";

describe("fontFamilyAliases", () => {
  it("keeps leading-dot localized font family names searchable", () => {
    expect(normalizeFontLookupName(".苹方-简")).toBe("苹方简");
    expect(isKnownCjkFontName(".苹方-简")).toBe(true);
  });

  it("still strips real font file extensions", () => {
    expect(normalizeFontLookupName("arial.ttf")).toBe("arial");
  });
});
