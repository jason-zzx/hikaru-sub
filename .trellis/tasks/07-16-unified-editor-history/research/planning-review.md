# Unified editor history planning review

## Verdict

**NOT READY for `task.py start`.** The overall architecture is directionally sound and most complexity is justified by the approved Aegisub-style behavior, but four contracts remain ambiguous enough that independent implementers could produce incompatible behavior: editable-control scope, pending-draft command flushing, Escape after history commands, and save-token/data pairing.

## Severity-ranked findings

### BLOCKER — Goal scope contradicts the approved transient-control exception

**Artifacts:** `prd.md` Goal, R2, R9; `design.md` §7

The Goal says project undo/redo applies “regardless of whether an editable control is focused,” while R2 narrows this to “in-scope” controls and R9/design §7 intentionally leave font search, filters, and `StyleManager` inputs on native history. Those statements are observably different. `FontComboBox` is especially ambiguous because its typed value is transient but selecting an option commits a cue-format edit (`src/components/editor/FontComboBox.tsx`, `src/components/editor/SubtitleEditor.tsx:handleFontChange`).

**Minimum fix:** narrow the Goal and matching acceptance criterion to “outside editable controls or inside explicitly marked persistent cue-edit controls,” and state that transient/unmarked controls retain native input history even though the page-level project history still exists.

### BLOCKER — Pending-draft toolbar/keyboard equivalence is not executable as designed

**Artifacts:** `design.md` §7; `implement.md` §4

The plan says a data marker plus `EditorView` tracking will (a) blur a pending draft before save/undo/redo and (b) keep the undo button enabled when that draft would create the first history item. A data attribute alone does not provide reactive “changed” state to `EditorView`, and no owner/API/event contract is specified for nested drafts.

This matters because `PlaybackControls` disables undo from `canUndo` before a blur can commit the only pending edit (`src/components/player/PlaybackControls.tsx`). Keyboard undo could blur/commit/undo while the disabled button cannot be clicked, violating R3. Redo also needs an explicit rule: committing a pending draft clears the redo branch, so a pressed redo command will become a no-op after the flush.

Current controls add more edge cases:

- time fields commit on blur (`SubtitleEditor.tsx:commitTimeDraft`);
- quick font size calls `handleFontSizeCommit` on every blur and can insert an override even after focus/blur without changing the numeric draft;
- inline outline/shadow fields similarly call `commitNumber` on every blur (`InlineOverridePanel.tsx`);
- deferred inline color is not committed by input blur at all; `ColorPicker.closePicker` runs on outside `mousedown`, Escape, or swatch toggle, while channel-input blur only resets drafts (`ColorPicker.tsx`). Programmatic blur followed by a microtask can therefore undo an older action before the pending color is committed.

**Minimum fix:** specify one concrete draft-coordinator contract (owner, registration/change signal, flush method, and `hasPendingUndoableDraft` used by button state), or explicitly make these fields live grouped history. Define redo-after-flush behavior and require no-op focus/blur tests for every marked control.

### BLOCKER — Save tokens are not guaranteed to describe the serialized data

**Artifacts:** `design.md` §8; `implement.md` §5

“Obtain a save token from the exact store state being serialized” is correct but not operationally defined. A token-only API is insufficient if serialization reads a different snapshot:

- `EditorView.writeSubtitleFile` currently serializes React render closures (`cues`, `assScriptInfo`, `assStyles`), calls `setAssMetadata`, awaits I/O, then calls `markSaved`.
- `TranslateView` serializes `baseDoc`, reparses physical cues, calls `setCues`/`setAssMetadata`, then awaits save.
- `TranscribeView` calls `setCues`, awaits video-info work, constructs a local `doc`, calls `setAssMetadata`, then saves that local document. Capturing a later current-store token can falsely identify unrelated edits made during the video-info await as the saved content.

The design also does not define whether `setAssMetadata` advances `nonHistoryRevision`. It must not accidentally dirty save normalization, while actual `StyleManager` mutations must do so.

