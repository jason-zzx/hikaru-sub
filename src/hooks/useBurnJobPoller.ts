import { useEffect } from "react";
import { getBurnProgress } from "../services/tauri";
import { useBurnStore } from "../stores/burnStore";
import { useTaskStore } from "../stores/taskStore";

const POLL_INTERVAL_MS = 700;

/** 在 App 层轮询压制任务，切换页面后仍更新状态栏进度 */
export function useBurnJobPoller() {
  const jobId = useBurnStore((s) => s.jobId);
  const applySnapshot = useBurnStore((s) => s.applySnapshot);
  const finishJob = useBurnStore((s) => s.finishJob);
  const setError = useBurnStore((s) => s.setError);
  const updateTask = useTaskStore((s) => s.updateTask);

  useEffect(() => {
    if (!jobId) return;

    let active = true;

    const poll = async () => {
      while (active) {
        try {
          const snap = await getBurnProgress(jobId);
          applySnapshot(snap);
          if (snap.progress !== null) {
            updateTask("burn", {
              progress: Math.round(snap.progress * 100),
            });
          }
          if (
            snap.status === "completed" ||
            snap.status === "failed" ||
            snap.status === "cancelled"
          ) {
            if (snap.status === "completed") {
              updateTask("burn", { status: "success", progress: 100 });
            } else if (snap.status === "failed") {
              setError(snap.error ?? "压制失败");
              updateTask("burn", { status: "error" });
            } else {
              updateTask("burn", { status: "idle" });
            }
            finishJob();
            break;
          }
        } catch (e) {
          setError(String(e));
          updateTask("burn", { status: "error" });
          finishJob();
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    };

    void poll();
    return () => {
      active = false;
    };
  }, [jobId, applySnapshot, finishJob, setError, updateTask]);
}
