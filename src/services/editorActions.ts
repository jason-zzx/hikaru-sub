import { createId as createAssId } from "@hikaru/ass-core";
import type { SubtitleCue } from "../types";

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
