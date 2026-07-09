import { create } from "zustand";
import type { ClipSnapshot } from "../types";

interface ClipStoreState {
  jobId: string | null;
  snapshot: ClipSnapshot | null;
  error: string | null;
  completedPath: string | null;
  busy: boolean;
  /** 本次切片完成后是否切换为工作视频（随 startJob 写入） */
  useAsWorkingVideo: boolean;
  /** 完成提示（App 层写入，ImportView 展示） */
  successMessage: string | null;
  startJob: (id: string, opts?: { useAsWorkingVideo?: boolean }) => void;
  applySnapshot: (snap: ClipSnapshot) => void;
  setError: (error: string | null) => void;
  setSuccessMessage: (message: string | null) => void;
  finishJob: () => void;
  resetForStart: () => void;
  clearAfterCancel: () => void;
  clearSuccessMessage: () => void;
}

export const useClipStore = create<ClipStoreState>((set) => ({
  jobId: null,
  snapshot: null,
  error: null,
  completedPath: null,
  busy: false,
  useAsWorkingVideo: true,
  successMessage: null,
  startJob: (id, opts) =>
    set({
      jobId: id,
      busy: true,
      error: null,
      completedPath: null,
      snapshot: null,
      successMessage: null,
      useAsWorkingVideo: opts?.useAsWorkingVideo ?? true,
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
  setSuccessMessage: (message) => set({ successMessage: message }),
  finishJob: () =>
    set({ jobId: null, busy: false, completedPath: null, snapshot: null }),
  resetForStart: () =>
    set({
      error: null,
      completedPath: null,
      snapshot: null,
      successMessage: null,
    }),
  clearAfterCancel: () =>
    set({
      jobId: null,
      busy: false,
      snapshot: null,
      completedPath: null,
      successMessage: null,
      error: null,
    }),
  clearSuccessMessage: () => set({ successMessage: null }),
}));

