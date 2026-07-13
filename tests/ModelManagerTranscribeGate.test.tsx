// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelManagerHandle } from "../src/components/workflow/ModelManager";
import { ModelManager } from "../src/components/workflow/ModelManager";

const checkAsrModel = vi.fn();
const downloadAsrModel = vi.fn();
const getModelDownloadProgress = vi.fn();

vi.mock("../src/services/tauri", () => ({
  checkAsrModel: (...args: unknown[]) => checkAsrModel(...args),
  downloadAsrModel: (...args: unknown[]) => downloadAsrModel(...args),
  getModelDownloadProgress: (...args: unknown[]) =>
    getModelDownloadProgress(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  checkAsrModel.mockReset();
  downloadAsrModel.mockReset();
  getModelDownloadProgress.mockReset();
});

describe("ModelManager transcribe gate", () => {
  it("exposes checkForTranscribe that detects undownloaded models", async () => {
    checkAsrModel.mockResolvedValue({
      engine: "faster-whisper",
      model: "large-v3",
      available: true,
      downloaded: false,
    });

    const ref = createRef<ModelManagerHandle>();
    render(<ModelManager ref={ref} engine="faster-whisper" model="large-v3" auto />);

    await waitFor(() => expect(ref.current).toBeTruthy());
    await expect(ref.current!.checkForTranscribe()).resolves.toBe("needs_download");
  });

  it("reports ready when the model is already downloaded", async () => {
    checkAsrModel.mockResolvedValue({
      engine: "faster-whisper",
      model: "large-v3",
      available: true,
      downloaded: true,
    });

    const ref = createRef<ModelManagerHandle>();
    render(<ModelManager ref={ref} engine="faster-whisper" model="large-v3" auto />);

    await waitFor(() => expect(ref.current).toBeTruthy());
    await expect(ref.current!.checkForTranscribe()).resolves.toBe("ready");
  });

  it("reports check_failed when model status check throws", async () => {
    checkAsrModel.mockRejectedValue(new Error("sidecar down"));

    const ref = createRef<ModelManagerHandle>();
    render(
      <ModelManager ref={ref} engine="faster-whisper" model="large-v3" auto={false} />,
    );

    await waitFor(() => expect(ref.current).toBeTruthy());
    await expect(ref.current!.checkForTranscribe()).resolves.toBe("check_failed");
  });

  it("reports unavailable when the engine is not available", async () => {
    checkAsrModel.mockResolvedValue({
      engine: "faster-whisper",
      model: "large-v3",
      available: false,
      downloaded: false,
    });

    const ref = createRef<ModelManagerHandle>();
    render(
      <ModelManager ref={ref} engine="faster-whisper" model="large-v3" auto={false} />,
    );

    await waitFor(() => expect(ref.current).toBeTruthy());
    await expect(ref.current!.checkForTranscribe()).resolves.toBe("unavailable");
  });

  it("downloads via startDownload and resolves completed on success", async () => {
    checkAsrModel.mockResolvedValue({
      engine: "faster-whisper",
      model: "large-v3",
      available: true,
      downloaded: false,
    });
    downloadAsrModel.mockResolvedValue("job-1");
    getModelDownloadProgress
      .mockResolvedValueOnce({
        id: "job-1",
        status: "running",
        progress: 0.1,
        downloadedBytes: 10,
        totalBytes: 100,
        hfEndpoint: null,
        debugLogPath: null,
        error: null,
      })
      .mockResolvedValueOnce({
        id: "job-1",
        status: "completed",
        progress: 1,
        downloadedBytes: 100,
        totalBytes: 100,
        hfEndpoint: null,
        debugLogPath: null,
        error: null,
      });

    const ref = createRef<ModelManagerHandle>();
    render(
      <ModelManager ref={ref} engine="faster-whisper" model="large-v3" auto={false} />,
    );

    await waitFor(() => expect(ref.current).toBeTruthy());
    await expect(ref.current!.startDownload()).resolves.toBe("completed");
    expect(downloadAsrModel).toHaveBeenCalledWith("faster-whisper", "large-v3");
  });

  it("shares an in-flight download so a second startDownload waits for the same job", async () => {
    checkAsrModel.mockResolvedValue({
      engine: "faster-whisper",
      model: "large-v3",
      available: true,
      downloaded: false,
    });
    downloadAsrModel.mockResolvedValue("job-1");
    getModelDownloadProgress
      .mockResolvedValueOnce({
        id: "job-1",
        status: "running",
        progress: 0.1,
        downloadedBytes: 10,
        totalBytes: 100,
        error: null,
      })
      .mockResolvedValueOnce({
        id: "job-1",
        status: "completed",
        progress: 1,
        downloadedBytes: 100,
        totalBytes: 100,
        error: null,
      });

    const onDownloadingChange = vi.fn();
    const ref = createRef<ModelManagerHandle>();
    render(
      <ModelManager
        ref={ref}
        engine="faster-whisper"
        model="large-v3"
        auto={false}
        onDownloadingChange={onDownloadingChange}
      />,
    );

    await waitFor(() => expect(ref.current).toBeTruthy());
    const first = ref.current!.startDownload();
    const second = ref.current!.startDownload();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "completed",
      "completed",
    ]);
    expect(downloadAsrModel).toHaveBeenCalledTimes(1);
    expect(onDownloadingChange).toHaveBeenCalledWith(true);
    expect(onDownloadingChange).toHaveBeenCalledWith(false);
  });
});
