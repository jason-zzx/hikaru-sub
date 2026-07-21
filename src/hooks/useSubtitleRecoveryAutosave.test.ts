// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultDocument } from "@/lib/ass";
import { useProjectStore } from "../stores/projectStore";
import { makeVideoSession } from "../test-utils/videoSession";

const mocks = vi.hoisted(() => ({
  clearSubtitleRecoveryIfClean: vi.fn(),
  saveCurrentSubtitleRecovery: vi.fn(),
}));

vi.mock("../services/subtitleRecovery", () => ({
  clearSubtitleRecoveryIfClean: mocks.clearSubtitleRecoveryIfClean,
  saveCurrentSubtitleRecovery: mocks.saveCurrentSubtitleRecovery,
}));

const { useSubtitleRecoveryAutosave } = await import(
  "./useSubtitleRecoveryAutosave"
);

const SESSION = makeVideoSession();

function loadCleanDocument() {
  const doc = createDefaultDocument("test");
  doc.cues = [
    {
      id: "cue-1",
      startMs: 0,
      endMs: 1000,
      primaryText: "original",
      style: "Primary",
      layer: 0,
    },
  ];
  useProjectStore.getState().setSession(SESSION);
  useProjectStore.getState().loadAssDocument(doc);
}

describe("useSubtitleRecoveryAutosave", () => {
  beforeEach(() => {
    useProjectStore.getState().clearSession();
    mocks.clearSubtitleRecoveryIfClean.mockReset();
    mocks.clearSubtitleRecoveryIfClean.mockResolvedValue(true);
    mocks.saveCurrentSubtitleRecovery.mockReset();
    mocks.saveCurrentSubtitleRecovery.mockResolvedValue(true);
  });

  it("clears stale recovery when undo returns a dirty document to clean", async () => {
    const { unmount } = renderHook(() => useSubtitleRecoveryAutosave());

    act(() => loadCleanDocument());
    expect(mocks.clearSubtitleRecoveryIfClean).not.toHaveBeenCalled();

    act(() => {
      useProjectStore
        .getState()
        .updateCue("cue-1", { primaryText: "unsaved edit" });
    });
    expect(useProjectStore.getState().isDirty).toBe(true);

    act(() => useProjectStore.getState().undo());
    expect(useProjectStore.getState().isDirty).toBe(false);

    await vi.waitFor(() =>
      expect(mocks.clearSubtitleRecoveryIfClean).toHaveBeenCalledWith(
        SESSION.videoPath,
      ),
    );
    unmount();
  });
});
