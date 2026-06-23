import { create } from "zustand";
import { produce } from "immer";
import type { AssDocument, AssScriptInfo, AssStyle } from "@hikaru/ass-core";
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
  assScriptInfo: AssScriptInfo | null;
  assStyles: AssStyle[];
  isDirty: boolean;
  history: HistoryState;
  setProject: (project: ProjectMeta, projectDir: string) => void;
  clearProject: () => void;
  loadAssDocument: (doc: AssDocument) => void;
  setAssMetadata: (scriptInfo: AssScriptInfo, styles: AssStyle[]) => void;
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

const emptyAssState = {
  assScriptInfo: null as AssScriptInfo | null,
  assStyles: [] as AssStyle[],
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  projectDir: null,
  videoPath: null,
  cues: [],
  ...emptyAssState,
  isDirty: false,
  history: { past: [], future: [] },

  setProject: (project, projectDir) =>
    set({
      project,
      projectDir,
      videoPath: project.videoPath,
      cues: [],
      ...emptyAssState,
      isDirty: false,
      history: { past: [], future: [] },
    }),

  clearProject: () =>
    set({
      project: null,
      projectDir: null,
      videoPath: null,
      cues: [],
      ...emptyAssState,
      isDirty: false,
      history: { past: [], future: [] },
    }),

  loadAssDocument: (doc) =>
    set({
      cues: doc.cues,
      assScriptInfo: doc.scriptInfo,
      assStyles: doc.styles,
      isDirty: false,
      history: { past: [], future: [] },
    }),

  setAssMetadata: (scriptInfo, styles) =>
    set({
      assScriptInfo: scriptInfo,
      assStyles: styles,
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
