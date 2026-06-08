import { create } from "zustand";

export type TaskStatus = "idle" | "running" | "success" | "error";

export interface TaskState {
  id: string;
  label: string;
  status: TaskStatus;
  progress: number;
  message?: string;
}

interface TaskStoreState {
  tasks: Record<string, TaskState>;
  upsertTask: (task: TaskState) => void;
  updateTask: (id: string, patch: Partial<TaskState>) => void;
  removeTask: (id: string) => void;
  clearTasks: () => void;
}

export const useTaskStore = create<TaskStoreState>((set) => ({
  tasks: {},
  upsertTask: (task) =>
    set((state) => ({
      tasks: { ...state.tasks, [task.id]: task },
    })),
  updateTask: (id, patch) =>
    set((state) => {
      const existing = state.tasks[id];
      if (!existing) return state;
      return {
        tasks: { ...state.tasks, [id]: { ...existing, ...patch } },
      };
    }),
  removeTask: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.tasks;
      return { tasks: rest };
    }),
  clearTasks: () => set({ tasks: {} }),
}));
