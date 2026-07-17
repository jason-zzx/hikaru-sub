import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultStyles, type AssStyle } from "@/lib/ass";
import { useProjectStore } from "./projectStore";
import { usePlaybackStore } from "./playbackStore";
import type { SubtitleCue } from "../types";
import { makeTextOp } from "../services/editorTextHistory";

function style(overrides: Partial<AssStyle> = {}): AssStyle {
  return {
    ...createDefaultStyles()[0],
    name: "Custom",
    ...overrides,
  };
}

function cue(id: string, startMs: number, endMs: number, text = id): SubtitleCue {
  return {
    id,
    startMs,
    endMs,
    primaryText: text,
    style: "Primary",
    layer: 0,
  };
}

function resetStore(partial: Record<string, unknown> = {}) {
  useProjectStore.setState({
    ...useProjectStore.getInitialState(),
    assStyles: createDefaultStyles(),
    ...partial,
  });
  usePlaybackStore.setState({
    currentTimeMs: 1000,
    durationMs: 60000,
    isPlaying: true,
    selectedCueId: null,
    selectedCueIds: [],
    fps: 25,
    playUntilMs: 5000,
  });
}

function markCurrentSaved() {
  const snapshot = useProjectStore.getState().captureSaveSnapshot();
  useProjectStore.getState().markSaved(snapshot.token);
}

function applyInsert(cueId: string, from: number, to: number, text: string, t = 1000) {
  useProjectStore.getState().applyTextEdit({
    cueId,
    text,
    op: makeTextOp({
      cueId,
      before: { start: from, end: from },
      after: { start: to, end: to },
      inputType: "insertText",
      timestampMs: t,
    }),
  });
}

