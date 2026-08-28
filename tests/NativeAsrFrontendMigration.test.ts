import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const transcribe = read("../src/components/workflow/TranscribeView.tsx");
const settings = read("../src/components/workflow/SettingsTranscriptionPanel.tsx");
const select = read("../src/components/ui/select-adapter.tsx");

describe("Native ASR frontend migration contract", () => {
  it("uses one availability owner and disabled Select items", () => {
    expect(transcribe).toContain("useAsrAvailability(engine, model, device)");
    expect(settings).toContain("useAsrAvailability(");
    expect(select).toContain("disabled?: boolean");
    expect(select).toContain("disabled={opt.disabled}");
  });

  it("gates starts and sends the Native MVP VAD contract", () => {
    expect(transcribe).toContain("!availability.routeAvailable");
    expect(transcribe).toContain("useVad: false");
    expect(transcribe).toContain("vadConfig: null");
    expect(transcribe).not.toMatch(/启用 VAD|配置当前引擎依赖|无法启动 sidecar/);
  });

  it("preserves download, polling, cancellation, document, ASS, and translation seams", () => {
    for (const marker of [
      "checkForTranscribe",
      "startDownload",
      "getAsrProgress",
      "cancelAsr",
      "captureProjectDocumentGuard",
      "withDiscardedSubtitleRecovery",
      "getVideoInfo",
      "createDefaultDocument",
      "serializeAss",
      "saveAssText",
      'setStep("translate")',
    ]) {
      expect(transcribe).toContain(marker);
    }
    expect(transcribe).toContain("模型未下载，是否开始下载模型并转录");
  });
});
