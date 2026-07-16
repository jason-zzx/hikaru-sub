# Implementation Plan

## 1. Establish physical ASS row helpers

- Add a strict single-`Dialogue:` line parser and canonical formatter under `src/lib/ass/`; reuse existing ASS time and text conversion helpers.
- Add an explicit serialization option for preserving cue array order, keeping current sorted behavior as the default for existing non-editor callers.
- Add focused tests for canonical formatting, commas/newlines in Text, malformed lines, physical parsing, and order-preserving serialization.

Validation:

```bash
pnpm test -- src/lib/ass
```

Rollback point: ASS helpers and tests can be reverted without touching UI or native wiring.

## 2. Make translation output the bilingual boundary

- Refactor `TranslateView` to load the transcribed ASS as its page-owned source whenever the page is entered.
- Translate only those source cues, serialize the logical result using `settings.subtitleMergeMode`, then parse the generated text with `mergeBilingual: false` before loading it into `projectStore`.
- Keep translation-page success/statistics state separate from the physical editor cues so the translated result can still be inspected and re-run while the store is ready for editor/burn use.
- Ensure entering the page does not write or delete the existing translated ASS.
- Cover source reset and inline/separate physical expansion with focused helper/component tests.

Validation:

```bash
pnpm test -- src/components/workflow src/lib/ass
```

Rollback point: translation flow can return to direct logical `setCues` if the physical boundary fails review.

## 3. Remove merge-mode behavior from editor consumers

- Parse video-session and external ASS inputs with `mergeBilingual: false` before they reach the editor.
- Simplify `SubtitleList` to render one text value per physical cue.
- Simplify `SubtitleEditor` to one generic subtitle textarea and primary-text draft/commit/discard path.
- Remove settings-based merge mode from `VideoPlayer` and editor preview calls.
- Save editor and burn ASS without reading/reapplying `subtitleMergeMode`; preserve row order.
- Remove `useSubtitleMergeMode` after confirming no consumers remain.
- Update focused tests for physical ASS import, generic one-field editing, preview inputs, and save serialization.

Validation:

```bash
pnpm test -- src/components/editor src/components/player src/utils/subtitleImport.test.ts src/utils/assPreviewDocument.test.ts
```

Rollback point: keep the translation boundary commit logically separate from UI simplification while editing, even though no git commit is created without explicit user approval.

## 4. Add system clipboard support

- Install the official Tauri clipboard manager JS/Rust dependencies.
- Register the plugin and grant only read-text/write-text permissions to the main window.
- Replace the module-level cue clipboard with a focused async system clipboard service.
- Add a pure line-by-line paste helper that creates valid/fallback rows, assigns unique IDs, keeps mixed source order, and inserts one block after the target.
- Update hotkey and context-menu copy/cut/paste paths to await the shared service.
- Remove synchronous `hasCueRowClipboard` menu gating.
- Ensure cut deletion follows successful clipboard write and read failures are no-ops.

Validation:

```bash
pnpm test -- src/services/editorActions.test.ts src/hooks/useEditorHotkeys.test.ts src/components/editor/hotkeys.test.ts
cargo test --manifest-path src-tauri/Cargo.toml
```

Rollback point: plugin wiring and frontend clipboard orchestration can be reverted together without affecting the physical editor model.

## 5. Full quality gate

- Search for remaining editor/burn `subtitleMergeMode`, `useSubtitleMergeMode`, and in-memory clipboard references.
- Verify focused-input native hotkeys still bypass whole-row actions.
- Verify single/batch copy text, successful/failed cut, valid/plain/mixed paste, non-text no-op, fresh IDs, selection, and one-step undo.
- Verify inline/separate translation output enters the editor as physical rows and editor save does not reshape them.
- Run full frontend tests, production build, and Rust tests.

```bash
rg -n "useSubtitleMergeMode|hasCueRowClipboard|getCueRowClipboard|setCueRowClipboard" src
rg -n "subtitleMergeMode" src/components/editor src/components/player src/components/workflow/BurnView.tsx
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Risk notes

- `TranslateView` currently uses shared project cues for both source and output; separating page-owned logical state from physical editor state is the highest-risk behavioral change.
- Clipboard actions become asynchronous; stale closures and deletion-before-write must be checked explicitly.
- ASS event validation must not split Text on commas or treat malformed times as valid zero times.
- The frontend spec currently states that editor surfaces consume merge mode. After implementation and verification, update that documented contract to translation-only generation plus physical editor rows.
