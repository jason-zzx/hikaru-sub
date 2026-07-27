// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultStyles, type AssStyle, type SubtitleCue } from "@/lib/ass";
import type { PreviewFontFile } from "@/types";

const childMocks = vi.hoisted(() => ({
  libass: vi.fn(),
  css: vi.fn(),
  checkGlyphs: vi.fn(),
}));

vi.mock("../../services/fontCoverage", () => ({
  checkPreviewFontGlyphs: childMocks.checkGlyphs,
}));

vi.mock("./LibassSubtitleOverlay", () => ({
  LibassSubtitleOverlay: (props: Record<string, unknown>) => {
    childMocks.libass(props);
    return null;
  },
}));

vi.mock("./AssSubtitleOverlay", () => ({
  AssSubtitleOverlay: (props: Record<string, unknown>) => {
    childMocks.css(props);
    return null;
  },
}));

import { SubtitlePreview } from "./SubtitlePreview";

function cue(text: string): SubtitleCue {
  return {
    id: "a",
    startMs: 0,
    endMs: 1000,
    primaryText: text,
    style: "Primary",
    layer: 0,
  };
}

function preview(
  cues: SubtitleCue[],
  options: {
    activeCueId?: string | null;
    currentTimeMs?: number;
    rendererMode?: "auto" | "css";
    segmentStopCueIds?: string[] | null;
    styles?: AssStyle[];
    fontFiles?: PreviewFontFile[];
    glyphFallbackFont?: string;
  } = {},
) {
  return (
    <SubtitlePreview
      cues={cues}
      activeCueId={options.activeCueId === undefined ? "a" : options.activeCueId}
      styles={options.styles ?? []}
      scriptInfo={null}
      currentTimeMs={options.currentTimeMs ?? 500}
      displayRect={{ left: 0, top: 0, width: 1280, height: 720 }}
      rendererMode={options.rendererMode}
      segmentStopCueIds={options.segmentStopCueIds}
      fontFiles={options.fontFiles}
      glyphFallbackFont={options.glyphFallbackFont}
    />
  );
}

afterEach(cleanup);

beforeEach(() => {
  childMocks.libass.mockReset();
  childMocks.css.mockReset();
  childMocks.checkGlyphs.mockReset();
  childMocks.checkGlyphs.mockResolvedValue({
    fontName: "Test Latin",
    checkedCodePoints: [],
    missingCodePoints: [],
  });
});

describe("SubtitlePreview segment stop", () => {
  it("renders exactly the tracker hit set in libass and CSS fallback", () => {
    const stopCues: SubtitleCue[] = [
      { ...cue("played"), startMs: 1000, endMs: 2000 },
      {
        ...cue("overlap"),
        id: "overlap",
        startMs: 1500,
        endMs: 2500,
      },
      { ...cue("next"), id: "next", startMs: 2000, endMs: 3000 },
      { ...cue("expired"), id: "expired", startMs: 500, endMs: 1200 },
    ];
    const options = {
      activeCueId: "a",
      currentTimeMs: 2000,
      segmentStopCueIds: ["a", "overlap"],
    };
    const { rerender } = render(preview(stopCues, options));

    const libassProps = childMocks.libass.mock.lastCall?.[0] as Record<
      string,
      unknown
    >;
    expect(libassProps.renderTimeMs).toBe(1999);
    expect(libassProps.assText).toContain("played");
    expect(libassProps.assText).toContain("overlap");
    expect(libassProps.assText).not.toContain("next");
    expect(libassProps.assText).not.toContain("expired");

    rerender(preview(stopCues, { ...options, rendererMode: "css" }));
    expect(
      childMocks.css.mock.calls.map(
        ([props]) =>
          ((props as Record<string, unknown>).cue as SubtitleCue).id,
      ),
    ).toEqual(["a", "overlap"]);
  });

  it("CSS fallback renders multiple cues sorted by ASS layer (higher layer last)", () => {
    const stopCues: SubtitleCue[] = [
      { ...cue("top"), id: "top", startMs: 1000, endMs: 2000, layer: 10 },
      { ...cue("mid"), id: "mid", startMs: 1000, endMs: 2000, layer: 0 },
      { ...cue("bottom"), id: "bottom", startMs: 1000, endMs: 2000, layer: -1 },
    ];
    render(
      preview(stopCues, {
        currentTimeMs: 2000,
        segmentStopCueIds: ["top", "mid", "bottom"],
        rendererMode: "css",
      }),
    );
    expect(
      childMocks.css.mock.calls.map(
        ([props]) =>
          ((props as Record<string, unknown>).cue as SubtitleCue).id,
      ),
    ).toEqual(["bottom", "mid", "top"]);
  });
});

