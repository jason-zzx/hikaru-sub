// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useUiStore } from "../../stores/uiStore";
import { TranscribeView } from "./TranscribeView";

const mocks = vi.hoisted(() => ({
  cancelAsr: vi.fn(),
  checkFfmpeg: vi.fn(),
  getAsrProgress: vi.fn(),
  getSettings: vi.fn(),
  pathExists: vi.fn(),
  refreshSelectedModel: vi.fn(),
  startAsr: vi.fn(),
}));

vi.mock("../../hooks/useAsrAvailability", () => ({
  useAsrAvailability: (engine: string, model: string) => ({
    engineOptions: [
      { value: "faster-whisper", label: "Faster-Whisper" },
      { value: "kotoba-faster-whisper", label: "kotoba-faster-whisper" },
    ],
    modelOptions: [{ value: model, label: model }],
    deviceOptions: [
      { value: "auto", label: "自动" },
      { value: "cpu", label: "CPU" },
    ],
    selectedModelStatus: {
      engine,
      model,
      available: true,
      downloaded: true,
      disposition: "ready",
    },
    selectedModelError: null,
    modelLoading: false,
    loading: false,
    routeAvailable: true,
    unavailableReason: null,
    refresh: vi.fn(async () => undefined),
    refreshSelectedModel: mocks.refreshSelectedModel,
  }),
}));

vi.mock("../../hooks/useRuntimeDependencyPreparation", () => ({
  useRuntimeDependencyPreparation: () => ({
    error: null,
    item: null,
    open: false,
    progressPercent: null,
    requestDependency: vi.fn(),
    setOpen: vi.fn(),
    snapshot: null,
    sourceLabel: "官方源",
    confirmPrepare: vi.fn(),
  }),
}));

vi.mock("../../services/unsavedChanges", () => ({
  confirmDiscardUnsavedChanges: vi.fn(async () => ({
    proceed: true,
    recoveryVideoPath: null,
  })),
}));

vi.mock("../../services/subtitleRecovery", () => ({
  withDiscardedSubtitleRecovery: vi.fn(async (_path, action) => action()),
}));

