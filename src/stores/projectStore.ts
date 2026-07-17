import { create } from "zustand";
import { produce } from "immer";
import type { AssDocument, AssScriptInfo, AssStyle } from "@/lib/ass";
import type { ActiveSubtitleKind, SubtitleCue, VideoSession } from "../types";
import {
  canContinueTextGroup,
  nextTextGroup,
  type ActiveTextGroup,
  type TextOp,
  type TextSelection,
} from "../services/editorTextHistory";
import { usePlaybackStore } from "./playbackStore";

type TextSelectionSnapshot = {
  cueId: string;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
};

type EditorContextSnapshot = {
  activeCueId: string | null;
  selectedCueIds: string[];
  textSelection: TextSelectionSnapshot | null;
};

type HistorySnapshot = {
  cueRevision: number;
  cues: SubtitleCue[];
  context: EditorContextSnapshot;
};

type RevisionToken = {
  cueRevision: number;
  nonHistoryRevision: number;
};

type ProjectSaveSnapshot = {
  token: RevisionToken;
  cues: SubtitleCue[];
  scriptInfo: AssScriptInfo | null;
  styles: AssStyle[];
};

type PendingCaretRestore = {
  nonce: number;
  selection: TextSelectionSnapshot | null;
};

type TextSessionCheckpoint = {
  cues: SubtitleCue[];
  cueRevision: number;
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  context: EditorContextSnapshot;
};

type CompositionBaseline = {
  cues: SubtitleCue[];
  cueRevision: number;
  textGroup: ActiveTextGroup | null;
  textSession: TextSessionCheckpoint | null;
  textSelection: TextSelectionSnapshot | null;
};

interface HistoryRuntime {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  cueRevision: number;
  nextCueRevision: number;
  nonHistoryRevision: number;
  savedToken: RevisionToken;
  textGroup: ActiveTextGroup | null;
  textSelection: TextSelectionSnapshot | null;
  textSession: TextSessionCheckpoint | null;
  compositionBaseline: CompositionBaseline | null;
  compositionPreview: boolean;
  pendingCaretRestore: PendingCaretRestore | null;
  caretNonce: number;
}

interface ProjectState {
  session: VideoSession | null;
  activeSubtitlePath: string | null;
  activeSubtitleKind: ActiveSubtitleKind | null;
  videoPath: string | null;
  cues: SubtitleCue[];
  assScriptInfo: AssScriptInfo | null;
  assStyles: AssStyle[];
  isDirty: boolean;
  history: HistoryRuntime;
  documentEpoch: number;
  setSession: (session: VideoSession) => void;
  setActiveSubtitle: (
    kind: ActiveSubtitleKind | null,
    path: string | null,
  ) => void;
  clearSession: () => void;
  loadAssDocument: (
    doc: AssDocument,
    active?: { kind: ActiveSubtitleKind; path: string | null },
  ) => void;
  setAssMetadata: (scriptInfo: AssScriptInfo, styles: AssStyle[]) => void;
  setCues: (cues: SubtitleCue[]) => void;
  replaceCues: (cues: SubtitleCue[]) => void;
  updateCue: (id: string, updates: Partial<SubtitleCue>) => void;
  addCue: (cue: SubtitleCue) => void;
  deleteCue: (id: string) => void;
  addStyle: (style: AssStyle) => void;
  updateStyle: (name: string, updates: Partial<AssStyle>) => void;
  deleteStyle: (name: string) => void;
  renameStyle: (oldName: string, newName: string, cascade: boolean) => void;
  undo: () => void;
  redo: () => void;
  markDirty: () => void;
  markSaved: (token: RevisionToken) => void;
  captureSaveSnapshot: () => ProjectSaveSnapshot;
  /** End text session/group without mutating cues (blur, Enter, cue switch, no-op boundaries). */
  acceptTextSession: () => void;
  /** Escape: restore session checkpoint including prior redo branch. */
  rollbackTextSession: () => void;
  setTextSelection: (selection: TextSelectionSnapshot | null) => void;
  applyTextEdit: (args: {
    cueId: string;
    text: string;
    op: TextOp;
  }) => void;
  beginComposition: (selection: TextSelectionSnapshot | null) => void;
  updateCompositionPreview: (cueId: string, text: string) => void;
  endComposition: (args: {
    cueId: string;
    text: string;
    selection: TextSelection;
    timestampMs: number;
  }) => void;
  consumePendingCaretRestore: (nonce: number) => void;
}

