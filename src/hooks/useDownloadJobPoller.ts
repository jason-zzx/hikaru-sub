import { useEffect } from "react";
import { getVideoDownloadProgress } from "../services/tauri";
import { useDownloadStore } from "../stores/downloadStore";
import { useTaskStore } from "../stores/taskStore";

const POLL_INTERVAL_MS = 700;

/** 在 App 层轮询视频下载任务，切换页面后仍保持轮询并更新状态栏进度 */
export function useDownloadJobPoller() {
  const jobId = useDownloadStore((s) => s.jobId);
  const applySnapshot = useDownloadStore((s) => s.applySnapshot);
  const finishJob = useDownloadStore((s) => s.finishJob);
  const setError = useDownloadStore((s) => s.setError);
  const updateTask = useTaskStore((s) => s.updateTask);

  useEffect(() => {
    if (!jobId) return;

    let active = true;
    const polledJobId = jobId;
    const stillCurrent = () => useDownloadStore.getState().jobId === polledJobId;

    const poll = async () => {
      while (active) {
        if (!stillCurrent()) break;
        try {
          const snap = await getVideoDownloadProgress(polledJobId);
          if (!stillCurrent()) break;
          applySnapshot(snap);
          if (snap.progress !== null) {
            updateTask("video-download", {
              progress: Math.round(snap.progress * 100),
            });
          }
          if (
            snap.status === "completed" ||
            snap.status === "failed" ||
            snap.status === "cancelled"
          ) {
            if (snap.status === "completed" && snap.outputPath) {
              updateTask("video-download", { status: "success", progress: 100 });
            } else if (snap.status === "completed") {
              setError("下载完成但未返回输出路径");
              updateTask("video-download", { status: "error" });
            } else if (snap.status === "failed") {
              setError(snap.error ?? "下载失败");
              updateTask("video-download", { status: "error" });
            } else {
              updateTask("video-download", { status: "idle" });
            }
            finishJob();
            break;
          }
        } catch (e) {
          if (!stillCurrent()) break;
          setError(String(e));
          updateTask("video-download", { status: "error" });
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
