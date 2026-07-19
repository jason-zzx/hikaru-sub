import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

const { invoke } = await import("@tauri-apps/api/core");
const { loadStyleLibraryText, saveStyleLibraryText } = await import("./tauri");

describe("style library Tauri wrappers", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("invokes load_style_library with no payload", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(loadStyleLibraryText()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith("load_style_library");
  });

  it("invokes save_style_library with content", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await saveStyleLibraryText('{"version":1,"styles":[]}');
    expect(invoke).toHaveBeenCalledWith("save_style_library", {
      content: '{"version":1,"styles":[]}',
    });
  });
});
