import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useUiStore } from "../stores/uiStore";
import { findHotkey, type EditorActionId } from "../components/editor/hotkeys";
import {
  createCueAtPlayheadWithUniqueId,
  findSubtitleBoundary,
  frameStepTarget,
  selectCueAfterDelete,
  selectCueByOffset,
} from "../services/editorActions";
import type { SubtitleCue } from "../types";

const FAST_JUMP_FRAMES = 10;
const PAGE_JUMP_CUES = 10;

export interface EditorHotkeyOptions {
  onSave: () => void;
  onToggleHelp: () => void;
  onNotify?: (variant: "success" | "error" | "info", text: string) => void;
  enabled?: boolean;
}

/** 选中指定 cue 并 seek 到起点；用户主动切换会中断「播放当前句」。 */
function selectAndSeek(cue: SubtitleCue | null) {
  if (!cue) return;
  const pb = usePlaybackStore.getState();
  pb.setSelectedCueId(cue.id);
  pb.setCurrentTime(cue.startMs);
  pb.setPlayUntil(null);
}

/**
 * actionId → 动作实现。通过 zustand getState 取实时状态，无闭包过期问题；
 * 独立导出便于在 node 环境直接测试。
 */
export function buildEditorActions(
  options: EditorHotkeyOptions,
): Partial<Record<EditorActionId, () => void>> {
  const nav = (offset: number) => {
    const { cues } = useProjectStore.getState();
    const { selectedCueId } = usePlaybackStore.getState();
    selectAndSeek(selectCueByOffset(cues, selectedCueId, offset));
  };

  const frameStep = (frames: number) => {
    const pb = usePlaybackStore.getState();
    pb.setCurrentTime(
      frameStepTarget(pb.currentTimeMs, pb.fps, frames, pb.durationMs),
    );
  };

  const boundaryJump = (direction: -1 | 1) => {
    const { cues } = useProjectStore.getState();
    const pb = usePlaybackStore.getState();
    const target = findSubtitleBoundary(cues, pb.currentTimeMs, direction);
    if (target !== null) pb.setCurrentTime(target);
  };

  const stamp = (field: "startMs" | "endMs") => {
    const { selectedCueId, currentTimeMs } = usePlaybackStore.getState();
    if (!selectedCueId) return;
    useProjectStore
      .getState()
      .updateCue(selectedCueId, { [field]: Math.round(currentTimeMs) });
  };

  const playSegment = () => {
    const pb = usePlaybackStore.getState();
    if (pb.isPlaying && pb.playUntilMs !== null) {
      pb.setPlaying(false); // setPlaying(false) 内清除 playUntilMs
      return;
    }
    const cue = useProjectStore
      .getState()
      .cues.find((c) => c.id === pb.selectedCueId);
    if (!cue) return;
    pb.setCurrentTime(cue.startMs);
    pb.setPlayUntil(cue.endMs);
    pb.setPlaying(true);
  };

  const newCue = () => {
    const pb = usePlaybackStore.getState();
    const cues = useProjectStore.getState().cues;
    const created = createCueAtPlayheadWithUniqueId(
      Math.round(pb.currentTimeMs),
      cues,
    );
    if (!created) {
      options.onNotify?.("error", "新建字幕失败：无法生成唯一 ID");
      return;
    }
    useProjectStore.getState().addCue(created);
    pb.setSelectedCueId(created.id);
    pb.setPlayUntil(null);
    useUiStore.getState().requestEditorFocus();
  };

  const deleteCue = () => {
    const pb = usePlaybackStore.getState();
    if (!pb.selectedCueId) return;
    const before = useProjectStore.getState().cues;
    const next = selectCueAfterDelete(before, pb.selectedCueId);
    if (!before.some((cue) => cue.id === pb.selectedCueId)) return;
    useProjectStore.getState().deleteCue(pb.selectedCueId);
    pb.setSelectedCueId(next ? next.id : null);
    pb.setPlayUntil(null);
    options.onNotify?.("info", "已删除字幕，可按 Ctrl+Z 撤销");
  };

  return {
    "select-prev": () => nav(-1),
    "select-next": () => nav(1),
    "select-first": () => nav(-Infinity),
    "select-last": () => nav(Infinity),
    "select-page-up": () => nav(-PAGE_JUMP_CUES),
    "select-page-down": () => nav(PAGE_JUMP_CUES),
    "toggle-play": () => {
      const pb = usePlaybackStore.getState();
      pb.setPlaying(!pb.isPlaying);
    },
    "frame-prev": () => frameStep(-1),
    "frame-next": () => frameStep(1),
    "frame-fast-prev": () => frameStep(-FAST_JUMP_FRAMES),
    "frame-fast-next": () => frameStep(FAST_JUMP_FRAMES),
    "boundary-prev": () => boundaryJump(-1),
    "boundary-next": () => boundaryJump(1),
    "play-segment": playSegment,
    "stamp-start": () => stamp("startMs"),
    "stamp-end": () => stamp("endMs"),
    "new-cue": newCue,
    "delete-cue": deleteCue,
    save: () => options.onSave(),
    undo: () => useProjectStore.getState().undo(),
    redo: () => useProjectStore.getState().redo(),
    "toggle-help": () => options.onToggleHelp(),
  };
}

/** 编辑页快捷键分发器：单一 window keydown 监听，卸载时移除。enabled=false 时短路全部快捷键。 */
export function useEditorHotkeys(options: EditorHotkeyOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const actions = buildEditorActions({
      onSave: () => optionsRef.current.onSave(),
      onToggleHelp: () => optionsRef.current.onToggleHelp(),
      onNotify: (variant, text) => optionsRef.current.onNotify?.(variant, text),
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (optionsRef.current.enabled === false) return;
      const def = findHotkey(e);
      if (!def) return;
      e.preventDefault();
      actions[def.action]?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
