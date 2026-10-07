import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

const { invoke } = await import("@tauri-apps/api/core");
const { startAsr, checkAsrModel, downloadAsrModel, listAsrEngines, getModelDownloadProgress } = await import("./tauri");

describe("ASR Tauri wrappers", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("preserves gated Qwen status and pair-plus-VAD aggregate progress without a new API", async () => {
    const status = {
      engine: "qwen3-asr", model: "Qwen/Qwen3-ASR-1.7B", backend: "crispasr",
      available: false, downloaded: false, disposition: "postMvpUnavailable",
    };
    vi.mocked(invoke).mockResolvedValueOnce(status);
    await expect(checkAsrModel(status.engine, status.model)).resolves.toEqual(status);
    expect(invoke).toHaveBeenLastCalledWith("check_asr_model", { engine: status.engine, model: status.model, useVad: false });
    const progress = {
      id: "pair-job", status: "running", progress: 0.99,
      downloadedBytes: 2019916416, totalBytes: 2020801514,
      revision: "pair-two-sources", hfEndpoint: "https://hf-mirror.com", resolvedPath: null,
    };
    vi.mocked(invoke).mockResolvedValueOnce(progress);
    await expect(getModelDownloadProgress("pair-job")).resolves.toEqual(progress);
    expect(invoke).toHaveBeenLastCalledWith("get_model_download_progress", { jobId: "pair-job" });
  });

  it("carries the selected VAD requirement through status, download and start", async () => {
    for (const useVad of [false, true]) {
      await checkAsrModel("faster-whisper", "small", useVad);
      expect(invoke).toHaveBeenLastCalledWith("check_asr_model", { engine: "faster-whisper", model: "small", useVad });
      await downloadAsrModel("faster-whisper", "small", useVad);
      expect(invoke).toHaveBeenLastCalledWith("download_asr_model", { engine: "faster-whisper", model: "small", useVad });
    }
    await downloadAsrModel("faster-whisper", "small");
    expect(invoke).toHaveBeenLastCalledWith("download_asr_model", { engine: "faster-whisper", model: "small", useVad: false });
    const args = { audioPath: "C:/cache/audio.wav", engine: "kotoba-faster-whisper", model: "kotoba-tech/kotoba-whisper-v2.0-faster", device: "cuda", useVad: true, vadConfig: { threshold: 0.7, minSilenceDurationMs: 300 } };
    await startAsr(args);
    expect(invoke).toHaveBeenLastCalledWith("start_asr", { args });
    const engines = [{ name: "faster-whisper", available: true, devices: [{ device: "cpu", available: true, optionalVad: { available: false, reason: "unavailable" } }] }];
    vi.mocked(invoke).mockResolvedValueOnce({ engines });
    await expect(listAsrEngines()).resolves.toEqual(engines);
  });

  it("returns the structured start result without flattening its notice", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      jobId: "job-auto-fallback",
      notice: "CUDA 启动前检查未通过，已改用 CPU 转录。",
    });
    const args = {
      audioPath: "C:/cache/audio.wav",
      engine: "faster-whisper",
      model: "large-v3",
      device: "auto",
      language: "ja",
      outputAssPath: "C:/media/input.transcribed.ass",
      useVad: false,
      vadConfig: null,
    };

    await expect(startAsr(args)).resolves.toEqual({
      jobId: "job-auto-fallback",
      notice: "CUDA 启动前检查未通过，已改用 CPU 转录。",
    });
    expect(invoke).toHaveBeenCalledWith("start_asr", { args });
  });
});
