import { describe, expect, it } from "vitest";
import { assColorToCss, clampByte, parseAssColor, rgbaToAssColor, toHexByte } from "./color";

describe("parseAssColor", () => {
  it("parses opaque white", () => {
    expect(parseAssColor("&H00FFFFFF")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    });
  });

  it("parses fully transparent black", () => {
    expect(parseAssColor("&HFF000000")).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });

  it("falls back to opaque white for invalid input", () => {
    expect(parseAssColor("invalid")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    });
  });
});

describe("rgbaToAssColor", () => {
  it("formats opaque white", () => {
    expect(rgbaToAssColor({ r: 255, g: 255, b: 255, a: 1 })).toBe("&H00FFFFFF");
  });

  it("formats fully transparent black", () => {
    expect(rgbaToAssColor({ r: 0, g: 0, b: 0, a: 0 })).toBe("&HFF000000");
  });

  it("formats half-transparent red as ASS ABGR", () => {
    expect(rgbaToAssColor({ r: 255, g: 0, b: 0, a: 0.5 })).toBe("&H800000FF");
  });

  it("clamps channel and alpha bounds", () => {
    expect(rgbaToAssColor({ r: 300, g: -10, b: 150, a: 1.5 })).toBe("&H009600FF");
    expect(rgbaToAssColor({ r: 100, g: 100, b: 100, a: -0.5 })).toBe("&HFF646464");
  });
});

describe("assColorToCss and byte helpers", () => {
  it("formats hex bytes and css colors", () => {
    expect(clampByte(-5)).toBe(0);
    expect(clampByte(300)).toBe(255);
    expect(toHexByte(15)).toBe("0F");
    expect(assColorToCss("&H00112233")).toBe("#332211");
  });
});
