// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useUiStore } from "../../stores/uiStore";
import type { AsrEngineInfo, RuntimeDependencyProbe } from "../../types";
import { TranscribeView } from "./TranscribeView";

const mocks = vi.hoisted(() => ({
  checkFfmpeg: vi.fn(), getSettings: vi.fn(), pathExists: vi.fn(),
  listAsrEngines: vi.fn(), checkAsrModel: vi.fn(),
  probeRuntimeDependencies: vi.fn(), prepareRuntimeDependency: vi.fn(),
  getRuntimeDependencyProgress: vi.fn(), startAsr: vi.fn(), cancelAsr: vi.fn(),
  getAsrProgress: vi.fn(), downloadAsrModel: vi.fn(), getModelDownloadProgress: vi.fn(),
  extractAudio: vi.fn(), getVideoInfo: vi.fn(), saveAssText: vi.fn(),
  invalidateFfmpegStatus: vi.fn(), onAudioExtractProgress: vi.fn(),
}));
vi.mock("../../services/tauri", () => mocks);
vi.mock("../../services/unsavedChanges", () => ({
  confirmDiscardUnsavedChanges: vi.fn(async () => ({ proceed: true, recoveryVideoPath: null })),
}));
vi.mock("../../services/subtitleRecovery", () => ({
  withDiscardedSubtitleRecovery: vi.fn(async (_path, action) => action()),
}));

const routes = [
  { engine: "faster-whisper", model: "large-v3", backend: "ctranslate2", kind: "nativeAsrCuda", label: "Native ASR CUDA 运行时", size: 571_034_856, path: "C:/app/deps/asr-runtime/cuda/current" },
  { engine: "qwen3-asr", model: "Qwen/Qwen3-ASR-1.7B", backend: "crispasr", kind: "crispasrCuda", label: "CrispASR CUDA 运行时", size: 719_774_409, path: "C:/app/deps/asr-runtime/crispasr/cuda/current" },
] as const;

let runtimeReady: boolean;
function engines(): AsrEngineInfo[] {
  return routes.map(({ engine, backend }) => ({
    name: engine, backend, available: true, device: "cpu",
    devices: [
      { device: "cpu", available: true },
      { device: "cuda", available: runtimeReady, downloadRequired: !runtimeReady, reason: runtimeReady ? null : "CUDA 运行时未安装" },
    ],
  }));
}
function probe(): RuntimeDependencyProbe {
  return { sourceMode: "official", items: routes.map(({ kind, path, size }) => ({
    kind, path, status: runtimeReady ? "available" : "missing", managed: true,
    expectedDownloadBytes: runtimeReady ? undefined : size,
  })) };
}

beforeEach(() => {
  vi.resetAllMocks();
  runtimeReady = false;
  useProjectStore.setState(useProjectStore.getInitialState());
  useTaskStore.setState(useTaskStore.getInitialState());
  useUiStore.setState(useUiStore.getInitialState());
  useProjectStore.getState().setSession({
    videoPath: "C:/media/input.mp4", workspacePath: "C:/cache/workspace",
    audioPath: "C:/cache/workspace/audio.wav", transcribedAssPath: "C:/media/input.transcribed.ass",
    translatedAssPath: "C:/media/input.translated.ass", burnAssPath: "C:/cache/workspace/burn.ass", sourceLang: "ja",
  });
  mocks.checkFfmpeg.mockResolvedValue({ available: true, source: "system" });
  mocks.pathExists.mockResolvedValue(true);
  mocks.listAsrEngines.mockImplementation(async () => engines());
  mocks.checkAsrModel.mockImplementation(async (engine, model) => ({
    engine, model, backend: engine === "qwen3-asr" ? "crispasr" : "ctranslate2",
    available: true, downloaded: true, disposition: "ready",
  }));
  mocks.probeRuntimeDependencies.mockImplementation(async () => probe());
  mocks.prepareRuntimeDependency.mockResolvedValue("runtime-job");
  mocks.getRuntimeDependencyProgress.mockImplementation(async () => {
    runtimeReady = true;
    return { id: "runtime-job", status: "completed", progress: 1 };
  });
  mocks.startAsr.mockResolvedValue({ jobId: "asr-job" });
  mocks.getAsrProgress.mockResolvedValue({ id: "asr-job", status: "failed", progress: 0, error: "合成任务结束" });
});
afterEach(cleanup);

