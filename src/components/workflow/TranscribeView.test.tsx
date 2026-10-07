// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useUiStore } from "../../stores/uiStore";
import { TranscribeView } from "./TranscribeView";
import { createDefaultDocument, formatAssTime } from "../../lib/ass";
import { withDiscardedSubtitleRecovery } from "../../services/subtitleRecovery";
import { confirmDiscardUnsavedChanges } from "../../services/unsavedChanges";

const mocks = vi.hoisted(() => ({
  cancelAsr: vi.fn(),
  downloadAsrModel: vi.fn(),
  getModelDownloadProgress: vi.fn(),
  checkFfmpeg: vi.fn(),
  getAsrProgress: vi.fn(),
  getSettings: vi.fn(),
  getVideoInfo: vi.fn(),
  saveAssText: vi.fn(),
  pathExists: vi.fn(),
  refreshSelectedModel: vi.fn(),
  startAsr: vi.fn(),
}));

vi.mock("../../hooks/useAsrAvailability", () => ({
  useAsrAvailability: (engine: string, model: string) => ({
    engineOptions: [
      { value: "faster-whisper", label: "Faster-Whisper" },
      { value: "kotoba-faster-whisper", label: "kotoba-faster-whisper" },
      { value: "qwen3-asr", label: "Qwen3" },
      { value: "parakeet", label: "parakeet" },
      { value: "reazonspeech-nemo", label: "ReazonSpeech NeMo" },
    ],
    modelOptions: [{ value: model, label: model }],
    deviceOptions: [
      { value: "auto", label: "自动" },
      { value: "cpu", label: "CPU" },
      { value: "cuda", label: "CUDA" },
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
  getVideoInfo: (...args: unknown[]) => mocks.getVideoInfo(...args),
  invalidateFfmpegStatus: vi.fn(),
  onAudioExtractProgress: vi.fn(),
  pathExists: (...args: unknown[]) => mocks.pathExists(...args),
  saveAssText: (...args: unknown[]) => mocks.saveAssText(...args),
  startAsr: (...args: unknown[]) => mocks.startAsr(...args),
  downloadAsrModel: (...args: unknown[]) => mocks.downloadAsrModel(...args),
  getModelDownloadProgress: (...args: unknown[]) => mocks.getModelDownloadProgress(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Radix Select uses browser APIs not implemented by jsdom.
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.scrollIntoView = () => undefined;
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
  mocks.getVideoInfo.mockResolvedValue({ width: 1280, height: 720 });
  mocks.saveAssText.mockResolvedValue(undefined);
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

async function renderAndStart(useVad = false) {
  const user = userEvent.setup();
  const view = render(<TranscribeView />);
  const start = await screen.findByRole("button", { name: "开始转录" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  if (useVad) await user.click(screen.getByRole("switch"));
  await user.click(start);
  return { user, view };
}

describe("TranscribeView Native ASR flow", () => {
  const displayRows = [
    { startMs: 0, endMs: 400, text: " A " },
    { startMs: 500, endMs: 900, text: "B" },
    { startMs: 1000, endMs: 2000, text: "先" },
    { startMs: 1000, endMs: 1300, text: "後" },
  ];
  const completed = (segments = displayRows) => ({
    id: "completed-job", status: "completed", progress: 1, durationMs: 3000,
    processedMs: 3000, segmentCount: segments.length, segments,
    detectedLanguage: "ja", error: null,
  });

  it.each([
    ["parakeet", false], ["reazonspeech-nemo", false], ["qwen3-asr", false],
    ["faster-whisper", false], ["kotoba-faster-whisper", false],
    ["faster-whisper", true], ["kotoba-faster-whisper", true],
  ] as const)(
    "installs and serializes completed %s results with VAD=%s and its own display policy", async (engine, useVad) => {
      mocks.getSettings.mockResolvedValue({ asrEngine: engine, asrModel: "fixture", asrDevice: "cpu" });
      // Same dimensions as the model-free real-product video fixture.
      mocks.getVideoInfo.mockResolvedValue({ width: 320, height: 180, durationMs: 1000, fps: 25 });
      mocks.startAsr.mockResolvedValue({ jobId: "completed-job" });
      mocks.getAsrProgress.mockResolvedValue(completed());
      await renderAndStart(useVad);
      await waitFor(() => expect(mocks.saveAssText).toHaveBeenCalledTimes(1));
      const expected = engine === "parakeet" || engine === "reazonspeech-nemo" || useVad ? displayRows : [
        { startMs: 0, endMs: 900, text: "AB" },
        { startMs: 1000, endMs: 2000, text: "後先" },
      ];
      const project = useProjectStore.getState();
      expect(project.cues.map(c => ({ startMs: c.startMs, endMs: c.endMs, text: c.primaryText }))).toEqual(expected);
      const [path, ass] = mocks.saveAssText.mock.calls[0] as [string, string];
      expect(path).toBe("C:/media/input.transcribed.ass");
      expect(ass.split("\n").filter(line => line.startsWith("Dialogue:"))).toEqual(
        expected.map(row => `Dialogue: 0,${formatAssTime(row.startMs)},${formatAssTime(row.endMs)},Primary,,0,0,0,,${row.text}`),
      );
      expect(mocks.getVideoInfo).toHaveBeenCalledWith("C:/media/input.mp4");
      expect(project.assScriptInfo?.playResX).toBe(320);
      expect(project.assScriptInfo?.playResY).toBe(180);
      expect(ass).toContain("PlayResX: 320");
      expect(ass).toContain("PlayResY: 180");
      expect(project.activeSubtitlePath).toBe(path);
      expect(project.isDirty).toBe(false);
    },
  );

  it.each([
    ["parakeet", false], ["parakeet", true],
    ["faster-whisper", false], ["faster-whisper", true],
    ["kotoba-faster-whisper", false], ["kotoba-faster-whisper", true],
  ] as const)("keeps the entire loaded document on empty %s completion (dirty=%s)", async (engine, dirty) => {
    const doc = createDefaultDocument("Existing document", 640, 480);
    doc.cues = [{ id: "old", startMs: 10, endMs: 900, primaryText: "Existing", style: "Primary", layer: 0 }];
    useProjectStore.getState().loadAssDocument(doc, { kind: "translated", path: "C:/media/input.translated.ass" });
    if (dirty) useProjectStore.getState().updateCue("old", { primaryText: "Unsaved edit" });
    vi.mocked(confirmDiscardUnsavedChanges).mockResolvedValueOnce({
      proceed: true, recoveryVideoPath: dirty ? "C:/media/input.mp4" : null,
    });
    const before = useProjectStore.getState();
    expect(before.isDirty).toBe(dirty);
    mocks.getSettings.mockResolvedValue({ asrEngine: engine, asrModel: "fixture", asrDevice: "cpu" });
    mocks.startAsr.mockResolvedValue({ jobId: "completed-job" });
    mocks.getAsrProgress.mockResolvedValue(completed([]));
    await renderAndStart(engine !== "parakeet");
    expect(await screen.findByText("转录完成，未检测到语音；已保留现有字幕，未保存 ASS")).toBeTruthy();
    expect(useProjectStore.getState()).toBe(before);
    expect(withDiscardedSubtitleRecovery).not.toHaveBeenCalled();
    expect(mocks.getVideoInfo).not.toHaveBeenCalled();
    expect(mocks.saveAssText).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks.asr?.status).toBe("success");
  });

  it("defaults VAD off, validates only the two enabled inputs, and resets on remount", async () => {
    const user = userEvent.setup();
    const view = render(<TranscribeView />);
    const start = screen.getByRole("button", { name: "开始转录" });
    await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("spinbutton")).toBeNull();
    await user.click(screen.getByRole("switch"));
    const threshold = screen.getByRole("spinbutton", { name: /语音阈值/ }) as HTMLInputElement;
    const silence = screen.getByRole("spinbutton", { name: /最短静音时长/ }) as HTMLInputElement;
    expect([threshold.value, threshold.min, threshold.max, threshold.step]).toEqual(["0.5", "0", "1", "0.01"]);
    expect([silence.value, silence.min, silence.max, silence.step]).toEqual(["100", "0", "60000", "1"]);
    expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
    for (const [input, values, valid] of [
      [threshold, ["", "-0.1", "1.1"], "0.5"],
      [silence, ["", "-1", "60001", "1.5"], "100"],
    ] as const) {
      for (const value of values) {
        fireEvent.change(input, { target: { value } });
        expect(start.hasAttribute("disabled")).toBe(true);
        expect(input.getAttribute("aria-invalid")).toBe("true");
      }
      fireEvent.change(input, { target: { value: valid } });
      expect(start.hasAttribute("disabled")).toBe(false);
    }
    for (const [thresholdValue, silenceValue] of [["0", "0"], ["1", "60000"]]) {
      fireEvent.change(threshold, { target: { value: thresholdValue } });
      fireEvent.change(silence, { target: { value: silenceValue } });
      expect(start.hasAttribute("disabled")).toBe(false);
    }
    fireEvent.change(threshold, { target: { value: "" } });
    await user.click(screen.getByRole("switch"));
    mocks.startAsr.mockResolvedValue({ jobId: "off-job" });
    await user.click(start);
    await waitFor(() => expect(mocks.startAsr).toHaveBeenCalledWith(expect.objectContaining({ useVad: false, vadConfig: null })));
    view.unmount();
    render(<TranscribeView />);
    await waitFor(() => expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(false));
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    await user.click(screen.getByRole("switch"));
    expect((screen.getByRole("spinbutton", { name: /语音阈值/ }) as HTMLInputElement).value).toBe("0.5");
    expect((screen.getByRole("spinbutton", { name: /最短静音时长/ }) as HTMLInputElement).value).toBe("100");
  });

  it.each(["qwen3-asr", "parakeet", "reazonspeech-nemo"])("does not apply optional controls to mandatory %s", async (engine) => {
    const user = userEvent.setup();
    render(<TranscribeView />);
    await waitFor(() => expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(false));
    await user.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByRole("spinbutton", { name: /语音阈值/ }), { target: { value: "0.8" } });
    await user.click(screen.getAllByRole("combobox")[0]);
    const label = engine === "qwen3-asr" ? "Qwen3" : engine === "parakeet" ? "parakeet" : "ReazonSpeech NeMo";
    await user.click(screen.getByRole("option", { name: label }));
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    mocks.startAsr.mockResolvedValue({ jobId: "mandatory-job" });
    await user.click(screen.getByRole("button", { name: "开始转录" }));
    await waitFor(() => expect(mocks.startAsr).toHaveBeenCalledWith(expect.objectContaining({ engine, useVad: false, vadConfig: null })));
  });

  it.each([false, true])("preserves document/recovery/ASS on CT2 VAD failure, cancellation and partial output (dirty=%s)", async (dirty) => {
    const doc = createDefaultDocument("Existing document", 640, 480);
    doc.cues = [{ id: "old", startMs: 10, endMs: 900, primaryText: "Existing", style: "Primary", layer: 0 }];
    useProjectStore.getState().loadAssDocument(doc, { kind: "translated", path: "C:/media/input.translated.ass" });
    if (dirty) useProjectStore.getState().updateCue("old", { primaryText: "Unsaved edit" });
    const before = useProjectStore.getState();
    for (const status of ["failed", "cancelled", "user-cancel", "partial", "missing-segments", "start-error"]) {
      mocks.startAsr.mockResolvedValue({ jobId: "failed-job" });
      if (status === "start-error") mocks.startAsr.mockRejectedValueOnce(new Error("VAD unavailable"));
      mocks.getAsrProgress.mockImplementation(async (_id, includeSegments) => {
        if (status === "partial") return { ...completed(), status: includeSegments ? "running" : "completed" };
        if (status === "missing-segments") return { ...completed(), segments: undefined };
        return { ...completed(), status: status === "user-cancel" ? "running" : status, error: "VAD failed safely" };
      });
      const { view, user } = await renderAndStart(true);
      if (status === "user-cancel") await user.click(await screen.findByRole("button", { name: "取消转录" }));
      await waitFor(() => expect(useTaskStore.getState().tasks.asr?.status).not.toBe("running"));
      expect(useProjectStore.getState()).toBe(before);
      expect(withDiscardedSubtitleRecovery).not.toHaveBeenCalled();
      expect(mocks.getVideoInfo).not.toHaveBeenCalled();
      expect(mocks.saveAssText).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it("keeps prior subtitles when ReazonSpeech rejects an invalid medium/long result", async () => {
    const doc = createDefaultDocument("Existing document", 640, 480);
    doc.cues = [{ id: "old", startMs: 10, endMs: 900, primaryText: "Existing", style: "Primary", layer: 0 }];
    useProjectStore.getState().loadAssDocument(doc, { kind: "translated", path: "C:/media/input.translated.ass" });
    useProjectStore.getState().updateCue("old", { primaryText: "Unsaved edit" });
    const before = useProjectStore.getState();
    mocks.getSettings.mockResolvedValue({
      asrEngine: "reazonspeech-nemo",
      asrModel: "reazon-research/reazonspeech-nemo-v2",
      asrDevice: "cpu",
    });
    mocks.startAsr.mockResolvedValue({ jobId: "failed-reazon-job" });
    mocks.getAsrProgress.mockResolvedValue({
      id: "failed-reazon-job",
      status: "failed",
      progress: 1,
      durationMs: 498_872,
      processedMs: 498_872,
      segmentCount: 0,
      segments: [],
      detectedLanguage: null,
      error: "Native pipeline failed safely",
    });

    await renderAndStart();

    expect(await screen.findByText("Native pipeline failed safely")).toBeTruthy();
    expect(useProjectStore.getState()).toBe(before);
    expect(withDiscardedSubtitleRecovery).not.toHaveBeenCalled();
    expect(mocks.getVideoInfo).not.toHaveBeenCalled();
    expect(mocks.saveAssText).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks.asr?.status).toBe("error");
  });

  it.each(["parakeet", "faster-whisper", "kotoba-faster-whisper"])("rejects a stale %s completion after the final async snapshot read", async (engine) => {
    mocks.getSettings.mockResolvedValue({ asrEngine: engine, asrModel: "fixture", asrDevice: "cpu" });
    mocks.startAsr.mockResolvedValue({ jobId: "completed-job" });
    let finish!: (value: ReturnType<typeof completed>) => void;
    mocks.getAsrProgress.mockImplementation((_id, includeSegments) => includeSegments
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(completed()));
    await renderAndStart(engine !== "parakeet");
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    await act(async () => {
      useProjectStore.getState().setCues([{ id: "new", startMs: 10, endMs: 500, primaryText: "Newer edit", style: "Primary", layer: 0 }]);
    });
    const before = useProjectStore.getState();
    await act(async () => { finish(completed()); });
    expect(useProjectStore.getState()).toBe(before);
    expect(mocks.saveAssText).not.toHaveBeenCalled();
    expect(withDiscardedSubtitleRecovery).not.toHaveBeenCalled();
    expect(screen.getByText("字幕或工作视频已发生变化，已放弃本次转录结果")).toBeTruthy();
  });

  // UI contract fixtures, not production availability/runtime publication proof.
  it.each([
    ["qwen3-asr", "Qwen/Qwen3-ASR-1.7B", "cpu", 2_020_801_514],
    ["qwen3-asr", "Qwen/Qwen3-ASR-1.7B", "cuda", 2_020_801_514],
    ["parakeet", "nvidia/parakeet-tdt_ctc-0.6b-ja", "cpu", 1_247_817_898],
    ["parakeet", "nvidia/parakeet-tdt_ctc-0.6b-ja", "cuda", 1_247_817_898],
  ])("downloads %s and its required VAD then starts exact %s on %s", async (engine, model, device, totalBytes) => {
    mocks.getSettings.mockResolvedValue({ asrEngine: engine, asrModel: model, asrDevice: device });
    const ready = { engine, model, backend: "crispasr", available: true, downloaded: true, disposition: "ready" };
    mocks.refreshSelectedModel.mockResolvedValue({ kind: "ok", status: ready });
    mocks.refreshSelectedModel.mockResolvedValueOnce({ kind: "ok", status: { ...ready, disposition: "supportedMissing", downloaded: false } });
    mocks.downloadAsrModel.mockResolvedValue("qwen-pair-download");
    mocks.getModelDownloadProgress.mockResolvedValue({ id: "qwen-pair-download", engine, model, status: "completed", downloadedBytes: totalBytes, totalBytes });
    mocks.startAsr.mockResolvedValue({ jobId: "qwen-job" });
    const { user, view } = await renderAndStart();
    await user.click(await screen.findByRole("button", { name: "确定" }));
    await waitFor(() => expect(mocks.startAsr).toHaveBeenCalledWith({
      audioPath: "C:/cache/workspace/audio.wav", engine, model, device, language: "ja",
      outputAssPath: "C:/media/input.transcribed.ass", useVad: false, vadConfig: null,
    }), { timeout: 3000 });
    // Backend qualified_native_launch supplies required CPU VAD; no new frontend switch.
    expect(mocks.downloadAsrModel).toHaveBeenCalledExactlyOnceWith(engine, model, false);
    expect(mocks.getModelDownloadProgress).toHaveBeenCalledWith("qwen-pair-download");
    expect(mocks.refreshSelectedModel.mock.calls.length).toBeGreaterThanOrEqual(2);
    view.unmount();
  });

  it.each([
    ...["tiny", "base", "small", "medium", "large-v2", "large-v3", "large-v3-turbo"].map(model => ["faster-whisper", model]),
    ["kotoba-faster-whisper", "kotoba-tech/kotoba-whisper-v2.0-faster"],
  ])("starts optional VAD for %s / %s with the default parameters", async (engine, model) => {
    mocks.getSettings.mockResolvedValue({ asrEngine: engine, asrModel: model, asrDevice: "cpu" });
    mocks.startAsr.mockResolvedValue({ jobId: "vad-job" });
    const { view } = await renderAndStart(true);
    expect(mocks.startAsr).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      engine, model, device: "cpu", useVad: true,
      vadConfig: { threshold: 0.5, minSilenceDurationMs: 100 },
    }));
    view.unmount();
  });

  it("locks the downloaded VAD request through discard consent and rejects intervening edits", async () => {
    const ready = { engine: "faster-whisper", model: "large-v3", available: true, downloaded: true, disposition: "ready" };
    mocks.refreshSelectedModel.mockResolvedValue({ kind: "ok", status: ready });
    mocks.refreshSelectedModel.mockResolvedValueOnce({ kind: "ok", status: { ...ready, downloaded: false, disposition: "supportedMissing" } });
    mocks.downloadAsrModel.mockResolvedValue("download-job");
    mocks.getModelDownloadProgress.mockResolvedValue({ status: "completed", downloadedBytes: 100, totalBytes: 100 });
    let consent!: (value: { proceed: boolean; recoveryVideoPath: null }) => void;
    vi.mocked(confirmDiscardUnsavedChanges).mockReturnValueOnce(new Promise(resolve => { consent = resolve; }));
    const { user } = await renderAndStart(true);
    await user.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(confirmDiscardUnsavedChanges).toHaveBeenCalled());
    expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("spinbutton").every(input => input.hasAttribute("disabled"))).toBe(true);
    act(() => useProjectStore.getState().setCues([]));
    await act(async () => consent({ proceed: true, recoveryVideoPath: null }));
    expect(mocks.startAsr).not.toHaveBeenCalled();
    expect(screen.getByText("字幕或工作视频已发生变化，请重新开始转录。")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(false));
  });

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
    mocks.startAsr.mockResolvedValue({ jobId: "kotoba-job" });

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
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();
  });

  it("shows startup progress and preserves the user-cancel reason before jobId exists", async () => {
    let resolveStart!: (result: { jobId: string }) => void;
    mocks.startAsr.mockImplementation(
      () =>
        new Promise<{ jobId: string }>((resolve) => {
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
      resolveStart({ jobId: "native-job-late" });
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

  it("shows an auto CPU fallback notice once and clears it when a new start begins", async () => {
    const notice = "CUDA 启动前检查未通过，已改用 CPU 转录。";
    mocks.startAsr.mockResolvedValue({
      jobId: "native-job-auto-fallback",
      notice,
    });
    const { user } = await renderAndStart();

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(notice);
    expect(screen.getAllByText(notice)).toHaveLength(1);
    expect(screen.queryByText(`启动转录失败：${notice}`)).toBeNull();

    await user.click(screen.getByRole("button", { name: "取消转录" }));
    const start = await screen.findByRole("button", { name: "开始转录" });
    let resolveNextStart!: (result: { jobId: string }) => void;
    mocks.startAsr.mockImplementationOnce(
      () =>
        new Promise<{ jobId: string }>((resolve) => {
          resolveNextStart = resolve;
        }),
    );

    await user.click(start);
    await screen.findByText("正在启动 Native ASR…");
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      resolveNextStart({ jobId: "native-job-second-start" });
    });
    await user.click(await screen.findByRole("button", { name: "取消转录" }));
  });

  it("keeps the first inference window indeterminate before showing real progress", async () => {
    mocks.startAsr.mockResolvedValue({ jobId: "native-job-progress" });
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
    let resolveStart!: (result: { jobId: string }) => void;
    mocks.startAsr.mockImplementation(
      () =>
        new Promise<{ jobId: string }>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const { view } = await renderAndStart();
    await screen.findByRole("button", { name: "取消转录" });
    expect(useTaskStore.getState().tasks.asr?.status).toBe("running");

    view.unmount();
    await act(async () => {
      resolveStart({ jobId: "native-job-after-unmount" });
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
        new Promise<{ jobId: string }>((_resolve, reject) => {
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
