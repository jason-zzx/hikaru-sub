// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  __resetActiveCueTrackerForTests,
  initActiveCueTracker,
} from "@/services/activeCueTracker";
import { playSelectedCueSegment } from "@/services/playbackActions";
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
// 字幕叠加层 mock 掉 libass/worker 依赖，只捕获最近一次 props 供断言
const previewProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
vi.mock("./SubtitlePreview", () => ({
  SubtitlePreview: (props: Record<string, unknown>) => {
    previewProps.current = props;
    return null;
  },
}));

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

async function setupSegmentPlayer(options: { dispatchPause?: boolean } = {}) {
  const rafQueue: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});

  const { video } = await renderPlayer();
  const media = installMediaStubs(video);
  Object.defineProperties(video, {
    play: {
      configurable: true,
      value: () => {
        video.dispatchEvent(new Event("play"));
        return Promise.resolve();
      },
    },
    pause: {
      configurable: true,
      value: () => {
        if (options.dispatchPause !== false) {
          video.dispatchEvent(new Event("pause"));
        }
      },
    },
    videoWidth: { configurable: true, get: () => 1280 },
    videoHeight: { configurable: true, get: () => 720 },
    duration: { configurable: true, get: () => 60 },
  });
  const container = video.parentElement as HTMLElement;
  container.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 800,
      height: 450,
      right: 800,
      bottom: 450,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  act(() => {
    video.dispatchEvent(new Event("loadedmetadata"));
    useProjectStore.setState({
      cues: [
        {
          id: "a",
          startMs: 0,
          endMs: 1000,
          primaryText: "A",
          style: "Primary",
          layer: 0,
        },
        {
          id: "b",
          startMs: 1000,
          endMs: 2000,
          primaryText: "B",
          style: "Primary",
          layer: 0,
        },
      ],
    });
    usePlaybackStore.getState().setSelectedCueId("a");
    initActiveCueTracker();
  });

  return { video, media, rafQueue };
}

