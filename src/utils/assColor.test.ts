import { describe, expect, it } from "vitest";
import { assToRgba, rgbaToAss } from "./assColor";

describe("assToRgba", () => {
  it("parses opaque white", () => {
    expect(assToRgba("&H00FFFFFF")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    });
  });

  it("parses fully transparent black", () => {
    expect(assToRgba("&HFF000000")).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });

  it("falls back to opaque white for invalid input", () => {
    expect(assToRgba("invalid")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    });
  });
});

describe("rgbaToAss", () => {
  it("formats opaque white", () => {
    expect(rgbaToAss({ r: 255, g: 255, b: 255, a: 1 })).toBe("&H00FFFFFF");
  });

  it("formats fully transparent black", () => {
    expect(rgbaToAss({ r: 0, g: 0, b: 0, a: 0 })).toBe("&HFF000000");
  });

  it("formats half-transparent red as ASS ABGR", () => {
    expect(rgbaToAss({ r: 255, g: 0, b: 0, a: 0.5 })).toBe("&H800000FF");
  });

  it("clamps channel and alpha bounds", () => {
    expect(rgbaToAss({ r: 300, g: -10, b: 150, a: 1.5 })).toBe("&H009600FF");
    expect(rgbaToAss({ r: 100, g: 100, b: 100, a: -0.5 })).toBe("&HFF646464");
  });
});
