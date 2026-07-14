import {
  createDefaultScriptInfo,
  createDefaultStyles,
  type AssDocument,
  type AssScriptInfo,
  type AssStyle,
  type SubtitleCue,
} from "@/lib/ass";

export interface ResolveAssDocumentOptions {
  /** 无已存 Script Info 时，用视频分辨率初始化 PlayRes */
  fallbackPlayRes?: { width: number; height: number };
  title?: string;
}

/**
 * 保存前组装完整 ASS 文档。
 * 优先沿用转录/翻译阶段写入的 Script Info（含 PlayRes），不主动覆盖分辨率。
 */
export function resolveAssDocumentForSave(
  cues: SubtitleCue[],
  storedScriptInfo: AssScriptInfo | null,
  storedStyles: AssStyle[],
  options: ResolveAssDocumentOptions = {},
): AssDocument {
  const title = options.title ?? "Hikaru-Sub";
  const scriptInfo =
    storedScriptInfo ??
    createDefaultScriptInfo(
      title,
      options.fallbackPlayRes?.width,
      options.fallbackPlayRes?.height,
    );

  const styles = storedStyles.length > 0 ? storedStyles : createDefaultStyles();

  return { scriptInfo, styles, cues };
}
