// @vitest-environment jsdom
import { forwardRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultDocument } from "@/lib/ass";
import { makeVideoSession } from "@/test-utils/videoSession";
import { useEditorViewStore } from "../../stores/editorViewStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useProjectStore } from "../../stores/projectStore";
import { makeTextOp } from "../../services/editorTextHistory";
import type { SubtitleCue } from "../../types";
import { EditorView } from "./EditorView";

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));
vi.mock("../../hooks/useEditorHotkeys", () => ({
  useEditorHotkeys: vi.fn(),
}));
vi.mock("../../services/openVideo", () => ({
  importExternalSubtitle: vi.fn(),
}));
vi.mock("../../services/tauri", () => ({
  getSettings: vi.fn().mockResolvedValue({ editorHotkeys: [] }),
  pathExists: vi.fn().mockResolvedValue(false),
  pickSaveAssFile: vi.fn(),
  pickSaveSubtitleFile: vi.fn(),
  pickSubtitleFile: vi.fn(),
  saveAssText: vi.fn(),
}));
vi.mock("../player/VideoPlayer", () => ({
  VideoPlayer: () => null,
}));
vi.mock("../player/PlaybackControls", () => ({
  PlaybackControls: () => null,
}));
vi.mock("./SubtitleList", () => ({
  SubtitleList: () => null,
}));
vi.mock("./SubtitleFindPanel", () => ({
  SubtitleFindPanel: forwardRef(() => null),
}));
vi.mock("./SubtitleEditor", () => ({
  SubtitleEditor: forwardRef(() => null),
}));
vi.mock("./Timeline", () => ({
  Timeline: () => null,
}));
vi.mock("./ShiftTimesDialog", () => ({
  ShiftTimesDialog: () => null,
}));
vi.mock("./HotkeyHelpOverlay", () => ({
  HotkeyHelpOverlay: () => null,
}));
vi.mock("./StyleManager", () => ({
  StyleManager: () => null,
}));

function cue(id: string, startMs: number, endMs: number, text = id): SubtitleCue {
  return {
    id,
    startMs,
    endMs,
    primaryText: text,
    style: "Default",
    layer: 0,
  };
}

function loadSessionAndCues(cues: SubtitleCue[]) {
  const doc = createDefaultDocument("test", 1920, 1080);
  doc.cues = cues;
  useProjectStore.getState().setSession(makeVideoSession("editor-view"));
  useProjectStore.getState().loadAssDocument(doc, {
    kind: "transcribed",
    path: "C:/videos/editor-view.transcribed.ass",
  });
}

