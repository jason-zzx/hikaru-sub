import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const { invoke } = await import("@tauri-apps/api/core");
const {
  checkFfmpeg,
  invalidateFfmpegStatus,
  probeAsrSetupEnvironment,
  startAsrSetup,
  getAsrSetupProgress,
  cancelAsrSetup,
} = await import("./tauri");

describe("ASR setup Tauri wrappers", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    invalidateFfmpegStatus();
  });

  it("caches FFmpeg detection until explicitly invalidated", async () => {
    vi.mocked(invoke).mockResolvedValue({
      available: true,
      path: "ffmpeg",
      source: "system",
      version: "ffmpeg version test",
    });

    const first = await checkFfmpeg();
    const second = await checkFfmpeg();

    expect(first).toBe(second);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenLastCalledWith("check_ffmpeg");

    invalidateFfmpegStatus();
    await checkFfmpeg();

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("calls the expected command names", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      managedServicePath: "managed",
      pythonOk: true,
      venvPath: "managed/.venv",
      venvExists: false,
      hasNvidiaGpu: false,
    });
    await probeAsrSetupEnvironment();
    expect(invoke).toHaveBeenLastCalledWith("probe_asr_setup_environment", {
      args: {},
    });

    vi.mocked(invoke).mockResolvedValueOnce({
      managedServicePath: "managed",
      pythonOk: true,
      venvPath: "managed/.venv",
      venvExists: false,
      hasNvidiaGpu: false,
    });
    await probeAsrSetupEnvironment({
      pythonPath: "C:/Python/python.exe",
      asrServicePath: "C:/custom/asr-service",
    });
    expect(invoke).toHaveBeenLastCalledWith("probe_asr_setup_environment", {
      args: {
        pythonPath: "C:/Python/python.exe",
        asrServicePath: "C:/custom/asr-service",
      },
    });

    vi.mocked(invoke).mockResolvedValueOnce("job-1");
    await startAsrSetup({ profile: "default", recreate: true });
    expect(invoke).toHaveBeenLastCalledWith("start_asr_setup", {
      args: { profile: "default", recreate: true },
    });

    vi.mocked(invoke).mockResolvedValueOnce({
      id: "job-1",
      status: "running",
      profile: "default",
      stage: "安装依赖",
      progress: 0.5,
      logTail: [],
      error: null,
    });
    await getAsrSetupProgress("job-1");
    expect(invoke).toHaveBeenLastCalledWith("get_asr_setup_progress", {
      jobId: "job-1",
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await cancelAsrSetup("job-1");
    expect(invoke).toHaveBeenLastCalledWith("cancel_asr_setup", {
      jobId: "job-1",
    });
  });
});
