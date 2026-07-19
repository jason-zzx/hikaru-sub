import { describe, expect, it } from "vitest";
import { compareSemver } from "./appUpdate";

describe("compareSemver", () => {
  it("orders dotted versions and ignores v / pre-release suffixes", () => {
    expect(compareSemver("0.2.0", "0.2.1")).toBe(-1);
    expect(compareSemver("v0.2.1", "0.2.0")).toBe(1);
    expect(compareSemver("0.2.0-rc.1", "0.2.0")).toBe(0);
    expect(compareSemver("1.0", "1.0.0")).toBe(0);
  });
});
