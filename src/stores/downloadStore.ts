import { create } from "zustand";
import type { DownloadMode, DownloadSnapshot } from "../types";

interface DownloadFormState {
  mode: DownloadMode;
  name: string;
  videoUrl: string;
  audioUrl: string;
  headers: string;
  saveDir: string;
}

interface DownloadStoreState extends DownloadFormState {
  jobId: string | null;
  snapshot: DownloadSnapshot | null;
  error: string | null;
  completedPath: string | null;
  busy: boolean;
  setForm: (patch: Partial<DownloadFormState>) => void;
  startJob: (id?: string | null) => void;
  applySnapshot: (snap: DownloadSnapshot) => void;
  setError: (error: string | null) => void;
  finishJob: () => void;
  resetAll: () => void;
}

const INITIAL_STATE: DownloadFormState & {
  jobId: string | null;
  snapshot: DownloadSnapshot | null;
  error: string | null;
  completedPath: string | null;
  busy: boolean;
} = {
  mode: "single",
  name: "",
  videoUrl: "",
  audioUrl: "",
  headers: "",
  saveDir: "",
  jobId: null,
  snapshot: null,
  error: null,
  completedPath: null,
  busy: false,
};

export const useDownloadStore = create<DownloadStoreState>((set) => ({
  ...INITIAL_STATE,
  setForm: (patch) => set(patch),
  startJob: (id = null) =>
    set({
      jobId: id,
      busy: true,
      error: null,
      completedPath: null,
      snapshot: null,
    }),
  applySnapshot: (snap) =>
    set((state) => ({
      snapshot: snap,
      completedPath:
        snap.status === "completed" && snap.outputPath
          ? snap.outputPath
          : state.completedPath,
    })),
  setError: (error) => set({ error }),
  finishJob: () => set({ jobId: null, busy: false }),
  resetAll: () => set(INITIAL_STATE),
}));
