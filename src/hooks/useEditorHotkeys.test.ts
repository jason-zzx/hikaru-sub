import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEditorActions } from "./useEditorHotkeys";
import { useProjectStore } from "../stores/projectStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useUiStore } from "../stores/uiStore";
import type { SubtitleCue } from "../types";

const writeMock = vi.fn();
const readMock = vi.fn();

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (...args: unknown[]) => writeMock(...args),
  readText: (...args: unknown[]) => readMock(...args),
}));

function cue(id: string, startMs: number, endMs: number): SubtitleCue {
  return { id, startMs, endMs, primaryText: id, style: "Primary", layer: 0 };
}

const CUES = [cue("a", 0, 1000), cue("b", 2000, 3000), cue("c", 5000, 6000)];

function make_actions(onNotify = vi.fn()) {
  return buildEditorActions({
    onSave: vi.fn(),
    onToggleHelp: vi.fn(),
    onNotify,
  });
}

beforeEach(() => {
  writeMock.mockReset();
  readMock.mockReset();
  writeMock.mockResolvedValue(undefined);
  readMock.mockResolvedValue("");
  useProjectStore.setState({
    cues: CUES,
    isDirty: false,
    history: { past: [], future: [] },
  });
  usePlaybackStore.setState({
    currentTimeMs: 0,
    durationMs: 60000,
    isPlaying: false,
    selectedCueId: null,
    selectedCueIds: [],
    fps: 25,
    playUntilMs: null,
  });
  useUiStore.setState({ editorFocusNonce: 0 });
});

describe("导航动作", () => {
  it("select-next 选中下一条并 seek 到起点、中断片段播放", () => {
    usePlaybackStore.setState({ selectedCueId: "a", playUntilMs: 9000 });
    make_actions()["select-next"]!();
    const pb = usePlaybackStore.getState();
    expect(pb.selectedCueId).toBe("b");
    expect(pb.currentTimeMs).toBe(2000);
    expect(pb.playUntilMs).toBeNull();
  });

  it("select-first / select-last / 翻页", () => {
    usePlaybackStore.setState({ selectedCueId: "b" });
    const actions = make_actions();
    actions["select-last"]!();
    expect(usePlaybackStore.getState().selectedCueId).toBe("c");
    actions["select-first"]!();
    expect(usePlaybackStore.getState().selectedCueId).toBe("a");
    actions["select-page-down"]!();
    expect(usePlaybackStore.getState().selectedCueId).toBe("c"); // +10 越界收末条
  });
});

describe("播放头动作", () => {
  it("frame-next 按 25fps 前进到下一帧中心", () => {
    make_actions()["frame-next"]!();
    expect(usePlaybackStore.getState().currentTimeMs).toBeCloseTo(60);
  });

  it("boundary-next 跳到下一个字幕边界", () => {
    usePlaybackStore.setState({ currentTimeMs: 500 });
    make_actions()["boundary-next"]!();
    expect(usePlaybackStore.getState().currentTimeMs).toBe(1000);
  });

  it("boundary-prev 无边界时不动", () => {
    usePlaybackStore.setState({ currentTimeMs: 0 });
    make_actions()["boundary-prev"]!();
    expect(usePlaybackStore.getState().currentTimeMs).toBe(0);
  });

  it("toggle-play 切换播放状态", () => {
    const actions = make_actions();
    actions["toggle-play"]!();
    expect(usePlaybackStore.getState().isPlaying).toBe(true);
    actions["toggle-play"]!();
    expect(usePlaybackStore.getState().isPlaying).toBe(false);
  });

  it("play-segment 从选中 cue 起点播放到终点；再按中断", () => {
    usePlaybackStore.setState({ selectedCueId: "b", currentTimeMs: 0 });
    const actions = make_actions();
    actions["play-segment"]!();
    let pb = usePlaybackStore.getState();
    expect(pb.currentTimeMs).toBe(2000);
    expect(pb.playUntilMs).toBe(3000);
    expect(pb.isPlaying).toBe(true);
    actions["play-segment"]!();
    pb = usePlaybackStore.getState();
    expect(pb.isPlaying).toBe(false);
    expect(pb.playUntilMs).toBeNull();
  });

  it("play-segment 无选中时 no-op", () => {
    make_actions()["play-segment"]!();
    expect(usePlaybackStore.getState().isPlaying).toBe(false);
  });
});

describe("打点动作", () => {
  it("stamp-start / stamp-end 写入选中 cue（取整）", () => {
    usePlaybackStore.setState({ selectedCueId: "b", currentTimeMs: 2500.6 });
    const actions = make_actions();
    actions["stamp-start"]!();
    expect(useProjectStore.getState().cues.find((c) => c.id === "b")?.startMs).toBe(2501);
    usePlaybackStore.setState({ currentTimeMs: 3500.2 });
    actions["stamp-end"]!();
    expect(useProjectStore.getState().cues.find((c) => c.id === "b")?.endMs).toBe(3500);
  });

  it("无选中时 no-op", () => {
    make_actions()["stamp-start"]!();
    expect(useProjectStore.getState().cues).toEqual(CUES);
  });
});