**Minimum fix:** define an atomic save-snapshot/token API or exact per-call-site ordering that pairs the serialized cues/metadata with the token. Explicitly cover editor save, translation save, transcription save, path-picker awaits, edits during I/O, failed save, and `setAssMetadata` revision behavior.

### BLOCKER — Escape session behavior after undo/redo has a missing transition

**Artifacts:** `design.md` §5; `implement.md` §§2–3

The design says undo/redo accepts/ends the active text session. Undo keeps the textarea focused, so a subsequent edit receives no new focus event. The plan does not say that the first post-undo input must lazily create a new edit-session checkpoint. Without that transition, Escape cannot discard text typed after undo, and a new edit that clears redo cannot restore the pre-edit redo branch on Escape.

The session boundary also cannot rely only on the normal mutation helper: Enter or another boundary may produce a cue no-op, and a helper that returns before bookkeeping would leave the group/session active despite R5 requiring a boundary.

**Minimum fix:** add a small explicit session state machine covering focus → edit → undo/redo → post-command edit → Escape, including how Escape restores the redo branch created before the new edit. State that boundary commands end sessions/groups even when their data mutation is a no-op.

### HIGH — Shared `ColorPicker` behavior can leak into out-of-scope `StyleManager`

**Artifacts:** `design.md` §7; `implement.md` §4

`ColorPicker` is shared by inline cue formatting and `StyleManager`. Changing it globally to close/commit on focus departure changes out-of-scope style editing, despite the design saying `StyleManager` remains unchanged.

**Minimum fix:** make history-draft marking and focus-leave flushing opt-in for inline usage, or keep the behavior in `InlineOverridePanel`; add one regression test that `StyleManager` still uses its existing native/draft behavior.

### HIGH — Revision rules for cascading style rename are incomplete

**Artifacts:** `design.md` §§3, 8; `implement.md` §2; `src/stores/projectStore.ts:renameStyle`

A cascading rename mutates both `assStyles` (out of cue history) and cue `style` fields (currently one cue-history item). The plan says style actions advance “only” `nonHistoryRevision`, which can be read as excluding a cue revision. Correct save semantics require a cascading rename to advance both: undo may restore cue references, but it cannot undo the style-library rename, so the project must remain dirty until saved.

**Minimum fix:** explicitly document and test cascading rename as a combined cue-history + non-history revision operation.

### HIGH — Restored selection must preserve playback-store invariants

**Artifacts:** `design.md` §6; `src/stores/playbackStore.ts`

The fallback order can produce a valid `activeCueId` that is absent from filtered `selectedCueIds`. Direct `playbackStore.setState` then creates a state impossible through existing setters, while editor batch logic reads both fields. The design also leaves stale caret requests unresolved when a snapshot’s cue no longer exists or `SubtitleEditor` is unmounted.

**Minimum fix:** define one normalization invariant (normally active cue is included and is the last selected id), preserve de-duplicated order, and clear/replace pending caret requests on every restore even when no matching textarea can consume them. Test empty, only, middle-delete, last-delete, stale multi-selection, and active-not-in-selection inputs.

### HIGH — Selection timing after list operations needs an explicit interpretation

**Artifacts:** R10; `design.md` §6; `SubtitleList.tsx:applyCueListResult`; `useEditorHotkeys.ts:applyCueListResult`

List actions call `replaceCues` first and update `playbackStore` selection afterward. A pre-mutation snapshot therefore has the old selection; a future snapshot created during undo observes whatever selection exists just before undo, which may have changed since the action. This may be acceptable (Aegisub updates the current state’s context as selection changes), but “each history state stores” is ambiguous.

**Minimum fix:** state whether selection-only changes amend the current revision’s context. If redo should restore the latest context of the state being left, capture live playback selection when creating the future snapshot; if it should restore the action’s immediate post-selection, call sites need an atomic cues+context commit contract.

### MEDIUM — Input-operation coverage omits important browser cases

**Artifacts:** R5; `design.md` §4; `implement.md` §1

The safe unknown-as-discrete fallback is good, but the plan should decide/test at least:

