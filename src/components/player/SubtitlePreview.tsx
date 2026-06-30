import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AssScriptInfo, AssStyle, SubtitleCue } from "@hikaru/ass-core";
import { buildPreviewAssText } from "../../utils/assPreviewDocument";
import { AssSubtitleOverlay } from "./AssSubtitleOverlay";
import { LibassFallbackNotice } from "./LibassFallbackNotice";
import { LibassSubtitleOverlay } from "./LibassSubtitleOverlay";
import {
  findPreviewCue,
  getLibassRenderTimeMs,
  shouldUseCssFallback,
  type SubtitlePreviewRendererMode,
} from "./subtitlePreviewModel";

export interface SubtitlePreviewDisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SubtitlePreviewProps {
  rendererMode?: SubtitlePreviewRendererMode;
  cues: SubtitleCue[];
  activeCueId: string | null;
  styles: AssStyle[];
  scriptInfo: AssScriptInfo | null;
  mergeMode: "inline" | "separate";
  currentTimeMs: number;
  displayRect: SubtitlePreviewDisplayRect;
  videoElement?: HTMLVideoElement | null;
  followVideoFrames?: boolean;
  fontUrls?: string[];
  defaultFont?: string;
  showFallbackNotice?: boolean;
}

export function SubtitlePreview({
  rendererMode = "auto",
  cues,
  activeCueId,
  styles,
  scriptInfo,
  mergeMode,
  currentTimeMs,
  displayRect,
  videoElement,
  followVideoFrames = false,
  fontUrls = [],
  defaultFont,
  showFallbackNotice = true,
}: SubtitlePreviewProps) {
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const activeCue = findPreviewCue(cues, activeCueId, currentTimeMs);
  const libassRenderTimeMs = getLibassRenderTimeMs(
    cues,
    activeCueId,
    currentTimeMs,
  );
  const assText = useMemo(
    () => buildPreviewAssText({ cues, styles, scriptInfo, mergeMode }),
    [cues, styles, scriptInfo, mergeMode],
  );
  const fontKey = useMemo(
    () => `${defaultFont ?? ""}\n${fontUrls.join("\n")}`,
    [defaultFont, fontUrls],
  );
  const hasDisplayRect = displayRect.width > 0 && displayRect.height > 0;
  const libassAvailable = rendererMode !== "css" && hasDisplayRect;
  const useCss = shouldUseCssFallback(
    rendererMode,
    libassAvailable,
    fallbackReason,
  );
  const overlayStyle: CSSProperties = {
    left: displayRect.left,
    top: displayRect.top,
    width: displayRect.width,
    height: displayRect.height,
  };

  useEffect(() => {
    setFallbackReason(null);
  }, [assText, fontKey, rendererMode]);

  return (
    <div className="pointer-events-none absolute inset-0">
      {!useCss && hasDisplayRect && (
        <div className="absolute overflow-hidden" style={overlayStyle}>
          <LibassSubtitleOverlay
            key={fontKey}
            assText={assText}
            fontUrls={fontUrls}
            defaultFont={defaultFont}
            width={displayRect.width}
            height={displayRect.height}
            renderTimeMs={libassRenderTimeMs}
            videoElement={videoElement}
            followVideoFrames={followVideoFrames}
            onUnavailable={setFallbackReason}
          />
        </div>
      )}

      {useCss && activeCue && (
        <AssSubtitleOverlay
          cue={activeCue}
          styles={styles}
          scriptInfo={scriptInfo}
          mergeMode={mergeMode}
          style={overlayStyle}
        />
      )}

      {useCss && showFallbackNotice && (
        <LibassFallbackNotice reason={fallbackReason ?? undefined} />
      )}
    </div>
  );
}
