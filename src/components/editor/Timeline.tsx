import { useEffect, useMemo, useRef, useState } from "react";
import { extractWaveform } from "../../services/tauri";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import {
  assignCueLanes,
  createTimelineSnapSnapshot,
  normalizeBoundaryDrag,
  resolveCueMove,
  resolveTimelineSnap,
  type TimelineDragEdge,
  type TimelineSnapSnapshot,
  type TimelineSnapThresholds,
} from "../../services/editorActions";
import {
  clipVisibleCueRect,
  hitTestTimelineCue,
  revealTimelineTime,
  type TimelineCueRect,
} from "./timelineModel";
import { resolveTimelineColors, type TimelineColors } from "./timelineColors";
import {
  aggregatePixelPeak,
  applyGain,
  buildWaveformTransform,
  stepWaveformGain,
} from "./waveformDisplay";
import type { SubtitleCue, WaveformData } from "../../types";

const RULER_HEIGHT = 22;
const WAVE_TOP = 24;
const WAVE_HEIGHT = 116;
const FIXED_LAYER_HEIGHT = 146;
const LANE_HEIGHT = 28;
const LANE_GAP = 4;
const LANE_PADDING_Y = 6;
const EDGE_HANDLE_WIDTH = 6;
const DRAG_THRESHOLD_PX = 4;
const STRONG_SNAP_THRESHOLD_PX = 12;
const FRAME_SNAP_THRESHOLD_PX = 4;

const EMPTY_WAVEFORM: WaveformData = { peaks: [], coveredMs: 0 };

type GestureGeometry = {
  viewStartMs: number;
  msPerPixel: number;
};

type LaneGesture =
  | {
      kind: "pending-body";
      pointerId: number;
      cueId: string;
      downX: number;
      downTimeMs: number;
      playheadMs: number;
      geometry: GestureGeometry;
    }
  | {
      kind: "edge";
      pointerId: number;
      cue: SubtitleCue;
      edge: TimelineDragEdge;
      snap: TimelineSnapSnapshot;
      geometry: GestureGeometry;
    }
  | {
      kind: "body";
      pointerId: number;
      cue: SubtitleCue;
      downTimeMs: number;
      snap: TimelineSnapSnapshot;
      geometry: GestureGeometry;
    };

type WaveGesture =
  | {
      kind: "pending";
      pointerId: number;
      cueId: string;
      downX: number;
      anchorTimeMs: number;
      playheadMs: number;
      geometry: GestureGeometry;
    }
  | {
      kind: "range";
      pointerId: number;
      cue: SubtitleCue;
      anchorTimeMs: number;
      snap: TimelineSnapSnapshot;
      geometry: GestureGeometry;
    };

type DragPreview = {
  id: string;
  startMs: number;
  endMs: number;
};

interface TimelineProps {
  onCommitPendingTimeDraft?: () => void;
}