- `insertLineBreak` from Shift+Enter;
- `insertReplacementText`, drag/drop, autocorrect, and spellcheck replacements;
- `deleteWordBackward`/`deleteWordForward`;
- UTF-16 multi-unit/grapheme deletion (emoji or composed characters), where one Backspace can move by more than one code unit;
- a missing `beforeinput` record followed by `onChange`.

Do not assume one Backspace equals one UTF-16 code unit; coalescing should use contiguity, not a fixed delta.

### MEDIUM — IME duplicate suppression needs a bounded contract

**Artifacts:** `design.md` §5; `implement.md` §3

“Suppress an immediately duplicated post-composition input” is too vague. A value-only suppression can discard a legitimate same-value edit later. Composition preview/session baselines must also be cleared by session/document load so a late `compositionend` cannot resurrect an old document.

**Minimum fix:** define a one-event signature (cue id, final value, selection, and expected input type) that expires immediately after the next input/microtask, plus reset behavior on cue/session/document changes. Keep WebView2 manual validation as a residual risk.

### MEDIUM — Async row clipboard can violate strict chronology through stale cue lists

**Artifacts:** R1/R9; `useEditorHotkeys.ts`, `SubtitleList.tsx`

Cut/paste compute results from a cue list captured before asynchronous clipboard I/O. Another cue edit can commit while the read/write is pending; applying the old result later records the correct commit time but may overwrite the intervening edit. This is existing behavior, but the PRD’s strict chronological-history wording makes the expected result unclear.

**Minimum fix:** either explicitly preserve this existing concurrency limitation as out of scope, or require revalidation/recomputation against current cues before applying the async result. Do not silently broaden implementation without a decision.

### MEDIUM — Test plan is too vague around the riskiest integration seams

**Artifacts:** `implement.md` §§3–5

The plan names a new `SubtitleEditor.test.tsx` but does not require tests for:

- keyboard versus playback-button behavior when no committed undo item exists but a draft is pending;
- redo invalidation caused by flushing a pending draft;
- deferred inline color focus/blur/mousedown ordering;
- quick-number focus/blur without a change;
- save snapshot/token pairing at each of the three real call sites;
- post-undo typing followed by Escape;
- lifecycle reset of group/session/composition/pending-caret state.

The plan should also verify the available jsdom harness can dispatch `beforeinput` with `inputType`; a plain `change` event does not exercise grouping.

## Over-engineering assessment

The revision token, context snapshots, and pure text-operation classifier are justified by R5, R10, and R11. The edit-session checkpoint is also justified if current Escape-discard semantics remain mandatory. The main over-engineering risk is not the data model itself but allowing one generic “history state” object to accumulate unrelated DOM coordination details without explicit reset/state-machine rules. Keep DOM event capture and draft coordination at the editor boundary; keep deterministic snapshots, revisions, and grouping decisions in the store/pure service.

## Minimum artifact fixes before activation

1. Reconcile Goal/acceptance wording with transient/unmarked native controls.
2. Specify an executable pending-draft coordinator, button availability, redo-after-flush behavior, and opt-in inline `ColorPicker` integration.
3. Define save snapshot/token ordering for `EditorView`, `TranslateView`, and `TranscribeView`, including `setAssMetadata` and edits during awaits.
4. Add the post-undo lazy-session transition and no-op boundary rule for Escape/grouping.
5. Define cascading style rename revision behavior.
6. Define normalized selection invariants and pending-caret invalidation.
7. Expand the implementation tests for browser input types, IME reset/duplicate handling, draft command parity, save call sites, and lifecycle resets.
8. Explicitly accept or address stale async clipboard results.

## Residual risks after those fixes

- WebView2 Japanese IME event order and `inputType` values still require manual packaged-app validation.
- React blur/update ordering should be verified in both jsdom and WebView2; a microtask may need to become one animation frame if the packaged WebView batches differently.
- Controlled-textarea caret restoration can still race rendering; nonce tests reduce but cannot fully replace manual validation.
