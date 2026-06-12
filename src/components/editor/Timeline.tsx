import { useRef, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";

export function Timeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [viewStartMs, setViewStartMs] = useState(0);
  const [msPerPixel, setMsPerPixel] = useState(10); // 缩放级别：每像素多少毫秒

  const cues = useProjectStore((s) => s.cues);
  const videoPath = useProjectStore((s) => s.videoPath);
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const durationMs = usePlaybackStore((s) => s.durationMs);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);

  // 提取波形数据
  useEffect(() => {
    if (videoPath && durationMs > 0) {
      const samples = 4000;
      invoke<number[]>("extract_waveform", { videoPath, samples })
        .then(setWaveform)
        .catch(console.error);
    }
  }, [videoPath, durationMs]);

  // 自动跟随播放指针（仅在播放时）
  useEffect(() => {
    if (!isPlaying) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.width / (window.devicePixelRatio || 1);
    const viewEndMs = viewStartMs + width * msPerPixel;

    // 如果播放指针超出可视范围，滚动时间轴
    if (currentTimeMs < viewStartMs || currentTimeMs > viewEndMs) {
      setViewStartMs(Math.max(0, currentTimeMs - width * msPerPixel / 2));
    }
  }, [currentTimeMs, viewStartMs, msPerPixel, isPlaying]);

  // 绘制时间轴
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || durationMs === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const viewEndMs = viewStartMs + width * msPerPixel;

    ctx.clearRect(0, 0, width, height);

    // 时间刻度
    ctx.fillStyle = "#888";
    ctx.font = "10px monospace";
    const tickIntervalMs = calculateTickInterval(msPerPixel);
    const firstTick = Math.floor(viewStartMs / tickIntervalMs) * tickIntervalMs;
    for (let t = firstTick; t <= viewEndMs; t += tickIntervalMs) {
      const x = (t - viewStartMs) / msPerPixel;
      ctx.fillText(formatTime(t), x + 2, 12);
      ctx.fillRect(x, 15, 1, 5);
    }

    // 波形
    if (waveform.length > 0) {
      const waveTop = 25;
      const waveHeight = 60;
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, waveTop, width, waveHeight);

      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1;
      const samplesPerMs = waveform.length / durationMs;

      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const ms = viewStartMs + x * msPerPixel;
        const idx = Math.floor(ms * samplesPerMs);
        if (idx >= 0 && idx < waveform.length) {
          const amp = waveform[idx] * waveHeight * 0.45;
          const y = waveTop + waveHeight / 2 - amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const ms = viewStartMs + x * msPerPixel;
        const idx = Math.floor(ms * samplesPerMs);
        if (idx >= 0 && idx < waveform.length) {
          const amp = waveform[idx] * waveHeight * 0.45;
          const y = waveTop + waveHeight / 2 + amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // 字幕块
    const trackTop = 90;
    const trackHeight = 35;
    const visibleCues = cues.filter(c => c.endMs >= viewStartMs && c.startMs <= viewEndMs);

    visibleCues.forEach((cue) => {
      const startX = (cue.startMs - viewStartMs) / msPerPixel;
      const endX = (cue.endMs - viewStartMs) / msPerPixel;
      const w = Math.max(2, endX - startX);

      const isSelected = cue.id === selectedCueId;
      ctx.fillStyle = isSelected ? "#3b82f6" : "#4b5563";
      ctx.fillRect(Math.max(0, startX), trackTop, Math.min(w, width - startX), trackHeight);

      if (w > 20) {
        ctx.fillStyle = "#fff";
        ctx.font = "11px sans-serif";
        const text = cue.secondaryText || cue.primaryText;
        const maxWidth = w - 4;
        ctx.save();
        ctx.rect(Math.max(0, startX), trackTop, Math.min(w, width - startX), trackHeight);
        ctx.clip();
        ctx.fillText(text, Math.max(2, startX + 2), trackTop + 20, maxWidth);
        ctx.restore();
      }
    });

    // 播放指针
    const pointerX = (currentTimeMs - viewStartMs) / msPerPixel;
    if (pointerX >= 0 && pointerX <= width) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pointerX, 0);
      ctx.lineTo(pointerX, height);
      ctx.stroke();
    }
  }, [cues, currentTimeMs, durationMs, selectedCueId, waveform, viewStartMs, msPerPixel]);

  // 滚轮事件（使用原生监听器以支持 preventDefault）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseTimeMs = viewStartMs + mouseX * msPerPixel;

      if (e.ctrlKey) {
        const zoomFactor = e.deltaY > 0 ? 1.2 : 0.8;
        const newMsPerPixel = Math.max(1, Math.min(100, msPerPixel * zoomFactor));
        const newViewStart = mouseTimeMs - mouseX * newMsPerPixel;
        setMsPerPixel(newMsPerPixel);
        setViewStartMs(Math.max(0, newViewStart));
      } else {
        const scrollAmount = e.deltaY * msPerPixel * 0.5;
        setViewStartMs(Math.max(0, Math.min(viewStartMs + scrollAmount, durationMs)));
      }
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [viewStartMs, msPerPixel, durationMs]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedTime = viewStartMs + x * msPerPixel;
    setCurrentTime(Math.max(0, Math.min(clickedTime, durationMs)));
  };

  if (durationMs === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-muted">
        等待视频加载...
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="cursor-pointer"
      />
      <div className="absolute bottom-1 right-2 text-xs text-text-muted">
        Ctrl+滚轮缩放 · 滚轮平移
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

function calculateTickInterval(msPerPixel: number): number {
  const intervals = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000];
  for (const interval of intervals) {
    if (interval / msPerPixel >= 80) {
      return interval;
    }
  }
  return 60000;
}
