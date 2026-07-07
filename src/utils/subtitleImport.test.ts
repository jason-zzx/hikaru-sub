import { describe, expect, it } from "vitest";
import { parseExternalSubtitleDocument } from "./subtitleImport";

describe("parseExternalSubtitleDocument", () => {
  it("converts SRT subtitles into an ASS document with video PlayRes", () => {
    const doc = parseExternalSubtitleDocument({
      path: "C:/subs/dialogue.srt",
      text: [
        "1",
        "00:00:01,200 --> 00:00:03,450",
        "Hello",
        "world",
        "",
        "2",
        "00:00:05.000 --> 00:00:06.250",
        "Second line",
      ].join("\n"),
      playRes: { width: 1280, height: 720 },
    });

    expect(doc.scriptInfo.playResX).toBe(1280);
    expect(doc.scriptInfo.playResY).toBe(720);
    expect(doc.styles.some((style) => style.name === "Primary")).toBe(true);
    expect(doc.cues).toMatchObject([
      {
        startMs: 1200,
        endMs: 3450,
        primaryText: "Hello\nworld",
        style: "Primary",
        layer: 0,
      },
      {
        startMs: 5000,
        endMs: 6250,
        primaryText: "Second line",
        style: "Primary",
        layer: 0,
      },
    ]);
  });

  it("keeps ASS cues while replacing PlayRes with the current video resolution", () => {
    const doc = parseExternalSubtitleDocument({
      path: "C:/subs/dialogue.ass",
      text: [
        "[Script Info]",
        "Title: External",
        "ScriptType: v4.00+",
        "PlayResX: 640",
        "PlayResY: 360",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Primary,Noto Sans SC,54,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,40,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        "Dialogue: 0,0:00:01.00,0:00:02.00,Primary,,0,0,0,,ASS line",
      ].join("\n"),
      playRes: { width: 1920, height: 1080 },
    });

    expect(doc.scriptInfo.title).toBe("External");
    expect(doc.scriptInfo.playResX).toBe(1920);
    expect(doc.scriptInfo.playResY).toBe(1080);
    expect(doc.cues[0].primaryText).toBe("ASS line");
  });

  it("rejects unsupported subtitle extensions", () => {
    expect(() =>
      parseExternalSubtitleDocument({
        path: "C:/subs/dialogue.vtt",
        text: "WEBVTT",
        playRes: { width: 1920, height: 1080 },
      }),
    ).toThrow("不支持的字幕格式");
  });
});
