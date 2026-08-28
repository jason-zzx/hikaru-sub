// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../types";
import { SettingsTranscriptionPanel } from "./SettingsTranscriptionPanel";

const availability = vi.hoisted(() => ({
  engineOptions: [
    { value: "faster-whisper", label: "faster-whisper" },
    { value: "qwen3-asr", label: "qwen3（后续版本支持）", disabled: true },
  ],
  modelOptions: [
    {
      value: "Qwen/Qwen3-ASR-1.7B",
      label: "Qwen3-ASR-1.7B（后续版本支持）",
      disabled: true,
    },
  ],
  deviceOptions: [
    { value: "auto", label: "自动" },
    { value: "cpu", label: "CPU" },
    { value: "cuda", label: "CUDA（后续版本支持）", disabled: true },
  ],
  selectedModelStatus: {
    engine: "qwen3-asr",
    model: "Qwen/Qwen3-ASR-1.7B",
    available: false,
    downloaded: false,
    disposition: "postMvpUnavailable" as const,
    reason: "该模型将在后续版本支持",
  },
  selectedModelError: null,
  modelLoading: false,
  loading: false,
  routeAvailable: false,
  unavailableReason: "该引擎将在后续版本支持",
  refresh: vi.fn(async () => undefined),
  refreshSelectedModel: vi.fn(async () => ({ kind: "aborted" as const })),
}));

vi.mock("../../hooks/useAsrAvailability", () => ({
  useAsrAvailability: () => availability,
}));
vi.mock("../../services/tauri", () => ({
  downloadAsrModel: vi.fn(),
  getModelDownloadProgress: vi.fn(),
}));

afterEach(cleanup);

const settings: AppSettings = {
  asrEngine: "qwen3-asr",
  asrModel: "Qwen/Qwen3-ASR-1.7B",
  asrDevice: "cuda",
  translationProviders: [],
  defaultSourceLang: "ja",
  defaultTargetLang: "zh-CN",
  translationBatchSize: 10,
  translationContextWindow: 0,
  subtitleMergeMode: "inline",
  subtitleTextOrder: "translation-first",
  editorHotkeys: [],
};

describe("SettingsTranscriptionPanel Native availability", () => {
  it("keeps unavailable saved values visible without rewriting settings", () => {
    const update = vi.fn();
    render(<SettingsTranscriptionPanel settings={settings} update={update} />);

    const values = screen.getAllByRole("combobox").map((item) => item.textContent);
    expect(values).toEqual(
      expect.arrayContaining([
        expect.stringContaining("qwen3"),
        expect.stringContaining("Qwen3-ASR-1.7B"),
        expect.stringContaining("CUDA"),
      ]),
    );
    expect(screen.getAllByText(/后续版本支持/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Python|虚拟环境|配置当前引擎依赖/)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
