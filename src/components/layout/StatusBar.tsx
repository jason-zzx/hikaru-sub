import { useTaskStore } from "../../stores/taskStore";

export function StatusBar() {
  const tasks = useTaskStore((s) => s.tasks);
  const runningTask = Object.values(tasks).find((t) => t.status === "running");

  return (
    <footer className="flex h-7 shrink-0 items-center justify-end border-t border-border bg-surface-raised px-3 text-xs text-text-muted">
      <div>
        {runningTask
          ? `${runningTask.label} ${Math.round(runningTask.progress)}%`
          : "暂无进行中的任务"}
      </div>
    </footer>
  );
}