const MAX_HISTORY = 50;

const emptyAssState = {
  assScriptInfo: null as AssScriptInfo | null,
  assStyles: [] as AssStyle[],
};

function initialHistory(cueRevision = 0): HistoryRuntime {
  return {
    past: [],
    future: [],
    cueRevision,
    nextCueRevision: cueRevision + 1,
    nonHistoryRevision: 0,
    savedToken: { cueRevision, nonHistoryRevision: 0 },
    textGroup: null,
    textSelection: null,
    textSession: null,
    compositionBaseline: null,
    compositionPreview: false,
    pendingCaretRestore: null,
    caretNonce: 0,
  };
}

function hasCueChanges(
  cue: SubtitleCue | undefined,
  updates: Partial<SubtitleCue>,
): boolean {
  if (!cue) return false;
  return (Object.keys(updates) as Array<keyof SubtitleCue>).some(
    (key) => !Object.is(cue[key], updates[key]),
  );
}

function sameCueListByReference(a: SubtitleCue[], b: SubtitleCue[]): boolean {
  return a.length === b.length && a.every((cue, index) => cue === b[index]);
}

function readLiveContext(
  textSelection: TextSelectionSnapshot | null,
): EditorContextSnapshot {
  const pb = usePlaybackStore.getState();
  return {
    activeCueId: pb.selectedCueId,
    selectedCueIds: [...pb.selectedCueIds],
    textSelection: textSelection ? { ...textSelection } : null,
  };
}

function normalizeContext(
  cues: SubtitleCue[],
  context: EditorContextSnapshot,
): EditorContextSnapshot {
  const validIds = new Set(cues.map((c) => c.id));
  let selected = [...new Set(context.selectedCueIds)].filter((id) =>
    validIds.has(id),
  );

  let active =
    context.activeCueId && validIds.has(context.activeCueId)
      ? context.activeCueId
      : null;
  if (!active && selected.length > 0) {
    active = selected[selected.length - 1]!;
  }
  if (!active && cues.length > 0) {
    active = cues[0]!.id;
  }

  if (active && selected[selected.length - 1] !== active) {
    selected = [...selected.filter((id) => id !== active), active];
  }

  let textSelection: TextSelectionSnapshot | null = null;
  if (
    context.textSelection &&
    validIds.has(context.textSelection.cueId) &&
    context.textSelection.cueId === active
  ) {
    textSelection = { ...context.textSelection };
  }

  return { activeCueId: active, selectedCueIds: selected, textSelection };
}

function applyPlaybackContext(context: EditorContextSnapshot): void {
  usePlaybackStore.setState({
    selectedCueId: context.activeCueId,
    selectedCueIds: context.selectedCueIds,
  });
}

function isDirtyFrom(h: HistoryRuntime): boolean {
  if (h.compositionPreview) return true;
  return (
    h.cueRevision !== h.savedToken.cueRevision ||
    h.nonHistoryRevision !== h.savedToken.nonHistoryRevision
  );
}

function advanceNonHistoryRevision(history: HistoryRuntime): {
  history: HistoryRuntime;
  isDirty: boolean;
} {
  const next = {
    ...history,
    nonHistoryRevision: history.nonHistoryRevision + 1,
  };
  return { history: next, isDirty: isDirtyFrom(next) };
}

function clearTextEditingFlags(h: HistoryRuntime): HistoryRuntime {
  if (
    h.textGroup === null &&
    h.textSession === null &&
    h.compositionBaseline === null &&
    h.compositionPreview === false
  ) {
    return h;
  }
  return {
    ...h,
    textGroup: null,
    textSession: null,
    compositionBaseline: null,
    compositionPreview: false,
  };
}

