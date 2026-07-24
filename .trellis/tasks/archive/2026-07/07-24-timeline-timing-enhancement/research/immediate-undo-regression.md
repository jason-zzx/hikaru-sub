# Immediate Undo Regression Analysis

## Root Cause

Category: implicit local/Store synchronization assumption plus integration-test gap.

`SubtitleEditor.commitPendingTimeDraft()` inferred a draft solely by comparing local controlled time strings with the selected cue in `projectStore`. Timeline body drag and waveform range selection update the Store synchronously on pointer-up, while the effect that mirrors the new cue times into local inputs runs later. If `Ctrl+Z` arrived in that window, `EditorView.runUndo()` first called `commitPendingTimeDraft()`, which wrote the stale local times as a new history command; the following `undo()` only removed that stale write, leaving the timeline edit visible. Clicking elsewhere or waiting let the mirror effect run, which explains the inconsistent symptom.

Undo/redo routing also intentionally distinguishes persistent cue fields from transient inputs: `data-history-command` fields and non-input areas use project history; unmarked inputs retain native browser/WebView history.

## Fix

- Track actual user time-input editing with an explicit dirty ref.
- `commitPendingTimeDraft()` is a no-op unless that ref is set.
- Clear the ref when Store cue timing/document/selection synchronizes local input values, after commit, and on discard/reset.
- Keep undo/redo `history-command` scoped so subtitle text/time fields and canvas/list areas use project history while transient inputs keep native undo.

## Prevention

- Regression test the exact synchronous sequence: external cue timing update -> `commitPendingTimeDraft()` -> `undo()` before React effects flush.
- Test a genuine pending time draft remains a separate command from the preceding timeline command.
- Test Timeline body/range operations are immediately undoable.
- Test grouped subtitle text edits undo/redo through a marked field.
- Test unmarked transient inputs do not dispatch project history.

## Verification

- Focused history/editor/timeline tests pass.
- Full `pnpm test`: 100 files, 751 tests passed after removing one duplicate source-string guard.
- `pnpm build`: passed.
- `git diff --check`: passed.
