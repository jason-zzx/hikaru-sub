import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";

function formatTimeInput(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

function parseTimeInput(timeStr: string): number {
  const match = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!match) return 0;

  const [, hours, minutes, seconds, centiseconds] = match;
  return (
    parseInt(hours) * 3600000 +
    parseInt(minutes) * 60000 +
    parseInt(seconds) * 1000 +
    parseInt(centiseconds) * 10
  );
}

export function SubtitleEditor() {
  const cues = useProjectStore((s) => s.cues);
  const updateCue = useProjectStore((s) => s.updateCue);
  const addCue = useProjectStore((s) => s.addCue);
  const deleteCue = useProjectStore((s) => s.deleteCue);

  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);

  const selectedCue = cues.find((c) => c.id === selectedCueId);

  const [primaryText, setPrimaryText] = useState("");
  const [secondaryText, setSecondaryText] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  // 同步选中字幕到编辑框
  useEffect(() => {
    if (selectedCue) {
      setPrimaryText(selectedCue.primaryText);
      setSecondaryText(selectedCue.secondaryText || "");
      setStartTime(formatTimeInput(selectedCue.startMs));
      setEndTime(formatTimeInput(selectedCue.endMs));
    }
  }, [selectedCue]);

  const handleSave = () => {
    if (!selectedCue) return;
    updateCue(selectedCue.id, {
      primaryText,
      secondaryText: secondaryText || undefined,
      startMs: parseTimeInput(startTime),
      endMs: parseTimeInput(endTime),
    });
  };

  const handleDelete = () => {
    if (!selectedCue) return;
    if (confirm("确定删除该字幕？")) {
      deleteCue(selectedCue.id);
    }
  };

  const handleAdd = () => {
    const newCue = {
      id: `cue-${Date.now()}`,
      startMs: currentTimeMs,
      endMs: currentTimeMs + 2000,
      primaryText: "新建字幕",
      secondaryText: undefined,
      style: "Primary",
      layer: 0,
    };
    addCue(newCue);
  };

  if (!selectedCue) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-muted">
        <p className="text-sm">未选中字幕</p>
        <button
          onClick={handleAdd}
          className="rounded bg-primary px-4 py-2 text-sm text-white hover:bg-primary-hover"
        >
          在当前位置新建字幕
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">编辑字幕</h3>
        <div className="flex gap-2">
          <button
            onClick={handleAdd}
            className="rounded border border-border px-3 py-1 text-xs hover:bg-surface-hover"
          >
            新建
          </button>
          <button
            onClick={handleDelete}
            className="rounded border border-red-500 px-3 py-1 text-xs text-red-500 hover:bg-red-500/10"
          >
            删除
          </button>
        </div>
      </div>

      {/* 时间轴编辑 */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-text-muted">开始时间</label>
          <input
            type="text"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            onBlur={handleSave}
            placeholder="00:00:00.00"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm font-mono"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">结束时间</label>
          <input
            type="text"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            onBlur={handleSave}
            placeholder="00:00:00.00"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm font-mono"
          />
        </div>
      </div>

      {/* 字幕编辑 */}
      {secondaryText ? (
        <>
          {/* 译文编辑 */}
          <div>
            <label className="mb-1 block text-xs text-text-muted">译文</label>
            <textarea
              value={secondaryText}
              onChange={(e) => setSecondaryText(e.target.value)}
              onBlur={handleSave}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              rows={2}
            />
          </div>

          {/* 原文编辑 */}
          <div>
            <label className="mb-1 block text-xs text-text-muted">原文</label>
            <textarea
              value={primaryText}
              onChange={(e) => setPrimaryText(e.target.value)}
              onBlur={handleSave}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              rows={3}
            />
          </div>
        </>
      ) : (
        <div>
          <label className="mb-1 block text-xs text-text-muted">字幕</label>
          <textarea
            value={primaryText}
            onChange={(e) => setPrimaryText(e.target.value)}
            onBlur={handleSave}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
            rows={5}
          />
        </div>
      )}
    </div>
  );
}
