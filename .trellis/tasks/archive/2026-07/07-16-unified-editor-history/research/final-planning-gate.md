# Unified Editor History Final Planning Gate

## Verdict

**READY for `task.py start`.** No remaining planning blockers were found.

The latest PRD, design, implementation plan, and curated manifests are mutually consistent and address the blockers recorded in `research/planning-convergence-review.md`.

## Review findings

### No blockers

- **Pending-time Undo/Redo parity:** `prd.md` R12 and its acceptance criterion, `design.md` section 8, and `implement.md` section 5 now define the same behavior. A pending effective time draft enables Undo, disables Redo, Undo synchronously commits then reverses the draft, and keyboard Redo is a prevented non-flushing no-op matching the disabled playback button.
- **Save path before draft flush:** `prd.md` R14, `design.md` sections 8-9, and `implement.md` sections 5-6 consistently route save button/hotkey to one async editor-save function. Path selection resolves or cancels before the pending time draft is committed; cancellation leaves the draft unchanged.
- **Payload/token pairing:** `design.md` section 9 defines `captureSaveSnapshot()` and token-aware `markSaved(token)`, with concrete editor, translation, and transcription ordering. `implement.md` section 6 requires call-site seam tests for path-picker edits, in-flight edits, failures, and metadata normalization.
- **Changed-only transient parameters:** `implement.md` section 4 explicitly requires changed-only baselines for quick font-size and inline outline/shadow drafts. These inputs remain unmarked/native, while an actual apply/blur commit creates one discrete cue-history item. Shared `ColorPicker` behavior remains unchanged for `StyleManager`.
- **Escape/session behavior:** `prd.md` R6/R13, `design.md` section 5, and `implement.md` sections 2-3 cover no-op boundaries, post-undo lazy session creation, Escape rollback of the new branch, and restoration of the prior redo stack.
- **Selection normalization:** `prd.md` R10 and `design.md` section 7 require valid unique ids, preserve order, place the active cue last, provide deterministic fallback, replace stale caret requests, and avoid all playback-time/state mutations. Store and component test requirements cover these invariants.
- **IME:** `prd.md` R4/R8, `design.md` section 6, and `implement.md` sections 1-3 define transient composition preview, single promotion, bounded duplicate suppression, lifecycle reset, unknown-input fallback, and focused component tests.
- **Test coverage:** `implement.md` requires pure classifier tests, expanded store tests, a new jsdom `SubtitleEditor` suite, hotkey/action tests, save call-site seam tests, full `pnpm test`, and `pnpm build`. The focused matrices cover the risk areas listed in the task acceptance criteria.
- **Context manifests:** `implement.jsonl` and `check.jsonl` each contain six real frontend spec/research entries and no seed-only dependency.

## Validation

Command:

```bash
python ./.trellis/scripts/task.py validate 07-16-unified-editor-history
```

Result: passed. `implement.jsonl` and `check.jsonl` each validated with six entries; all context-file validations passed.

## Residual risks

- Japanese IME event ordering and a possible duplicate final input still require manual validation in Tauri/WebView2; jsdom cannot fully attest platform ordering.
- Controlled textarea caret restoration can race WebView rendering; nonce-backed tests reduce this risk but manual caret checks remain appropriate.
- Clipboard operations intentionally retain existing stale-result behavior when another cue edit overlaps asynchronous clipboard I/O.
- The existing 50-item bound remains; operation grouping prevents per-character exhaustion, but older mixed operations will still age out by design.

None of these residual risks blocks task activation because each is either explicitly scoped, has a safe fallback, or is assigned to the final manual review gate.
