import { createId as createAssId } from "@hikaru/ass-core";
import { usePlaybackStore } from "../stores/playbackStore";
import type { SubtitleCue } from "../types";

/** 选中指定 cue 并 seek 到起点；用户主动切换会中断「播放当前句」。 */
export function selectCueAndSeek(cue: SubtitleCue | null) {
  if (!cue) return;
  const pb = usePlaybackStore.getState();
  pb.setSelectedCueId(cue.id);
  pb.setCurrentTime(cue.startMs);
  pb.setPlayUntil(null);
}

/**
 * 按列表顺序选择相邻字幕；offset 越界时收在首/末条（±Infinity 即跳首/末）。
 * 未选中时从第一条开始；空列表返回 null。
 */
export function selectCueByOffset(
  cues: SubtitleCue[],
  selectedId: string | null,
  offset: number,
): SubtitleCue | null {
  if (cues.length === 0) return null;
  const idx = selectedId ? cues.findIndex((c) => c.id === selectedId) : -1;
  if (idx < 0) return cues[0];
  const next = Math.max(0, Math.min(cues.length - 1, idx + offset));
  return cues[next];
}

/**
 * 边界跳转：全部 cue 的开始/结束时间点排序去重后，
 * 找当前位置前/后最近的边界；1ms 容差避免帧中心 seek 后原地踏步。
 */
export function findSubtitleBoundary(
  cues: SubtitleCue[],
  currentMs: number,
  direction: -1 | 1,
): number | null {
  if (cues.length === 0) return null;
  const boundaries = [...new Set(cues.flatMap((c) => [c.startMs, c.endMs]))].sort(
    (a, b) => a - b,
  );
  if (direction > 0) {
    return boundaries.find((b) => b > currentMs + 1) ?? null;
  }
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (boundaries[i] < currentMs - 1) return boundaries[i];
  }
  return null;
}

/** 帧步进：取目标帧中心时间避免边界抖动；fps 无效时按 30fps 回退。
 *  用 floor 而非 round：从帧中心前进/后退恰好落在相邻帧中心，不跳帧、不卡死。 */
export function frameStepTarget(
  currentMs: number,
  fps: number | null,
  frames: number,
  durationMs: number,
): number {
  const effectiveFps = fps && fps > 0 ? fps : 30;
  const frameIdx = Math.floor((currentMs * effectiveFps) / 1000);
  const targetMs = ((frameIdx + frames + 0.5) * 1000) / effectiveFps;
  return Math.max(0, Math.min(durationMs, targetMs));
}

export type CreateIdFn = () => string;

export interface TimelineLaneItem {
  cue: SubtitleCue;
  lane: number;
}

export type TimelineDragEdge = "start" | "end";

export interface CueListActionResult {
  cues: SubtitleCue[];
  selectedCueIds: string[];
}

export type CueInsertPlacement = "before" | "after";
export type CueMergeMode = "concat" | "keep-first";

const DEFAULT_INSERT_DURATION_MS = 2000;

/**
 * 在现有 cue 列表中生成不撞车的 id；默认用 ass-core 的 createId，最多重试 3 次。
 * 3 次仍撞车时返回 null，调用方应放弃新增并提示用户。
 */
export function createUniqueCueId(
  existingCues: SubtitleCue[],
  createIdFn: CreateIdFn = createAssId,
  maxAttempts = 3,
): string | null {
  const existingIds = new Set(existingCues.map((cue) => cue.id));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const id = createIdFn();
    if (!existingIds.has(id)) return id;
  }
  return null;
}

export function assignCueLanes(cues: SubtitleCue[]): TimelineLaneItem[] {
  const indexed = cues.map((cue, index) => ({ cue, index }));
  indexed.sort((a, b) => {
    if (a.cue.startMs !== b.cue.startMs) return a.cue.startMs - b.cue.startMs;
    return a.index - b.index;
  });

  const laneEnds: number[] = [];
  return indexed.map(({ cue }) => {
    let lane = laneEnds.findIndex((endMs) => cue.startMs >= endMs);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(cue.endMs);
    } else {
      laneEnds[lane] = cue.endMs;
    }
    return { cue, lane };
  });
}