describe("projectStore style actions", () => {
  beforeEach(() => {
    resetStore();
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
    resetStore({
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

  it("style edits keep project dirty after cue undo (non-history revision)", () => {
    resetStore({
      cues: [cue("a", 0, 1000)],
      isDirty: false,
    });
    markCurrentSaved();
    expect(useProjectStore.getState().isDirty).toBe(false);

    useProjectStore.getState().updateCue("a", { primaryText: "changed" });
    useProjectStore.getState().addStyle(style({ name: "Extra" }));
    expect(useProjectStore.getState().isDirty).toBe(true);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().cues[0].primaryText).toBe("a");
    expect(useProjectStore.getState().isDirty).toBe(true); // style still dirty
  });

  it("does not mark dirty or push history when cue updates do not change values", () => {
    resetStore({
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
    });
    markCurrentSaved();

    useProjectStore.getState().updateCue("cue-1", {
      primaryText: "こんにちは",
      startMs: 0,
    });

    const state = useProjectStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.history.past).toHaveLength(0);
  });

  it("replaceCues replaces the list as one undoable dirty change", () => {
    const original = [cue("a", 0, 1000), cue("b", 1000, 2000)];
    const next = [original[1], original[0]];

    resetStore({
      cues: original,
      isDirty: false,
    });
    useProjectStore.getState().replaceCues(next);

    expect(useProjectStore.getState().cues.map((item) => item.id)).toEqual([
      "b",
      "a",
    ]);
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(useProjectStore.getState().history.past).toHaveLength(1);
    expect(useProjectStore.getState().history.past[0]!.cues).toEqual(original);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().cues.map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("replaceCues no-ops when the same cue object order is provided", () => {
    const original = [cue("a", 0, 1000)];

    resetStore({
      cues: original,
      isDirty: false,
    });
    markCurrentSaved();
    useProjectStore.getState().replaceCues(original);

    expect(useProjectStore.getState().isDirty).toBe(false);
    expect(useProjectStore.getState().history.past).toEqual([]);
  });

  describe("renameStyle", () => {
    it("renames the style without touching cues when cascade is false", () => {
      resetStore({
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
      });

      useProjectStore.getState().renameStyle("Primary", "Title", false);

      const state = useProjectStore.getState();
      expect(state.assStyles.map((s) => s.name)).toContain("Title");
      expect(state.assStyles.map((s) => s.name)).not.toContain("Primary");
      expect(state.cues[0].style).toBe("Primary");
      expect(state.isDirty).toBe(true);
      expect(state.history.past).toHaveLength(0);
    });

    it("cascades the new name to referencing cues when cascade is true", () => {
      resetStore({
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
      });

      useProjectStore.getState().renameStyle("Primary", "Title", true);

      const state = useProjectStore.getState();
      expect(state.cues[0].style).toBe("Title");
      expect(state.cues[1].style).toBe("Secondary");
      expect(state.isDirty).toBe(true);
      expect(state.history.past).toHaveLength(1);
    });

    it("cascading rename keeps dirty after cue undo via non-history revision", () => {
      resetStore({
        cues: [cue("a", 0, 1000)],
      });
      // set style on cue
      useProjectStore.setState({
        cues: [{ ...cue("a", 0, 1000), style: "Primary" }],
      });
      markCurrentSaved();

      useProjectStore.getState().renameStyle("Primary", "Title", true);
      expect(useProjectStore.getState().cues[0].style).toBe("Title");
      useProjectStore.getState().undo();
      expect(useProjectStore.getState().cues[0].style).toBe("Primary");
      expect(useProjectStore.getState().isDirty).toBe(true);
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

describe("projectStore unified history", () => {
  beforeEach(() => {
    resetStore({ cues: [cue("a", 0, 1000, "ab")] });
    usePlaybackStore.setState({ selectedCueId: "a", selectedCueIds: ["a"] });
  });

  it("normal mutations push one snapshot and bound history at 50", () => {
    for (let i = 0; i < 55; i++) {
      useProjectStore.getState().updateCue("a", { primaryText: `t${i}` });
    }
    expect(useProjectStore.getState().history.past.length).toBe(50);
  });

  it("grouped inserts amend one revision; type change starts new group", () => {
    applyInsert("a", 2, 3, "abc", 1000);
    applyInsert("a", 3, 4, "abcd", 1100);
    expect(useProjectStore.getState().history.past).toHaveLength(1);
    expect(useProjectStore.getState().cues[0].primaryText).toBe("abcd");

    // Backspace starts a new group
    useProjectStore.getState().applyTextEdit({
      cueId: "a",
      text: "abc",
      op: makeTextOp({
        cueId: "a",
        before: { start: 4, end: 4 },
        after: { start: 3, end: 3 },
        inputType: "deleteContentBackward",
        timestampMs: 1200,
      }),
    });
    expect(useProjectStore.getState().history.past).toHaveLength(2);
  });

  it("undo then new text then Escape restores prior redo branch", () => {
    useProjectStore.getState().updateCue("a", { primaryText: "one" });
    useProjectStore.getState().updateCue("a", { primaryText: "two" });
    expect(useProjectStore.getState().history.past.length).toBeGreaterThan(0);

    useProjectStore.getState().undo(); // back to "one"
    expect(useProjectStore.getState().cues[0].primaryText).toBe("one");
    expect(useProjectStore.getState().history.future.length).toBeGreaterThan(0);

    // New text session after undo
    applyInsert("a", 3, 4, "oneX", 2000);
    expect(useProjectStore.getState().history.future).toHaveLength(0);
    expect(useProjectStore.getState().cues[0].primaryText).toBe("oneX");

    useProjectStore.getState().rollbackTextSession();
    expect(useProjectStore.getState().cues[0].primaryText).toBe("one");
    expect(useProjectStore.getState().history.future.length).toBeGreaterThan(0);

    useProjectStore.getState().redo();
    expect(useProjectStore.getState().cues[0].primaryText).toBe("two");
  });

  it("acceptTextSession ends group without creating empty history", () => {
    applyInsert("a", 2, 3, "abc", 1000);
    const pastLen = useProjectStore.getState().history.past.length;
    useProjectStore.getState().acceptTextSession();
    expect(useProjectStore.getState().history.past.length).toBe(pastLen);
    expect(useProjectStore.getState().history.textGroup).toBeNull();
    expect(useProjectStore.getState().history.textSession).toBeNull();
  });

  it("composition preview does not push history; commit once; cancel restores", () => {
    const base = useProjectStore.getState().cues;
    useProjectStore.getState().beginComposition({
      cueId: "a",
      start: 2,
      end: 2,
      direction: "none",
    });
    useProjectStore.getState().updateCompositionPreview("a", "ab中");
    expect(useProjectStore.getState().history.past).toHaveLength(0);
    expect(useProjectStore.getState().cues[0].primaryText).toBe("ab中");
    expect(useProjectStore.getState().isDirty).toBe(true);

    useProjectStore.getState().endComposition({
      cueId: "a",
      text: base[0].primaryText,
      selection: { start: 2, end: 2 },
      timestampMs: 1400,
    });
    expect(useProjectStore.getState().cues[0].primaryText).toBe(base[0].primaryText);
    expect(useProjectStore.getState().history.past).toHaveLength(0);

    useProjectStore.getState().beginComposition({
      cueId: "a",
      start: 2,
      end: 2,
      direction: "none",
    });
    useProjectStore.getState().updateCompositionPreview("a", "abん");
    useProjectStore.getState().endComposition({
      cueId: "a",
      text: "abん",
      selection: { start: 3, end: 3 },
      timestampMs: 1500,
    });
    expect(useProjectStore.getState().cues[0].primaryText).toBe("abん");
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it("composition commits through the shared text path and can amend an insertion group", () => {
    applyInsert("a", 2, 3, "abc", 1000);
    useProjectStore.getState().beginComposition({
      cueId: "a",
      start: 3,
      end: 3,
      direction: "none",
    });
    useProjectStore.getState().updateCompositionPreview("a", "abc中");
    useProjectStore.getState().endComposition({
      cueId: "a",
      text: "abc中",
      selection: { start: 4, end: 4 },
      timestampMs: 1100,
    });

    expect(useProjectStore.getState().cues[0].primaryText).toBe("abc中");
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it("late composition events without a baseline are lifecycle-safe no-ops", () => {
    const next = cue("next", 0, 1000, "fresh");
    useProjectStore.getState().beginComposition({
      cueId: "a",
      start: 2,
      end: 2,
      direction: "none",
    });
    useProjectStore.getState().updateCompositionPreview("a", "ab中");
    useProjectStore.getState().loadAssDocument({
      scriptInfo: {
        title: "next",
        scriptType: "v4.00+",
        playResX: 1920,
        playResY: 1080,
        wrapStyle: 0,
        scaledBorderAndShadow: true,
        extra: {},
      },
      styles: createDefaultStyles(),
      cues: [next],
    });

    useProjectStore.getState().updateCompositionPreview("a", "late preview");
    useProjectStore.getState().endComposition({
      cueId: "a",
      text: "late commit",
      selection: { start: 4, end: 4 },
      timestampMs: 1100,
    });
    expect(useProjectStore.getState().cues).toEqual([next]);
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });

  it("acceptTextSession mid-composition cancels IME and does not leave unhistoried text", () => {
    markCurrentSaved();
    useProjectStore.getState().beginComposition({
      cueId: "a",
      start: 2,
      end: 2,
      direction: "none",
    });
    useProjectStore.getState().updateCompositionPreview("a", "ab中");
    useProjectStore.getState().acceptTextSession();

    const state = useProjectStore.getState();
    expect(state.cues[0].primaryText).toBe("ab");
    expect(state.history.compositionBaseline).toBeNull();
    expect(state.history.compositionPreview).toBe(false);
    expect(state.history.past).toHaveLength(0);
    expect(state.isDirty).toBe(false);
  });

  it("non-text mutation during composition restores baseline before applying", () => {
    useProjectStore.getState().beginComposition({
      cueId: "a",
      start: 2,
      end: 2,
      direction: "none",
    });
    useProjectStore.getState().updateCompositionPreview("a", "ab中");
    useProjectStore.getState().updateCue("a", { startMs: 50 });

    const state = useProjectStore.getState();
    expect(state.cues[0].primaryText).toBe("ab");
    expect(state.cues[0].startMs).toBe(50);
    expect(state.history.compositionBaseline).toBeNull();
    expect(state.history.past).toHaveLength(1);
    expect(state.history.past[0]!.cues[0].primaryText).toBe("ab");
  });

  it("advances document epoch only for history-reset lifecycle actions", () => {
    const initial = useProjectStore.getState().documentEpoch;
    useProjectStore.getState().updateCue("a", { primaryText: "edited" });
    useProjectStore.getState().beginComposition(null);
    useProjectStore.getState().acceptTextSession();
    expect(useProjectStore.getState().documentEpoch).toBe(initial);

    useProjectStore.getState().setSession({
      videoPath: "C:/v.mp4",
      workspacePath: "C:/w",
      audioPath: "C:/w/a.wav",
      transcribedAssPath: "C:/v.transcribed.ass",
      translatedAssPath: "C:/v.translated.ass",
      burnAssPath: "C:/w/burn.ass",
      sourceLang: "ja",
    });
    useProjectStore.getState().clearSession();
    useProjectStore.getState().loadAssDocument({
      scriptInfo: {
        title: "loaded",
        scriptType: "v4.00+",
        playResX: 1920,
        playResY: 1080,
        wrapStyle: 0,
        scaledBorderAndShadow: true,
        extra: {},
      },
      styles: createDefaultStyles(),
      cues: [cue("a", 0, 1000)],
    });
    useProjectStore.getState().setCues([cue("a", 0, 1000, "reset")]);
    expect(useProjectStore.getState().documentEpoch).toBe(initial + 4);

    useProjectStore.getState().replaceCues([cue("a", 0, 1000, "normal")]);
    expect(useProjectStore.getState().documentEpoch).toBe(initial + 4);
  });

  it("setSession/loadAssDocument clear history and grouping state", () => {
    applyInsert("a", 2, 3, "abc", 1000);
    useProjectStore.getState().setSession({
      videoPath: "C:/v.mp4",
      workspacePath: "C:/w",
      audioPath: "C:/w/a.wav",
      transcribedAssPath: "C:/v.transcribed.ass",
      translatedAssPath: "C:/v.translated.ass",
      burnAssPath: "C:/w/burn.ass",
      sourceLang: "ja",
    });
    const h = useProjectStore.getState().history;
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.textGroup).toBeNull();
    expect(h.textSession).toBeNull();
    expect(h.compositionBaseline).toBeNull();
  });

  it("saved revision traversal and abandoned branch", () => {
    markCurrentSaved();
    expect(useProjectStore.getState().isDirty).toBe(false);

    useProjectStore.getState().updateCue("a", { primaryText: "x" });
    const midToken = {
      cueRevision: useProjectStore.getState().history.cueRevision,
      nonHistoryRevision: useProjectStore.getState().history.nonHistoryRevision,
    };
    expect(useProjectStore.getState().isDirty).toBe(true);

    useProjectStore.getState().markSaved(midToken);
    expect(useProjectStore.getState().isDirty).toBe(false);

    useProjectStore.getState().updateCue("a", { primaryText: "y" });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().cues[0].primaryText).toBe("x");
    expect(useProjectStore.getState().isDirty).toBe(false);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().cues[0].primaryText).toBe("ab");
    expect(useProjectStore.getState().isDirty).toBe(true);

    // New branch abandons saved "x"
    useProjectStore.getState().updateCue("a", { primaryText: "z" });
    expect(useProjectStore.getState().history.future).toHaveLength(0);
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("captureSaveSnapshot accepts text state and pairs the post-accept token", () => {
    markCurrentSaved();
    applyInsert("a", 2, 3, "saved-body", 1000);
    expect(useProjectStore.getState().history.textSession).not.toBeNull();
    const snap = useProjectStore.getState().captureSaveSnapshot();
    const stateAfterCapture = useProjectStore.getState();
    expect(snap.cues[0].primaryText).toBe("saved-body");
    expect(stateAfterCapture.history.textSession).toBeNull();
    expect(stateAfterCapture.history.textGroup).toBeNull();
    expect(snap.token).toEqual({
      cueRevision: stateAfterCapture.history.cueRevision,
      nonHistoryRevision: stateAfterCapture.history.nonHistoryRevision,
    });

    // Edit while I/O would be in flight
    useProjectStore.getState().updateCue("a", { primaryText: "after" });
    useProjectStore.getState().markSaved(snap.token);
    expect(useProjectStore.getState().cues[0].primaryText).toBe("after");
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it("failed save does not move checkpoint when markSaved is not called", () => {
    markCurrentSaved();
    useProjectStore.getState().updateCue("a", { primaryText: "x" });
    const dirty = useProjectStore.getState().isDirty;
    expect(dirty).toBe(true);
    // simulate failed save: no markSaved
    expect(useProjectStore.getState().isDirty).toBe(true);
    expect(useProjectStore.getState().history.savedToken.cueRevision).toBe(0);
  });

  it("undo/redo restores selection without touching playback time/play state", () => {
    usePlaybackStore.setState({
      selectedCueId: "a",
      selectedCueIds: ["a"],
      currentTimeMs: 1234,
      isPlaying: true,
      playUntilMs: 9999,
    });
    useProjectStore.getState().updateCue("a", { primaryText: "x" });
    usePlaybackStore.setState({
      selectedCueId: null,
      selectedCueIds: [],
      currentTimeMs: 5555,
      isPlaying: false,
      playUntilMs: null,
    });

    // Force a known context on the past snapshot
    const past = useProjectStore.getState().history.past[0]!;
    expect(past.context.activeCueId).toBe("a");

    useProjectStore.getState().undo();
    const pb = usePlaybackStore.getState();
    expect(pb.selectedCueId).toBe("a");
    expect(pb.selectedCueIds).toEqual(["a"]);
    expect(pb.currentTimeMs).toBe(5555);
    expect(pb.isPlaying).toBe(false);
    expect(pb.playUntilMs).toBeNull();
  });

  it("setAssMetadata does not advance revisions", () => {
    const before = useProjectStore.getState().history;
    useProjectStore.getState().setAssMetadata(
      {
        title: "t",
        scriptType: "v4.00+",
        playResX: 1920,
        playResY: 1080,
        wrapStyle: 0,
        scaledBorderAndShadow: true,
        extra: {},
      },
      createDefaultStyles(),
    );
    const after = useProjectStore.getState().history;
    expect(after.cueRevision).toBe(before.cueRevision);
    expect(after.nonHistoryRevision).toBe(before.nonHistoryRevision);
  });
});
