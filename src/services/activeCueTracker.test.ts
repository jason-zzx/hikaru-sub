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

  it("重叠 cue 全部命中（含边界 inclusive 语义）", () => {
    initActiveCueTracker();
    usePlaybackStore.getState().setCurrentTime(1800);
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a", "overlap"]);

    // endMs 边界按 isCueActiveAtTime 的 inclusive 语义命中
    usePlaybackStore.getState().setCurrentTime(2000);
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a", "overlap"]);
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
