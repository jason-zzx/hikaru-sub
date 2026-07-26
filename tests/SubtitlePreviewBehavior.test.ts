import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

describe("editor libass subtitle preview integration", () => {
  it("drives libass preview from video frame callbacks during playback", () => {
    const overlay = readSource(
      "src/components/player/LibassSubtitleOverlay.tsx",
    );
    const preview = readSource("src/components/player/SubtitlePreview.tsx");

    expect(overlay).toContain("startLibassVideoFrameSync");
    expect(preview).toContain("videoElement={videoElement}");
  });

  it("allows libass to retry after editable ASS text changes", () => {
    const preview = readSource("src/components/player/SubtitlePreview.tsx");

    expect(preview).toContain("[assText, fontKey, rendererMode]");
  });

  it("never resolves preview cues from stale paused time while playing", () => {
    const player = readSource("src/components/player/VideoPlayer.tsx");

    // 播放中字幕选择由 activeCueId（边界频率）驱动；时间参数必须是命中不了
    // 任何 cue 的哨兵，避免 CSS 兜底在字幕空档用暂停时的陈旧时间误显旧句。
    expect(player).toContain("pausedTimeMs ?? -1");
    expect(player).toContain(
      "activeCueId={isPlaying ? playingActiveCueId : selectedCueId}",
    );
  });
});
