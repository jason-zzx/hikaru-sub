import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultStyles, type AssStyle } from "@hikaru/ass-core";
import { useProjectStore } from "./projectStore";

function style(overrides: Partial<AssStyle> = {}): AssStyle {
  return {
    ...createDefaultStyles()[0],
    name: "Custom",
    ...overrides,
  };
}

describe("projectStore style actions", () => {
  beforeEach(() => {
    useProjectStore.setState({
      session: null,
      activeSubtitlePath: null,
      activeSubtitleKind: null,
      videoPath: null,
      cues: [],
      assScriptInfo: null,
      assStyles: createDefaultStyles(),
      isDirty: false,
      history: { past: [], future: [] },
    });
  });

  it("stores runtime video sessions and active subtitle paths", () => {
    useProjectStore.getState().setSession({
      videoPath: "C:/video/episode.mp4",
      workspacePath: "C:/cache/workspace/hash",
      audioPath: "C:/cache/workspace/hash/audio.wav",
      transcribedAssPath: "C:/video/episode.transcribed.ass",
      translatedAssPath: "C:/video/episode.translated.ass",
      burnAssPath: "C:/cache/workspace/hash/burn.input.ass",
      sourceLang: "ja",
    });

    useProjectStore
      .getState()
      .setActiveSubtitle("translated", "C:/video/episode.translated.ass");

    const state = useProjectStore.getState();
    expect(state.session?.workspacePath).toBe("C:/cache/workspace/hash");
    expect(state.activeSubtitleKind).toBe("translated");
    expect(state.activeSubtitlePath).toBe("C:/video/episode.translated.ass");
  });

  it("adds a style and marks the project dirty", () => {
    useProjectStore.getState().addStyle(style({ name: "Caption" }));

    const state = useProjectStore.getState();
    expect(state.assStyles.map((s) => s.name)).toContain("Caption");
    expect(state.isDirty).toBe(true);
  });

  it("updates a style by name and marks the project dirty", () => {
    useProjectStore.getState().updateStyle("Primary", {
      fontName: "Arial",
      fontSize: 64,
      bold: true,
    });

    const primary = useProjectStore
      .getState()
      .assStyles.find((s) => s.name === "Primary");
    expect(primary?.fontName).toBe("Arial");
    expect(primary?.fontSize).toBe(64);
    expect(primary?.bold).toBe(true);
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("deletes a style without changing cues that reference it", () => {
    useProjectStore.setState({
      cues: [
        {
          id: "cue-1",
          startMs: 0,
          endMs: 1000,
          primaryText: "こんにちは",
          style: "Secondary",
          layer: 0,
        },
      ],
    });

    useProjectStore.getState().deleteStyle("Secondary");

    const state = useProjectStore.getState();
    expect(state.assStyles.some((s) => s.name === "Secondary")).toBe(false);
    expect(state.cues[0].style).toBe("Secondary");
    expect(state.isDirty).toBe(true);
  });

  it("does not push style edits into cue undo history", () => {
    const before = useProjectStore.getState().history.past.length;

    useProjectStore.getState().addStyle(style({ name: "NoHistory" }));
    useProjectStore.getState().updateStyle("Primary", { italic: true });
    useProjectStore.getState().deleteStyle("Secondary");

    expect(useProjectStore.getState().history.past.length).toBe(before);
  });

  it("does not mark dirty or push history when cue updates do not change values", () => {
    useProjectStore.setState({
      cues: [
        {
          id: "cue-1",
          startMs: 0,
          endMs: 1000,
          primaryText: "こんにちは",
          style: "Primary",
          layer: 0,
        },
      ],
      isDirty: false,
      history: { past: [], future: [] },
    });

    useProjectStore.getState().updateCue("cue-1", {
      primaryText: "こんにちは",
      startMs: 0,
    });

    const state = useProjectStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.history.past).toHaveLength(0);
  });

  it("updates cue previews without pushing undo history", () => {
    useProjectStore.setState({
      cues: [
        {
          id: "cue-1",
          startMs: 0,
          endMs: 1000,
          primaryText: "こんにちは",
          style: "Primary",
          layer: 0,
        },
      ],
      isDirty: false,
      history: { past: [], future: [] },
    });

    useProjectStore.getState().updateCuePreview("cue-1", {
      primaryText: "こんばんは",
    });

    const state = useProjectStore.getState();
    expect(state.cues[0].primaryText).toBe("こんばんは");
    expect(state.isDirty).toBe(true);
    expect(state.history.past).toHaveLength(0);
  });

  describe("renameStyle", () => {
    it("renames the style without touching cues when cascade is false", () => {
      useProjectStore.setState({
        cues: [
          {
            id: "cue-1",
            startMs: 0,
            endMs: 1000,
            primaryText: "こんにちは",
            style: "Primary",
            layer: 0,
          },
        ],
        isDirty: false,
        history: { past: [], future: [] },
      });

      useProjectStore.getState().renameStyle("Primary", "Title", false);

      const state = useProjectStore.getState();
      expect(state.assStyles.map((s) => s.name)).toContain("Title");
      expect(state.assStyles.map((s) => s.name)).not.toContain("Primary");
      // 引用保留旧名，由 ASS 规范回退默认样式
      expect(state.cues[0].style).toBe("Primary");
      expect(state.isDirty).toBe(true);
      expect(state.history.past).toHaveLength(0);
    });

    it("cascades the new name to referencing cues when cascade is true", () => {
      useProjectStore.setState({
        cues: [
          {
            id: "cue-1",
            startMs: 0,
            endMs: 1000,
            primaryText: "こんにちは",
            style: "Primary",
            layer: 0,
          },
          {
            id: "cue-2",
            startMs: 1000,
            endMs: 2000,
            primaryText: "さようなら",
            style: "Secondary",
            layer: 0,
          },
        ],
        isDirty: false,
        history: { past: [], future: [] },
      });

      useProjectStore.getState().renameStyle("Primary", "Title", true);

      const state = useProjectStore.getState();
      expect(state.cues[0].style).toBe("Title");
      expect(state.cues[1].style).toBe("Secondary");
      expect(state.isDirty).toBe(true);
      expect(state.history.past).toHaveLength(1);
    });

    it("is a no-op when the old name does not exist or names match", () => {
      const before = useProjectStore.getState();

      useProjectStore.getState().renameStyle("Missing", "Whatever", true);
      useProjectStore.getState().renameStyle("Primary", "Primary", true);

      const state = useProjectStore.getState();
      expect(state.assStyles).toEqual(before.assStyles);
      expect(state.isDirty).toBe(before.isDirty);
    });
  });
});
