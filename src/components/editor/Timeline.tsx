import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import {
  assignCueLanes,
  normalizeBoundaryDrag,
  type TimelineDragEdge,
} from "../../services/editorActions";
import {
  clipVisibleCueRect,
  hitTestTimelineCue,
  type TimelineCueRect,
} from "./timelineModel";
import { resolveTimelineColors, type TimelineColors } from "./timelineColors";
import type { SubtitleCue } from "../../types";

const RULER_HEIGHT = 22;
const WAVE_TOP = 24;
const WAVE_HEIGHT = 116;
const FIXED_LAYER_HEIGHT = 146;
const LANE_HEIGHT = 28;
const LANE_GAP = 4;
const LANE_PADDING_Y = 6;
const EDGE_HANDLE_WIDTH = 6;

type DragState = {
  pointerId: number;
  cue: SubtitleCue;
  edge: TimelineDragEdge;
};

type DragPreview = {
  id: string;
  startMs: number;
  endMs: number;
};

export function Timeline() {
  const fixedCanvasRef = useRef<HTMLCanvasElement>(null);
  const laneCanvasRef = useRef<HTMLCanvasElement>(null);
  const laneViewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cueRectsRef = useRef<TimelineCueRect[]>([]);
  const dragStateRef = useRef<DragState | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);

  const [waveform, setWaveform] = useState<number[]>([]);
  const [viewStartMs, setViewStartMs] = useState(0);
  const [msPerPixel, setMsPerPixel] = useState(10);
  const [dragPreviewState, setDragPreviewState] = useState<DragPreview | null>(null);
  const [laneCursorClass, setLaneCursorClass] = useState("cursor-pointer");
  const [themeVersion, setThemeVersion] = useState(0);

  const cues = useProjectStore((s) => s.cues);
  const videoPath = useProjectStore((s) => s.videoPath);
  const updateCue = useProjectStore((s) => s.updateCue);
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const durationMs = usePlaybackStore((s) => s.durationMs);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const setSelectedCueId = usePlaybackStore((s) => s.setSelectedCueId);
  const setPlayUntil = usePlaybackStore((s) => s.setPlayUntil);

  useEffect(() => {
    if (videoPath && durationMs > 0) {
      const samples = 4000;
      invoke<number[]>("extract_waveform", { videoPath, samples })
        .then(setWaveform)
        .catch(console.error);
    }
  }, [videoPath, durationMs]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setThemeVersion((v) => v + 1);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isPlaying) return;

    const container = containerRef.current;
    if (!container) return;
    const width = container.getBoundingClientRect().width;
    const viewEndMs = viewStartMs + width * msPerPixel;

    if (currentTimeMs < viewStartMs || currentTimeMs > viewEndMs) {
      setViewStartMs(Math.max(0, currentTimeMs - (width * msPerPixel) / 2));
    }
  }, [currentTimeMs, viewStartMs, msPerPixel, isPlaying]);

  useEffect(() => {
    const fixedCanvas = fixedCanvasRef.current;
    const laneCanvas = laneCanvasRef.current;
    const laneViewport = laneViewportRef.current;
    const container = containerRef.current;
    if (!fixedCanvas || !laneCanvas || !laneViewport || !container || durationMs === 0) {
      return;
    }

    const width = container.getBoundingClientRect().width;
    const fixedCtx = prepareCanvas(fixedCanvas, width, FIXED_LAYER_HEIGHT);
    if (!fixedCtx) return;

    const renderedCues = dragPreviewState
      ? cues.map((cue) =>
          cue.id === dragPreviewState.id ? { ...cue, ...dragPreviewState } : cue,
        )
      : cues;
    const laneItems = assignCueLanes(renderedCues);
    const laneCount =
      laneItems.length > 0
        ? Math.max(...laneItems.map((item) => item.lane)) + 1
        : 1;
    const laneContentHeight =
      laneCount * (LANE_HEIGHT + LANE_GAP) + LANE_PADDING_Y * 2;
    const laneCanvasHeight = Math.max(laneViewport.clientHeight, laneContentHeight);
    const laneCtx = prepareCanvas(laneCanvas, width, laneCanvasHeight);
    if (!laneCtx) return;

    const colors = resolveTimelineColors(document.documentElement);

    drawFixedLayer(
      fixedCtx,
      width,
      waveform,
      durationMs,
      viewStartMs,
      msPerPixel,
      currentTimeMs,
      colors,
    );
    const viewEndMs = viewStartMs + width * msPerPixel;
    cueRectsRef.current = laneItems
      .filter((item) => item.cue.endMs >= viewStartMs && item.cue.startMs <= viewEndMs)
      .map((item) => ({
        cue: item.cue,
        lane: item.lane,
        x: (item.cue.startMs - viewStartMs) / msPerPixel,
        y: LANE_PADDING_Y + item.lane * (LANE_HEIGHT + LANE_GAP),
        width: Math.max(2, (item.cue.endMs - item.cue.startMs) / msPerPixel),
        height: LANE_HEIGHT,
      }));

    drawLaneLayer(laneCtx, width, laneCanvasHeight, cueRectsRef.current, selectedCueId, colors);

    const pointerX = (currentTimeMs - viewStartMs) / msPerPixel;
    if (pointerX >= 0 && pointerX <= width) {
      laneCtx.strokeStyle = colors.playhead;
      laneCtx.lineWidth = 2;
      laneCtx.beginPath();
      laneCtx.moveTo(pointerX, 0);
      laneCtx.lineTo(pointerX, laneCanvasHeight);
      laneCtx.stroke();
    }
  }, [
    cues,
    currentTimeMs,
    dragPreviewState,
    durationMs,
    msPerPixel,
    selectedCueId,
    themeVersion,
    viewStartMs,
    waveform,
  ]);

  useEffect(() => {
    const fixedCanvas = fixedCanvasRef.current;
    const laneViewport = laneViewportRef.current;
    const container = containerRef.current;
    if (!fixedCanvas || !laneViewport || !container) return;

    const zoomAt = (clientX: number, rect: DOMRect, deltaY: number) => {
      const mouseX = clientX - rect.left;
      const mouseTimeMs = viewStartMs + mouseX * msPerPixel;
      const zoomFactor = deltaY > 0 ? 1.2 : 0.8;
      const newMsPerPixel = Math.max(1, Math.min(100, msPerPixel * zoomFactor));
      const newViewStart = mouseTimeMs - mouseX * newMsPerPixel;
      setMsPerPixel(newMsPerPixel);
      setViewStartMs(Math.max(0, Math.min(newViewStart, durationMs)));
    };

    const handleFixedWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = fixedCanvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, rect, e.deltaY);
        return;
      }
      const scrollAmount = e.deltaY * msPerPixel * 0.5;
      setViewStartMs(Math.max(0, Math.min(viewStartMs + scrollAmount, durationMs)));
    };

    const handleLaneWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, laneViewport.getBoundingClientRect(), e.deltaY);
        return;
      }
      laneViewport.scrollTop += e.deltaY;
    };

    const handleContainerWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    container.addEventListener("wheel", handleContainerWheel, { passive: false });
    fixedCanvas.addEventListener("wheel", handleFixedWheel, { passive: false });
    laneViewport.addEventListener("wheel", handleLaneWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleContainerWheel);
      fixedCanvas.removeEventListener("wheel", handleFixedWheel);
      laneViewport.removeEventListener("wheel", handleLaneWheel);
    };
  }, [durationMs, msPerPixel, viewStartMs]);

  const localLanePoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = laneCanvasRef.current;
    if (!canvas) return { x: 0, y: 0, viewportWidth: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      viewportWidth: rect.width,
    };
  };

  const handleFixedPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedTime = viewStartMs + x * msPerPixel;
    setCurrentTime(Math.max(0, Math.min(clickedTime, durationMs)));
  };

  const setLatestDragPreview = (preview: DragPreview | null) => {
    dragPreviewRef.current = preview;
    setDragPreviewState(preview);
  };

  const updateDragPreviewFromPointer = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ): DragPreview | null => {
    const activeDrag = dragStateRef.current;
    if (!activeDrag || activeDrag.pointerId !== e.pointerId) return null;
    const local = localLanePoint(e);
    const rawMs = viewStartMs + local.x * msPerPixel;
    const normalized = normalizeBoundaryDrag(
      activeDrag.cue,
      activeDrag.edge,
      rawMs,
      durationMs,
    );
    const preview = { id: activeDrag.cue.id, ...normalized };
    setLatestDragPreview(preview);
    return preview;
  };

  const handleLanePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const local = localLanePoint(e);
    const hit = hitTestTimelineCue(
      cueRectsRef.current,
      local.x,
      local.y,
      EDGE_HANDLE_WIDTH,
      local.viewportWidth,
    );
    if (hit.kind === "empty") {
      const clickedTime = viewStartMs + local.x * msPerPixel;
      setCurrentTime(Math.max(0, Math.min(clickedTime, durationMs)));
      return;
    }

    setSelectedCueId(hit.cue.id);
    setPlayUntil(null);
    if (hit.kind === "body") {
      setCurrentTime(hit.cue.startMs);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = { pointerId: e.pointerId, cue: hit.cue, edge: hit.edge };
    const normalized = normalizeBoundaryDrag(
      hit.cue,
      hit.edge,
      viewStartMs + local.x * msPerPixel,
      durationMs,
    );
    setLatestDragPreview({ id: hit.cue.id, ...normalized });
    setLaneCursorClass("cursor-ew-resize");
  };

  const handleLanePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const activeDrag = dragStateRef.current;
    if (!activeDrag) {
      const local = localLanePoint(e);
      const hit = hitTestTimelineCue(
        cueRectsRef.current,
        local.x,
        local.y,
        EDGE_HANDLE_WIDTH,
        local.viewportWidth,
      );
      setLaneCursorClass(hit.kind === "edge" ? "cursor-ew-resize" : "cursor-pointer");
      return;
    }
    if (activeDrag.pointerId !== e.pointerId) return;

    updateDragPreviewFromPointer(e);
  };

  const finishDrag = (commit: boolean, pointerId: number, canvas: HTMLCanvasElement) => {
    const activeDrag = dragStateRef.current;
    const latestPreview = dragPreviewRef.current;
    if (commit && activeDrag && latestPreview?.id === activeDrag.cue.id) {
      updateCue(activeDrag.cue.id, {
        startMs: latestPreview.startMs,
        endMs: latestPreview.endMs,
      });
    }
    if (canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
    dragStateRef.current = null;
    setLatestDragPreview(null);
    setLaneCursorClass("cursor-pointer");
  };

  const handleLanePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const activeDrag = dragStateRef.current;
    if (!activeDrag || activeDrag.pointerId !== e.pointerId) return;
    updateDragPreviewFromPointer(e);
    finishDrag(true, e.pointerId, e.currentTarget);
  };

  const handleLanePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const activeDrag = dragStateRef.current;
    if (!activeDrag || activeDrag.pointerId !== e.pointerId) return;
    finishDrag(false, e.pointerId, e.currentTarget);
  };

  if (durationMs === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-muted">
        等待视频加载...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full touch-none select-none flex-col overflow-hidden overscroll-contain"
    >
      <canvas
        ref={fixedCanvasRef}
        className="shrink-0 touch-none cursor-pointer"
        style={{ height: FIXED_LAYER_HEIGHT }}
        onPointerDown={handleFixedPointerDown}
      />
      <div
        ref={laneViewportRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        <canvas
          ref={laneCanvasRef}
          className={`touch-none ${laneCursorClass}`}
          onPointerDown={handleLanePointerDown}
          onPointerMove={handleLanePointerMove}
          onPointerUp={handleLanePointerUp}
          onPointerCancel={handleLanePointerCancel}
        />
      </div>
      <div className="pointer-events-none absolute bottom-1 right-2 text-xs text-text-muted">
        波形区滚轮平移 · 字幕区滚轮上下滚动 · Ctrl+滚轮缩放
      </div>
    </div>
  );
}

