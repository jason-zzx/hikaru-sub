import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/player/VideoPlayer.tsx", import.meta.url),
  ),
  "utf8",
);

describe("VideoPlayer seek and decode fallback guards", () => {
  it("defers external seek until loadedmetadata when media is not ready", () => {
    expect(source).toContain("loadedmetadata");
    expect(source).toMatch(/readyState\s*>=\s*1/);
    // 外部 seek effect 在未就绪时应监听 loadedmetadata，而不是立刻写 currentTime
    const seekEffectStart = source.indexOf("外部跳转到指定时间");
    expect(seekEffectStart).toBeGreaterThan(-1);
    const seekEffect = source.slice(seekEffectStart, seekEffectStart + 2200);
    expect(seekEffect).toContain("readyState");
    expect(seekEffect).toContain("loadedmetadata");
  });

  it("clamps external seek into [0, duration] to avoid out-of-range decode errors", () => {
    const seekEffectStart = source.indexOf("外部跳转到指定时间");
    const seekEffect = source.slice(seekEffectStart, seekEffectStart + 2800);
    expect(seekEffect).toMatch(/duration/);
    expect(seekEffect).toMatch(/Math\.min|Math\.max/);
  });

  it("writes clamped seek time back to playback store when out of range", () => {
    const seekEffectStart = source.indexOf("外部跳转到指定时间");
    const seekEffect = source.slice(seekEffectStart, seekEffectStart + 3200);
    expect(seekEffect).toContain("setCurrentTime");
  });

  it("falls back to proxy transcode on MEDIA_ERR_DECODE (code 3) as well as code 4", () => {
    expect(source).toMatch(/code\s*===\s*3[\s\S]*?code\s*===\s*4|code\s*===\s*4[\s\S]*?code\s*===\s*3|\(code\s*===\s*3\s*\|\|\s*code\s*===\s*4\)|\(code\s*===\s*4\s*\|\|\s*code\s*===\s*3\)/);
  });

  it("stops polling and surfaces an error when transcode progress reports failed", () => {
    expect(source).toContain("check_transcode_progress");
    expect(source).toMatch(/progress\.failed|failed\s*===?\s*true/);
    expect(source).toMatch(/转码失败/);
  });

  it("does not cancel in-flight transcode on effect cleanup (StrictMode remount safe)", () => {
    const loadEffectStart = source.indexOf("通过本地 HTTP 服务加载视频");
    expect(loadEffectStart).toBeGreaterThan(-1);
    const loadEffect = source.slice(loadEffectStart, loadEffectStart + 1800);
    expect(loadEffect).toContain("cancelled = true");
    expect(loadEffect).not.toContain('invoke("stop_transcode"');
  });
});
