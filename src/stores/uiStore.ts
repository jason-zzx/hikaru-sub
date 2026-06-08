import { create } from "zustand";
import type { WorkflowStep } from "../types";

interface UiState {
  currentStep: WorkflowStep;
  sidebarCollapsed: boolean;
  setStep: (step: WorkflowStep) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  currentStep: "welcome",
  sidebarCollapsed: false,
  setStep: (step) => set({ currentStep: step }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
