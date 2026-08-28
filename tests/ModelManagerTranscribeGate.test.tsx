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
  downloadAsrModel: (...args: unknown[]) => downloadAsrModel(...args),
  getModelDownloadProgress: (...args: unknown[]) =>
    getModelDownloadProgress(...args),
}));

function availabilityProps() {
  return {
    status: null,
    checking: false,
    checkError: null,
    refreshStatus: async () => {
      try {
        return {
          kind: "ok" as const,
          status: await checkAsrModel("faster-whisper", "large-v3"),
        };
      } catch (error) {
        return { kind: "error" as const, error: String(error) };
      }
    },
  };
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModelManager transcribe gate", () => {
  it.each([
    [{ available: true, downloaded: false }, "needs_download"],
    [{ available: true, downloaded: true }, "ready"],
    [{ available: false, downloaded: false }, "unavailable"],
  ] as const)("maps legacy model status %#", async (compat, expected) => {
    checkAsrModel.mockResolvedValue({
      engine: "faster-whisper",
      model: "large-v3",
      ...compat,
    });
    const ref = createRef<ModelManagerHandle>();
    render(
      <ModelManager
        ref={ref}
        engine="faster-whisper"
        model="large-v3"
        {...availabilityProps()}
      />,
    );

    await waitFor(() => expect(ref.current).toBeTruthy());
    await expect(ref.current!.checkForTranscribe()).resolves.toBe(expected);
  });

  it("reports check_failed when the shared status refresh throws", async () => {
    checkAsrModel.mockRejectedValue(new Error("synthetic runtime failure"));
    const ref = createRef<ModelManagerHandle>();
    render(
      <ModelManager
        ref={ref}
        engine="faster-whisper"
        model="large-v3"
        {...availabilityProps()}
      />,
    );

    await waitFor(() => expect(ref.current).toBeTruthy());
    await expect(ref.current!.checkForTranscribe()).resolves.toBe("check_failed");
  });

  it("reuses one download promise, refreshes status, and resolves completed", async () => {
    checkAsrModel.mockResolvedValue({
      engine: "faster-whisper",
      model: "large-v3",
      available: true,
      downloaded: true,
      disposition: "ready",
    });
    downloadAsrModel.mockResolvedValue("job-1");
    getModelDownloadProgress
      .mockResolvedValueOnce({
        id: "job-1",
        status: "running",
        progress: 0.1,
        downloadedBytes: 10,
        totalBytes: 100,
        hfEndpoint: "https://mirror.example",
        debugLogPath: "logs/model-download.log",
        error: null,
      })
      .mockResolvedValueOnce({
        id: "job-1",
        status: "completed",
        progress: 1,
        downloadedBytes: 100,
        totalBytes: 100,
        hfEndpoint: "https://mirror.example",
        debugLogPath: "logs/model-download.log",
        error: null,
      });

    const onDownloadingChange = vi.fn();
    const ref = createRef<ModelManagerHandle>();
    render(
      <ModelManager
        ref={ref}
        engine="faster-whisper"
        model="large-v3"
        {...availabilityProps()}
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
    expect(checkAsrModel).toHaveBeenCalledTimes(1);
    expect(onDownloadingChange).toHaveBeenCalledWith(true);
    expect(onDownloadingChange).toHaveBeenCalledWith(false);
  });
});
