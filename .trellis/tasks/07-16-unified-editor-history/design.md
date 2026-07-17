# Unified Subtitle Editor History - Technical Design

## 1. Scope and constraints

This is a frontend-only change. `projectStore` remains the authority for subtitle document history; the ASS model, serialization, Tauri commands, and backend are unchanged.

The implementation preserves the existing 50-item bound and the atomic `replaceCues` contract used by batch formatting, cut, paste, reordering, split, and merge operations. `StyleManager` mutations remain outside cue undo history but still participate in dirty/save-checkpoint calculation.

The task intentionally replaces two current frontend-spec rules for this editor: project undo/redo is intercepted inside explicitly marked persistent cue-edit controls, and undo/redo restores normalized cue selection context. The affected specs must be updated after implementation.

## 2. History and revision model

Replace raw cue-array entries with revisioned snapshots:

```ts
interface TextSelectionSnapshot {
  cueId: string;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

interface EditorContextSnapshot {
  activeCueId: string | null;
  selectedCueIds: string[];
  textSelection: TextSelectionSnapshot | null;
}

interface HistorySnapshot {
  cueRevision: number;
  cues: SubtitleCue[];
  context: EditorContextSnapshot;
}

interface RevisionToken {
  cueRevision: number;
  nonHistoryRevision: number;
}
```

`HistoryState` keeps bounded `past` and `future` snapshot stacks plus:

- current and next monotonic cue revision ids;
- current non-history revision for style-library mutations and explicit `markDirty` calls;
- the last successful `RevisionToken` save checkpoint;
- active text-group metadata;
- current textarea selection and a nonce-backed pending restore request;
- an optional cancellable text-session checkpoint;
- an optional IME composition baseline and transient-preview flag.

A new history item receives a fresh monotonic cue revision. Coalesced text changes amend the current cue state without changing that revision. Undo/redo restores the target snapshot revision, but the next revision id never moves backward. A new branch therefore cannot accidentally reuse the saved revision id.

`isDirty` is derived from whether the current `(cueRevision, nonHistoryRevision)` equals the saved token, plus any active composition preview. Session/document loading establishes a clean base token. `setCues` clears cue history and allocates a new unsaved cue revision.

`setAssMetadata` synchronizes document metadata without independently advancing a revision; user-facing style actions do advance `nonHistoryRevision`. A cascading style rename advances both revisions: cue references form one undoable cue item, while the non-undoable style-library rename keeps the project dirty after cue undo.

## 3. Central cue mutation contract

Keep the existing public store operations but route history bookkeeping through one private normal-mutation helper.

For a normal cue mutation the helper:

1. accepts/ends any current text session and text group before evaluating the mutation;
2. rejects a no-op cue result without adding history;
3. captures current cues and live editor context;
4. appends one bounded `past` snapshot;
5. applies new cues under a fresh revision;
6. clears `future`, composition state, and stale caret restoration;
7. derives dirty state from the current token.

Session/group boundary methods are separate from the mutation helper so Enter, save, cue switches, and no-op commands can still terminate coalescing without creating an empty history item.

`updateCue`, `replaceCues`, `addCue`, and `deleteCue` remain thin callers. Batch operations continue to call `replaceCues` once. Single-row inline tag/alignment commands use one normal `updateCue` instead of preview-only mutation, while multi-row commands retain one `replaceCues` call.

## 4. Aegisub-style text grouping

Add a pure `src/services/editorTextHistory.ts` module. It normalizes `beforeinput` metadata and decides whether a post-change operation may continue the active group.

Supported coalescing kinds:

- `insert`: collapsed adjacent `insertText` or committed composition insertion;
- `backspace`: collapsed `deleteContentBackward` operations whose resulting caret continues the same backward run;
- `delete`: collapsed `deleteContentForward` operations at the same resulting caret.

Coalescing is based on pre/post selection continuity, not a fixed UTF-16 delta, so deletion of emoji or composed characters remains valid. Selection replacement, `insertLineBreak`, paste, cut, word deletion, replacement/autocorrect/drop operations, unknown input types, missing `beforeinput`, operation-kind changes, non-contiguous positions, cue changes, inline formatting, other cue mutations, and at least 30 seconds of idle time create discrete items or start a new supported group.

`SubtitleEditor` captures the pre-edit operation in `onBeforeInput` and supplies the post-edit selection in `onChange`. On the first event of a group, the store lazily creates a text-session checkpoint, pushes the baseline snapshot, assigns a revision, and clears redo. Compatible events update the live cue and group metadata without adding snapshots. The current group is therefore immediately undoable before blur.

## 5. Text-session and Escape state machine

A text-session checkpoint contains baseline cues, cue revision, `past`, `future`, and editor context. It intentionally does not roll back non-history style changes; any non-text command accepts the session first.

Transitions:

1. Focus may create an empty session, but the first actual text edit must lazily create one if none exists.
2. Supported/discrete text edits append or amend history within that session.
3. Blur, Enter, save, undo/redo, cue switch, or any non-text cue command accepts the session and ends the group, even if that boundary changes no cue data.
4. Undo/redo may leave textarea focus in place. The next input lazily starts a new session from the post-command state.
5. Escape restores the active session checkpoint, including the prior redo stack, and discards all text groups created since that checkpoint. It then blurs as today.

Keeping `nextRevision` monotonic while restoring a session prevents revision reuse. If no active text session exists, Escape only resets local drafts from current store state.

A synchronous `playbackStore` selection subscription mounted by `EditorView` calls the session/group boundary whenever the active cue changes. Cue-id checks in the classifier remain a second guard against cross-cue coalescing.

