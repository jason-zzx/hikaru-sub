import { create } from "zustand";

interface PlaybackState {
  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
  selectedCueId: string | null;
  setCurrentTime: (ms: number) => void;
  setDuration: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setSelectedCueId: (id: string | null) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  currentTimeMs: 0,
  durationMs: 0,
  isPlaying: false,
  selectedCueId: null,
  setCurrentTime: (ms) => set({ currentTimeMs: ms }),
  setDuration: (ms) => set({ durationMs: ms }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setSelectedCueId: (id) => set({ selectedCueId: id }),
}));