function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

function drawFixedLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  waveform: number[],
  durationMs: number,
  viewStartMs: number,
  msPerPixel: number,
  currentTimeMs: number,
  colors: TimelineColors,
) {
  const viewEndMs = viewStartMs + width * msPerPixel;

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, FIXED_LAYER_HEIGHT);

  ctx.fillStyle = colors.tick;
  ctx.font = "10px monospace";
  const tickIntervalMs = calculateTickInterval(msPerPixel);
  const firstTick = Math.floor(viewStartMs / tickIntervalMs) * tickIntervalMs;
  for (let t = firstTick; t <= viewEndMs; t += tickIntervalMs) {
    const x = (t - viewStartMs) / msPerPixel;
    ctx.fillText(formatTime(t), x + 2, 12);
    ctx.fillRect(x, RULER_HEIGHT - 7, 1, 5);
  }

  ctx.fillStyle = colors.waveBg;
  ctx.fillRect(0, WAVE_TOP, width, WAVE_HEIGHT);
  if (waveform.length > 0) {
    ctx.strokeStyle = colors.wave;
    ctx.lineWidth = 1;
    const samplesPerMs = waveform.length / durationMs;

    ctx.beginPath();
    for (let x = 0; x < width; x += 1) {
      const ms = viewStartMs + x * msPerPixel;
      const idx = Math.floor(ms * samplesPerMs);
      if (idx >= 0 && idx < waveform.length) {
        const amp = waveform[idx] * WAVE_HEIGHT * 0.45;
        const y = WAVE_TOP + WAVE_HEIGHT / 2 - amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.beginPath();
    for (let x = 0; x < width; x += 1) {
      const ms = viewStartMs + x * msPerPixel;
      const idx = Math.floor(ms * samplesPerMs);
      if (idx >= 0 && idx < waveform.length) {
        const amp = waveform[idx] * WAVE_HEIGHT * 0.45;
        const y = WAVE_TOP + WAVE_HEIGHT / 2 + amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  const pointerX = (currentTimeMs - viewStartMs) / msPerPixel;
  if (pointerX >= 0 && pointerX <= width) {
    ctx.strokeStyle = colors.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pointerX, 0);
    ctx.lineTo(pointerX, FIXED_LAYER_HEIGHT);
    ctx.stroke();
  }
}

function drawLaneLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rects: TimelineCueRect[],
  selectedCueId: string | null,
  colors: TimelineColors,
) {
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  rects.forEach((rect) => {
    const clipped = clipVisibleCueRect(rect, width);
    if (!clipped) return;

    const isSelected = rect.cue.id === selectedCueId;
    ctx.fillStyle = isSelected ? colors.cueSelected : colors.cue;
    const drawWidth = Math.max(2, clipped.width);
    ctx.fillRect(clipped.x, rect.y, drawWidth, rect.height);

    ctx.fillStyle = colors.cueHandle;
    if (clipped.showStartHandle) {
      ctx.fillRect(clipped.x, rect.y, EDGE_HANDLE_WIDTH, rect.height);
    }
    if (clipped.showEndHandle) {
      ctx.fillRect(
        Math.max(clipped.x, clipped.x + drawWidth - EDGE_HANDLE_WIDTH),
        rect.y,
        EDGE_HANDLE_WIDTH,
        rect.height,
      );
    }

    if (clipped.width > 20) {
      ctx.fillStyle = colors.cueText;
      ctx.font = "11px sans-serif";
      const text = rect.cue.secondaryText || rect.cue.primaryText;
      ctx.save();
      ctx.rect(clipped.x, rect.y, drawWidth, rect.height);
      ctx.clip();
      // Keep text anchored to the cue's true start when it is still on-screen;
      // once scrolled past the left edge, pin text to the clipped left edge.
      const textX = clipped.showStartHandle
        ? clipped.x + 8
        : clipped.x + 2;
      ctx.fillText(text, textX, rect.y + 18, drawWidth - 12);
      ctx.restore();
    }
  });
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

function calculateTickInterval(msPerPixel: number): number {
  const intervals = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000];
  for (const interval of intervals) {
    if (interval / msPerPixel >= 80) {
      return interval;
    }
  }
  return 60000;
}
