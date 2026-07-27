import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetActiveCueTrackerForTests,
  initActiveCueTracker,
} from "./activeCueTracker";
import { usePlaybackStore } from "../stores/playbackStore";
import { useProjectStore } from "../stores/projectStore";
import type { SubtitleCue } from "../types";

function cue(id: string, startMs: number, endMs: number): SubtitleCue {
  return {
    id,
    startMs,
    endMs,
    primaryText: id,
    style: "Primary",
    layer: 0,
  };
}

const CUES = [
  cue("a", 1000, 2000),
  cue("overlap", 1500, 2500),
  cue("b", 4000, 5000),
];

beforeEach(() => {
  __resetActiveCueTrackerForTests();
  useProjectStore.setState({
    ...useProjectStore.getInitialState(),
    cues: CUES,
  });
  usePlaybackStore.setState({
    ...usePlaybackStore.getInitialState(),
    currentTimeMs: 0,
    durationMs: 60000,
  });
});

afterEach(() => {
  __resetActiveCueTrackerForTests();
});

describe("activeCueTracker", () => {
  it("init 时按当前时间同步一次命中集合", () => {
    usePlaybackStore.setState({ currentTimeMs: 1200 });
    initActiveCueTracker();
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a"]);
  });

  it("同一 cue 内多次时间 tick 不重复写入（引用保持稳定）", () => {
    initActiveCueTracker();

    usePlaybackStore.getState().setCurrentTime(1100);
    const first = usePlaybackStore.getState().activeCueIds;
    expect(first).toEqual(["a"]);

    usePlaybackStore.getState().setCurrentTime(1200);
    usePlaybackStore.getState().setCurrentTime(1300);
    // 内容未变时不得写入新数组：React 订阅者以引用相等跳过重渲染
    expect(usePlaybackStore.getState().activeCueIds).toBe(first);
  });

  it("重叠 cue 全部命中（含 endMs 边界）", () => {
    initActiveCueTracker();
    usePlaybackStore.getState().setCurrentTime(1800);
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a", "overlap"]);

    // 普通播放/暂停沿用闭区间，endMs 时刻仍命中已结束的 a
    usePlaybackStore.getState().setCurrentTime(2000);
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a", "overlap"]);
  });

  it("段播停点驻留：保留跨界重叠 cue，不点亮恰从停点开始的下一句", () => {
    useProjectStore.setState({
      cues: [
        cue("a", 1000, 2000),
        cue("overlap", 1500, 2500),
        cue("b", 2000, 3000),
      ],
    });
    initActiveCueTracker();
    usePlaybackStore.getState().setSegmentStop({ cueId: "a", stopMs: 2000 });
    usePlaybackStore.getState().setCurrentTime(2000);
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a", "overlap"]);

    // 显式 seek 清除驻留：同一时刻回归普通闭区间，三句均命中
    usePlaybackStore.getState().requestSeek(2000);
    expect(usePlaybackStore.getState().activeCueIds).toEqual([
      "a",
      "overlap",
      "b",
    ]);
  });

  it("段播停点驻留：被播放句删除时失效，endMs 变化时仍保持快照 cue", () => {
    useProjectStore.setState({
      cues: [cue("a", 1000, 2000), cue("b", 2000, 3000)],
    });
    initActiveCueTracker();
    usePlaybackStore.getState().setSegmentStop({ cueId: "a", stopMs: 2000 });
    usePlaybackStore.getState().setCurrentTime(2000);
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a"]);

    // 删除被播放句：陈旧标记不得再排除恰从停点开始的下一句，并永久清除
    useProjectStore.setState({ cues: [cue("b", 2000, 3000)] });
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["b"]);
    expect(usePlaybackStore.getState().segmentStop).toBeNull();

    // endMs 被改动：仍按段播完成时的快照驻留，不重新解释旧停点。
    useProjectStore.setState({
      cues: [cue("a", 1000, 2000), cue("b", 2000, 3000)],
    });
    usePlaybackStore.getState().setSegmentStop({ cueId: "a", stopMs: 2000 });
    useProjectStore.setState({
      cues: [cue("a", 1000, 1800), cue("b", 2000, 3000)],
    });
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a"]);
    expect(usePlaybackStore.getState().segmentStop).toEqual({
      cueId: "a",
      stopMs: 2000,
    });
  });

  it("undo/redo 删除段播中的 cue 时永久取消 segmentPlayback", () => {
    useProjectStore.setState({ cues: [cue("a", 1000, 2000)] });
    initActiveCueTracker();
    usePlaybackStore
      .getState()
      .setSegmentPlayback({ cueId: "a", stopMs: 2000 });

    // undo 直接替换 cue 快照：引用已删 cue 的段播被取消
    useProjectStore.setState({ cues: [] });
    expect(usePlaybackStore.getState().segmentPlayback).toBeNull();

    // 已取消后重新加入同 id cue 不复活旧段播
    useProjectStore.setState({ cues: [cue("a", 1000, 2000)] });
    expect(usePlaybackStore.getState().segmentPlayback).toBeNull();

    // cue 仍存在时不干预进行中段播
    usePlaybackStore
      .getState()
      .setSegmentPlayback({ cueId: "a", stopMs: 2000 });
    useProjectStore.setState({
      cues: [cue("a", 1000, 1800), cue("b", 2000, 3000)],
    });
    expect(usePlaybackStore.getState().segmentPlayback).toEqual({
      cueId: "a",
      stopMs: 2000,
    });
  });

  it("undo/redo preserves segment-stop residency at a shared boundary", () => {
    useProjectStore.setState({
      cues: [cue("a", 1000, 2000), cue("b", 2000, 3000)],
    });
    usePlaybackStore.getState().setSelectedCueId("a");
    useProjectStore.getState().updateCue("a", { primaryText: "edited" });
    initActiveCueTracker();
    usePlaybackStore.getState().setSegmentStop({ cueId: "a", stopMs: 2000 });
    usePlaybackStore.getState().setCurrentTime(2000);

    useProjectStore.getState().undo();
    expect(usePlaybackStore.getState().segmentStop).toEqual({
      cueId: "a",
      stopMs: 2000,
    });
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a"]);

    useProjectStore.getState().redo();
    expect(usePlaybackStore.getState().segmentStop).toEqual({
      cueId: "a",
      stopMs: 2000,
    });
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a"]);
  });

  it("seek 跳变直接切换命中集合，包括跳到空档", () => {
    initActiveCueTracker();
    usePlaybackStore.getState().requestSeek(4500);
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["b"]);

    usePlaybackStore.getState().requestSeek(3000);
    expect(usePlaybackStore.getState().activeCueIds).toEqual([]);
  });

  it("cues 替换后按当前时间重算", () => {
    initActiveCueTracker();
    usePlaybackStore.getState().setCurrentTime(1200);
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a"]);

    useProjectStore.setState({ cues: [cue("x", 1000, 3000)] });
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["x"]);
  });

  it("重复 init 幂等（不叠加订阅）", () => {
    initActiveCueTracker();
    initActiveCueTracker();
    usePlaybackStore.getState().setCurrentTime(1200);
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a"]);
  });
});
