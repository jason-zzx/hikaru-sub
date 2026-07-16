# Current editor formatting and history flow

## Selection ownership

- `src/stores/playbackStore.ts` stores both `selectedCueId` and `selectedCueIds`.
- `setSelectedCueIds` deduplicates the selection and makes its last ID the active `selectedCueId`.
- `src/components/editor/SubtitleList.tsx` already supports Ctrl/Meta additive selection and Shift range selection.
- `src/components/editor/SubtitleEditor.tsx` subscribes only to `selectedCueId`, so every formatting control currently edits the active row even when `selectedCueIds` contains multiple rows.

## Current formatting paths

- Style selection calls `projectStore.updateCue(activeId, { style })`.
- Font, font size, colors, outline, and shadow call `applyAttributeOverrideTag` against the active textarea selection.
- B/I/U/S call `applyToggleOverrideTag` against the active textarea selection.
- Alignment calls `applyAlignmentReplace` for the active row.
- Attribute restore tags must use the selected cue's referenced ASS style through `restoreTagForStyle`; a batch transform therefore needs to resolve style per cue rather than reuse only the active cue's style.

## Undo and redo

- `projectStore.updateCue` and `projectStore.replaceCues` each push one cue-list snapshot into history when values change.
- Existing list-level batch actions call `replaceCues` once, making the whole action one undo step.
- Editor shortcuts already dispatch `Ctrl+Z` to `projectStore.undo` and `Ctrl+Y` / `Ctrl+Shift+Z` to `projectStore.redo` outside editable controls.
- Multi-row formatting should therefore build one next cue list and call `replaceCues` exactly once per committed control action. Calling `updateCue` once per selected row would incorrectly create one history entry per row.

## Focus and duplicate-commit risks

- Single-row inline formatting intentionally restores focus and the caret to the textarea. That behavior must remain unchanged.
- Multi-row formatting has no meaningful shared caret. It should not refocus the textarea after applying whole-row changes, so the existing global undo/redo shortcut remains available from formatting buttons.
- `FontComboBox` currently calls `commit(fontName)` from both an option's `onMouseDown` and `onClick`. A mouse selection can invoke `onCommit` twice, which would duplicate ASS tags and create more than one history entry. Keep `onMouseDown` only for preventing input blur and commit once from `onClick`.
- The font combobox input remains an editable target after commit. For a multi-row commit, release that input focus so the existing outside-input undo/redo shortcuts can immediately target project history without changing native single-row text undo semantics.

## Testing seams

- Pure cue-list actions already live in `src/services/editorActions.ts` with tests in `editorActions.test.ts`; selected-cue formatting transforms can reuse that seam.
- `useEditorHotkeys.test.ts` already verifies project-store undo/redo dispatch and can be extended to assert a two-row batch is undone/redone as one action.
- `FontComboBox.test.ts` can add a jsdom interaction assertion that one option click invokes `onCommit` once.
