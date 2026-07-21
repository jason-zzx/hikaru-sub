import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exitApp } from "../services/tauri";
import {
  discardSubtitleRecovery,
  resumeSubtitleRecovery,
  saveCurrentSubtitleRecovery,
} from "../services/subtitleRecovery";
import { useProjectStore } from "../stores/projectStore";

export function useUnsavedChangesCloseGuard() {
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [closePromptError, setClosePromptError] = useState<string | null>(null);
  const closeRequestPendingRef = useRef(false);

  const respondToClosePrompt = useCallback(async (shouldClose: boolean) => {
    setClosePromptOpen(false);
    setClosePromptError(null);
    if (!shouldClose) {
      closeRequestPendingRef.current = false;
      return;
    }

    const videoPath = useProjectStore.getState().session?.videoPath;
    if (videoPath) {
      try {
        await discardSubtitleRecovery(videoPath);
      } catch (err) {
        setClosePromptError(`清理字幕恢复文件失败：${String(err)}`);
        setClosePromptOpen(true);
        closeRequestPendingRef.current = false;
        return;
      }
    }

    try {
      await exitApp();
    } catch (err) {
      if (videoPath) {
        resumeSubtitleRecovery(videoPath);
        void saveCurrentSubtitleRecovery().catch(() => undefined);
      }
      setClosePromptError(`关闭应用失败：${String(err)}`);
      setClosePromptOpen(true);
      closeRequestPendingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void appWindow
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closeRequestPendingRef.current) return;
        closeRequestPendingRef.current = true;

        setClosePromptError(null);
        if (!useProjectStore.getState().isDirty) {
          try {
            await exitApp();
          } catch {
            closeRequestPendingRef.current = false;
          }
          return;
        }
        setClosePromptOpen(true);
      })
      .then((nextUnlisten) => {
        if (disposed) nextUnlisten();
        else unlisten = nextUnlisten;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return { closePromptOpen, closePromptError, respondToClosePrompt };
}
