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
  resolveSegmentStopPreview,
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
  /** null/undefined 为普通预览；非 null 时是 activeCueTracker 的停点命中集合。 */
  segmentStopCueIds?: string[] | null;
}

interface GlyphCoverageState {
  contextKey: string;
  coverage: LibassGlyphCoverageMap;
}

const EMPTY_GLYPH_COVERAGE: LibassGlyphCoverageMap = {};

function getGlyphCoverageContextKey(
  fontKey: string,
  fontFiles: PreviewFontFile[],
): string {
  return JSON.stringify([fontKey, fontFiles]);
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
  segmentStopCueIds,
}: SubtitlePreviewProps) {
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
  const glyphContextKey = useMemo(
    () => getGlyphCoverageContextKey(fontKey, fontFiles),
    [fontFiles, fontKey],
  );
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [glyphCoverageState, setGlyphCoverageState] =
    useState<GlyphCoverageState>(() => ({
      contextKey: glyphContextKey,
      coverage: EMPTY_GLYPH_COVERAGE,
    }));
  const glyphCoverage =
    glyphCoverageState.contextKey === glyphContextKey
      ? glyphCoverageState.coverage
      : EMPTY_GLYPH_COVERAGE;
  const glyphCoverageRef = useRef({
    contextKey: glyphContextKey,
    coverage: glyphCoverage,
  });
  glyphCoverageRef.current = {
    contextKey: glyphContextKey,
    coverage: glyphCoverage,
  };
  const pendingGlyphChecksRef = useRef(new Set<string>());
  const activeCue = findPreviewCue(cues, activeCueId, currentTimeMs);
  const segmentStopPreview = useMemo(
    () =>
      resolveSegmentStopPreview(
        cues,
        segmentStopCueIds ?? null,
        currentTimeMs,
      ),
    [cues, currentTimeMs, segmentStopCueIds],
  );
  const previewCues = segmentStopPreview?.cues ?? cues;
  const cssCues = segmentStopPreview?.cues ?? (activeCue ? [activeCue] : []);
  const glyphCheckCues = useMemo(
    () => segmentStopPreview?.cues ?? (activeCue ? [activeCue] : []),
    [activeCue, segmentStopPreview],
  );
  const libassRenderTimeMs =
    segmentStopPreview?.renderTimeMs ??
    getLibassRenderTimeMs(cues, activeCueId, currentTimeMs);
  const assText = useMemo(
    () =>
      buildPreviewAssText({
        cues: previewCues,
        styles,
        scriptInfo,
        libassFallbackFontName: glyphFallbackFont ?? defaultFont,
        libassGlyphCoverage: glyphCoverage,
      }),
    [
      previewCues,
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
    const requestContextKey = glyphContextKey;

    for (const check of glyphChecks) {
      const font = findBestPreviewFontFile(fontFiles, check.fontName);
      if (!font) continue;

      const key = libassGlyphCoverageKey(check.fontName);
      const coverage =
        glyphCoverageRef.current.contextKey === requestContextKey
          ? glyphCoverageRef.current.coverage[key]
          : undefined;
      const checked = new Set(coverage?.checkedCodePoints ?? []);
      const pendingCodePoints = check.codePoints.filter((codePoint) => {
        const pendingKey = `${requestContextKey}\0${key}:${codePoint}`;
        return (
          !checked.has(codePoint) &&
          !pendingGlyphChecksRef.current.has(pendingKey)
        );
      });
      if (pendingCodePoints.length === 0) continue;

      for (const codePoint of pendingCodePoints) {
        pendingGlyphChecksRef.current.add(
          `${requestContextKey}\0${key}:${codePoint}`,
        );
      }

      checkPreviewFontGlyphs(font, check.fontName, pendingCodePoints)
        .then((result) => {
          // 卸载后 setState 是 no-op；只需拦截过期上下文的检测结果
          if (glyphCoverageRef.current.contextKey === requestContextKey) {
            setGlyphCoverageState((current) => ({
              contextKey: requestContextKey,
              coverage: mergeGlyphCoverage(
                current.contextKey === requestContextKey
                  ? current.coverage
                  : EMPTY_GLYPH_COVERAGE,
                result,
              ),
            }));
          }
        })
        .catch((err) => {
          console.warn("字体字形检测失败:", err);
        })
        .finally(() => {
          for (const codePoint of pendingCodePoints) {
            pendingGlyphChecksRef.current.delete(
              `${requestContextKey}\0${key}:${codePoint}`,
            );
          }
        });
    }
  }, [fontFiles, glyphChecks, glyphContextKey]);

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

      {useCss &&
        // 按 ASS Layer 升序排 DOM：高层级后排绘制在上层，与 libass 层叠一致
        [...cssCues]
          .sort((a, b) => a.layer - b.layer)
          .map((cue) => (
            <AssSubtitleOverlay
              key={cue.id}
              cue={cue}
              styles={styles}
              scriptInfo={scriptInfo}
              mergeMode="inline"
              style={overlayStyle}
            />
          ))}

      {useCss && showFallbackNotice && (
        <LibassFallbackNotice reason={fallbackReason ?? undefined} />
      )}
    </div>
  );
}
