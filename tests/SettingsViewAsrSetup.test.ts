import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const settingsSource = readFileSync(
  fileURLToPath(
    new URL("../src/components/workflow/SettingsView.tsx", import.meta.url),
  ),
  "utf8",
);
const panelSource = readFileSync(
  fileURLToPath(
    new URL(
      "../src/components/workflow/AsrEngineSetupPanel.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("SettingsView ASR setup", () => {
  it("mounts the ASR setup panel near ASR defaults", () => {
    expect(settingsSource).toContain("AsrEngineSetupPanel");
    expect(settingsSource).toContain("日语转录（ASR）默认");
  });

  it("reloads backend settings after setup updates managed ASR paths", () => {
    expect(settingsSource).toContain("refreshSettingsAfterAsrSetup");
    expect(settingsSource).toContain("const next = await getSettings()");
    expect(settingsSource).toContain("setLocal(next)");
  });

  it("probes with draft paths and recovers from polling errors", () => {
    expect(panelSource).toContain("probeAsrSetupEnvironment({");
    expect(panelSource).toContain("pythonPath: pythonPath ?? null");
    expect(panelSource).toContain("asrServicePath: asrServicePath ?? null");
    expect(panelSource).toContain("刷新配置进度失败");
    expect(panelSource).toContain("setRunning(false)");
  });

  it("uses Chinese setup labels and no emoji UI", () => {
    expect(panelSource).toContain("配置当前引擎依赖");
    expect(panelSource).toContain("查看安装日志");
    expect(panelSource).toContain("重建虚拟环境");
    expect(panelSource).not.toMatch(/[🚀✅❌⚠️]/u);
  });
});
