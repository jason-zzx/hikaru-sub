import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AssScriptInfo, AssStyle, SubtitleCue } from "@/lib/ass";
import {
  checkPreviewFontGlyphs,
  type FontGlyphCoverageResult,
} from "../../services/fontCoverage";
import { findBestPreviewFontFile } from "../../services/libassFontSelection";
import type { PreviewFontFile } from "../../types";
import { buildPreviewAssText } from "../../utils/assPreviewDocument";
import {
  collectLibassGlyphFontChecks,
  libassGlyphCoverageKey,
  type LibassGlyphCoverageMap,
} from "../../utils/libassGlyphFallback";
import { AssSubtitleOverlay } from "./AssSubtitleOverlay";
import { LibassFallbackNotice } from "./LibassFallbackNotice";
import { LibassSubtitleOverlay } from "./LibassSubtitleOverlay";
import {
  findPreviewCue,
  getLibassFontKey,
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
  currentTimeMs: number;
  displayRect: SubtitlePreviewDisplayRect;
  videoElement?: HTMLVideoElement | null;
  followVideoFrames?: boolean;
  fontUrls?: string[];
  fontFiles?: PreviewFontFile[];
  availableFonts?: Record<string, string>;
  defaultFont?: string;
  glyphFallbackFont?: string;
  showFallbackNotice?: boolean;
}

function mergeGlyphCoverage(
  current: LibassGlyphCoverageMap,
  result: FontGlyphCoverageResult,
): LibassGlyphCoverageMap {
  const key = libassGlyphCoverageKey(result.fontName);
  const existing = current[key];
  const checked = new Set(existing?.checkedCodePoints ?? []);
  const missing = new Set(existing?.missingCodePoints ?? []);

  for (const codePoint of result.checkedCodePoints) {
    checked.add(codePoint);
  }
  for (const codePoint of result.missingCodePoints) {
    missing.add(codePoint);
  }

  return {
    ...current,
    [key]: {
      checkedCodePoints: [...checked],
      missingCodePoints: [...missing],
    },
  };
}

export function SubtitlePreview({
  rendererMode = "auto",
  cues,
  activeCueId,
  styles,
  scriptInfo,
  currentTimeMs,
  displayRect,
  videoElement,
  followVideoFrames = false,
  fontUrls = [],
  fontFiles = [],
  availableFonts,
  defaultFont,
  glyphFallbackFont,
  showFallbackNotice = true,
}: SubtitlePreviewProps) {
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [glyphCoverage, setGlyphCoverage] = useState<LibassGlyphCoverageMap>(
    {},
  );
  const glyphCoverageRef = useRef(glyphCoverage);
  const pendingGlyphChecksRef = useRef(new Set<string>());
  const activeCue = findPreviewCue(cues, activeCueId, currentTimeMs);
  const glyphCheckCues = useMemo(
    () => (activeCue ? [activeCue] : []),
    [activeCue],
  );
  const libassRenderTimeMs = getLibassRenderTimeMs(
    cues,
    activeCueId,
    currentTimeMs,
  );
  const assText = useMemo(
    () =>
      buildPreviewAssText({
        cues,
        styles,
        scriptInfo,
        libassFallbackFontName: glyphFallbackFont ?? defaultFont,
        libassGlyphCoverage: glyphCoverage,
      }),
    [
      cues,
      styles,
      scriptInfo,
      defaultFont,
      glyphCoverage,
      glyphFallbackFont,
    ],
  );
  const glyphChecks = useMemo(
    () =>
      collectLibassGlyphFontChecks({
        cues: glyphCheckCues,
        styles,
        mergeMode: "inline",
        fallbackFontName: glyphFallbackFont ?? defaultFont,
      }),
    [defaultFont, glyphCheckCues, glyphFallbackFont, styles],
  );
  const fontKey = useMemo(
    () =>
      getLibassFontKey({
        defaultFont,
        glyphFallbackFont,
        fontUrls,
        availableFonts,
      }),
    [availableFonts, defaultFont, fontUrls, glyphFallbackFont],
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

  useEffect(() => {
    setGlyphCoverage({});
    pendingGlyphChecksRef.current.clear();
  }, [fontKey]);

  useEffect(() => {
    glyphCoverageRef.current = glyphCoverage;
  }, [glyphCoverage]);

  useEffect(() => {
    let cancelled = false;

    for (const check of glyphChecks) {
      const font = findBestPreviewFontFile(fontFiles, check.fontName);
      if (!font) continue;

      const key = libassGlyphCoverageKey(check.fontName);
      const coverage = glyphCoverageRef.current[key];
      const checked = new Set(coverage?.checkedCodePoints ?? []);
      const pendingCodePoints = check.codePoints.filter((codePoint) => {
        const pendingKey = `${key}:${codePoint}`;
        return (
          !checked.has(codePoint) &&
          !pendingGlyphChecksRef.current.has(pendingKey)
        );
      });
      if (pendingCodePoints.length === 0) continue;

      for (const codePoint of pendingCodePoints) {
        pendingGlyphChecksRef.current.add(`${key}:${codePoint}`);
      }

      checkPreviewFontGlyphs(font, check.fontName, pendingCodePoints)
        .then((result) => {
          if (!cancelled) {
            setGlyphCoverage((current) => mergeGlyphCoverage(current, result));
          }
        })
        .catch((err) => {
          console.warn("字体字形检测失败:", err);
        })
        .finally(() => {
          for (const codePoint of pendingCodePoints) {
            pendingGlyphChecksRef.current.delete(`${key}:${codePoint}`);
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [fontFiles, glyphChecks]);

  return (
    <div className="pointer-events-none absolute inset-0">
      {!useCss && hasDisplayRect && (
        <div className="absolute overflow-hidden" style={overlayStyle}>
          <LibassSubtitleOverlay
            key={fontKey}
            assText={assText}
            fontUrls={fontUrls}
            availableFonts={availableFonts}
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
          mergeMode="inline"
          style={overlayStyle}
        />
      )}

      {useCss && showFallbackNotice && (
        <LibassFallbackNotice reason={fallbackReason ?? undefined} />
      )}
    </div>
  );
}
