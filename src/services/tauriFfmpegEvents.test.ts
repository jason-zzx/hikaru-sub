// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const { invalidateFfmpegStatus } = await import("./tauri");

describe("FFmpeg status invalidation events", () => {
  it("notifies UI listeners when FFmpeg status cache is invalidated", () => {
    const listener = vi.fn();
    window.addEventListener("hikaru-sub:ffmpeg-status-invalidated", listener);

    invalidateFfmpegStatus();

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("hikaru-sub:ffmpeg-status-invalidated", listener);
  });
});
