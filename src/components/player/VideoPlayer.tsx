import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useProjectStore } from "../../stores/projectStore";
import type { SubtitleCue } from "../../types";

interface VideoPlayerProps {
  videoPath: string;
}

export function VideoPlayer({ videoPath }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [transcoding, setTranscoding] = useState(false);
  const [transcodePercent, setTranscodePercent] = useState(0);

  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const setDuration = usePlaybackStore((s) => s.setDuration);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);
  const setSelectedCueId = usePlaybackStore((s) => s.setSelectedCueId);

  const cues = useProjectStore((s) => s.cues);

  // 监听转码进度
  useEffect(() => {
    const unlisten = listen<{ percent: number }>("transcode_progress", (event) => {
      setTranscodePercent(event.payload.percent);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 使用 asset protocol 加载视频
  useEffect(() => {
    if (videoPath) {
      console.log("Loading video from path:", videoPath);
      setError(null);
      setTranscoding(false);
      setTranscodePercent(0);

      // 先检测视频编码格式
      invoke<string>("detect_video_codec", { path: videoPath })
        .then((codec) => {
          console.log("Video codec:", codec);

          // 检查是否需要转码
          const needsTranscode = ["hevc", "h265", "vp9", "av1"].includes(codec.toLowerCase());

          if (needsTranscode) {
            console.log("Codec not supported by WebView2, starting transcode...");
            setTranscoding(true);
            // 启动后台转码任务
            return invoke<string>("start_transcode", { videoPath }).then((cachePath) => {
              console.log("Transcode cache path:", cachePath);

              // 等待转码文件可用
              const checkReady = async () => {
                try {
                  const progress = await invoke<{ ready: boolean; cache_path: string }>(
                    "check_transcode_progress",
                    { videoPath }
                  );

                  if (progress.ready) {
                    console.log("Transcode ready, using cache:", progress.cache_path);
                    setTranscoding(false);
                    // 添加缓存文件到 asset scope
                    await invoke("allow_asset_path", { path: progress.cache_path });
                    const assetUrl = convertFileSrc(progress.cache_path);
                    console.log("Converted cache to asset URL:", assetUrl);
                    setVideoSrc(assetUrl);
                  } else {
                    // 转码中，1 秒后重试
                    console.log("Transcode in progress, retrying in 1s...");
                    setTimeout(checkReady, 1000);
                  }
                } catch (err) {
                  console.error("Error checking transcode progress:", err);
                  setTranscoding(false);
                  setError(`检查转码进度失败: ${String(err)}`);
                }
              };

              checkReady();
            });
          } else {
            console.log("Codec supported, using direct asset protocol");
            // 支持的格式，直接使用 asset protocol
            return invoke("allow_asset_path", { path: videoPath }).then(() => {
              const assetUrl = convertFileSrc(videoPath);
              console.log("Asset URL:", assetUrl);
              setVideoSrc(assetUrl);
            });
          }
        })
        .catch((err) => {
          console.error("Failed to load video:", err);
          setError(`视频加载失败: ${String(err)}`);
        });
    }

    // 清理：停止转码任务
    return () => {
      if (videoPath) {
        invoke("stop_transcode", { videoPath }).catch(console.error);
      }
    };
  }, [videoPath]);

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
      const ms = Math.floor(video.currentTime * 1000);
      setCurrentTime(ms);

      // 仅在播放时自动选中当前时间轴的字幕
      if (isPlaying) {
        const activeCue = cues.find(
          (c) => ms >= c.startMs && ms <= c.endMs
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

  // 外部跳转到指定时间
  useEffect(() => {
    const video = videoRef.current;
    if (!video || Math.abs(video.currentTime * 1000 - currentTimeMs) < 100) return;
    video.currentTime = currentTimeMs / 1000;
  }, [currentTimeMs]);

  // 获取当前显示的字幕（只显示当前选中的或当前播放位置的）
  const activeCue = isPlaying
    ? cues.find((c) => currentTimeMs >= c.startMs && currentTimeMs <= c.endMs)
    : cues.find((c) => c.id === selectedCueId);

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black">
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
          <p className="mt-2 text-xs">{transcodePercent.toFixed(1)}% - 生成 480p 全关键帧代理视频</p>
        </div>
      ) : !videoSrc ? (
        <div className="text-text-muted">加载中...</div>
      ) : (
        <>
          <video
            ref={videoRef}
            src={videoSrc}
            className="h-full w-full"
            onError={(e) => {
              const video = e.target as HTMLVideoElement;
              const errorMsg = video.error
                ? `${video.error.message} (code: ${video.error.code})`
                : "未知错误";
              console.error("Video error:", errorMsg, video.error);
              setError(errorMsg);
            }}
          />

          {/* 字幕叠加层 */}
          {activeCue && (
            <div className="pointer-events-none absolute inset-x-0 bottom-12 flex flex-col items-center gap-1 px-8">
              <SubtitleOverlay cue={activeCue} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SubtitleOverlay({ cue }: { cue: SubtitleCue }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {cue.secondaryText && (
        <div
          className="rounded bg-black/80 px-3 py-1 text-center font-medium text-white shadow-lg"
          style={{ fontSize: "1.5rem", lineHeight: "1.4" }}
        >
          {cue.secondaryText}
        </div>
      )}
      <div
        className="rounded bg-black/80 px-3 py-1 text-center text-white shadow-lg"
        style={{ fontSize: "1.25rem", lineHeight: "1.4" }}
      >
        {cue.primaryText}
      </div>
    </div>
  );
}
