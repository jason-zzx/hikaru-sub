import { beforeEach, describe, expect, it } from "vitest";
import { usePlaybackStore } from "./playbackStore";

describe("playbackStore playUntil 语义", () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      currentTimeMs: 0,
      durationMs: 60000,
      isPlaying: false,
      selectedCueId: null,
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
});