describe("SubtitlePreview libass recovery", () => {
  const latinStyles = createDefaultStyles().map((style) =>
    style.name === "Primary" ? { ...style, fontName: "Test Latin" } : style,
  );
  const baseOptions = {
    styles: latinStyles,
    glyphFallbackFont: "Fallback CJK",
  };

  function fontFile(overrides: Partial<PreviewFontFile> = {}): PreviewFontFile {
    return {
      path: "C:/fonts/test.ttf",
      url: "font://test",
      fileName: "test.ttf",
      familyNames: ["Test Latin"],
      ...overrides,
    };
  }

  it("keeps an in-flight glyph result when the stop cue set changes", async () => {
    let resolveFirst!: (result: {
      fontName: string;
      checkedCodePoints: number[];
      missingCodePoints: number[];
    }) => void;
    childMocks.checkGlyphs
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        fontName: "Test Latin",
        checkedCodePoints: ["字".codePointAt(0)!],
        missingCodePoints: [],
      });
    const stopCues: SubtitleCue[] = [
      { ...cue("文"), startMs: 1000, endMs: 2000 },
      {
        ...cue("字"),
        id: "overlap",
        startMs: 1500,
        endMs: 2500,
      },
    ];
    const stopOptions = {
      ...baseOptions,
      activeCueId: "a",
      currentTimeMs: 2000,
      fontFiles: [fontFile()],
    };
    const { rerender } = render(preview(stopCues, stopOptions));
    await vi.waitFor(() => expect(childMocks.checkGlyphs).toHaveBeenCalledOnce());

    rerender(
      preview(stopCues, {
        ...stopOptions,
        segmentStopCueIds: ["a", "overlap"],
      }),
    );
    await vi.waitFor(() =>
      expect(childMocks.checkGlyphs).toHaveBeenCalledTimes(2),
    );

    act(() => {
      resolveFirst({
        fontName: "Test Latin",
        checkedCodePoints: ["文".codePointAt(0)!],
        missingCodePoints: ["文".codePointAt(0)!],
      });
    });
    await vi.waitFor(() => {
      const props = childMocks.libass.mock.lastCall?.[0] as Record<
        string,
        unknown
      >;
      expect(props.assText).toContain(
        "{\\fnFallback CJK}文{\\fnTest Latin}",
      );
      expect(props.assText).not.toContain("{\\fnFallback CJK}字");
    });
  });

  it("rechecks completed glyph coverage when the font file changes", async () => {
    const codePoint = "文".codePointAt(0)!;
    childMocks.checkGlyphs
      .mockResolvedValueOnce({
        fontName: "Test Latin",
        checkedCodePoints: [codePoint],
        missingCodePoints: [codePoint],
      })
      .mockResolvedValueOnce({
        fontName: "Test Latin",
        checkedCodePoints: [codePoint],
        missingCodePoints: [],
      });
    const firstFont = fontFile({
      path: "C:/fonts/first.ttf",
      url: "font://first",
      fileName: "first.ttf",
    });
    const { rerender } = render(
      preview([cue("文")], { ...baseOptions, fontFiles: [firstFont] }),
    );
    await vi.waitFor(() => {
      const props = childMocks.libass.mock.lastCall?.[0] as Record<
        string,
        unknown
      >;
      expect(props.assText).toContain("{\\fnFallback CJK}文");
    });

    const secondFont = fontFile({
      path: "C:/fonts/second.ttf",
      url: "font://second",
      fileName: "second.ttf",
    });
    rerender(
      preview([cue("文")], {
        ...baseOptions,
        fontFiles: [secondFont],
      }),
    );

    await vi.waitFor(() =>
      expect(childMocks.checkGlyphs).toHaveBeenCalledTimes(2),
    );
    expect(
      (childMocks.checkGlyphs.mock.calls[1]?.[0] as PreviewFontFile).path,
    ).toBe(secondFont.path);
    await vi.waitFor(() => {
      const props = childMocks.libass.mock.lastCall?.[0] as Record<
        string,
        unknown
      >;
      expect(props.assText).not.toContain("{\\fnFallback CJK}文");
    });
  });

  it("ignores an old glyph result after font metadata changes", async () => {
    let resolveOld!: (result: {
      fontName: string;
      checkedCodePoints: number[];
      missingCodePoints: number[];
    }) => void;
    const codePoint = "文".codePointAt(0)!;
    childMocks.checkGlyphs
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({
        fontName: "Test Latin",
        checkedCodePoints: [codePoint],
        missingCodePoints: [],
      });
    const firstFont = fontFile({
      path: "C:/fonts/old.ttf",
      url: "font://old",
      fileName: "old.ttf",
    });
    const { rerender } = render(
      preview([cue("文")], { ...baseOptions, fontFiles: [firstFont] }),
    );
    await vi.waitFor(() => expect(childMocks.checkGlyphs).toHaveBeenCalledOnce());

    rerender(
      preview([cue("文")], {
        ...baseOptions,
        fontFiles: [
          {
            ...firstFont,
            familyNames: [],
            fontNames: ["Test Latin"],
          },
        ],
      }),
    );
    await vi.waitFor(() =>
      expect(childMocks.checkGlyphs).toHaveBeenCalledTimes(2),
    );

    await act(async () => {
      resolveOld({
        fontName: "Test Latin",
        checkedCodePoints: [codePoint],
        missingCodePoints: [codePoint],
      });
      await Promise.resolve();
    });
    const props = childMocks.libass.mock.lastCall?.[0] as Record<
      string,
      unknown
    >;
    expect(props.assText).not.toContain("{\\fnFallback CJK}文");
  });

  it("retries libass after editable ASS text changes", async () => {
    const { rerender } = render(preview([cue("before")]));
    expect(childMocks.libass).toHaveBeenCalled();
    const initialCalls = childMocks.libass.mock.calls;
    const firstProps = initialCalls[initialCalls.length - 1]![0] as Record<
      string,
      unknown
    >;

    act(() => {
      (firstProps.onUnavailable as (reason: string) => void)("render failed");
    });
    expect(childMocks.css).toHaveBeenCalled();
    const callsBeforeEdit = childMocks.libass.mock.calls.length;

    rerender(preview([cue("after")]));

    await vi.waitFor(() =>
      expect(childMocks.libass.mock.calls.length).toBeGreaterThan(
        callsBeforeEdit,
      ),
    );
    const libassCalls = childMocks.libass.mock.calls;
    const latestProps = libassCalls[libassCalls.length - 1]![0] as Record<
      string,
      unknown
    >;
    expect(latestProps.assText).toContain("after");
  });
});
