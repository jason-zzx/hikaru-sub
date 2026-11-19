import { describe, expect, it } from "vitest";
import { formatDurationSeconds, formatPlaybackTime } from "./formatTime";

describe("formatPlaybackTime", () => {
  it("无毫秒时为 M:SS / H:MM:SS（分钟与小时不补零）", () => {
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

  it("负数与非有限值按 0 处理", () => {
    expect(formatPlaybackTime(-100, true)).toBe("0:00.000");
    expect(formatPlaybackTime(Number.NaN, false)).toBe("0:00");
    expect(formatPlaybackTime(Number.POSITIVE_INFINITY, true)).toBe("0:00.000");
  });
});

describe("formatDurationSeconds", () => {
  it("按秒四舍五入并在 >= 1h 时输出 H:MM:SS", () => {
    expect(formatDurationSeconds(0)).toBe("0:00");
    expect(formatDurationSeconds(-100)).toBe("0:00");
    expect(formatDurationSeconds(Number.NaN)).toBe("0:00");
    expect(formatDurationSeconds(499)).toBe("0:00");
    expect(formatDurationSeconds(500)).toBe("0:01");
    expect(formatDurationSeconds(59_600)).toBe("1:00");
    expect(formatDurationSeconds(3_599_600)).toBe("1:00:00");
    expect(formatDurationSeconds(3_900_000)).toBe("1:05:00");
  });
});
