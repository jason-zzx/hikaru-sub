import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { getCueDisplay } from "@hikaru/ass-core";
import { useSubtitleMergeMode } from "../../hooks/useSubtitleMergeMode";
import {
  copyCueRows,
  deleteCuesById,
  duplicateCues,
  getCueRowClipboard,
  hasCueRowClipboard,
  insertCueRelative,
  mergeSelectedCues,
  pasteCueRows,
  setCueRowClipboard,
  splitCueAtTime,
  swapSelectedCues,
  type CueListActionResult,
} from "../../services/editorActions";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import type { SubtitleCue } from "../../types";
import type { EditorToastVariant } from "./EditorToast";

type SubtitleListNotify = (variant: EditorToastVariant, text: string) => void;

interface SubtitleListProps {
  onNotify?: SubtitleListNotify;
}

interface ContextMenuState {
  x: number;
  y: number;
  targetId: string;
  selectedCueIds: string[];
}

export function SubtitleList({ onNotify }: SubtitleListProps) {
  const cues = useProjectStore((s) => s.cues);
  const replaceCues = useProjectStore((s) => s.replaceCues);
  const assStyles = useProjectStore((s) => s.assStyles);
  const mergeMode = useSubtitleMergeMode();
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const selectedCueIds = usePlaybackStore((s) => s.selectedCueIds);
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const setSelectedCueId = usePlaybackStore((s) => s.setSelectedCueId);
  const setSelectedCueIds = usePlaybackStore((s) => s.setSelectedCueIds);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const setPlayUntil = usePlaybackStore((s) => s.setPlayUntil);
  const knownStyleNames = new Set(assStyles.map((style) => style.name));

  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const applyCueListResult = (result: CueListActionResult | null): boolean => {
    if (!result) return false;
    replaceCues(result.cues);
    setSelectedCueIds(result.selectedCueIds);
    const nextSelected = result.cues.find((cue) =>
      result.selectedCueIds.includes(cue.id),
    );
    if (nextSelected) setCurrentTime(nextSelected.startMs);
    setPlayUntil(null);
    return true;
  };

  const selectCueRange = (targetId: string): string[] | null => {
    const anchorId = selectionAnchorId ?? selectedCueId;
    const anchorIndex = anchorId ? cues.findIndex((cue) => cue.id === anchorId) : -1;
    const targetIndex = cues.findIndex((cue) => cue.id === targetId);
    if (anchorIndex < 0 || targetIndex < 0) return null;

    const startIndex = Math.min(anchorIndex, targetIndex);
    const endIndex = Math.max(anchorIndex, targetIndex);
    const range = cues.slice(startIndex, endIndex + 1).map((cue) => cue.id);
    return targetIndex >= anchorIndex ? range : range.reverse();
  };

  const handleCueClick = (
    cue: SubtitleCue,
    event: MouseEvent<HTMLDivElement>,
  ) => {
    setContextMenu(null);

    if (event.shiftKey) {
      event.preventDefault();
      const range = selectCueRange(cue.id);
      if (range) {
        setSelectedCueIds(range);
      } else {
        setSelectedCueId(cue.id);
        setSelectionAnchorId(cue.id);
      }
    } else if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const selectedSet = new Set(selectedCueIds);
      if (selectedSet.has(cue.id)) {
        selectedSet.delete(cue.id);
      } else {
        selectedSet.add(cue.id);
      }
      setSelectedCueIds([...selectedSet]);
      setSelectionAnchorId(cue.id);
    } else {
      setSelectedCueId(cue.id);
      setSelectionAnchorId(cue.id);
    }

    setCurrentTime(cue.startMs);
    setPlayUntil(null);
  };

  const handleCueContextMenu = (
    cue: SubtitleCue,
    event: MouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const isSelected = selectedCueIds.includes(cue.id);
    const menuSelectionIds = isSelected ? selectedCueIds : [cue.id];
    if (!isSelected) setSelectedCueId(cue.id);
    setSelectionAnchorId(cue.id);
    setPlayUntil(null);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      targetId: cue.id,
      selectedCueIds: menuSelectionIds,
    });
  };

  const getActionSelectionIds = () => {
    if (contextMenu) return contextMenu.selectedCueIds;
    if (selectedCueIds.length > 0) return selectedCueIds;
    return selectedCueId ? [selectedCueId] : [];
  };

  const getActionTargetId = () => contextMenu?.targetId ?? selectedCueId;

  const runMenuAction = (action: () => boolean, failureText: string) => {
    setContextMenu(null);
    if (!action()) onNotify?.("error", failureText);
  };

  const copySelectedRows = (): boolean => {
    const copied = copyCueRows(cues, getActionSelectionIds());
    if (copied.length === 0) return false;
    setCueRowClipboard(copied);
    onNotify?.("info", `已复制 ${copied.length} 行字幕`);
    return true;
  };

  const cutSelectedRows = (): boolean => {
    const selectionIds = getActionSelectionIds();
    const copied = copyCueRows(cues, selectionIds);
    if (copied.length === 0) return false;
    setCueRowClipboard(copied);
    return applyCueListResult(deleteCuesById(cues, selectionIds));
  };

  const pasteRows = (): boolean =>
    applyCueListResult(pasteCueRows(cues, getCueRowClipboard(), getActionTargetId()));

  const targetCue = cues.find((cue) => cue.id === getActionTargetId()) ?? null;
  const canSplitTarget =
    !!targetCue &&
    currentTimeMs > targetCue.startMs &&
    currentTimeMs < targetCue.endMs;
  const actionSelectionIds = getActionSelectionIds();

  if (cues.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        暂无字幕
      </div>
    );
  }

  return (
    <div ref={listRef} className="h-full overflow-auto select-none">
      <div className="space-y-1 p-2">
        {cues.map((cue, index) => {
          const display = getCueDisplay(cue, mergeMode);
          const isSelected =
            selectedCueIds.includes(cue.id) || cue.id === selectedCueId;
          const styleMissing =
            assStyles.length > 0 && !knownStyleNames.has(cue.style);
          return (
            <div
              key={cue.id}
              ref={cue.id === selectedCueId ? selectedRef : null}
              onClick={(event) => handleCueClick(cue, event)}
              onContextMenu={(event) => handleCueContextMenu(cue, event)}
              className={`cursor-pointer rounded border px-3 py-2 transition-colors ${
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-surface-overlay"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-text-muted">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0">#{index + 1}</span>
                  <span
                    title={cue.style}
                    className={`max-w-[6.5rem] truncate rounded-full border px-1.5 py-px text-[10px] leading-tight ${
                      styleMissing
                        ? "border-warning/50 bg-warning/10 text-warning"
                        : "border-border bg-muted text-text-muted"
                    }`}
                  >
                    {cue.style}
                  </span>
                </div>
                <span className="shrink-0">
                  {formatTime(cue.startMs)} → {formatTime(cue.endMs)}
                </span>
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

      {contextMenu ? (
        <div
          className="fixed z-50 min-w-44 rounded border border-border bg-surface-raised py-1 text-sm text-text shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <MenuButton
            onClick={() =>
              runMenuAction(
                () =>
                  applyCueListResult(
                    insertCueRelative(cues, contextMenu.targetId, "before"),
                  ),
                "无法在该位置插入字幕",
              )
            }
          >
            插入（之前）
          </MenuButton>
          <MenuButton
            onClick={() =>
              runMenuAction(
                () =>
                  applyCueListResult(
                    insertCueRelative(cues, contextMenu.targetId, "after"),
                  ),
                "无法在该位置插入字幕",
              )
            }
          >
            插入（之后）
          </MenuButton>
          <MenuButton
            onClick={() =>
              runMenuAction(
                () =>
                  applyCueListResult(duplicateCues(cues, actionSelectionIds)),
                "无法重复所选字幕",
              )
            }
          >
            重复行
          </MenuButton>
          <MenuButton
            disabled={!canSplitTarget}
            onClick={() =>
              runMenuAction(
                () =>
                  applyCueListResult(
                    splitCueAtTime(
                      cues,
                      contextMenu.targetId,
                      currentTimeMs,
                    ),
                  ),
                "当前帧不在该字幕范围内",
              )
            }
          >
            在当前帧后分割行
          </MenuButton>
          <MenuButton
            onClick={() =>
              runMenuAction(
                () =>
                  applyCueListResult(deleteCuesById(cues, actionSelectionIds)),
                "无法删除所选字幕",
              )
            }
          >
            删除行
          </MenuButton>

          <MenuSeparator />

          <MenuButton
            onClick={() =>
              runMenuAction(copySelectedRows, "没有可复制的字幕行")
            }
          >
            复制行
          </MenuButton>
          <MenuButton
            onClick={() =>
              runMenuAction(cutSelectedRows, "没有可剪切的字幕行")
            }
          >
            剪切行
          </MenuButton>
          <MenuButton
            disabled={!hasCueRowClipboard()}
            onClick={() => runMenuAction(pasteRows, "没有可粘贴的字幕行")}
          >
            粘贴行
          </MenuButton>

          <MenuSeparator />

          <MenuButton
            disabled={actionSelectionIds.length !== 2}
            onClick={() =>
              runMenuAction(
                () =>
                  applyCueListResult(swapSelectedCues(cues, actionSelectionIds)),
                "互换行需要刚好选中 2 行",
              )
            }
          >
            互换行
          </MenuButton>
          <MenuButton
            disabled={actionSelectionIds.length < 2}
            onClick={() =>
              runMenuAction(
                () =>
                  applyCueListResult(
                    mergeSelectedCues(cues, actionSelectionIds, "concat"),
                  ),
                "合并行需要至少选中 2 行",
              )
            }
          >
            合并（连接）
          </MenuButton>
          <MenuButton
            disabled={actionSelectionIds.length < 2}
            onClick={() =>
              runMenuAction(
                () =>
                  applyCueListResult(
                    mergeSelectedCues(cues, actionSelectionIds, "keep-first"),
                  ),
                "合并行需要至少选中 2 行",
              )
            }
          >
            合并（保留首行）
          </MenuButton>
        </div>
      ) : null}
    </div>
  );
}

interface MenuButtonProps {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}

function MenuButton({ children, disabled = false, onClick }: MenuButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-overlay hover:text-text focus:bg-surface-overlay focus:text-text disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function MenuSeparator() {
  return <div className="my-1 border-t border-border" />;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}
