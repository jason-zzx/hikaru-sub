import { useEffect, useMemo, useState } from "react";
import { getPreviewFonts } from "../services/previewFontDiscovery";
import type { PreviewFontFile } from "../types";
import { previewFontNameFromFileName } from "../utils/fontFamilyAliases";

type FontNameSource =
  | string
  | Pick<PreviewFontFile, "fileName"> &
      Partial<Pick<PreviewFontFile, "displayName" | "familyNames">>;

export interface UsePreviewFontNamesOptions {
  /** 为 false 时不触发发现（例如 StyleManager 关闭时）。默认 true。 */
  enabled?: boolean;
}

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

export function usePreviewFontNames(
  extraNames: string[] = [],
  options: UsePreviewFontNamesOptions = {},
) {
  const enabled = options.enabled ?? true;
  const [discoveredNames, setDiscoveredNames] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    getPreviewFonts()
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
  }, [enabled]);

  return useMemo(
    () => mergePreviewFontNames(discoveredNames, extraNames),
    [discoveredNames, extraNames],
  );
}