describe("编辑动作", () => {
  it("new-cue 在播放头新建、选中并请求聚焦", () => {
    usePlaybackStore.setState({ currentTimeMs: 10000 });
    make_actions()["new-cue"]!();
    const cues = useProjectStore.getState().cues;
    expect(cues).toHaveLength(4);
    const created = cues.find((c) => c.startMs === 10000)!;
    expect(created.primaryText).toBe("新建字幕");
    expect(usePlaybackStore.getState().selectedCueId).toBe(created.id);
    expect(useUiStore.getState().editorFocusNonce).toBe(1);
    expect(new Set(cues.map((c) => c.id)).size).toBe(cues.length);
  });

  it("delete-cue 删除选中后清除片段播放并通知可撤销", () => {
    const onNotify = vi.fn();
    usePlaybackStore.setState({ selectedCueId: "b", playUntilMs: 3000 });
    make_actions(onNotify)["delete-cue"]!();
    expect(useProjectStore.getState().cues.map((c) => c.id)).toEqual(["a", "c"]);
    expect(usePlaybackStore.getState().selectedCueId).toBe("c");
    expect(usePlaybackStore.getState().playUntilMs).toBeNull();
    expect(onNotify).toHaveBeenCalledWith("info", "已删除字幕，可按 Ctrl+Z 撤销");
  });

  it("delete-cue 删除选中并顺延选中下一条（按原索引）", () => {
    usePlaybackStore.setState({ selectedCueId: "b" });
    make_actions()["delete-cue"]!();
    expect(useProjectStore.getState().cues.map((c) => c.id)).toEqual(["a", "c"]);
    expect(usePlaybackStore.getState().selectedCueId).toBe("c");
  });

  it("delete-cue 删除最后一条后选中前一条；删空后为 null", () => {
    usePlaybackStore.setState({ selectedCueId: "c" });
    const actions = make_actions();
    actions["delete-cue"]!();
    expect(usePlaybackStore.getState().selectedCueId).toBe("b");
    useProjectStore.setState({ cues: [cue("only", 0, 1000)] });
    usePlaybackStore.setState({ selectedCueId: "only" });
    actions["delete-cue"]!();
    expect(usePlaybackStore.getState().selectedCueId).toBeNull();
  });

  it("copy/cut/paste operate on whole selected cue rows via system clipboard", async () => {
    usePlaybackStore.setState({ selectedCueId: "b", selectedCueIds: ["b"] });
    const actions = make_actions();
    let clipboard = "";
    writeMock.mockImplementation(async (text: string) => {
      clipboard = text;
    });
    readMock.mockImplementation(async () => clipboard);

    actions["copy-cues"]!();
    await vi.waitFor(() => expect(writeMock).toHaveBeenCalled());

    actions["paste-cues"]!();
    await vi.waitFor(() =>
      expect(useProjectStore.getState().cues.map((cue) => cue.primaryText)).toEqual([
        "a",
        "b",
        "b",
        "c",
      ]),
    );
    const pastedId = usePlaybackStore.getState().selectedCueIds[0];
    expect(pastedId).toBeTruthy();
    expect(pastedId).not.toBe("b");

    actions["cut-cues"]!();
    await vi.waitFor(() =>
      expect(useProjectStore.getState().cues.some((cue) => cue.id === pastedId)).toBe(false),
    );
  });

  it("delete-cue deletes the whole multi-selection when selectedCueIds is populated", () => {
    const onNotify = vi.fn();
    usePlaybackStore.setState({
      selectedCueId: "c",
      selectedCueIds: ["b", "c"],
      playUntilMs: 3000,
    });

    make_actions(onNotify)["delete-cue"]!();

    expect(useProjectStore.getState().cues.map((cue) => cue.id)).toEqual(["a"]);
    expect(usePlaybackStore.getState().selectedCueIds).toEqual(["a"]);
    expect(usePlaybackStore.getState().playUntilMs).toBeNull();
    expect(onNotify).toHaveBeenCalledWith("info", "已删除字幕，可按 Ctrl+Z 撤销");
  });

  it("select-all-cues 选中全部字幕行，并以最后一条为活动项", () => {
    usePlaybackStore.setState({
      selectedCueId: "a",
      selectedCueIds: ["a"],
      playUntilMs: 9000,
    });

    make_actions()["select-all-cues"]!();

    const pb = usePlaybackStore.getState();
    expect(pb.selectedCueIds).toEqual(["a", "b", "c"]);
    expect(pb.selectedCueId).toBe("c");
    expect(pb.playUntilMs).toBeNull();
  });

  it("select-all-cues 无字幕时 no-op", () => {
    useProjectStore.setState({ cues: [] });
    usePlaybackStore.setState({ selectedCueId: null, selectedCueIds: [] });

    make_actions()["select-all-cues"]!();

    const pb = usePlaybackStore.getState();
    expect(pb.selectedCueIds).toEqual([]);
    expect(pb.selectedCueId).toBeNull();
  });
});

describe("系统动作", () => {
  it("save / toggle-help 走回调；undo/redo 走 projectStore", () => {
    const onSave = vi.fn();
    const onToggleHelp = vi.fn();
    const actions = buildEditorActions({ onSave, onToggleHelp });
    actions["save"]!();
    expect(onSave).toHaveBeenCalledOnce();
    actions["toggle-help"]!();
    expect(onToggleHelp).toHaveBeenCalledOnce();

    useProjectStore.getState().updateCue("a", { primaryText: "changed" });
    actions["undo"]!();
    expect(useProjectStore.getState().cues.find((c) => c.id === "a")?.primaryText).toBe("a");
    actions["redo"]!();
    expect(useProjectStore.getState().cues.find((c) => c.id === "a")?.primaryText).toBe("changed");
  });
});

describe("Phase 2B source guards", () => {
  it("buildEditorActions exposes onNotify as an option", () => {
    const onNotify = vi.fn();
    buildEditorActions({ onSave: vi.fn(), onToggleHelp: vi.fn(), onNotify });
    expect(onNotify).not.toHaveBeenCalled();
  });
});
