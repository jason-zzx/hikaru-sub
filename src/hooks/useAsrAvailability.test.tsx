// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASR_ENGINE_MODELS } from "../constants/asr";
import type { AsrModelStatus } from "../types";
import {
  asrDeviceSelectOptions,
  asrEngineSelectOptions,
  asrModelSelectOptions,
  useAsrAvailability,
} from "./useAsrAvailability";

const mocks = vi.hoisted(() => ({
  listAsrEngines: vi.fn(),
  checkAsrModel: vi.fn(),
}));
vi.mock("../services/tauri", () => mocks);

const status = (
  engine: string,
  model: string,
  disposition: AsrModelStatus["disposition"],
): AsrModelStatus => ({
  engine,
  model,
  disposition,
  available: disposition === "ready" || disposition === "supportedMissing",
  downloaded: disposition === "ready",
  reason:
    disposition === "postMvpUnavailable" ? "该模型将在后续版本支持" : null,
});

beforeEach(() => {
  mocks.listAsrEngines.mockReset();
  mocks.checkAsrModel.mockReset();
});

afterEach(cleanup);

describe("useAsrAvailability", () => {
  it("keeps released Whisper and Kotoba routes enabled while other engines stay deferred", () => {
    const engines = [
      { name: "faster-whisper", available: true, device: "cpu" },
      { name: "kotoba-faster-whisper", available: true, device: "cpu" },
      { name: "parakeet", available: false, reason: "该引擎将在后续版本支持" },
      { name: "qwen3-asr", available: false, reason: "该引擎将在后续版本支持" },
      { name: "reazonspeech-nemo", available: false, reason: "该引擎将在后续版本支持" },
    ];
    const engineOptions = asrEngineSelectOptions(engines, null);
    expect(engineOptions).toHaveLength(5);
    expect(
      engineOptions.find((item) => item.value === "kotoba-faster-whisper")?.disabled,
    ).toBeUndefined();
    for (const engine of ["parakeet", "qwen3-asr", "reazonspeech-nemo"]) {
      expect(engineOptions.find((item) => item.value === engine)).toMatchObject({
        disabled: true,
      });
    }

    const whisperModels = ASR_ENGINE_MODELS["faster-whisper"].map(({ value }) => value);
    const modelOptions = asrModelSelectOptions("faster-whisper", {
      engine: "faster-whisper",
      useVad: false,
      loading: false,
      statuses: Object.fromEntries(
        whisperModels.map((model) => [
          model,
          status(
            "faster-whisper",
            model,
            model === "tiny" ? "ready" : "supportedMissing",
          ),
        ]),
      ),
      errors: {},
    });
    expect(modelOptions.map((item) => item.value)).toEqual(whisperModels);
    expect(modelOptions.every((item) => item.disabled !== true)).toBe(true);

    const kotobaModel = ASR_ENGINE_MODELS["kotoba-faster-whisper"][0].value;
    const kotobaOptions = asrModelSelectOptions("kotoba-faster-whisper", {
      engine: "kotoba-faster-whisper",
      useVad: false,
      loading: false,
      statuses: {
        [kotobaModel]: status(
          "kotoba-faster-whisper",
          kotobaModel,
          "supportedMissing",
        ),
      },
      errors: {},
    });
    expect(kotobaOptions).toEqual([
      expect.objectContaining({ value: kotobaModel }),
    ]);
    expect(kotobaOptions[0].disabled).toBeUndefined();

    const devices = asrDeviceSelectOptions(engines[1], false, null);
    expect(devices.find((item) => item.value === "auto")?.disabled).toBeUndefined();
    expect(devices.find((item) => item.value === "cpu")?.disabled).toBeUndefined();
    expect(devices.find((item) => item.value === "cuda")).toMatchObject({ disabled: true });
  });

  it("uses backend device capabilities and keeps missing CUDA selectable for download", () => {
    const devices = asrDeviceSelectOptions(
      {
        name: "faster-whisper",
        available: true,
        device: "cpu",
        devices: [
          { device: "cpu", available: true },
          {
            device: "cuda",
            available: false,
            downloadRequired: true,
            reason: "CUDA 运行时尚未安装",
          },
        ],
      },
      false,
      null,
    );
    expect(devices.find((item) => item.value === "auto")?.disabled).toBeUndefined();
    expect(devices.find((item) => item.value === "cpu")?.disabled).toBeUndefined();
    expect(devices.find((item) => item.value === "cuda")).toMatchObject({
      disabled: false,
      label: expect.stringContaining("CUDA 运行时尚未安装"),
    });
  });

  it("returns the freshly prepared CUDA route instead of a stale render closure", async () => {
    const missing = {
      name: "faster-whisper",
      available: true,
      device: "cpu",
      devices: [
        { device: "cpu", available: true },
        {
          device: "cuda",
          available: false,
          downloadRequired: true,
          reason: "CUDA 运行时尚未安装",
        },
      ],
    };
    const ready = {
      ...missing,
      devices: [
        { device: "cpu", available: true },
        {
          device: "cuda",
          available: true,
          downloadRequired: false,
          deviceName: "NVIDIA GeForce RTX 3070",
        },
      ],
    };
    mocks.listAsrEngines
      .mockResolvedValueOnce([missing])
      .mockResolvedValueOnce([ready]);
    mocks.checkAsrModel.mockImplementation((engine: string, model: string) =>
      Promise.resolve(status(engine, model, "ready")),
    );

    const { result } = renderHook(() =>
      useAsrAvailability("faster-whisper", "large-v3", "cuda"),
    );
    await waitFor(() => expect(result.current.deviceDownloadRequired).toBe(true));

    let outcome!: Awaited<ReturnType<typeof result.current.refresh>>;
    await act(async () => {
      outcome = await result.current.refresh();
    });

    expect(outcome).toEqual({
      routeAvailable: true,
      unavailableReason: null,
      deviceDownloadRequired: false,
    });
  });

  it.each(["supportedMissing", "ready"] as const)("enables Qwen %s on CPU and verified CUDA without inventing a download", async (disposition) => {
    const cpu = { device: "cpu", available: true };
    mocks.listAsrEngines.mockResolvedValue([{
      name: "qwen3-asr", backend: "crispasr", available: true, device: "cpu",
      devices: [cpu, { device: "cuda", available: false, downloadRequired: false, reason: "下载源尚未发布，可使用 CPU" }],
    }]);
    mocks.checkAsrModel.mockResolvedValue({
      ...status("qwen3-asr", "Qwen/Qwen3-ASR-1.7B", disposition),
      backend: "crispasr", revision: "pair-two-frozen-sources",
    });
    const { result, rerender } = renderHook(
      ({ device }) => useAsrAvailability("qwen3-asr", "Qwen/Qwen3-ASR-1.7B", device),
      { initialProps: { device: "cpu" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.routeAvailable).toBe(true);
    expect(result.current.engineOptions.find((option) => option.value === "qwen3-asr")?.disabled).toBeFalsy();
    expect(result.current.modelOptions[0].disabled).toBeFalsy();
    rerender({ device: "cuda" });
    expect(result.current.routeAvailable).toBe(false);
    expect(result.current.deviceDownloadRequired).toBe(false);
    expect(result.current.deviceOptions.find((option) => option.value === "cuda")?.disabled).toBe(true);
    expect(result.current.unavailableReason).toContain("下载源尚未发布");
    mocks.listAsrEngines.mockResolvedValue([{
      name: "qwen3-asr", backend: "crispasr", available: true, device: "cpu",
      devices: [cpu, { device: "cuda", available: true, downloadRequired: false }],
    }]);
    await act(async () => {
      expect(await result.current.refresh()).toMatchObject({ routeAvailable: true, deviceDownloadRequired: false });
    });
    expect(result.current.routeAvailable).toBe(true);
    expect(result.current.deviceOptions.find((option) => option.value === "cuda")?.disabled).toBeFalsy();
    expect(result.current.selectedModelStatus?.model).toBe("Qwen/Qwen3-ASR-1.7B");
  });

  it("enables ReazonSpeech only after embedded both-device capability and model readiness agree", async () => {
    const model = "reazon-research/reazonspeech-nemo-v2";
    mocks.listAsrEngines.mockResolvedValue([{
      name: "reazonspeech-nemo", backend: "crispasr", available: true, device: "cpu",
      devices: [{ device: "cpu", available: true }, { device: "cuda", available: true, downloadRequired: false }],
    }]);
    mocks.checkAsrModel.mockResolvedValue(status("reazonspeech-nemo", model, "supportedMissing"));
    const { result } = renderHook(() => useAsrAvailability("reazonspeech-nemo", model, "cpu"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.routeAvailable).toBe(true);
    expect(result.current.unavailableReason).toBeNull();
    expect(result.current.engineOptions.find((option) => option.value === "reazonspeech-nemo")?.disabled).toBeFalsy();
    expect(result.current.modelOptions).toEqual([expect.objectContaining({ value: model })]);
    expect(result.current.modelOptions[0].disabled).toBeFalsy();
  });

  it("checks the selected model first, publishes it before the rest, and stops stale scans", async () => {
    mocks.listAsrEngines.mockResolvedValue([
      { name: "faster-whisper", available: true, device: "cpu" },
    ]);
    const pending: Array<() => void> = [];
    mocks.checkAsrModel.mockImplementation((engine: string, model: string) =>
      new Promise<AsrModelStatus>((resolve) => {
        pending.push(() => resolve(status(engine, model, "ready")));
      }),
    );
    const { result, unmount } = renderHook(() =>
      useAsrAvailability("faster-whisper", "large-v3", "cpu"),
    );
    await waitFor(() => expect(result.current.engineLoading).toBe(false));
    expect(mocks.checkAsrModel.mock.calls).toEqual([["faster-whisper", "large-v3", false]]);
    await act(async () => pending.shift()!());
    expect(result.current.routeAvailable).toBe(true);
    expect(result.current.modelLoading).toBe(false);
    expect(mocks.checkAsrModel).toHaveBeenCalledTimes(2);
    expect(result.current.modelOptions.find((option) => option.value === "base")?.disabled).toBe(true);
    unmount();
    await act(async () => pending.shift()!());
    expect(mocks.checkAsrModel).toHaveBeenCalledTimes(2);
  });

  it("keeps the remaining scan alive when the selected model is refreshed", async () => {
    mocks.listAsrEngines.mockResolvedValue([
      { name: "faster-whisper", available: true, device: "cpu" },
    ]);
    let finishTiny!: () => void;
    mocks.checkAsrModel.mockImplementation((engine: string, model: string) =>
      model === "tiny"
        ? new Promise<AsrModelStatus>((resolve) => {
            finishTiny = () => resolve(status(engine, model, "ready"));
          })
        : Promise.resolve(status(engine, model, "ready")),
    );
    const { result } = renderHook(() => useAsrAvailability("faster-whisper", "large-v3", "cpu"));
    await waitFor(() => expect(result.current.routeAvailable).toBe(true));
    mocks.checkAsrModel.mockImplementation((engine: string, model: string) =>
      Promise.resolve(status(engine, model, model === "large-v3" ? "supportedMissing" : "ready")),
    );
    await act(async () => { await result.current.refreshSelectedModel(); });
    await act(async () => finishTiny());
    await waitFor(() => expect(result.current.modelOptions.every((option) => !option.disabled)).toBe(true));
    expect(result.current.selectedModelStatus?.disposition).toBe("supportedMissing");
  });

  it("does not rescan every model when only the selected model changes", async () => {
    mocks.listAsrEngines.mockResolvedValue([
      { name: "faster-whisper", available: true, device: "cpu" },
    ]);
    mocks.checkAsrModel.mockImplementation((engine: string, model: string) =>
      Promise.resolve(
        status(
          engine,
          model,
          model === "large-v3" ? "supportedMissing" : "postMvpUnavailable",
        ),
      ),
    );

    const { result, rerender } = renderHook(
      ({ model }) => useAsrAvailability("faster-whisper", model, "cpu"),
      { initialProps: { model: "large-v3" } },
    );

    await waitFor(() => expect(result.current.modelLoading).toBe(false));
    expect(mocks.checkAsrModel).toHaveBeenCalledTimes(7);

    rerender({ model: "large-v3-turbo" });

    await waitFor(() =>
      expect(result.current.selectedModelStatus?.model).toBe("large-v3-turbo"),
    );
    expect(mocks.checkAsrModel).toHaveBeenCalledTimes(7);
  });

  it.each(["batch", "selected"])("isolates VAD readiness from a stale %s response", async (kind) => {
    mocks.listAsrEngines.mockResolvedValue([{
      name: "faster-whisper", available: true,
      devices: [{ device: "cpu", available: true, optionalVad: { available: true } }],
    }]);
    mocks.checkAsrModel.mockImplementation(async (engine, model) => status(engine, model, "ready"));
    const { result, rerender } = renderHook(
      ({ useVad }) => useAsrAvailability("faster-whisper", "large-v3", "cpu", useVad),
      { initialProps: { useVad: false } },
    );
    await waitFor(() => expect(result.current.modelOptions.every(option => !option.disabled)).toBe(true));
    let finish!: (value: AsrModelStatus) => void;
    mocks.checkAsrModel.mockImplementation((engine, model, useVad) => useVad
      ? Promise.resolve(status(engine, model, "supportedMissing"))
      : new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<unknown>;
    act(() => { pending = kind === "batch" ? result.current.refresh() : result.current.refreshSelectedModel(); });
    rerender({ useVad: true });
    await waitFor(() => expect(result.current.selectedModelStatus?.disposition).toBe("supportedMissing"));
    expect(mocks.checkAsrModel).toHaveBeenCalledWith("faster-whisper", "large-v3", true);
    await act(async () => { finish(status("faster-whisper", "large-v3", "ready")); await pending; });
    expect(result.current.selectedModelStatus?.disposition).toBe("supportedMissing");
    expect(result.current.routeAvailable).toBe(true);
  });

  it.each(["cpu", "cuda", "auto"])("gates enabled VAD on the resolved %s capability without affecting off", async (device) => {
    mocks.listAsrEngines.mockResolvedValue([{
      name: "faster-whisper", available: true,
      devices: [
        { device: "cpu", available: true, optionalVad: { available: device === "auto", reason: "CPU VAD 不可用" } },
        { device: "cuda", available: true, optionalVad: { available: false, reason: "CUDA worker 不支持 VAD" } },
      ],
    }]);
    mocks.checkAsrModel.mockImplementation(async (engine, model) => status(engine, model, "ready"));
    const { result, rerender } = renderHook(
      ({ useVad }) => useAsrAvailability("faster-whisper", "large-v3", device, useVad),
      { initialProps: { useVad: false } },
    );
    await waitFor(() => expect(result.current.routeAvailable).toBe(true));
    rerender({ useVad: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.routeAvailable).toBe(false);
    expect(result.current.unavailableReason).toBe(device === "cpu" ? "CPU VAD 不可用" : "CUDA worker 不支持 VAD");
    expect(result.current.deviceOptions.find(option => option.value === device)?.disabled).toBe(true);
    rerender({ useVad: false });
    await waitFor(() => expect(result.current.routeAvailable).toBe(true));
  });

  it("treats absent optional capability as unavailable and uses CPU only when auto CUDA is unavailable", async () => {
    mocks.listAsrEngines.mockResolvedValue([{
      name: "faster-whisper", available: true,
      devices: [{ device: "cpu", available: true }, { device: "cuda", available: false }],
    }]);
    mocks.checkAsrModel.mockImplementation(async (engine, model) => status(engine, model, "ready"));
    const { result } = renderHook(() => useAsrAvailability("faster-whisper", "large-v3", "auto", true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.routeAvailable).toBe(false);
    mocks.listAsrEngines.mockResolvedValue([{
      name: "faster-whisper", available: true,
      devices: [{ device: "cpu", available: true, optionalVad: { available: true } }, { device: "cuda", available: false }],
    }]);
    await act(async () => { expect(await result.current.refresh()).toMatchObject({ routeAvailable: true }); });
  });

  it("ignores stale model results after an engine change", async () => {
    let resolveOld!: (value: AsrModelStatus) => void;
    const old = new Promise<AsrModelStatus>((resolve) => {
      resolveOld = resolve;
    });
    mocks.listAsrEngines.mockResolvedValue([
      { name: "faster-whisper", available: true, device: "cpu" },
      { name: "qwen3-asr", available: true, device: "cpu" },
    ]);
    mocks.checkAsrModel.mockImplementation((engine: string, model: string) =>
      engine === "qwen3-asr"
        ? old
        : Promise.resolve(status(engine, model, model === "large-v3" ? "ready" : "postMvpUnavailable")),
    );

    const { result, rerender } = renderHook(
      ({ engine, model }) => useAsrAvailability(engine, model, "cpu"),
      { initialProps: { engine: "qwen3-asr", model: "Qwen/Qwen3-ASR-1.7B" } },
    );
    rerender({ engine: "faster-whisper", model: "large-v3" });
    await waitFor(() => expect(result.current.selectedModelStatus?.model).toBe("large-v3"));
    await act(async () => {
      resolveOld(
        status(
          "qwen3-asr",
          "Qwen/Qwen3-ASR-1.7B",
          "supportedMissing",
        ),
      );
      await old;
    });
    expect(result.current.selectedModelStatus?.model).toBe("large-v3");
    expect(result.current.routeAvailable).toBe(true);
  });
});
