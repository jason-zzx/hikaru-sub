import { describe, expect, it } from "vitest";
import {
  createDefaultScriptInfo,
  createDefaultStyles,
  type SubtitleCue,
} from "@hikaru/ass-core";
import { buildPreviewAssText } from "./assPreviewDocument";

describe("buildPreviewAssText", () => {
  it("serializes the current in-memory ASS document for inline preview", () => {
    const cues: SubtitleCue[] = [
      {
        id: "cue-1",
        startMs: 1000,
        endMs: 2500,
        primaryText: "原文",
        secondaryText: "译文",
        style: "Primary",
        layer: 0,
      },
    ];

    const text = buildPreviewAssText({
      cues,
      styles: createDefaultStyles(),
      scriptInfo: createDefaultScriptInfo("Preview", 1280, 720),
      mergeMode: "inline",
    });

    expect(text).toContain("PlayResX: 1280");
    expect(text).toContain("PlayResY: 720");
    expect(text).toContain("Dialogue:");
    expect(text).toContain("译文 / 原文");
  });
});