export function Timeline({ onCommitPendingTimeDraft }: TimelineProps) {
  const fixedCanvasRef = useRef<HTMLCanvasElement>(null);
  const laneCanvasRef = useRef<HTMLCanvasElement>(null);
  const laneViewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cueRectsRef = useRef<TimelineCueRect[]>([]);
  const laneGestureRef = useRef<LaneGesture | null>(null);
  const waveGestureRef = useRef<WaveGesture | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const containerWidthRef = useRef(0);

  const [waveform, setWaveform] = useState<WaveformData>(EMPTY_WAVEFORM);
  // 容器宽度 state：驱动两层 canvas 在面板 resize 后重绘；瞬态播放头继续读 ref
  const [containerWidth, setContainerWidth] = useState(0);
  // 手动纵向增益：会话级（组件 state），不写入设置
  const [waveformGain, setWaveformGain] = useState(1);
  const [viewStartMs, setViewStartMs] = useState(0);
  const [msPerPixel, setMsPerPixel] = useState(10);
  const [dragPreviewState, setDragPreviewState] = useState<DragPreview | null>(null);
  const [snapTargetMs, setSnapTargetMs] = useState<number | null>(null);
  const [laneCursorClass, setLaneCursorClass] = useState("cursor-pointer");
  const [themeVersion, setThemeVersion] = useState(0);

  const cues = useProjectStore((s) => s.cues);
  const videoPath = useProjectStore((s) => s.videoPath);
  const updateCue = useProjectStore((s) => s.updateCue);
  const durationMs = usePlaybackStore((s) => s.durationMs);
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const activeCueIds = usePlaybackStore((s) => s.activeCueIds);
  const requestSeek = usePlaybackStore((s) => s.requestSeek);
  const setSelectedCueId = usePlaybackStore((s) => s.setSelectedCueId);
  const setPlayUntil = usePlaybackStore((s) => s.setPlayUntil);

  const ready = durationMs > 0;

  useEffect(() => {
    // 进入效应先重置：换视频后不残留上一支视频的波形（新请求返回前显示空白）
    setWaveform(EMPTY_WAVEFORM);
    if (!videoPath || durationMs <= 0) return;
    // 10ms/桶，分辨率与时长解耦；短素材保底 4000 桶，超长素材封顶 720k
    const samples = Math.min(Math.max(4000, Math.ceil(durationMs / 10)), 720_000);
    // 快速换片时旧请求可能后完成：cleanup 置 stale，迟到响应直接丢弃
    let stale = false;
    extractWaveform(videoPath, samples)
      .then((data) => {
        if (!stale) setWaveform(data);
      })
      .catch(console.error);
    return () => {
      stale = true;
    };
  }, [videoPath, durationMs]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setThemeVersion((v) => v + 1);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // getComputedStyle 强制样式重算成本高：按主题版本缓存，不再每次重绘解析
  const colors = useMemo(
    () => resolveTimelineColors(document.documentElement),
    // themeVersion 仅作缓存失效信号
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeVersion],
  );

  // 自动对比度映射：波形数据加载后一次性计算并缓存，不在每次重绘/每列重算 percentile
  const waveformTransform = useMemo(
    () => buildWaveformTransform(waveform.peaks),
    [waveform],
  );

  // 容器宽度：state 驱动两层 canvas 重绘依赖（面板 resize 后重铺，宽度未变不 set）；
  // ref 供瞬态播放头订阅每帧读取（避免每帧 getBoundingClientRect 强制布局）
  useEffect(() => {
    if (!ready) return;
    const container = containerRef.current;
    if (!container) return;
    const syncWidth = () => {
      const width = container.getBoundingClientRect().width;
      containerWidthRef.current = width;
      setContainerWidth((prev) => (prev === width ? prev : width));
    };
    syncWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, [ready]);

  // 播放头瞬态直连 DOM：不经 React 渲染，每帧只写 transform（纯合成层属性）。
  // 同一订阅内做翻页判定（播放头出视区才 setViewStartMs → 静态层每屏一次重绘）。
  useEffect(() => {
    if (!ready) return;

    const positionPlayhead = (timeMs: number) => {
      const playhead = playheadRef.current;
      if (!playhead) return;
      const x = (timeMs - viewStartMs) / msPerPixel;
      if (x < 0 || x > containerWidthRef.current) {
        playhead.style.visibility = "hidden";
        return;
      }
      playhead.style.visibility = "visible";
      // 竖线宽 2px，取中对齐时间点（与原 canvas stroke 居中一致）
      playhead.style.transform = `translateX(${x - 1}px)`;
    };

    positionPlayhead(usePlaybackStore.getState().currentTimeMs);

    return usePlaybackStore.subscribe((state, prev) => {
      const timeChanged = state.currentTimeMs !== prev.currentTimeMs;
      const seekChanged = state.seekRequest !== prev.seekRequest;
      if (!timeChanged && !seekChanged) return;
      positionPlayhead(state.currentTimeMs);
      // 拖拽手势进行中跳过自动翻页（沿用既有 guard 语义）
      if (laneGestureRef.current || waveGestureRef.current) return;
      const width = containerWidthRef.current;
      if (width <= 0) return;
      const nextViewStartMs = revealTimelineTime(
        viewStartMs,
        width,
        msPerPixel,
        state.currentTimeMs,
      );
      if (nextViewStartMs !== viewStartMs) setViewStartMs(nextViewStartMs);
    });
    // containerWidth：resize 后立即按新宽度重定位/恢复可见性（每帧读取仍走 ref）
  }, [ready, viewStartMs, msPerPixel, containerWidth]);

  // fixed 层（刻度+波形+增益标签）：不依赖 activeCueIds / cues / 拖拽预览。
  // 字幕边界或 cue 高亮变化绝不触发波形逐像素聚合循环重绘。
  // 宽度读 containerWidth state（并入依赖）：面板 resize 后本层随之重绘。
  useEffect(() => {
    const fixedCanvas = fixedCanvasRef.current;
    if (!fixedCanvas || durationMs === 0 || containerWidth <= 0) return;

    const width = containerWidth;
    const fixedCtx = prepareCanvas(fixedCanvas, width, FIXED_LAYER_HEIGHT);
    if (!fixedCtx) return;

    drawFixedLayer(
      fixedCtx,
      width,
      waveform,
      viewStartMs,
      msPerPixel,
      waveformTransform,
      waveformGain,
      colors,
    );
    drawSnapGuide(
      fixedCtx,
      snapTargetMs,
      viewStartMs,
      msPerPixel,
      FIXED_LAYER_HEIGHT,
      colors,
    );
  }, [
    colors,
    containerWidth,
    durationMs,
    msPerPixel,
    snapTargetMs,
    viewStartMs,
    waveform,
    waveformGain,
    waveformTransform,
  ]);

  // lane 层（cue 矩形+播放高亮）：边界变化（activeCueIds）只重绘本层；
  // cueRectsRef 由本效应维护，供指针命中检测使用。
  // 宽度读 containerWidth state（并入依赖）：resize 后重铺，cueRects 命中不再错位。
  useEffect(() => {
    const laneCanvas = laneCanvasRef.current;
    const laneViewport = laneViewportRef.current;
    if (!laneCanvas || !laneViewport || durationMs === 0 || containerWidth <= 0) {
      return;
    }

    const width = containerWidth;
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

    drawLaneLayer(
      laneCtx,
      width,
      laneCanvasHeight,
      cueRectsRef.current,
      selectedCueId,
      activeCueIds,
      colors,
    );

    drawSnapGuide(
      laneCtx,
      snapTargetMs,
      viewStartMs,
      msPerPixel,
      laneCanvasHeight,
      colors,
    );
  }, [
    activeCueIds,
    colors,
    containerWidth,
    cues,
    dragPreviewState,
    durationMs,
    msPerPixel,
    selectedCueId,
    snapTargetMs,
    viewStartMs,
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
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, fixedCanvas.getBoundingClientRect(), e.deltaY);
        return;
      }
      if (e.shiftKey) {
        // Shift+滚轮：波形纵向增益，不触发平移（部分平台会把 deltaY 折到 deltaX）
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        if (delta !== 0) {
          setWaveformGain((gain) => stepWaveformGain(gain, delta < 0 ? 1 : -1));
        }
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

  const localCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      viewportWidth: rect.width,
    };
  };

  const timeAtX = (x: number, geometry: GestureGeometry, maxMs: number) =>
    Math.max(0, Math.min(geometry.viewStartMs + x * geometry.msPerPixel, maxMs));

  const setLatestDragPreview = (preview: DragPreview | null) => {
    dragPreviewRef.current = preview;
    setDragPreviewState(preview);
  };

  const releaseCapture = (canvas: HTMLCanvasElement, pointerId: number) => {
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  };

  const makeSnapSnapshot = (cueId: string, playheadMs: number) => {
    const liveCues = useProjectStore.getState().cues;
    return createTimelineSnapSnapshot(
      liveCues,
      cueId,
      playheadMs,
      usePlaybackStore.getState().fps,
      durationMs,
    );
  };

  const snapThresholds = (geometry: GestureGeometry): TimelineSnapThresholds => ({
    strongMs: STRONG_SNAP_THRESHOLD_PX * geometry.msPerPixel,
    frameMs: FRAME_SNAP_THRESHOLD_PX * geometry.msPerPixel,
  });

  const updateLanePreview = (
    gesture: Exclude<LaneGesture, { kind: "pending-body" }>,
    x: number,
  ) => {
    const rawMs = timeAtX(x, gesture.geometry, gesture.snap.durationMs);
    if (gesture.kind === "edge") {
      const snapped = resolveTimelineSnap(
        rawMs,
        snapThresholds(gesture.geometry),
        gesture.snap,
      );
      const preview = {
        id: gesture.cue.id,
        ...normalizeBoundaryDrag(
          gesture.cue,
          gesture.edge,
          snapped.timeMs,
          gesture.snap.durationMs,
        ),
      };
      setLatestDragPreview(preview);
      setSnapTargetMs(snapped.targetMs);
      return;
    }

    const moved = resolveCueMove(
      gesture.cue,
      rawMs - gesture.downTimeMs,
      gesture.snap.durationMs,
      gesture.snap,
      snapThresholds(gesture.geometry),
    );
    setLatestDragPreview({
      id: gesture.cue.id,
      startMs: moved.startMs,
      endMs: moved.endMs,
    });
    setSnapTargetMs(moved.snapTargetMs);
  };

  const activateBodyGesture = (
    pending: Extract<LaneGesture, { kind: "pending-body" }>,
    x: number,
  ) => {
    onCommitPendingTimeDraft?.();
    const cue = useProjectStore.getState().cues.find((item) => item.id === pending.cueId);
    if (!cue) return;
    const snap = makeSnapSnapshot(cue.id, pending.playheadMs);
    const active: LaneGesture = {
      kind: "body",
      pointerId: pending.pointerId,
      cue,
      downTimeMs: pending.downTimeMs,
      snap,
      geometry: pending.geometry,
    };
    laneGestureRef.current = active;
    setSelectedCueId(cue.id);
    setPlayUntil(null);
    setLaneCursorClass("cursor-grabbing");
    updateLanePreview(active, x);
  };

  const updateLaneGesture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const gesture = laneGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const local = localCanvasPoint(e);
    if (gesture.kind === "pending-body") {
      if (Math.abs(local.x - gesture.downX) <= DRAG_THRESHOLD_PX) return;
      activateBodyGesture(gesture, local.x);
      return;
    }
    updateLanePreview(gesture, local.x);
  };

  const clearLaneGesture = (pointerId: number, canvas: HTMLCanvasElement) => {
    laneGestureRef.current = null;
    setLatestDragPreview(null);
    setSnapTargetMs(null);
    setLaneCursorClass("cursor-pointer");
    releaseCapture(canvas, pointerId);
  };

  const handleLanePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.isPrimary === false || e.button !== 0 || laneGestureRef.current) return;
    e.preventDefault();
    const local = localCanvasPoint(e);
    const geometry = { viewStartMs, msPerPixel };
    const hit = hitTestTimelineCue(
      cueRectsRef.current,
      local.x,
      local.y,
      EDGE_HANDLE_WIDTH,
      local.viewportWidth,
    );
    if (hit.kind === "empty") {
      requestSeek(timeAtX(local.x, geometry, durationMs));
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    if (hit.kind === "body") {
      laneGestureRef.current = {
        kind: "pending-body",
        pointerId: e.pointerId,
        cueId: hit.cue.id,
        downX: local.x,
        downTimeMs: timeAtX(local.x, geometry, durationMs),
        playheadMs: usePlaybackStore.getState().currentTimeMs,
        geometry,
      };
      return;
    }

    onCommitPendingTimeDraft?.();
    const cue = useProjectStore.getState().cues.find((item) => item.id === hit.cue.id);
    if (!cue) {
      releaseCapture(e.currentTarget, e.pointerId);
      return;
    }
    const active: LaneGesture = {
      kind: "edge",
      pointerId: e.pointerId,
      cue,
      edge: hit.edge,
      snap: makeSnapSnapshot(cue.id, usePlaybackStore.getState().currentTimeMs),
      geometry,
    };
    laneGestureRef.current = active;
    setSelectedCueId(cue.id);
    setPlayUntil(null);
    setLaneCursorClass("cursor-ew-resize");
    updateLanePreview(active, local.x);
  };

  const handleLanePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (laneGestureRef.current) {
      updateLaneGesture(e);
      return;
    }
    const local = localCanvasPoint(e);
    const hit = hitTestTimelineCue(
      cueRectsRef.current,
      local.x,
      local.y,
      EDGE_HANDLE_WIDTH,
      local.viewportWidth,
    );
    setLaneCursorClass(hit.kind === "edge" ? "cursor-ew-resize" : "cursor-pointer");
  };

  const handleLanePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const gesture = laneGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    updateLaneGesture(e);
    const completed = laneGestureRef.current;
    const preview = dragPreviewRef.current;
    clearLaneGesture(e.pointerId, e.currentTarget);

    if (completed?.kind === "pending-body") {
      onCommitPendingTimeDraft?.();
      const cue = useProjectStore.getState().cues.find(
        (item) => item.id === completed.cueId,
      );
      if (cue) {
        setSelectedCueId(cue.id);
        requestSeek(cue.startMs);
        setPlayUntil(null);
      }
      return;
    }
    if (completed && preview && preview.id === completed.cue.id) {
      updateCue(completed.cue.id, {
        startMs: preview.startMs,
        endMs: preview.endMs,
      });
    }
  };

  const cancelLaneGesture = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const gesture = laneGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    e.preventDefault();
    clearLaneGesture(e.pointerId, e.currentTarget);
  };

  const updateWavePreview = (
    gesture: Extract<WaveGesture, { kind: "range" }>,
    x: number,
  ) => {
    const thresholds = snapThresholds(gesture.geometry);
    const anchor = resolveTimelineSnap(
      gesture.anchorTimeMs,
      thresholds,
      gesture.snap,
    );
    const current = resolveTimelineSnap(
      timeAtX(x, gesture.geometry, gesture.snap.durationMs),
      thresholds,
      gesture.snap,
    );
    setLatestDragPreview({
      id: gesture.cue.id,
      startMs: Math.min(anchor.timeMs, current.timeMs),
      endMs: Math.max(anchor.timeMs, current.timeMs),
    });
    setSnapTargetMs(current.targetMs ?? anchor.targetMs);
  };

  const updateWaveGesture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const gesture = waveGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const local = localCanvasPoint(e);
    if (gesture.kind === "pending") {
      if (Math.abs(local.x - gesture.downX) <= DRAG_THRESHOLD_PX) return;
      onCommitPendingTimeDraft?.();
      const cue = useProjectStore.getState().cues.find(
        (item) => item.id === gesture.cueId,
      );
      if (!cue) return;
      const active: WaveGesture = {
        kind: "range",
        pointerId: gesture.pointerId,
        cue,
        anchorTimeMs: gesture.anchorTimeMs,
        snap: makeSnapSnapshot(cue.id, gesture.playheadMs),
        geometry: gesture.geometry,
      };
      waveGestureRef.current = active;
      setSelectedCueId(cue.id);
      setPlayUntil(null);
      updateWavePreview(active, local.x);
      return;
    }
    updateWavePreview(gesture, local.x);
  };

  const clearWaveGesture = (pointerId: number, canvas: HTMLCanvasElement) => {
    waveGestureRef.current = null;
    setLatestDragPreview(null);
    setSnapTargetMs(null);
    releaseCapture(canvas, pointerId);
  };

  const handleFixedPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.isPrimary === false || e.button !== 0 || waveGestureRef.current) return;
    e.preventDefault();
    const local = localCanvasPoint(e);
    const geometry = { viewStartMs, msPerPixel };
    const clickedTime = timeAtX(local.x, geometry, durationMs);
    const cueId = usePlaybackStore.getState().selectedCueId;
    const hasSelectedCue = useProjectStore
      .getState()
      .cues.some((cue) => cue.id === cueId);
    const inWaveform = local.y >= WAVE_TOP && local.y <= WAVE_TOP + WAVE_HEIGHT;
    if (!inWaveform || !cueId || !hasSelectedCue) {
      requestSeek(clickedTime);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    waveGestureRef.current = {
      kind: "pending",
      pointerId: e.pointerId,
      cueId,
      downX: local.x,
      anchorTimeMs: clickedTime,
      playheadMs: usePlaybackStore.getState().currentTimeMs,
      geometry,
    };
  };

  const handleFixedPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!waveGestureRef.current) return;
    e.preventDefault();
    updateWaveGesture(e);
  };

  const handleFixedPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const gesture = waveGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    e.preventDefault();
    updateWaveGesture(e);
    const completed = waveGestureRef.current;
    const preview = dragPreviewRef.current;
    clearWaveGesture(e.pointerId, e.currentTarget);
    if (completed?.kind === "pending") {
      requestSeek(completed.anchorTimeMs);
    } else if (completed && preview?.id === completed.cue.id) {
      updateCue(completed.cue.id, {
        startMs: preview.startMs,
        endMs: preview.endMs,
      });
    }
  };

  const cancelWaveGesture = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const gesture = waveGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    e.preventDefault();
    clearWaveGesture(e.pointerId, e.currentTarget);
  };

  useEffect(() => () => {
    const laneGesture = laneGestureRef.current;
    const waveGesture = waveGestureRef.current;
    laneGestureRef.current = null;
    waveGestureRef.current = null;
    if (laneGesture && laneCanvasRef.current) {
      releaseCapture(laneCanvasRef.current, laneGesture.pointerId);
    }
    if (waveGesture && fixedCanvasRef.current) {
      releaseCapture(fixedCanvasRef.current, waveGesture.pointerId);
    }
  }, []);

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
        onPointerMove={handleFixedPointerMove}
        onPointerUp={handleFixedPointerUp}
        onPointerCancel={cancelWaveGesture}
        onLostPointerCapture={cancelWaveGesture}
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
          onPointerCancel={cancelLaneGesture}
          onLostPointerCapture={cancelLaneGesture}
        />
      </div>
      {/* 播放头：瞬态订阅直写 transform，贯穿 fixed 层与 lane 视口，不参与 React 渲染 */}
      <div
        ref={playheadRef}
        data-testid="timeline-playhead"
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[2px]"
        style={{
          backgroundColor: "var(--timeline-playhead, #ef4444)",
          visibility: "hidden",
        }}
      />
      <div className="pointer-events-none absolute bottom-1 right-2 text-xs text-text-muted">
        波形区滚轮平移 · Shift+滚轮波形增益 · Ctrl+滚轮缩放
      </div>
    </div>
  );
}

