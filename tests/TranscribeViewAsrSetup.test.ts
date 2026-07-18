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
    expect(source).toContain("engineSetupRequired");
    expect(source).toContain("ASR_ENGINE_NOT_INSTALLED_LABEL");
    expect(source).toContain('openSettings("transcription")');
    expect(source).toContain("前往设置");
    expect(source).toMatch(
      /!audioReady\s*\|\|\s*engineSetupRequired\s*\|\|\s*modelDownloading\s*\|\|\s*checkingModel/,
    );
  });

  it("guides users to Settings when sidecar cannot start because engine is not installed", () => {
    expect(source).toContain("isAsrEngineNotInstalledError");
    expect(source).toContain("ASR_ENGINE_NOT_INSTALLED_LABEL");
    expect(source).toContain("ASR_ENGINE_NOT_INSTALLED_HINT");
    expect(source).toContain("sidecarEngineMissing");
  });

  it("does not launch the ASR sidecar just by entering the page", () => {
    expect(source).not.toContain("void detectEngines();");
    expect(source).toContain("检测引擎状态");
    expect(source).toContain("onClick={detectEngines}");
  });

  it("shows the approved Kotoba description under its model selector", () => {
    expect(source).toContain("KOTOBA_FASTER_WHISPER_DESCRIPTION");
    expect(source).toContain('engine === "kotoba-faster-whisper"');
  });

  it("resets the model for engine changes and wires ModelManager", () => {
    expect(source).toContain("setModel(defaultAsrModel(nextEngine))");
    expect(source).toContain("engine={engine}");
    expect(source).toContain("model={model}");
  });

  it("prompts to download the model before transcription when missing", () => {
    expect(source).toContain("ConfirmDialog");
    expect(source).toContain("模型未下载，是否开始下载模型并转录");
    expect(source).toContain("checkForTranscribe");
    expect(source).toContain("startDownload");
    expect(source).toContain("modelManagerRef");
    expect(source).toContain("checkingModel");
    expect(source).toContain("check_failed");
    expect(source).toContain("onDownloadingChange");
    expect(source).toContain(
      "transcribing || modelDownloading || checkingModel || confirmDownloadOpen",
    );
  });
});
