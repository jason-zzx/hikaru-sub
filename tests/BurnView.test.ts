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
});
