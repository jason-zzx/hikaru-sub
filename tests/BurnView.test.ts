import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/workflow/BurnView.tsx", import.meta.url),
  ),
  "utf8",
);

describe("BurnView layout", () => {
  it("keeps the burn page focused on export settings instead of subtitle preview", () => {
    expect(source).toContain("导出设置");
    expect(source).not.toContain("字幕样式预览");
    expect(source).not.toContain("renderSubtitlePreviewFrame");
    expect(source).not.toContain("SubtitlePreview");
    expect(source).not.toContain("max-w-3xl");
  });

  it("waits for user action before probing source video encoding details", () => {
    const oldProbeCall = "probeBurnVideo(project." + "videoPath)";
    expect(source).not.toContain(oldProbeCall);
    expect(source).toContain("handleProbeBurnVideo");
    expect(source).toContain("检测原片参数");
  });

  it("uses the runtime video session burn subtitle path", () => {
    const oldProjectDir = "project" + "Dir";
    expect(source).toContain("session.burnAssPath");
    expect(source).toContain("videoPath: session.videoPath");
    expect(source).toContain("assPath: session.burnAssPath");
    expect(source).not.toContain(oldProjectDir);
    expect(source).not.toContain("burn.input.ass");
  });
});
