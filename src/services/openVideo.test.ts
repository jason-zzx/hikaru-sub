import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultDocument,
  serializeAss,
  type AssDocument,
} from "@/lib/ass";
import { makeVideoSession } from "@/test-utils/videoSession";
import { useProjectStore } from "../stores/projectStore";
import { importExternalSubtitle, openVideoSession } from "./openVideo";

const mocks = vi.hoisted(() => ({
  confirmDiscardUnsavedChanges: vi.fn(),
  prepareVideoSession: vi.fn(),
  pathExists: vi.fn(),
  loadAssText: vi.fn(),
  getVideoInfo: vi.fn(),
  restoreSubtitleRecovery: vi.fn(),
  withDiscardedSubtitleRecovery: vi.fn(),
  recordRecentVideo: vi.fn(),
}));

vi.mock("./tauri", () => ({
  prepareVideoSession: mocks.prepareVideoSession,
  pathExists: mocks.pathExists,
  loadAssText: mocks.loadAssText,
  getVideoInfo: mocks.getVideoInfo,
  transcribedAssPath: (session: { transcribedAssPath: string }) =>
    session.transcribedAssPath,
  translatedAssPath: (session: { translatedAssPath: string }) =>
    session.translatedAssPath,
}));

vi.mock("./unsavedChanges", () => ({
  confirmDiscardUnsavedChanges: mocks.confirmDiscardUnsavedChanges,
}));

vi.mock("./subtitleRecovery", () => ({
  restoreSubtitleRecovery: mocks.restoreSubtitleRecovery,
  withDiscardedSubtitleRecovery: mocks.withDiscardedSubtitleRecovery,
}));

vi.mock("./recentVideos", () => ({
  recordRecentVideo: mocks.recordRecentVideo,
}));

const session = makeVideoSession("open-video");

function documentWithCue(text = "字幕"): AssDocument {
  const doc = createDefaultDocument("test", 1920, 1080);
  doc.cues = [
    {
      id: "cue-1",
      startMs: 0,
      endMs: 1000,
      primaryText: text,
      style: "Default",
      layer: 0,
    },
  ];
  return doc;
}

const ASS_TEXT = serializeAss(documentWithCue(), { preserveOrder: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  useProjectStore.getState().clearSession();
  mocks.confirmDiscardUnsavedChanges.mockResolvedValue({
    proceed: true,
    recoveryVideoPath: null,
  });
  mocks.prepareVideoSession.mockResolvedValue(session);
  mocks.pathExists.mockResolvedValue(false);
  mocks.loadAssText.mockResolvedValue(ASS_TEXT);
  mocks.getVideoInfo.mockResolvedValue({
    width: 1920,
    height: 1080,
    durationMs: 1000,
    fps: 24,
  });
  mocks.restoreSubtitleRecovery.mockResolvedValue("none");
  mocks.withDiscardedSubtitleRecovery.mockImplementation(
    async (_videoPath: string | null, replaceDocument: () => unknown) =>
      replaceDocument(),
  );
});

