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
  | "toggle-help";

export interface HotkeyDef {
  /** KeyboardEvent.key（单字符统一小写比较；命名键如 ArrowUp 原样） */
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  scope: HotkeyScope;
  action: EditorActionId;
  /** 速查浮层展示的按键文案 */
  label: string;
  description: string;
  category: "导航" | "播放" | "打点" | "编辑" | "系统";
  /** 由组件本地处理（需要草稿状态），分发器跳过，仅供速查浮层展示 */
  handledLocally?: boolean;
}

export const EDITOR_HOTKEYS: HotkeyDef[] = [
  // 导航与选择
  { key: "ArrowUp", scope: "outside-input", action: "select-prev", label: "↑", description: "选中上一条字幕", category: "导航" },
  { key: "ArrowDown", scope: "outside-input", action: "select-next", label: "↓", description: "选中下一条字幕", category: "导航" },
  { key: "ArrowUp", alt: true, scope: "global", action: "select-prev", label: "Alt+↑", description: "选中上一条（编辑框内可用）", category: "导航" },
  { key: "ArrowDown", alt: true, scope: "global", action: "select-next", label: "Alt+↓", description: "选中下一条（编辑框内可用）", category: "导航" },
  { key: "Home", scope: "outside-input", action: "select-first", label: "Home", description: "跳到第一条", category: "导航" },
  { key: "End", scope: "outside-input", action: "select-last", label: "End", description: "跳到最后一条", category: "导航" },
  { key: "PageUp", scope: "outside-input", action: "select-page-up", label: "PgUp", description: "向上跳 10 条", category: "导航" },
  { key: "PageDown", scope: "outside-input", action: "select-page-down", label: "PgDn", description: "向下跳 10 条", category: "导航" },
  // 播放头控制
  { key: " ", scope: "outside-input", action: "toggle-play", label: "空格", description: "播放 / 暂停", category: "播放" },
  { key: "p", ctrl: true, scope: "global", action: "toggle-play", label: "Ctrl+P", description: "播放 / 暂停（编辑框内可用）", category: "播放" },
  { key: "ArrowLeft", scope: "outside-input", action: "frame-prev", label: "←", description: "上一帧", category: "播放" },
  { key: "ArrowRight", scope: "outside-input", action: "frame-next", label: "→", description: "下一帧", category: "播放" },
  { key: "ArrowLeft", alt: true, scope: "outside-input", action: "frame-fast-prev", label: "Alt+←", description: "快退 10 帧", category: "播放" },
  { key: "ArrowRight", alt: true, scope: "outside-input", action: "frame-fast-next", label: "Alt+→", description: "快进 10 帧", category: "播放" },
  { key: "ArrowLeft", ctrl: true, scope: "outside-input", action: "boundary-prev", label: "Ctrl+←", description: "跳至上一个字幕边界", category: "播放" },
  { key: "ArrowRight", ctrl: true, scope: "outside-input", action: "boundary-next", label: "Ctrl+→", description: "跳至下一个字幕边界", category: "播放" },
  { key: "r", scope: "outside-input", action: "play-segment", label: "R", description: "播放当前字幕段（再按中断）", category: "播放" },
  // 对轴打点
  { key: "3", ctrl: true, scope: "global", action: "stamp-start", label: "Ctrl+3", description: "播放位置写入开始时间", category: "打点" },
  { key: "4", ctrl: true, scope: "global", action: "stamp-end", label: "Ctrl+4", description: "播放位置写入结束时间", category: "打点" },
  // 编辑操作
  { key: "Enter", scope: "inside-input", action: "commit-and-next", label: "Enter", description: "提交并跳到下一条（最后一条时追加新行）", category: "编辑", handledLocally: true },
  { key: "Enter", shift: true, scope: "inside-input", action: "insert-newline", label: "Shift+Enter", description: "插入换行", category: "编辑", handledLocally: true },
  { key: "Escape", scope: "inside-input", action: "discard-draft", label: "Esc", description: "放弃未提交草稿并失焦", category: "编辑", handledLocally: true },
  { key: "Insert", scope: "outside-input", action: "new-cue", label: "Insert", description: "在播放头位置新建字幕", category: "编辑" },
  { key: "Delete", scope: "outside-input", action: "delete-cue", label: "Delete", description: "删除选中字幕（可撤销）", category: "编辑" },
  { key: "c", ctrl: true, scope: "outside-input", action: "copy-cues", label: "Ctrl+C", description: "复制选中字幕行", category: "编辑" },
  { key: "x", ctrl: true, scope: "outside-input", action: "cut-cues", label: "Ctrl+X", description: "剪切选中字幕行", category: "编辑" },
  { key: "v", ctrl: true, scope: "outside-input", action: "paste-cues", label: "Ctrl+V", description: "粘贴字幕行", category: "编辑" },
  { key: "a", ctrl: true, scope: "outside-input", action: "select-all-cues", label: "Ctrl+A", description: "全选字幕行", category: "编辑" },
  // 系统
  { key: "s", ctrl: true, scope: "global", action: "save", label: "Ctrl+S", description: "保存", category: "系统" },
  { key: "z", ctrl: true, scope: "history-command", action: "undo", label: "Ctrl+Z", description: "撤销", category: "系统" },
  { key: "y", ctrl: true, scope: "history-command", action: "redo", label: "Ctrl+Y", description: "重做", category: "系统" },
  { key: "z", ctrl: true, shift: true, scope: "history-command", action: "redo", label: "Ctrl+Shift+Z", description: "重做", category: "系统" },
  { key: "?", shift: true, scope: "outside-input", action: "toggle-help", label: "?", description: "键位速查", category: "系统" },
];

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

/**
 * 在键位表中匹配事件；不匹配返回 null。
 * - IME 组词中（isComposing）一律不匹配
 * - metaKey 等价 ctrl（macOS）
 * - handledLocally 的条目跳过（由组件本地处理）
 */
export function findHotkey(
  e: HotkeyEventLike,
  defs: HotkeyDef[] = EDITOR_HOTKEYS,
): HotkeyDef | null {
  if (e.isComposing) return null;
  const inEditable = isEditableTarget(e.target);
  const ctrl = e.ctrlKey || e.metaKey;
  const key = normalizeKey(e.key);

  for (const def of defs) {
    if (def.handledLocally) continue;
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
