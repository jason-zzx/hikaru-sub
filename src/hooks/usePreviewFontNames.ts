import { useEffect, useMemo, useState } from "react";
import { discoverPreviewFonts } from "../services/tauri";
import type { PreviewFontFile } from "../types";
import { previewFontNameFromFileName } from "../utils/fontFamilyAliases";

type FontNameSource =
  | string
  | Pick<PreviewFontFile, "fileName"> &
      Partial<Pick<PreviewFontFile, "displayName" | "familyNames">>;

function previewFontNameFromSource(source: FontNameSource): string {
  if (typeof source === "string") return previewFontNameFromFileName(source);

  return (
    source.displayName?.trim() ||
    source.familyNames?.find((name) => name.trim().length > 0)?.trim() ||
    previewFontNameFromFileName(source.fileName)
  );
}

export function fontNamesFromFiles(fonts: FontNameSource[]): string[] {
  return Array.from(
    new Set(fonts.map(previewFontNameFromSource).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function mergePreviewFontNames(
  discoveredNames: string[],
  extraNames: string[],
): string[] {
  return Array.from(
    new Set([...discoveredNames, ...extraNames.filter(Boolean)]),
  );
}

export function usePreviewFontNames(extraNames: string[] = []) {
  const [discoveredNames, setDiscoveredNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    discoverPreviewFonts()
      .then((fonts) => {
        if (cancelled) return;
        setDiscoveredNames(fontNamesFromFiles(fonts));
      })
      .catch(() => {
        if (!cancelled) setDiscoveredNames([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () => mergePreviewFontNames(discoveredNames, extraNames),
    [discoveredNames, extraNames],
  );
}
