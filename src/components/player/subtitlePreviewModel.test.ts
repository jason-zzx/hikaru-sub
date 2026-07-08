import { describe, expect, it } from "vitest";
import type { SubtitleCue } from "@hikaru/ass-core";
import {
  findPreviewCue,
  getLibassFontKey,
  getLibassRenderTimeMs,
  shouldUseCssFallback,
} from "./subtitlePreviewModel";

const cues: SubtitleCue[] = [
  {
    id: "cue-1",
    startMs: 0,
    endMs: 1000,
    primaryText: "一",
    style: "Primary",
    layer: 0,
  },
  {
    id: "cue-2",
    startMs: 1001,
    endMs: 2000,
    primaryText: "二",
    style: "Primary",
    layer: 0,
  },
];

describe("subtitlePreviewModel", () => {
  it("prefers the selected cue over the timeline cue", () => {
    expect(findPreviewCue(cues, "cue-2", 500)?.id).toBe("cue-2");
  });

  it("falls back to the current timeline cue when no cue is selected", () => {
    expect(findPreviewCue(cues, null, 500)?.id).toBe("cue-1");
  });

  it("renders selected cues at their own time in libass preview", () => {
    expect(getLibassRenderTimeMs(cues, "cue-2", 500)).toBe(1001);
  });

  it("renders selected cues inside their serialized ASS time range", () => {
    expect(
      getLibassRenderTimeMs(
        [
          {
            id: "cue-rounded",
            startMs: 1009,
            endMs: 2000,
            primaryText: "丸め",
            style: "Primary",
            layer: 0,
          },
        ],
        "cue-rounded",
        500,
      ),
    ).toBe(1011);
  });

  it("renders timeline cues at the current time when nothing is selected", () => {
    expect(getLibassRenderTimeMs(cues, null, 500)).toBe(500);
  });

  it("uses CSS fallback when libass is disabled, unavailable, or has failed", () => {
    expect(shouldUseCssFallback("css", true, null)).toBe(true);
    expect(shouldUseCssFallback("auto", false, null)).toBe(true);
    expect(shouldUseCssFallback("auto", true, "worker failed")).toBe(true);
    expect(shouldUseCssFallback("auto", true, null)).toBe(false);
  });

  it("changes the libass retry key when available font names change", () => {
    const first = getLibassFontKey({
      defaultFont: ".苹方-简",
      fontUrls: ["font://pingfang"],
      availableFonts: {
        ".苹方-简": "font://pingfang",
      },
    });
    const second = getLibassFontKey({
      defaultFont: ".苹方-简",
      fontUrls: ["font://pingfang"],
      availableFonts: {
        ".苹方-简": "font://pingfang",
        "PingFangSC-Regular": "font://pingfang",
      },
    });

    expect(second).not.toBe(first);
  });
});
