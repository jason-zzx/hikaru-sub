import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/workflow/TranscribeView.tsx", import.meta.url),
  ),
  "utf8",
);

describe("TranscribeView ASR setup guidance", () => {
  it("guides users to Settings when engine dependencies are missing", () => {
    expect(source).toContain("selectedEngineUnavailable");
    expect(source).toContain("当前引擎依赖未安装");
    expect(source).toContain('setStep("settings")');
    expect(source).toContain("!audioReady || selectedEngineUnavailable");
  });

  it("does not launch the ASR sidecar just by entering the page", () => {
    expect(source).not.toContain("void detectEngines();");
    expect(source).toContain("检测引擎状态");
    expect(source).toContain("onClick={detectEngines}");
  });
});
