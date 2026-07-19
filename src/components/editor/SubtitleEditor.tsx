import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { usePreviewFontNames } from "../../hooks/usePreviewFontNames";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useUiStore } from "../../stores/uiStore";
import {
  appendCueAfterWithUniqueId,
  applySelectedCueAlignment,
  applySelectedCueAttribute,
  applySelectedCueStyle,
  applySelectedCueToggle,
  createCueAtPlayheadWithUniqueId,
  hasMultipleSelectedCues,
  nextAfterCommit,
  selectCueAfterDelete,
} from "../../services/editorActions";
import { makeTextOp } from "../../services/editorTextHistory";
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
  TIME_INPUT_TEMPLATE,
} from "../../utils/timeInput";
import { Select } from "../ui/select-adapter";
import { Button } from "../ui/button";
import { FontComboBox } from "./FontComboBox";
import { InlineOverridePanel } from "./InlineOverridePanel";
import {
  EDITOR_HOTKEYS,
  findHotkey,
  formatActionShortcutTitle,
  HISTORY_COMMAND_ATTR,
  type HotkeyDef,
} from "./hotkeys";
import type { SubtitleCue } from "../../types";

const QUICK_FONT_OPTIONS = [
  "Arial",
  "Noto Sans CJK JP",
  "Noto Sans SC",
  "Microsoft YaHei",
  "Meiryo",
  "Yu Gothic",
];

type EditorNotify = (variant: "success" | "error" | "info", text: string) => void;
type TimeField = "start" | "end";

export interface SubtitleEditorHistoryHandle {
  commitPendingTimeDraft(): boolean;
}

interface SubtitleEditorProps {
  onNotify?: EditorNotify;
  onPendingTimeDraftChange?: (hasPending: boolean) => void;
  hotkeys?: readonly HotkeyDef[];
}

type ExpectedCompositionEvent = {
  cueId: string;
  text: string;
  start: number;
  end: number;
};

export const SubtitleEditor = forwardRef<
  SubtitleEditorHistoryHandle,
  SubtitleEditorProps
