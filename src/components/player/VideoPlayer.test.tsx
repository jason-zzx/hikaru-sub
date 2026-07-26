// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPreviewFonts } from "../../services/previewFontDiscovery";
import { getVideoInfo } from "../../services/tauri";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useProjectStore } from "../../stores/projectStore";
import { VideoPlayer } from "./VideoPlayer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../services/previewFontDiscovery", () => ({
  getPreviewFonts: vi.fn(),
}));
vi.mock("../../services/tauri", () => ({ getVideoInfo: vi.fn() }));
// 字幕叠加层与播放头/seek 用例无关：避免拉起 libass/worker 依赖
vi.mock("./SubtitlePreview", () => ({ SubtitlePreview: () => null }));

async function renderPlayer() {
  const result = render(<VideoPlayer videoPath="C:/video.mp4" />);
  // 吸收 probe → register_media_playback → setVideoSrc 的微任务链
  await act(async () => {});
  const video = result.container.querySelector("video");
  if (!video) throw new Error("video element missing");
  return { ...result, video };
}

/** jsdom 无媒体实现：给实例装可控的 currentTime / readyState */
function installMediaStubs(video: HTMLVideoElement) {
  let mediaTimeSec = 0;
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => mediaTimeSec,
    set: (value: number) => {
      mediaTimeSec = value;
    },
  });
  Object.defineProperty(video, "readyState", {
    configurable: true,
    // HAVE_METADATA：seek 效应走同步 applySeek 分支
    get: () => 1,
  });
  return {
    get timeSec() {
      return mediaTimeSec;
    },
    set timeSec(value: number) {
      mediaTimeSec = value;
    },
  };
}

beforeEach(() => {
  usePlaybackStore.setState({ ...usePlaybackStore.getInitialState() });
  useProjectStore.setState({ ...useProjectStore.getInitialState() });
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "probe_video_playback") {
      return { videoCodec: "h264", formatName: "mp4", needsTranscode: false };
    }
    if (cmd === "register_media_playback") {
      return "http://127.0.0.1:9999/media/test-token";
    }
    throw new Error(`unexpected invoke: ${String(cmd)}`);
  });
  vi.mocked(listen).mockResolvedValue(() => {});
  vi.mocked(getPreviewFonts).mockResolvedValue([]);
  vi.mocked(getVideoInfo).mockResolvedValue({
    width: 1280,
    height: 720,
    durationMs: 60_000,
    fps: 30,
  });
  // useVideoDisplayRect 在视频就绪后构造 ResizeObserver（jsdom 无内建实现）
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("VideoPlayer seek write-back gate", () => {
  it("recovers time write-back when a follow-up seek lands in the dead zone", async () => {
    const { video } = await renderPlayer();
    const media = installMediaStubs(video);

    // 第一次 seek：正常写到 video 上，isSeeking 门闩挂起等待 seeked
    act(() => {
      usePlaybackStore.getState().requestSeek(5000);
    });
    expect(media.timeSec).toBe(5);

    // seeked 未到时又来第二次 seek，目标与视频当前位置差 2ms（< 暂停死区 5ms）→ 早退。
    // 旧实现此时已被前一轮效应 cleanup 摘掉一次性 seeked 监听，门闩永久悬挂。
    act(() => {
      usePlaybackStore.getState().requestSeek(5002);
    });
    expect(media.timeSec).toBe(5);

    // seek 进行中回写仍被抑制（既有行为保留）
    media.timeSec = 5.6;
    act(() => {
      video.dispatchEvent(new Event("timeupdate"));
    });
    expect(usePlaybackStore.getState().currentTimeMs).toBe(5002);

    // 常驻 seeked 监听复位门闩后，timeupdate 回写必须恢复（播放头不再冻结）
    act(() => {
      video.dispatchEvent(new Event("seeked"));
    });
    media.timeSec = 6.5;
    act(() => {
      video.dispatchEvent(new Event("timeupdate"));
    });
    expect(usePlaybackStore.getState().currentTimeMs).toBe(6500);
  });
});
