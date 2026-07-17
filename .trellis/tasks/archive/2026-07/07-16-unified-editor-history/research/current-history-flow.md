# Current editor history flow

## Project-level history

- `src/stores/projectStore.ts` stores `past` and `future` as complete `SubtitleCue[][]` snapshots with `MAX_HISTORY = 50`.
- `updateCue`, `replaceCues`, `addCue`, and `deleteCue` push one previous cue-list snapshot and clear `future` when a real cue change occurs.
- `undo`/`redo` replace the whole cue list. Playback selection is held in a different store and is not part of history.
- ASS style-library mutations are intentionally outside cue history; tests currently assert that contract.

## Subtitle text flow

- `SubtitleEditor` keeps local `text` state and captures a per-focus baseline.
- Each textarea change calls `updateCuePreview`, immediately updating the store for video preview and dirty state without pushing history.
- Blur/Enter later call `updateCue`, but the store already contains the previewed value; `hasCueChanges` short-circuits, so the text edit normally creates no project-history entry.
- Escape restores the captured baseline through `updateCuePreview` and restores the clean flag when appropriate.

## Shortcut split

- `Ctrl/Cmd+Z`, `Ctrl/Cmd+Y`, and `Ctrl/Cmd+Shift+Z` are declared with `outside-input` scope.
- The window hotkey dispatcher therefore operates project history only outside editable controls. Inside an input/textarea/contentEditable element, browser-native undo/redo remains active.
- Playback-control undo/redo buttons always call projectStore history and cannot access browser-native input history.

## Prior rationale recovered from project history

A July editor-style task introduced `updateCuePreview` to satisfy immediate subtitle preview while avoiding a history entry for every keystroke and avoiding dirty state on focus/blur without edits. The new task must preserve those user-visible outcomes while replacing the split native/project undo behavior.

The archived batch-subtitle-editing task established that one committed multi-row formatting action must remain one history item. Existing `replaceCues` is the shared seam for those list-level actions.

## Planning implications

- Changing shortcut scope alone is insufficient because the project history currently has no committed text item to undo.
- Calling normal `updateCue` on every `onChange` would technically unify histories but would create one full cue-list snapshot per keystroke and quickly consume the 50-entry limit.
- The minimum viable design needs an explicit text-edit transaction or history-group boundary while retaining preview writes.
- Product decisions are still needed for input scope, typing-group boundaries, and whether UI selection/caret belongs to history.
