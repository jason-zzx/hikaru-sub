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
const { startAsr } = await import("./tauri");

describe("ASR Tauri wrappers", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("returns the structured start result without flattening its notice", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      jobId: "job-auto-fallback",
      notice: "CUDA 启动前检查未通过，已改用 CPU 转录。",
    });
    const args = {
      audioPath: "C:/cache/audio.wav",
      engine: "faster-whisper",
      model: "large-v3",
      device: "auto",
      language: "ja",
      outputAssPath: "C:/media/input.transcribed.ass",
      useVad: false,
      vadConfig: null,
    };

    await expect(startAsr(args)).resolves.toEqual({
      jobId: "job-auto-fallback",
      notice: "CUDA 启动前检查未通过，已改用 CPU 转录。",
    });
    expect(invoke).toHaveBeenCalledWith("start_asr", { args });
  });
});