function clampTimeMs(ms: number, durationMs: number): number {
  const max = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : Infinity;
  return Math.max(0, Math.min(Math.round(ms), max));
}

export function normalizeBoundaryDrag(
  cue: SubtitleCue,
  edge: TimelineDragEdge,
  rawMs: number,
  durationMs: number,
): Pick<SubtitleCue, "startMs" | "endMs"> {
  const draggedMs = clampTimeMs(rawMs, durationMs);
  if (edge === "start") {
    return draggedMs <= cue.endMs
      ? { startMs: draggedMs, endMs: cue.endMs }
      : { startMs: cue.endMs, endMs: draggedMs };
  }
  return draggedMs >= cue.startMs
    ? { startMs: cue.startMs, endMs: draggedMs }
    : { startMs: draggedMs, endMs: cue.startMs };
}

function cueIndexesById(cues: SubtitleCue[], ids: string[]): number[] {
  const idSet = new Set(ids);
  return cues
    .map((cue, index) => (idSet.has(cue.id) ? index : -1))
    .filter((index) => index >= 0);
}

function makeInheritedEmptyCue(
  base: SubtitleCue,
  id: string,
  placement: CueInsertPlacement,
): SubtitleCue {
  if (placement === "before") {
    return {
      id,
      startMs: Math.max(0, base.startMs - DEFAULT_INSERT_DURATION_MS),
      endMs: base.startMs,
      primaryText: "",
      secondaryText: undefined,
      style: base.style,
      layer: base.layer,
    };
  }
  return {
    id,
    startMs: base.endMs,
    endMs: base.endMs + DEFAULT_INSERT_DURATION_MS,
    primaryText: "",
    secondaryText: undefined,
    style: base.style,
    layer: base.layer,
  };
}

function cloneCueWithId(cue: SubtitleCue, id: string): SubtitleCue {
  return { ...cue, id };
}

function joinCueTexts(values: Array<string | undefined>): string | undefined {
  const nonEmpty = values.filter((value): value is string => !!value);
  return nonEmpty.length > 0 ? nonEmpty.join("") : undefined;
}

export function insertCueRelative(
  cues: SubtitleCue[],
  targetId: string,
  placement: CueInsertPlacement,
  createIdFn?: CreateIdFn,
): CueListActionResult | null {
  const targetIndex = cues.findIndex((cue) => cue.id === targetId);
  if (targetIndex < 0) return null;
  const id = createUniqueCueId(cues, createIdFn);
  if (!id) return null;
  const created = makeInheritedEmptyCue(cues[targetIndex], id, placement);
  const insertIndex = placement === "before" ? targetIndex : targetIndex + 1;
  const next = [...cues.slice(0, insertIndex), created, ...cues.slice(insertIndex)];
  return { cues: next, selectedCueIds: [id] };
}

export function duplicateCues(
  cues: SubtitleCue[],
  selectedIds: string[],
  createIdFn?: CreateIdFn,
): CueListActionResult | null {
  const indexes = cueIndexesById(cues, selectedIds);
  if (indexes.length === 0) return null;
  const selectedIndexSet = new Set(indexes);
  const next: SubtitleCue[] = [];
  const duplicatedIds: string[] = [];
  const existingAndCreated: SubtitleCue[] = [...cues];

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    next.push(cue);
    if (!selectedIndexSet.has(index)) continue;
    const id = createUniqueCueId(existingAndCreated, createIdFn);
    if (!id) return null;
    const duplicated = cloneCueWithId(cue, id);
    existingAndCreated.push(duplicated);
    next.push(duplicated);
    duplicatedIds.push(id);
  }

  return { cues: next, selectedCueIds: duplicatedIds };
}

