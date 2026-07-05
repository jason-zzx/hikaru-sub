import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/editor/SubtitleList.tsx", import.meta.url),
  ),
  "utf8",
);

describe("SubtitleList 时间显示", () => {
  it("开始/结束时间使用 10ms 精度显示", () => {
    expect(source).toContain("formatTime(cue.startMs)");
    expect(source).toContain("formatTime(cue.endMs)");
    expect(source).toContain("function formatTime");
    expect(source).not.toContain("formatPlaybackTime(cue.startMs, true)");
    expect(source).not.toContain("formatPlaybackTime(cue.endMs, true)");
  });
});
