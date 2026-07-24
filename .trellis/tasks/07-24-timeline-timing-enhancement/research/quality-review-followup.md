# Quality Review Follow-up

## Findings and Fixes

### Timeline body click could discard a time draft

A sub-threshold cue-body click changed the active cue on pointer-up without calling `commitPendingTimeDraft`. Because the canvas prevents the pointer default, input blur was not a reliable commit path. The click path now flushes the draft before re-reading and selecting the hit cue; the Timeline component test locks the callback contract.

### Shift dialog left global editor commands enabled

Radix can focus a radio item, which is not an editable target. With global hotkeys still enabled, Delete, stamping, navigation, and project history commands could affect the document behind the modal. `EditorView` now disables `useEditorHotkeys` while `shiftSelectionIds` owns an open dialog, with hook and wiring guards.

### Immediate draft undo left stale controlled input text

Submitting a real time draft and undoing it in one event can leave the Store at the same value React saw before the batch. The Store synchronization effect then has no changed dependency to observe, while the local input still contains the submitted draft. After `runUndo`, `EditorView` now calls `SubtitleEditor.syncTimeInputsFromStore()` to display the final Store timing. The regression test asserts both history state and visible input value.

## Ponytail Cleanup

A follow-up complexity review reused the existing Store-to-input synchronization function, removed two parameters that never varied, removed an unread gesture activation return value, and deleted a source-string test already covered by behavioral Timeline component tests. The production/test diff shrank by 17 lines without changing contracts.

## Documentation Status

- PRD and design include all three contracts.
- Frontend component guidelines preserve them for future work.
- `implement.md` reflects completed implementation/automated checks and leaves only the real Tauri WebView visual/pointer pass unchecked.
- The original interaction research is explicitly labeled as a pre-implementation snapshot.

## Verification

- Full `pnpm test`: 100 files / 751 tests passed.
- `pnpm build`: passed with the existing large-chunk warning only.
- `git diff --check`: passed.
