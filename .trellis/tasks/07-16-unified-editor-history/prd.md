# Unified Subtitle Editor Undo/Redo History

## Goal

Make all persistent `SubtitleCue` edits in the subtitle editor share one chronological project undo/redo history. `Ctrl/Cmd+Z`, `Ctrl/Cmd+Y`, and `Ctrl/Cmd+Shift+Z` must consume that history outside editable controls and while an explicitly marked persistent cue-edit control is focused. Transient command-parameter inputs retain browser-native text history until their value is applied as a cue edit.

## Background

- `projectStore` currently keeps at most 50 full cue-list snapshots and exposes project-level undo/redo for cue updates, insertion, deletion, and list replacement (`src/stores/projectStore.ts:6-9,50,147-164,252-276`).
- Subtitle text uses `updateCuePreview` on every input to update the preview immediately without recording history (`src/components/editor/SubtitleEditor.tsx:127-132`, `src/stores/projectStore.ts:166-181`). Blur later calls `updateCue`, but the store normally already contains the same text, so no history entry is created (`src/components/editor/SubtitleEditor.tsx:156-160`, `src/stores/projectStore.ts:147-164`).
- Undo/redo hotkeys currently match only outside editable controls (`src/components/editor/hotkeys.ts:85-87`). Inputs therefore use browser-native history while toolbar buttons use only project history.
- The existing immediate subtitle preview and the rule that focus/blur without an edit does not mark the project dirty must be preserved.

## Requirements

- **R1 - One chronological history:** Every committed in-scope subtitle edit must enter the same project-level history in commit order.
- **R2 - Focus-independent project commands:** Undo/redo shortcuts must operate project history outside editable controls and inside explicitly marked persistent cue-edit controls, including subtitle text and start/end time. They must not fall through to browser-native undo/redo in those controls.
- **R3 - Consistent entry points:** Keyboard shortcuts and playback-control undo/redo buttons must consume the same history and produce the same cue-data result.
- **R4 - Immediate preview:** Subtitle text changes, including IME composition previews, must continue to update the video subtitle preview while typing.
- **R5 - Aegisub-style text grouping:** Consecutive adjacent insertions coalesce into one history item. Consecutive Backspace deletions and consecutive Delete-key deletions each coalesce by operation type and positional continuity. A new group starts when the operation type changes, the caret or selection makes the edit non-contiguous, a selection is replaced, text is cut or pasted, inline formatting is applied, the active cue changes, another cue operation occurs, or input has been idle for 30 seconds. Intermediate IME composition values do not enter history; committed composition text participates as an insertion.
- **R6 - Branch semantics:** A new committed edit after undo clears the old redo branch. No-op edits must not create empty history entries. Escape may cancel a still-active text-edit session and restore the redo branch that existed before that session.
- **R7 - Lifecycle isolation:** Opening or switching video sessions and loading a new ASS document must clear history, active grouping, text-session, composition, and pending caret-restoration state.
- **R8 - IME safety:** Composition in progress must not trigger project undo/redo routing or record incomplete text in project history. Any duplicate post-composition input suppression must be limited to the immediately expected matching event.
- **R9 - Scope:** Unified history covers all edits that commit `SubtitleCue` data: subtitle text, start/end time, cue style, inline formatting, row creation/deletion, batch operations, cut, and paste. Transient UI drafts such as font search, quick formatting parameters, inline color channels, and filters retain native input behavior; applying such a value creates one discrete project-history item. ASS style-library changes in `StyleManager` remain outside undo history.
- **R10 - Editing context:** Each history state restores a normalized active cue, cue multi-selection, and the text caret/selection associated with subtitle-text edits. The active cue must be included as the last selected id; ids must be unique and valid for the restored cue list. Video time, play/pause state, and segment-play state are excluded.
- **R11 - Save checkpoint:** History tracks the exact cue and non-history revision represented by the most recently successful save. Undo/redo that returns exactly to that revision reports "saved"; moving away reports "unsaved." A new branch that makes the saved revision unreachable remains unsaved until the next successful save. Style-library changes remain dirty across cue undo because they are outside cue history.
- **R12 - Persistent local drafts:** Before save or undo, a changed start/end-time draft is normalized and committed synchronously as one cue-history item. Undo then reverses that just-committed edit. A pending changed time draft already represents a new branch, so redo is unavailable; keyboard redo is a prevented no-op and does not flush the draft, matching the disabled playback button. Focus/blur or command routing with no effective time change creates no history.
- **R13 - Escape and boundaries:** Escape discards all text-history groups created in the current uninterrupted text-edit session. Blur, Enter, save, undo/redo, a cue switch, and any non-text cue command accept/end that session and the current text group even when the boundary command itself changes no cue data. If focus remains after undo/redo, the next text input lazily starts a new cancellable session.
- **R14 - Save/data pairing:** Each save must serialize data captured synchronously with its save-checkpoint token. Editor save resolves or cancels any required save-path selection before committing a pending time draft and capturing data. Edits made while path selection or file I/O is awaiting must not be falsely marked saved, cancellation must leave drafts untouched, and failed saves must not move the checkpoint.
- **R15 - Architectural boundary:** Do not change the physical ASS-row model, ASS parsing/serialization, save paths, or backend interfaces.

