// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeVideoSession } from "@/test-utils/videoSession";
import { useProjectStore } from "../../stores/projectStore";
import { useUiStore } from "../../stores/uiStore";
import { pathExists } from "../../services/tauri";
import { openVideoSession } from "../../services/openVideo";
import { listRecentVideos, removeRecentVideo } from "../../services/recentVideos";
import { WelcomeView } from "./WelcomeView";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(),
}));

vi.mock("../../services/tauri", () => ({
  pathExists: vi.fn(),
}));

vi.mock("../../services/openVideo", () => ({
  openVideoSession: vi.fn(),
}));

vi.mock("../../services/recentVideos", () => ({
  listRecentVideos: vi.fn(),
  removeRecentVideo: vi.fn(),
}));

const entry = (stem: string, lastOpenedAt = Date.now()) => ({
  videoPath: `C:/videos/${stem}.mp4`,
  transcribedAssPath: `C:/videos/${stem}.transcribed.ass`,
  translatedAssPath: `C:/videos/${stem}.translated.ass`,
  lastOpenedAt,
});

beforeEach(() => {
  useUiStore.setState({ currentStep: "welcome" });
  useProjectStore.setState({
    session: null,
    videoPath: null,
    activeSubtitleKind: null,
    activeSubtitlePath: null,
    cues: [],
    isDirty: false,
  });
  vi.mocked(listRecentVideos).mockReturnValue([]);
  vi.mocked(pathExists).mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WelcomeView", () => {
  it("renders the four entry cards", () => {
    render(<WelcomeView />);
    for (const title of ["导入视频", "ASR 转录", "AI 翻译", "校对编辑"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.queryByText("最近打开")).toBeNull();
    expect(screen.queryByText("继续当前工作")).toBeNull();
  });

  it("lists recent videos with existence badges and opens on click", async () => {
    const user = userEvent.setup();
    vi.mocked(listRecentVideos).mockReturnValue([entry("ep01"), entry("ep02")]);
    vi.mocked(pathExists).mockImplementation(async (p: string) => {
      if (p.includes("ep01.translated")) return true;
      if (p.includes("ep02.transcribed")) return true;
      return p.endsWith(".mp4");
    });
    vi.mocked(openVideoSession).mockResolvedValue({
      ok: true,
      hasSubtitleDocument: true,
      recovery: "none",
    });

    render(<WelcomeView />);

    expect(await screen.findByText("ep01.mp4")).toBeTruthy();
    expect(screen.getByText("ep02.mp4")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("已翻译")).toBeTruthy();
      expect(screen.getByText("已转录")).toBeTruthy();
    });

    await user.click(screen.getByText("ep01.mp4"));
    expect(openVideoSession).toHaveBeenCalledWith("C:/videos/ep01.mp4");
    expect(useUiStore.getState().currentStep).toBe("editor");
  });

  it("navigates to transcribe when no subtitle was loaded", async () => {
    const user = userEvent.setup();
    vi.mocked(listRecentVideos).mockReturnValue([entry("ep03")]);
    vi.mocked(pathExists).mockResolvedValue(true);
    vi.mocked(openVideoSession).mockResolvedValue({
      ok: true,
      hasSubtitleDocument: false,
      recovery: "none",
    });

    render(<WelcomeView />);
    await user.click(await screen.findByText("ep03.mp4"));
    expect(useUiStore.getState().currentStep).toBe("transcribe");
  });

  it("does not offer editor actions for a session without subtitles", async () => {
    const session = makeVideoSession("untranscribed");
    useProjectStore.setState({
      session,
      videoPath: session.videoPath,
      activeSubtitleKind: null,
      cues: [],
    });
    vi.mocked(pathExists).mockResolvedValue(false);

    render(<WelcomeView />);

    expect(await screen.findByText("继续当前工作")).toBeTruthy();
    expect(screen.queryByText("继续编辑")).toBeNull();
    expect(screen.queryByText("继续翻译")).toBeNull();
    expect(screen.queryByText("开始压制")).toBeNull();
    expect(screen.getByText("开始转录")).toBeTruthy();
  });

  it("loads a file-only current session before entering the editor", async () => {
    const user = userEvent.setup();
    const session = makeVideoSession("file-only");
    useProjectStore.setState({
      session,
      videoPath: session.videoPath,
      activeSubtitleKind: null,
      isDirty: false,
    });
    vi.mocked(pathExists).mockImplementation(async (path: string) =>
      path === session.transcribedAssPath,
    );
    vi.mocked(openVideoSession).mockResolvedValue({
      ok: true,
      hasSubtitleDocument: true,
      recovery: "none",
    });

    render(<WelcomeView />);
    await user.click(await screen.findByText("继续编辑"));

    expect(openVideoSession).toHaveBeenCalledWith(session.videoPath);
    expect(useUiStore.getState().currentStep).toBe("editor");
  });

  it("continues a dirty recovered document without reopening the video", async () => {
    const user = userEvent.setup();
    const session = makeVideoSession("dirty-recovery");
    useProjectStore.setState({
      session,
      videoPath: session.videoPath,
      activeSubtitleKind: null,
      isDirty: true,
    });
    vi.mocked(pathExists).mockResolvedValue(false);

    render(<WelcomeView />);
    await user.click(await screen.findByText("继续编辑"));

    expect(openVideoSession).not.toHaveBeenCalled();
    expect(useUiStore.getState().currentStep).toBe("editor");
  });

  it("keeps recent row hover inside the rounded list and across the delete area", async () => {
    vi.mocked(listRecentVideos).mockReturnValue([entry("ep01")]);
    render(<WelcomeView />);

    const list = await screen.findByRole("list");
    const row = list.querySelector("li");
    const fileButton = screen.getByRole("button", { name: /ep01\.mp4/ });
    const removeButton = screen.getByRole("button", {
      name: "从最近列表移除",
    });

    expect(list.className).toContain("overflow-hidden");
    expect(row?.className).toContain("hover:bg-surface-overlay");
    expect(fileButton.className).not.toContain("hover:bg-surface-overlay");
    expect(removeButton.parentElement).toBe(row);
    expect(screen.queryByText("转录")).toBeNull();
    expect(screen.queryByText("译文")).toBeNull();
  });

  it("shows the parent path as secondary truncated text", async () => {
    const recent = entry("ep01");
    vi.mocked(listRecentVideos).mockReturnValue([recent]);

    render(<WelcomeView />);

    const path = await screen.findByText("C:/videos");
    expect(path.className).toContain("text-xs");
    expect(path.className).toContain("text-text-muted");
    expect(path.className).toContain("truncate");
    expect(path.getAttribute("title")).toBe(recent.videoPath);
  });

  it("shows error dialog and stays on welcome when open fails", async () => {
    const user = userEvent.setup();
    const { message } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(listRecentVideos).mockReturnValue([entry("gone")]);
    vi.mocked(pathExists).mockResolvedValue(false);
    vi.mocked(openVideoSession).mockResolvedValue({
      ok: false,
      error: "打开视频失败：视频文件不存在",
    });

    render(<WelcomeView />);
    expect(await screen.findByText("文件不存在")).toBeTruthy();
    await user.click(screen.getByText("gone.mp4"));
    expect(message).toHaveBeenCalledWith(
      "打开视频失败：视频文件不存在",
      expect.objectContaining({ kind: "error" }),
    );
    expect(useUiStore.getState().currentStep).toBe("welcome");
  });

  it("removes an entry from the recent list", async () => {
    const user = userEvent.setup();
    vi.mocked(listRecentVideos).mockReturnValue([entry("ep01"), entry("ep02")]);

    render(<WelcomeView />);
    await screen.findByText("ep01.mp4");
    const removeButtons = screen.getAllByLabelText("从最近列表移除");
    await user.click(removeButtons[0]);

    expect(removeRecentVideo).toHaveBeenCalledWith("C:/videos/ep01.mp4");
    expect(screen.queryByText("ep01.mp4")).toBeNull();
    expect(screen.getByText("ep02.mp4")).toBeTruthy();
  });

  it("shows resume card gated by subtitle existence and hides current video from recent list", async () => {
    const user = userEvent.setup();
    const session = makeVideoSession("current");
    useProjectStore.setState({
      session,
      videoPath: session.videoPath,
    });
    vi.mocked(listRecentVideos).mockReturnValue([
      entry("current"),
      entry("older"),
    ]);
    vi.mocked(pathExists).mockImplementation(async (p: string) =>
      p === session.transcribedAssPath ? true : p.endsWith(".mp4"),
    );

    render(<WelcomeView />);

    expect(await screen.findByText("继续当前工作")).toBeTruthy();
    expect(screen.getByText("current.mp4")).toBeTruthy();
    expect(screen.getByText("继续编辑")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("继续翻译")).toBeTruthy());
    expect(screen.queryByText("开始压制")).toBeNull();

    // 最近列表中不重复显示当前视频（getByText 遇多个匹配会抛错）
    expect(screen.getByText("older.mp4")).toBeTruthy();

    await user.click(screen.getByText("继续翻译"));
    expect(useUiStore.getState().currentStep).toBe("translate");
  });
});
