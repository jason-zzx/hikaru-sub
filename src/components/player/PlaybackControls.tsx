import { FastForward, Pause, Play, Redo2, Rewind, Undo2 } from "lucide-react";
import { playSelectedCueSegment } from "../../services/playbackActions";
import { usePlaybackStore } from "../../stores/playbackStore";
import { formatPlaybackTime } from "../../utils/formatTime";
import {
  EDITOR_HOTKEYS,
  formatActionShortcutTitle,
  type HotkeyDef,
} from "../editor/hotkeys";
import { IconPlaySegment } from "../layout/NavIcons";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";

interface PlaybackControlsProps {
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  hotkeys?: readonly HotkeyDef[];
}

export function PlaybackControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hotkeys = EDITOR_HOTKEYS,
}: PlaybackControlsProps) {
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const durationMs = usePlaybackStore((s) => s.durationMs);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);
  const requestSeek = usePlaybackStore((s) => s.requestSeek);

  const sliderMax = Math.max(durationMs, 1);
  const sliderValue = Math.max(0, Math.min(currentTimeMs, sliderMax));

  const handleSkip = (delta: number) => {
    const newTime = Math.max(0, Math.min(durationMs, currentTimeMs + delta));
    requestSeek(newTime);
  };

  const togglePlayTitle = formatActionShortcutTitle(
    isPlaying ? "暂停" : "播放",
    "toggle-play",
    hotkeys,
  );
  const playSegmentTitle = formatActionShortcutTitle(
    "播放当前行",
    "play-segment",
    hotkeys,
  );
  const undoTitle = formatActionShortcutTitle("撤销", "undo", hotkeys);
  const redoTitle = formatActionShortcutTitle("重做", "redo", hotkeys);

  return (
    <div className="flex items-center gap-3 border-t border-border bg-card px-4 py-2">
      {/* 播放控制 */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => handleSkip(-5000)}
        title="后退 5 秒"
        aria-label="后退 5 秒"
      >
        <Rewind className="size-4" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setPlaying(!isPlaying)}
        title={togglePlayTitle}
        aria-label={togglePlayTitle}
      >
        {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => handleSkip(5000)}
        title="前进 5 秒"
        aria-label="前进 5 秒"
      >
        <FastForward className="size-4" />
      </Button>

      {/* 播放当前行：与 R（play-segment）共用 playSelectedCueSegment，段播中再点=中断 */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => playSelectedCueSegment()}
        disabled={!selectedCueId}
        title={playSegmentTitle}
        aria-label={playSegmentTitle}
      >
        <IconPlaySegment className="size-4" />
      </Button>

      {/* 时间显示：当前时间精确到毫秒便于精细对轴，总时长仅秒级 */}
      <span className="font-mono text-xs text-muted-foreground">
        {formatPlaybackTime(currentTimeMs, true)} / {formatPlaybackTime(durationMs, false)}
      </span>

      {/* 进度条 */}
      <Slider
        aria-label="播放进度"
        min={0}
        max={sliderMax}
        step={1}
        value={[sliderValue]}
        disabled={durationMs <= 0}
        onValueChange={(values) => {
          const next = values[0];
          if (typeof next === "number") {
            requestSeek(next);
          }
        }}
        className="min-w-0 flex-1"
      />

      {/* 编辑操作 */}
      <div className="flex items-center gap-1 border-l border-border pl-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onUndo}
          disabled={!canUndo}
          title={undoTitle}
          aria-label={undoTitle}
        >
          <Undo2 className="size-4" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRedo}
          disabled={!canRedo}
          title={redoTitle}
          aria-label={redoTitle}
        >
          <Redo2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
