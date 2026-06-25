import { describe, expect, it } from "vitest";
import { computeObjectFitContainRect } from "./videoDisplayRect";

describe("computeObjectFitContainRect", () => {
  it("letterboxes a wider video in a taller container", () => {
    expect(computeObjectFitContainRect(800, 600, 1920, 1080)).toEqual({
      left: 0,
      top: 75,
      width: 800,
      height: 450,
    });
  });

  it("pillarboxes a taller video in a wider container", () => {
    expect(computeObjectFitContainRect(800, 600, 1080, 1920)).toEqual({
      left: 231.25,
      top: 0,
      width: 337.5,
      height: 600,
    });
  });

  it("fills the container when aspect ratios match", () => {
    expect(computeObjectFitContainRect(960, 540, 1920, 1080)).toEqual({
      left: 0,
      top: 0,
      width: 960,
      height: 540,
    });
  });
});