## 6. IME transaction

On composition start, capture a composition baseline containing pre-composition cues, selection, active text group, and revision state. Composition-time changes update live preview only and set transient dirty state; they do not push or amend history.

On composition end:

- if the final text equals the baseline, restore/drop the preview with no history item;
- otherwise promote the final value once, using the baseline as the history source and classifying the committed change as an insertion;
- restore or update the prior insertion group only when normal insertion-continuity rules allow it.

The component records one expected post-composition event signature: cue id, final value, selection, and allowed input type. It is consumed only by the immediately following matching input event and expires in the next microtask. Cue/session/document changes clear the signature and composition baseline, so late events cannot mutate a new document.

The existing `findHotkey` `isComposing` guard remains.

## 7. Editor-context capture and restoration

When snapshotting the state being left, `projectStore` reads current selection from `playbackStore` and current textarea selection from its own context field. Selection-only changes do not create revisions; the live context is captured when the current revision is next snapshotted for a mutation, undo, or redo. This preserves the immediate post-action list selection when redo later returns to that state without requiring atomic cue-and-selection call-site rewrites.

Restoration normalizes context:

1. keep unique selected ids that exist in restored cues, preserving order;
2. use the valid saved active id, otherwise the last valid selected id, otherwise the first restored cue, otherwise `null`;
3. ensure a non-null active id is included as the last selected id;
4. set only `selectedCueId` and `selectedCueIds` in `playbackStore`;
5. replace the pending caret request on every restore, using `null` when the saved text selection no longer matches a valid cue.

`SubtitleEditor` consumes a matching nonce-backed caret request after selected cue and controlled text render. Session/document resets clear pending requests. Video time, play/pause, and segment-play state are never touched.

## 8. Hotkey scope and pending time drafts

Add a history-command hotkey scope that matches when the event target is:

- outside an editable control; or
- an editable control carrying an explicit persistent-history marker.

Mark only subtitle textarea and start/end time inputs. Font search, quick font-size, inline color/number popovers, filters, and all `StyleManager` inputs remain unmarked and retain native text history. Applying their value through existing commit/close behavior creates one normal cue-history item. Shared `ColorPicker` behavior is not changed globally.

`SubtitleEditor` exposes a narrow imperative handle to `EditorView`:

```ts
interface SubtitleEditorHistoryHandle {
  commitPendingTimeDraft(): boolean;
}
```

It also reports reactive `hasPendingTimeDraft` state by comparing normalized local start/end values with the active cue. This is the complete draft-coordinator contract; no generic registry is introduced.

`EditorView` owns shared `runUndo` and `runRedo` wrappers used by hotkeys and playback buttons:

- `runUndo` commits an effective pending time draft synchronously through the handle, then invokes project undo;
- `runRedo` returns without flushing when a time draft is pending, otherwise invokes project redo.

The undo button is enabled when project history exists or an effective time draft is pending. Redo is enabled only when `canRedo()` is true and no effective time draft is pending. The keyboard wrapper applies the same guards, so unavailable redo is a prevented, non-flushing no-op. No-change focus/blur and flush paths create no history.

Save does not use an unconditional pre-flush wrapper. The save button and hotkey call the same async editor-save function, which first resolves/cancels any required path picker. Only after a path exists does it commit pending time, normalize metadata, and capture the save snapshot.

Inline deferred color/number drafts are transient parameters. Undo inside them remains native. Their existing apply/close boundary commits one project action; a user then uses project undo after leaving or applying the popover.

## 9. Save snapshot and checkpoint pairing

Expose a synchronous store method:

```ts
interface ProjectSaveSnapshot {
  token: RevisionToken;
  cues: SubtitleCue[];
  scriptInfo: AssScriptInfo | null;
  styles: AssStyle[];
}

captureSaveSnapshot(): ProjectSaveSnapshot;
markSaved(token: RevisionToken): void;
```

`captureSaveSnapshot` accepts the active text session/group, clears transient restore state as needed, and returns immutable state references paired with the current token. Callers serialize from that returned snapshot or pair a previously materialized immutable string with the token in the same uninterrupted synchronous section. `markSaved(token)` runs only after successful I/O and derives current dirty state by comparing the now-current token.

Call-site ordering:

- **Editor:** both the save button and hotkey enter the same async function; await any save-path picker first and return on cancellation without flushing drafts; then commit pending time, resolve/save metadata, capture one store snapshot, serialize that snapshot, await write, and mark its token saved.
- **Translation:** build immutable serialized output and physical document; synchronously load the physical cues/metadata into the store and capture their token before awaiting write; mark that token only on success.
- **Transcription:** finish video-info awaits first; set metadata; capture current transcription cues/metadata and serialize that snapshot immediately before write; mark only that token on success.

Edits during path selection are included because capture occurs afterward. Edits during file I/O change the current token, so successful completion records what reached disk but leaves the newer state dirty. Failed writes do not move the checkpoint.

## 10. Compatibility and rollback

- No persistent migration is required; history remains memory-only.
- Session/document load keeps clearing history and now clears all grouping/session/composition/caret state.
- Batch and clipboard operations retain one `replaceCues` call and one history item.
- Existing asynchronous clipboard stale-result behavior is explicitly out of scope; this task does not widen clipboard concurrency work.
- Unknown WebView input behavior falls back to a discrete history item, never accidental coalescing.

Rollback can be staged: revert hotkey/time-draft routing, then text/IME integration, then the snapshot/revision model. No ASS or backend data requires rollback.
