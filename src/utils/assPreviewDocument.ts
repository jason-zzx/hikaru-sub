import {
  serializeAss,
  type AssScriptInfo,
  type AssStyle,
  type SubtitleCue,
} from "@/lib/ass";
import { resolveAssDocumentForSave } from "./assDocument";
import {
  applyLibassGlyphFallbackToCues,
  type LibassGlyphCoverageMap,
} from "./libassGlyphFallback";

interface BuildPreviewAssTextArgs {
  cues: SubtitleCue[];
  styles: AssStyle[];
  scriptInfo: AssScriptInfo | null;
  libassFallbackFontName?: string;
  libassGlyphCoverage?: LibassGlyphCoverageMap;
}

export function buildPreviewAssText({
  cues,
  styles,
  scriptInfo,
  libassFallbackFontName,
  libassGlyphCoverage,
}: BuildPreviewAssTextArgs): string {
  const doc = resolveAssDocumentForSave(cues, scriptInfo, styles);
  const fallbackCues = applyLibassGlyphFallbackToCues({
    cues: doc.cues,
    styles: doc.styles,
    // Physical rows have no secondaryText; inline is a no-op default for the glyph helper.
    mergeMode: "inline",
    fallbackFontName: libassFallbackFontName,
    glyphCoverage: libassGlyphCoverage,
  });
  return serializeAss(
    {
      ...doc,
      cues: fallbackCues,
    },
    { preserveOrder: true },
  );
}
