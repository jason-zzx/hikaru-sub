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
});
