// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useClipStore } from "../stores/clipStore";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";
import { makeVideoSession } from "../test-utils/videoSession";

const mocks = vi.hoisted(() => ({
  getVideoClipProgress: vi.fn(),
  prepareVideoSession: vi.fn(),
  withDiscardedSubtitleRecovery: vi.fn(),
}));

vi.mock("../services/tauri", () => ({
  getVideoClipProgress: mocks.getVideoClipProgress,
  prepareVideoSession: mocks.prepareVideoSession,
}));

vi.mock("../services/subtitleRecovery", () => ({
  withDiscardedSubtitleRecovery: mocks.withDiscardedSubtitleRecovery,
}));

const { useClipJobPoller } = await import("./useClipJobPoller");

const OLD_SESSION = makeVideoSession("source");
const NEXT_SESSION = makeVideoSession("clip");

describe("useClipJobPoller", () => {
  beforeEach(() => {
    useClipStore.getState().clearAfterCancel();
    useProjectStore.getState().clearSession();
    useTaskStore.getState().clearTasks();
    mocks.getVideoClipProgress.mockReset();
    mocks.prepareVideoSession.mockReset();
    mocks.withDiscardedSubtitleRecovery.mockReset();
    mocks.withDiscardedSubtitleRecovery.mockImplementation(
      async (_videoPath, replaceDocument) => replaceDocument(),
    );
  });

  it("clears the confirmed recovery target at delayed clip replacement", async () => {
    useProjectStore.getState().setSession(OLD_SESSION);
    useClipStore.getState().startJob("clip-job", {
      useAsWorkingVideo: true,
      discardRecoveryVideoPath: OLD_SESSION.videoPath,
    });
    mocks.getVideoClipProgress.mockResolvedValueOnce({
      jobId: "clip-job",
      status: "completed",
      progress: 1,
      outputPath: NEXT_SESSION.videoPath,
      error: null,
      fellBackToHard: false,
    });
    mocks.prepareVideoSession.mockResolvedValueOnce(NEXT_SESSION);

    const { unmount } = renderHook(() => useClipJobPoller());

    await vi.waitFor(() =>
      expect(mocks.withDiscardedSubtitleRecovery).toHaveBeenCalledWith(
        OLD_SESSION.videoPath,
        expect.any(Function),
      ),
    );
    await vi.waitFor(() =>
      expect(useProjectStore.getState().session?.videoPath).toBe(
        NEXT_SESSION.videoPath,
      ),
    );
    expect(useClipStore.getState().jobId).toBeNull();
    unmount();
  });
});
