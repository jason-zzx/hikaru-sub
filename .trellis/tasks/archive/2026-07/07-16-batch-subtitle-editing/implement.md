# Implementation plan

## 1. Add tested selected-cue formatting transforms

- Extend `src/services/editorActions.ts` with minimal pure helpers for selected-row style, attribute, toggle, and alignment changes.
- Reuse the existing ASS override-tag utilities; resolve restore tags from each cue's own style.
- Preserve unselected cues, list order, timing, layer, and unrelated cue fields.
- Add focused cases to `src/services/editorActions.test.ts` for multiple selected rows, different base styles, unaffected rows, and no-op style changes.

Rollback point: remove the helpers and tests without changing store or component contracts.

## 2. Wire the right formatting panel to multi-selection

- Subscribe `SubtitleEditor` to `selectedCueIds` and `replaceCues`.
- Keep the existing single-row handlers unchanged when the selection contains one row.
- Route style, font, font size, B/I/U/S, colors, outline width, shadow distance, and alignment through one `replaceCues` call when multiple rows are selected.
- Apply inline operations to each selected row's full `primaryText`; keep timing, text-field edits, new-row, and delete-row active-only.
- Do not add mixed-value UI or `subtitleMergeMode` branches.

Rollback point: restore formatting callbacks to the active-row-only path.

## 3. Preserve one-action history and shortcut behavior

- Avoid textarea caret restoration after multi-row formatting.
- Release font input focus after a multi-row font commit so existing project undo/redo shortcuts are immediately available.
- Fix `FontComboBox` option handling so a pointer click calls `onCommit` once rather than from both mouse-down and click.
- Extend `FontComboBox.test.ts` with a jsdom interaction check for one commit.
- Extend the existing editor hotkey/store test to apply a two-row replacement and verify one undo restores both rows and one redo reapplies both rows.

Rollback point: the focus adjustment and duplicate-commit fix are isolated from ASS formatting semantics.

## 4. Validate the frontend change

Run focused tests first:

```bash
pnpm test -- src/services/editorActions.test.ts src/components/editor/FontComboBox.test.ts src/hooks/useEditorHotkeys.test.ts src/utils/assOverrideTags.test.ts
```

Then run the required full checks:

```bash
pnpm test
pnpm build
```

Review gates:

- all right-panel formatting controls use the same multi-selection rule;
- one batch action creates one history entry and keyboard undo/redo covers the whole batch;
- rows outside the selection keep their original references and values;
- single-row textarea selection/caret behavior is unchanged;
- no backend, translation merge-mode, ASS parser, or serializer changes appear in the diff.
