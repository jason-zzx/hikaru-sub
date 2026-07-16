# Technical design

## Scope and boundary

This is a frontend-only editor change. It does not alter `SubtitleCue`, ASS parsing/serialization, translation merge modes, Tauri commands, or backend behavior.

The left list's existing `playbackStore.selectedCueIds` remains the selection source. `selectedCueId` remains the active row used to display timing, text, and the right panel's current values.

## Target resolution

`SubtitleEditor` will subscribe to `selectedCueIds` and distinguish two paths:

- Exactly one selected row: preserve every existing active-row operation, textarea selection, caret restoration, and history behavior.
- More than one selected row: formatting controls target all IDs in `selectedCueIds`; time, text, new-row, and delete-row controls still target only `selectedCueId`.

Missing or stale IDs are ignored. Selection order and selection state do not change after formatting.

## Batch cue transforms

Add focused pure helpers alongside the existing list actions in `src/services/editorActions.ts`. They will map selected cue IDs while preserving list order and unselected cue references:

- apply a cue style value;
- apply an attribute override to each cue's full `primaryText`;
- apply a B/I/U/S override pair to each cue's full `primaryText`;
- replace alignment in each cue's full `primaryText`.

Attribute operations resolve each cue's own referenced `AssStyle` before calling `restoreTagForStyle`. This prevents rows using different base styles from receiving the active row's restore value.

Whole-row attribute and toggle formatting reuses the existing `applyAttributeOverrideTag`, `applyToggleOverrideTag`, and `applyAlignmentReplace` utilities with the range `0..primaryText.length`. No new ASS tag parser or formatting model is introduced.

## Store and history contract

For a multi-row formatting commit, `SubtitleEditor` reads the latest cue list, computes one transformed list, and calls `projectStore.replaceCues` once. This yields one dirty/history transition regardless of selection size. Existing `undo` and `redo` actions then restore or reapply every affected row together through the existing `Ctrl+Z`, `Ctrl+Y`, and `Ctrl+Shift+Z` commands.

A transform that makes no actual cue changes preserves cue references so `replaceCues` remains a no-op and does not create an empty history entry.

Single-row operations continue using the existing `updateCue`, preview draft, and textarea handlers.

## UI state and focus

No mixed/indeterminate control state is added. The active row continues to supply visible values. Any committed control value is applied uniformly to all selected rows.

B/I/U/S remain apply-format commands; they do not inspect and invert each row independently.

Multi-row inline formatting does not restore the active textarea caret because no caret can represent all rows. A multi-row font commit releases the combobox input focus so project undo/redo shortcuts are immediately available. Single-row focus and caret behavior remains unchanged.

`FontComboBox` option handling will commit once per click: `onMouseDown` only prevents premature input blur, while `onClick` performs the commit. This is required to keep one user action equal to one tag application and one history entry.

## Compatibility and rollback

Existing ASS files and project data require no migration. Undo history remains in memory and retains its existing maximum depth.

The change can be rolled back by restoring active-row handlers in `SubtitleEditor` and removing the pure selected-cue transforms. There are no persistent schema or backend changes.