export function splitCueAtTime(
  cues: SubtitleCue[],
  targetId: string,
  splitMs: number,
  createIdFn?: CreateIdFn,
): CueListActionResult | null {
  const targetIndex = cues.findIndex((cue) => cue.id === targetId);
  if (targetIndex < 0) return null;
  const target = cues[targetIndex];
  const roundedSplit = Math.round(splitMs);
  if (roundedSplit <= target.startMs || roundedSplit >= target.endMs) return null;
  const id = createUniqueCueId(cues, createIdFn);
  if (!id) return null;
  const first = { ...target, endMs: roundedSplit };
  const second = { ...target, id, startMs: roundedSplit };
  const next = [
    ...cues.slice(0, targetIndex),
    first,
    second,
    ...cues.slice(targetIndex + 1),
  ];
  return { cues: next, selectedCueIds: [id] };
}

export function deleteCuesById(
  cues: SubtitleCue[],
  selectedIds: string[],
): CueListActionResult {
  const indexes = cueIndexesById(cues, selectedIds);
  if (indexes.length === 0) return { cues, selectedCueIds: [] };
  const firstIndex = Math.min(...indexes);
  const selectedSet = new Set(selectedIds);
  const next = cues.filter((cue) => !selectedSet.has(cue.id));
  const nextSelection = next[Math.min(firstIndex, next.length - 1)]?.id;
  return { cues: next, selectedCueIds: nextSelection ? [nextSelection] : [] };
}

export function swapSelectedCues(
  cues: SubtitleCue[],
  selectedIds: string[],
): CueListActionResult | null {
  const indexes = cueIndexesById(cues, selectedIds);
  if (indexes.length !== 2) return null;
  const [firstIndex, secondIndex] = indexes;
  const next = [...cues];
  [next[firstIndex], next[secondIndex]] = [next[secondIndex], next[firstIndex]];
  return {
    cues: next,
    selectedCueIds: [next[firstIndex].id, next[secondIndex].id],
  };
}

export function mergeSelectedCues(
  cues: SubtitleCue[],
  selectedIds: string[],
  mode: CueMergeMode,
): CueListActionResult | null {
  const indexes = cueIndexesById(cues, selectedIds);
  if (indexes.length < 2) return null;
  const selected = indexes.map((index) => cues[index]);
  const first = selected[0];
  const merged: SubtitleCue = {
    ...first,
    startMs: Math.min(...selected.map((cue) => cue.startMs)),
    endMs: Math.max(...selected.map((cue) => cue.endMs)),
  };

  if (mode === "concat") {
    merged.primaryText = joinCueTexts(selected.map((cue) => cue.primaryText)) ?? "";
    merged.secondaryText = joinCueTexts(selected.map((cue) => cue.secondaryText));
  }

  const selectedSet = new Set(selectedIds);
  const firstSelectedIndex = indexes[0];
  const next = cues.filter(
    (cue, index) => index === firstSelectedIndex || !selectedSet.has(cue.id),
  );
  const mergedIndex = next.findIndex((cue) => cue.id === first.id);
  next[mergedIndex] = merged;
  return { cues: next, selectedCueIds: [merged.id] };
}

export function copyCueRows(
  cues: SubtitleCue[],
  selectedIds: string[],
): SubtitleCue[] {
  const selectedSet = new Set(selectedIds);
  return cues.filter((cue) => selectedSet.has(cue.id)).map((cue) => ({ ...cue }));
}

export function pasteCueRows(
  cues: SubtitleCue[],
  clipboardCues: SubtitleCue[],
  targetId: string | null,
  createIdFn?: CreateIdFn,
): CueListActionResult | null {
  if (clipboardCues.length === 0) return null;
  const targetIndex = targetId
    ? cues.findIndex((cue) => cue.id === targetId)
    : cues.length - 1;
  const insertIndex = targetIndex >= 0 ? targetIndex + 1 : cues.length;
  const existingAndCreated = [...cues];
  const pasted: SubtitleCue[] = [];

  for (const cue of clipboardCues) {
    const id = createUniqueCueId(existingAndCreated, createIdFn);
    if (!id) return null;
    const nextCue = cloneCueWithId(cue, id);
    existingAndCreated.push(nextCue);
    pasted.push(nextCue);
  }

  return {
    cues: [...cues.slice(0, insertIndex), ...pasted, ...cues.slice(insertIndex)],
    selectedCueIds: pasted.map((cue) => cue.id),
  };
}

