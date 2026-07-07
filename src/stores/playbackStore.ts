import { create } from "zustand";

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
  setCurrentTime: (ms: number) => void;
  setDuration: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setSelectedCueId: (id: string | null) => void;
  setSelectedCueIds: (ids: string[]) => void;
  clearCueSelection: () => void;
  setFps: (fps: number | null) => void;
  setPlayUntil: (ms: number | null) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  currentTimeMs: 0,
  durationMs: 0,
  isPlaying: false,
  selectedCueId: null,
  selectedCueIds: [],
  fps: null,
  playUntilMs: null,
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
}));
