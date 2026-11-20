import { create } from "zustand";
import type { WaveformData } from "../types";

interface EditorViewState {
  initializedDocumentEpoch: number | null;
  timelineViewStartMs: number | null;
  timelineLaneScrollTop: number;
  listScrollTop: number | null;
  selectionAnchorId: string | null;

  timelineMsPerPixel: number;
  timelineWaveformGain: number;
  waveformCache: { videoPath: string; samples: number; data: WaveformData } | null;
  videoPlaybackCache: { videoPath: string; videoSrc: string; usedTranscode: boolean } | null;
  videoFpsCache: { videoPath: string; fps: number | null } | null;

  resetForDocument: () => void;
  resetForSession: () => void;
}

const documentInitialState = {
  initializedDocumentEpoch: null as number | null,
  timelineViewStartMs: null as number | null,
  timelineLaneScrollTop: 0,
  listScrollTop: null as number | null,
  selectionAnchorId: null as string | null,
};

const sessionInitialState = {
  ...documentInitialState,
  timelineMsPerPixel: 10,
  timelineWaveformGain: 1,
  waveformCache: null as EditorViewState["waveformCache"],
  videoPlaybackCache: null as EditorViewState["videoPlaybackCache"],
  videoFpsCache: null as EditorViewState["videoFpsCache"],
};

export const useEditorViewStore = create<EditorViewState>((set) => ({
  ...sessionInitialState,
  resetForDocument: () => set({ ...documentInitialState }),
  resetForSession: () => set({ ...sessionInitialState }),
}));
