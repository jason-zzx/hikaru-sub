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
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("useRuntimeDependencyPreparation", () => {
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
