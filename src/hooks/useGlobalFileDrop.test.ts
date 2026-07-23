// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeVideoSession } from "@/test-utils/videoSession";
import { useProjectStore } from "../stores/projectStore";
import { useUiStore } from "../stores/uiStore";
import {
  classifyDroppedPath,
  useGlobalFileDrop,
} from "./useGlobalFileDrop";

const mocks = vi.hoisted(() => ({
  onDragDropEvent: vi.fn(),
  message: vi.fn(),
  openVideoSession: vi.fn(),
  importExternalSubtitle: vi.fn(),
  selectCueAndSeek: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onDragDropEvent: mocks.onDragDropEvent }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: mocks.message,
}));

vi.mock("../services/tauri", () => ({
  VIDEO_EXTENSIONS: ["mp4", "mkv", "mov", "avi", "webm", "flv", "ts", "m4v"],
  SUBTITLE_EXTENSIONS: ["ass", "srt"],
}));

vi.mock("../services/openVideo", () => ({
  openVideoSession: mocks.openVideoSession,
  importExternalSubtitle: mocks.importExternalSubtitle,
}));

vi.mock("../services/editorActions", () => ({
  selectCueAndSeek: mocks.selectCueAndSeek,
}));

type DragDropListener = (event: {
  payload:
    | { type: "drop"; paths: string[]; position: { x: number; y: number } }
    | { type: "enter" | "over" | "leave"; position: { x: number; y: number } };
}) => Promise<void>;

const dropEvent = (paths: string[]) => ({
  payload: { type: "drop" as const, paths, position: { x: 0, y: 0 } },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  useProjectStore.getState().clearSession();
  useUiStore.setState({ currentStep: "welcome" });
  mocks.onDragDropEvent.mockResolvedValue(vi.fn());
});

afterEach(() => cleanup());

describe("classifyDroppedPath", () => {
  it("classifies video and subtitle extensions case-insensitively", () => {
    expect(classifyDroppedPath("C:/v/ep01.MKV")).toBe("video");
    expect(classifyDroppedPath("/v/ep01.webm")).toBe("video");
    expect(classifyDroppedPath("C:/sub/ep01.ass")).toBe("subtitle");
    expect(classifyDroppedPath("C:/sub/ep01.SRT")).toBe("subtitle");
  });

  it("returns null for unsupported files", () => {
    expect(classifyDroppedPath("C:/docs/readme.txt")).toBeNull();
    expect(classifyDroppedPath("C:/no-extension")).toBeNull();
  });
});

describe("useGlobalFileDrop", () => {
  it("cleans up each registration across StrictMode-style remounts", async () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    mocks.onDragDropEvent
      .mockResolvedValueOnce(firstStop)
      .mockResolvedValueOnce(secondStop);

    const firstMount = renderHook(() => useGlobalFileDrop());
    await waitFor(() => expect(mocks.onDragDropEvent).toHaveBeenCalledTimes(1));
    firstMount.unmount();
    expect(firstStop).toHaveBeenCalledTimes(1);

    const secondMount = renderHook(() => useGlobalFileDrop());
    await waitFor(() => expect(mocks.onDragDropEvent).toHaveBeenCalledTimes(2));
    secondMount.unmount();
    expect(secondStop).toHaveBeenCalledTimes(1);
  });

  it("ignores stale callbacks and unlistens when registration resolves after unmount", async () => {
    const pending = deferred<() => void>();
    const stop = vi.fn();
    let listener: DragDropListener | undefined;
    mocks.onDragDropEvent.mockImplementation((callback: DragDropListener) => {
      listener = callback;
      return pending.promise;
    });

    const { unmount } = renderHook(() => useGlobalFileDrop());
    await waitFor(() => expect(listener).toBeDefined());
    unmount();
    await act(async () => {
      await listener?.(dropEvent(["C:/videos/stale.mp4"]));
    });
    pending.resolve(stop);

    expect(mocks.openVideoSession).not.toHaveBeenCalled();
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });

  it("handles registration rejection without an unhandled promise", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.onDragDropEvent.mockRejectedValue(new Error("listen failed"));

    renderHook(() => useGlobalFileDrop());

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "注册全局文件拖放失败:",
        expect.any(Error),
      ),
    );
    warn.mockRestore();
  });

  it("routes a video with restored subtitles to the editor", async () => {
    let listener: DragDropListener | undefined;
    mocks.onDragDropEvent.mockImplementation(async (callback: DragDropListener) => {
      listener = callback;
      return vi.fn();
    });
    mocks.openVideoSession.mockResolvedValue({
      ok: true,
      hasSubtitleDocument: true,
      recovery: "restored",
    });
    renderHook(() => useGlobalFileDrop());
    await waitFor(() => expect(listener).toBeDefined());

    await act(async () => {
      await listener?.(dropEvent(["C:/videos/restored.mp4"]));
    });

    expect(mocks.openVideoSession).toHaveBeenCalledWith(
      "C:/videos/restored.mp4",
    );
    expect(useUiStore.getState().currentStep).toBe("editor");
  });

  it("selects the first imported cue after a subtitle drop", async () => {
    let listener: DragDropListener | undefined;
    const session = makeVideoSession("subtitle-drop");
    const firstCue = {
      id: "cue-1",
      startMs: 0,
      endMs: 1000,
      primaryText: "字幕",
      style: "Default",
      layer: 0,
    };
    useProjectStore.getState().setSession(session);
    mocks.onDragDropEvent.mockImplementation(async (callback: DragDropListener) => {
      listener = callback;
      return vi.fn();
    });
    mocks.importExternalSubtitle.mockImplementation(async () => {
      useProjectStore.setState({ cues: [firstCue] });
      return { ok: true };
    });
    renderHook(() => useGlobalFileDrop());
    await waitFor(() => expect(listener).toBeDefined());

    await act(async () => {
      await listener?.(dropEvent(["C:/videos/subtitles.srt"]));
    });

    expect(mocks.importExternalSubtitle).toHaveBeenCalledWith(
      session.videoPath,
      "C:/videos/subtitles.srt",
    );
    expect(mocks.selectCueAndSeek).toHaveBeenCalledWith(firstCue);
    expect(useUiStore.getState().currentStep).toBe("editor");
  });

  it("prompts for a video before importing a subtitle", async () => {
    let listener: DragDropListener | undefined;
    mocks.onDragDropEvent.mockImplementation(async (callback: DragDropListener) => {
      listener = callback;
      return vi.fn();
    });
    renderHook(() => useGlobalFileDrop());
    await waitFor(() => expect(listener).toBeDefined());

    await act(async () => {
      await listener?.(dropEvent(["C:/videos/subtitles.ass"]));
    });

    expect(mocks.importExternalSubtitle).not.toHaveBeenCalled();
    expect(mocks.message).toHaveBeenCalledWith(
      "请先导入视频，再拖入字幕文件",
      expect.objectContaining({ kind: "info" }),
    );
  });
});
