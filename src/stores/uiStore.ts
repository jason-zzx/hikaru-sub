import { create } from "zustand";
import type { SettingsCategory, WorkflowStep } from "../types";

interface UiState {
  currentStep: WorkflowStep;
  sidebarCollapsed: boolean;
  /**
   * Target settings category for the Settings page.
   * Set by `openSettings`; kept while `currentStep === "settings"` so Strict Mode
   * remounts still see the deep link; cleared when leaving Settings.
   */
  settingsCategory: SettingsCategory | null;
  /** 递增即请求编辑面板聚焦主文本框（Insert 新建字幕后使用） */
  editorFocusNonce: number;
  styleManagerOpen: boolean;
  setStep: (step: WorkflowStep) => void;
  /** Open Settings on a category (default: runtime). Prefer this over setStep("settings"). */
  openSettings: (category?: SettingsCategory) => void;
  toggleSidebar: () => void;
  requestEditorFocus: () => void;
  toggleStyleManager: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  currentStep: "welcome",
  sidebarCollapsed: false,
  settingsCategory: null,
  editorFocusNonce: 0,
  styleManagerOpen: false,
  setStep: (step) =>
    set({
      currentStep: step,
      ...(step !== "settings" ? { settingsCategory: null } : {}),
    }),
  openSettings: (category = "runtime") =>
    set({ currentStep: "settings", settingsCategory: category }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  requestEditorFocus: () =>
    set((state) => ({ editorFocusNonce: state.editorFocusNonce + 1 })),
  toggleStyleManager: () =>
    set((state) => ({ styleManagerOpen: !state.styleManagerOpen })),
}));
