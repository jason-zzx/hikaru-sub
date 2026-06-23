import { useEffect, useState } from "react";
import { getSettings } from "../services/tauri";

/** 读取全局字幕合并模式，供编辑页展示与 ASS 序列化保持一致。 */
export function useSubtitleMergeMode(): "inline" | "separate" {
  const [mergeMode, setMergeMode] = useState<"inline" | "separate">("inline");

  useEffect(() => {
    getSettings()
      .then((settings) => setMergeMode(settings.subtitleMergeMode))
      .catch(() => setMergeMode("inline"));
  }, []);

  return mergeMode;
}
