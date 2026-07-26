import { beforeEach, describe, expect, it } from "vitest";
import { playSelectedCueSegment } from "./playbackActions";
import { useProjectStore } from "../stores/projectStore";
import { usePlaybackStore } from "../stores/playbackStore";
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

const CUES = [cue("a", 0, 1000), cue("b", 2000, 3000), cue("c", 5000, 6000)];

beforeEach(() => {
  useProjectStore.setState({
    ...useProjectStore.getInitialState(),
    cues: CUES,
  });
  usePlaybackStore.setState({
    currentTimeMs: 0,
    durationMs: 60000,
    isPlaying: false,
    selectedCueId: null,
    selectedCueIds: [],
    fps: 25,
    playUntilMs: null,
    activeCueIds: [],
    seekRequest: null,
  });
});

describe("playSelectedCueSegment", () => {
  // 用例自 useEditorHotkeys.test.ts 迁移：行为与 R（play-segment）保持一致
  it("从选中 cue 起点播放到终点；再触发中断", () => {
    usePlaybackStore.setState({ selectedCueId: "b", currentTimeMs: 0 });
    playSelectedCueSegment();
    let pb = usePlaybackStore.getState();
    expect(pb.currentTimeMs).toBe(2000);
    // 跳行首是用户意图 seek：必须产生 seekRequest 供 VideoPlayer 消费
    expect(pb.seekRequest?.ms).toBe(2000);
    expect(pb.playUntilMs).toBe(3000);
    expect(pb.isPlaying).toBe(true);
    playSelectedCueSegment();
    pb = usePlaybackStore.getState();
    expect(pb.isPlaying).toBe(false);
    expect(pb.playUntilMs).toBeNull();
  });

  it("无选中时 no-op", () => {
    playSelectedCueSegment();
    expect(usePlaybackStore.getState().isPlaying).toBe(false);
  });

  it("普通播放中（无 playUntilMs）触发时按段播重新定位而非中断", () => {
    usePlaybackStore.setState({
      selectedCueId: "b",
      currentTimeMs: 4000,
      isPlaying: true,
      playUntilMs: null,
    });
    playSelectedCueSegment();
    const pb = usePlaybackStore.getState();
    expect(pb.currentTimeMs).toBe(2000);
    expect(pb.playUntilMs).toBe(3000);
    expect(pb.isPlaying).toBe(true);
  });
});