/** 记忆上次画布尺寸：尺寸未变时只 clearRect，避免重设 canvas.width 的重分配开销 */
const canvasSizeCache = new WeakMap<
  HTMLCanvasElement,
  { width: number; height: number; dpr: number }
>();

function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const last = canvasSizeCache.get(canvas);
  if (!last || last.width !== width || last.height !== height || last.dpr !== dpr) {
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvasSizeCache.set(canvas, { width, height, dpr });
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

function drawSnapGuide(
  ctx: CanvasRenderingContext2D,
  targetMs: number | null,
  viewStartMs: number,
  msPerPixel: number,
  height: number,
  colors: TimelineColors,
) {
  if (targetMs === null) return;
  const x = (targetMs - viewStartMs) / msPerPixel;
  ctx.save();
  ctx.strokeStyle = colors.cueSelected;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.restore();
}

function drawFixedLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  waveform: WaveformData,
  viewStartMs: number,
  msPerPixel: number,
  transform: (v: number) => number,
  gain: number,
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
  const { peaks, coveredMs } = waveform;
  if (peaks.length > 0 && coveredMs > 0) {
    ctx.strokeStyle = colors.wave;
    ctx.lineWidth = 1;
    // 时间映射用实际解码覆盖时长 coveredMs，而非容器标称 durationMs：
    // HLS 合并产物二者可差数十秒，按 durationMs 均摊会产生随时间线性放大的漂移
    const samplesPerMs = peaks.length / coveredMs;
    // 波形只画到实际音频末尾（coveredMs 之后留空白）；每像素列聚合桶区间 max，
    // 缩小时不跳桶丢峰
    const columns = Math.max(
      0,
      Math.min(width, Math.ceil((coveredMs - viewStartMs) / msPerPixel)),
    );
    const amps = new Float32Array(columns);
    for (let x = 0; x < columns; x += 1) {
      const startMs = viewStartMs + x * msPerPixel;
      const peak = aggregatePixelPeak(
        peaks,
        startMs,
        startMs + msPerPixel,
        samplesPerMs,
      );
      amps[x] = applyGain(transform(peak), gain) * WAVE_HEIGHT * 0.45;
    }

    ctx.beginPath();
    for (let x = 0; x < columns; x += 1) {
      const y = WAVE_TOP + WAVE_HEIGHT / 2 - amps[x];
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.beginPath();
    for (let x = 0; x < columns; x += 1) {
      const y = WAVE_TOP + WAVE_HEIGHT / 2 + amps[x];
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  if (gain !== 1) {
    // 手动增益激活时在波形区右上角画小标签
    ctx.save();
    ctx.fillStyle = colors.tick;
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`×${gain.toFixed(1)}`, width - 4, WAVE_TOP + 12);
    ctx.restore();
  }
}

function drawLaneLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rects: TimelineCueRect[],
  selectedCueId: string | null,
  activeCueIds: string[],
  colors: TimelineColors,
) {
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  rects.forEach((rect) => {
    const clipped = clipVisibleCueRect(rect, width);
    if (!clipped) return;

    const isSelected = rect.cue.id === selectedCueId;
    const isPlaybackActive =
      !isSelected && activeCueIds.includes(rect.cue.id);
    ctx.fillStyle = isSelected ? colors.cueSelected : colors.cue;
    const drawWidth = Math.max(2, clipped.width);
    ctx.fillRect(clipped.x, rect.y, drawWidth, rect.height);

    if (isPlaybackActive) {
      ctx.save();
      ctx.fillStyle = colors.cuePlaying;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(clipped.x, rect.y, drawWidth, rect.height);
      ctx.restore();

      ctx.strokeStyle = colors.cuePlaying;
      ctx.lineWidth = 1;
      ctx.strokeRect(clipped.x + 0.5, rect.y + 0.5, drawWidth - 1, rect.height - 1);
    }

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
