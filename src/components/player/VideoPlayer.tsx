import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { resolveActiveCueIds } from "@/services/activeCueTracker";
import { selectLibassPreviewFonts } from "../../services/libassFontSelection";
import { useVideoDisplayRect } from "../../hooks/useVideoDisplayRect";
import { getPreviewFonts } from "../../services/previewFontDiscovery";
import { getVideoInfo } from "../../services/tauri";
import {
  usePlaybackStore,
  type SegmentStop,
} from "@/stores/playbackStore";
import { useProjectStore } from "../../stores/projectStore";
import type { PreviewFontFile, VideoPlaybackProbe } from "../../types";
import { SubtitlePreview } from "./SubtitlePreview";
import { resolvePausedPreviewCueId } from "./subtitlePreviewModel";

interface VideoPlayerProps {
  videoPath: string;
}

export function VideoPlayer({ videoPath }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const transcodeFallbackRef = useRef(false);
  const recoverAttemptRef = useRef(0);
  const isSeekingRef = useRef(false);
  /**
   * 已消费的 seekRequest.seq；用于区分「新 seek 意图」与「videoSrc 变化后的恢复」。
   * 以挂载时的 seq 起步：重挂载不重放挂载前的旧请求（恢复位置以 store 当前时间为准）。
   */
  const appliedSeekSeqRef = useRef(
    usePlaybackStore.getState().seekRequest?.seq ?? 0,
  );
  /** 「播放当前句」到点时记录终点，供 rAF cleanup 使用该精确值而非 frame-snap 后的视频时间 */
  const segmentEndRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [transcoding, setTranscoding] = useState(false);
  const [transcodePercent, setTranscodePercent] = useState(0);
  const [previewFonts, setPreviewFonts] = useState<PreviewFontFile[]>([]);
  const [previewFontError, setPreviewFontError] = useState<string | null>(null);

  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const segmentStop = usePlaybackStore((s) => s.segmentStop);
  const segmentStopCueIds = usePlaybackStore((s) =>
    s.segmentStop === null ? null : s.activeCueIds,
  );
  const seekRequest = usePlaybackStore((s) => s.seekRequest);
  // 播放中不订阅 60Hz 时间（libass 走 rVFC 直连视频帧）；暂停/seek 时才需要精确时间定帧。
  // null 哨兵期间沿用上一次非空值，保证 SubtitlePreview 接口不变。
  const pausedTimeMs = usePlaybackStore((s) =>
    s.isPlaying ? null : s.currentTimeMs,
  );
  // 播放中 CSS 兜底与字形懒检测按 activeCueIds（字幕边界频率）取当前句
  const playingActiveCueId = usePlaybackStore((s) =>
    s.isPlaying ? (s.activeCueIds[0] ?? null) : null,
  );
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const setDuration = usePlaybackStore((s) => s.setDuration);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);

  // 播放中传 -1 哨兵：此时字幕选择完全由 activeCueId 驱动（有句给句、空档为 null），
  // 不得让 findPreviewCue / getLibassRenderTimeMs 拿暂停时的陈旧时间兜底命中字幕
  // （否则 CSS 兜底会在字幕空档整段误显旧句）；-1 命中不了任何 cue，空档即空白。
  // 暂停/seek 时传精确时间做 libass 定帧。
  const previewTimeMs = pausedTimeMs ?? -1;

  const cues = useProjectStore((s) => s.cues);
  // 暂停时仅当播放头仍在选中句渲染区间内（或段播停点驻留于选中句 endMs）
  // 才按选中句钉帧预览（抗厘秒取整）；播放头移出选中句（如点击波形 seek）
  // 后回归按播放头时间命中渲染，空档即空白
  const previewActiveCueId = isPlaying
    ? playingActiveCueId
    : resolvePausedPreviewCueId(cues, selectedCueId, previewTimeMs, segmentStop);

  // 段播（播放当前句）到点收尾：rAF 帧循环与 timeupdate 兜底竞速时共用同一实现，
  // 并消费启动段播时捕获的 cue 快照，不能改读收尾时的当前选择。
  const completeSegmentStop = useCallback(
    (video: HTMLVideoElement, segment: SegmentStop) => {
      segmentEndRef.current = segment.stopMs;
      const activeCueIds = resolveActiveCueIds(
        useProjectStore.getState().cues,
        segment.stopMs,
        segment,
      );
      // 先一次发布完整停点，再操作媒体元素；同步/异步 pause 事件都只会 no-op。
      usePlaybackStore
        .getState()
        .completeSegmentPlayback(segment, activeCueIds);
      video.currentTime = segment.stopMs / 1000;
      video.pause();
    },
    [],
  );
  const assStyles = useProjectStore((s) => s.assStyles);
  const assScriptInfo = useProjectStore((s) => s.assScriptInfo);
  const previewFontSelection = useMemo(
    () =>
      selectLibassPreviewFonts(previewFonts, assStyles, {
        cues,
      }),
    [assStyles, cues, previewFonts],
  );

  const videoDisplayRect = useVideoDisplayRect(
    containerRef,
    videoRef,
    Boolean(videoSrc && !error && !transcoding),
    {
      fallbackAspectWidth: assScriptInfo?.playResX,
      fallbackAspectHeight: assScriptInfo?.playResY,
    },
    videoSrc,
  );

  const loadHttpVideo = useCallback(async (path: string) => {
    const url = await invoke<string>("register_media_playback", { path });
    console.log("Media HTTP URL:", url);
    setVideoSrc(url);
  }, []);

  const setVideoNode = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoElement(node);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPreviewFonts()
      .then((fonts) => {
        if (!cancelled) {
          setPreviewFonts(fonts);
          setPreviewFontError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setPreviewFontError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const waitForTranscodedVideo = useCallback(
    async (sourcePath: string, isCancelled?: () => boolean) => {
      console.log("Starting transcode for:", sourcePath);
      setTranscoding(true);
      setTranscodePercent(0);
      setVideoSrc("");

      await invoke<string>("start_transcode", { videoPath: sourcePath });
      if (isCancelled?.()) return;

      const checkReady = async (): Promise<void> => {
        if (isCancelled?.()) return;

        const progress = await invoke<{
          ready: boolean;
          failed: boolean;
          error: string;
          cachePath: string;
        }>("check_transcode_progress", { videoPath: sourcePath });

        if (isCancelled?.()) return;

        if (progress.failed) {
          setTranscoding(false);
          setError(progress.error || "转码失败");
          return;
        }

        if (progress.ready) {
          console.log("Transcode ready, using cache:", progress.cachePath);
          setTranscoding(false);
          if (isCancelled?.()) return;
          await loadHttpVideo(progress.cachePath);
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
        await checkReady();
      };

      await checkReady();
    },
    [loadHttpVideo],
  );

  // 监听转码进度
  useEffect(() => {
    const unlisten = listen<{ percent: number }>("transcode_progress", (event) => {
      setTranscodePercent(event.payload.percent);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 探测原片帧率供逐帧步进使用（代理转码不改帧率，始终按原路径探测）
  useEffect(() => {
    if (!videoPath) return;
    const { setFps } = usePlaybackStore.getState();
    setFps(null);
    getVideoInfo(videoPath)
      .then((info) => setFps(info.fps ?? null))
      .catch(() => setFps(null));
  }, [videoPath]);

  // 通过本地 HTTP 服务加载视频（Linux WebKit 无法经 asset 协议播放音视频）
  useEffect(() => {
    if (!videoPath) return;

    let cancelled = false;
    transcodeFallbackRef.current = false;
    console.log("Loading video from path:", videoPath);
    setError(null);
    setTranscoding(false);
    setTranscodePercent(0);
    setVideoSrc("");

    invoke<VideoPlaybackProbe>("probe_video_playback", { path: videoPath })
      .then(async (probe) => {
        if (cancelled) return;

        console.log("Video playback probe:", probe);
        if (probe.needsTranscode) {
          console.log(
            "Direct playback not supported, starting transcode:",
            probe.reason ?? "unknown",
          );
          await waitForTranscodedVideo(videoPath, () => cancelled);
          return;
        }

        console.log("Codec/container supported, using local HTTP media server");
        await loadHttpVideo(videoPath);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load video:", err);
        setError(`视频加载失败: ${String(err)}`);
      });

    return () => {
      // 仅取消本轮前端等待；不要 stop_transcode。
      // React StrictMode 会卸载再挂载，误杀进行中的 FFmpeg 任务会导致不完整缓存被当成可播文件。
      cancelled = true;
    };
  }, [videoPath, loadHttpVideo, waitForTranscodedVideo]);

  const handleVideoError = useCallback(async () => {
    const video = videoRef.current;
    if (!video?.error) return;

    const code = video.error.code;
    const errorMsg = video.error.message
      ? `${video.error.message} (code: ${code})`
      : `播放失败 (code: ${code})`;

    console.error("Video error:", errorMsg, video.error);

    // seek 时 WebKit 可能中止旧 Range 请求并误报网络/中止错误，尝试恢复播放
    if ((code === 1 || code === 2) && videoSrc && recoverAttemptRef.current < 3) {
      recoverAttemptRef.current += 1;
      const resumeSec = usePlaybackStore.getState().currentTimeMs / 1000;
      console.warn(
        `Transient video error during seek, recovering (attempt ${recoverAttemptRef.current})`,
      );
      setError(null);
      // 元素重载会中止进行中的 seek（seeked 不再到来），复位门闩防止回写永久跳过
      isSeekingRef.current = false;
      video.src = videoSrc;
      video.load();
      const onLoaded = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.currentTime = resumeSec;
        if (isPlaying) {
          video.play().catch(() => setPlaying(false));
        }
      };
      video.addEventListener("loadedmetadata", onLoaded);
      return;
    }

    // MEDIA_ERR_DECODE / MEDIA_ERR_SRC_NOT_SUPPORTED：探测遗漏或过早 seek 时回退代理转码
    // WebView2 对 HEVC 等常以 code 3（音频包解码失败）而非 code 4 报错
    if ((code === 3 || code === 4) && !transcodeFallbackRef.current) {
      transcodeFallbackRef.current = true;
      try {
        setError(null);
        await waitForTranscodedVideo(videoPath);
        return;
      } catch (err) {
        console.error("Transcode fallback failed:", err);
        setError(`视频无法播放，转码回退失败: ${String(err)}`);
        return;
      }
    }

    setError(errorMsg);
  }, [videoPath, videoSrc, isPlaying, waitForTranscodedVideo, setPlaying]);

  // 同步播放状态
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }, [isPlaying, setPlaying]);

  // 监听视频事件
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

    // videoSrc 变化 / 元素重载后，进行中 seek 的 seeked 可能永远不来：
    // 先复位回写门闩，避免 rAF/timeupdate 回写被永久跳过（播放头冻结）
    isSeekingRef.current = false;

    const handleTimeUpdate = () => {
      if (isSeekingRef.current) return;
      recoverAttemptRef.current = 0;
      // 「播放当前句」到点：timeupdate 可能先于下一帧 rAF 越界，必须走与 rAF
      // 分支相同的收尾（精确 snap + 驻留标记），且不得把 overshoot 时间写进 store
      const { segmentPlayback } = usePlaybackStore.getState();
      const ms = Math.floor(video.currentTime * 1000);
      if (segmentPlayback !== null && ms >= segmentPlayback.stopMs) {
        completeSegmentStop(video, segmentPlayback);
        return;
      }
      setCurrentTime(ms);
    };

    const handleLoadedMetadata = () => {
      setDuration(Math.floor(video.duration * 1000));
    };

    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleEnded = () => setPlaying(false);

    // seek 完成后复位回写门闩。常驻监听（随 videoSrc 生命周期），不由 seek 效应挂卸：
    // 连续 seek 时旧效应 cleanup 会摘掉一次性监听，若第二次请求落入死区早退，
    // isSeekingRef 将永久悬挂——rAF/timeupdate 回写全跳、播放头冻结。
    const handleSeeked = () => {
      isSeekingRef.current = false;
    };

    // 如果视频已经加载了元数据，立即设置时长
    if (video.duration && !isNaN(video.duration)) {
      setDuration(Math.floor(video.duration * 1000));
    }

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("seeked", handleSeeked);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, [videoSrc, setCurrentTime, setDuration, setPlaying, completeSegmentStop]);

  // 播放时高频同步播放时间并在片段终点及时停止。
  // timeupdate 仅 ~4Hz，会导致时间轴指针跳动（bug 4）与 R 段落播放越界（bug 3）。
  useEffect(() => {
    if (!isPlaying || !videoSrc) return;
    const video = videoRef.current;
    if (!video) return;
    let rafId = 0;
    const tick = () => {
      const { segmentPlayback } = usePlaybackStore.getState();
      // 「播放当前句」到点：暂停并把播放头精确 snap 到启动时捕获的 cue.endMs，
      // 避免选择在播放中变化后把停点驻留错误绑定到另一句。
      if (
        segmentPlayback !== null &&
        video.currentTime * 1000 >= segmentPlayback.stopMs
      ) {
        completeSegmentStop(video, segmentPlayback);
        return;
      }
      if (!isSeekingRef.current) {
        setCurrentTime(Math.floor(video.currentTime * 1000));
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      if (!video) return;
      // 「播放当前句」终点用记录的精确值，避免 cleanup 读到 frame-snap 后的视频时间
      // 把 store 回退到终点前一帧；普通暂停则同步真实视频位置修正 rAF 回写残差
      const segmentEnd = segmentEndRef.current;
      if (segmentEnd !== null) {
        setCurrentTime(segmentEnd);
        segmentEndRef.current = null;
      } else if (!isSeekingRef.current) {
        setCurrentTime(Math.floor(video.currentTime * 1000));
      }
    };
  }, [isPlaying, videoSrc, setCurrentTime, completeSegmentStop]);

  // 外部跳转到指定时间（拖动进度条 / 时间轴 / 进入编辑页选首条）——由显式
  // seekRequest 驱动，播放回写（rAF/timeupdate）不再触发本效应的每帧重执行。
  // videoSrc 变化（转码回退/换片）时按当前 store 时间恢复位置，与旧行为一致。
  // 必须等 HAVE_METADATA，否则对未就绪的 <video> 写 currentTime 会在 WebView2 触发
  // PIPELINE_ERROR_DECODE（code 3），且此前不会回退转码。
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

    // seq 未变说明本次重执行来自 videoSrc 变化：目标取 store 当前时间（恢复位置）；
    // seq 变化才是新的用户意图 seek，目标取 seekRequest.ms（播放中 rAF 可能已覆盖
    // currentTimeMs，不能从 store 读目标）。
    const isNewRequest =
      seekRequest !== null && seekRequest.seq !== appliedSeekSeqRef.current;
    if (isNewRequest) appliedSeekSeqRef.current = seekRequest.seq;
    const requestedMs = isNewRequest
      ? seekRequest.ms
      : usePlaybackStore.getState().currentTimeMs;

    let cancelled = false;

    const applySeek = () => {
      if (cancelled) return;
      // 剪辑片字幕若仍带原片绝对时间轴，首条 startMs 可能远超视频时长；
      // 越界 seek 会在 WebView2 触发 PIPELINE_ERROR_DECODE。
      const durationSec =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      const rawTargetSec = requestedMs / 1000;
      const targetSec =
        durationSec === null
          ? Math.max(0, rawTargetSec)
          : Math.min(durationSec, Math.max(0, rawTargetSec));
      const targetMs = Math.round(targetSec * 1000);

      // 越界时同步回写 store，避免时间轴/列表仍停在超大 currentTimeMs
      if (Math.abs(targetMs - requestedMs) > 1) {
        setCurrentTime(targetMs);
      }

      // 暂停时收小死区以放行逐帧步进（一帧约 16-42ms）；播放时保留较大死区压制
      // rAF/timeupdate 回写残差（≤~16ms）避免播放中误 seek。播放中逐帧步进为既有限制。
      const deadbandMs = usePlaybackStore.getState().isPlaying ? 100 : 5;
      if (Math.abs(video.currentTime * 1000 - targetMs) < deadbandMs) return;

      // seeked 复位由常驻监听（视频事件效应）负责，本效应重执行不会摘掉它；
      // 连续 seek + 第二次落入死区早退时门闩不再永久悬挂
      isSeekingRef.current = true;

      // 不用 fastSeek：WebView2 上对代理片/Range 请求更不稳定，统一走 currentTime
      video.currentTime = targetSec;
    };

    if (video.readyState >= 1) {
      applySeek();
      return () => {
        cancelled = true;
      };
    }

    const onLoadedMetadata = () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      applySeek();
    };
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [seekRequest, videoSrc, setCurrentTime]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center bg-muted"
    >
      {error ? (
        <div className="text-center text-red-400">
          <p className="text-sm">视频加载失败</p>
          <p className="mt-1 text-xs text-text-muted">{error}</p>
          <p className="mt-2 text-xs text-text-muted">路径: {videoPath}</p>
        </div>
      ) : transcoding ? (
        <div className="text-center text-text-muted">
          <div className="mb-4 text-sm">正在转码视频...</div>
          <div className="mx-auto h-2 w-64 overflow-hidden rounded-full bg-muted-foreground/20">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${transcodePercent}%` }}
            ></div>
          </div>
          <p className="mt-2 text-xs">
            {transcodePercent.toFixed(1)}% - 生成 480p 全关键帧代理视频
          </p>
        </div>
      ) : !videoSrc ? (
        <div className="text-text-muted">加载中...</div>
      ) : (
        <>
          <video
            ref={setVideoNode}
            src={videoSrc}
            className="h-full w-full object-contain"
            onError={() => {
              void handleVideoError();
            }}
          />

          {/* 字幕叠加层：限制在 object-contain 的实际视频画面内 */}
          {videoDisplayRect.width > 0 && videoDisplayRect.height > 0 && (
            <SubtitlePreview
              cues={cues}
              activeCueId={previewActiveCueId}
              styles={assStyles}
              scriptInfo={assScriptInfo}
              currentTimeMs={previewTimeMs}
              segmentStopCueIds={segmentStopCueIds}
              videoElement={videoElement}
              followVideoFrames={isPlaying}
              fontUrls={previewFontSelection.fontUrls}
              fontFiles={previewFontSelection.fontFiles}
              availableFonts={previewFontSelection.availableFonts}
              defaultFont={previewFontSelection.defaultFont}
              glyphFallbackFont={previewFontSelection.glyphFallbackFont}
              displayRect={{
                left: videoDisplayRect.left,
                top: videoDisplayRect.top,
                width: videoDisplayRect.width,
                height: videoDisplayRect.height,
              }}
            />
          )}
          {previewFontError && (
            <div className="absolute bottom-2 left-2 rounded-md border border-warning/40 bg-popover/90 px-2 py-1 text-xs text-warning">
              字体自动发现失败：{previewFontError}
            </div>
          )}
        </>
      )}
    </div>
  );
}
