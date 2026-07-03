import { create } from "zustand";
import type { WorkflowStep } from "../types";

interface UiState {
  currentStep: WorkflowStep;
  sidebarCollapsed: boolean;
  /** 递增即请求编辑面板聚焦主文本框（Insert 新建字幕后使用） */
  editorFocusNonce: number;
  setStep: (step: WorkflowStep) => void;
  toggleSidebar: () => void;
  requestEditorFocus: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  currentStep: "welcome",
  sidebarCollapsed: false,
  editorFocusNonce: 0,
  setStep: (step) => set({ currentStep: step }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  requestEditorFocus: () =>
    set((state) => ({ editorFocusNonce: state.editorFocusNonce + 1 })),
}));