/** Restore composition baseline without clearing the text session. */
function cancelIncompleteComposition(state: ProjectState): ProjectState {
  const baseline = state.history.compositionBaseline;
  if (!baseline) return state;
  return {
    ...state,
    cues: baseline.cues,
    history: {
      ...state.history,
      textGroup: baseline.textGroup,
      textSession: baseline.textSession,
      compositionBaseline: null,
      compositionPreview: false,
      textSelection: baseline.textSelection,
      cueRevision: baseline.cueRevision,
    },
  };
}

/**
 * Accept session/group boundaries.
 * Incomplete IME is cancelled so intermediate text never becomes a leaving
 * snapshot or save payload; then group/session flags are cleared.
 */
function acceptEditingState(state: ProjectState): ProjectState {
  const cancelled = cancelIncompleteComposition(state);
  const history = clearTextEditingFlags(cancelled.history);
  if (history === cancelled.history && cancelled === state) return state;
  return { ...cancelled, history, isDirty: isDirtyFrom(history) };
}

function pushPast(
  past: HistorySnapshot[],
  snapshot: HistorySnapshot,
): HistorySnapshot[] {
  return [...past, snapshot].slice(-MAX_HISTORY);
}

function applyTextEditState(
  base: ProjectState,
  { cueId, text, op }: { cueId: string; text: string; op: TextOp },
): ProjectState | Partial<ProjectState> {
  const currentCue = base.cues.find((cue) => cue.id === cueId);
  if (!currentCue || currentCue.primaryText === text) return base;

  let history = base.history;
  const continuing = canContinueTextGroup(history.textGroup, op);
  const cues = produce(base.cues, (draft) => {
    const cue = draft.find((item) => item.id === cueId);
    if (cue) cue.primaryText = text;
  });
  const textSelection: TextSelectionSnapshot = {
    cueId,
    start: op.after.start,
    end: op.after.end,
    direction: op.after.direction ?? "none",
  };

  if (continuing) {
    history = {
      ...history,
      textGroup: nextTextGroup(op),
      textSelection,
    };
    return { cues, history, isDirty: isDirtyFrom(history) };
  }

  const context = readLiveContext(history.textSelection);
  const textSession =
    history.textSession ??
    ({
      cues: base.cues,
      cueRevision: history.cueRevision,
      past: history.past,
      future: history.future,
      context,
    } satisfies TextSessionCheckpoint);
  const leaving: HistorySnapshot = {
    cueRevision: history.cueRevision,
    cues: base.cues,
    context,
  };
  const revision = history.nextCueRevision;
  history = {
    ...history,
    past: pushPast(history.past, leaving),
    future: [],
    cueRevision: revision,
    nextCueRevision: revision + 1,
    textGroup: nextTextGroup(op),
    textSession,
    textSelection,
    compositionBaseline: null,
    compositionPreview: false,
    pendingCaretRestore: null,
  };
  return { cues, history, isDirty: isDirtyFrom(history) };
}

