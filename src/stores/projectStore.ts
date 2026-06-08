import { create } from "zustand";
import type { ProjectMeta, SubtitleCue } from "../types";

interface ProjectState {
  project: ProjectMeta | null;
  projectDir: string | null;
  cues: SubtitleCue[];
  isDirty: boolean;
  setProject: (project: ProjectMeta, projectDir: string) => void;
  clearProject: () => void;
  setCues: (cues: SubtitleCue[]) => void;
  markDirty: () => void;
  markSaved: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: null,
  projectDir: null,
  cues: [],
  isDirty: false,
  setProject: (project, projectDir) =>
    set({ project, projectDir, cues: [], isDirty: false }),
  clearProject: () =>
    set({ project: null, projectDir: null, cues: [], isDirty: false }),
  setCues: (cues) => set({ cues, isDirty: true }),
  markDirty: () => set({ isDirty: true }),
  markSaved: () => set({ isDirty: false }),
}));
