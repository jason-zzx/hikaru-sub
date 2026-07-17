/** Aegisub-style text-edit grouping for subtitle textarea history. Pure, no React/Zustand. */

export type TextOpKind = "insert" | "backspace" | "delete";

export type TextSelection = {
  start: number;
  end: number;
  direction?: "forward" | "backward" | "none";
};

export type TextOp = {
  kind: TextOpKind | "discrete";
  cueId: string;
  /** Selection before the edit (from beforeinput). */
  before: TextSelection;
  /** Selection after the edit (from onChange / input). */
  after: TextSelection;
  timestampMs: number;
};

export type ActiveTextGroup = {
  kind: TextOpKind;
  cueId: string;
  /** Resulting caret after the last coalesced op (insert/delete use start; backspace uses start). */
  caret: number;
  lastTimestampMs: number;
};

export const TEXT_GROUP_IDLE_MS = 30_000;

/** Normalize browser inputType into a coalescable kind, or discrete. */
export function classifyInputType(
  inputType: string | null | undefined,
  before: TextSelection,
): TextOpKind | "discrete" {
  if (!inputType) return "discrete";
  if (before.start !== before.end) return "discrete";

  switch (inputType) {
    case "insertText":
    case "insertCompositionText":
      return "insert";
    case "deleteContentBackward":
      return "backspace";
    case "deleteContentForward":
      return "delete";
    // Line breaks, paste, cut, drop, word delete, history, format — discrete
    default:
      return "discrete";
  }
}

export function makeTextOp(args: {
  cueId: string;
  before: TextSelection;
  after: TextSelection;
  inputType?: string | null;
  timestampMs: number;
}): TextOp {
  return {
    kind: classifyInputType(args.inputType, args.before),
    cueId: args.cueId,
    before: args.before,
    after: args.after,
    timestampMs: args.timestampMs,
  };
}

/**
 * Whether `op` may amend the active group instead of starting a new history item.
 * Coalescing uses pre/post selection continuity, not fixed UTF-16 deltas.
 */
export function canContinueTextGroup(
  group: ActiveTextGroup | null,
  op: TextOp,
  idleMs: number = TEXT_GROUP_IDLE_MS,
): boolean {
  if (!group) return false;
  if (op.kind === "discrete") return false;
  if (group.kind !== op.kind) return false;
  if (group.cueId !== op.cueId) return false;
  if (op.timestampMs - group.lastTimestampMs >= idleMs) return false;
  if (
    op.before.start !== op.before.end ||
    op.after.start !== op.after.end ||
    op.before.start !== group.caret
  ) {
    return false;
  }

  if (op.kind === "insert") return op.after.start > group.caret;
  if (op.kind === "backspace") return op.after.start < group.caret;
  return op.after.start === group.caret;
}

export function nextTextGroup(op: TextOp): ActiveTextGroup | null {
  if (op.kind === "discrete") return null;
  return {
    kind: op.kind,
    cueId: op.cueId,
    caret: op.after.start,
    lastTimestampMs: op.timestampMs,
  };
}
