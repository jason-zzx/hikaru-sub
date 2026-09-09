// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../types";
import { SettingsTranscriptionPanel } from "./SettingsTranscriptionPanel";

const availability = vi.hoisted(() => ({
  engineOptions: [
    { value: "faster-whisper", label: "faster-whisper" },
    { value: "kotoba-faster-whisper", label: "kotoba-faster-whisper" },
    { value: "qwen3-asr", label: "qwen3" },
  ],
  modelOptions: [
    {
      value: "Qwen/Qwen3-ASR-1.7B",
      label: "Qwen3-ASR-1.7B",
    },
  ],
  deviceOptions: [
    { value: "auto", label: "自动" },
    { value: "cpu", label: "CPU" },
    { value: "cuda", label: "CUDA（下载源尚未发布）", disabled: true },
  ],
  selectedModelStatus: {
    engine: "qwen3-asr",
    model: "Qwen/Qwen3-ASR-1.7B",
    available: true,
    downloaded: false,
    disposition: "supportedMissing" as const,
    reason: null,
  },
  selectedModelError: null,
  modelLoading: false,
  loading: false,
  routeAvailable: false,
  unavailableReason: "下载源尚未发布",
  refresh: vi.fn(async () => undefined),
  refreshSelectedModel: vi.fn(async () => ({ kind: "aborted" as const })),
}));

vi.mock("../ui/select-adapter", () => ({
  Select: ({ value, onChange, options }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string; disabled?: boolean }>;
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  ),
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
  it("keeps Qwen selectable and a missing saved CUDA visible without rewriting settings", () => {
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
    expect(screen.getAllByText(/下载源尚未发布/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Python|虚拟环境|配置当前引擎依赖/)).toBeNull();
    expect(screen.getByRole("button", { name: "下载模型" })).toBeTruthy();
    expect((screen.getByRole("option", { name: "qwen3" }) as HTMLOptionElement).disabled).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("allows explicitly selecting Kotoba and its exact default model", async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    render(<SettingsTranscriptionPanel settings={settings} update={update} />);

    await user.selectOptions(
      screen.getAllByRole("combobox")[0],
      "kotoba-faster-whisper",
    );

    expect(update).toHaveBeenNthCalledWith(1, "asrEngine", "kotoba-faster-whisper");
    expect(update).toHaveBeenNthCalledWith(
      2,
      "asrModel",
      "kotoba-tech/kotoba-whisper-v2.0-faster",
    );
  });
});
