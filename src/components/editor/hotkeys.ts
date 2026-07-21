import type { EditorHotkeyOverride } from "../../types";

export type HotkeyScope =
  | "global"
  | "outside-input"
  | "inside-input"
  /** Project undo/redo: outside inputs, or inside marked persistent cue-edit controls. */
  | "history-command";

/** data-attribute marking persistent cue-edit controls that consume project history. */
export const HISTORY_COMMAND_ATTR = "data-history-command";

export type EditorActionId =
  | "select-prev"
  | "select-next"
  | "select-first"
  | "select-last"
  | "select-page-up"
  | "select-page-down"
  | "toggle-play"
  | "frame-prev"
  | "frame-next"
  | "frame-fast-prev"
  | "frame-fast-next"
  | "boundary-prev"
  | "boundary-next"
  | "play-segment"
  | "stamp-start"
  | "stamp-end"
  | "new-cue"
  | "delete-cue"
  | "copy-cues"
  | "cut-cues"
  | "paste-cues"
  | "select-all-cues"
  | "commit-and-next"
  | "insert-newline"
  | "discard-draft"
  | "save"
  | "undo"
  | "redo"
  | "toggle-help"
  | "open-find";

export interface HotkeyDef {
  /** Stable persistence ID. */
  id: string;
  /** KeyboardEvent.key（单字符统一小写比较；命名键如 ArrowUp 原样） */
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  scope: HotkeyScope;
  action: EditorActionId;
  description: string;
  category: "导航" | "播放" | "打点" | "编辑" | "系统";
  /** 由组件本地处理（需要草稿状态），分发器跳过 */
  handledLocally?: boolean;
}

export type HotkeyBinding = Pick<HotkeyDef, "key" | "ctrl" | "alt" | "shift">;

export const EDITOR_HOTKEYS: HotkeyDef[] = [
  // 导航与选择
  { id: "select-prev", key: "ArrowUp", scope: "outside-input", action: "select-prev", description: "选中上一条字幕", category: "导航" },
  { id: "select-next", key: "ArrowDown", scope: "outside-input", action: "select-next", description: "选中下一条字幕", category: "导航" },
  { id: "select-prev-alt", key: "ArrowUp", alt: true, scope: "global", action: "select-prev", description: "选中上一条（编辑框内可用）", category: "导航" },
  { id: "select-next-alt", key: "ArrowDown", alt: true, scope: "global", action: "select-next", description: "选中下一条（编辑框内可用）", category: "导航" },
  { id: "select-first", key: "Home", scope: "outside-input", action: "select-first", description: "跳到第一条", category: "导航" },
  { id: "select-last", key: "End", scope: "outside-input", action: "select-last", description: "跳到最后一条", category: "导航" },
  { id: "select-page-up", key: "PageUp", scope: "outside-input", action: "select-page-up", description: "向上跳 10 条", category: "导航" },
  { id: "select-page-down", key: "PageDown", scope: "outside-input", action: "select-page-down", description: "向下跳 10 条", category: "导航" },
  // 播放头控制
  { id: "toggle-play-space", key: " ", scope: "outside-input", action: "toggle-play", description: "播放 / 暂停", category: "播放" },
  { id: "toggle-play-ctrl-p", key: "p", ctrl: true, scope: "global", action: "toggle-play", description: "播放 / 暂停（编辑框内可用）", category: "播放" },
  { id: "frame-prev", key: "ArrowLeft", scope: "outside-input", action: "frame-prev", description: "上一帧", category: "播放" },
  { id: "frame-next", key: "ArrowRight", scope: "outside-input", action: "frame-next", description: "下一帧", category: "播放" },
  { id: "frame-fast-prev", key: "ArrowLeft", alt: true, scope: "outside-input", action: "frame-fast-prev", description: "快退 10 帧", category: "播放" },
  { id: "frame-fast-next", key: "ArrowRight", alt: true, scope: "outside-input", action: "frame-fast-next", description: "快进 10 帧", category: "播放" },
  { id: "boundary-prev", key: "ArrowLeft", ctrl: true, scope: "outside-input", action: "boundary-prev", description: "跳至上一个字幕边界", category: "播放" },
  { id: "boundary-next", key: "ArrowRight", ctrl: true, scope: "outside-input", action: "boundary-next", description: "跳至下一个字幕边界", category: "播放" },
  { id: "play-segment", key: "r", scope: "outside-input", action: "play-segment", description: "播放当前字幕段（再按中断）", category: "播放" },
  // 对轴打点
  { id: "stamp-start", key: "3", ctrl: true, scope: "global", action: "stamp-start", description: "播放位置写入开始时间", category: "打点" },
  { id: "stamp-end", key: "4", ctrl: true, scope: "global", action: "stamp-end", description: "播放位置写入结束时间", category: "打点" },
  // 编辑操作
  { id: "commit-and-next", key: "Enter", scope: "inside-input", action: "commit-and-next", description: "提交并跳到下一条（最后一条时追加新行）", category: "编辑", handledLocally: true },
  { id: "insert-newline", key: "Enter", shift: true, scope: "inside-input", action: "insert-newline", description: "插入换行", category: "编辑", handledLocally: true },
  { id: "discard-draft", key: "Escape", scope: "inside-input", action: "discard-draft", description: "放弃未提交草稿并失焦", category: "编辑", handledLocally: true },
  { id: "new-cue", key: "Insert", scope: "outside-input", action: "new-cue", description: "在播放头位置新建字幕", category: "编辑" },
  { id: "delete-cue", key: "Delete", scope: "outside-input", action: "delete-cue", description: "删除选中字幕（可撤销）", category: "编辑" },
  { id: "copy-cues", key: "c", ctrl: true, scope: "outside-input", action: "copy-cues", description: "复制选中字幕行", category: "编辑" },
  { id: "cut-cues", key: "x", ctrl: true, scope: "outside-input", action: "cut-cues", description: "剪切选中字幕行", category: "编辑" },
  { id: "paste-cues", key: "v", ctrl: true, scope: "outside-input", action: "paste-cues", description: "粘贴字幕行", category: "编辑" },
  { id: "select-all-cues", key: "a", ctrl: true, scope: "outside-input", action: "select-all-cues", description: "全选字幕行", category: "编辑" },
  // 系统
  { id: "save", key: "s", ctrl: true, scope: "global", action: "save", description: "保存", category: "系统" },
  { id: "undo", key: "z", ctrl: true, scope: "history-command", action: "undo", description: "撤销", category: "系统" },
  { id: "redo-ctrl-y", key: "y", ctrl: true, scope: "history-command", action: "redo", description: "重做", category: "系统" },
  { id: "redo-ctrl-shift-z", key: "z", ctrl: true, shift: true, scope: "history-command", action: "redo", description: "重做", category: "系统" },
  { id: "toggle-help", key: "?", shift: true, scope: "outside-input", action: "toggle-help", description: "键位速查", category: "系统" },
  { id: "open-find", key: "f", ctrl: true, scope: "global", action: "open-find", description: "打开查找 / 质检", category: "系统" },
];

