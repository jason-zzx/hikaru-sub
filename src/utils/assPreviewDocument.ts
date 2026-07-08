import {
  serializeAss,
  type AssScriptInfo,
  type AssStyle,
  type SubtitleCue,
} from "@hikaru/ass-core";
import { resolveAssDocumentForSave } from "./assDocument";
import {
  applyLibassGlyphFallbackToCues,
  type LibassGlyphCoverageMap,
} from "./libassGlyphFallback";

interface BuildPreviewAssTextArgs {
  cues: SubtitleCue[];
  styles: AssStyle[];
  scriptInfo: AssScriptInfo | null;
  mergeMode: "inline" | "separate";
  libassFallbackFontName?: string;
  libassGlyphCoverage?: LibassGlyphCoverageMap;
}

export function buildPreviewAssText({
  cues,
  styles,
  scriptInfo,
  mergeMode,
  libassFallbackFontName,
  libassGlyphCoverage,
}: BuildPreviewAssTextArgs): string {
  const doc = resolveAssDocumentForSave(cues, scriptInfo, styles);
  const fallbackCues = applyLibassGlyphFallbackToCues({
    cues: doc.cues,
    styles: doc.styles,
    mergeMode,
    fallbackFontName: libassFallbackFontName,
    glyphCoverage: libassGlyphCoverage,
  });
  return serializeAss(
    {
      ...doc,
      cues: fallbackCues,
    },
    { mergeMode },
  );
}
