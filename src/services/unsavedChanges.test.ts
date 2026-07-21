import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../stores/projectStore";
import { makeVideoSession } from "../test-utils/videoSession";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
}));

const { confirm } = await import("@tauri-apps/plugin-dialog");
const { confirmDiscardUnsavedChanges } = await import("./unsavedChanges");

const SESSION = makeVideoSession();

describe("confirmDiscardUnsavedChanges", () => {
  beforeEach(() => {
    useProjectStore.getState().clearSession();
    vi.mocked(confirm).mockReset();
  });

  it("continues without prompting when the document is clean", async () => {
    await expect(confirmDiscardUnsavedChanges()).resolves.toEqual({
      proceed: true,
      recoveryVideoPath: null,
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("returns the discarded video's recovery target after confirmation", async () => {
    useProjectStore.getState().setSession(SESSION);
    useProjectStore.getState().markDirty();
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await expect(confirmDiscardUnsavedChanges()).resolves.toEqual({
      proceed: true,
      recoveryVideoPath: SESSION.videoPath,
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("尚未保存"),
      expect.objectContaining({ title: "Hikaru Sub", kind: "warning" }),
    );
  });

  it("blocks the destructive action when the dialog is cancelled", async () => {
    useProjectStore.getState().setSession(SESSION);
    useProjectStore.getState().markDirty();
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await expect(confirmDiscardUnsavedChanges()).resolves.toEqual({
      proceed: false,
      recoveryVideoPath: null,
    });
  });

  it("blocks the destructive action when the dialog fails", async () => {
    useProjectStore.getState().markDirty();
    vi.mocked(confirm).mockRejectedValueOnce(new Error("dialog unavailable"));

    await expect(confirmDiscardUnsavedChanges()).resolves.toEqual({
      proceed: false,
      recoveryVideoPath: null,
    });
  });
});
