import type { SubtitleCue } from "@/lib/ass";
import type { TranslationResult } from "@/services/translation";

export function translatedCueCount(cues: SubtitleCue[]): number {
  return cues.filter((cue) => Boolean(cue.secondaryText?.trim())).length;
}

export function mergeRetryResult(
  current: TranslationResult,
  retry: TranslationResult,
): TranslationResult {
  const retryById = new Map(retry.cues.map((cue) => [cue.id, cue]));
  const cues = current.cues.map((cue) => {
    const retried = retryById.get(cue.id);
    return retried?.secondaryText?.trim()
      ? { ...cue, secondaryText: retried.secondaryText }
      : cue;
  });
  const successCount = translatedCueCount(cues);

  return {
    ...retry,
    cues,
    successCount,
    failedCount: cues.length - successCount,
  };
}
