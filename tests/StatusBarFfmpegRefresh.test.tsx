// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusBar } from "../src/components/layout/StatusBar";
import { checkFfmpeg } from "../src/services/tauri";

const projectState = { isDirty: false };

vi.mock("../src/stores/projectStore", () => ({
  useProjectStore: (selector: (state: { isDirty: boolean }) => unknown) =>
    selector(projectState),
}));

vi.mock("../src/stores/taskStore", () => ({
  useTaskStore: (selector: (state: { tasks: Record<string, never> }) => unknown) =>
    selector({ tasks: {} }),
}));

vi.mock("../src/services/tauri", () => ({
  FFMPEG_STATUS_INVALIDATED_EVENT: "hikaru-sub:ffmpeg-status-invalidated",
  checkFfmpeg: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StatusBar FFmpeg refresh", () => {
  beforeEach(() => {
    projectState.isDirty = false;
    vi.mocked(checkFfmpeg).mockReset();
  });

  it("refreshes FFmpeg state when the cached status is invalidated", async () => {
    vi.mocked(checkFfmpeg)
      .mockResolvedValueOnce({
        available: false,
        path: "ffmpeg",
        source: "system",
      })
      .mockResolvedValueOnce({
        available: true,
        path: "C:/hikaru-sub/deps/ffmpeg/current/ffmpeg.exe",
        source: "managed",
      });

    render(<StatusBar />);

    await waitFor(() => {
      expect(screen.getByText(/FFmpeg:/).textContent).toContain("未找到");
    });

    window.dispatchEvent(new Event("hikaru-sub:ffmpeg-status-invalidated"));

    await waitFor(() => {
      expect(screen.getByText(/FFmpeg:/).textContent).toContain("就绪");
    });
    expect(checkFfmpeg).toHaveBeenCalledTimes(2);
    expect(checkFfmpeg).toHaveBeenLastCalledWith({ force: false });
  });

  it("does not render a global unsaved subtitle tag", async () => {
    projectState.isDirty = true;
    vi.mocked(checkFfmpeg).mockResolvedValue({
      available: true,
      path: "ffmpeg",
      source: "system",
    });

    render(<StatusBar />);

    await waitFor(() => {
      expect(screen.getByText(/FFmpeg:/).textContent).toContain("就绪");
    });
    expect(screen.queryByText("未保存")).toBeNull();
  });
});