/** 按 category 分组，保持键位表内出现顺序。 */
export function groupHotkeysByCategory(
  defs: readonly HotkeyDef[],
): Map<string, HotkeyDef[]> {
  const groups = new Map<string, HotkeyDef[]>();
  for (const def of defs) {
    const list = groups.get(def.category);
    if (list) list.push(def);
    else groups.set(def.category, [def]);
  }
  return groups;
}

/** 结构化事件类型：便于在 node 环境下不依赖 DOM 测试。 */
export interface HotkeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  target?: unknown;
}

/** input/textarea/contentEditable 视为「框内」。鸭子类型判断，测试无需真实 DOM。 */
export function isEditableTarget(target: unknown): boolean {
  const el = target as
    | { tagName?: string; isContentEditable?: boolean }
    | null
    | undefined;
  if (!el) return false;
  return (
    el.tagName === "TEXTAREA" ||
    el.tagName === "INPUT" ||
    el.isContentEditable === true
  );
}

/** True when the editable event target consumes project history commands. */
export function isHistoryCommandTarget(target: unknown): boolean {
  const el = target as
    | { getAttribute?: (name: string) => string | null }
    | null
    | undefined;
  return el?.getAttribute?.(HISTORY_COMMAND_ATTR) === "true";
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function isValidOverride(value: unknown): value is EditorHotkeyOverride {
  const override = value as Partial<EditorHotkeyOverride> | null;
  return (
    !!override &&
    typeof override.id === "string" &&
    typeof override.key === "string" &&
    override.key.length > 0 &&
    typeof override.ctrl === "boolean" &&
    typeof override.alt === "boolean" &&
    typeof override.shift === "boolean"
  );
}

export function canonicalizeHotkeyBinding(binding: HotkeyBinding): string {
  return `${normalizeKey(binding.key)}|${binding.ctrl ? 1 : 0}|${binding.alt ? 1 : 0}|${binding.shift ? 1 : 0}`;
}

export function isSameHotkeyBinding(
  left: HotkeyBinding,
  right: HotkeyBinding,
): boolean {
  return canonicalizeHotkeyBinding(left) === canonicalizeHotkeyBinding(right);
}

const KEY_LABELS: Record<string, string> = {
  " ": "空格",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Escape: "Esc",
};

export function formatHotkeyLabel(binding: HotkeyBinding): string {
  const keyLabel = KEY_LABELS[binding.key] ??
    (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  const modifiers = [
    binding.ctrl ? "Ctrl" : null,
    binding.alt ? "Alt" : null,
    binding.shift && binding.key !== "?" ? "Shift" : null,
  ].filter(Boolean);
  return [...modifiers, keyLabel].join("+");
}

export function applyEditorHotkeyOverrides(
  overrides: readonly EditorHotkeyOverride[] | null | undefined,
): HotkeyDef[] {
  if (!Array.isArray(overrides) || overrides.length === 0) return EDITOR_HOTKEYS;
  const knownIds = new Set(EDITOR_HOTKEYS.map((def) => def.id));
  const byId = new Map<string, EditorHotkeyOverride>();
  for (const override of overrides) {
    if (isValidOverride(override) && knownIds.has(override.id)) {
      byId.set(override.id, override);
    }
  }
  return EDITOR_HOTKEYS.map((def) => {
    const override = byId.get(def.id);
    return override
      ? {
          ...def,
          key: override.key,
          ctrl: override.ctrl,
          alt: override.alt,
          shift: override.shift,
        }
      : def;
  });
}

export interface HotkeyConflict {
  label: string;
  ids: string[];
}

export function findHotkeyConflicts(
  overrides: readonly EditorHotkeyOverride[] | null | undefined,
): HotkeyConflict[] {
  const bindings = new Map<string, HotkeyDef[]>();
  for (const def of applyEditorHotkeyOverrides(overrides)) {
    const key = canonicalizeHotkeyBinding(def);
    const existing = bindings.get(key);
    if (existing) existing.push(def);
    else bindings.set(key, [def]);
  }
  return [...bindings.values()]
    .filter((defs) => defs.length > 1)
    .map((defs) => ({
      label: formatHotkeyLabel(defs[0]),
      ids: defs.map((def) => def.id),
    }));
}

const IGNORED_RECORDING_KEYS = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Dead",
  "Meta",
  "Process",
  "Shift",
  "Unidentified",
]);

