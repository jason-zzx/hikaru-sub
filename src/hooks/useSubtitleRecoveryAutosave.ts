import { useEffect } from "react";
import { useProjectStore } from "../stores/projectStore";
import { saveCurrentSubtitleRecovery } from "../services/subtitleRecovery";

const RECOVERY_INTERVAL_MS = 5_000;

export function useSubtitleRecoveryAutosave() {
  const videoPath = useProjectStore((state) => state.session?.videoPath);

  useEffect(() => {
    if (!videoPath) return;

    const timer = window.setInterval(() => {
      void saveCurrentSubtitleRecovery().catch(() => undefined);
    }, RECOVERY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [videoPath]);
}
