import { useEffect, useRef, useState } from "react";
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
import {
  applyAlignmentReplace,
  applyAttributeOverrideTag,
  applyToggleOverrideTag,
  colorOverrideStartTag,
  findEffectiveAlignment,
  restoreTagForStyle,
  type AttributeOverrideKind,
  type ColorOverrideKind,
} from "../../utils/assOverrideTags";
import {
  applyTimeInputKey,
  formatTimeInput,
  normalizeTimeInputValue,
  normalizeTimeRange,
  snapTimeInputCaret,
} from "../../utils/timeInput";
import { Select } from "../ui/select-adapter";
import { Button } from "../ui/button";
import { FontComboBox } from "./FontComboBox";
import { InlineOverridePanel } from "./InlineOverridePanel";
import type { SubtitleCue } from "../../types";

const QUICK_FONT_OPTIONS = [
  "Arial",
  "Noto Sans CJK JP",
  "Noto Sans SC",
  "Microsoft YaHei",
  "Meiryo",
  "Yu Gothic",
];

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

  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const setSelectedCueId = usePlaybackStore((s) => s.setSelectedCueId);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const setPlayUntil = usePlaybackStore((s) => s.setPlayUntil);
  const editorFocusNonce = useUiStore((s) => s.editorFocusNonce);

  const selectedCue = cues.find((c) => c.id === selectedCueId);

  const [text, setText] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [quickFontName, setQuickFontName] = useState("");
  const [quickFontSize, setQuickFontSize] = useState("48");

  const escapingRef = useRef(false);
  const textEditBaselineRef = useRef<TextEditBaseline | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const startTimeRef = useRef<HTMLInputElement>(null);
  const endTimeRef = useRef<HTMLInputElement>(null);

  const fontNames = usePreviewFontNames([
    ...QUICK_FONT_OPTIONS,
    ...assStyles.map((style) => style.fontName),
  ]);

  useEffect(() => {
    textEditBaselineRef.current = null;
  }, [selectedCue?.id]);

  useEffect(() => {
    if (!selectedCue) return;
    setText(selectedCue.primaryText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCue?.id, selectedCue?.primaryText]);

  useEffect(() => {
    if (!selectedCue) return;
    setStartTime(formatTimeInput(selectedCue.startMs));
    setEndTime(formatTimeInput(selectedCue.endMs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCue?.id, selectedCue?.startMs, selectedCue?.endMs]);

  const rememberTextEditBaseline = () => {
    if (!selectedCue) return;
    if (textEditBaselineRef.current?.cue.id === selectedCue.id) return;
    textEditBaselineRef.current = {
      cue: selectedCue,
      wasDirty: useProjectStore.getState().isDirty,
    };
  };

  const handleTextFocus = () => {
    rememberTextEditBaseline();
  };

  const handleTextChange = (nextText: string) => {
    setText(nextText);
    if (!selectedCue) return;
    rememberTextEditBaseline();
    updateCuePreview(selectedCue.id, { primaryText: nextText });
  };

  useEffect(() => {
    if (editorFocusNonce > 0) {
      textRef.current?.focus();
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

  const commitTextDraft = () => {
    if (!selectedCue) return false;
    updateCue(selectedCue.id, { primaryText: text });
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
      primaryText: text,
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
  };

  const currentStyle = selectedCue
    ? assStyles.find((style) => style.name === selectedCue.style)
    : undefined;
  const effectiveAlignment = textRef.current
    ? findEffectiveAlignment(text, currentStyle?.alignment)
    : currentStyle?.alignment;

  const applyAttributeTag = (
    kind: AttributeOverrideKind,
    startTag: string,
  ) => {
    const textarea = textRef.current;
    if (!textarea) return;

    const result = applyAttributeOverrideTag(
      text,
      textarea.selectionStart,
      textarea.selectionEnd,
      {
        startTag,
        restoreTag: restoreTagForStyle(kind, currentStyle),
      },
    );

    handleTextChange(result.text);
    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    }, 0);
  };

  const applyToggleTag = (startTag: string, endTag: string) => {
    const textarea = textRef.current;
    if (!textarea) return;

    const result = applyToggleOverrideTag(
      text,
      textarea.selectionStart,
      textarea.selectionEnd,
      { startTag, endTag },
    );

    handleTextChange(result.text);
    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    }, 0);
  };

  const handleFontChange = (fontName: string) => {
    setQuickFontName(fontName);
    if (fontName) {
      applyAttributeTag("fontName", `{\\fn${fontName}}`);
    }
  };

  const handleFontSizeCommit = () => {
    const parsed = Number(quickFontSize);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 200) {
      applyAttributeTag("fontSize", `{\\fs${Math.round(parsed)}}`);
    }
  };

  const handleInlineColor = (kind: ColorOverrideKind, color: string) => {
    applyAttributeTag(kind, colorOverrideStartTag(kind, color));
  };

  const handleInlineNumber = (kind: "outline" | "shadow", value: number) => {
    const rounded = Math.round(value * 10) / 10;
    const formatted = Number.isInteger(rounded)
      ? String(rounded)
      : rounded.toFixed(1);
    const command = kind === "outline" ? "bord" : "shad";
    applyAttributeTag(kind, `{\\${command}${formatted}}`);
  };

  const handleInlineAlignment = (alignment: number) => {
    if (!Number.isInteger(alignment) || alignment < 1 || alignment > 9) return;
    const textarea = textRef.current;
    if (!textarea) return;
    const result = applyAlignmentReplace(text, alignment);
    handleTextChange(result.text);
    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    }, 0);
  };

  const resetDraftsFromStore = () => {
    if (!selectedCue) return;
    setText(selectedCue.primaryText);
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
    });
    if (!baseline.wasDirty) {
      useProjectStore.getState().markSaved();
    }
    setText(baseline.cue.primaryText);
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
        <Button onClick={handleAdd} className="px-4 py-2">
          在当前位置新建字幕
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">编辑字幕</h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAdd}
            title="新建字幕（Insert）"
          >
            新建
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            title="删除字幕（Delete）"
          >
            删除
          </Button>
        </div>
      </div>

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
            className="w-full rounded border border-input bg-card px-2 py-1 font-mono text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
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
            className="w-full rounded border border-input bg-card px-2 py-1 font-mono text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
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
        <div className="grid grid-cols-[minmax(0,1fr)_72px] items-end gap-2">
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
                  event.currentTarget.blur();
                }
              }}
              className="h-9 w-full rounded border border-input bg-card px-2 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="快速样式标签">
          <Button
            type="button"
            variant="outline"
            onClick={() => applyToggleTag("{\\b1}", "{\\b0}")}
            className="h-9 flex-1 font-bold"
            title="插入粗体标签"
          >
            B
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => applyToggleTag("{\\i1}", "{\\i0}")}
            className="h-9 flex-1 italic"
            title="插入斜体标签"
          >
            I
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => applyToggleTag("{\\u1}", "{\\u0}")}
            className="h-9 flex-1 underline"
            title="插入下划线标签"
          >
            U
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => applyToggleTag("{\\s1}", "{\\s0}")}
            className="h-9 flex-1 line-through"
            title="插入删除线标签"
          >
            S
          </Button>
          <InlineOverridePanel
            currentStyle={currentStyle}
            effectiveAlignment={effectiveAlignment}
            onApplyColor={handleInlineColor}
            onApplyNumber={handleInlineNumber}
            onApplyAlignment={handleInlineAlignment}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-text-muted">字幕</label>
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleBlur}
          onFocus={handleTextFocus}
          onKeyDown={handleTextKeyDown}
          className="w-full rounded border border-input bg-card px-2 py-1 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          rows={5}
        />
      </div>
    </div>
  );
}
