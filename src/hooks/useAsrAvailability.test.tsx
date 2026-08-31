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
