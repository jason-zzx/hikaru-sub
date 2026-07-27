import type { SubtitleCue } from "@/lib/ass";
import { create } from "zustand";

/** 显式 seek 意图：seq 递增保证同一目标时间的重复请求也能触发 video seek。 */
interface PlaybackSeekRequest {
  ms: number;
  seq: number;
}

/** 段播边界快照：绑定启动段播时的 cue 与终点，收尾时不读取后续编辑状态。 */
export interface SegmentStop {
  cueId: string;
  stopMs: number;
}

export function findSegmentStopCue(
  cues: readonly SubtitleCue[],
  segmentStop: SegmentStop | null,
): SubtitleCue | null {
  if (!segmentStop) return null;
  return cues.find((cue) => cue.id === segmentStop.cueId) ?? null;
}

function sameCueIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

interface PlaybackState {
  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
  selectedCueId: string | null;
  selectedCueIds: string[];
  /** 视频帧率；未探测到时为 null（帧步进按 30fps 回退） */
  fps: number | null;
  /**
   * 启动段播时捕获的 cue 与终点；null 表示非段播。后续选择变化或 cue 起止
   * 编辑不改写当前快照，下一次段播才读取新的起止时间。
   */
  segmentPlayback: SegmentStop | null;
  /**
   * 段播（播放当前句）精确停点的驻留标记：播放头仍精确停在停点时，
   * 命中口径按左极限 (start, end]（刚播完的句子保持、恰从停点开始的
   * 下一句不点亮），暂停预览钉帧保持被播放句。绑定被播放句 cueId；
   * 消费方仅须校验该 cue 仍存在，不能用编辑后的起止时间重新解释快照。
   * 播放头离开停点（显式 seek 或回写到其他时间）、恢复播放或选中变化时即清除。
   */
  segmentStop: SegmentStop | null;
  /**
   * 当前时间命中的全部 cue id（含重叠），由 activeCueTracker 在命中集合变化时写入
   * （字幕边界频率，非 60Hz），供列表/时间轴等重订阅者做边界频率渲染。
   */
  activeCueIds: string[];
  /** 用户意图跳转；播放回写（rAF/timeupdate/暂停收尾/段播终点）不经过此字段 */
  seekRequest: PlaybackSeekRequest | null;
  setCurrentTime: (ms: number) => void;
  setDuration: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setSelectedCueId: (id: string | null) => void;
  setSelectedCueIds: (ids: string[]) => void;
  clearCueSelection: () => void;
  setFps: (fps: number | null) => void;
  setSegmentPlayback: (segment: SegmentStop | null) => void;
  setSegmentStop: (stop: SegmentStop | null) => void;
  completeSegmentPlayback: (
    segment: SegmentStop,
    activeCueIds: string[],
  ) => void;
  setActiveCueIds: (ids: string[]) => void;
  /**
   * 用户意图 seek：同步写 currentTimeMs、退出段播并递增 seq；保持播放状态不变。
   */
  requestSeek: (ms: number) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  currentTimeMs: 0,
  durationMs: 0,
  isPlaying: false,
  selectedCueId: null,
  selectedCueIds: [],
  fps: null,
  segmentPlayback: null,
  segmentStop: null,
  activeCueIds: [],
  seekRequest: null,
  // 停点上的等值回写（rAF cleanup / 暂停后 timeupdate）保留驻留标记；移动即清除
  setCurrentTime: (ms) =>
    set((state) => {
      const shouldClearStop =
        state.segmentStop !== null && ms !== state.segmentStop.stopMs;
      if (state.currentTimeMs === ms && !shouldClearStop) return state;
      return shouldClearStop
        ? { currentTimeMs: ms, segmentStop: null }
        : { currentTimeMs: ms };
    }),
  setDuration: (ms) => set({ durationMs: ms }),
  // 暂停即视为片段播放结束：统一清除段播终点与启动快照；恢复播放离开停点驻留
  setPlaying: (playing) =>
    set((state) => {
      if (playing) {
        if (state.isPlaying && state.segmentStop === null) return state;
        return { isPlaying: true, segmentStop: null };
      }
      if (!state.isPlaying && state.segmentPlayback === null) return state;
      return { isPlaying: false, segmentPlayback: null };
    }),
  // 有效选择变化 = 用户焦点移动：解除停点驻留；相同选择写回是纯 no-op。
  setSelectedCueId: (id) =>
    set((state) => {
      const selectedCueIds = id ? [id] : [];
      if (
        state.selectedCueId === id &&
        sameCueIds(state.selectedCueIds, selectedCueIds)
      ) {
        return state;
      }
      return { selectedCueId: id, selectedCueIds, segmentStop: null };
    }),
  setSelectedCueIds: (ids) => {
    const selectedCueIds = [...new Set(ids)];
    const selectedCueId = selectedCueIds[selectedCueIds.length - 1] ?? null;
    set((state) => {
      if (
        state.selectedCueId === selectedCueId &&
        sameCueIds(state.selectedCueIds, selectedCueIds)
      ) {
        return state;
      }
      return { selectedCueIds, selectedCueId, segmentStop: null };
    });
  },
  clearCueSelection: () =>
    set((state) =>
      state.selectedCueId === null && state.selectedCueIds.length === 0
        ? state
        : { selectedCueId: null, selectedCueIds: [], segmentStop: null },
    ),
  setFps: (fps) => set({ fps }),
  setSegmentPlayback: (segmentPlayback) => set({ segmentPlayback }),
  setSegmentStop: (stop) => set({ segmentStop: stop }),
  completeSegmentPlayback: (segmentStop, activeCueIds) =>
    set({
      currentTimeMs: segmentStop.stopMs,
      isPlaying: false,
      segmentPlayback: null,
      segmentStop,
      activeCueIds,
    }),
  setActiveCueIds: (ids) => set({ activeCueIds: ids }),
  // 显式 seek 是用户主动移动播放头：退出段播并解除已完成停点驻留，保持正常播放
  requestSeek: (ms) =>
    set((state) => ({
      currentTimeMs: ms,
      segmentPlayback: null,
      segmentStop: null,
      seekRequest: { ms, seq: (state.seekRequest?.seq ?? 0) + 1 },
    })),
}));
