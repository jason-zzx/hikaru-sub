import { create } from "zustand";
import type { BurnSnapshot } from "../types";

interface BurnStoreState {
  jobId: string | null;
  snapshot: BurnSnapshot | null;
  error: string | null;
  completedPath: string | null;
  busy: boolean;
  startJob: (id: string) => void;
  applySnapshot: (snap: BurnSnapshot) => void;
  setError: (error: string | null) => void;
  finishJob: () => void;
  resetForStart: () => void;
  clearAfterCancel: () => void;
}

export const useBurnStore = create<BurnStoreState>((set) => ({
  jobId: null,
  snapshot: null,
  error: null,
  completedPath: null,
  busy: false,
  startJob: (id) =>
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
  resetForStart: () =>
    set({ error: null, completedPath: null, snapshot: null }),
  clearAfterCancel: () =>
    set({ jobId: null, busy: false, snapshot: null }),
}));
