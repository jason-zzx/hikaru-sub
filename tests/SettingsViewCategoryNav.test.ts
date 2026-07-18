import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const settingsSource = readFileSync(
  fileURLToPath(
    new URL("../src/components/workflow/SettingsView.tsx", import.meta.url),
  ),
  "utf8",
);
const uiStoreSource = readFileSync(
  fileURLToPath(new URL("../src/stores/uiStore.ts", import.meta.url)),
  "utf8",
);
const transcribeSource = readFileSync(
  fileURLToPath(
    new URL("../src/components/workflow/TranscribeView.tsx", import.meta.url),
  ),
  "utf8",
);
const translateSource = readFileSync(
  fileURLToPath(
    new URL("../src/components/workflow/TranslateView.tsx", import.meta.url),
  ),
  "utf8",
);

describe("SettingsView category navigation", () => {
  it("defaults to runtime and exposes Chinese category labels", () => {
    expect(settingsSource).toContain(
      "useUiStore.getState().settingsCategory ?? \"runtime\"",
    );
    expect(settingsSource).toContain('label: "运行依赖"');
    expect(settingsSource).toContain('label: "转录"');
    expect(settingsSource).toContain('label: "翻译"');
    expect(settingsSource).toContain("RuntimeDependenciesPanel");
    expect(settingsSource).toContain("SettingsTranscriptionPanel");
    expect(settingsSource).toContain("SettingsTranslationPanel");
    expect(settingsSource).not.toContain("SettingsRuntimePanel");
  });

  it("routes runtime configure action to the transcription category", () => {
    expect(settingsSource).toContain("handleConfigureAsrFromRuntimePanel");
    expect(settingsSource).toContain('setActiveCategory("transcription")');
    expect(settingsSource).not.toContain("scrollIntoView");
    expect(settingsSource).not.toContain("asrSectionRef");
  });

  it("deep-links other pages into the matching settings category", () => {
    expect(uiStoreSource).toContain("openSettings:");
    expect(transcribeSource).toContain('openSettings("transcription")');
    expect(transcribeSource).toContain('openSettings("runtime")');
    expect(translateSource).toContain('openSettings("translation")');
  });
});
