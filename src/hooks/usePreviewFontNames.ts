import { useEffect, useMemo, useState } from "react";
import { discoverPreviewFonts } from "../services/tauri";

const FONT_STYLE_SUFFIX =
  /[-_\s](regular|bold|italic|bolditalic|bold-italic|medium|semibold|semi-bold|light|thin|black|heavy|demibold|demi-bold|book|oblique)$/i;

function fontNameFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.(ttf|otf|ttc|otc)$/i, "");
  return stem.replace(FONT_STYLE_SUFFIX, "").trim() || stem;
}

export function fontNamesFromFiles(fileNames: string[]): string[] {
  return Array.from(
    new Set(fileNames.map(fontNameFromFileName).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function usePreviewFontNames(extraNames: string[] = []) {
  const [discoveredNames, setDiscoveredNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    discoverPreviewFonts()
      .then((fonts) => {
        if (cancelled) return;
        setDiscoveredNames(
          fontNamesFromFiles(fonts.map((font) => font.fileName)),
        );
      })
      .catch(() => {
        if (!cancelled) setDiscoveredNames([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () =>
      Array.from(new Set([...extraNames.filter(Boolean), ...discoveredNames])),
    [discoveredNames, extraNames],
  );
}
