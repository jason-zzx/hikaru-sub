// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  onCloseRequested: vi.fn(),
  exitApp: vi.fn(),
  discardSubtitleRecovery: vi.fn(),
  resumeSubtitleRecovery: vi.fn(),
  saveCurrentSubtitleRecovery: vi.fn(),
  getProjectState: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: mocks.onCloseRequested,
  }),
}));

vi.mock("../services/tauri", () => ({
  exitApp: mocks.exitApp,
}));

vi.mock("../services/subtitleRecovery", () => ({
  discardSubtitleRecovery: mocks.discardSubtitleRecovery,
  resumeSubtitleRecovery: mocks.resumeSubtitleRecovery,
  saveCurrentSubtitleRecovery: mocks.saveCurrentSubtitleRecovery,
}));

vi.mock("../stores/projectStore", () => ({
  useProjectStore: {
    getState: mocks.getProjectState,
  },
}));

const { useUnsavedChangesCloseGuard } = await import(
  "./useUnsavedChangesCloseGuard"
);

type CloseHandler = (event: { preventDefault: () => void }) => Promise<void>;
let closeHandler: CloseHandler;

describe("useUnsavedChangesCloseGuard", () => {
  beforeEach(() => {
    closeHandler = async () => undefined;
    mocks.isTauri.mockReturnValue(true);
    mocks.exitApp.mockReset();
    mocks.exitApp.mockResolvedValue(undefined);
    mocks.discardSubtitleRecovery.mockReset();
    mocks.discardSubtitleRecovery.mockResolvedValue(undefined);
    mocks.resumeSubtitleRecovery.mockReset();
    mocks.saveCurrentSubtitleRecovery.mockReset();
    mocks.saveCurrentSubtitleRecovery.mockResolvedValue(true);
    mocks.getProjectState.mockReset();
    mocks.getProjectState.mockReturnValue({
      isDirty: true,
      session: { videoPath: "C:/videos/episode.mp4" },
    });
    mocks.unlisten.mockReset();
    mocks.onCloseRequested.mockReset();
    mocks.onCloseRequested.mockImplementation(async (handler) => {
      closeHandler = handler as CloseHandler;
      return mocks.unlisten;
    });
  });

  it("opens an in-app prompt and exits after confirmation", async () => {
    const { result, unmount } = renderHook(() =>
      useUnsavedChangesCloseGuard(),
    );
    await vi.waitFor(() => expect(mocks.onCloseRequested).toHaveBeenCalled());

    const preventDefault = vi.fn();
    await act(async () => {
      await closeHandler({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(result.current.closePromptOpen).toBe(true);
    expect(mocks.exitApp).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.respondToClosePrompt(true);
    });
    expect(mocks.discardSubtitleRecovery).toHaveBeenCalledWith(
      "C:/videos/episode.mp4",
    );
    expect(mocks.exitApp).toHaveBeenCalledOnce();
    expect(
      mocks.discardSubtitleRecovery.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.exitApp.mock.invocationCallOrder[0]);
    unmount();
  });

  it("keeps the window open when the prompt is cancelled", async () => {
    const { result } = renderHook(() => useUnsavedChangesCloseGuard());
    await vi.waitFor(() => expect(mocks.onCloseRequested).toHaveBeenCalled());

    await act(async () => {
      await closeHandler({ preventDefault: vi.fn() });
    });
    await act(async () => {
      await result.current.respondToClosePrompt(false);
    });

    expect(result.current.closePromptOpen).toBe(false);
    expect(mocks.discardSubtitleRecovery).not.toHaveBeenCalled();
    expect(mocks.exitApp).not.toHaveBeenCalled();
  });

  it("keeps the window open when recovery cleanup fails", async () => {
    mocks.discardSubtitleRecovery.mockRejectedValueOnce(new Error("locked"));
    const { result } = renderHook(() => useUnsavedChangesCloseGuard());
    await vi.waitFor(() => expect(mocks.onCloseRequested).toHaveBeenCalled());

    await act(async () => {
      await closeHandler({ preventDefault: vi.fn() });
      await result.current.respondToClosePrompt(true);
    });

    expect(result.current.closePromptOpen).toBe(true);
    expect(result.current.closePromptError).toContain("清理字幕恢复文件失败");
    expect(mocks.exitApp).not.toHaveBeenCalled();
  });

  it("exits immediately when the document is clean", async () => {
    mocks.getProjectState.mockReturnValue({ isDirty: false, session: null });
    renderHook(() => useUnsavedChangesCloseGuard());
    await vi.waitFor(() => expect(mocks.onCloseRequested).toHaveBeenCalled());

    const preventDefault = vi.fn();
    await act(async () => {
      await closeHandler({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.exitApp).toHaveBeenCalledOnce();
  });

  it("ignores repeated close requests while the prompt is open", async () => {
    const { result } = renderHook(() => useUnsavedChangesCloseGuard());
    await vi.waitFor(() => expect(mocks.onCloseRequested).toHaveBeenCalled());

    const firstPrevent = vi.fn();
    const secondPrevent = vi.fn();
    await act(async () => {
      await closeHandler({ preventDefault: firstPrevent });
      await closeHandler({ preventDefault: secondPrevent });
    });

    expect(result.current.closePromptOpen).toBe(true);
    expect(firstPrevent).toHaveBeenCalledOnce();
    expect(secondPrevent).toHaveBeenCalledOnce();
    expect(mocks.exitApp).not.toHaveBeenCalled();
  });
});
