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

  it("re-renders at the static pinned time when frame sync stops", async () => {
    const controller = fakeController();
    mocks.createDefaultLibassController.mockResolvedValue(controller);
    // 只验证注销/重绘时序：rVFC 存根不派发帧回调
    const video = document.createElement("video");
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn(() => 1),
    });
    Object.defineProperty(video, "cancelVideoFrameCallback", {
      configurable: true,
      value: vi.fn(),
    });

    const overlay = (followVideoFrames: boolean) => (
      <LibassSubtitleOverlay
        assText={DEFAULT_ASS}
        fontUrls={["https://example.com/font.woff2"]}
        availableFonts={{ ...DEFAULT_FONTS }}
        defaultFont="Noto Sans CJK JP"
        width={1920}
        height={1080}
        renderTimeMs={1}
        videoElement={video}
        followVideoFrames={followVideoFrames}
        onUnavailable={stableOnUnavailable}
      />
    );

    const { rerender } = render(overlay(true));
    await vi.waitFor(() =>
      expect(vi.mocked(controller.render)).toHaveBeenCalledTimes(1),
    );

    // 暂停（followVideoFrames 翻 false）：帧同步注销后画布停留在最后视频帧
    // （段播停点的边界帧已属于下一句），且钉帧 renderTimeMs 未变、静态渲染
    // 效应不触发——必须在此时按静态时间补一次重绘
    rerender(overlay(false));
    await vi.waitFor(() =>
      expect(vi.mocked(controller.render).mock.calls.length).toBeGreaterThan(1),
    );
    expect(vi.mocked(controller.render)).toHaveBeenLastCalledWith(1, 1920, 1080);
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
