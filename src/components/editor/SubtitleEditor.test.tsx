// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultStyles } from "@/lib/ass";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import {
  SubtitleEditor,
  type SubtitleEditorHistoryHandle,
} from "./SubtitleEditor";
import type { SubtitleCue } from "../../types";

vi.mock("../../hooks/usePreviewFontNames", () => ({
  usePreviewFontNames: () => ["Arial"],
}));

function cue(id: string, text = id): SubtitleCue {
  return {
    id,
    startMs: 0,
    endMs: 1000,
    primaryText: text,
    style: "Primary",
    layer: 0,
  };
}

function reset(cues: SubtitleCue[] = [cue("a", "ab")]) {
  useProjectStore.setState({
    ...useProjectStore.getInitialState(),
    cues,
    assStyles: createDefaultStyles(),
  });
  usePlaybackStore.setState({
    currentTimeMs: 0,
    durationMs: 60000,
    isPlaying: false,
    selectedCueId: cues[0]?.id ?? null,
    selectedCueIds: cues[0] ? [cues[0].id] : [],
    fps: 25,
    playUntilMs: null,
  });
}

function markCurrentSaved() {
  const snapshot = useProjectStore.getState().captureSaveSnapshot();
  useProjectStore.getState().markSaved(snapshot.token);
}

function subtitleTextarea(): HTMLTextAreaElement {
  const ta = document.querySelector("textarea");
  if (!ta) throw new Error("subtitle textarea missing");
  return ta;
}

