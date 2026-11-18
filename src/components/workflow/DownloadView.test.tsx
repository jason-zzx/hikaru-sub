// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadView } from "./DownloadView";
import {
  checkFfmpeg,
  getVideoDownloadProgress,
  startVideoDownload,
} from "../../services/tauri";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

vi.mock("../../services/tauri", () => ({
  cancelVideoDownload: vi.fn(),
  checkFfmpeg: vi.fn(),
  getVideoDownloadProgress: vi.fn(),
  invalidateFfmpegStatus: vi.fn(),
  pickDirectory: vi.fn(),
  prepareVideoSession: vi.fn(),
  startVideoDownload: vi.fn(),
}));

vi.mock("../../hooks/useRuntimeDependencyPreparation", () => ({
  useRuntimeDependencyPreparation: () => ({
    open: false,
    item: null,
    sourceLabel: "官方源",
    snapshot: null,
    progressPercent: null,
    error: null,
    setOpen: vi.fn(),
    requestDependency: vi.fn(),
    confirmPrepare: vi.fn(),
  }),
}));

describe("DownloadView speed display", () => {
  beforeEach(() => {
    vi.mocked(checkFfmpeg).mockResolvedValue({
      available: true,
      path: "ffmpeg",
      source: "system",
      version: "7.0",
    });
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("renders download speed during active transfer and clears it when null", async () => {
    const user = userEvent.setup();
    vi.mocked(startVideoDownload).mockResolvedValue("dl-1");

    let resolveThirdPoll!: (
      value: Awaited<ReturnType<typeof getVideoDownloadProgress>>,
    ) => void;

    vi.mocked(getVideoDownloadProgress)
      .mockResolvedValueOnce({
        id: "dl-1",
        status: "running",
        phase: "downloading",
        progress: 0.42,
        processedMs: 42_000,
        durationMs: 100_000,
        speedBytesPerSec: Math.round(52.4 * 1024 * 1024),
        outputPath: null,
        error: null,
      })
      .mockResolvedValueOnce({
        id: "dl-1",
        status: "running",
        phase: "merging",
        progress: 0.95,
        processedMs: 95_000,
        durationMs: 100_000,
        speedBytesPerSec: null,
        outputPath: null,
        error: null,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveThirdPoll = resolve;
          }),
      );

    render(<DownloadView />);

    await user.type(screen.getByPlaceholderText("例如 episode-01"), "ep01");
    await user.type(
      screen.getByPlaceholderText("https://example.com/video.m3u8"),
      "https://cdn.example.com/video.m3u8",
    );
    await user.click(screen.getByRole("button", { name: "开始下载" }));

    await waitFor(() => {
      expect(screen.getByText("52.4 MB/s")).toBeTruthy();
      expect(screen.getByText("42%")).toBeTruthy();
    });

    expect(screen.getByText("42%").className).toContain("text-primary");
    expect(screen.queryByText(/回退|兼容模式|并发数|下载策略/)).toBeNull();
    expect(startVideoDownload).toHaveBeenCalledWith(
      expect.not.objectContaining({ strategy: expect.anything() }),
    );

    await waitFor(
      () => {
        expect(screen.getByText("下载完成，正在合并封装…")).toBeTruthy();
        expect(screen.queryByText("52.4 MB/s")).toBeNull();
        expect(screen.getByText("95%")).toBeTruthy();
      },
      { timeout: 2500 },
    );

    await waitFor(() => {
      expect(getVideoDownloadProgress).toHaveBeenCalledTimes(3);
    });

    await act(async () => {
      resolveThirdPoll({
        id: "dl-1",
        status: "completed",
        phase: null,
        progress: 1,
        processedMs: 100_000,
        durationMs: 100_000,
        speedBytesPerSec: null,
        outputPath: "C:\\Downloads\\ep01.mp4",
        error: null,
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("52.4 MB/s")).toBeNull();
      expect(screen.queryByText("下载进度")).toBeNull();
      expect(screen.getByText("下载完成")).toBeTruthy();
      expect(screen.getByText("C:\\Downloads\\ep01.mp4")).toBeTruthy();
    });
  });

  it("renders speed in indeterminate state when duration is not yet known", async () => {
    const user = userEvent.setup();
    vi.mocked(startVideoDownload).mockResolvedValue("dl-2");

    vi.mocked(getVideoDownloadProgress)
      .mockResolvedValueOnce({
        id: "dl-2",
        status: "running",
        progress: null,
        processedMs: 0,
        durationMs: 0,
        speedBytesPerSec: Math.round(12.5 * 1024 * 1024),
        outputPath: null,
        error: null,
      })
      .mockResolvedValueOnce({
        id: "dl-2",
        status: "completed",
        progress: 1,
        processedMs: 5_000,
        durationMs: 5_000,
        speedBytesPerSec: null,
        outputPath: "C:\\Downloads\\ep02.mp4",
        error: null,
      });

    render(<DownloadView />);

    await user.type(screen.getByPlaceholderText("例如 episode-01"), "ep02");
    await user.type(
      screen.getByPlaceholderText("https://example.com/video.m3u8"),
      "https://cdn.example.com/video.m3u8",
    );
    await user.click(screen.getByRole("button", { name: "开始下载" }));

    await waitFor(() => {
      expect(screen.getByText("12.5 MB/s")).toBeTruthy();
    });
  });

  it("replaces loading state with error details when download fails at 0%", async () => {
    const user = userEvent.setup();
    vi.mocked(startVideoDownload).mockResolvedValue("dl-fail");

    vi.mocked(getVideoDownloadProgress).mockResolvedValueOnce({
      id: "dl-fail",
      status: "failed",
      progress: null,
      processedMs: 0,
      durationMs: 0,
      speedBytesPerSec: null,
      outputPath: null,
      error: "获取解密密钥失败：HTTP 403",
    });

    render(<DownloadView />);

    await user.type(screen.getByPlaceholderText("例如 episode-01"), "ep03");
    await user.type(
      screen.getByPlaceholderText("https://example.com/video.m3u8"),
      "https://cdn.example.com/video.m3u8",
    );
    await user.click(screen.getByRole("button", { name: "开始下载" }));

    await waitFor(() => {
      expect(screen.getByText("下载失败")).toBeTruthy();
      expect(screen.getByText("获取解密密钥失败：HTTP 403")).toBeTruthy();
    });

    expect(screen.queryByText(/下载中…/)).toBeNull();
  });

  it("replaces loading state with cancelled status instead of staying in progress", async () => {
    const user = userEvent.setup();
    vi.mocked(startVideoDownload).mockResolvedValue("dl-cancel");

    vi.mocked(getVideoDownloadProgress).mockResolvedValueOnce({
      id: "dl-cancel",
      status: "cancelled",
      progress: null,
      processedMs: 0,
      durationMs: 0,
      speedBytesPerSec: null,
      outputPath: null,
      error: "下载已取消",
    });

    render(<DownloadView />);

    await user.type(screen.getByPlaceholderText("例如 episode-01"), "ep04");
    await user.type(
      screen.getByPlaceholderText("https://example.com/video.m3u8"),
      "https://cdn.example.com/video.m3u8",
    );
    await user.click(screen.getByRole("button", { name: "开始下载" }));

    await waitFor(() => {
      expect(screen.getByText("下载已取消")).toBeTruthy();
      expect(screen.getByText("已取消下载")).toBeTruthy();
    });

    expect(screen.queryByText(/下载中…/)).toBeNull();
  });
});
