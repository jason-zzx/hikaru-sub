import { usePlaybackStore } from "../../stores/playbackStore";
import { formatPlaybackTime } from "../../utils/formatTime";

interface PlaybackControlsProps {
  onSave?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function PlaybackControls({
  onSave,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: PlaybackControlsProps) {
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const durationMs = usePlaybackStore((s) => s.durationMs);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentTime(Number(e.target.value));
  };

  const handleSkip = (delta: number) => {
    const newTime = Math.max(0, Math.min(durationMs, currentTimeMs + delta));
    setCurrentTime(newTime);
  };

  return (
    <div className="flex items-center gap-3 border-t border-border bg-surface-raised px-4 py-2">
      {/* 播放控制 */}
      <button
        onClick={() => handleSkip(-5000)}
        className="rounded p-1 hover:bg-surface-overlay"
        title="后退 5 秒"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
        </svg>
      </button>

      <button
        onClick={() => setPlaying(!isPlaying)}
        className="rounded p-1 hover:bg-surface-overlay"
        title={isPlaying ? "暂停（空格）" : "播放（空格）"}
      >
        {isPlaying ? (
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        ) : (
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <button
        onClick={() => handleSkip(5000)}
        className="rounded p-1 hover:bg-surface-overlay"
        title="前进 5 秒"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
        </svg>
      </button>

      {/* 时间显示：当前时间精确到毫秒便于精细对轴，总时长仅秒级 */}
      <span className="font-mono text-xs text-text-muted">
        {formatPlaybackTime(currentTimeMs, true)} / {formatPlaybackTime(durationMs, false)}
      </span>

      {/* 进度条 */}
      <input
        type="range"
        min="0"
        max={durationMs}
        value={currentTimeMs}
        onChange={handleSeek}
        className="flex-1"
      />

      {/* 编辑操作 */}
      <div className="flex items-center gap-2 border-l border-border pl-3">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="rounded p-1 hover:bg-surface-overlay disabled:opacity-30"
          title="撤销（Ctrl+Z）"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>

        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="rounded p-1 hover:bg-surface-overlay disabled:opacity-30"
          title="重做（Ctrl+Y / Ctrl+Shift+Z）"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
          </svg>
        </button>

        <button
          onClick={onSave}
          className="rounded bg-primary px-3 py-1 text-sm font-medium text-white hover:bg-primary-hover"
          title="保存 (Ctrl+S)"
        >
          保存
        </button>
      </div>
    </div>
  );
}
