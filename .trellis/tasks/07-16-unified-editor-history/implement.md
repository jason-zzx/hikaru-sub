# Unified Subtitle Editor History - Implementation Plan

## 1. Add deterministic text-operation grouping

- Add `src/services/editorTextHistory.ts` with normalized operation/group types and pure Aegisub-style continuity rules.
- Add `src/services/editorTextHistory.test.ts` first.
- Cover adjacent insertion, Backspace, Delete, operation changes, selection replacement, line break, cut/paste, replacement/drop/autocorrect, word deletion, unknown/missing `inputType`, cue changes, multi-code-unit deletion, non-contiguous positions, and the 30-second boundary.
- Keep timestamps injectable and keep the helper independent from React, timers, and Zustand.

Rollback point: the new module is isolated and unused until store integration.

## 2. Upgrade `projectStore` snapshots and revisions

- Replace cue-array history entries with revisioned cue/context snapshots.
- Add one private normal-mutation helper while keeping existing public cue actions thin and `replaceCues` atomic.
- Add explicit boundary actions that end groups/sessions even when a mutation is a no-op.
- Add grouped text-edit, text-selection, text-session accept/rollback, composition preview/promote/cancel, and caret-restore actions.
- Add `captureSaveSnapshot` and token-aware `markSaved`.
- Derive dirty state from cue/non-history revisions plus transient composition preview.
- Make style actions advance the non-history revision; make cascading style rename advance both cue and non-history revisions.
- Restore normalized active cue/multi-selection through `playbackStore` without touching time or playback state.
- Preserve the 50-entry bound, no-op behavior, session/document resets, and `setCues` history clearing.
- Replace raw test history fixtures with a shared initialized-history helper.

Expand `src/stores/projectStore.test.ts` for:

- one-item normal mutations and bounded history;
- grouped edit amend/new-group behavior and redo clearing;
- post-undo new text session followed by Escape restoring the old redo branch;
- no-op boundary termination;
- composition preview, commit, cancel, and lifecycle reset;
- saved-revision traversal, abandoned saved branch, edits during save, and failed-save token behavior;
- out-of-history style dirtiness and cascading rename;
- normalized selection/context fallback and stale caret invalidation;
- playback time/play state/segment-stop preservation.

Focused validation:

```bash
pnpm test -- src/services/editorTextHistory.test.ts src/stores/projectStore.test.ts
```

Rollback point: store tests must be green before component integration.

## 3. Integrate live text history and IME in `SubtitleEditor`

- Capture pre-edit selection/input type with `onBeforeInput`; submit the resulting value and post-edit selection to the grouped store action from `onChange`.
- Add `onSelect` synchronization for current caret/selection context.
- Add composition start/change/end integration with one-event duplicate suppression that expires in a microtask.
- Clear local composition suppression on cue/session/document changes.
- Consume nonce-backed selection restoration only for the matching active cue after controlled text renders.
- Preserve immediate preview, focus/blur no-op, Enter navigation/appending, and Escape discard.
- Ensure first input after undo/redo lazily starts a fresh cancellable session even when textarea focus never changed.
- Change single-row inline formatting/alignment to one discrete `updateCue` and synchronize its resulting selection; keep multi-row `replaceCues` unchanged.
- End text sessions/groups on blur, Enter, and non-text editor commands even when those commands no-op.

Add `src/components/editor/SubtitleEditor.test.tsx` (jsdom) covering:

- live undo before blur;
- insertion/Backspace/Delete integration using real `beforeinput` metadata;
- missing `beforeinput` fallback;
- IME preview, single commit, cancellation, duplicate suppression, and lifecycle reset;
- Enter/blur/cue-switch/no-op boundaries;
- post-undo typing then Escape restoring data and redo;
- caret/selection restoration without seeking;
- single-row formatting as one discrete item and batch behavior unchanged.

Rollback point: component integration can revert without changing normal non-text history callers.

## 4. Add focused time-draft command coordination

