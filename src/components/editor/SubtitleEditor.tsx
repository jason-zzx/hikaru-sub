import { useEffect, useRef, useState } from "react";
import {
  formatInlineCueText,
  getCueDisplay,
  splitInlineCueText,
} from "@hikaru/ass-core";
import { useSubtitleMergeMode } from "../../hooks/useSubtitleMergeMode";
import { usePreviewFontNames } from "../../hooks/usePreviewFontNames";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useUiStore } from "../../stores/uiStore";
import {
  appendCueAfterWithUniqueId,
  createCueAtPlayheadWithUniqueId,
  nextAfterCommit,
  selectCueAfterDelete,
} from "../../services/editorActions";
import { applyToggleOverrideTag } from "../../utils/assOverrideTags";
import {
  applyTimeInputKey,
  formatTimeInput,
  normalizeTimeInputValue,
  normalizeTimeRange,
  snapTimeInputCaret,
} from "../../utils/timeInput";
import { Select } from "../ui/Select";
import { ColorPicker } from "./ColorPicker";
import { FontComboBox } from "./FontComboBox";
import type { SubtitleCue } from "../../types";

const QUICK_FONT_OPTIONS = [
  "Arial",
  "Noto Sans CJK JP",
  "Noto Sans SC",
  "Microsoft YaHei",
  "Meiryo",
  "Yu Gothic",
];

type EditableTextField = "inline" | "primary" | "secondary";

type TextEditBaseline = {
  cue: SubtitleCue;
  wasDirty: boolean;
};

type EditorNotify = (variant: "success" | "error" | "info", text: string) => void;
type TimeField = "start" | "end";

interface SubtitleEditorProps {
  onNotify?: EditorNotify;
}

