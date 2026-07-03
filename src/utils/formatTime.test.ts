import { describe, expect, it } from "vitest";
import { formatPlaybackTime } from "./formatTime";

describe("formatPlaybackTime", () => {
  it("无毫秒时为 M:SS / H:MM:SS（分钟不补零）", () => {
    expect(formatPlaybackTime(0, false)).toBe("0:00");
    expect(formatPlaybackTime(30000, false)).toBe("0:30");
    expect(formatPlaybackTime(90000, false)).toBe("1:30");
    expect(formatPlaybackTime(5400000, false)).toBe("1:30:00");
  });

  it("withMs 时附加 3 位毫秒", () => {
    expect(formatPlaybackTime(0, true)).toBe("0:00.000");
    expect(formatPlaybackTime(1234, true)).toBe("0:01.234");
    expect(formatPlaybackTime(90061, true)).toBe("1:30.061");
    expect(formatPlaybackTime(5400000, true)).toBe("1:30:00.000");
  });

  it("负数按 0 处理", () => {
    expect(formatPlaybackTime(-100, true)).toBe("0:00.000");
  });
});
