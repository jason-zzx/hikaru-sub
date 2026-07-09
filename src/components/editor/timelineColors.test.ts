// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TIMELINE_COLOR_VARS,
  resolveTimelineColors,
} from "./timelineColors";

describe("resolveTimelineColors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads --timeline-* custom properties from the element", () => {
    const el = document.createElement("div");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) => {
        const map: Record<string, string> = {
          "--timeline-bg": " #eef0f4 ",
          "--timeline-wave-bg": "#e2e5eb",
          "--timeline-tick": "#64748b",
          "--timeline-wave": "#3b82f6",
          "--timeline-cue": "#94a3b8",
          "--timeline-cue-selected": "#3b82f6",
          "--timeline-cue-text": "#ffffff",
          "--timeline-cue-handle": "rgba(255,255,255,0.75)",
          "--timeline-playhead": "#ef4444",
        };
        return map[name] ?? "";
      },
    } as unknown as CSSStyleDeclaration);

    const colors = resolveTimelineColors(el);
    expect(colors.bg).toBe("#eef0f4");
    expect(colors.waveBg).toBe("#e2e5eb");
    expect(colors.tick).toBe("#64748b");
    expect(colors.wave).toBe("#3b82f6");
    expect(colors.cue).toBe("#94a3b8");
    expect(colors.cueSelected).toBe("#3b82f6");
    expect(colors.cueText).toBe("#ffffff");
    expect(colors.cueHandle).toBe("rgba(255,255,255,0.75)");
    expect(colors.playhead).toBe("#ef4444");
  });

  it("falls back to dark defaults when properties are empty", () => {
    const el = document.createElement("div");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration);

    const colors = resolveTimelineColors(el);
    expect(colors.bg).toBe("#111827");
    expect(colors.waveBg).toBe("#1a1a1a");
    expect(colors.cue).toBe("#4b5563");
    expect(colors.playhead).toBe("#ef4444");
  });

  it("exposes the full CSS variable name list", () => {
    expect(TIMELINE_COLOR_VARS.bg).toBe("--timeline-bg");
    expect(Object.keys(TIMELINE_COLOR_VARS)).toHaveLength(9);
  });
});