vi.mock("../../services/tauri", () => ({
  cancelAsr: (...args: unknown[]) => mocks.cancelAsr(...args),
  checkFfmpeg: (...args: unknown[]) => mocks.checkFfmpeg(...args),
  extractAudio: vi.fn(),
  getAsrProgress: (...args: unknown[]) => mocks.getAsrProgress(...args),
  getSettings: (...args: unknown[]) => mocks.getSettings(...args),
  getVideoInfo: vi.fn(),
  invalidateFfmpegStatus: vi.fn(),
  onAudioExtractProgress: vi.fn(),
  pathExists: (...args: unknown[]) => mocks.pathExists(...args),
  saveAssText: vi.fn(),
  startAsr: (...args: unknown[]) => mocks.startAsr(...args),
  downloadAsrModel: vi.fn(),
  getModelDownloadProgress: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState(useProjectStore.getInitialState());
  useTaskStore.setState(useTaskStore.getInitialState());
  useUiStore.setState(useUiStore.getInitialState());
  useProjectStore.getState().setSession({
    videoPath: "C:/media/input.mp4",
    workspacePath: "C:/cache/workspace",
    audioPath: "C:/cache/workspace/audio.wav",
    transcribedAssPath: "C:/media/input.transcribed.ass",
    translatedAssPath: "C:/media/input.translated.ass",
    burnAssPath: "C:/cache/workspace/burn.ass",
    sourceLang: "ja",
  });
  mocks.checkFfmpeg.mockResolvedValue({ available: true, source: "system" });
  mocks.getSettings.mockResolvedValue({
    asrEngine: "faster-whisper",
    asrModel: "large-v3",
    asrDevice: "auto",
  });
  mocks.pathExists.mockResolvedValue(true);
  mocks.refreshSelectedModel.mockResolvedValue({
    kind: "ok",
    status: {
      engine: "faster-whisper",
      model: "large-v3",
      available: true,
      downloaded: true,
      disposition: "ready",
    },
  });
  mocks.cancelAsr.mockResolvedValue(undefined);
  mocks.getAsrProgress.mockResolvedValue({
    id: "native-job",
    status: "running",
    progress: 0,
    durationMs: 1_000,
    processedMs: 0,
    segmentCount: 0,
    detectedLanguage: null,
    error: null,
  });
});

afterEach(cleanup);

async function renderAndStart() {
  const user = userEvent.setup();
  const view = render(<TranscribeView />);
  const start = await screen.findByRole("button", { name: "开始转录" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  await user.click(start);
  return { user, view };
}

describe("TranscribeView Native ASR flow", () => {
  it("starts the exact Kotoba Native CPU route through the existing flow", async () => {
    mocks.getSettings.mockResolvedValue({
      asrEngine: "kotoba-faster-whisper",
      asrModel: "kotoba-tech/kotoba-whisper-v2.0-faster",
      asrDevice: "auto",
    });
    mocks.refreshSelectedModel.mockResolvedValue({
      kind: "ok",
      status: {
        engine: "kotoba-faster-whisper",
        model: "kotoba-tech/kotoba-whisper-v2.0-faster",
        available: true,
        downloaded: true,
        disposition: "ready",
      },
    });
    mocks.startAsr.mockResolvedValue("kotoba-job");

    const { view } = await renderAndStart();

    await waitFor(() =>
      expect(mocks.startAsr).toHaveBeenCalledWith({
        audioPath: "C:/cache/workspace/audio.wav",
        engine: "kotoba-faster-whisper",
        model: "kotoba-tech/kotoba-whisper-v2.0-faster",
        device: "auto",
        language: "ja",
        outputAssPath: "C:/media/input.transcribed.ass",
        useVad: false,
        vadConfig: null,
      }),
    );
    view.unmount();
  });

  it("shows startup progress and preserves the user-cancel reason before jobId exists", async () => {
    let resolveStart!: (jobId: string) => void;
    mocks.startAsr.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const { user } = await renderAndStart();

    await screen.findByRole("button", { name: "取消转录" });
    expect(screen.getByText("正在启动 Native ASR…")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "取消转录" }));
    expect(
      (screen.getByRole("button", { name: "取消中…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("已取消转录")).toBeTruthy();
    expect(screen.queryByText("检测模型…")).toBeNull();

    await act(async () => {
      resolveStart("native-job-late");
    });

    await waitFor(() =>
      expect(mocks.cancelAsr).toHaveBeenCalledWith("native-job-late"),
    );
    await screen.findByRole("button", { name: "开始转录" });
    expect(screen.getByText("已取消转录")).toBeTruthy();
    expect(
      screen.queryByText("字幕或工作视频已发生变化，已取消启动转录"),
    ).toBeNull();
    expect(screen.queryByText("检测模型…")).toBeNull();
  });

  it("keeps the first inference window indeterminate before showing real progress", async () => {
    mocks.startAsr.mockResolvedValue("native-job-progress");
    mocks.getAsrProgress
      .mockResolvedValueOnce({
        id: "native-job-progress",
        status: "pending",
        progress: 0,
        durationMs: 10_000,
        processedMs: 0,
        segmentCount: 0,
        detectedLanguage: null,
        error: null,
      })
      .mockResolvedValueOnce({
        id: "native-job-progress",
        status: "running",
        progress: 0,
        durationMs: 10_000,
        processedMs: 0,
        segmentCount: 0,
        detectedLanguage: null,
        error: null,
      })
      .mockResolvedValue({
        id: "native-job-progress",
        status: "running",
        progress: 0.5,
        durationMs: 10_000,
        processedMs: 5_000,
        segmentCount: 1,
        detectedLanguage: "ja",
        error: null,
      });
    const { user } = await renderAndStart();

    await screen.findByText("正在加载 Native ASR 模型…");
    expect(screen.queryByText("转录中 0%")).toBeNull();
    await screen.findByText("正在处理首个音频片段…");
    expect(screen.queryByText("转录中 0%")).toBeNull();
    await screen.findByText("转录中 50%", {}, { timeout: 4_000 });
    expect(screen.getByText("进度 0:05 / 0:10")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "取消转录" }));
    await waitFor(() =>
      expect(mocks.cancelAsr).toHaveBeenCalledWith("native-job-progress"),
    );
  });

  it("cancels a late job and releases the global task when the view unmounts", async () => {
    let resolveStart!: (jobId: string) => void;
    mocks.startAsr.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const { view } = await renderAndStart();
    await screen.findByRole("button", { name: "取消转录" });
    expect(useTaskStore.getState().tasks.asr?.status).toBe("running");

    view.unmount();
    await act(async () => {
      resolveStart("native-job-after-unmount");
    });

    await waitFor(() =>
      expect(mocks.cancelAsr).toHaveBeenCalledWith("native-job-after-unmount"),
    );
    expect(useTaskStore.getState().tasks.asr?.status).toBe("idle");
  });

  it("releases the global task when a pending start fails after unmount", async () => {
    let rejectStart!: (error: Error) => void;
    mocks.startAsr.mockImplementation(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    const { view } = await renderAndStart();
    await screen.findByRole("button", { name: "取消转录" });
    expect(useTaskStore.getState().tasks.asr?.status).toBe("running");

    view.unmount();
    await act(async () => {
      rejectStart(new Error("start failed after unmount"));
    });

    await waitFor(() =>
      expect(useTaskStore.getState().tasks.asr?.status).toBe("idle"),
    );
    expect(mocks.cancelAsr).not.toHaveBeenCalled();
  });
});
