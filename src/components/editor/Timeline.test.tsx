// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractWaveform } from "../../services/tauri";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useProjectStore } from "../../stores/projectStore";
import type { SubtitleCue, WaveformData } from "../../types";
import { Timeline } from "./Timeline";

// Timeline 经 services/tauri 门面取波形，不再直连 invoke
vi.mock("../../services/tauri", () => ({
  extractWaveform: vi.fn().mockResolvedValue({ peaks: [], coveredMs: 0 }),
}));

// fixed 层与 lane 层拆分为独立效应后，按 canvas 实例区分 context mock，
// 以便断言边界变化只重绘 lane 层
function createContextMock() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    strokeRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    setLineDash: vi.fn(),
  };
}

type ContextMock = ReturnType<typeof createContextMock>;

const canvasContexts = new WeakMap<HTMLCanvasElement, ContextMock>();

function contextFor(canvas: HTMLCanvasElement): ContextMock {
  let ctx = canvasContexts.get(canvas);
  if (!ctx) {
    ctx = createContextMock();
    canvasContexts.set(canvas, ctx);
  }
  return ctx;
}

const capturedPointers = new WeakMap<HTMLCanvasElement, Set<number>>();

// getBoundingClientRect mock 的容器宽度：resize 测试中可变
let mockLayoutWidth = 1000;

function cue(id: string, startMs: number, endMs: number): SubtitleCue {
  return {
    id,
    startMs,
    endMs,
    primaryText: id,
    style: "Primary",
    layer: 0,
  };
}

function reset(selectedIds: string[] = ["a"]) {
  const cues = [cue("a", 1000, 2000), cue("b", 4000, 5000)];
  useProjectStore.setState({
    ...useProjectStore.getInitialState(),
    cues,
  });
  usePlaybackStore.setState({
    ...usePlaybackStore.getInitialState(),
    currentTimeMs: 0,
    durationMs: 10000,
    selectedCueIds: selectedIds,
    selectedCueId: selectedIds[selectedIds.length - 1] ?? null,
    fps: 25,
  });
}

function renderTimeline(onCommitPendingTimeDraft = vi.fn()) {
  const originalUpdateCue = useProjectStore.getState().updateCue;
  const updateCue = vi.fn(originalUpdateCue);
  useProjectStore.setState({ updateCue });
  const result = render(
    <div style={{ width: 1000, height: 226 }}>
      <Timeline onCommitPendingTimeDraft={onCommitPendingTimeDraft} />
    </div>,
  );
  const [fixed, lane] = Array.from(result.container.querySelectorAll("canvas"));
  return {
    ...result,
    fixed,
    lane,
    fixedCtx: contextFor(fixed),
    laneCtx: contextFor(lane),
    updateCue,
    onCommitPendingTimeDraft,
  };
}

function pointer(type: "down" | "move" | "up", canvas: HTMLCanvasElement, x: number, y: number) {
  const init = { pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y };
  if (type === "down") fireEvent.pointerDown(canvas, init);
  if (type === "move") fireEvent.pointerMove(canvas, init);
  if (type === "up") fireEvent.pointerUp(canvas, init);
}

