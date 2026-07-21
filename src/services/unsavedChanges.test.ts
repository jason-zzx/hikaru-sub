import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../stores/projectStore";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
}));

const { confirm } = await import("@tauri-apps/plugin-dialog");
const { confirmDiscardUnsavedChanges } = await import("./unsavedChanges");

describe("confirmDiscardUnsavedChanges", () => {
  beforeEach(() => {
    useProjectStore.getState().clearSession();
    vi.mocked(confirm).mockReset();
  });

  it("continues without prompting when the document is clean", async () => {
    await expect(confirmDiscardUnsavedChanges()).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("uses the confirmation result when the document is dirty", async () => {
    useProjectStore.getState().markDirty();
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await expect(confirmDiscardUnsavedChanges()).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("尚未保存"),
      expect.objectContaining({ title: "Hikaru Sub", kind: "warning" }),
    );
  });

  it("blocks the destructive action when the dialog fails", async () => {
    useProjectStore.getState().markDirty();
    vi.mocked(confirm).mockRejectedValueOnce(new Error("dialog unavailable"));

    await expect(confirmDiscardUnsavedChanges()).resolves.toBe(false);
  });
});