- Convert `SubtitleEditor` to expose `SubtitleEditorHistoryHandle.commitPendingTimeDraft()` through `forwardRef`/`useImperativeHandle`.
- Report reactive `hasPendingTimeDraft` by comparing normalized time drafts with the active cue.
- Mark only subtitle textarea and start/end time inputs as persistent history-command targets.
- Keep font search, quick formatting parameters, inline color/number drafts, and `StyleManager` inputs unmarked/native.
- Add changed-only baselines for quick font-size and inline outline/shadow parameter drafts so blur commits only after an actual parameter change; verify focus/blur alone adds no cue-history item.
- Do not change shared `ColorPicker` behavior for `StyleManager`.
- Mount a synchronous active-cue subscription in `EditorView` to accept the current text session/group on selection changes.

Focused validation:

```bash
pnpm test -- src/components/editor/SubtitleEditor.test.tsx src/components/editor/FontComboBox.test.ts
```

Rollback point: the imperative handle is editor-local and has no backend or ASS impact.

## 5. Route keyboard and playback commands through shared wrappers

- Add a history hotkey scope that matches outside editable controls and inside explicitly marked persistent controls.
- Preserve native undo/redo in unmarked transient inputs and preserve the IME composition guard.
- Change `EditorHotkeyOptions`/`buildEditorActions` to receive undo/redo callbacks rather than calling `projectStore` directly.
- In `EditorView`, use the same undo/redo wrappers for hotkeys and playback buttons:
  - Undo synchronously commits an effective pending time draft, then invokes project undo.
  - Redo is a prevented no-op without flushing when a time draft is pending; otherwise it invokes project redo.
- Enable Undo when `canUndo()` or an effective time draft is pending. Enable Redo only when `canRedo()` and no effective time draft is pending.
- Route the save button and hotkey directly to the same async `handleSave`; do not pre-flush before path selection.
- Do not intercept native undo/redo while a transient font/color/number/filter input is focused.

Update `src/components/editor/hotkeys.test.ts` and `src/hooks/useEditorHotkeys.test.ts` for:

- marked versus unmarked focused inputs;
- keyboard and button-equivalent callbacks;
- composition bypass;
- pending-time undo when no committed history item existed;
- pending-time redo disabled/no-op parity without flushing;
- no-op time draft behavior.

Focused validation:

```bash
pnpm test -- src/components/editor/hotkeys.test.ts src/hooks/useEditorHotkeys.test.ts src/components/editor/SubtitleEditor.test.tsx
```

Rollback point: command routing remains isolated from snapshot representation.

## 6. Make all save paths checkpoint-aware

- In editor save, route button/hotkey through the same async function; await path selection first and leave drafts untouched on cancellation, then flush pending time, resolve metadata, capture one store snapshot, serialize only that snapshot, and mark its token after successful write.
- In translation save, pair the immutable serialized output with the physical document/token loaded in the same synchronous section before the write await.
- In transcription save, finish video-info awaits first, then capture current cues/metadata and serialize the paired snapshot immediately before write.
- Ensure `setAssMetadata` does not independently advance revisions, while actual style-library actions do.
- Remove boolean-only `markSaved()` calls and the old textarea Escape `markSaved()` workaround.

Add tests at the store/call-site seam for:

- editor, translation, and transcription token/payload ordering;
- path-picker edits included in the captured editor snapshot;
- edits during file I/O remaining dirty after success;
- failed saves preserving the prior checkpoint;
- metadata normalization not creating a false dirty revision.

Focused validation:

```bash
pnpm test -- src/stores/projectStore.test.ts
pnpm build
```

Rollback point: token-aware save call sites can revert with the checkpoint API.

## 7. Full regression and review gate

- Verify every PRD requirement and acceptance criterion against the final diff.
- Confirm batch formatting, list operations, clipboard cut/paste, timeline dragging, time edits, inline formatting, row creation/deletion, and cascading style rename have the intended history/dirty behavior.
- Confirm project undo/redo never changes video time, play/pause state, or segment stop state.
- Confirm session/document load clears group/session/composition/restore state.
- Manually validate Japanese IME composition commit/cancel and post-composition duplicate events in Tauri/WebView2 if the local environment permits.
- Run:

```bash
pnpm test
pnpm build
```

No Rust/Python validation is required unless implementation unexpectedly crosses the frontend boundary. Record any WebView2-only validation limitation in the final report.

## Spec follow-up

After implementation checks pass, update the frontend state/hotkey specs to replace the old native-input undo rule and old selection-preservation rule with the approved unified-history contract.
