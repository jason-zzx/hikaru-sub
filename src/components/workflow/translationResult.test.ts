import { describe, expect, it } from "vitest";
import type { SubtitleCue } from "@/lib/ass";
import type { TranslationResult } from "@/services/translation";
import { mergeRetryResult } from "./translationResult";

function cue(id: string, secondaryText?: string): SubtitleCue {
  return {
    id,
    startMs: 0,
    endMs: 1000,
    primaryText: `source-${id}`,
    secondaryText,
    style: "Default",
    layer: 0,
  };
}

function result(cues: SubtitleCue[], cancelled = false): TranslationResult {
  const successCount = cues.filter((item) => item.secondaryText).length;
  return {
    cues,
    successCount,
    failedCount: cues.length - successCount,
    errors: [],
    cancelled,
  };
}

describe("mergeRetryResult", () => {
  it("keeps prior translations and source order while merging retry successes", () => {
    const merged = mergeRetryResult(
      result([cue("a", "existing"), cue("b"), cue("c")]),
      {
        ...result([cue("b", "retried"), cue("c")]),
        errors: ["批次 1 条目 2 失败: 网络请求失败"],
        cancelled: true,
      },
    );

    expect(merged.cues.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(merged.cues.map((item) => item.secondaryText)).toEqual([
      "existing",
      "retried",
      undefined,
    ]);
    expect(merged.successCount).toBe(2);
    expect(merged.failedCount).toBe(1);
    expect(merged.cancelled).toBe(true);
    expect(merged.errors).toEqual(["批次 1 条目 2 失败: 网络请求失败"]);
  });
});
