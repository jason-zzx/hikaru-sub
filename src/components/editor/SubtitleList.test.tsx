// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultStyles } from "@/lib/ass";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useProjectStore } from "../../stores/projectStore";
import type { SubtitleCue } from "../../types";
import { SubtitleList } from "./SubtitleList";
import {
  SubtitleEditor,
  type SubtitleEditorHistoryHandle,
} from "./SubtitleEditor";

vi.mock("../../hooks/usePreviewFontNames", () => ({
  usePreviewFontNames: () => ["Arial"],
}));

const cues: SubtitleCue[] = [
  {
    id: "a",
    startMs: 0,
    endMs: 1000,
    primaryText: "A text",
    style: "Primary",
    layer: 0,
  },
  {
    id: "b",
    startMs: 2000,
    endMs: 3000,
    primaryText: "B text",
    style: "Primary",
    layer: 0,
  },
];

function resetSelection(ids: string[]) {
  useProjectStore.setState({
    ...useProjectStore.getInitialState(),
    cues,
    assStyles: createDefaultStyles(),
  });
  usePlaybackStore.setState({
    ...usePlaybackStore.getInitialState(),
    selectedCueIds: ids,
    selectedCueId: ids[ids.length - 1] ?? null,
    durationMs: 10000,
  });
}

function rowFor(text: string): HTMLElement {
  const cell = screen.getByText(text);
  if (!cell.parentElement) throw new Error("subtitle row missing");
  return cell.parentElement;
}

describe("SubtitleList shift menu", () => {
  beforeEach(() => resetSelection(["a"]));
  afterEach(cleanup);

  it("flushes the old active draft before right-click selects an unselected row", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const onRequestShiftTimes = vi.fn((ids: string[]) => {
      order.push(`request:${ids.join(",")}`);
    });
    const onCommitPendingTimeDraft = vi.fn(() => {
      order.push(`commit:${usePlaybackStore.getState().selectedCueId}`);
    });
    render(
      <SubtitleList
        onCommitPendingTimeDraft={onCommitPendingTimeDraft}
        onRequestShiftTimes={onRequestShiftTimes}
      />,
    );

    fireEvent.contextMenu(rowFor("B text"), { clientX: 10, clientY: 10 });
    expect(order).toEqual(["commit:a"]);
    expect(usePlaybackStore.getState().selectedCueIds).toEqual(["b"]);

    await user.click(screen.getByRole("button", { name: "平移时间轴" }));
    expect(onRequestShiftTimes).toHaveBeenCalledWith(["b"]);
    expect(order).toEqual(["commit:a", "request:b"]);
  });

  it("commits the old row's visible time draft before switching rows", async () => {
    const user = userEvent.setup();
    const editorRef = createRef<SubtitleEditorHistoryHandle>();
    const onRequestShiftTimes = vi.fn();
    render(
      <>
        <SubtitleEditor ref={editorRef} />
        <SubtitleList
          onCommitPendingTimeDraft={() =>
            editorRef.current?.commitPendingTimeDraft()
          }
          onRequestShiftTimes={onRequestShiftTimes}
        />
      </>,
    );

    const startInput = document.querySelector<HTMLInputElement>(
      'input[data-history-command="true"]',
    );
    if (!startInput) throw new Error("start time input missing");
    fireEvent.change(startInput, {
      target: { value: "0:00:00.50", selectionStart: 10 },
    });

    fireEvent.contextMenu(rowFor("B text"), { clientX: 10, clientY: 10 });
    expect(useProjectStore.getState().cues[0].startMs).toBe(500);
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "平移时间轴" }));
    expect(onRequestShiftTimes).toHaveBeenCalledWith(["b"]);
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it("keeps the full selection snapshot when right-clicking a selected row", async () => {
    const user = userEvent.setup();
    resetSelection(["a", "b"]);
    const onCommitPendingTimeDraft = vi.fn();
    const onRequestShiftTimes = vi.fn();
    render(
      <SubtitleList
        onCommitPendingTimeDraft={onCommitPendingTimeDraft}
        onRequestShiftTimes={onRequestShiftTimes}
      />,
    );

    fireEvent.contextMenu(rowFor("A text"), { clientX: 10, clientY: 10 });
    await user.click(screen.getByRole("button", { name: "平移时间轴" }));

    expect(onCommitPendingTimeDraft).not.toHaveBeenCalled();
    expect(onRequestShiftTimes).toHaveBeenCalledWith(["a", "b"]);
    expect(usePlaybackStore.getState().selectedCueIds).toEqual(["a", "b"]);
  });
});
