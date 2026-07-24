// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useProjectStore } from "../../stores/projectStore";
import type { SubtitleCue } from "../../types";
import { Timeline } from "./Timeline";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

const context = {
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

const capturedPointers = new WeakMap<HTMLCanvasElement, Set<number>>();

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
  return { ...result, fixed, lane, updateCue, onCommitPendingTimeDraft };
}

function pointer(type: "down" | "move" | "up", canvas: HTMLCanvasElement, x: number, y: number) {
  const init = { pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y };
  if (type === "down") fireEvent.pointerDown(canvas, init);
  if (type === "move") fireEvent.pointerMove(canvas, init);
  if (type === "up") fireEvent.pointerUp(canvas, init);
}

beforeEach(() => {
  reset();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const height = this instanceof HTMLCanvasElement ? 226 : 226;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1000,
        bottom: height,
        width: 1000,
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
