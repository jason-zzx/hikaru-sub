// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "../src/components/workflow/SettingsView";
import * as tauri from "../src/services/tauri";
import { useUiStore } from "../src/stores/uiStore";

vi.mock("../src/services/tauri");

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  useUiStore.setState({ settingsCategory: "runtime" });
  vi.mocked(tauri.getSettings).mockResolvedValue({
    asrEngine: "faster-whisper", asrModel: "synthetic", asrDevice: "cpu",
    translationProviders: [], defaultSourceLang: "ja", defaultTargetLang: "zh-CN",
    translationBatchSize: 25, translationContextWindow: 2,
    subtitleMergeMode: "inline", subtitleTextOrder: "translation-first", editorHotkeys: [],
  });
  vi.mocked(tauri.checkFfmpeg).mockResolvedValue({ available: false, path: "", source: "system" });
  vi.mocked(tauri.probeRuntimeDependencies).mockResolvedValue({ items: [], sourceMode: "official" });
  vi.mocked(tauri.measureRuntimeDependencyStorage).mockResolvedValue({
    items: [{ kind: "legacyPython", managed: true, sizeBytes: 1024 }],
  });
});

describe("Settings legacy Python cleanup", () => {
  it("requires measurement and confirmation, then refreshes away the removed residue", async () => {
    render(<SettingsView />);
    await screen.findByRole("button", { name: "计算占用空间" });
    expect(tauri.measureRuntimeDependencyStorage).not.toHaveBeenCalled();
    expect(screen.queryByText("旧版 Python 转录环境")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "计算占用空间" }));
    await userEvent.click(await screen.findByRole("button", { name: "清理" }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/保留模型和当前运行依赖，不影响系统 Python/)).toBeTruthy();
    expect(within(dialog).queryByText(/再次使用需要重新安装/)).toBeNull();
    expect(tauri.cleanupRuntimeDependency).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(tauri.cleanupRuntimeDependency).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "清理" }));
    dialog = screen.getByRole("dialog");
    vi.mocked(tauri.measureRuntimeDependencyStorage).mockResolvedValue({ items: [] });
    await userEvent.click(within(dialog).getByRole("button", { name: "确认清理" }));
    await waitFor(() => expect(screen.queryByText("旧版 Python 转录环境")).toBeNull());
    expect(tauri.cleanupRuntimeDependency).toHaveBeenCalledExactlyOnceWith("legacyPython", { preserveVideoPath: null });
    expect(tauri.measureRuntimeDependencyStorage).toHaveBeenCalledTimes(2);
    expect(tauri.prepareRuntimeDependency).not.toHaveBeenCalled();
  });

  it("keeps the residue and retry action visible when cleanup fails", async () => {
    vi.mocked(tauri.cleanupRuntimeDependency).mockRejectedValue(new Error("旧环境正在使用"));
    render(<SettingsView />);
    await userEvent.click(await screen.findByRole("button", { name: "计算占用空间" }));
    await userEvent.click(await screen.findByRole("button", { name: "清理" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认清理" }));
    expect(await screen.findByText(/清理失败.*旧环境正在使用/)).toBeTruthy();
    expect(screen.getByText("旧版 Python 转录环境")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "确认清理" }).hasAttribute("disabled")).toBe(false);
  });
});