async function mountRoute(route: typeof routes[number]) {
  mocks.getSettings.mockResolvedValue({ asrEngine: route.engine, asrModel: route.model, asrDevice: "cuda" });
  const user = userEvent.setup();
  const view = render(<TranscribeView />);
  const start = await screen.findByRole("button", { name: "开始转录" });
  await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
  return { user, view, start };
}

describe.each(routes)("$backend CUDA start dependency", (route) => {
  it("shows immediate feedback while the full dependency probe is pending", async () => {
    let resolveProbe!: (value: RuntimeDependencyProbe) => void;
    mocks.probeRuntimeDependencies.mockReturnValue(new Promise<RuntimeDependencyProbe>((resolve) => { resolveProbe = resolve; }));
    const { user, start } = await mountRoute(route);
    await user.click(start);
    const confirm = screen.getByRole("button", { name: "下载并继续" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("正在检测运行时依赖…")).toBeTruthy();
    expect(mocks.prepareRuntimeDependency).not.toHaveBeenCalled();
    await act(async () => resolveProbe(probe()));
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
  });
  it("opens the correct runtime confirmation from an actual Start click before consent", async () => {
    const { user, start } = await mountRoute(route);
    expect(screen.getByText("CUDA 运行时尚未安装，开始转录时可按提示下载")).toBeTruthy();
    await user.click(start);
    expect(await screen.findByRole("button", { name: "下载并继续" })).toBeTruthy();
    expect(screen.getByText(route.label)).toBeTruthy();
    expect(screen.getByText(route.path)).toBeTruthy();
    expect(screen.getByText(route.kind === "crispasrCuda" ? "686.4 MB" : "544.6 MB")).toBeTruthy();
    expect(mocks.probeRuntimeDependencies).toHaveBeenCalledTimes(1);
    expect(mocks.prepareRuntimeDependency).not.toHaveBeenCalled();
    expect(mocks.startAsr).not.toHaveBeenCalled();
  });

  it("prepares only the selected kind, shows progress, refreshes, and resumes once", async () => {
    mocks.getRuntimeDependencyProgress.mockResolvedValueOnce({ id: "runtime-job", status: "running", progress: 0.42 });
    const { user, start } = await mountRoute(route);
    await user.click(start);
    await user.click(await screen.findByRole("button", { name: "下载并继续" }));
    const progress = await screen.findByRole("progressbar", { name: "运行时依赖下载进度" });
    expect(progress.getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByRole("button", { name: "下载并继续" }).hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(mocks.startAsr).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(mocks.prepareRuntimeDependency).toHaveBeenCalledExactlyOnceWith({ kind: route.kind });
    expect(mocks.probeRuntimeDependencies).toHaveBeenCalledTimes(2);
    expect(mocks.listAsrEngines).toHaveBeenCalledTimes(2);
    expect(mocks.startAsr).toHaveBeenCalledWith(expect.objectContaining({ engine: route.engine, model: route.model, device: "cuda" }));
  });

  it("cancels consent without preparing or starting and allows a fresh retry", async () => {
    const { user, start } = await mountRoute(route);
    await user.click(start);
    await user.click(await screen.findByRole("button", { name: "取消" }));
    expect(mocks.prepareRuntimeDependency).not.toHaveBeenCalled();
    expect(mocks.startAsr).not.toHaveBeenCalled();
    await user.click(start);
    await user.click(await screen.findByRole("button", { name: "下载并继续" }));
    await waitFor(() => expect(mocks.startAsr).toHaveBeenCalledTimes(1));
  });

  it("reports a bounded probe rejection instead of an invisible unhandled promise", async () => {
    mocks.probeRuntimeDependencies.mockRejectedValueOnce(new Error("C:/private/path secret stderr"));
    const { user, start } = await mountRoute(route);
    await user.click(start);
    expect((await screen.findByRole("alert")).textContent).toBe("运行时依赖检测失败，请关闭后重试。");
    expect(screen.queryByText(/secret stderr/)).toBeNull();
    expect(screen.getByRole("button", { name: "下载并继续" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.prepareRuntimeDependency).not.toHaveBeenCalled();
    expect(mocks.startAsr).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(start);
    await waitFor(() => expect(screen.getByRole("button", { name: "下载并继续" }).hasAttribute("disabled")).toBe(false));
  });

  it("keeps failed preparation retryable without an unintended start", async () => {
    mocks.getRuntimeDependencyProgress.mockResolvedValueOnce({ id: "runtime-job", status: "failed", error: "private raw stderr" });
    const { user, start } = await mountRoute(route);
    await user.click(start);
    await user.click(await screen.findByRole("button", { name: "下载并继续" }));
    expect((await screen.findByRole("alert")).textContent).toBe("运行时依赖准备失败，请重试。");
    expect(mocks.startAsr).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "下载并继续" }));
    await waitFor(() => expect(mocks.startAsr).toHaveBeenCalledTimes(1));
    expect(mocks.prepareRuntimeDependency).toHaveBeenCalledTimes(2);
  });

  it("does not resume after cancelling an in-flight preparation", async () => {
    let finish!: (snapshot: { status: string; progress: number }) => void;
    mocks.getRuntimeDependencyProgress.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { user, start } = await mountRoute(route);
    await user.click(start);
    await user.click(await screen.findByRole("button", { name: "下载并继续" }));
    await waitFor(() => expect(mocks.getRuntimeDependencyProgress).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => { runtimeReady = true; finish({ status: "completed", progress: 1 }); });
    expect(mocks.startAsr).not.toHaveBeenCalled();
    expect(mocks.probeRuntimeDependencies).toHaveBeenCalledTimes(1);
    // Cancelling the continuation need not cancel the backend's resumable installation.
    await user.click(start);
    await waitFor(() => expect(mocks.startAsr).toHaveBeenCalledTimes(1));
    expect(mocks.prepareRuntimeDependency).toHaveBeenCalledTimes(1);
  });

  it("ignores a late probe after the user closes the dialog", async () => {
    let finish!: (value: RuntimeDependencyProbe) => void;
    mocks.probeRuntimeDependencies.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { user, start } = await mountRoute(route);
    await user.click(start);
    await user.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => { runtimeReady = true; finish(probe()); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.startAsr).not.toHaveBeenCalled();
  });

  it.each(["not downloadable", "engine error", "model error"])("blocks Start for %s", async (failure) => {
    mocks.getSettings.mockResolvedValue({ asrEngine: route.engine, asrModel: route.model, asrDevice: "cuda" });
    if (failure === "engine error") mocks.listAsrEngines.mockRejectedValue(new Error("引擎检测失败"));
    else if (failure === "model error") mocks.checkAsrModel.mockRejectedValue(new Error("模型检测失败"));
    else mocks.listAsrEngines.mockResolvedValue(engines().map((engine) => ({
      ...engine, devices: [{ device: "cpu", available: true }, { device: "cuda", available: false, downloadRequired: false, reason: "CUDA 不可用" }],
    })));
    const user = userEvent.setup();
    render(<TranscribeView />);
    await screen.findByText(failure === "not downloadable" ? "CUDA 不可用" : failure === "engine error" ? "引擎可用性检测失败：Error: 引擎检测失败" : "模型可用性检测失败：Error: 模型检测失败");
    const start = screen.getByRole("button", { name: "开始转录" });
    expect(start.hasAttribute("disabled")).toBe(true);
    await user.click(start);
    expect(mocks.prepareRuntimeDependency).not.toHaveBeenCalled();
    expect(mocks.startAsr).not.toHaveBeenCalled();
  });

  it("starts normally with an already ready CUDA runtime", async () => {
    runtimeReady = true;
    const { user, start } = await mountRoute(route);
    await user.click(start);
    await waitFor(() => expect(mocks.startAsr).toHaveBeenCalledTimes(1));
    expect(mocks.probeRuntimeDependencies).not.toHaveBeenCalled();
    expect(mocks.prepareRuntimeDependency).not.toHaveBeenCalled();
  });

  it("refreshes stale missing availability when the dependency probe finds CUDA ready", async () => {
    const { user, start } = await mountRoute(route);
    runtimeReady = true;
    await user.click(start);
    await waitFor(() => expect(mocks.startAsr).toHaveBeenCalledTimes(1));
    expect(mocks.listAsrEngines).toHaveBeenCalledTimes(2);
    expect(mocks.prepareRuntimeDependency).not.toHaveBeenCalled();
  });

  it("does not start if capability refresh still requires a CUDA download", async () => {
    const missingEngines = engines();
    mocks.listAsrEngines.mockResolvedValue(missingEngines);
    const { user, start } = await mountRoute(route);
    await user.click(start);
    await user.click(await screen.findByRole("button", { name: "下载并继续" }));
    await screen.findByText("当前转录路线不可用。");
    expect(mocks.startAsr).not.toHaveBeenCalled();
  });

  it("does not start when the selected runtime is no longer downloadable", async () => {
    mocks.probeRuntimeDependencies.mockImplementation(async () => ({
      ...probe(), items: probe().items.map((item) => ({ ...item, expectedDownloadBytes: undefined })),
    }));
    const { user, start } = await mountRoute(route);
    await user.click(start);
    await screen.findByText("当前运行时依赖不可下载，请重新检测可用性。");
    expect(screen.getByRole("button", { name: "下载并继续" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.prepareRuntimeDependency).not.toHaveBeenCalled();
    expect(mocks.startAsr).not.toHaveBeenCalled();
  });

  it("continues through the existing missing-model confirmation after installing runtime", async () => {
    let downloaded = false;
    mocks.checkAsrModel.mockImplementation(async (engine, model) => ({
      engine, model, backend: engine === "qwen3-asr" ? "crispasr" : "ctranslate2",
      available: true, downloaded, disposition: downloaded ? "ready" : "supportedMissing",
    }));
    mocks.downloadAsrModel.mockResolvedValue("model-job");
    mocks.getModelDownloadProgress.mockImplementation(async () => {
      downloaded = true;
      return { id: "model-job", status: "completed", downloadedBytes: 100, totalBytes: 100 };
    });
    const { user, start } = await mountRoute(route);
    await user.click(start);
    await user.click(await screen.findByRole("button", { name: "下载并继续" }));
    await screen.findByText("模型未下载，是否开始下载模型并转录");
    expect(mocks.downloadAsrModel).not.toHaveBeenCalled();
    expect(mocks.startAsr).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(mocks.startAsr).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(mocks.downloadAsrModel).toHaveBeenCalledExactlyOnceWith(route.engine, route.model);
  });

  it("discards the continuation after the subtitle document changes during installation", async () => {
    const { user, start } = await mountRoute(route);
    await user.click(start);
    await screen.findByRole("button", { name: "下载并继续" });
    act(() => useProjectStore.getState().setCues([]));
    await user.click(screen.getByRole("button", { name: "下载并继续" }));
    await screen.findByText("字幕或工作视频已发生变化，请重新开始转录。");
    expect(mocks.startAsr).not.toHaveBeenCalled();
  });
});
