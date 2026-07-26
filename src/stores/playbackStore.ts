import { create } from "zustand";

/** 显式 seek 意图：seq 递增保证同一目标时间的重复请求也能触发 video seek。 */
interface PlaybackSeekRequest {
  ms: number;
  seq: number;
}

interface PlaybackState {
  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
  selectedCueId: string | null;
  selectedCueIds: string[];
  /** 视频帧率；未探测到时为 null（帧步进按 30fps 回退） */
  fps: number | null;
  /** 「播放当前句」的自动停止点；null 表示非片段播放 */
  playUntilMs: number | null;
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
  setPlayUntil: (ms: number | null) => void;
  setActiveCueIds: (ids: string[]) => void;
  /** 用户意图 seek：同步写 currentTimeMs 并递增 seq；视频侧由 seekRequest 驱动 */
  requestSeek: (ms: number) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  currentTimeMs: 0,
  durationMs: 0,
  isPlaying: false,
  selectedCueId: null,
  selectedCueIds: [],
  fps: null,
  playUntilMs: null,
  activeCueIds: [],
  seekRequest: null,
  setCurrentTime: (ms) => set({ currentTimeMs: ms }),
  setDuration: (ms) => set({ durationMs: ms }),
  // 暂停即视为片段播放结束：统一清除 playUntilMs，覆盖空格/按钮/播放结束等所有暂停路径
  setPlaying: (playing) =>
    set(playing ? { isPlaying: true } : { isPlaying: false, playUntilMs: null }),
  setSelectedCueId: (id) =>
    set({ selectedCueId: id, selectedCueIds: id ? [id] : [] }),
  setSelectedCueIds: (ids) => {
    const uniqueIds = [...new Set(ids)];
    set({
      selectedCueIds: uniqueIds,
      selectedCueId: uniqueIds[uniqueIds.length - 1] ?? null,
    });
  },
  clearCueSelection: () => set({ selectedCueId: null, selectedCueIds: [] }),
  setFps: (fps) => set({ fps }),
  setPlayUntil: (ms) => set({ playUntilMs: ms }),
  setActiveCueIds: (ids) => set({ activeCueIds: ids }),
  requestSeek: (ms) =>
    set((state) => ({
      currentTimeMs: ms,
      seekRequest: { ms, seq: (state.seekRequest?.seq ?? 0) + 1 },
    })),
}));