describe("openVideoSession", () => {
  it("returns cancelled before preparing a session", async () => {
    mocks.confirmDiscardUnsavedChanges.mockResolvedValue({
      proceed: false,
      recoveryVideoPath: null,
    });

    await expect(openVideoSession(session.videoPath)).resolves.toEqual({
      ok: false,
      cancelled: true,
    });
    expect(mocks.prepareVideoSession).not.toHaveBeenCalled();
  });

  it("does not replace a document changed while preparing the video", async () => {
    const pending = deferred<typeof session>();
    mocks.prepareVideoSession.mockReturnValue(pending.promise);

    const opening = openVideoSession(session.videoPath);
    await vi.waitFor(() =>
      expect(mocks.prepareVideoSession).toHaveBeenCalledWith(session.videoPath),
    );
    useProjectStore.getState().setCues(documentWithCue("新的编辑").cues);
    pending.resolve(session);

    await expect(opening).resolves.toEqual({ ok: false, changed: true });
    expect(useProjectStore.getState().session).toBeNull();
    expect(useProjectStore.getState().cues[0].primaryText).toBe("新的编辑");
    expect(mocks.restoreSubtitleRecovery).not.toHaveBeenCalled();
    expect(mocks.recordRecentVideo).not.toHaveBeenCalled();
  });

  it("does not load subtitles into a session replaced by another flow", async () => {
    const pendingAss = deferred<string>();
    const replacement = makeVideoSession("replacement");
    mocks.pathExists.mockResolvedValue(true);
    mocks.loadAssText.mockReturnValue(pendingAss.promise);

    const opening = openVideoSession(session.videoPath);
    await vi.waitFor(() =>
      expect(mocks.loadAssText).toHaveBeenCalledWith(session.translatedAssPath),
    );
    useProjectStore.getState().setSession(replacement);
    pendingAss.resolve(ASS_TEXT);

    await expect(opening).resolves.toEqual({ ok: false, changed: true });
    expect(useProjectStore.getState().session?.videoPath).toBe(
      replacement.videoPath,
    );
    expect(useProjectStore.getState().cues).toEqual([]);
    expect(mocks.restoreSubtitleRecovery).not.toHaveBeenCalled();
    expect(mocks.recordRecentVideo).not.toHaveBeenCalled();
  });

  it("prefers translated subtitles when both files exist", async () => {
    mocks.pathExists.mockResolvedValue(true);

    const result = await openVideoSession(session.videoPath);

    expect(result).toMatchObject({
      ok: true,
      hasSubtitleDocument: true,
      recovery: "none",
    });
    expect(mocks.loadAssText).toHaveBeenCalledTimes(1);
    expect(mocks.loadAssText).toHaveBeenCalledWith(session.translatedAssPath);
    expect(useProjectStore.getState().activeSubtitleKind).toBe("translated");
    expect(mocks.recordRecentVideo).toHaveBeenCalledWith(session);
  });

  it("falls back to transcribed subtitles when translated loading fails", async () => {
    mocks.pathExists.mockResolvedValue(true);
    mocks.loadAssText.mockImplementation(async (path: string) => {
      if (path === session.translatedAssPath) throw new Error("broken ASS");
      return ASS_TEXT;
    });

    const result = await openVideoSession(session.videoPath);

    expect(result).toMatchObject({
      ok: true,
      hasSubtitleDocument: true,
    });
    expect(mocks.loadAssText).toHaveBeenNthCalledWith(
      1,
      session.translatedAssPath,
    );
    expect(mocks.loadAssText).toHaveBeenNthCalledWith(
      2,
      session.transcribedAssPath,
    );
    expect(useProjectStore.getState().activeSubtitleKind).toBe("transcribed");
  });

  it("reports a restored recovery document even without a subtitle kind", async () => {
    mocks.restoreSubtitleRecovery.mockImplementation(async () => {
      useProjectStore.getState().loadAssDocument(documentWithCue("恢复字幕"));
      useProjectStore.getState().markDirty();
      return "restored";
    });

    const result = await openVideoSession(session.videoPath);

    expect(result).toMatchObject({
      ok: true,
      hasSubtitleDocument: true,
      recovery: "restored",
    });
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(useProjectStore.getState().cues[0].primaryText).toBe("恢复字幕");
  });
});

describe("importExternalSubtitle", () => {
  it("applies an SRT document as a dirty translated draft", async () => {
    useProjectStore.getState().setSession(session);
    mocks.loadAssText.mockResolvedValue(
      "1\n00:00:00,000 --> 00:00:01,000\n外部字幕\n",
    );

    const result = await importExternalSubtitle(
      session.videoPath,
      "C:/videos/external.srt",
    );

    expect(result).toEqual({ ok: true });
    const state = useProjectStore.getState();
    expect(state.activeSubtitleKind).toBe("translated");
    expect(state.activeSubtitlePath).toBeNull();
    expect(state.isDirty).toBe(true);
    expect(state.cues[0].primaryText).toBe("外部字幕");
  });
});
