// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultStyles, formatAssTime } from "@/lib/ass";
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

// formatAssTime 包一层 spy 作 Row 渲染计数探针：每次行渲染恰好调用 2 次（开始/结束列）
vi.mock("@/lib/ass", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ass")>();
  return {
    ...actual,
    formatAssTime: vi.fn(actual.formatAssTime),
  };
});

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

describe("SubtitleList", () => {
  beforeEach(() => resetSelection(["a"]));
  afterEach(cleanup);

  it("keeps the cue under the playhead highlighted while paused", () => {
    // 行高亮改由 activeCueIds（activeCueTracker 维护）驱动，不再按帧读 currentTimeMs
    usePlaybackStore.setState({
      currentTimeMs: 2500,
      isPlaying: false,
      activeCueIds: ["b"],
    });

    render(<SubtitleList />);

    expect(rowFor("B text").className).toContain("ring-success/35");
  });

  it("re-renders only boundary-affected rows when activeCueIds changes", () => {
    render(<SubtitleList />);
    vi.mocked(formatAssTime).mockClear();

    act(() => {
      usePlaybackStore.getState().setActiveCueIds(["b"]);
    });

    // memo Row 探针：每行渲染恰好调用 formatAssTime 2 次（开始/结束列）。
    // 仅进入边界的 b 行重渲染；a 行（选中态未变）必须 bail out。
    expect(vi.mocked(formatAssTime).mock.calls).toHaveLength(2);
    expect(rowFor("B text").className).toContain("ring-success/35");
    expect(rowFor("A text").className).not.toContain("ring-success/35");

    // 离开边界：仅 b 行重渲染回退高亮
    vi.mocked(formatAssTime).mockClear();
    act(() => {
      usePlaybackStore.getState().setActiveCueIds([]);
    });
    expect(vi.mocked(formatAssTime).mock.calls).toHaveLength(2);
    expect(rowFor("B text").className).not.toContain("ring-success/35");
  });

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

  it("gates split availability on the strict open interval at menu-open time", () => {
    // splitCueAtTime 要求分割点严格位于 (startMs, endMs)：播放头恰在行首/行尾时
    // 菜单必须禁用（inclusive 的 activeCueIds 口径会「可点但必失败」）
    const splitButton = () =>
      screen.getByRole("button", {
        name: "在当前帧后分割行",
      }) as HTMLButtonElement;

    usePlaybackStore.setState({ currentTimeMs: 2000, activeCueIds: ["b"] });
    render(<SubtitleList />);

    fireEvent.contextMenu(rowFor("B text"), { clientX: 10, clientY: 10 });
    expect(splitButton().disabled).toBe(true);

    // 严格内部：可用
    act(() => {
      usePlaybackStore.setState({ currentTimeMs: 2500 });
    });
    fireEvent.contextMenu(rowFor("B text"), { clientX: 10, clientY: 10 });
    expect(splitButton().disabled).toBe(false);

    // 行尾时刻：同样禁用
    act(() => {
      usePlaybackStore.setState({ currentTimeMs: 3000 });
    });
    fireEvent.contextMenu(rowFor("B text"), { clientX: 10, clientY: 10 });
    expect(splitButton().disabled).toBe(true);
  });

  it("splits the row when the menu was opened strictly inside it", async () => {
    const user = userEvent.setup();
    usePlaybackStore.setState({ currentTimeMs: 2500, activeCueIds: ["b"] });
    render(<SubtitleList />);

    fireEvent.contextMenu(rowFor("B text"), { clientX: 10, clientY: 10 });
    await user.click(screen.getByRole("button", { name: "在当前帧后分割行" }));

    const nextCues = useProjectStore.getState().cues;
    expect(nextCues).toHaveLength(3);
    expect(nextCues[1]).toMatchObject({ startMs: 2000, endMs: 2500 });
    expect(nextCues[2]).toMatchObject({ startMs: 2500, endMs: 3000 });
  });

  it("splits at the menu-open playhead even if time moves on before clicking", async () => {
    // 菜单挂起期间播放继续：按钮状态与分割点都必须用打开时刻的快照，
    // 否则「打开时可用 → 播放越过行尾 → 点击必失败」
    const user = userEvent.setup();
    usePlaybackStore.setState({ currentTimeMs: 2500, activeCueIds: ["b"] });
    render(<SubtitleList />);

    fireEvent.contextMenu(rowFor("B text"), { clientX: 10, clientY: 10 });
    act(() => {
      usePlaybackStore.setState({ currentTimeMs: 3200, activeCueIds: [] });
    });
    await user.click(screen.getByRole("button", { name: "在当前帧后分割行" }));

    const nextCues = useProjectStore.getState().cues;
    expect(nextCues).toHaveLength(3);
    expect(nextCues[1]).toMatchObject({ startMs: 2000, endMs: 2500 });
    expect(nextCues[2]).toMatchObject({ startMs: 2500, endMs: 3000 });
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
