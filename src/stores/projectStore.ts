import { create } from "zustand";
import { produce } from "immer";
import type { ProjectMeta, SubtitleCue } from "../types";

interface HistoryState {
  past: SubtitleCue[][];
  future: SubtitleCue[][];
}

interface ProjectState {
  project: ProjectMeta | null;
  projectDir: string | null;
  videoPath: string | null;
  cues: SubtitleCue[];
  isDirty: boolean;
  history: HistoryState;
  setProject: (project: ProjectMeta, projectDir: string) => void;
  clearProject: () => void;
  setCues: (cues: SubtitleCue[]) => void;
  updateCue: (id: string, updates: Partial<SubtitleCue>) => void;
  addCue: (cue: SubtitleCue) => void;
  deleteCue: (id: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  markDirty: () => void;
  markSaved: () => void;
}

const MAX_HISTORY = 50;

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  projectDir: null,
  videoPath: null,
  cues: [],
  isDirty: false,
  history: { past: [], future: [] },

  setProject: (project, projectDir) =>
    set({
      project,
      projectDir,
      videoPath: project.videoPath,
      cues: [],
      isDirty: false,
      history: { past: [], future: [] },
    }),

  clearProject: () =>
    set({
      project: null,
      projectDir: null,
      videoPath: null,
      cues: [],
      isDirty: false,
      history: { past: [], future: [] },
    }),

  setCues: (cues) =>
    set({
      cues,
      isDirty: true,
      history: { past: [], future: [] },
    }),

  updateCue: (id, updates) =>
    set((state) => {
      const newCues = produce(state.cues, (draft) => {
        const cue = draft.find((c) => c.id === id);
        if (cue) {
          Object.assign(cue, updates);
        }
      });
      const newPast = [...state.history.past, state.cues].slice(-MAX_HISTORY);
      return {
        cues: newCues,
        isDirty: true,
        history: { past: newPast, future: [] },
      };
    }),

  addCue: (cue) =>
    set((state) => {
      const newCues = [...state.cues, cue].sort((a, b) => a.startMs - b.startMs);
      const newPast = [...state.history.past, state.cues].slice(-MAX_HISTORY);
      return {
        cues: newCues,
        isDirty: true,
        history: { past: newPast, future: [] },
      };
    }),

  deleteCue: (id) =>
    set((state) => {
      const newCues = state.cues.filter((c) => c.id !== id);
      const newPast = [...state.history.past, state.cues].slice(-MAX_HISTORY);
      return {
        cues: newCues,
        isDirty: true,
        history: { past: newPast, future: [] },
      };
    }),

  undo: () =>
    set((state) => {
      if (state.history.past.length === 0) return state;
      const previous = state.history.past[state.history.past.length - 1];
      const newPast = state.history.past.slice(0, -1);
      const newFuture = [state.cues, ...state.history.future].slice(0, MAX_HISTORY);
      return {
        cues: previous,
        isDirty: true,
        history: { past: newPast, future: newFuture },
      };
    }),

  redo: () =>
    set((state) => {
      if (state.history.future.length === 0) return state;
      const next = state.history.future[0];
      const newFuture = state.history.future.slice(1);
      const newPast = [...state.history.past, state.cues].slice(-MAX_HISTORY);
      return {
        cues: next,
        isDirty: true,
        history: { past: newPast, future: newFuture },
      };
    }),

  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0,

  markDirty: () => set({ isDirty: true }),
  markSaved: () => set({ isDirty: false }),
}));
