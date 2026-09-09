// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRuntimeDependencyPreparation } from "./useRuntimeDependencyPreparation";

const mocks = vi.hoisted(() => ({
  getRuntimeDependencyProgress: vi.fn(),
  prepareRuntimeDependency: vi.fn(),
  probeRuntimeDependencies: vi.fn(),
}));

vi.mock("../services/tauri", () => mocks);

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(cleanup);

describe("useRuntimeDependencyPreparation", () => {
  it.each(["nativeAsrCuda", "crispasrCuda", "ffmpeg"] as const)("deduplicates %s consent while prepare is pending", async (kind) => {
    mocks.probeRuntimeDependencies.mockResolvedValue({ sourceMode: "official", items: [{ kind, status: "missing", expectedDownloadBytes: 10 }] });
    let finishPrepare!: (id: string) => void;
    mocks.prepareRuntimeDependency.mockReturnValue(new Promise<string>((resolve) => { finishPrepare = resolve; }));
    mocks.getRuntimeDependencyProgress.mockResolvedValue({ status: "completed", progress: 1 });
    const afterPrepare = vi.fn(async () => undefined);
    const { result } = renderHook(() => useRuntimeDependencyPreparation(kind));
    await act(async () => { await result.current.requestDependency(afterPrepare); });
    let first!: Promise<boolean>;
    await act(async () => {
      first = result.current.confirmPrepare();
      expect(await result.current.confirmPrepare()).toBe(false);
    });
    expect(result.current.preparing).toBe(true);
    expect(mocks.prepareRuntimeDependency).toHaveBeenCalledExactlyOnceWith({ kind });
    mocks.probeRuntimeDependencies.mockResolvedValue({ sourceMode: "official", items: [{ kind, status: "available" }] });
    await act(async () => { finishPrepare("runtime-job"); await first; });
    expect(afterPrepare).toHaveBeenCalledTimes(1);
    expect(result.current.preparing).toBe(false);
    expect(result.current.open).toBe(false);
  });

  it.each(["kind change", "unmount"])("discards a pending probe on %s", async (action) => {
    let finish!: (value: unknown) => void;
    mocks.probeRuntimeDependencies.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const afterPrepare = vi.fn();
    const { result, rerender, unmount } = renderHook(({ kind }) => useRuntimeDependencyPreparation(kind), { initialProps: { kind: "nativeAsrCuda" as "nativeAsrCuda" | "crispasrCuda" } });
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.requestDependency(afterPrepare); });
    if (action === "unmount") unmount();
    else rerender({ kind: "crispasrCuda" });
    await act(async () => {
      finish({ sourceMode: "official", items: [{ kind: "nativeAsrCuda", status: "available" }] });
      await pending;
    });
    expect(afterPrepare).not.toHaveBeenCalled();
    expect(mocks.prepareRuntimeDependency).not.toHaveBeenCalled();
  });

  it("continues the pending action when a stale caller finds the dependency already ready", async () => {
    mocks.probeRuntimeDependencies.mockResolvedValue({
      sourceMode: "official",
      items: [
        {
          kind: "nativeAsrCuda",
          status: "available",
          managed: true,
        },
      ],
    });
    const afterPrepare = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useRuntimeDependencyPreparation("nativeAsrCuda"),
    );

    let ready = false;
    await act(async () => {
      ready = await result.current.requestDependency(afterPrepare);
    });

    expect(ready).toBe(true);
    expect(afterPrepare).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(false);
    expect(mocks.prepareRuntimeDependency).not.toHaveBeenCalled();
  });
});
