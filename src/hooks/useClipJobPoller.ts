import { useEffect, useRef } from "react";
import { getVideoClipProgress, prepareVideoSession } from "../services/tauri";
import { useClipStore } from "../stores/clipStore";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";

const POLL_INTERVAL_MS = 700;

/**
 * App 层轮询切片任务，并在任意页面完成收尾：
 * - 可选切换工作视频
 * - 解除 busy / 导航锁
 * - 写入成功提示供导入页展示
 *
 * 收尾以 store.jobId 是否仍为本次任务为准（取消会清掉 jobId），
 * 不依赖 effect 的 active 标志，避免 cleanup/Strict Mode 导致不 finishJob。
 */
export function useClipJobPoller() {
  const jobId = useClipStore((s) => s.jobId);
  const applySnapshot = useClipStore((s) => s.applySnapshot);
  const finishJob = useClipStore((s) => s.finishJob);
  const setError = useClipStore((s) => s.setError);
  const setSuccessMessage = useClipStore((s) => s.setSuccessMessage);
  const updateTask = useTaskStore((s) => s.updateTask);
  const setSession = useProjectStore((s) => s.setSession);
  const handledCompletedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    handledCompletedPathRef.current = null;
    let active = true;
    let reportedHardFallback = false;
    const polledJobId = jobId;

    const stillCurrent = () => useClipStore.getState().jobId === polledJobId;

    const finalizeCompleted = async (outputPath: string) => {
      if (handledCompletedPathRef.current === outputPath) return;
      if (!stillCurrent()) return;
      handledCompletedPathRef.current = outputPath;

      const useAsWorkingVideo = useClipStore.getState().useAsWorkingVideo;
      if (!useAsWorkingVideo) {
        if (!stillCurrent()) return;
        setSuccessMessage("切片完成，已保存到输出位置");
        finishJob();
        return;
      }

      try {
        const next = await prepareVideoSession(outputPath);
        // 取消或新任务已开始：不要切换会话 / 不要误报成功
        if (!stillCurrent()) return;
        setSession(next); // clears cues — do NOT loadAssDocument
        setSuccessMessage("切片完成，已设为当前工作视频");
        finishJob();
      } catch (e) {
        if (!stillCurrent()) return;
        setError(`打开切片视频失败：${String(e)}`);
        finishJob();
      }
    };

    const poll = async () => {
      while (active) {
        if (!stillCurrent()) break;
        try {
          const snap = await getVideoClipProgress(polledJobId);
          if (!stillCurrent()) break;
          applySnapshot(snap);
          if (snap.progress !== null) {
            updateTask("video-clip", {
              progress: Math.round(snap.progress * 100),
            });
          }
          if (snap.fellBackToHard && !reportedHardFallback) {
            reportedHardFallback = true;
            updateTask("video-clip", { message: "已改为硬切" });
          }
          if (
            snap.status === "completed" ||
            snap.status === "failed" ||
            snap.status === "cancelled"
          ) {
            if (!stillCurrent()) break;
            if (snap.status === "completed") {
              updateTask("video-clip", { status: "success", progress: 100 });
              const outputPath = snap.outputPath;
              if (outputPath) {
                await finalizeCompleted(outputPath);
              } else if (stillCurrent()) {
                setError("切片完成但未返回输出路径");
                finishJob();
              }
            } else if (snap.status === "failed") {
              setError(snap.error ?? "切片失败");
              updateTask("video-clip", { status: "error" });
              finishJob();
            } else {
              updateTask("video-clip", { status: "idle" });
              finishJob();
            }
            break;
          }
        } catch (e) {
          if (!stillCurrent()) break;
          setError(String(e));
          updateTask("video-clip", { status: "error" });
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
  }, [
    jobId,
    applySnapshot,
    finishJob,
    setError,
    setSuccessMessage,
    setSession,
    updateTask,
  ]);
}