export const useProjectStore = create<ProjectState>((set, get) => {
  const commitNormalMutation = (
    accepted: ProjectState,
    nextCues: SubtitleCue[],
  ): Pick<ProjectState, "cues" | "history" | "isDirty"> => {
    if (sameCueListByReference(accepted.cues, nextCues)) {
      // Still end session/group on no-op boundary when caller wants — but normal
      // mutations that produce identical refs are pure no-ops without boundary.
      return accepted;
    }

    let h = accepted.history;
    const context = readLiveContext(h.textSelection);
    const leaving: HistorySnapshot = {
      cueRevision: h.cueRevision,
      cues: accepted.cues,
      context,
    };
    const revision = h.nextCueRevision;
    h = {
      ...h,
      past: pushPast(h.past, leaving),
      future: [],
      cueRevision: revision,
      nextCueRevision: revision + 1,
      textGroup: null,
      textSession: null,
      compositionBaseline: null,
      compositionPreview: false,
      pendingCaretRestore: null,
      textSelection: null,
    };
    return {
      cues: nextCues,
      history: h,
      isDirty: isDirtyFrom(h),
    };
  };

  const restoreSnapshot = (
    state: ProjectState,
    target: HistorySnapshot,
    past: HistorySnapshot[],
    future: HistorySnapshot[],
  ): Partial<ProjectState> => {
    const context = normalizeContext(target.cues, target.context);
    applyPlaybackContext(context);
    const caretNonce = state.history.caretNonce + 1;
    const h: HistoryRuntime = {
      ...state.history,
      past,
      future,
      cueRevision: target.cueRevision,
      // nextCueRevision never moves backward
      textGroup: null,
      textSession: null,
      compositionBaseline: null,
      compositionPreview: false,
      textSelection: context.textSelection,
      pendingCaretRestore: {
        nonce: caretNonce,
        selection: context.textSelection,
      },
      caretNonce,
    };
    return {
      cues: target.cues,
      history: h,
      isDirty: isDirtyFrom(h),
    };
  };

  return {
    session: null,
    activeSubtitlePath: null,
    activeSubtitleKind: null,
    videoPath: null,
    cues: [],
    ...emptyAssState,
    isDirty: false,
    history: initialHistory(0),
    documentEpoch: 0,

    setSession: (session) =>
      set((state) => ({
        session,
        activeSubtitlePath: null,
        activeSubtitleKind: null,
        videoPath: session.videoPath,
        cues: [],
        ...emptyAssState,
        isDirty: false,
        history: initialHistory(0),
        documentEpoch: state.documentEpoch + 1,
      })),

    setActiveSubtitle: (kind, path) =>
      set({
        activeSubtitleKind: kind,
        activeSubtitlePath: path,
      }),

    clearSession: () =>
      set((state) => ({
        session: null,
        activeSubtitlePath: null,
        activeSubtitleKind: null,
        videoPath: null,
        cues: [],
        ...emptyAssState,
        isDirty: false,
        history: initialHistory(0),
        documentEpoch: state.documentEpoch + 1,
      })),

    loadAssDocument: (doc, active) =>
      set((state) => ({
        cues: doc.cues,
        assScriptInfo: doc.scriptInfo,
        assStyles: doc.styles,
        activeSubtitleKind: active?.kind ?? state.activeSubtitleKind,
        activeSubtitlePath:
          active === undefined ? state.activeSubtitlePath : active.path,
        isDirty: false,
        history: initialHistory(0),
        documentEpoch: state.documentEpoch + 1,
      })),

    setAssMetadata: (scriptInfo, styles) =>
      set({
        assScriptInfo: scriptInfo,
        assStyles: styles,
      }),

    setCues: (cues) =>
      set((state) => {
        const accepted = acceptEditingState(state);
        const revision = accepted.history.nextCueRevision;
        const h: HistoryRuntime = {
          ...initialHistory(revision),
          nonHistoryRevision: accepted.history.nonHistoryRevision,
          // New document content is unsaved relative to prior checkpoint.
          savedToken: accepted.history.savedToken,
        };
        // Fresh history after setCues; mark dirty vs saved token.
        return {
          cues,
          history: h,
          isDirty: isDirtyFrom(h),
          documentEpoch: state.documentEpoch + 1,
        };
      }),

    replaceCues: (cues) =>
      set((state) => {
        const accepted = acceptEditingState(state);
        if (sameCueListByReference(accepted.cues, cues)) {
          // Boundary: end session/group even on no-op list replace
          return accepted;
        }
        return commitNormalMutation(accepted, cues);
      }),

    updateCue: (id, updates) =>
      set((state) => {
        // Cancel incomplete IME before reading/applying so preview text is not baked in.
        const accepted = acceptEditingState(state);
        const currentCue = accepted.cues.find((cue) => cue.id === id);
        if (!hasCueChanges(currentCue, updates)) {
          return accepted;
        }

        const newCues = produce(accepted.cues, (draft) => {
          const cue = draft.find((c) => c.id === id);
          if (cue) Object.assign(cue, updates);
        });
        return commitNormalMutation(accepted, newCues);
      }),

    addCue: (cue) =>
      set((state) => {
        const accepted = acceptEditingState(state);
        const newCues = [...accepted.cues, cue].sort(
          (a, b) => a.startMs - b.startMs,
        );
        return commitNormalMutation(accepted, newCues);
      }),

    deleteCue: (id) =>
      set((state) => {
        const accepted = acceptEditingState(state);
        const newCues = accepted.cues.filter((c) => c.id !== id);
        if (newCues.length === accepted.cues.length) {
          return accepted;
        }
        return commitNormalMutation(accepted, newCues);
      }),

    addStyle: (style) =>
      set((state) => ({
        assStyles: [...state.assStyles, style],
        ...advanceNonHistoryRevision(state.history),
      })),

    updateStyle: (name, updates) =>
      set((state) => ({
        assStyles: state.assStyles.map((style) =>
          style.name === name ? { ...style, ...updates } : style,
        ),
        ...advanceNonHistoryRevision(state.history),
      })),

    deleteStyle: (name) =>
      set((state) => ({
        assStyles: state.assStyles.filter((style) => style.name !== name),
        ...advanceNonHistoryRevision(state.history),
      })),

    renameStyle: (oldName, newName, cascade) =>
      set((state) => {
        const target = state.assStyles.find((style) => style.name === oldName);
        if (!target || oldName === newName) return state;

        const assStyles = state.assStyles.map((style) =>
          style.name === oldName ? { ...style, name: newName } : style,
        );

        if (!cascade) {
          return { assStyles, ...advanceNonHistoryRevision(state.history) };
        }

        // Cancel incomplete IME so cascade doesn't leave composition preview text.
        const accepted = acceptEditingState(state);
        const newCues = produce(accepted.cues, (draft) => {
          for (const cue of draft) {
            if (cue.style === oldName) cue.style = newName;
          }
        });

        // Cascade: one undoable cue item + non-history style bump.
        if (sameCueListByReference(accepted.cues, newCues)) {
          return {
            cues: accepted.cues,
            assStyles,
            ...advanceNonHistoryRevision(accepted.history),
          };
        }

        const base = commitNormalMutation(accepted, newCues);
        return {
          ...base,
          assStyles,
          ...advanceNonHistoryRevision(base.history),
        };
      }),

    undo: () =>
      set((state) => {
        // Accept text session first (commit grouping; cancel incomplete IME).
        // Escape uses rollbackTextSession separately.
        const accepted = acceptEditingState(state);
        const h0 = accepted.history;
        if (h0.past.length === 0) {
          return accepted;
        }
        const previous = h0.past[h0.past.length - 1]!;
        const newPast = h0.past.slice(0, -1);
        const currentSnap: HistorySnapshot = {
          cueRevision: h0.cueRevision,
          cues: accepted.cues,
          context: readLiveContext(h0.textSelection),
        };
        const newFuture = [currentSnap, ...h0.future].slice(0, MAX_HISTORY);
        return restoreSnapshot(accepted, previous, newPast, newFuture);
      }),

    redo: () =>
      set((state) => {
        const accepted = acceptEditingState(state);
        const h0 = accepted.history;
        if (h0.future.length === 0) {
          return accepted;
        }
        const next = h0.future[0]!;
        const newFuture = h0.future.slice(1);
        const currentSnap: HistorySnapshot = {
          cueRevision: h0.cueRevision,
          cues: accepted.cues,
          context: readLiveContext(h0.textSelection),
        };
        const newPast = pushPast(h0.past, currentSnap);
        return restoreSnapshot(accepted, next, newPast, newFuture);
      }),

    markDirty: () =>
      set((state) => advanceNonHistoryRevision(state.history)),

    markSaved: (token) =>
      set((state) => {
        const h = { ...state.history, savedToken: token };
        return { history: h, isDirty: isDirtyFrom(h) };
      }),

    captureSaveSnapshot: () => {
      get().acceptTextSession();
      const state = get();
      return {
        token: {
          cueRevision: state.history.cueRevision,
          nonHistoryRevision: state.history.nonHistoryRevision,
        },
        cues: state.cues,
        scriptInfo: state.assScriptInfo,
        styles: state.assStyles,
      };
    },

    acceptTextSession: () => set(acceptEditingState),

    rollbackTextSession: () =>
      set((state) => {
        // Cancel incomplete IME first (keeps session), then restore checkpoint.
        const cancelled = cancelIncompleteComposition(state);
        const session = cancelled.history.textSession;
        if (!session) {
          return acceptEditingState(state);
        }
        const context = normalizeContext(session.cues, session.context);
        applyPlaybackContext(context);
        const caretNonce = cancelled.history.caretNonce + 1;
        const h: HistoryRuntime = {
          ...cancelled.history,
          past: session.past,
          future: session.future,
          cueRevision: session.cueRevision,
          // nextCueRevision stays monotonic — already advanced during session
          textGroup: null,
          textSession: null,
          compositionBaseline: null,
          compositionPreview: false,
          textSelection: context.textSelection,
          pendingCaretRestore: {
            nonce: caretNonce,
            selection: context.textSelection,
          },
          caretNonce,
        };
        return {
          cues: session.cues,
          history: h,
          isDirty: isDirtyFrom(h),
        };
      }),

    setTextSelection: (selection) =>
      set((state) => ({
        history: {
          ...state.history,
          textSelection: selection,
        },
      })),

    applyTextEdit: (args) =>
      set((state) =>
        applyTextEditState(cancelIncompleteComposition(state), args),
      ),

    beginComposition: (selection) =>
      set((state) => {
        const h = state.history;
        return {
          history: {
            ...h,
            compositionBaseline: {
              cues: state.cues,
              cueRevision: h.cueRevision,
              textGroup: h.textGroup,
              textSession: h.textSession,
              textSelection: selection ?? h.textSelection,
            },
            compositionPreview: false,
            textSelection: selection ?? h.textSelection,
          },
        };
      }),

    updateCompositionPreview: (cueId, text) =>
      set((state) => {
        const baseline = state.history.compositionBaseline;
        if (!baseline || !baseline.cues.some((cue) => cue.id === cueId)) {
          return state;
        }
        const cues = produce(state.cues, (draft) => {
          const cue = draft.find((item) => item.id === cueId);
          if (cue) cue.primaryText = text;
        });
        const history = { ...state.history, compositionPreview: true };
        return { cues, history, isDirty: isDirtyFrom(history) };
      }),

    endComposition: ({ cueId, text, selection, timestampMs }) =>
      set((state) => {
        const baseline = state.history.compositionBaseline;
        const baselineCue = baseline?.cues.find((cue) => cue.id === cueId);
        if (!baseline || !baselineCue) return state;

        const history: HistoryRuntime = {
          ...state.history,
          textGroup: baseline.textGroup,
          textSession: baseline.textSession,
          compositionBaseline: null,
          compositionPreview: false,
          textSelection: baseline.textSelection,
          cueRevision: baseline.cueRevision,
        };
        const base: ProjectState = {
          ...state,
          cues: baseline.cues,
          history,
          isDirty: isDirtyFrom(history),
        };
        if (text === baselineCue.primaryText) return base;

        return applyTextEditState(base, {
          cueId,
          text,
          op: {
            kind: "insert",
            cueId,
            before: baseline.textSelection
              ? {
                  start: baseline.textSelection.start,
                  end: baseline.textSelection.end,
                  direction: baseline.textSelection.direction,
                }
              : { start: 0, end: 0 },
            after: selection,
            timestampMs,
          },
        });
      }),

    consumePendingCaretRestore: (nonce) =>
      set((state) => {
        if (state.history.pendingCaretRestore?.nonce !== nonce) return state;
        return {
          history: { ...state.history, pendingCaretRestore: null },
        };
      }),
  };
});
