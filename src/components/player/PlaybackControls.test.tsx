// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackStore } from "../../stores/playbackStore";
import {
  EDITOR_HOTKEYS,
  formatActionShortcutTitle,
} from "../editor/hotkeys";

const mocks = vi.hoisted(() => ({
  playSelectedCueSegment: vi.fn(),
}));

vi.mock("../../services/playbackActions", () => ({
  playSelectedCueSegment: mocks.playSelectedCueSegment,
}));

import { PlaybackControls } from "./PlaybackControls";

const PLAY_SEGMENT_TITLE = formatActionShortcutTitle(
  "播放当前行",
  "play-segment",
  EDITOR_HOTKEYS,
);

afterEach(cleanup);

beforeEach(() => {
  mocks.playSelectedCueSegment.mockReset();
  usePlaybackStore.setState({
    ...usePlaybackStore.getInitialState(),
    durationMs: 60000,
  });
});

describe("PlaybackControls 用户意图 seek", () => {
  it("进度条与 ±5s 按目标时间发起 seek", () => {
    render(<PlaybackControls />);

    const slider = document.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error("progress slider missing");
    fireEvent.change(slider, { target: { value: "1234" } });
    expect(usePlaybackStore.getState().seekRequest?.ms).toBe(1234);

    fireEvent.click(screen.getByTitle("前进 5 秒"));
    expect(usePlaybackStore.getState().seekRequest?.ms).toBe(6234);

    fireEvent.click(screen.getByTitle("后退 5 秒"));
    expect(usePlaybackStore.getState().seekRequest?.ms).toBe(1234);
  });
});

describe("PlaybackControls 播放当前行按钮", () => {
  it("渲染按钮并带 R 快捷键 tooltip", () => {
    usePlaybackStore.setState({ selectedCueId: "a", selectedCueIds: ["a"] });
    render(<PlaybackControls />);
    const button = screen.getByTitle(PLAY_SEGMENT_TITLE);
    expect(button).toBeTruthy();
    expect(button.querySelector("svg")).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("无选中行时禁用且点击不触发", () => {
    render(<PlaybackControls />);
    const button = screen.getByTitle(PLAY_SEGMENT_TITLE) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.playSelectedCueSegment).not.toHaveBeenCalled();
  });

  it("点击调用 playSelectedCueSegment", () => {
    usePlaybackStore.setState({ selectedCueId: "a", selectedCueIds: ["a"] });
    render(<PlaybackControls />);
    fireEvent.click(screen.getByTitle(PLAY_SEGMENT_TITLE));
    expect(mocks.playSelectedCueSegment).toHaveBeenCalledOnce();
  });
});
