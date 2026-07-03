import { useEffect, useRef, useState } from "react";
import {
  formatInlineCueText,
  getCueDisplay,
  splitInlineCueText,
} from "@hikaru/ass-core";
import { useSubtitleMergeMode } from "../../hooks/useSubtitleMergeMode";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useUiStore } from "../../stores/uiStore";
import {
  appendCueAfter,
  createCueAtPlayhead,
  nextAfterCommit,
} from "../../services/editorActions";
import type { SubtitleCue } from "../../types";

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
  const mergeMode = useSubtitleMergeMode();

  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const setSelectedCueId = usePlaybackStore((s) => s.setSelectedCueId);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const setPlayUntil = usePlaybackStore((s) => s.setPlayUntil);
  const editorFocusNonce = useUiStore((s) => s.editorFocusNonce);

  const selectedCue = cues.find((c) => c.id === selectedCueId);

  const [inlineText, setInlineText] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [secondaryText, setSecondaryText] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  /** Esc 放弃草稿时置位，跳过随后 blur 触发的提交 */
  const escapingRef = useRef(false);
  const mainTextRef = useRef<HTMLTextAreaElement>(null);

  const useInlineEditor =
    mergeMode === "inline" &&
    !!selectedCue &&
    !!formatInlineCueText(selectedCue);

  // 文本草稿：仅在切换字幕或 store 文本变化（提交/撤销/翻译）时重置。
  // 打点只改时间不触发本 effect，正在输入的草稿不丢。
  useEffect(() => {
    if (!selectedCue) return;

    const display = getCueDisplay(selectedCue, mergeMode);
    if (display.mode === "single") {
      setInlineText(display.text);
      setPrimaryText(selectedCue.primaryText);
      setSecondaryText(selectedCue.secondaryText || "");
    } else {
      setInlineText("");
      setPrimaryText(display.primaryText);
      setSecondaryText(display.secondaryText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedCue?.id,
    selectedCue?.primaryText,
    selectedCue?.secondaryText,
    mergeMode,
  ]);

  // 时间字段：实时跟随 store（Ctrl+3/4 打点后即时刷新）。
  useEffect(() => {
    if (!selectedCue) return;
    setStartTime(formatTimeInput(selectedCue.startMs));
    setEndTime(formatTimeInput(selectedCue.endMs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCue?.id, selectedCue?.startMs, selectedCue?.endMs]);

  // Insert 新建字幕后的聚焦请求
  useEffect(() => {
    if (editorFocusNonce > 0) {
      mainTextRef.current?.focus();
    }
  }, [editorFocusNonce]);

  const commitDraft = () => {
    if (!selectedCue) return;

    if (useInlineEditor) {
      const split = splitInlineCueText(inlineText);
      updateCue(selectedCue.id, {
        primaryText: split?.primaryText ?? inlineText,
        secondaryText: split?.secondaryText,
        startMs: parseTimeInput(startTime),
        endMs: parseTimeInput(endTime),
      });
      return;
    }

    updateCue(selectedCue.id, {
      primaryText,
      secondaryText: secondaryText || undefined,
      startMs: parseTimeInput(startTime),
      endMs: parseTimeInput(endTime),
    });
  };

  const handleBlur = () => {
    if (escapingRef.current) return;
    commitDraft();
  };

  /** Enter：提交并跳下一条；最后一条时追加新行（继承样式，起点接结束时间）。 */
  const commitAndNext = () => {
    if (!selectedCue) return;
    commitDraft();

    const committedCues = useProjectStore.getState().cues;
    const followUp = nextAfterCommit(committedCues, selectedCue.id);
    if (followUp.kind === "none") return;

    setPlayUntil(null);
    if (followUp.kind === "select") {
      setSelectedCueId(followUp.cue.id);
      setCurrentTime(followUp.cue.startMs);
      return;
    }
    const appended = appendCueAfter(followUp.base);
    addCue(appended);
    setSelectedCueId(appended.id);
    setCurrentTime(appended.startMs);
    // 焦点保持在 textarea（元素不卸载），草稿经 id 变化的 effect 重置为空文本
  };

  const resetDraftsFromStore = () => {
    if (!selectedCue) return;
    const display = getCueDisplay(selectedCue, mergeMode);
    if (display.mode === "single") {
      setInlineText(display.text);
      setPrimaryText(selectedCue.primaryText);
      setSecondaryText(selectedCue.secondaryText || "");
    } else {
      setInlineText("");
      setPrimaryText(display.primaryText);
      setSecondaryText(display.secondaryText);
    }
    setStartTime(formatTimeInput(selectedCue.startMs));
    setEndTime(formatTimeInput(selectedCue.endMs));
  };

  const discardAndBlur = (el: HTMLElement) => {
    escapingRef.current = true;
    resetDraftsFromStore();
    el.blur();
    escapingRef.current = false;
  };

  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      discardAndBlur(e.currentTarget);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitAndNext();
    }
    // Shift+Enter 走 textarea 默认换行
  };

  const handleTimeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      discardAndBlur(e.currentTarget);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur(); // blur 提交
    }
  };

  const handleDelete = () => {
    if (!selectedCue) return;
    if (confirm("确定删除该字幕？")) {
      deleteCue(selectedCue.id);
    }
  };

  const handleAdd = () => {
    const newCue: SubtitleCue = createCueAtPlayhead(
      Math.round(usePlaybackStore.getState().currentTimeMs),
    );
    addCue(newCue);
    setSelectedCueId(newCue.id);
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
            title="新建字幕（Insert）"
          >
            新建
          </button>
          <button
            onClick={handleDelete}
            className="rounded border border-red-500 px-3 py-1 text-xs text-red-500 hover:bg-red-500/10"
            title="删除字幕（Delete）"
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
            onBlur={handleBlur}
            onKeyDown={handleTimeKeyDown}
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
            onBlur={handleBlur}
            onKeyDown={handleTimeKeyDown}
            placeholder="00:00:00.00"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm font-mono"
          />
        </div>
      </div>

      {/* 字幕编辑 */}
      {useInlineEditor ? (
        <div>
          <label className="mb-1 block text-xs text-text-muted">字幕</label>
          <textarea
            ref={mainTextRef}
            value={inlineText}
            onChange={(e) => setInlineText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleTextKeyDown}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
            rows={5}
          />
        </div>
      ) : secondaryText ? (
        <>
          <div>
            <label className="mb-1 block text-xs text-text-muted">译文</label>
            <textarea
              value={secondaryText}
              onChange={(e) => setSecondaryText(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleTextKeyDown}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              rows={2}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">原文</label>
            <textarea
              ref={mainTextRef}
              value={primaryText}
              onChange={(e) => setPrimaryText(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleTextKeyDown}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              rows={3}
            />
          </div>
        </>
      ) : (
        <div>
          <label className="mb-1 block text-xs text-text-muted">字幕</label>
          <textarea
            ref={mainTextRef}
            value={primaryText}
            onChange={(e) => setPrimaryText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleTextKeyDown}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
            rows={5}
          />
        </div>
      )}
    </div>
  );
}
