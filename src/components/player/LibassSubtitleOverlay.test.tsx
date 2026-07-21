// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibassController } from "../../services/libassPreview";

const mocks = vi.hoisted(() => ({
  createDefaultLibassController: vi.fn(),
}));

vi.mock("../../services/libassPreview", () => ({
  createDefaultLibassController: mocks.createDefaultLibassController,
}));

import { LibassSubtitleOverlay } from "./LibassSubtitleOverlay";

const DEFAULT_ASS =
  "[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,テスト";
const DEFAULT_FONTS = {
  "noto sans cjk jp": "https://example.com/font.woff2",
};
const stableOnUnavailable = vi.fn();

function fakeController(): LibassController {
  return {
    setAssText: vi.fn().mockResolvedValue(undefined),
    render: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

function renderOverlay(
  availableFonts: Record<string, string>,
  assText: string = DEFAULT_ASS,
) {
  return (
    <LibassSubtitleOverlay
      assText={assText}
      fontUrls={["https://example.com/font.woff2"]}
      availableFonts={availableFonts}
      defaultFont="Noto Sans CJK JP"
      width={1920}
      height={1080}
      renderTimeMs={1}
      onUnavailable={stableOnUnavailable}
    />
  );
}

describe("LibassSubtitleOverlay", () => {
  beforeEach(() => {
    stableOnUnavailable.mockClear();
    mocks.createDefaultLibassController.mockReset();
    mocks.createDefaultLibassController.mockResolvedValue(fakeController());
  });

  it("keeps the renderer alive when font props change identity but not content", async () => {
    const controller = fakeController();
    mocks.createDefaultLibassController.mockResolvedValue(controller);

    const { container, rerender } = render(renderOverlay({ ...DEFAULT_FONTS }));
    await vi.waitFor(() =>
      expect(mocks.createDefaultLibassController).toHaveBeenCalledTimes(1),
    );
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeTruthy();

    // 模拟编辑字幕时父级重建的同内容 font 选择对象
    rerender(renderOverlay({ ...DEFAULT_FONTS }));

    expect(mocks.createDefaultLibassController).toHaveBeenCalledTimes(1);
    expect(controller.destroy).not.toHaveBeenCalled();
    expect(container.querySelector("canvas")).toBe(canvas);
  });

  it("rebuilds the renderer when font content actually changes", async () => {
    const { rerender } = render(renderOverlay({ ...DEFAULT_FONTS }));
    await vi.waitFor(() =>
      expect(mocks.createDefaultLibassController).toHaveBeenCalledTimes(1),
    );

    rerender(
      renderOverlay({ "noto sans cjk jp": "https://example.com/other.woff2" }),
    );

    await vi.waitFor(() =>
      expect(mocks.createDefaultLibassController).toHaveBeenCalledTimes(2),
    );
  });

  it("coalesces rapid assText updates to the latest one", async () => {
    let releaseSetTrack: (() => void) | null = null;
    const controller = fakeController();
    controller.setAssText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSetTrack = resolve;
        }),
    );
    mocks.createDefaultLibassController.mockResolvedValue(controller);

    const { rerender } = render(renderOverlay({ ...DEFAULT_FONTS }, "text-1"));
    await vi.waitFor(() =>
      expect(controller.render).toHaveBeenCalledTimes(1),
    );

    // 第一次编辑：setTrack 在途
    rerender(renderOverlay({ ...DEFAULT_FONTS }, "text-2"));
    await vi.waitFor(() =>
      expect(controller.setAssText).toHaveBeenCalledWith("text-2"),
    );

    // 在途期间的连续击键只应保留最新文本
    rerender(renderOverlay({ ...DEFAULT_FONTS }, "text-3"));
    rerender(renderOverlay({ ...DEFAULT_FONTS }, "text-4"));
    releaseSetTrack!();

    await vi.waitFor(() =>
      expect(controller.setAssText).toHaveBeenCalledTimes(2),
    );
    expect(controller.setAssText).toHaveBeenLastCalledWith("text-4");
    expect(controller.setAssText).not.toHaveBeenCalledWith("text-3");
  });

  it("reports setTrack failures from the coalescing loop", async () => {
    let rejectSetTrack: ((err: Error) => void) | null = null;
    const controller = fakeController();
    controller.setAssText = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectSetTrack = reject;
        }),
    );
    mocks.createDefaultLibassController.mockResolvedValue(controller);

    const { rerender } = render(renderOverlay({ ...DEFAULT_FONTS }, "text-1"));
    await vi.waitFor(() => expect(controller.render).toHaveBeenCalledTimes(1));

    // 击键 1 启动合并循环，击键 2 触发上一次 effect 的 cleanup 后仅置 pending
    rerender(renderOverlay({ ...DEFAULT_FONTS }, "text-2"));
    await vi.waitFor(() =>
      expect(controller.setAssText).toHaveBeenCalledWith("text-2"),
    );
    rerender(renderOverlay({ ...DEFAULT_FONTS }, "text-3"));

    // 在途 setTrack 失败：即使 effect 已因后续击键 cleanup，也必须上报以触发 CSS fallback
    rejectSetTrack!(new Error("boom"));

    await vi.waitFor(() =>
      expect(stableOnUnavailable).toHaveBeenCalledWith("Error: boom"),
    );
  });
});
