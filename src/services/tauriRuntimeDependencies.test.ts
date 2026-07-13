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
const {
  cancelRuntimeDependency,
  cleanupRuntimeDependency,
  getRuntimeDependencyProgress,
  measureRuntimeDependencyStorage,
  prepareRuntimeDependency,
  probeRuntimeDependencies,
} = await import("./tauri");

describe("runtime dependency Tauri wrappers", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("probes runtime dependencies", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      items: [],
      sourceMode: "official",
    });

    await probeRuntimeDependencies();

    expect(invoke).toHaveBeenCalledWith("probe_runtime_dependencies");
  });

  it("starts dependency preparation", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("job-1");

    await prepareRuntimeDependency({ kind: "ffmpeg" });

    expect(invoke).toHaveBeenCalledWith("prepare_runtime_dependency", {
      args: { kind: "ffmpeg" },
    });
  });

  it("polls and cancels dependency preparation", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: "job-1" });

    await getRuntimeDependencyProgress("job-1");
    expect(invoke).toHaveBeenCalledWith("get_runtime_dependency_progress", {
      jobId: "job-1",
    });

    await cancelRuntimeDependency("job-1");
    expect(invoke).toHaveBeenCalledWith("cancel_runtime_dependency", {
      jobId: "job-1",
    });
  });

  it("cleans a managed dependency kind", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await cleanupRuntimeDependency("downloads");

    expect(invoke).toHaveBeenCalledWith("cleanup_runtime_dependency", {
      args: { kind: "downloads" },
    });
  });

  it("measures managed dependency storage sizes", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ items: [] });

    await measureRuntimeDependencyStorage();

    expect(invoke).toHaveBeenCalledWith("measure_runtime_dependency_storage");
  });
});
