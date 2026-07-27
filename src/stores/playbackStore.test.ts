import { beforeEach, describe, expect, it } from "vitest";
import { usePlaybackStore } from "./playbackStore";

describe("playbackStore 段播语义", () => {
  beforeEach(() => {
    usePlaybackStore.setState({ ...usePlaybackStore.getInitialState() });
  });

  it("atomically completes segment playback at the captured stop", () => {
    const segment = { cueId: "a", stopMs: 3000 };
    usePlaybackStore.setState({
      currentTimeMs: 2990,
      isPlaying: true,
      segmentPlayback: segment,
      activeCueIds: [],
    });
    const snapshots: Array<{
      currentTimeMs: number;
      isPlaying: boolean;
      segmentPlayback: typeof segment | null;
      segmentStop: typeof segment | null;
      activeCueIds: string[];
    }> = [];
    const unsubscribe = usePlaybackStore.subscribe((state) => {
      snapshots.push({
        currentTimeMs: state.currentTimeMs,
        isPlaying: state.isPlaying,
        segmentPlayback: state.segmentPlayback,
        segmentStop: state.segmentStop,
        activeCueIds: state.activeCueIds,
      });
    });

    usePlaybackStore
      .getState()
      .completeSegmentPlayback(segment, ["a", "overlap"]);
    usePlaybackStore.getState().setCurrentTime(3000);
    usePlaybackStore.getState().setPlaying(false);
    unsubscribe();

    expect(snapshots).toEqual([
      {
        currentTimeMs: 3000,
        isPlaying: false,
        segmentPlayback: null,
        segmentStop: segment,
        activeCueIds: ["a", "overlap"],
      },
    ]);
  });

  it("暂停（setPlaying(false)）清除段播——覆盖所有手动暂停路径", () => {
    usePlaybackStore
      .getState()
      .setSegmentPlayback({ cueId: "a", stopMs: 3000 });
    usePlaybackStore.getState().setPlaying(true);
    expect(usePlaybackStore.getState().segmentPlayback).not.toBeNull();
    usePlaybackStore.getState().setPlaying(false);
    expect(usePlaybackStore.getState().segmentPlayback).toBeNull();
  });

  it("setFps 记录帧率", () => {
    usePlaybackStore.getState().setFps(29.97);
    expect(usePlaybackStore.getState().fps).toBe(29.97);
  });

  it("setSelectedCueId keeps the multi-selection in sync for single selection", () => {
    usePlaybackStore.getState().setSelectedCueId("cue-1");

    expect(usePlaybackStore.getState().selectedCueId).toBe("cue-1");
    expect(usePlaybackStore.getState().selectedCueIds).toEqual(["cue-1"]);
  });

  it("setSelectedCueIds records a multi-selection and uses the last id as active", () => {
    usePlaybackStore.getState().setSelectedCueIds(["cue-1", "cue-3"]);

    expect(usePlaybackStore.getState().selectedCueId).toBe("cue-3");
    expect(usePlaybackStore.getState().selectedCueIds).toEqual(["cue-1", "cue-3"]);
  });

  it("clearCueSelection clears active and multi-selection state", () => {
    usePlaybackStore.getState().setSelectedCueIds(["cue-1", "cue-2"]);
    usePlaybackStore.getState().clearCueSelection();

    expect(usePlaybackStore.getState().selectedCueId).toBeNull();
    expect(usePlaybackStore.getState().selectedCueIds).toEqual([]);
  });

  it("requestSeek 同步写时间、递增 seq，并退出段播但保持播放", () => {
    usePlaybackStore.setState({
      isPlaying: true,
      segmentPlayback: { cueId: "a", stopMs: 3000 },
      segmentStop: { cueId: "a", stopMs: 3000 },
    });
    usePlaybackStore.getState().requestSeek(1500);
    let state = usePlaybackStore.getState();
    expect(state.currentTimeMs).toBe(1500);
    expect(state.seekRequest).toEqual({ ms: 1500, seq: 1 });
    expect(state.segmentPlayback).toBeNull();
    expect(state.segmentStop).toBeNull();
    expect(state.isPlaying).toBe(true);

    // 同一目标时间的重复请求也必须产生新的 seq（seek-to-same-time 仍要触发 video seek）
    usePlaybackStore.getState().requestSeek(1500);
    state = usePlaybackStore.getState();
    expect(state.seekRequest).toEqual({ ms: 1500, seq: 2 });
  });

  it("setCurrentTime（播放回写）不产生 seekRequest", () => {
    usePlaybackStore.getState().setCurrentTime(2000);
    const state = usePlaybackStore.getState();
    expect(state.currentTimeMs).toBe(2000);
    expect(state.seekRequest).toBeNull();
  });

  it("setActiveCueIds 记录当前命中集合", () => {
    usePlaybackStore.getState().setActiveCueIds(["a", "b"]);
    expect(usePlaybackStore.getState().activeCueIds).toEqual(["a", "b"]);
  });

  it("segmentStop 驻留：停点等值回写保留，移动或显式 seek 清除", () => {
    const stop = { cueId: "a", stopMs: 3000 };
    usePlaybackStore.getState().setSegmentStop(stop);
    usePlaybackStore.getState().setCurrentTime(3000);
    expect(usePlaybackStore.getState().segmentStop).toEqual(stop);

    // 停点上的等值回写（rAF cleanup / 暂停后 timeupdate）不清除驻留
    usePlaybackStore.getState().setCurrentTime(3000);
    expect(usePlaybackStore.getState().segmentStop).toEqual(stop);

    // 回写移动到其他时间即清除
    usePlaybackStore.getState().setCurrentTime(3200);
    expect(usePlaybackStore.getState().segmentStop).toBeNull();

    // 显式 seek 无条件清除（即使目标恰为停点时间）
    usePlaybackStore.getState().setSegmentStop(stop);
    usePlaybackStore.getState().requestSeek(3000);
    expect(usePlaybackStore.getState().segmentStop).toBeNull();
  });

  it("segmentStop 驻留：相同的归一化选择不会清除", () => {
    const stop = { cueId: "a", stopMs: 3000 };
    usePlaybackStore.setState({
      selectedCueId: "a",
      selectedCueIds: ["a"],
      segmentStop: stop,
    });

    usePlaybackStore.getState().setSelectedCueId("a");
    expect(usePlaybackStore.getState().segmentStop).toEqual(stop);

    usePlaybackStore.getState().setSelectedCueIds(["a", "a"]);
    expect(usePlaybackStore.getState().segmentStop).toEqual(stop);
  });

  it("segmentStop 驻留：恢复播放或选中变化即清除", () => {
    const stop = { cueId: "a", stopMs: 3000 };

    // 恢复普通播放：驻留立即失效，不等第一帧时间回写
    usePlaybackStore.getState().setSegmentStop(stop);
    usePlaybackStore.getState().setPlaying(true);
    expect(usePlaybackStore.getState().segmentStop).toBeNull();
    usePlaybackStore.getState().setPlaying(false);

    // 选中变化 = 焦点移动：单选/多选/清空均解除驻留
    usePlaybackStore.getState().setSegmentStop(stop);
    usePlaybackStore.getState().setSelectedCueId("b");
    expect(usePlaybackStore.getState().segmentStop).toBeNull();

    usePlaybackStore.getState().setSegmentStop(stop);
    usePlaybackStore.getState().setSelectedCueIds(["a", "b"]);
    expect(usePlaybackStore.getState().segmentStop).toBeNull();

    usePlaybackStore.getState().setSegmentStop(stop);
    usePlaybackStore.getState().clearCueSelection();
    expect(usePlaybackStore.getState().segmentStop).toBeNull();
  });
});