describe("EditorView in-app state preservation", () => {
  beforeEach(() => {
    useProjectStore.setState({ ...useProjectStore.getInitialState() });
    usePlaybackStore.setState({ ...usePlaybackStore.getInitialState() });
    useEditorViewStore.setState({ ...useEditorViewStore.getInitialState() });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("selects the first cue and seeks on first entry to a documentEpoch", async () => {
    loadSessionAndCues([cue("c1", 1200, 2200), cue("c2", 3400, 4400)]);

    render(<EditorView />);
    await act(async () => {});

    const pb = usePlaybackStore.getState();
    expect(pb.selectedCueId).toBe("c1");
    expect(pb.selectedCueIds).toEqual(["c1"]);
    expect(pb.currentTimeMs).toBe(1200);
    expect(useEditorViewStore.getState().initializedDocumentEpoch).toBe(
      useProjectStore.getState().documentEpoch,
    );
  });

  it("preserves playback position, multi-selection, and segmentStop across unmount/remount on the same documentEpoch", async () => {
    loadSessionAndCues([
      cue("c1", 1000, 2000),
      cue("c2", 3000, 4000),
      cue("c3", 5000, 6000),
    ]);

    const firstMount = render(<EditorView />);
    await act(async () => {});

    act(() => {
      usePlaybackStore.getState().setSelectedCueIds(["c2", "c3"]);
      usePlaybackStore.getState().setCurrentTime(5432);
      usePlaybackStore.getState().setSegmentStop({ cueId: "c3", stopMs: 6000 });
    });
    const seqBeforeUnmount = usePlaybackStore.getState().seekRequest?.seq;

    firstMount.unmount();

    render(<EditorView />);
    await act(async () => {});

    const pb = usePlaybackStore.getState();
    expect(pb.selectedCueId).toBe("c3");
    expect(pb.selectedCueIds).toEqual(["c2", "c3"]);
    expect(pb.currentTimeMs).toBe(5432);
    expect(pb.segmentStop).toEqual({ cueId: "c3", stopMs: 6000 });
    expect(pb.seekRequest?.seq).toBe(seqBeforeUnmount);
  });

  it("preserves cleared selection and playhead position across remount", async () => {
    loadSessionAndCues([cue("c1", 1000, 2000), cue("c2", 3000, 4000)]);

    const firstMount = render(<EditorView />);
    await act(async () => {});

    act(() => {
      usePlaybackStore.getState().clearCueSelection();
      usePlaybackStore.getState().requestSeek(12345);
    });

    firstMount.unmount();

    render(<EditorView />);
    await act(async () => {});

    const pb = usePlaybackStore.getState();
    expect(pb.selectedCueId).toBeNull();
    expect(pb.selectedCueIds).toEqual([]);
    expect(pb.currentTimeMs).toBe(12345);
  });

  it("filters removed cue IDs defensively on remount without changing currentTimeMs", async () => {
    loadSessionAndCues([cue("c1", 1000, 2000), cue("c2", 3000, 4000)]);

    const firstMount = render(<EditorView />);
    await act(async () => {});

    act(() => {
      usePlaybackStore.getState().setSelectedCueIds(["c1", "c2"]);
      usePlaybackStore.getState().setCurrentTime(4567);
    });

    firstMount.unmount();

    // Simulate c2 removed while keeping the same documentEpoch
    act(() => {
      useProjectStore.getState().deleteCue("c2");
    });

    render(<EditorView />);
    await act(async () => {});

    const pb = usePlaybackStore.getState();
    expect(pb.selectedCueId).toBe("c1");
    expect(pb.selectedCueIds).toEqual(["c1"]);
    expect(pb.currentTimeMs).toBe(4567);
  });

  it("re-initializes to the first cue when documentEpoch advances via setCues, loadAssDocument, or setSession (mounted or remounted)", async () => {
    loadSessionAndCues([cue("c1", 1000, 2000), cue("c2", 3000, 4000)]);

    const view = render(<EditorView />);
    await act(async () => {});

    act(() => {
      usePlaybackStore.getState().setSelectedCueId("c2");
      usePlaybackStore.getState().requestSeek(3500);
    });

    // Advance via setCues while mounted
    act(() => {
      useProjectStore.getState().setCues([cue("n1", 2500, 3500)]);
    });
    expect(usePlaybackStore.getState().selectedCueId).toBe("n1");
    expect(usePlaybackStore.getState().currentTimeMs).toBe(2500);

    // Advance via loadAssDocument while unmounted
    view.unmount();
    const nextDoc = createDefaultDocument("next", 1920, 1080);
    nextDoc.cues = [cue("d1", 4100, 5100), cue("d2", 6000, 7000)];
    act(() => {
      useProjectStore.getState().loadAssDocument(nextDoc);
    });

    const remount = render(<EditorView />);
    await act(async () => {});
    expect(usePlaybackStore.getState().selectedCueId).toBe("d1");
    expect(usePlaybackStore.getState().currentTimeMs).toBe(4100);

    // Advance via setSession while mounted (cues cleared -> empty selection & 0ms)
    act(() => {
      useProjectStore.getState().setSession(makeVideoSession("new-session"));
    });
    expect(usePlaybackStore.getState().selectedCueId).toBeNull();
    expect(usePlaybackStore.getState().currentTimeMs).toBe(0);
    remount.unmount();
  });

  it("calls acceptTextSession on unmount to cancel incomplete IME and end active text sessions", async () => {
    loadSessionAndCues([cue("c1", 1000, 2000, "abc")]);

    const view = render(<EditorView />);
    await act(async () => {});

    act(() => {
      useProjectStore.getState().applyTextEdit({
        cueId: "c1",
        text: "abcd",
        op: makeTextOp({
          cueId: "c1",
          before: { start: 3, end: 3 },
          after: { start: 4, end: 4 },
          inputType: "insertText",
          timestampMs: 1000,
        }),
      });
      useProjectStore.getState().beginComposition({
        cueId: "c1",
        start: 4,
        end: 4,
        direction: "none",
      });
      useProjectStore.getState().updateCompositionPreview("c1", "abcdに");
    });

    expect(useProjectStore.getState().history.compositionPreview).toBe(true);
    expect(useProjectStore.getState().history.textSession).not.toBeNull();

    view.unmount();

    const state = useProjectStore.getState();
    expect(state.cues[0]?.primaryText).toBe("abcd");
    expect(state.history.compositionPreview).toBe(false);
    expect(state.history.compositionBaseline).toBeNull();
    expect(state.history.textSession).toBeNull();
  });
});
