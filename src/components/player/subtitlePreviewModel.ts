import {
  formatAssTime,
  parseAssTime,
  type SubtitleCue,
} from "@/lib/ass";

export type SubtitlePreviewRendererMode = "auto" | "libass" | "css";

interface LibassFontKeyArgs {
  defaultFont?: string;
  glyphFallbackFont?: string;
  fontUrls: string[];
  availableFonts?: Record<string, string>;
}

export function getLibassFontKey({
  defaultFont,
  glyphFallbackFont,
  fontUrls,
  availableFonts = {},
}: LibassFontKeyArgs): string {
  const availableFontEntries = Object.entries(availableFonts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, url]) => `${name}:${url}`);

  return [
    defaultFont ?? "",
    glyphFallbackFont ?? "",
    ...fontUrls,
    ...availableFontEntries,
  ].join("\n");
}

export function findPreviewCue(
  cues: SubtitleCue[],
  activeCueId: string | null,
  currentTimeMs: number,
): SubtitleCue | null {
  if (activeCueId) {
    return cues.find((cue) => cue.id === activeCueId) ?? null;
  }
  return (
    cues.find((cue) => currentTimeMs >= cue.startMs && currentTimeMs <= cue.endMs) ??
    null
  );
}

export function getLibassRenderTimeMs(
  cues: SubtitleCue[],
  activeCueId: string | null,
  currentTimeMs: number,
): number {
  if (!activeCueId) return currentTimeMs;
  const cue = cues.find((item) => item.id === activeCueId);
  if (!cue) return currentTimeMs;

  const serializedStartMs = parseAssTime(formatAssTime(cue.startMs));
  const serializedEndMs = parseAssTime(formatAssTime(cue.endMs));
  if (serializedEndMs <= serializedStartMs) return serializedStartMs;
  return Math.min(serializedStartMs + 1, serializedEndMs - 1);
}

export function shouldUseCssFallback(
  rendererMode: SubtitlePreviewRendererMode,
  libassAvailable: boolean,
  fallbackReason: string | null,
): boolean {
  return rendererMode === "css" || !libassAvailable || fallbackReason !== null;
}
