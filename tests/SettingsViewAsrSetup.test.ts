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

  it("prepares managed Python 3.11 on demand", () => {
    expect(panelSource).toContain("RuntimeDependencyDialog");
    expect(panelSource).toContain("prepareRuntimeDependency({");
    expect(panelSource).toContain('kind: "python311"');
    expect(panelSource).toContain("需要 Python 3.11");
    expect(panelSource).not.toContain("Python 3.10+");
  });

  it("lets runtime dependency rows download or jump to ASR setup", () => {
    expect(settingsSource).toContain("handlePrepareRuntimeDependency");
    expect(settingsSource).toContain("prepareRuntimeDependency({ kind })");
    expect(settingsSource).toContain("getRuntimeDependencyProgress");
    expect(settingsSource).toContain("runtimePreparationSnapshots");
    expect(settingsSource).toContain("handleConfigureAsrFromRuntimePanel");
    expect(settingsSource).toContain("asrSectionRef");
    expect(settingsSource).toContain("scrollIntoView");
    expect(settingsSource).not.toContain("下载中${progress");
  });

  it("refreshes ASR setup environment after managed Python changes", () => {
    expect(settingsSource).toContain("setAsrSetupRefreshKey");
    expect(settingsSource).toContain("refreshKey={asrSetupRefreshKey}");
    expect(panelSource).toContain("refreshKey = 0");
    expect(panelSource).toContain("asrServicePath, refreshKey]");
  });

  it("auto probes download sources when auto mode has no recommendation", () => {
    expect(settingsSource).toContain("refreshRuntimeDependencies({ autoProbeSources: true })");
    expect(settingsSource).toContain("shouldAutoProbeRuntimeSources");
    expect(settingsSource).toContain("probeDownloadSources()");
  });

  it("keeps runtime dependency status out of the settings header", () => {
    expect(settingsSource).not.toContain("{message && (");
    expect(settingsSource).not.toContain("setMessage({ kind: \"ok\"");
  });
});