>(function SubtitleEditor(
  {
    onNotify,
    onPendingTimeDraftChange,
    hotkeys = EDITOR_HOTKEYS,
  },
  ref,
) {
  const cues = useProjectStore((s) => s.cues);
  const updateCue = useProjectStore((s) => s.updateCue);
  const replaceCues = useProjectStore((s) => s.replaceCues);
  const addCue = useProjectStore((s) => s.addCue);
  const deleteCue = useProjectStore((s) => s.deleteCue);
  const assStyles = useProjectStore((s) => s.assStyles);
  const applyTextEdit = useProjectStore((s) => s.applyTextEdit);
  const acceptTextSession = useProjectStore((s) => s.acceptTextSession);
  const rollbackTextSession = useProjectStore((s) => s.rollbackTextSession);
  const setTextSelection = useProjectStore((s) => s.setTextSelection);
  const beginComposition = useProjectStore((s) => s.beginComposition);
  const updateCompositionPreview = useProjectStore(
    (s) => s.updateCompositionPreview,
  );
  const endComposition = useProjectStore((s) => s.endComposition);
  const pendingCaretRestore = useProjectStore(
    (s) => s.history.pendingCaretRestore,
  );
  const documentEpoch = useProjectStore((s) => s.documentEpoch);
  const consumePendingCaretRestore = useProjectStore(
    (s) => s.consumePendingCaretRestore,
  );

  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const selectedCueIds = usePlaybackStore((s) => s.selectedCueIds);
  const setSelectedCueId = usePlaybackStore((s) => s.setSelectedCueId);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const setPlayUntil = usePlaybackStore((s) => s.setPlayUntil);
  const editorFocusNonce = useUiStore((s) => s.editorFocusNonce);

  const selectedCue = cues.find((c) => c.id === selectedCueId);
  const text = selectedCue?.primaryText ?? "";
  const hasBatchSelection = hasMultipleSelectedCues(cues, selectedCueIds);

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [quickFontName, setQuickFontName] = useState("");
  const [quickFontSize, setQuickFontSize] = useState("48");
  const quickFontSizeBaselineRef = useRef("48");

  const escapingRef = useRef(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const startTimeRef = useRef<HTMLInputElement>(null);
  const endTimeRef = useRef<HTMLInputElement>(null);
  const beforeInputRef = useRef<{
    inputType: string | null;
    start: number;
    end: number;
  } | null>(null);
  const textSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const expectedCompositionEventRef = useRef<ExpectedCompositionEvent | null>(
    null,
  );
  const composingRef = useRef(false);
  const pendingTimeFieldRef = useRef<TimeField>("end");

  const fontNames = usePreviewFontNames([
    ...QUICK_FONT_OPTIONS,
    ...assStyles.map((style) => style.fontName),
  ]);

  const pendingTime = selectedCue
    ? normalizeTimeRange(startTime, endTime, pendingTimeFieldRef.current)
    : null;
  const hasPendingTimeDraft =
    pendingTime !== null &&
    (pendingTime.startMs !== selectedCue?.startMs ||
      pendingTime.endMs !== selectedCue?.endMs);

  const commitTimeDraft = (field: TimeField = "end") => {
    if (!selectedCue) return false;
    const result = normalizeTimeRange(startTime, endTime, field);
    const changed =
      result.startMs !== selectedCue.startMs ||
      result.endMs !== selectedCue.endMs;
    setStartTime(result.startText);
    setEndTime(result.endText);
    updateCue(selectedCue.id, {
      startMs: result.startMs,
      endMs: result.endMs,
    });
    return changed;
  };

  useEffect(() => {
    onPendingTimeDraftChange?.(hasPendingTimeDraft);
  }, [hasPendingTimeDraft, onPendingTimeDraftChange]);

  useImperativeHandle(
    ref,
    () => ({
      commitPendingTimeDraft: () =>
        commitTimeDraft(pendingTimeFieldRef.current),
    }),
    [selectedCue, startTime, endTime, updateCue],
  );

  useEffect(() => {
    // Clear local input state on cue or document/session lifecycle changes.
    expectedCompositionEventRef.current = null;
    composingRef.current = false;
    beforeInputRef.current = null;
    textSelectionRef.current = null;
  }, [selectedCue?.id, documentEpoch]);

  useEffect(() => {
    if (!selectedCue) return;
    setStartTime(formatTimeInput(selectedCue.startMs));
    setEndTime(formatTimeInput(selectedCue.endMs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCue?.id, selectedCue?.startMs, selectedCue?.endMs]);

  // Restore caret after undo/redo once controlled text has rendered.
  useEffect(() => {
    if (!pendingCaretRestore || !selectedCue) return;
    if (
      pendingCaretRestore.selection &&
      pendingCaretRestore.selection.cueId !== selectedCue.id
    ) {
      return;
    }
    const textarea = textRef.current;
    if (!textarea) {
      consumePendingCaretRestore(pendingCaretRestore.nonce);
      return;
    }
    const sel = pendingCaretRestore.selection;
    if (sel && sel.cueId === selectedCue.id) {
      const max = textarea.value.length;
      const start = Math.min(sel.start, max);
      const end = Math.min(sel.end, max);
      textarea.focus();
      textarea.setSelectionRange(start, end, sel.direction);
    }
    consumePendingCaretRestore(pendingCaretRestore.nonce);
  }, [
    pendingCaretRestore,
    selectedCue?.id,
    text,
    consumePendingCaretRestore,
  ]);

  useEffect(() => {
    if (editorFocusNonce > 0) {
      textRef.current?.focus();
    }
  }, [editorFocusNonce]);

  const setTimeValue = (field: TimeField, value: string) => {
    pendingTimeFieldRef.current = field;
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

  const syncSelectionFromTextarea = () => {
    const textarea = textRef.current;
    if (!textarea || !selectedCue) return;
    textSelectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    setTextSelection({
      cueId: selectedCue.id,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      direction:
        (textarea.selectionDirection as "forward" | "backward" | "none") ??
        "none",
    });
  };

  const commitDraft = () => {
    if (!selectedCue) return false;
    commitTimeDraft("end");
    return true;
  };

  const handleBlur = () => {
    if (escapingRef.current) return;
    acceptTextSession();
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

  const applyDiscreteTextUpdate = (
    nextText: string,
    selectionStart: number,
    selectionEnd: number,
  ) => {
    if (!selectedCue) return;
    // updateCue also accepts the active text session on a formatting no-op.
    updateCue(selectedCue.id, { primaryText: nextText });
    setTextSelection({
      cueId: selectedCue.id,
      start: selectionStart,
      end: selectionEnd,
      direction: "none",
    });
    window.setTimeout(() => {
      const textarea = textRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    }, 0);
  };

  const applyAttributeTag = (
    kind: AttributeOverrideKind,
    startTag: string,
  ) => {
    if (hasBatchSelection) {
      const state = useProjectStore.getState();
      replaceCues(
        applySelectedCueAttribute(
          state.cues,
          selectedCueIds,
          state.assStyles,
          kind,
          startTag,
        ),
      );
      return;
    }

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

    applyDiscreteTextUpdate(
      result.text,
      result.selectionStart,
      result.selectionEnd,
    );
  };

  const applyToggleTag = (startTag: string, endTag: string) => {
    if (hasBatchSelection) {
      replaceCues(
        applySelectedCueToggle(
          useProjectStore.getState().cues,
          selectedCueIds,
          startTag,
          endTag,
        ),
      );
      return;
    }

    const textarea = textRef.current;
    if (!textarea) return;

    const result = applyToggleOverrideTag(
      text,
      textarea.selectionStart,
      textarea.selectionEnd,
      { startTag, endTag },
    );

    applyDiscreteTextUpdate(
      result.text,
      result.selectionStart,
      result.selectionEnd,
    );
  };

  const handleFontChange = (fontName: string) => {
    setQuickFontName(fontName);
    if (fontName) {
      applyAttributeTag("fontName", `{\\fn${fontName}}`);
      if (hasBatchSelection) {
        (document.activeElement as HTMLElement | null)?.blur();
      }
    }
  };

  const handleFontSizeCommit = () => {
    // Only commit when the draft actually changed from focus baseline.
    if (quickFontSize === quickFontSizeBaselineRef.current) return;
    const parsed = Number(quickFontSize);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 200) {
      applyAttributeTag("fontSize", `{\\fs${Math.round(parsed)}}`);
      quickFontSizeBaselineRef.current = quickFontSize;
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
    if (hasBatchSelection) {
      replaceCues(
        applySelectedCueAlignment(
          useProjectStore.getState().cues,
          selectedCueIds,
          alignment,
        ),
      );
      return;
    }

    const textarea = textRef.current;
    if (!textarea) return;
    const result = applyAlignmentReplace(text, alignment);
    applyDiscreteTextUpdate(
      result.text,
      result.selectionStart,
      result.selectionEnd,
    );
  };

  const resetDraftsFromStore = () => {
    if (!selectedCue) return;
    setStartTime(formatTimeInput(selectedCue.startMs));
    setEndTime(formatTimeInput(selectedCue.endMs));
  };

  const discardAndBlur = (el: HTMLElement) => {
    escapingRef.current = true;
    if (el instanceof HTMLTextAreaElement) rollbackTextSession();
    else resetDraftsFromStore();
    el.blur();
    escapingRef.current = false;
  };

  const handleBeforeInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const ne = e.nativeEvent as InputEvent;
    const target = e.currentTarget;
    beforeInputRef.current = {
      inputType: ne.inputType ?? null,
      start: target.selectionStart,
      end: target.selectionEnd,
    };
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextText = e.target.value;
    const afterStart = e.target.selectionStart;
    const afterEnd = e.target.selectionEnd;
    if (!selectedCue) return;

    // Suppress the immediately expected post-composition duplicate input.
    const expected = expectedCompositionEventRef.current;
    if (
      expected &&
      expected.cueId === selectedCue.id &&
      expected.text === nextText &&
      expected.start === afterStart &&
      expected.end === afterEnd
    ) {
      expectedCompositionEventRef.current = null;
      beforeInputRef.current = null;
      return;
    }

    if (composingRef.current) {
      updateCompositionPreview(selectedCue.id, nextText);
      return;
    }

    const before = beforeInputRef.current;
    beforeInputRef.current = null;
    // React/WebView2 may omit beforeinput for deletion, while input still has inputType.
    const op = makeTextOp({
      cueId: selectedCue.id,
      before: before ?? textSelectionRef.current ?? {
        start: afterStart,
        end: afterEnd,
      },
      after: { start: afterStart, end: afterEnd },
      inputType:
        before?.inputType ??
        (e.nativeEvent as InputEvent).inputType ??
        null,
      timestampMs: Date.now(),
    });
    textSelectionRef.current = { start: afterStart, end: afterEnd };
    applyTextEdit({ cueId: selectedCue.id, text: nextText, op });
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
    const textarea = textRef.current;
    beginComposition(
      selectedCue && textarea
        ? {
            cueId: selectedCue.id,
            start: textarea.selectionStart,
            end: textarea.selectionEnd,
            direction:
              (textarea.selectionDirection as
                | "forward"
                | "backward"
                | "none") ?? "none",
          }
        : null,
    );
  };

  const handleCompositionEnd = (
    e: React.CompositionEvent<HTMLTextAreaElement>,
  ) => {
    composingRef.current = false;
    beforeInputRef.current = null;
    if (!selectedCue) return;
    const target = e.currentTarget;
    const finalText = target.value;
    const selection = {
      start: target.selectionStart,
      end: target.selectionEnd,
    };
    endComposition({
      cueId: selectedCue.id,
      text: finalText,
      selection,
      timestampMs: Date.now(),
    });
    expectedCompositionEventRef.current = {
      cueId: selectedCue.id,
      text: finalText,
      start: selection.start,
      end: selection.end,
    };
    // Expire in next microtask so only the immediately following matching event is consumed.
    queueMicrotask(() => {
      expectedCompositionEventRef.current = null;
    });
  };

  const insertNewline = (target: HTMLTextAreaElement) => {
    if (!selectedCue) return;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const nextText = `${text.slice(0, start)}\n${text.slice(end)}`;
    const selection = { start: start + 1, end: start + 1 };
    applyTextEdit({
      cueId: selectedCue.id,
      text: nextText,
      op: makeTextOp({
        cueId: selectedCue.id,
        before: { start, end },
        after: selection,
        inputType: "insertLineBreak",
        timestampMs: Date.now(),
      }),
    });
    textSelectionRef.current = selection;
    setTextSelection({ cueId: selectedCue.id, ...selection, direction: "none" });
    window.setTimeout(() => {
      textRef.current?.focus();
      textRef.current?.setSelectionRange(selection.start, selection.end);
    }, 0);
  };

  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    textSelectionRef.current = {
      start: e.currentTarget.selectionStart,
      end: e.currentTarget.selectionEnd,
    };
    const localDef = findHotkey(e.nativeEvent, hotkeys, { local: true });
    if (!localDef) return;
    if (localDef.action === "discard-draft") {
      e.preventDefault();
      discardAndBlur(e.currentTarget);
      return;
    }
    if (localDef.action === "commit-and-next") {
      e.preventDefault();
      commitAndNext();
      return;
    }
    if (localDef.action === "insert-newline") {
      e.preventDefault();
      insertNewline(e.currentTarget);
    }
  };

  const handleTimeKeyDown =
    (field: TimeField) => (e: React.KeyboardEvent<HTMLInputElement>) => {
      const localDef = findHotkey(e.nativeEvent, hotkeys, { local: true });
      if (localDef?.action === "discard-draft") {
        e.preventDefault();
        discardAndBlur(e.currentTarget);
        return;
      }
      if (
        localDef?.action === "commit-and-next" ||
        localDef?.action === "insert-newline"
      ) {
        e.preventDefault();
        commitTimeDraft(field);
        e.currentTarget.blur();
        return;
      }

      if (e.nativeEvent.isComposing) return;

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
      const normalized = normalizeTimeInputValue(e.currentTarget.value);
      const caret = snapTimeInputCaret(
        e.currentTarget.selectionStart ?? 0,
        normalized,
      );
      setTimeValue(field, normalized);
      scheduleTimeCaret(field, caret);
    };

  const handleDelete = () => {
    if (!selectedCue) return;
    const before = useProjectStore.getState().cues;
    const next = selectCueAfterDelete(before, selectedCue.id);
    deleteCue(selectedCue.id);
    setSelectedCueId(next ? next.id : null);
    setPlayUntil(null);
    onNotify?.("info", "已删除字幕，可撤销");
  };

  const handleAdd = () => {
    const newCue: SubtitleCue | null = createCueAtPlayheadWithUniqueId(
      Math.round(usePlaybackStore.getState().currentTimeMs),
      useProjectStore.getState().cues,
    );
    if (!newCue) {
      acceptTextSession();
      onNotify?.("error", "新建字幕失败：无法生成唯一 ID");
      return;
    }
    addCue(newCue);
    setSelectedCueId(newCue.id);
  };

  const handleStyleChange = (style: string) => {
    if (!selectedCue) return;
    if (!hasBatchSelection) {
      updateCue(selectedCue.id, { style });
      return;
    }
    replaceCues(
      applySelectedCueStyle(
        useProjectStore.getState().cues,
        selectedCueIds,
        style,
      ),
    );
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
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-wrap items-end gap-2">
        <div className="min-w-[7.5rem] flex-1">
          <label className="mb-1 block text-xs text-text-muted">开始时间</label>
          <input
            ref={startTimeRef}
            type="text"
            value={startTime}
            onChange={handleTimeChange("start")}
            onBlur={() => handleTimeBlur("start")}
            onKeyDown={handleTimeKeyDown("start")}
            placeholder={TIME_INPUT_TEMPLATE}
            inputMode="numeric"
            {...{ [HISTORY_COMMAND_ATTR]: "true" }}
            className="w-full rounded border border-input bg-card px-2 py-1 font-mono text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>
        <div className="min-w-[7.5rem] flex-1">
          <label className="mb-1 block text-xs text-text-muted">结束时间</label>
          <input
            ref={endTimeRef}
            type="text"
            value={endTime}
            onChange={handleTimeChange("end")}
            onBlur={() => handleTimeBlur("end")}
            onKeyDown={handleTimeKeyDown("end")}
            placeholder={TIME_INPUT_TEMPLATE}
            inputMode="numeric"
            {...{ [HISTORY_COMMAND_ATTR]: "true" }}
            className="w-full rounded border border-input bg-card px-2 py-1 font-mono text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>
        <div className="flex gap-2 pb-px">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAdd}
            title={formatActionShortcutTitle("新建字幕", "new-cue", hotkeys)}
          >
            新建
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            title={formatActionShortcutTitle("删除字幕", "delete-cue", hotkeys)}
          >
            删除
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-end gap-2">
        <div className="min-w-[8rem] flex-1">
          <label className="mb-1 block text-xs text-text-muted">样式</label>
          <Select
            value={selectedCue.style}
            onChange={handleStyleChange}
            options={styleOptions}
            placeholder=""
          />
        </div>
        <div className="min-w-[8rem] flex-[1.2]">
          <label className="mb-1 block text-xs text-text-muted">字体</label>
          <FontComboBox
            value={quickFontName}
            onCommit={handleFontChange}
            options={fontNames}
            placeholder={fontNames.length > 0 ? "字体" : "字体（加载中）"}
          />
        </div>
        <div className="w-[4.5rem] shrink-0">
          <label className="mb-1 block text-xs text-text-muted">字号</label>
          <input
            type="number"
            min="1"
            max="200"
            value={quickFontSize}
            onFocus={() => {
              quickFontSizeBaselineRef.current = quickFontSize;
            }}
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
        <div className="flex flex-wrap gap-1.5 pb-px" aria-label="快速样式标签">
          <Button
            type="button"
            variant="outline"
            onClick={() => applyToggleTag("{\\b1}", "{\\b0}")}
            className="h-9 w-9 px-0 font-bold"
            title="插入粗体标签"
          >
            B
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => applyToggleTag("{\\i1}", "{\\i0}")}
            className="h-9 w-9 px-0 italic"
            title="插入斜体标签"
          >
            I
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => applyToggleTag("{\\u1}", "{\\u0}")}
            className="h-9 w-9 px-0 underline"
            title="插入下划线标签"
          >
            U
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => applyToggleTag("{\\s1}", "{\\s0}")}
            className="h-9 w-9 px-0 line-through"
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

      <div className="flex min-h-0 flex-1 flex-col">
        <label className="mb-1 shrink-0 text-xs text-text-muted">字幕</label>
        <textarea
          ref={textRef}
          value={text}
          onChange={handleTextChange}
          onBeforeInput={handleBeforeInput}
          onBlur={handleBlur}
          onSelect={syncSelectionFromTextarea}
          onKeyDown={handleTextKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          {...{ [HISTORY_COMMAND_ATTR]: "true" }}
          className="h-full min-h-0 w-full flex-1 resize-none rounded border border-input bg-card px-2 py-1 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
    </div>
  );
});