let cueRowClipboard: SubtitleCue[] = [];

export function setCueRowClipboard(cues: SubtitleCue[]): void {
  cueRowClipboard = cues.map((cue) => ({ ...cue }));
}

export function getCueRowClipboard(): SubtitleCue[] {
  return cueRowClipboard.map((cue) => ({ ...cue }));
}

export function hasCueRowClipboard(): boolean {
  return cueRowClipboard.length > 0;
}

function buildAppendedCue(cue: SubtitleCue, id: string): SubtitleCue {
  return {
    id,
    startMs: cue.endMs,
    endMs: cue.endMs + 2000,
    primaryText: "",
    secondaryText: undefined,
    style: cue.style,
    layer: cue.layer,
  };
}

function buildCueAtPlayhead(currentTimeMs: number, id: string): SubtitleCue {
  return {
    id,
    startMs: currentTimeMs,
    endMs: currentTimeMs + 2000,
    primaryText: "新建字幕",
    secondaryText: undefined,
    style: "Primary",
    layer: 0,
  };
}

/** Enter 在最后一条时的追加行：起点接当前行结束，时长 2s，文本空，继承样式与 layer。 */
export function appendCueAfter(cue: SubtitleCue): SubtitleCue {
  return buildAppendedCue(cue, createAssId());
}

export function appendCueAfterWithUniqueId(
  cue: SubtitleCue,
  existingCues: SubtitleCue[],
  createIdFn?: CreateIdFn,
): SubtitleCue | null {
  const id = createUniqueCueId(existingCues, createIdFn);
  return id ? buildAppendedCue(cue, id) : null;
}

/** Insert 新建：沿用现有新建参数（2s、占位文本、Primary、layer 0）。 */
export function createCueAtPlayhead(currentTimeMs: number): SubtitleCue {
  return buildCueAtPlayhead(currentTimeMs, createAssId());
}

export function createCueAtPlayheadWithUniqueId(
  currentTimeMs: number,
  existingCues: SubtitleCue[],
  createIdFn?: CreateIdFn,
): SubtitleCue | null {
  const id = createUniqueCueId(existingCues, createIdFn);
  return id ? buildCueAtPlayhead(currentTimeMs, id) : null;
}

/**
 * 删除后的选中策略：删中间行选原位置的下一行；删末行选新的末行；
 * 删唯一行或找不到 id 时返回 null。
 */
export function selectCueAfterDelete(
  cuesBeforeDelete: SubtitleCue[],
  deletedId: string,
): SubtitleCue | null {
  const idx = cuesBeforeDelete.findIndex((cue) => cue.id === deletedId);
  if (idx < 0) return null;

  const remaining = cuesBeforeDelete.filter((cue) => cue.id !== deletedId);
  return remaining[Math.min(idx, remaining.length - 1)] ?? null;
}

export type CommitFollowUp =
  | { kind: "select"; cue: SubtitleCue }
  | { kind: "append"; base: SubtitleCue }
  | { kind: "none" };

/** Enter 提交后的去向：中间行 → 下一条；最后一条 → 追加；找不到 → 无动作。 */
export function nextAfterCommit(
  cues: SubtitleCue[],
  committedId: string,
): CommitFollowUp {
  const idx = cues.findIndex((c) => c.id === committedId);
  if (idx < 0) return { kind: "none" };
  if (idx === cues.length - 1) return { kind: "append", base: cues[idx] };
  return { kind: "select", cue: cues[idx + 1] };
}
