# Aegisub text undo grouping

## Finding

Aegisub does not treat an entire focus session as one text undo item and does not push one project snapshot per character. Its subtitle text control delegates text-operation grouping to Scintilla, then mirrors those groups into Aegisub's document-level undo stack.

## Evidence

Aegisub binds the subtitle edit control's modified event and requests insertion, deletion, and `STARTACTION` notifications:

- [`src/subs_edit_box.cpp` lines 220-221](https://github.com/TypesettingTools/Aegisub/blob/4dfc7b2e5d5c861e337050a4fe8b708c6525f355/src/subs_edit_box.cpp#L220-L221)

When Scintilla marks a new action, Aegisub clears the amend id. Otherwise each live text change calls `CommitText`, which commits with `amend=true` so the latest project undo entry is replaced rather than appending another entry:

- [`src/subs_edit_box.cpp` lines 440-485](https://github.com/TypesettingTools/Aegisub/blob/4dfc7b2e5d5c861e337050a4fe8b708c6525f355/src/subs_edit_box.cpp#L440-L485)
- [`src/subs_controller.cpp` lines 310-350](https://github.com/TypesettingTools/Aegisub/blob/4dfc7b2e5d5c861e337050a4fe8b708c6525f355/src/subs_controller.cpp#L310-L350)

Aegisub also clears the amend id after a 30-second one-shot timer, providing a maximum idle boundary for a group:

- [`src/subs_edit_box.cpp` lines 227-229 and 451-459](https://github.com/TypesettingTools/Aegisub/blob/4dfc7b2e5d5c861e337050a4fe8b708c6525f355/src/subs_edit_box.cpp#L227-L229)
- [`src/subs_edit_box.cpp` lines 451-459](https://github.com/TypesettingTools/Aegisub/blob/4dfc7b2e5d5c861e337050a4fe8b708c6525f355/src/subs_edit_box.cpp#L451-L459)

Scintilla's undo algorithm explicitly coalesces operations that look like continuous typing or deletion. It starts a new group when operation types differ, inserted text is not immediately adjacent, or deletion no longer resembles repeated Backspace/Delete:

- [`src/UndoHistory.cxx` lines 230-319](https://github.com/mirror/scintilla/blob/c4f161912f4afff81b0697f52f78ad7f0620ac25/src/UndoHistory.cxx#L230-L319)

## Observable grouping model

- Consecutive adjacent insertions coalesce.
- Consecutive Backspace deletions coalesce when each next deletion extends backward from the previous one.
- Consecutive Delete-key deletions coalesce at the same position.
- Switching between insertion and deletion starts a new group.
- Moving the caret or editing a non-adjacent range starts a new group because positions no longer connect.
- Replacing a selection, paste, cut, formatting command, cue switch, or other project edit should be a discrete group.
- IME composition should not emit project history for intermediate composition values; the committed insertion can participate as one insertion action.

## Editing-context restoration

Aegisub history snapshots also keep the active subtitle line, row selection, text insertion point, and text selection, then restore them during undo/redo:

- [`src/subs_controller.cpp` lines 53-121](https://github.com/TypesettingTools/Aegisub/blob/4dfc7b2e5d5c861e337050a4fe8b708c6525f355/src/subs_controller.cpp#L53-L121)

This is separate from subtitle file data but prevents undo from restoring text into an invisible row or leaving the caret at an unrelated position. Aegisub does not treat video playback state as part of the text-edit history snapshot.

## Hikaru Sub implication

This behavior is implementable without adding a dependency. The textarea can classify browser `beforeinput` / `inputType` operations and supply a group identity to the existing project history. The first change in a group pushes the baseline cue-list snapshot; subsequent compatible changes amend the current state without pushing another snapshot. Existing non-text actions terminate the active text group and remain one history item each.

This is more complex than focus-session grouping but gives Aegisub-like, deterministic, operation-based undo granularity without consuming one history slot per character.
