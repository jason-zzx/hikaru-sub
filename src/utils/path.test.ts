import { describe, expect, it } from "vitest";
import { getFileName, getFileStem, getParentDir } from "./path";

describe("path utils", () => {
  it("extracts file names across Windows and POSIX separators", () => {
    expect(getFileName("C:\\media\\ep01.mkv")).toBe("ep01.mkv");
    expect(getFileName("/tmp/videos/clip.mp4")).toBe("clip.mp4");
    expect(getFileName("plain.ass")).toBe("plain.ass");
  });

  it("extracts parent directories with optional root preservation", () => {
    expect(getParentDir("C:\\media\\ep01.mkv")).toBe("C:\\media");
    expect(getParentDir("/tmp/videos/clip.mp4")).toBe("/tmp/videos");
    expect(getParentDir("plain.ass")).toBe("");
    expect(getParentDir("/root-file.mp4")).toBe("");
    expect(getParentDir("/root-file.mp4", { preserveRoot: true })).toBe("/");
  });

  it("extracts file stems with configurable fallback", () => {
    expect(getFileStem("C:\\media\\ep.01.mkv")).toBe("ep.01");
    expect(getFileStem("/tmp/.hidden", "video")).toBe("video");
    expect(getFileStem("C:\\media\\")).toBe("output");
  });
});