beforeEach(() => {
  reset();
  mockLayoutWidth = 1000;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return contextFor(this) as unknown as CanvasRenderingContext2D;
    },
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const height = this instanceof HTMLCanvasElement ? 226 : 226;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: mockLayoutWidth,
        bottom: height,
        width: mockLayoutWidth,
        height,
        toJSON: () => ({}),
      };
    },
  );
  Object.defineProperties(HTMLCanvasElement.prototype, {
    setPointerCapture: {
      configurable: true,
      value(pointerId: number) {
        const pointers = capturedPointers.get(this) ?? new Set<number>();
        pointers.add(pointerId);
        capturedPointers.set(this, pointers);
      },
    },
    hasPointerCapture: {
      configurable: true,
      value(pointerId: number) {
        return capturedPointers.get(this)?.has(pointerId) ?? false;
      },
    },
    releasePointerCapture: {
      configurable: true,
      value(pointerId: number) {
        capturedPointers.get(this)?.delete(pointerId);
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Timeline playback cue styling", () => {
  it("keeps the cue under the playhead highlighted while paused", () => {
    // 高亮改由 activeCueIds（activeCueTracker 维护）驱动，不再按帧读 currentTimeMs
    usePlaybackStore.setState({
      currentTimeMs: 4500,
      isPlaying: false,
      activeCueIds: ["b"],
    });

    const { laneCtx } = renderTimeline();

    expect(laneCtx.strokeRect).toHaveBeenCalled();
  });
});

describe("Timeline layered redraw", () => {
  it("redraws only the lane layer when activeCueIds changes", async () => {
    // 波形加载后再触发边界变化，确保 fixed 层的波形聚合循环可被观测
    vi.mocked(extractWaveform).mockResolvedValueOnce({
      peaks: [0.5, 0.8, 0.2, 0.6],
      coveredMs: 10_000,
    });
    useProjectStore.setState({ videoPath: "C:/video.mp4" });
    const { fixedCtx, laneCtx } = renderTimeline();
    await act(async () => {});

    fixedCtx.clearRect.mockClear();
    fixedCtx.beginPath.mockClear();
    laneCtx.clearRect.mockClear();
    laneCtx.fillRect.mockClear();

    act(() => {
      usePlaybackStore.getState().setActiveCueIds(["b"]);
    });

    // lane 层按边界频率重绘
    expect(laneCtx.clearRect).toHaveBeenCalled();
    expect(laneCtx.fillRect).toHaveBeenCalled();
    // fixed 层（含波形逐像素聚合）不得因字幕边界重绘
    expect(fixedCtx.clearRect).not.toHaveBeenCalled();
    expect(fixedCtx.beginPath).not.toHaveBeenCalled();
  });

  it("keeps the lane layer untouched when only waveform gain changes", () => {
    const { fixed, fixedCtx, laneCtx } = renderTimeline();
    fixedCtx.clearRect.mockClear();
    laneCtx.clearRect.mockClear();

    fireEvent.wheel(fixed, { shiftKey: true, deltaY: -100 });

    expect(fixedCtx.clearRect).toHaveBeenCalled();
    expect(laneCtx.clearRect).not.toHaveBeenCalled();
  });
});

describe("Timeline transient playhead", () => {
  it("renders a playhead div and moves it via store subscription without redraw", () => {
    const { container, fixedCtx, laneCtx } = renderTimeline();
    const playhead = container.querySelector<HTMLDivElement>(
      '[data-testid="timeline-playhead"]',
    );
    if (!playhead) throw new Error("playhead div missing");

    fixedCtx.clearRect.mockClear();
    laneCtx.clearRect.mockClear();
    usePlaybackStore.getState().setCurrentTime(2000);

    // x = 2000ms / 10(msPerPixel) = 200，2px 竖线取中 → 199px
    expect(playhead.style.transform).toBe("translateX(199px)");
    expect(playhead.style.visibility).toBe("visible");
    // 播放回写不触发任一 canvas 层重绘（无 React 重渲染路径）
    expect(fixedCtx.clearRect).not.toHaveBeenCalled();
    expect(laneCtx.clearRect).not.toHaveBeenCalled();
  });

  it("hides the playhead when the time falls outside the viewport without paging", () => {
    const { container } = renderTimeline();
    const playhead = container.querySelector<HTMLDivElement>(
      '[data-testid="timeline-playhead"]',
    );
    if (!playhead) throw new Error("playhead div missing");

    // durationMs=10000、视口 [0, 10000]：翻页判定收在 durationMs 内，越界时间只隐藏
    usePlaybackStore.getState().setCurrentTime(-100);
    expect(playhead.style.visibility).toBe("hidden");
  });
});

describe("Timeline container resize", () => {
  it("redraws both canvas layers when the container width changes", () => {
    // mock ResizeObserver：记录回调，测试内手动触发宽度变化
    const resizeCallbacks: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(() =>
            callback([], this as unknown as ResizeObserver),
          );
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    const { fixed, lane, fixedCtx, laneCtx } = renderTimeline();
    expect(fixed.style.width).toBe("1000px");
    fixedCtx.clearRect.mockClear();
    laneCtx.clearRect.mockClear();

    act(() => {
      mockLayoutWidth = 600;
      resizeCallbacks.forEach((notify) => notify());
    });

    // 两层 canvas 都按新宽度重铺（旧实现只更新 ref，无重绘 → 拉伸/留白 + 命中错位）
    expect(fixedCtx.clearRect).toHaveBeenCalled();
    expect(laneCtx.clearRect).toHaveBeenCalled();
    expect(fixed.style.width).toBe("600px");
    expect(lane.style.width).toBe("600px");
  });
});

describe("Timeline waveform load race", () => {
  it("discards a stale waveform response after switching videos", async () => {
    let resolveFirst!: (value: WaveformData) => void;
    vi.mocked(extractWaveform)
      .mockImplementationOnce(
        () =>
          new Promise<WaveformData>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ peaks: [0.2, 0.9, 0.2, 0.9], coveredMs: 10_000 });
    useProjectStore.setState({ videoPath: "C:/a.mp4" });

    const { fixedCtx } = renderTimeline();
    // 挂载即发起 A 的请求（悬挂）；快速换片 → A 被置 stale，随后发起 B
    act(() => {
      useProjectStore.setState({ videoPath: "C:/b.mp4" });
    });
    await act(async () => {});
    // B 的波形已绘制
    expect(fixedCtx.beginPath).toHaveBeenCalled();

    fixedCtx.clearRect.mockClear();
    fixedCtx.beginPath.mockClear();
    await act(async () => {
      resolveFirst({ peaks: [1, 1, 1, 1], coveredMs: 10_000 });
    });

    // 迟到的 A 响应被丢弃：waveform 状态未变，无任何重绘
    expect(fixedCtx.clearRect).not.toHaveBeenCalled();
    expect(fixedCtx.beginPath).not.toHaveBeenCalled();
  });

  it("clears the previous waveform immediately when the video changes", async () => {
    vi.mocked(extractWaveform)
      .mockResolvedValueOnce({ peaks: [0.3, 0.9, 0.3, 0.9], coveredMs: 10_000 })
      .mockImplementationOnce(() => new Promise<WaveformData>(() => {}));
    useProjectStore.setState({ videoPath: "C:/a.mp4" });

    const { fixedCtx } = renderTimeline();
    await act(async () => {});
    expect(fixedCtx.beginPath).toHaveBeenCalled();

    fixedCtx.clearRect.mockClear();
    fixedCtx.beginPath.mockClear();
    act(() => {
      useProjectStore.setState({ videoPath: "C:/b.mp4" });
    });

    // 进入效应先重置：B 尚未返回时立即重绘为空波形，不残留 A 的波形
    expect(fixedCtx.clearRect).toHaveBeenCalled();
    expect(fixedCtx.beginPath).not.toHaveBeenCalled();
  });
});

describe("Timeline waveform sampling", () => {
  it.each([
    [10_000, 4000],
    [600_000, 60_000],
    [100_000_000, 720_000],
  ])(
    "requests duration-scaled samples (%i ms -> %i buckets)",
    async (durationMs, samples) => {
      vi.mocked(extractWaveform).mockClear();
      useProjectStore.setState({ videoPath: "C:/video.mp4" });
      usePlaybackStore.setState({ durationMs });

      renderTimeline();

      expect(extractWaveform).toHaveBeenCalledWith("C:/video.mp4", samples);
      // 吸收 mock 的异步 setWaveform，避免 act 警告
      await act(async () => {});
    },
  );
});

describe("Timeline waveform time mapping", () => {
  it("maps peaks by coveredMs instead of container duration", async () => {
    // HLS 合并产物：容器标称 durationMs=10000，实际解码只覆盖 coveredMs=5000。
    // 峰值桶 50/100 覆盖 [2500, 2550)ms → 像素列 250–254（msPerPixel=10）；
    // 若误按 durationMs 均摊会落到 500–509，且波形折线会铺满到 x=999。
    const peaks = Array<number>(100).fill(0.1);
    peaks[50] = 1.0;
    vi.mocked(extractWaveform).mockResolvedValueOnce({ peaks, coveredMs: 5000 });
    useProjectStore.setState({ videoPath: "C:/video.mp4" });

    const { fixedCtx } = renderTimeline();
    fixedCtx.moveTo.mockClear();
    fixedCtx.lineTo.mockClear();
    await act(async () => {});

    const points = [
      ...fixedCtx.moveTo.mock.calls,
      ...fixedCtx.lineTo.mock.calls,
    ] as [number, number][];
    expect(points.length).toBeGreaterThan(0);
    // 波形折线止于 coveredMs（500 列 → x 0..499），coveredMs 之后留空白
    expect(Math.max(...points.map(([x]) => x))).toBeLessThan(500);
    // 上下包络偏离中线（y = WAVE_TOP + WAVE_HEIGHT/2 = 82）的列即脉冲位置
    const pulseXs = points
      .filter(([, y]) => Math.abs(y - 82) > 1)
      .map(([x]) => x);
    expect(pulseXs.length).toBeGreaterThan(0);
    expect(Math.min(...pulseXs)).toBeGreaterThanOrEqual(249);
    expect(Math.max(...pulseXs)).toBeLessThanOrEqual(256);
  });
});

describe("Timeline waveform gain", () => {
  it("adjusts session gain with shift+wheel and draws the ×N.N label", () => {
    const { fixed, fixedCtx, container } = renderTimeline();
    fixedCtx.fillText.mockClear();

    fireEvent.wheel(fixed, { shiftKey: true, deltaY: -100 });

    // 1 × 1.25 = 1.25 → 标签 ×1.3
    expect(fixedCtx.fillText).toHaveBeenCalledWith(
      "×1.3",
      expect.any(Number),
      expect.any(Number),
    );
    expect(container.textContent).toContain(
      "波形区滚轮平移 · Shift+滚轮波形增益 · Ctrl+滚轮缩放",
    );
  });

  it("supports platforms that fold shift+wheel into deltaX", () => {
    const { fixed, fixedCtx } = renderTimeline();
    fixedCtx.fillText.mockClear();

    fireEvent.wheel(fixed, { shiftKey: true, deltaY: 0, deltaX: -100 });

    expect(fixedCtx.fillText).toHaveBeenCalledWith(
      "×1.3",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("does not pan the view while shift-adjusting gain", () => {
    const { fixed, fixedCtx, container } = renderTimeline();
    const playhead = container.querySelector<HTMLDivElement>(
      '[data-testid="timeline-playhead"]',
    );
    if (!playhead) throw new Error("playhead div missing");
    expect(playhead.style.visibility).toBe("visible");

    // Shift 分支只调增益：视口不平移，播放头（0ms）仍在视区内
    fireEvent.wheel(fixed, { shiftKey: true, deltaY: 100 });
    expect(fixedCtx.fillText).toHaveBeenCalledWith(
      "×0.8",
      expect.any(Number),
      expect.any(Number),
    );
    expect(playhead.style.visibility).toBe("visible");

    // 对照：无 Shift 的同样滚动平移视口 500ms，播放头移出左缘被隐藏
    fireEvent.wheel(fixed, { deltaY: 100 });
    expect(playhead.style.visibility).toBe("hidden");
  });
});

describe("Timeline pointer gestures", () => {
  it("keeps body clicks as selection and seek without creating history", () => {
    reset(["b"]);
    const { lane, updateCue, onCommitPendingTimeDraft } = renderTimeline();

    pointer("down", lane, 150, 10);
    pointer("up", lane, 150, 10);

    expect(usePlaybackStore.getState().selectedCueIds).toEqual(["a"]);
    expect(usePlaybackStore.getState().currentTimeMs).toBe(1000);
    expect(onCommitPendingTimeDraft).toHaveBeenCalledTimes(1);
    expect(updateCue).not.toHaveBeenCalled();
  });

  it("moves one cue as a single history command and collapses multi-selection", () => {
    reset(["a", "b"]);
    const { lane, updateCue, onCommitPendingTimeDraft } = renderTimeline();

    pointer("down", lane, 150, 10);
    pointer("move", lane, 250, 10);
    pointer("up", lane, 250, 10);

    expect(useProjectStore.getState().cues[0]).toMatchObject({
      startMs: 2000,
      endMs: 3000,
    });
    expect(usePlaybackStore.getState().selectedCueIds).toEqual(["a"]);
    expect(onCommitPendingTimeDraft).toHaveBeenCalledTimes(1);
    expect(updateCue).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().cues[0]).toMatchObject({
      startMs: 1000,
      endMs: 2000,
    });
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });

  it.each(["pointerCancel", "lostPointerCapture"] as const)(
    "does not commit on %s",
    (eventName) => {
      const { lane, updateCue } = renderTimeline();
      pointer("down", lane, 150, 10);
      pointer("move", lane, 250, 10);
      if (eventName === "pointerCancel") {
        fireEvent.pointerCancel(lane, { pointerId: 1 });
      } else {
        fireEvent.lostPointerCapture(lane, { pointerId: 1 });
      }

      expect(updateCue).not.toHaveBeenCalled();
      expect(useProjectStore.getState().cues[0]).toMatchObject({
        startMs: 1000,
        endMs: 2000,
      });
    },
  );

  it("snaps a boundary drag to the gesture-start playhead", () => {
    usePlaybackStore.setState({ currentTimeMs: 2500 });
    const { lane, updateCue } = renderTimeline();

    pointer("down", lane, 200, 10);
    // 11px from the playhead but only 1px from a frame: strong snap must win.
    pointer("move", lane, 239, 10);
    pointer("up", lane, 239, 10);

    expect(updateCue).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().cues[0].endMs).toBe(2500);
  });

  it("uses frame snapping when the nearest strong target is beyond 12px", () => {
    usePlaybackStore.setState({ currentTimeMs: 2530 });
    const { lane } = renderTimeline();

    pointer("down", lane, 200, 10);
    // 14px from the playhead and 1px from a frame start.
    pointer("move", lane, 239, 10);
    pointer("up", lane, 239, 10);

    expect(useProjectStore.getState().cues[0].endMs).toBe(2400);
  });

  it("prefers a strong target while dragging a cue body", () => {
    usePlaybackStore.setState({ currentTimeMs: 1100 });
    const { lane } = renderTimeline();

    pointer("down", lane, 150, 10);
    // The requested 60ms move is 4px from the playhead and 2px from a frame.
    pointer("move", lane, 156, 10);
    pointer("up", lane, 156, 10);

    expect(useProjectStore.getState().cues[0]).toMatchObject({
      startMs: 1100,
      endMs: 2100,
    });
  });

  it("distinguishes waveform clicks from range drags", () => {
    reset(["b", "a"]);
    const { fixed, updateCue, onCommitPendingTimeDraft } = renderTimeline();

    pointer("down", fixed, 120, 50);
    pointer("up", fixed, 120, 50);
    expect(usePlaybackStore.getState().currentTimeMs).toBe(1200);
    expect(updateCue).not.toHaveBeenCalled();

    pointer("down", fixed, 120, 50);
    pointer("move", fixed, 280, 50);
    pointer("up", fixed, 280, 50);

    expect(useProjectStore.getState().cues[0]).toMatchObject({
      startMs: 1200,
      endMs: 2800,
    });
    expect(usePlaybackStore.getState().selectedCueIds).toEqual(["a"]);
    expect(onCommitPendingTimeDraft).toHaveBeenCalledTimes(1);
    expect(updateCue).toHaveBeenCalledTimes(1);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().cues[0]).toMatchObject({
      startMs: 1000,
      endMs: 2000,
    });
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });

  it("prefers a strong target while selecting a waveform range", () => {
    usePlaybackStore.setState({ currentTimeMs: 1100 });
    const { fixed } = renderTimeline();

    pointer("down", fixed, 0, 50);
    // The current edge is 4px from the playhead and 2px from a frame.
    pointer("move", fixed, 106, 50);
    pointer("up", fixed, 106, 50);

    expect(useProjectStore.getState().cues[0]).toMatchObject({
      startMs: 0,
      endMs: 1100,
    });
  });

  it("seeks without editing when waveform drag starts with no active cue", () => {
    reset([]);
    const { fixed, updateCue } = renderTimeline();

    pointer("down", fixed, 120, 50);
    pointer("move", fixed, 280, 50);
    pointer("up", fixed, 280, 50);

    expect(usePlaybackStore.getState().currentTimeMs).toBe(1200);
    expect(updateCue).not.toHaveBeenCalled();
  });
});