## Acceptance Criteria

- [ ] After a subtitle text edit followed by another cue operation, repeated undo restores the two actions in strict reverse order; redo reapplies them in original order.
- [ ] Undo/redo shortcuts produce the same project-history result outside inputs and inside marked subtitle text/time controls; unmarked transient inputs retain native text history until their command is applied.
- [ ] Playback-control buttons and keyboard shortcuts share project-history availability and cue-data results: pending time enables Undo, disables Redo, Undo commits then reverses the draft, and Redo is a non-flushing no-op.
- [ ] Adjacent insertion runs, Backspace runs, and Delete runs coalesce independently. Type changes, non-contiguous positions, selection replacement, line breaks, cut/paste, formatting, cue switches, other cue edits, and 30 seconds of idle time reliably start a new group or discrete item.
- [ ] Multi-code-unit character deletion groups by positional continuity rather than assuming a one-code-unit change; unknown or missing browser input types safely create discrete items.
- [ ] Subtitle preview remains live while typing and during IME composition; focus followed by blur without an edit neither marks dirty nor adds history.
- [ ] Composition commits exactly once, cancellation adds no history, and a late composition event cannot mutate a switched or reloaded document.
- [ ] Undo followed by a new edit clears redo; Escape during that new text session restores both its baseline data and the prior redo branch.
- [ ] Cue switching, blur, Enter commit, Escape discard, save, undo/redo, and no-op boundary commands have explicit tested group/session behavior.
- [ ] Undo/redo restores normalized active cue, multi-selection, and text caret/selection without changing video time or playback state.
- [ ] Undo/redo returning to the latest saved revision reports "saved"; moving away reports "unsaved"; out-of-history style changes keep the project unsaved.
- [ ] Editor, translation, and transcription saves pair the serialized payload with the captured checkpoint and remain dirty if edits occur during an await or the save fails; cancelling editor path selection leaves pending drafts unchanged.
- [ ] Existing project-history behavior for row creation/deletion, timing, cue style, inline tags, batch edits, cut, and paste remains atomic and does not regress.
- [ ] Focused Vitest coverage, the full `pnpm test` suite, and `pnpm build` pass.

## Out of Scope

- Persisting history across application restarts.
- Changing the existing 50-item history limit unless implementation validation proves the unified history cannot work correctly within it.
- Including ASS style-library edits, transient search/filter/format-parameter drafts, video playback state, or playhead position in cue history.
- Changing the ASS model or introducing a backend history service.
- Changing the existing concurrency behavior of cut/paste if another cue edit occurs while system clipboard I/O is in flight; only the eventual committed result and its history position are in scope.

## Open Questions

None.
