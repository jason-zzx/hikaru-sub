import type { SubtitleCue } from "@/lib/ass";
import { isCueActiveAtTime } from "@/components/editor/timelineModel";
import {
  findSegmentStopCue,
  type SegmentStop,
  usePlaybackStore,
} from "../stores/playbackStore";
import { useProjectStore } from "../stores/projectStore";

/**
 * 进程内单例：维护 playbackStore.activeCueIds（播放高亮命中集合，含重叠）。
 * 普通时间使用闭区间；所选 cue 行首排除恰在此结束的前一条；段播停点使用左极限。
 *
 * 用 vanilla subscribe 监听 currentTimeMs、segmentStop、selectedCueId 与
 * projectStore.cues，只在命中集合内容变化时写回 store——写入频率保持为字幕边界
 * 或离散选择变化频率，保证 React 订阅者不按帧重渲染。
 * App 挂载时调用 initActiveCueTracker() 一次（参照 previewFontDiscovery 的单例约定）。
 */

let unsubscribers: Array<() => void> | null = null;

export function resolveActiveCueIds(
  cues: readonly SubtitleCue[],
  currentTimeMs: number,
  segmentStop: SegmentStop | null,
  selectedCueId: string | null = null,
): string[] {
  const ids = (pred: (cue: SubtitleCue) => boolean) =>
    cues.filter(pred).map((cue) => cue.id);
  const stoppedCue = findSegmentStopCue(cues, segmentStop);
  const atSegmentStop =
    segmentStop !== null &&
    stoppedCue !== null &&
    currentTimeMs === segmentStop.stopMs;
  if (atSegmentStop) {
    return ids(
      (cue) =>
        cue.id === stoppedCue.id ||
        (currentTimeMs > cue.startMs && currentTimeMs <= cue.endMs),
    );
  }

  const selectedCue = cues.find((cue) => cue.id === selectedCueId);
  if (selectedCue?.startMs === currentTimeMs) {
    return ids(
      (cue) =>
        cue.id === selectedCue.id ||
        (currentTimeMs >= cue.startMs && currentTimeMs < cue.endMs),
    );
  }

  return ids((cue) => isCueActiveAtTime(cue, currentTimeMs));
}

function sync() {
  const {
    currentTimeMs,
    segmentPlayback,
    segmentStop,
    selectedCueId,
    activeCueIds,
    setSegmentPlayback,
    setSegmentStop,
    setActiveCueIds,
  } = usePlaybackStore.getState();
  const { cues } = useProjectStore.getState();
  // undo/redo 等直接替换 cue 快照的路径不会主动取消段播；引用已删除 cue 的
  // 段播在此永久取消，避免播放继续到旧终点并发布指向已删 cue 的停点。
  if (
    segmentPlayback !== null &&
    !cues.some((cue) => cue.id === segmentPlayback.cueId)
  ) {
    setSegmentPlayback(null);
  }
  const stoppedCue = findSegmentStopCue(cues, segmentStop);
  // 删除被播放句后永久丢弃驻留，避免 undo 后陈旧停点复活。
  if (segmentStop !== null && stoppedCue === null) {
    setSegmentStop(null);
    return;
  }
  // 段播停点驻留直接使用启动快照绑定的 cue；播放期间对起止时间的编辑
  // 不得重新解释旧停点，也不能点亮恰从停点开始的下一句。
  const next = resolveActiveCueIds(
    cues,
    currentTimeMs,
    segmentStop,
    selectedCueId,
  );
  const same =
    next.length === activeCueIds.length &&
    next.every((v, i) => v === activeCueIds[i]);
  if (!same) setActiveCueIds(next);
}

/** 幂等初始化：重复调用只挂一次订阅。 */
export function initActiveCueTracker() {
  if (unsubscribers) return;
  unsubscribers = [
    usePlaybackStore.subscribe((state, prev) => {
      if (
        state.currentTimeMs !== prev.currentTimeMs ||
        state.segmentStop !== prev.segmentStop ||
        state.selectedCueId !== prev.selectedCueId
      ) {
        sync();
      }
    }),
    useProjectStore.subscribe((state, prev) => {
      if (state.cues !== prev.cues) sync();
    }),
  ];
  sync();
}

/** 测试用：卸载订阅，允许重新 init。 */
export function __resetActiveCueTrackerForTests() {
  if (!unsubscribers) return;
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = null;
}
