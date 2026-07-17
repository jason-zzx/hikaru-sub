export interface EditorPaneLayout {
  leftPercent: number;
  listPercent: number;
}

export const EDITOR_PANE_LAYOUT_STORAGE_KEY =
  "hikaru-sub:editor-pane-layout:v1";
export const EDITOR_PANE_SEPARATOR_SIZE_PX = 6;
export const EDITOR_LEFT_PANE_MIN_PX = 320;
export const EDITOR_RIGHT_PANE_MIN_PX = 360;
export const EDITOR_LIST_PANE_MIN_PX = 160;
export const EDITOR_SUBTITLE_PANE_MIN_PX = 200;

export const DEFAULT_EDITOR_PANE_LAYOUT: Readonly<EditorPaneLayout> = {
  leftPercent: (1.4 / 2.4) * 100,
  listPercent: 55,
};

function defaultLayout(): EditorPaneLayout {
  return { ...DEFAULT_EDITOR_PANE_LAYOUT };
}

function isValidPercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value < 100
  );
}

function isEditorPaneLayout(value: unknown): value is EditorPaneLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as Partial<EditorPaneLayout>;
  return isValidPercent(layout.leftPercent) && isValidPercent(layout.listPercent);
}

export function constrainPanePercent(
  preferredPercent: number,
  totalSize: number,
  beforeMinPx: number,
  afterMinPx: number,
): number {
  const fallbackPercent = (beforeMinPx / (beforeMinPx + afterMinPx)) * 100;
  const percent = Number.isFinite(preferredPercent)
    ? preferredPercent
    : fallbackPercent;

  if (!Number.isFinite(totalSize) || totalSize <= EDITOR_PANE_SEPARATOR_SIZE_PX) {
    return Math.min(99, Math.max(1, percent));
  }

  const availableSize = totalSize - EDITOR_PANE_SEPARATOR_SIZE_PX;
  if (availableSize < beforeMinPx + afterMinPx) return fallbackPercent;

  const min = (beforeMinPx / availableSize) * 100;
  const max = 100 - (afterMinPx / availableSize) * 100;
  return Math.min(max, Math.max(min, percent));
}

export function readEditorPaneLayout(): EditorPaneLayout {
  try {
    const stored = localStorage.getItem(EDITOR_PANE_LAYOUT_STORAGE_KEY);
    if (!stored) return defaultLayout();
    const parsed: unknown = JSON.parse(stored);
    return isEditorPaneLayout(parsed)
      ? {
          leftPercent: parsed.leftPercent,
          listPercent: parsed.listPercent,
        }
      : defaultLayout();
  } catch {
    return defaultLayout();
  }
}

export function writeEditorPaneLayout(layout: EditorPaneLayout): void {
  try {
    localStorage.setItem(EDITOR_PANE_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage may be disabled; the live layout remains usable.
  }
}
