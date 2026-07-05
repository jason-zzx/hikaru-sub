import { useEffect, useRef } from "react";
import { getCueDisplay } from "@hikaru/ass-core";
import { useSubtitleMergeMode } from "../../hooks/useSubtitleMergeMode";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import type { SubtitleCue } from "../../types";

export function SubtitleList() {
  const cues = useProjectStore((s) => s.cues);
  const mergeMode = useSubtitleMergeMode();
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const setSelectedCueId = usePlaybackStore((s) => s.setSelectedCueId);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const setPlayUntil = usePlaybackStore((s) => s.setPlayUntil);

  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // 自动滚动到选中项
  useEffect(() => {
    if (selectedRef.current && listRef.current) {
      const list = listRef.current;
      const item = selectedRef.current;
      const listRect = list.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();

      if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
        item.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }, [selectedCueId]);

  const handleCueClick = (cue: SubtitleCue) => {
    setSelectedCueId(cue.id);
    setCurrentTime(cue.startMs);
    setPlayUntil(null);
  };

  if (cues.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        暂无字幕
      </div>
    );
  }

  return (
    <div ref={listRef} className="h-full overflow-auto">
      <div className="space-y-1 p-2">
        {cues.map((cue) => {
          const display = getCueDisplay(cue, mergeMode);
          return (
            <div
              key={cue.id}
              ref={cue.id === selectedCueId ? selectedRef : null}
              onClick={() => handleCueClick(cue)}
              className={`cursor-pointer rounded border px-3 py-2 transition-colors ${
                cue.id === selectedCueId
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-surface-hover"
              }`}
            >
              <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
                <span>#{cues.indexOf(cue) + 1}</span>
                <span>{formatTime(cue.startMs)} → {formatTime(cue.endMs)}</span>
              </div>
              <div className="space-y-1 text-sm">
                {display.mode === "single" ? (
                  <div className="text-text">{display.text}</div>
                ) : (
                  <>
                    <div className="font-medium text-primary">
                      {display.secondaryText}
                    </div>
                    <div className="text-text">{display.primaryText}</div>
                  </>
                )}
              </div>
            </div>
          );
        })}
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