beforeEach(() => {
  previewProps.current = null;
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
  __resetActiveCueTrackerForTests();
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

describe("VideoPlayer segment playback stop point", () => {
  it("keeps subtitle preview empty while playback crosses a cue gap", async () => {
    const { media, rafQueue, video } = await setupSegmentPlayer();

    act(() => {
      useProjectStore.getState().updateCue("b", {
        startMs: 2000,
        endMs: 3000,
      });
      usePlaybackStore.getState().setPlaying(true);
    });
    media.timeSec = 1.5;
    act(() => {
      for (const cb of rafQueue.splice(0)) cb(0);
    });

    // 预览 props 转发：video 元素与播放态帧跟随模式
    expect(previewProps.current?.videoElement).toBe(video);
    expect(previewProps.current?.followVideoFrames).toBe(true);
    expect(usePlaybackStore.getState().activeCueIds).toEqual([]);
    expect(previewProps.current?.activeCueId).toBeNull();
    expect(previewProps.current?.currentTimeMs).toBe(-1);
  });

  it("keeps the paused preview aligned with stop overlaps at a shared boundary", async () => {
    const { media, rafQueue } = await setupSegmentPlayer();
    act(() => {
      const [played, next] = useProjectStore.getState().cues;
      useProjectStore.setState({
        cues: [
          played!,
          {
            id: "overlap",
            startMs: 500,
            endMs: 1500,
            primaryText: "Overlap",
            style: "Primary",
            layer: 0,
          },
          next!,
        ],
      });
    });

    // R 段播：seek 到行首并播放，到 endMs 自动停
    act(() => {
      playSelectedCueSegment();
    });
    // 视频推进到共享边界，泵一帧：到点 → 暂停并把播放头精确 snap 到 cue.endMs
    media.timeSec = 1;
    let completionNotifications = 0;
    const unsubscribe = usePlaybackStore.subscribe(() => {
      completionNotifications += 1;
    });
    act(() => {
      for (const cb of rafQueue.splice(0)) cb(0);
    });
    unsubscribe();

    const pb = usePlaybackStore.getState();
    expect(completionNotifications).toBe(1);
    expect(pb.isPlaying).toBe(false);
    expect(pb.segmentPlayback).toBeNull();
    expect(pb.currentTimeMs).toBe(1000);
    expect(pb.segmentStop).toEqual({ cueId: "a", stopMs: 1000 });
    // 段播停点必须仍钉帧预览被播放句，不得切到共享边界上的下一句；
    // 跨越停点的 overlap 则与行高亮、预览共同保留。
    expect(pb.activeCueIds).toEqual(["a", "overlap"]);
    expect(previewProps.current?.activeCueId).toBe("a");
    expect(previewProps.current?.segmentStopCueIds).toEqual([
      "a",
      "overlap",
    ]);
    expect(previewProps.current?.currentTimeMs).toBe(1000);

    // 显式 seek 移开播放头：解除停点驻留，预览与高亮回归按时间命中
    act(() => {
      usePlaybackStore.getState().requestSeek(1750);
    });
    const after = usePlaybackStore.getState();
    expect(after.segmentStop).toBeNull();
    expect(after.activeCueIds).toEqual(["b"]);
    expect(previewProps.current?.activeCueId).toBeNull();
    expect(previewProps.current?.segmentStopCueIds).toBeNull();
    expect(previewProps.current?.currentTimeMs).toBe(1750);
  });

  it("publishes one completed snapshot before a delayed pause event", async () => {
    const { video, media, rafQueue } = await setupSegmentPlayer({
      dispatchPause: false,
    });

    act(() => {
      playSelectedCueSegment();
    });
    const snapshots: Array<{
      currentTimeMs: number;
      isPlaying: boolean;
      segmentStop: unknown;
      activeCueIds: string[];
    }> = [];
    const unsubscribe = usePlaybackStore.subscribe((state) => {
      snapshots.push({
        currentTimeMs: state.currentTimeMs,
        isPlaying: state.isPlaying,
        segmentStop: state.segmentStop,
        activeCueIds: state.activeCueIds,
      });
    });
    media.timeSec = 1;
    act(() => {
      for (const cb of rafQueue.splice(0)) cb(0);
      video.dispatchEvent(new Event("pause"));
    });
    unsubscribe();

    expect(snapshots).toEqual([
      {
        currentTimeMs: 1000,
        isPlaying: false,
        segmentStop: { cueId: "a", stopMs: 1000 },
        activeCueIds: ["a"],
      },
    ]);
    expect(previewProps.current?.currentTimeMs).toBe(1000);
    expect(previewProps.current?.followVideoFrames).toBe(false);
    expect(previewProps.current?.segmentStopCueIds).toEqual(["a"]);
  });

  it("stops at the captured boundary after the cue end time changes", async () => {
    const { media, rafQueue } = await setupSegmentPlayer();

    act(() => {
      playSelectedCueSegment();
      useProjectStore.getState().updateCue("a", { endMs: 500 });
    });
    expect(usePlaybackStore.getState().segmentPlayback).toEqual({
      cueId: "a",
      stopMs: 1000,
    });

    media.timeSec = 1;
    act(() => {
      for (const cb of rafQueue.splice(0)) cb(0);
    });

    const pb = usePlaybackStore.getState();
    expect(pb.isPlaying).toBe(false);
    expect(pb.currentTimeMs).toBe(1000);
    expect(pb.segmentPlayback).toBeNull();
    expect(pb.segmentStop).toEqual({ cueId: "a", stopMs: 1000 });
    expect(pb.activeCueIds).toEqual(["a"]);
    expect(previewProps.current?.activeCueId).toBe("a");
    expect(previewProps.current?.currentTimeMs).toBe(1000);
  });

  it("completes the segment stop when timeupdate beats the rAF tick", async () => {
    const { video, media } = await setupSegmentPlayer();

    act(() => {
      playSelectedCueSegment();
    });
    // 模拟段播期间由 undo/查找替换等路径改变选择，但未取消段播：
    // 收尾必须继续使用启动时的 a，而不是此刻选中的 b。
    act(() => {
      usePlaybackStore.getState().setSelectedCueId("b");
    });
    expect(usePlaybackStore.getState().segmentPlayback?.cueId).toBe("a");

    // timeupdate 携带 overshoot 时间先到：必须与 rAF 分支同样精确收尾
    media.timeSec = 1.05;
    let completionNotifications = 0;
    const unsubscribe = usePlaybackStore.subscribe(() => {
      completionNotifications += 1;
    });
    act(() => {
      video.dispatchEvent(new Event("timeupdate"));
    });
    unsubscribe();

    const pb = usePlaybackStore.getState();
    expect(completionNotifications).toBe(1);
    expect(pb.isPlaying).toBe(false);
    expect(pb.segmentPlayback).toBeNull();
    // 播放头与视频位置都精确 snap 到段播终点，不残留 overshoot 1050
    expect(pb.currentTimeMs).toBe(1000);
    expect(media.timeSec).toBe(1);
    expect(pb.segmentStop).toEqual({ cueId: "a", stopMs: 1000 });
    // 停点驻留生效：共享边界不点亮下一句，预览也保持启动段播的 a
    expect(pb.activeCueIds).toEqual(["a"]);
    expect(previewProps.current?.activeCueId).toBe("a");
    expect(previewProps.current?.currentTimeMs).toBe(1000);
  });
});
