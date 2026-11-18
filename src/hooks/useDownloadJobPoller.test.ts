// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDownloadStore } from "../stores/downloadStore";
import { useTaskStore } from "../stores/taskStore";

const mocks = vi.hoisted(() => ({
  getVideoDownloadProgress: vi.fn(),
}));

vi.mock("../services/tauri", () => ({
  getVideoDownloadProgress: mocks.getVideoDownloadProgress,
}));

const { useDownloadJobPoller } = await import("./useDownloadJobPoller");

describe("useDownloadJobPoller", () => {
  beforeEach(() => {
    useDownloadStore.getState().resetAll();
    useTaskStore.getState().clearTasks();
    mocks.getVideoDownloadProgress.mockReset();
  });

  afterEach(() => {
    useDownloadStore.getState().resetAll();
    useTaskStore.getState().clearTasks();
  });

  it("updates progress, completedPath, and taskStore until terminal completion", async () => {
    useTaskStore.getState().upsertTask({
      id: "video-download",
      label: "视频下载",
      status: "running",
      progress: 0,
    });
    useDownloadStore.getState().startJob("dl-1");
    mocks.getVideoDownloadProgress.mockResolvedValueOnce({
      id: "dl-1",
      status: "completed",
      phase: null,
      progress: 1,
      processedMs: 10_000,
      durationMs: 10_000,
      speedBytesPerSec: null,
      outputPath: "C:\\Downloads\\ep01.mp4",
      error: null,
    });

    const { unmount } = renderHook(() => useDownloadJobPoller());

    await vi.waitFor(() => {
      expect(useDownloadStore.getState().completedPath).toBe(
        "C:\\Downloads\\ep01.mp4",
      );
    });
    expect(useDownloadStore.getState().jobId).toBeNull();
    expect(useDownloadStore.getState().busy).toBe(false);
    expect(useTaskStore.getState().tasks["video-download"]).toMatchObject({
      status: "success",
      progress: 100,
    });
    unmount();
  });

  it("ignores stale poll response if jobId was cleared or replaced", async () => {
    let resolvePoll!: (
      value: Awaited<ReturnType<typeof mocks.getVideoDownloadProgress>>,
    ) => void;
    mocks.getVideoDownloadProgress.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );

    useDownloadStore.getState().startJob("dl-old");
    const { unmount } = renderHook(() => useDownloadJobPoller());

    await vi.waitFor(() => {
      expect(mocks.getVideoDownloadProgress).toHaveBeenCalledWith("dl-old");
    });

    // 取消清掉 jobId
    useDownloadStore.getState().finishJob();
    resolvePoll({
      id: "dl-old",
      status: "completed",
      phase: null,
      progress: 1,
      processedMs: 5_000,
      durationMs: 5_000,
      speedBytesPerSec: null,
      outputPath: "C:\\Downloads\\stale.mp4",
      error: null,
    });
    await Promise.resolve();

    expect(useDownloadStore.getState().completedPath).toBeNull();
    expect(useDownloadStore.getState().snapshot).toBeNull();
    unmount();
  });

  it("preserves error message and releases busy state on failure", async () => {
    useTaskStore.getState().upsertTask({
      id: "video-download",
      label: "视频下载",
      status: "running",
      progress: 0,
    });
    useDownloadStore.getState().startJob("dl-fail");
    mocks.getVideoDownloadProgress.mockResolvedValueOnce({
      id: "dl-fail",
      status: "failed",
      phase: null,
      progress: null,
      processedMs: 0,
      durationMs: 0,
      speedBytesPerSec: null,
      outputPath: null,
      error: "获取解密密钥失败：HTTP 403",
    });

    const { unmount } = renderHook(() => useDownloadJobPoller());

    await vi.waitFor(() => {
      expect(useDownloadStore.getState().busy).toBe(false);
    });
    expect(useDownloadStore.getState().jobId).toBeNull();
    expect(useDownloadStore.getState().error).toBe("获取解密密钥失败：HTTP 403");
    expect(useDownloadStore.getState().snapshot?.status).toBe("failed");
    expect(useTaskStore.getState().tasks["video-download"]?.status).toBe("error");
    unmount();
  });
});
