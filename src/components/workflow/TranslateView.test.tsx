// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultScriptInfo, createDefaultStyles, parseAss, serializeAss } from "@/lib/ass";
import { makeVideoSession } from "@/test-utils/videoSession";
import type { AppSettings } from "@/types";
import type { TranslationResult } from "@/services/translation";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useUiStore } from "../../stores/uiStore";
import { TranslateView } from "./TranslateView";
import { createTranslationProvider } from "@/services/translation";
import {
  getSettings,
  loadAssText,
  pathExists,
  saveAssText,
} from "../../services/tauri";
import { confirmDiscardUnsavedChanges } from "../../services/unsavedChanges";

vi.mock("@/services/translation", () => ({
  createTranslationProvider: vi.fn(),
}));

vi.mock("../../services/tauri", () => ({
  getSettings: vi.fn(),
  loadAssText: vi.fn(),
  pathExists: vi.fn(),
  saveAssText: vi.fn(),
}));

vi.mock("../../services/unsavedChanges", () => ({
  confirmDiscardUnsavedChanges: vi.fn(),
}));

vi.mock("../../services/subtitleRecovery", () => ({
  withDiscardedSubtitleRecovery: vi.fn(
    async (_videoPath: string | null, replaceDocument: () => unknown) =>
      replaceDocument(),
  ),
}));

const session = makeVideoSession();
const sourceDoc = {
  scriptInfo: createDefaultScriptInfo("test"),
  styles: createDefaultStyles(),
  cues: [
    {
      id: "a",
      startMs: 0,
      endMs: 1000,
      primaryText: "source-a",
      style: "Primary",
      layer: 0,
    },
    {
      id: "b",
      startMs: 1000,
      endMs: 2000,
      primaryText: "source-b",
      style: "Primary",
      layer: 0,
    },
  ],
};
const sourceAss = serializeAss(sourceDoc, { preserveOrder: true });
const sourceCues = parseAss(sourceAss, { mergeBilingual: false }).cues;

const settings: AppSettings = {
  asrEngine: "faster-whisper",
  asrModel: "synthetic",
  asrDevice: "cpu",
  translationProviders: [
    {
      id: "provider",
      name: "Provider",
      apiType: "openai-compatible",
      baseUrl: "https://api.example.invalid/v1",
      apiKey: "synthetic-key",
      model: "synthetic-model",
      temperature: 0.7,
      maxConcurrency: 1,
      requestsPerMinute: 10,
    },
  ],
  defaultTranslationProviderId: "provider",
  defaultSourceLang: "ja",
  defaultTargetLang: "zh-CN",
  translationBatchSize: 2,
  translationContextWindow: 0,
  subtitleMergeMode: "inline",
  subtitleTextOrder: "translation-first",
  editorHotkeys: [],
};

function translationResult(
  translations: Array<string | undefined>,
  options: { cancelled?: boolean; errors?: string[] } = {},
): TranslationResult {
  const cues = sourceCues.map((cue, index) => ({
    ...cue,
    secondaryText: translations[index],
  }));
  const successCount = cues.filter((cue) => cue.secondaryText).length;
  return {
    cues,
    successCount,
    failedCount: cues.length - successCount,
    errors: options.errors ?? [],
    cancelled: options.cancelled ?? false,
  };
}

function resetStores() {
  useProjectStore.setState(useProjectStore.getInitialState());
  useProjectStore.getState().setSession(session);
  useProjectStore.setState({
    assScriptInfo: sourceDoc.scriptInfo,
    assStyles: sourceDoc.styles,
  });
  useTaskStore.setState(useTaskStore.getInitialState());
  useUiStore.setState(useUiStore.getInitialState());
}

