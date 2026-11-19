import { useCallback, useEffect, useState } from "react";
import { checkFfmpeg, invalidateFfmpegStatus } from "../services/tauri";
import type { FfmpegStatus } from "../types";

/** 查询并缓存页面级 FFmpeg 可用状态，支持按需强制失效刷新。 */
export function useFfmpegStatus() {
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);

  const refreshFfmpeg = useCallback(async (force = false) => {
    if (force) invalidateFfmpegStatus();
    const next = await checkFfmpeg({ force });
    setFfmpeg(next);
    return next;
  }, []);

  useEffect(() => {
    refreshFfmpeg().catch(() => setFfmpeg(null));
  }, [refreshFfmpeg]);

  return { ffmpeg, refreshFfmpeg };
}
