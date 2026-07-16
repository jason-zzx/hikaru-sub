# Batch subtitle editing

## Goal

Allow users to apply right-panel formatting to multiple selected physical subtitle rows in one action, avoiding repetitive row-by-row edits.

## Background

- The left subtitle list stores multi-selection in `playbackStore.selectedCueIds`; its last ID is the active `selectedCueId` shown by the right editor.
- The right formatting panel currently targets only the active row. Style updates the cue directly, while other controls write ASS override tags into the active textarea text.
- Existing list-level batch actions use `projectStore.replaceCues`, which records one cue-list history entry for the whole operation.

## Requirements

- **R1 Selection target:** When more than one row is selected, supported formatting controls must update every cue in `selectedCueIds` without changing the selection.
- **R2 Formatting scope:** Batch-capable controls are style, font, font size, bold, italic, underline, strikeout, text/outline/shadow color, outline width, shadow distance, and alignment.
- **R3 Active-row controls:** Start/end time, subtitle text editing, new-row, and delete-row behavior remain scoped to the active row.
- **R4 Inline range:** With multiple rows selected, inline formatting applies to each selected row's complete `primaryText`; the active textarea's character selection is not projected onto other rows. With one selected row, the existing caret/text-selection behavior remains unchanged.
- **R5 Mixed values:** The right panel continues to display the active row's value and does not add an indeterminate state. Committing a value applies it uniformly to all selected rows.
- **R6 Apply commands:** B/I/U/S remain apply-format commands that add the requested whole-text formatting; they do not inspect and invert each row independently.
- **R7 Preservation:** A batch edit must preserve every selected row's unrelated timing, text content, layer, style/format properties, and list order. Rows outside the selection must remain unchanged.
- **R8 History:** Each committed batch formatting action must create at most one history entry. The existing `Ctrl+Z` undo and `Ctrl+Y` / `Ctrl+Shift+Z` redo commands must restore or reapply all affected rows as one unit.
- **R9 Subtitle model:** All behavior operates on physical ASS `Dialogue:` rows and must not introduce `subtitleMergeMode` branching or change ASS parsing/serialization semantics.

## Acceptance Criteria

- [ ] Style changes update every selected row and no unselected row.
- [ ] Font, font size, B/I/U/S, all inline colors, outline width, shadow distance, and alignment each update every selected row.
- [ ] Multi-row inline operations cover each selected row's full text regardless of the active textarea selection.
- [ ] Selected rows with different initial values are assigned the committed value without adding mixed-state UI.
- [ ] Unrelated cue fields, row order, and current multi-selection are preserved.
- [ ] With one selected row, formatting and textarea caret/selection behavior remain unchanged.
- [ ] Time, subtitle text, new-row, and delete-row operations retain their current active-row behavior.
- [ ] One undo shortcut reverses an entire batch and one redo shortcut reapplies it; no per-row undo steps are required.
- [ ] Focused automated tests cover multi-row transforms, unaffected rows, single-commit behavior, and batch undo/redo; `pnpm test` and `pnpm build` pass.

## Out of Scope

- Mixed/indeterminate formatting indicators or per-row toggle inversion.
- Changes to ASS parsing, serialization, bilingual subtitle generation, or translation merge modes.
- New backend, Tauri, or ASR functionality.
