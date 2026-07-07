import { beforeEach, describe, expect, it } from "vitest";
import { usePlaybackStore } from "./playbackStore";

describe("playbackStore playUntil 语义", () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      currentTimeMs: 0,
      durationMs: 60000,
      isPlaying: false,
      selectedCueId: null,
      selectedCueIds: [],
      fps: null,
      playUntilMs: null,
    });
  });

  it("setPlayUntil 设置与清除", () => {
    usePlaybackStore.getState().setPlayUntil(3000);
    expect(usePlaybackStore.getState().playUntilMs).toBe(3000);
    usePlaybackStore.getState().setPlayUntil(null);
    expect(usePlaybackStore.getState().playUntilMs).toBeNull();
  });

  it("暂停（setPlaying(false)）清除 playUntilMs——覆盖所有手动暂停路径", () => {
    usePlaybackStore.getState().setPlayUntil(3000);
    usePlaybackStore.getState().setPlaying(true);
    expect(usePlaybackStore.getState().playUntilMs).toBe(3000);
    usePlaybackStore.getState().setPlaying(false);
    expect(usePlaybackStore.getState().playUntilMs).toBeNull();
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
});