async function renderReady() {
  render(<TranslateView />);
  await screen.findByRole("button", { name: "开始翻译" });
  await waitFor(() => {
    expect(
      (screen.getByRole("button", { name: "开始翻译" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
}

beforeEach(() => {
  resetStores();
  vi.mocked(getSettings).mockResolvedValue(settings);
  vi.mocked(pathExists).mockResolvedValue(true);
  vi.mocked(loadAssText).mockResolvedValue(sourceAss);
  vi.mocked(saveAssText).mockResolvedValue();
  vi.mocked(confirmDiscardUnsavedChanges).mockResolvedValue({
    proceed: true,
    recoveryVideoPath: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TranslateView", () => {
  it("allows content taller than the workspace to scroll", () => {
    const { container } = render(<TranslateView />);
    const page = container.firstElementChild as HTMLElement;

    expect(page.classList.contains("min-h-0")).toBe(true);
    expect(page.classList.contains("overflow-y-auto")).toBe(true);
    expect(page.classList.contains("overflow-x-hidden")).toBe(true);
  });

  it("does not start after the discard confirmation sees a changed document", async () => {
    const translateBatch = vi.fn();
    vi.mocked(createTranslationProvider).mockReturnValue({
      translateBatch,
    } as unknown as ReturnType<typeof createTranslationProvider>);
    vi.mocked(confirmDiscardUnsavedChanges).mockImplementation(async () => {
      useProjectStore.getState().setCues([sourceCues[0]]);
      return { proceed: true, recoveryVideoPath: null };
    });
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole("button", { name: "开始翻译" }));

    expect(await screen.findByText("操作失败")).toBeTruthy();
    expect(
      screen.getByText("字幕或工作视频已发生变化，已放弃本次翻译结果"),
    ).toBeTruthy();
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it("shows a failed state when no cue was translated", async () => {
    const translateBatch = vi.fn().mockResolvedValue(
      translationResult([undefined, undefined], {
        errors: ["批次 1 失败: API 错误 401: invalid API key"],
      }),
    );
    vi.mocked(createTranslationProvider).mockReturnValue({
      translateBatch,
    } as unknown as ReturnType<typeof createTranslationProvider>);
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole("button", { name: "开始翻译" }));

    expect(createTranslationProvider).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.7 }),
    );
    expect(await screen.findByText("翻译失败")).toBeTruthy();
    expect(screen.queryByText("翻译部分完成")).toBeNull();
    expect(screen.getByText("成功 0 条、失败 2 条")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "保存当前结果" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(useTaskStore.getState().tasks.translate).toMatchObject({
      status: "error",
      message: "翻译失败：成功 0 条，失败 2 条",
    });
    expect(saveAssText).not.toHaveBeenCalled();
  });

  it("shows partial results without applying or saving them", async () => {
    const translateBatch = vi
      .fn()
      .mockResolvedValue(
        translationResult(["translated-a", undefined], {
          errors: ["批次 1 条目 2 失败: 网络请求失败"],
        }),
      );
    vi.mocked(createTranslationProvider).mockReturnValue({
      translateBatch,
    } as unknown as ReturnType<typeof createTranslationProvider>);
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole("button", { name: "开始翻译" }));

    expect(await screen.findByText("翻译部分完成")).toBeTruthy();
    expect(screen.getByText("成功 1 条、失败 1 条")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试失败条目" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存当前结果" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "进入编辑" })).toBeNull();
    expect(saveAssText).not.toHaveBeenCalled();
    expect(useProjectStore.getState().cues).toEqual([]);

    await user.click(screen.getByText("查看失败原因"));
    expect(screen.getByText("批次 1 条目 2 失败: 网络请求失败")).toBeTruthy();
  });

  it("retries only untranslated cues and merges the result", async () => {
    const translateBatch = vi
      .fn()
      .mockResolvedValueOnce(translationResult(["translated-a", undefined]))
      .mockImplementationOnce(async (cues) => ({
        cues: cues.map((cue: (typeof sourceCues)[number]) => ({
          ...cue,
          secondaryText: "translated-b",
        })),
        successCount: 1,
        failedCount: 0,
        errors: [],
        cancelled: false,
      }));
    vi.mocked(createTranslationProvider).mockReturnValue({
      translateBatch,
    } as unknown as ReturnType<typeof createTranslationProvider>);
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole("button", { name: "开始翻译" }));
    await user.click(await screen.findByRole("button", { name: "重试失败条目" }));

    await waitFor(() => expect(translateBatch).toHaveBeenCalledTimes(2));
    expect(
      (translateBatch.mock.calls[1][0] as typeof sourceCues).map(
        (cue) => cue.id,
      ),
    ).toEqual([
      sourceCues[1].id,
    ]);
    await waitFor(() => expect(saveAssText).toHaveBeenCalledTimes(1));
    expect(useProjectStore.getState().cues[0].primaryText).toContain(
      "translated-a",
    );
    expect(useProjectStore.getState().cues[1].primaryText).toContain(
      "translated-b",
    );
    expect(screen.getByRole("button", { name: "进入编辑" })).toBeTruthy();
  });

  it("cancels the active signal and keeps the returned partial result", async () => {
    const translateBatch = vi.fn(
      async (
        _cues: typeof sourceCues,
        options: { signal?: AbortSignal },
      ): Promise<TranslationResult> =>
        new Promise((resolve) => {
          options.signal?.addEventListener(
            "abort",
            () =>
              resolve(
                translationResult(["translated-a", undefined], {
                  cancelled: true,
                }),
              ),
            { once: true },
          );
        }),
    );
    vi.mocked(createTranslationProvider).mockReturnValue({
      translateBatch,
    } as unknown as ReturnType<typeof createTranslationProvider>);
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole("button", { name: "开始翻译" }));
    await user.click(await screen.findByRole("button", { name: "取消翻译" }));

    expect(await screen.findByText("翻译已取消")).toBeTruthy();
    expect(screen.getByText("成功 1 条、失败 1 条")).toBeTruthy();
    expect(saveAssText).not.toHaveBeenCalled();
    expect(useProjectStore.getState().cues).toEqual([]);
  });

  it("does not auto-save when cancellation races with the final response", async () => {
    let resolveTranslation!: (result: TranslationResult) => void;
    const translateBatch = vi.fn(
      () =>
        new Promise<TranslationResult>((resolve) => {
          resolveTranslation = resolve;
        }),
    );
    vi.mocked(createTranslationProvider).mockReturnValue({
      translateBatch,
    } as unknown as ReturnType<typeof createTranslationProvider>);
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole("button", { name: "开始翻译" }));
    await user.click(await screen.findByRole("button", { name: "取消翻译" }));
    await act(async () => {
      resolveTranslation(translationResult(["translated-a", "translated-b"]));
    });

    expect(await screen.findByText("翻译已取消")).toBeTruthy();
    expect(saveAssText).not.toHaveBeenCalled();
    expect(useProjectStore.getState().cues).toEqual([]);
  });

  it("explicitly saves an incomplete result and enables the editor", async () => {
    const translateBatch = vi
      .fn()
      .mockResolvedValue(translationResult(["translated-a", undefined]));
    vi.mocked(createTranslationProvider).mockReturnValue({
      translateBatch,
    } as unknown as ReturnType<typeof createTranslationProvider>);
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole("button", { name: "开始翻译" }));
    await user.click(await screen.findByRole("button", { name: "保存当前结果" }));

    await waitFor(() => expect(saveAssText).toHaveBeenCalledTimes(1));
    expect(confirmDiscardUnsavedChanges).toHaveBeenCalledTimes(2);
    expect(useProjectStore.getState().cues).toHaveLength(2);
    expect(useProjectStore.getState().activeSubtitlePath).toBe(
      session.translatedAssPath,
    );
    expect(screen.getByRole("button", { name: "进入编辑" })).toBeTruthy();
  });

  it("aborts on session switch and clears the running task", async () => {
    let signal: AbortSignal | undefined;
    const translateBatch = vi.fn(
      async (
        _cues: typeof sourceCues,
        options: { signal?: AbortSignal },
      ): Promise<TranslationResult> => {
        signal = options.signal;
        return new Promise(() => undefined);
      },
    );
    vi.mocked(createTranslationProvider).mockReturnValue({
      translateBatch,
    } as unknown as ReturnType<typeof createTranslationProvider>);
    const user = userEvent.setup();
    await renderReady();
    await user.click(screen.getByRole("button", { name: "开始翻译" }));

    act(() => {
      useProjectStore.getState().setSession(makeVideoSession("next"));
    });

    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(useTaskStore.getState().tasks.translate.status).toBe("idle");
  });

  it("aborts on unmount and clears the running task", async () => {
    let signal: AbortSignal | undefined;
    const translateBatch = vi.fn(
      async (
        _cues: typeof sourceCues,
        options: { signal?: AbortSignal },
      ): Promise<TranslationResult> => {
        signal = options.signal;
        return new Promise(() => undefined);
      },
    );
    vi.mocked(createTranslationProvider).mockReturnValue({
      translateBatch,
    } as unknown as ReturnType<typeof createTranslationProvider>);
    const user = userEvent.setup();
    const view = render(<TranslateView />);
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "开始翻译" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });
    await user.click(screen.getByRole("button", { name: "开始翻译" }));

    view.unmount();

    expect(signal?.aborted).toBe(true);
    expect(useTaskStore.getState().tasks.translate.status).toBe("idle");

    render(<TranslateView />);
    expect(
      await screen.findByText("翻译已取消，不会在后台继续运行"),
    ).toBeTruthy();
  });
});