export function hotkeyOverrideFromEvent(
  id: string,
  event: Pick<HotkeyEventLike, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing">,
): EditorHotkeyOverride | null {
  if (event.isComposing || !event.key || IGNORED_RECORDING_KEYS.has(event.key)) {
    return null;
  }
  return {
    id,
    key: event.key,
    ctrl: event.ctrlKey || event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
}

export function hotkeyLabelsForAction(
  defs: readonly HotkeyDef[],
  action: EditorActionId,
): string[] {
  return defs
    .filter((def) => def.action === action)
    .map((def) => formatHotkeyLabel(def));
}

export function formatActionShortcutTitle(
  label: string,
  action: EditorActionId,
  defs: readonly HotkeyDef[],
): string {
  const labels = hotkeyLabelsForAction(defs, action);
  return labels.length > 0 ? `${label}（${labels.join(" / ")}）` : label;
}

/**
 * 在键位表中匹配事件；不匹配返回 null。
 * - IME 组词中（isComposing）一律不匹配
 * - metaKey 等价 ctrl（macOS）
 * - 默认跳过 handledLocally；local=true 时只匹配本地条目
 */
export function findHotkey(
  e: HotkeyEventLike,
  defs: readonly HotkeyDef[] = EDITOR_HOTKEYS,
  options: { local?: boolean } = {},
): HotkeyDef | null {
  if (e.isComposing) return null;
  const inEditable = isEditableTarget(e.target);
  const ctrl = e.ctrlKey || e.metaKey;
  const key = normalizeKey(e.key);

  for (const def of defs) {
    if (!!def.handledLocally !== !!options.local) continue;
    if (normalizeKey(def.key) !== key) continue;
    if (!!def.ctrl !== ctrl) continue;
    if (!!def.alt !== e.altKey) continue;
    if (!!def.shift !== e.shiftKey) continue;
    if (def.scope === "outside-input" && inEditable) continue;
    if (def.scope === "inside-input" && !inEditable) continue;
    if (def.scope === "history-command") {
      // Outside editable: always; inside: only marked persistent cue controls.
      if (inEditable && !isHistoryCommandTarget(e.target)) continue;
    }
    return def;
  }
  return null;
}
