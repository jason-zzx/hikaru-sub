import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
const { invoke } = await import("@tauri-apps/api/core");
const { checkFfmpeg, invalidateFfmpegStatus } = await import("./tauri");

describe("FFmpeg status wrapper", () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); invalidateFfmpegStatus(); });
  it("keeps the unrelated status cache after ASR setup wrappers are removed", async () => {
    vi.mocked(invoke).mockResolvedValue({ available: true, path: "ffmpeg", source: "system" });
    expect(await checkFfmpeg()).toBe(await checkFfmpeg());
    expect(invoke).toHaveBeenCalledTimes(1);
    invalidateFfmpegStatus();
    await checkFfmpeg();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
