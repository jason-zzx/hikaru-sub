import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSubtitleMergeMode } from "../../hooks/useSubtitleMergeMode";
import { selectLibassPreviewFonts } from "../../services/libassFontSelection";
import { useVideoDisplayRect } from "../../hooks/useVideoDisplayRect";
import { discoverPreviewFonts } from "../../services/tauri";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useProjectStore } from "../../stores/projectStore";
import type { PreviewFontFile, VideoPlaybackProbe } from "../../types";
import { SubtitlePreview } from "./SubtitlePreview";

interface VideoPlayerProps {
  videoPath: string;
}

export function VideoPlayer({ videoPath }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const transcodeFallbackRef = useRef(false);
  const recoverAttemptRef = useRef(0);
  const isSeekingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [transcoding, setTranscoding] = useState(false);
  const [transcodePercent, setTranscodePercent] = useState(0);
  const [previewFonts, setPreviewFonts] = useState<PreviewFontFile[]>([]);
  const [previewFontError, setPreviewFontError] = useState<string | null>(null);

  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const setDuration = usePlaybackStore((s) => s.setDuration);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);
  const setSelectedCueId = usePlaybackStore((s) => s.setSelectedCueId);

  const cues = useProjectStore((s) => s.cues);
  const assStyles = useProjectStore((s) => s.assStyles);
  const assScriptInfo = useProjectStore((s) => s.assScriptInfo);
  const mergeMode = useSubtitleMergeMode();
  const previewFontSelection = useMemo(
    () =>
      selectLibassPreviewFonts(previewFonts, assStyles, {
        cues,
        mergeMode,
      }),
    [assStyles, cues, mergeMode, previewFonts],
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
    discoverPreviewFonts()
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
    async (sourcePath: string) => {
      console.log("Starting transcode for:", sourcePath);
      setTranscoding(true);
      setTranscodePercent(0);
      setVideoSrc("");

      await invoke<string>("start_transcode", { videoPath: sourcePath });

      const checkReady = async (): Promise<void> => {
        const progress = await invoke<{ ready: boolean; cache_path: string }>(
          "check_transcode_progress",
          { videoPath: sourcePath },
        );

        if (progress.ready) {
          console.log("Transcode ready, using cache:", progress.cache_path);
          setTranscoding(false);
          await loadHttpVideo(progress.cache_path);
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
          await waitForTranscodedVideo(videoPath);
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
      cancelled = true;
      invoke("stop_transcode", { videoPath }).catch(console.error);
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
      const resumeSec = currentTimeMs / 1000;
      console.warn(
        `Transient video error during seek, recovering (attempt ${recoverAttemptRef.current})`,
      );
      setError(null);
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

    // MEDIA_ERR_SRC_NOT_SUPPORTED：探测遗漏时回退代理转码
    if (code === 4 && !transcodeFallbackRef.current) {
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
  }, [videoPath, videoSrc, currentTimeMs, isPlaying, waitForTranscodedVideo, setPlaying]);

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

    const handleTimeUpdate = () => {
      if (isSeekingRef.current) return;
      recoverAttemptRef.current = 0;
      const ms = Math.floor(video.currentTime * 1000);
      setCurrentTime(ms);

      // 仅在播放时自动选中当前时间轴的字幕
      if (isPlaying) {
        const activeCue = cues.find(
          (c) => ms >= c.startMs && ms <= c.endMs,
        );
        setSelectedCueId(activeCue?.id || null);
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(Math.floor(video.duration * 1000));
    };

    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleEnded = () => setPlaying(false);

    // 如果视频已经加载了元数据，立即设置时长
    if (video.duration && !isNaN(video.duration)) {
      setDuration(Math.floor(video.duration * 1000));
    }

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
    };
  }, [videoSrc, cues, isPlaying, setCurrentTime, setDuration, setPlaying, setSelectedCueId]);

  // 外部跳转到指定时间（拖动进度条 / 时间轴）
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;
    if (Math.abs(video.currentTime * 1000 - currentTimeMs) < 100) return;

    isSeekingRef.current = true;
    const targetSec = currentTimeMs / 1000;

    const onSeeked = () => {
      isSeekingRef.current = false;
      video.removeEventListener("seeked", onSeeked);
    };
    video.addEventListener("seeked", onSeeked);

    if ("fastSeek" in video && typeof video.fastSeek === "function") {
      try {
        video.fastSeek(targetSec);
        return () => video.removeEventListener("seeked", onSeeked);
      } catch {
        // fastSeek 不可用时回退 currentTime
      }
    }

    video.currentTime = targetSec;
    return () => video.removeEventListener("seeked", onSeeked);
  }, [currentTimeMs, videoSrc]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center bg-black"
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
          <div className="mx-auto h-2 w-64 overflow-hidden rounded-full bg-gray-700">
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
              activeCueId={isPlaying ? null : selectedCueId}
              styles={assStyles}
              scriptInfo={assScriptInfo}
              mergeMode={mergeMode}
              currentTimeMs={currentTimeMs}
              videoElement={videoElement}
              followVideoFrames={isPlaying}
              fontUrls={previewFontSelection.fontUrls}
              defaultFont={previewFontSelection.defaultFont}
              displayRect={{
                left: videoDisplayRect.left,
                top: videoDisplayRect.top,
                width: videoDisplayRect.width,
                height: videoDisplayRect.height,
              }}
            />
          )}
          {previewFontError && (
            <div className="absolute bottom-2 left-2 rounded-md border border-warning/40 bg-black/70 px-2 py-1 text-xs text-warning">
              字体自动发现失败：{previewFontError}
            </div>
          )}
        </>
      )}
    </div>
  );
}
