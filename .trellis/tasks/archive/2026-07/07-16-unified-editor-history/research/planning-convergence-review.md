# Unified Editor History Planning Convergence Review

## Verdict

**NOT READY for `task.py start`.** The revision resolves nearly all findings from `research/planning-review.md`, and the PRD is otherwise converged. Two remaining contradictions affect command parity and the required save/data ordering; independent implementers could make observably different choices.

## Blocking findings

### BLOCKER - Pending-time redo availability still differs between keyboard and button paths

**Artifacts:** `prd.md:18,27,36`; `design.md:157`; `implement.md` sections 4-5

R3 and its acceptance criterion require keyboard and playback buttons to share project-history availability and cue-data results. R12 says any redo request first commits an effective pending time draft, clearing the old redo branch.

The design enables Undo from `canUndo || hasPendingTimeDraft`, but leaves Redo enabled only from `canRedo`. Therefore, with a changed time draft and no existing redo entry:

- the keyboard redo shortcut reaches `runRedo`, commits the time draft, and leaves it committed;
- the playback Redo button is disabled and cannot perform the same operation.

This is a concrete availability/data mismatch, not only a UI-label difference.

**Minimum fix:** choose and document one rule in PRD/design/plan:

1. enable Redo from `canRedo || hasPendingTimeDraft`, so both entry points commit the draft and then no-op; or
2. define an unavailable redo as a no-op that does not flush drafts, guard the keyboard wrapper before flushing, and narrow R12 accordingly.

The first option is the smallest change to the already approved R12 semantics.

### BLOCKER - Save wrapper ordering contradicts the save-path capture contract

**Artifacts:** `prd.md:R14`; `design.md` sections 8-9; `implement.md` sections 5-6

The exact payload/token API is now well defined, and section 9 correctly requires editor save to await a save-path picker before committing the time draft and capturing the snapshot. However, section 8 says the shared `runSave` wrapper first commits the pending time draft and then executes save, while implementation section 5 likewise says the shared wrapper synchronously commits before capture. Section 6 instead says path selection happens first.

These orders differ when path selection is cancelled or when edits occur while it is awaiting. Only section 9/implementation section 6 satisfy R14.

**Minimum fix:** remove save from the unconditional pre-flush wrapper. Both the save button and hotkey should call one async editor-save function; that function resolves/cancels the path first, then synchronously commits pending time, resolves metadata, captures one save snapshot, serializes it, and starts I/O. Keep immediate pre-flush wrappers only for undo/redo.

## Non-blocking findings

### MEDIUM - Changed-only semantics for transient numeric command parameters should be an implementation action, not only a verification note

**Artifacts:** `implement.md` section 4; `src/components/editor/SubtitleEditor.tsx:316,577`; `src/components/editor/InlineOverridePanel.tsx:106,189,211`

The revised scope correctly leaves quick font-size and inline number inputs unmarked/native, and shared `ColorPicker` behavior is no longer changed. Current handlers nevertheless apply a formatting command on every blur, even if the parameter was only focused and never changed. The plan says to verify that no-change focus/blur adds no history, but does not explicitly say to track a parameter baseline/dirty flag and suppress the commit.

**Recommended clarification:** make changed-only commit behavior an explicit implementation bullet for quick font size and inline outline/shadow. This is not a product blocker because R6/R9 and the requested tests imply the intended result.

### MEDIUM - Japanese IME remains a manual platform risk

**Artifacts:** `design.md` section 6; `implement.md` sections 3 and 7

The one-event signature, microtask expiry, lifecycle reset, composition baseline, and unknown-input fallback resolve the earlier planning ambiguity. jsdom can exercise the state machine, but WebView2 can emit `compositionend` and final `input` in a different order. The planned manual validation is still required.

## Previously reported blocker resolution

- **Marked persistent-control scope:** resolved in the Goal, R2/R9, design section 8, and hotkey tests. Subtitle text/time are marked; transient command parameters retain native history.
- **Concrete time-draft coordinator:** resolved with `SubtitleEditorHistoryHandle.commitPendingTimeDraft()`, reactive `hasPendingTimeDraft`, and one `EditorView` owner. Only redo availability remains inconsistent.
- **Save payload/token pairing:** the `captureSaveSnapshot`/`markSaved(token)` contract and all three call-site orderings are concrete. Only the editor pre-picker wrapper contradiction remains.
- **Post-undo lazy session/Escape:** resolved by design section 5 and explicit store/component tests, including redo-branch restoration and no-op boundaries.
- **Transient/shared `ColorPicker`:** resolved; it remains unmarked and unchanged globally. Inline application becomes a discrete cue edit at its existing close/apply boundary.
- **Cascading rename revisions:** resolved; it advances cue and non-history revisions and has a dedicated test requirement.
- **Selection invariants:** resolved; IDs are valid/unique/order-preserving, active is last selected, and pending caret requests are replaced or cleared on every restore.
- **Browser input and IME cases:** resolved in the classifier and component test matrix, including line breaks, replacement/drop/autocorrect, word deletion, multi-code-unit deletion, missing `beforeinput`, bounded duplicate suppression, and lifecycle reset.
- **Async clipboard scope:** resolved explicitly in PRD Out of Scope and design compatibility notes.

## PRD convergence assessment

- The PRD is English-only, structured by goal/background/requirements/acceptance/out-of-scope, and contains no temporary brainstorm sections.
- Requirements are testable and do not otherwise conflict. R6 and R13 overlap only to distinguish branch semantics from session boundaries.
- `Open Questions` is genuinely empty; no additional product decision is required beyond reconciling the two artifact contradictions above.
- Acceptance criteria cover every high-risk behavior and are independently verifiable.
- The architecture is proportionate to approved R5/R10/R11/R13; no simpler native-history approach can preserve chronological cue operations, Aegisub grouping, Escape rollback, and save checkpoints together.
- `implement.jsonl` and `check.jsonl` contain valid real spec/research entries and `task.py validate` passes.

## Residual risks after minimum fixes

- Japanese IME event ordering and duplicate final input require manual WebView2 validation.
- Controlled textarea selection restoration may still race rendering; nonce-backed tests reduce but do not eliminate the need for manual caret checks.
- The task intentionally preserves stale-result behavior when clipboard I/O overlaps another cue edit.
- The 50-entry bound is retained; grouped text prevents per-character exhaustion, but large mixed edit sessions will still age out old history by design.
