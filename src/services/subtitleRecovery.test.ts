import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../stores/projectStore";
import type { VideoSession } from "../types";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
}));

vi.mock("./tauri", () => ({
  saveSubtitleRecovery: vi.fn(),
  loadSubtitleRecovery: vi.fn(),
  deleteSubtitleRecovery: vi.fn(),
}));

const { confirm } = await import("@tauri-apps/plugin-dialog");
const {
  deleteSubtitleRecovery,
  loadSubtitleRecovery,
  saveSubtitleRecovery,
} = await import("./tauri");
const {
  clearSubtitleRecoveryIfClean,
  discardSubtitleRecovery,
  parseSubtitleRecovery,
  restoreSubtitleRecovery,
  resumeSubtitleRecovery,
  saveCurrentSubtitleRecovery,
  serializeSubtitleRecovery,
} = await import("./subtitleRecovery");

const SESSION: VideoSession = {
  videoPath: "C:/videos/episode.mp4",
  workspacePath: "C:/cache/workspace/episode",
  audioPath: "C:/cache/workspace/episode/audio.wav",
  transcribedAssPath: "C:/videos/episode.transcribed.ass",
  translatedAssPath: "C:/videos/episode.translated.ass",
  burnAssPath: "C:/cache/workspace/episode/burn.input.ass",
  sourceLang: "ja",
};

const SNAPSHOT = {
  version: 1 as const,
  videoPath: SESSION.videoPath,
  activeSubtitleKind: "translated" as const,
  activeSubtitlePath: SESSION.translatedAssPath,
  assText: "[Script Info]\n\n[Events]\n",
};

describe("subtitle recovery format", () => {
  beforeEach(() => {
    resumeSubtitleRecovery(SESSION.videoPath);
    useProjectStore.getState().clearSession();
    vi.mocked(confirm).mockReset();
    vi.mocked(saveSubtitleRecovery).mockReset();
    vi.mocked(loadSubtitleRecovery).mockReset();
    vi.mocked(deleteSubtitleRecovery).mockReset();
    vi.mocked(saveSubtitleRecovery).mockResolvedValue(undefined);
    vi.mocked(loadSubtitleRecovery).mockResolvedValue(null);
    vi.mocked(deleteSubtitleRecovery).mockResolvedValue(false);
  });

  it("round-trips the ASS document and active subtitle target", () => {
    const content = serializeSubtitleRecovery(SNAPSHOT);
    expect(parseSubtitleRecovery(content, SNAPSHOT.videoPath)).toEqual(SNAPSHOT);
  });

  it("rejects recovery content for another video or version", () => {
    const content = serializeSubtitleRecovery(SNAPSHOT);
    expect(parseSubtitleRecovery(content, "C:/videos/other.mp4")).toBeNull();
    expect(
      parseSubtitleRecovery(
        content.replace('"version":1', '"version":2'),
        SNAPSHOT.videoPath,
      ),
    ).toBeNull();
  });

  it("rejects malformed JSON", () => {
    expect(parseSubtitleRecovery("not json", SNAPSHOT.videoPath)).toBeNull();
  });

  it("writes a dirty ASS document and skips a clean document", async () => {
    useProjectStore.getState().setSession(SESSION);
    await expect(saveCurrentSubtitleRecovery()).resolves.toBe(false);

    useProjectStore.getState().markDirty();
    await expect(saveCurrentSubtitleRecovery()).resolves.toBe(true);
    expect(saveSubtitleRecovery).toHaveBeenCalledTimes(1);
    const [videoPath, content] = vi.mocked(saveSubtitleRecovery).mock.calls[0];
    expect(videoPath).toBe(SESSION.videoPath);
    expect(parseSubtitleRecovery(content, SESSION.videoPath)?.assText).toContain(
      "[Events]",
    );
  });

  it("deletes and suppresses recovery after intentional discard", async () => {
    useProjectStore.getState().setSession(SESSION);
    useProjectStore.getState().markDirty();

    await discardSubtitleRecovery(SESSION.videoPath);
    expect(deleteSubtitleRecovery).toHaveBeenCalledWith(SESSION.videoPath);
    await expect(saveCurrentSubtitleRecovery()).resolves.toBe(false);
    expect(saveSubtitleRecovery).not.toHaveBeenCalled();

    resumeSubtitleRecovery(SESSION.videoPath);
    await expect(saveCurrentSubtitleRecovery()).resolves.toBe(true);
  });

  it("rechecks dirty state when a queued autosave actually runs", async () => {
    useProjectStore.getState().setSession(SESSION);
    useProjectStore.getState().markDirty();

    const pending = saveCurrentSubtitleRecovery();
    const snapshot = useProjectStore.getState().captureSaveSnapshot();
    useProjectStore.getState().markSaved(snapshot.token);

    await expect(pending).resolves.toBe(false);
    expect(saveSubtitleRecovery).not.toHaveBeenCalled();
  });

  it("clears recovery only when the matching document is clean", async () => {
    useProjectStore.getState().setSession(SESSION);
    useProjectStore.getState().markDirty();
    await expect(clearSubtitleRecoveryIfClean(SESSION.videoPath)).resolves.toBe(
      false,
    );

    const snapshot = useProjectStore.getState().captureSaveSnapshot();
    useProjectStore.getState().markSaved(snapshot.token);
    await expect(clearSubtitleRecoveryIfClean(SESSION.videoPath)).resolves.toBe(
      true,
    );
    expect(deleteSubtitleRecovery).toHaveBeenCalledWith(SESSION.videoPath);
  });

  it("rewrites recovery when an edit lands during cleanup", async () => {
    useProjectStore.getState().setSession(SESSION);
    let finishDelete!: (deleted: boolean) => void;
    vi.mocked(deleteSubtitleRecovery).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishDelete = resolve;
        }),
    );

    const clearing = clearSubtitleRecoveryIfClean(SESSION.videoPath);
    await vi.waitFor(() => expect(deleteSubtitleRecovery).toHaveBeenCalled());
    useProjectStore.getState().markDirty();
    finishDelete(true);

    await expect(clearing).resolves.toBe(false);
    expect(saveSubtitleRecovery).toHaveBeenCalledWith(
      SESSION.videoPath,
      expect.any(String),
    );
  });

  it("restores the ASS document as dirty and preserves its save target", async () => {
    useProjectStore.getState().setSession(SESSION);
    vi.mocked(loadSubtitleRecovery).mockResolvedValueOnce(
      serializeSubtitleRecovery(SNAPSHOT),
    );
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await expect(restoreSubtitleRecovery(SESSION)).resolves.toBe("restored");
    const state = useProjectStore.getState();
    expect(state.isDirty).toBe(true);
    expect(state.activeSubtitleKind).toBe("translated");
    expect(state.activeSubtitlePath).toBe(SESSION.translatedAssPath);
  });

  it("does not trust an arbitrary save target from recovery content", async () => {
    useProjectStore.getState().setSession(SESSION);
    vi.mocked(loadSubtitleRecovery).mockResolvedValueOnce(
      serializeSubtitleRecovery({
        ...SNAPSHOT,
        activeSubtitlePath: "C:/untrusted/overwrite.ass",
      }),
    );
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await expect(restoreSubtitleRecovery(SESSION)).resolves.toBe("restored");
    expect(useProjectStore.getState().activeSubtitlePath).toBeNull();
  });
});