export function SubtitleEditor({ onNotify }: SubtitleEditorProps) {
  const cues = useProjectStore((s) => s.cues);
  const updateCue = useProjectStore((s) => s.updateCue);
  const updateCuePreview = useProjectStore((s) => s.updateCuePreview);
  const addCue = useProjectStore((s) => s.addCue);
  const deleteCue = useProjectStore((s) => s.deleteCue);
  const assStyles = useProjectStore((s) => s.assStyles);
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
  const [quickFontName, setQuickFontName] = useState("");
  const [quickFontSize, setQuickFontSize] = useState("48");
  const [quickColor, setQuickColor] = useState("&H00FFFFFF");
  const [inlineEditorCueId, setInlineEditorCueId] = useState<string | null>(
    null,
  );

  /** Esc 放弃草稿时置位，跳过随后 blur 触发的提交 */
  const escapingRef = useRef(false);
  const activeTextFieldRef = useRef<EditableTextField>("primary");
  const textEditBaselineRef = useRef<TextEditBaseline | null>(null);
  const inlineTextRef = useRef<HTMLTextAreaElement>(null);
  const primaryTextRef = useRef<HTMLTextAreaElement>(null);
  const secondaryTextRef = useRef<HTMLTextAreaElement>(null);
  const startTimeRef = useRef<HTMLInputElement>(null);
  const endTimeRef = useRef<HTMLInputElement>(null);

  const selectedCueStartsInline =
    mergeMode === "inline" &&
    !!selectedCue &&
    !!formatInlineCueText(selectedCue);
  const useInlineEditor =
    mergeMode === "inline" &&
    !!selectedCue &&
    (inlineEditorCueId === selectedCue.id || selectedCueStartsInline);
  const fontNames = usePreviewFontNames([
    ...QUICK_FONT_OPTIONS,
    ...assStyles.map((style) => style.fontName),
  ]);

  useEffect(() => {
    setInlineEditorCueId(
      selectedCueStartsInline && selectedCue ? selectedCue.id : null,
    );
    textEditBaselineRef.current = null;
    // 只在切换字幕/合并模式时锁定编辑器形态，避免实时预览把行内编辑框切走。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCue?.id, mergeMode]);

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

  const textUpdatesFor = (
    field: EditableTextField,
    nextText: string,
  ): Pick<Partial<SubtitleCue>, "primaryText" | "secondaryText"> => {
    if (field === "inline") {
      const split = splitInlineCueText(nextText);
      return {
        primaryText: split?.primaryText ?? nextText,
        secondaryText: split?.secondaryText,
      };
    }
    if (field === "secondary") {
      return { secondaryText: nextText || undefined };
    }
    return { primaryText: nextText };
  };

  const rememberTextEditBaseline = () => {
    if (!selectedCue) return;
    if (textEditBaselineRef.current?.cue.id === selectedCue.id) return;
    textEditBaselineRef.current = {
      cue: selectedCue,
      wasDirty: useProjectStore.getState().isDirty,
    };
  };

  const handleTextFocus = (field: EditableTextField) => {
    activeTextFieldRef.current = field;
    rememberTextEditBaseline();
  };

  const handleTextChange = (field: EditableTextField, nextText: string) => {
    if (field === "inline") setInlineText(nextText);
    if (field === "primary") setPrimaryText(nextText);
    if (field === "secondary") setSecondaryText(nextText);

    if (!selectedCue) return;
    rememberTextEditBaseline();
    updateCuePreview(selectedCue.id, textUpdatesFor(field, nextText));
  };

  // Insert 新建字幕后的聚焦请求
  useEffect(() => {
    if (editorFocusNonce > 0) {
      (useInlineEditor ? inlineTextRef.current : primaryTextRef.current)?.focus();
    }
  }, [editorFocusNonce]);

  const setTimeValue = (field: TimeField, value: string) => {
    if (field === "start") setStartTime(value);
    else setEndTime(value);
  };

  const timeInputFor = (field: TimeField) =>
    field === "start" ? startTimeRef.current : endTimeRef.current;

  const scheduleTimeCaret = (field: TimeField, position: number) => {
    window.requestAnimationFrame(() => {
      const input = timeInputFor(field);
      if (!input) return;
      input.setSelectionRange(position, position);
    });
  };

  const buildCurrentTextUpdates = () => {
    if (useInlineEditor) {
      return textUpdatesFor("inline", inlineText);
    }
    return {
      ...textUpdatesFor("primary", primaryText),
      ...textUpdatesFor("secondary", secondaryText),
    };
  };

  const commitTextDraft = () => {
    if (!selectedCue) return false;
    updateCue(selectedCue.id, buildCurrentTextUpdates());
    textEditBaselineRef.current = null;
    return true;
  };

  const commitTimeDraft = (field: TimeField = "end") => {
    if (!selectedCue) return false;
    const result = normalizeTimeRange(startTime, endTime, field);
    setStartTime(result.startText);
    setEndTime(result.endText);
    updateCue(selectedCue.id, {
      startMs: result.startMs,
      endMs: result.endMs,
    });
    return true;
  };

  const commitDraft = () => {
    if (!selectedCue) return false;

    const result = normalizeTimeRange(startTime, endTime, "end");
    setStartTime(result.startText);
    setEndTime(result.endText);
    updateCue(selectedCue.id, {
      ...buildCurrentTextUpdates(),
      startMs: result.startMs,
      endMs: result.endMs,
    });
    textEditBaselineRef.current = null;
    return true;
  };

  const handleBlur = () => {
    if (escapingRef.current) return;
    commitTextDraft();
  };

  const handleTimeBlur = (field: TimeField) => {
    if (escapingRef.current) return;
    const normalized = normalizeTimeInputValue(
      field === "start" ? startTime : endTime,
    );
    setTimeValue(field, normalized);
    commitTimeDraft(field);
  };

  /** Enter：提交并跳下一条；最后一条时追加新行（继承样式，起点接结束时间）。 */
  const commitAndNext = () => {
    if (!selectedCue) return;
    if (!commitDraft()) return;

    const committedCues = useProjectStore.getState().cues;
    const followUp = nextAfterCommit(committedCues, selectedCue.id);
    if (followUp.kind === "none") return;

    setPlayUntil(null);
    if (followUp.kind === "select") {
      setSelectedCueId(followUp.cue.id);
      setCurrentTime(followUp.cue.startMs);
      return;
    }
    const appended = appendCueAfterWithUniqueId(
      followUp.base,
      useProjectStore.getState().cues,
    );
    if (!appended) {
      onNotify?.("error", "新建字幕失败：无法生成唯一 ID");
      return;
    }
    addCue(appended);
    setSelectedCueId(appended.id);
    setCurrentTime(appended.startMs);
    // 焦点保持在 textarea（元素不卸载），草稿经 id 变化的 effect 重置为空文本
  };

  const getActiveTextTarget = () => {
    const field = activeTextFieldRef.current;
    return (
      field === "secondary" && secondaryTextRef.current
        ? {
            field: "secondary" as const,
            textarea: secondaryTextRef.current,
            text: secondaryText,
          }
        : useInlineEditor && inlineTextRef.current
          ? {
              field: "inline" as const,
              textarea: inlineTextRef.current,
              text: inlineText,
            }
          : primaryTextRef.current
            ? {
                field: "primary" as const,
                textarea: primaryTextRef.current,
                text: primaryText,
              }
            : null
    );
  };

  const insertOverrideTag = (tag: string) => {
    const target = getActiveTextTarget();

    if (!target) return;

    const start = target.textarea.selectionStart;
    const end = target.textarea.selectionEnd;
    const nextText = target.text.slice(0, start) + tag + target.text.slice(end);

    handleTextChange(target.field, nextText);

    window.setTimeout(() => {
      target.textarea.focus();
      const position = start + tag.length;
      target.textarea.setSelectionRange(position, position);
    }, 0);
  };

  const applyToggleTag = (startTag: string, endTag: string) => {
    const target = getActiveTextTarget();
    if (!target) return;

    const result = applyToggleOverrideTag(
      target.text,
      target.textarea.selectionStart,
      target.textarea.selectionEnd,
      { startTag, endTag },
    );

    handleTextChange(target.field, result.text);
    window.setTimeout(() => {
      target.textarea.focus();
      target.textarea.setSelectionRange(
        result.selectionStart,
        result.selectionEnd,
      );
    }, 0);
  };

  const handleFontChange = (fontName: string) => {
    setQuickFontName(fontName);
    if (fontName) {
      insertOverrideTag(`{\\fn${fontName}}`);
    }
  };

  const handleFontSizeCommit = () => {
    const parsed = Number(quickFontSize);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 200) {
      insertOverrideTag(`{\\fs${Math.round(parsed)}}`);
    }
  };

  const handleColorChange = (color: string) => {
    setQuickColor(color);
    insertOverrideTag(`{\\c${color}}`);
  };

  const resetTextDraftsFromCue = (cue: SubtitleCue) => {
    const display = getCueDisplay(cue, mergeMode);
    if (display.mode === "single") {
      setInlineText(display.text);
      setPrimaryText(cue.primaryText);
      setSecondaryText(cue.secondaryText || "");
    } else {
      setInlineText("");
      setPrimaryText(display.primaryText);
      setSecondaryText(display.secondaryText);
    }
  };

  const resetDraftsFromStore = () => {
    if (!selectedCue) return;
    resetTextDraftsFromCue(selectedCue);
    setStartTime(formatTimeInput(selectedCue.startMs));
    setEndTime(formatTimeInput(selectedCue.endMs));
  };

  const discardTextDraft = () => {
    const baseline = textEditBaselineRef.current;
    if (!baseline || !selectedCue || baseline.cue.id !== selectedCue.id) {
      resetDraftsFromStore();
      return;
    }

    updateCuePreview(selectedCue.id, {
      primaryText: baseline.cue.primaryText,
      secondaryText: baseline.cue.secondaryText,
    });
    if (!baseline.wasDirty) {
      useProjectStore.getState().markSaved();
    }
    resetTextDraftsFromCue(baseline.cue);
    textEditBaselineRef.current = null;
  };

  const discardAndBlur = (el: HTMLElement) => {
    escapingRef.current = true;
    if (el instanceof HTMLTextAreaElement) {
      discardTextDraft();
    } else {
      resetDraftsFromStore();
    }
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

  const handleTimeKeyDown =
    (field: TimeField) => (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        discardAndBlur(e.currentTarget);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (commitTimeDraft(field)) e.currentTarget.blur();
        return;
      }

      const result = applyTimeInputKey(
        e.currentTarget.value,
        e.currentTarget.selectionStart ?? 0,
        e.currentTarget.selectionEnd ?? 0,
        e.key,
      );
      if (!result.handled) return;

      e.preventDefault();
      setTimeValue(field, result.value);
      scheduleTimeCaret(field, result.selectionStart);
    };

  const handleTimeChange =
    (field: TimeField) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const caret = snapTimeInputCaret(e.currentTarget.selectionStart ?? 0);
      setTimeValue(field, normalizeTimeInputValue(e.currentTarget.value));
      scheduleTimeCaret(field, caret);
    };

  const handleDelete = () => {
    if (!selectedCue) return;
    const before = useProjectStore.getState().cues;
    const next = selectCueAfterDelete(before, selectedCue.id);
    deleteCue(selectedCue.id);
    setSelectedCueId(next ? next.id : null);
    setPlayUntil(null);
    onNotify?.("info", "已删除字幕，可按 Ctrl+Z 撤销");
  };

  const handleAdd = () => {
    const newCue: SubtitleCue | null = createCueAtPlayheadWithUniqueId(
      Math.round(usePlaybackStore.getState().currentTimeMs),
      useProjectStore.getState().cues,
    );
    if (!newCue) {
      onNotify?.("error", "新建字幕失败：无法生成唯一 ID");
      return;
    }
    addCue(newCue);
    setSelectedCueId(newCue.id);
  };

  const styleOptions = assStyles.map((style) => ({
    value: style.name,
    label: style.name,
  }));

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
            ref={startTimeRef}
            type="text"
            value={startTime}
            onChange={handleTimeChange("start")}
            onBlur={() => handleTimeBlur("start")}
            onKeyDown={handleTimeKeyDown("start")}
            placeholder="00:00:00.00"
            inputMode="numeric"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm font-mono"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">结束时间</label>
          <input
            ref={endTimeRef}
            type="text"
            value={endTime}
            onChange={handleTimeChange("end")}
            onBlur={() => handleTimeBlur("end")}
            onKeyDown={handleTimeKeyDown("end")}
            placeholder="00:00:00.00"
            inputMode="numeric"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm font-mono"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded border border-border bg-surface/40 p-3">
        <label className="text-xs text-text-muted">样式</label>
        <Select
          value={selectedCue.style}
          onChange={(value) => updateCue(selectedCue.id, { style: value })}
          options={styleOptions}
          placeholder=""
        />
        <div className="grid grid-cols-[minmax(0,1fr)_72px_auto] items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-text-muted">字体</label>
            <FontComboBox
              value={quickFontName}
              onCommit={handleFontChange}
              options={fontNames}
              placeholder={fontNames.length > 0 ? "字体" : "字体（加载中）"}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">字号</label>
            <input
              type="number"
              min="1"
              max="200"
              value={quickFontSize}
              onChange={(event) => setQuickFontSize(event.target.value)}
              onBlur={handleFontSizeCommit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleFontSizeCommit();
                }
              }}
              className="h-9 w-full rounded border border-border bg-surface px-2 text-sm text-text outline-none focus:border-accent/60"
            />
          </div>
          <ColorPicker
            value={quickColor}
            onChange={handleColorChange}
            deferChange
          />
        </div>
        <div className="flex gap-2" aria-label="快速样式标签">
          <button
            type="button"
            onClick={() => applyToggleTag("{\\b1}", "{\\b0}")}
            className="h-9 flex-1 rounded border border-border bg-surface text-sm font-bold hover:bg-surface-overlay"
            title="插入粗体标签"
          >
            B
          </button>
          <button
            type="button"
            onClick={() => applyToggleTag("{\\i1}", "{\\i0}")}
            className="h-9 flex-1 rounded border border-border bg-surface text-sm italic hover:bg-surface-overlay"
            title="插入斜体标签"
          >
            I
          </button>
          <button
            type="button"
            onClick={() => applyToggleTag("{\\u1}", "{\\u0}")}
            className="h-9 flex-1 rounded border border-border bg-surface text-sm underline hover:bg-surface-overlay"
            title="插入下划线标签"
          >
            U
          </button>
          <button
            type="button"
            onClick={() => applyToggleTag("{\\s1}", "{\\s0}")}
            className="h-9 flex-1 rounded border border-border bg-surface text-sm line-through hover:bg-surface-overlay"
            title="插入删除线标签"
          >
            S
          </button>
        </div>
      </div>

      {/* 字幕编辑 */}
      {useInlineEditor ? (
        <div>
          <label className="mb-1 block text-xs text-text-muted">字幕</label>
          <textarea
            ref={inlineTextRef}
            value={inlineText}
            onChange={(e) => handleTextChange("inline", e.target.value)}
            onBlur={handleBlur}
            onFocus={() => handleTextFocus("inline")}
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
              ref={secondaryTextRef}
              value={secondaryText}
              onChange={(e) => handleTextChange("secondary", e.target.value)}
              onBlur={handleBlur}
              onFocus={() => handleTextFocus("secondary")}
              onKeyDown={handleTextKeyDown}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
              rows={2}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">原文</label>
            <textarea
              ref={primaryTextRef}
              value={primaryText}
              onChange={(e) => handleTextChange("primary", e.target.value)}
              onBlur={handleBlur}
              onFocus={() => handleTextFocus("primary")}
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
            ref={primaryTextRef}
            value={primaryText}
            onChange={(e) => handleTextChange("primary", e.target.value)}
            onBlur={handleBlur}
            onFocus={() => handleTextFocus("primary")}
            onKeyDown={handleTextKeyDown}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm"
            rows={5}
          />
        </div>
      )}
    </div>
  );
}
