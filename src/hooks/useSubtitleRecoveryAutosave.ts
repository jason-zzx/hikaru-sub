import { useEffect } from "react";
import { useProjectStore } from "../stores/projectStore";
import {
  clearSubtitleRecoveryIfClean,
  saveCurrentSubtitleRecovery,
} from "../services/subtitleRecovery";

const RECOVERY_INTERVAL_MS = 5_000;

export function useSubtitleRecoveryAutosave() {
  const videoPath = useProjectStore((state) => state.session?.videoPath);

  useEffect(
    () =>
      useProjectStore.subscribe((state, previous) => {
        const currentVideoPath = state.session?.videoPath;
        if (
          currentVideoPath &&
          currentVideoPath === previous.session?.videoPath &&
          previous.isDirty &&
          !state.isDirty
        ) {
          void clearSubtitleRecoveryIfClean(currentVideoPath).catch((err) =>
            console.warn("清理字幕恢复文件失败:", err),
          );
        }
      }),
    [],
  );

  useEffect(() => {
    if (!videoPath) return;

    const timer = window.setInterval(() => {
      void saveCurrentSubtitleRecovery().catch(() => undefined);
    }, RECOVERY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [videoPath]);
}
