import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { checkFfmpeg } from "../../services/tauri";

export function StatusBar() {
  const isDirty = useProjectStore((s) => s.isDirty);
  const tasks = useTaskStore((s) => s.tasks);
  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null);

  const runningTask = Object.values(tasks).find((t) => t.status === "running");

  useEffect(() => {
    checkFfmpeg()
      .then((s) => setFfmpegOk(s.available))
      .catch(() => setFfmpegOk(false));
  }, []);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-surface-raised px-3 text-xs text-text-muted">
      <div className="flex items-center gap-4">
        <span>
          FFmpeg:{" "}
          {ffmpegOk === null ? "检测中…" : ffmpegOk ? "就绪" : "未找到"}
        </span>
        {isDirty && <span className="text-warning">未保存</span>}
      </div>
      <div>
        {runningTask
          ? `${runningTask.label} ${Math.round(runningTask.progress)}%`
          : "就绪"}
      </div>
    </footer>
  );
}