describe("SubtitleEditor text history", () => {
  beforeEach(() => {
    reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("live undo works before blur for typed text", async () => {
    const user = userEvent.setup();
    reset([cue("a", "")]);
    render(<SubtitleEditor />);
    const ta = subtitleTextarea();
    await user.click(ta);
    await user.type(ta, "hi");

    expect(useProjectStore.getState().cues[0].primaryText).toBe("hi");
    expect(useProjectStore.getState().history.past.length).toBeGreaterThan(0);

    // Undo until baseline (jsdom/userEvent may not coalesce every keystroke).
    await act(async () => {
      while (useProjectStore.getState().history.past.length > 0) {
        useProjectStore.getState().undo();
      }
    });
    expect(useProjectStore.getState().cues[0].primaryText).toBe("");
  });

  it("creates history when typing without explicit beforeinput metadata", async () => {
    const user = userEvent.setup();
    render(<SubtitleEditor />);
    const ta = subtitleTextarea();
    await user.click(ta);
    await user.type(ta, "X");
    expect(useProjectStore.getState().cues[0].primaryText).toContain("X");
    expect(useProjectStore.getState().history.past.length).toBeGreaterThan(0);
  });

  it("clears in-progress composition when a reloaded document reuses the cue id", () => {
    render(<SubtitleEditor />);
    const ta = subtitleTextarea();
    fireEvent.compositionStart(ta);

    act(() => {
      useProjectStore.getState().loadAssDocument({
        scriptInfo: {
          title: "reloaded",
          scriptType: "v4.00+",
          playResX: 1920,
          playResY: 1080,
          wrapStyle: 0,
          scaledBorderAndShadow: true,
          extra: {},
        },
        styles: createDefaultStyles(),
        cues: [cue("a", "fresh")],
      });
    });

    fireEvent.input(ta, {
      inputType: "insertText",
      target: { value: "freshX", selectionStart: 6, selectionEnd: 6 },
    });

    expect(useProjectStore.getState().cues[0].primaryText).toBe("freshX");
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it("does not carry duplicate composition suppression into a reloaded document", () => {
    const queuedMicrotasks: Array<() => void> = [];
    const queueSpy = vi
      .spyOn(globalThis, "queueMicrotask")
      .mockImplementation((callback) => {
        queuedMicrotasks.push(callback);
      });

    try {
      render(<SubtitleEditor />);
      const ta = subtitleTextarea();
      fireEvent.compositionStart(ta);
      fireEvent.input(ta, {
        target: { value: "freshX", selectionStart: 6, selectionEnd: 6 },
      });
      fireEvent.compositionEnd(ta);

      act(() => {
        useProjectStore.getState().loadAssDocument({
          scriptInfo: {
            title: "reloaded",
            scriptType: "v4.00+",
            playResX: 1920,
            playResY: 1080,
            wrapStyle: 0,
            scaledBorderAndShadow: true,
            extra: {},
          },
          styles: createDefaultStyles(),
          cues: [cue("a", "fresh")],
        });
      });

      fireEvent.input(ta, {
        inputType: "insertText",
        target: { value: "freshX", selectionStart: 6, selectionEnd: 6 },
      });

      expect(useProjectStore.getState().cues[0].primaryText).toBe("freshX");
      expect(useProjectStore.getState().history.past).toHaveLength(1);
    } finally {
      queuedMicrotasks.forEach((callback) => callback());
      queueSpy.mockRestore();
    }
  });

  it.each([
    {
      name: "Backspace",
      inputType: "deleteContentBackward",
      initialCaret: 4,
      edits: [
        { text: "A😀C", caret: 3 },
        { text: "AC", caret: 1 },
      ],
    },
    {
      name: "Delete",
      inputType: "deleteContentForward",
      initialCaret: 1,
      edits: [
        { text: "ABC", caret: 1 },
        { text: "AC", caret: 1 },
      ],
    },
  ])(
    "coalesces consecutive $name input events when beforeinput is missing",
    ({ inputType, initialCaret, edits }) => {
      reset([cue("a", "A😀BC")]);
      render(<SubtitleEditor />);
      const ta = subtitleTextarea();
      ta.focus();
      ta.setSelectionRange(initialCaret, initialCaret);
      fireEvent.select(ta);

      for (const edit of edits) {
        fireEvent.input(ta, {
          inputType,
          target: {
            value: edit.text,
            selectionStart: edit.caret,
            selectionEnd: edit.caret,
          },
        });
      }

      expect(useProjectStore.getState().history.past).toHaveLength(1);
      useProjectStore.getState().undo();
      expect(useProjectStore.getState().cues[0].primaryText).toBe("A😀BC");
    },
  );

  it("keeps selection deletions discrete without beforeinput", () => {
    reset([cue("a", "abcdef")]);
    render(<SubtitleEditor />);
    const ta = subtitleTextarea();
    ta.focus();

    ta.setSelectionRange(1, 3);
    fireEvent.select(ta);
    fireEvent.input(ta, {
      inputType: "deleteContentBackward",
      target: { value: "adef", selectionStart: 1, selectionEnd: 1 },
    });

    ta.setSelectionRange(1, 2);
    fireEvent.select(ta);
    fireEvent.input(ta, {
      inputType: "deleteContentBackward",
      target: { value: "aef", selectionStart: 1, selectionEnd: 1 },
    });

    expect(useProjectStore.getState().history.past).toHaveLength(2);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().cues[0].primaryText).toBe("adef");
  });

  it("does not guess deletion grouping when inputType is missing", () => {
    reset([cue("a", "abc")]);
    render(<SubtitleEditor />);
    const ta = subtitleTextarea();
    ta.focus();
    ta.setSelectionRange(3, 3);
    fireEvent.select(ta);

    fireEvent.input(ta, {
      target: { value: "ab", selectionStart: 2, selectionEnd: 2 },
    });
    fireEvent.input(ta, {
      target: { value: "a", selectionStart: 1, selectionEnd: 1 },
    });

    expect(useProjectStore.getState().history.past).toHaveLength(2);
  });

  it("Escape after undo-then-type restores data and redo branch", async () => {
    const user = userEvent.setup();
    useProjectStore.getState().updateCue("a", { primaryText: "one" });
    useProjectStore.getState().updateCue("a", { primaryText: "two" });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().cues[0].primaryText).toBe("one");
    expect(useProjectStore.getState().history.future.length).toBeGreaterThan(0);

    render(<SubtitleEditor />);
    const ta = subtitleTextarea();
    await user.click(ta);
    await user.type(ta, "Z");
    expect(useProjectStore.getState().history.future).toHaveLength(0);

    await user.keyboard("{Escape}");
    expect(useProjectStore.getState().cues[0].primaryText).toBe("one");
    expect(useProjectStore.getState().history.future.length).toBeGreaterThan(0);
  });

  it("blur without edit does not mark dirty or add history", async () => {
    const user = userEvent.setup();
    markCurrentSaved();
    render(<SubtitleEditor />);
    const ta = subtitleTextarea();
    await user.click(ta);
    await user.tab();
    expect(useProjectStore.getState().isDirty).toBe(false);
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });

  it("single-row formatting creates one discrete history item", async () => {
    const user = userEvent.setup();
    render(<SubtitleEditor />);
    const ta = subtitleTextarea();
    await user.click(ta);
    ta.setSelectionRange(0, 2);
    const bold = document.querySelector(
      'button[title="插入粗体标签"]',
    ) as HTMLButtonElement;
    await user.click(bold);
    expect(useProjectStore.getState().cues[0].primaryText).toContain("\\b1");
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it("flushes start and end drafts with field-specific normalization", () => {
    reset([{ ...cue("a", "ab"), startMs: 1000, endMs: 2000 }]);
    const ref = createRef<SubtitleEditorHistoryHandle>();
    const first = render(<SubtitleEditor ref={ref} />);
    const startInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="00:00:00.00"]',
    );

    fireEvent.change(startInput!, { target: { value: "00:00:03.00" } });
    expect(ref.current?.commitPendingTimeDraft()).toBe(true);
    expect(useProjectStore.getState().cues[0]).toMatchObject({
      startMs: 2000,
      endMs: 2000,
    });

    first.unmount();
    reset([{ ...cue("a", "ab"), startMs: 1000, endMs: 2000 }]);
    render(<SubtitleEditor ref={ref} />);
    const [, endInput] = document.querySelectorAll<HTMLInputElement>(
      'input[placeholder="00:00:00.00"]',
    );
    fireEvent.change(endInput!, { target: { value: "00:00:00.50" } });
    expect(ref.current?.commitPendingTimeDraft()).toBe(true);
    expect(useProjectStore.getState().cues[0]).toMatchObject({
      startMs: 1000,
      endMs: 1000,
    });
  });

  it("treats a start draft clamped to the existing end as no pending change", () => {
    reset([{ ...cue("a", "ab"), startMs: 2000, endMs: 2000 }]);
    const ref = createRef<SubtitleEditorHistoryHandle>();
    render(<SubtitleEditor ref={ref} />);
    const startInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="00:00:00.00"]',
    );

    fireEvent.change(startInput!, { target: { value: "00:00:03.00" } });
    expect(ref.current?.commitPendingTimeDraft()).toBe(false);
    expect(useProjectStore.getState().history.past).toHaveLength(0);
  });

  it("marks history-command on subtitle and time inputs only", () => {
    render(<SubtitleEditor />);
    const marked = document.querySelectorAll("[data-history-command='true']");
    expect(marked.length).toBe(3); // start, end, textarea
    const fontSize = document.querySelector('input[type="number"]');
    expect(fontSize?.getAttribute("data-history-command")).toBeNull();
  });
});
