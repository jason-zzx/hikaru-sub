# Persistent Subtitle Style Library — Implementation Plan

## Scope Guard

Implement only the reviewed PRD and design. Do not add import/export, cloud sync, file watching, migrations, a global library store, a Rust `AssStyle` schema, new dependencies, or changes to ASS parse/serialize behavior.

## 1. Add Fixed-Path Tauri Persistence

### Files

- Add `src-tauri/src/style_library.rs`
- Update `src-tauri/src/lib.rs`

### Work

- Add a fixed `style-library.json` path under `crate::app_paths::app_config_dir(app)`.
- Implement raw text commands:
  - `load_style_library() -> Result<Option<String>, String>`
  - `save_style_library(content: String) -> Result<(), String>`
- Distinguish a missing file from all other read failures.
- Create the configuration directory before writes.
- Create a unique same-directory temporary file with `OpenOptions::create_new`, write and flush the complete content, then replace the destination.
- On Windows, follow the existing handwritten Win32 FFI pattern in `app_paths.rs`: use `ReplaceFileW` for an existing target and `MoveFileExW` with replacement/write-through flags for first creation. On non-Windows targets, use same-filesystem `std::fs::rename`.
- Never delete the destination before replacement. Remove the temporary file on every failure so a failed save preserves the previous library and a failed first-run seed remains retryable.
- Return contextual Simplified Chinese errors without logging file contents.
- Register both commands in `tauri::generate_handler!`.
- Add pure helper tests in the Rust module for fixed path construction, missing-file reads, directory creation, round-trip writes, failed replacement preserving the previous destination through a controlled test-only failure seam, failed seed cleanup, platform replacement selection, and contextual errors.

### Checkpoint

```bash
cargo test --manifest-path src-tauri/Cargo.toml style_library
```

### Rollback Point

The new module and handler entries can be removed without affecting settings or ASS files.

## 2. Add the Frontend Persistence Service

### Files

- Update `src/services/tauri.ts`
- Add `src/services/styleLibrary.ts`
- Add `src/services/styleLibrary.test.ts`
- Add `src/services/tauriStyleLibrary.test.ts`

### Work

- Add typed raw wrappers:
  - `loadStyleLibraryText(): Promise<string | null>`
  - `saveStyleLibraryText(content: string): Promise<void>`
- In `styleLibrary.ts`, own the version 1 envelope, parser, validator, serializer, and first-run seed flow.
- Reuse canonical `AssStyle` and `createDefaultStyles()` from `src/lib/ass`.
- Validate every required primitive field, finite numeric values, trimmed non-empty names, exact-name uniqueness, and supported version.
- Preserve style order and numeric values; do not clamp UI ranges.
- Treat only `null` from the Tauri loader as first run.
- On first run, write Primary and Secondary before returning them as ready.
- Never seed an existing empty library or overwrite an invalid/unreadable file.

### Tests

Cover:

- exact invoke command names and payloads;
- first-run seed and successful round trip;
- existing empty library remains empty;
- edited/deleted defaults are not restored;
- malformed JSON, unsupported versions, missing/wrong fields, non-finite numbers, empty names, and duplicate names fail without writing;
- seed write failure rejects loading;
- serialization preserves every `AssStyle` field.

### Checkpoint

```bash
pnpm test -- src/services/styleLibrary.test.ts src/services/tauriStyleLibrary.test.ts
```

### Rollback Point

The service layer is isolated until `StyleManager` consumes it.

## 3. Extend StyleManager with Two Modes

### Files

- Update `src/components/editor/StyleManager.tsx`
- Update `src/components/editor/EditorView.tsx`
- Add `src/components/editor/StyleManager.test.tsx`
- Update `tests/StyleVisualEditingBehavior.test.ts` only where its source assertions need to reflect the new tabs/actions while preserving existing checks

### Work

#### 3.1 Preserve the Current Document tab

- Make Current Document the controlled default tab whenever the drawer opens.
- Keep all existing document-style behavior:
  - live non-name field edits;
  - existing name blur and cue-reference cascade confirmation;
  - immediate document style creation;
  - immediate unconfirmed document deletion;
  - current project dirty/history semantics;
  - default document-style fallback behavior.
- Add Save to Library for the selected authoritative document style.
- Disable the action while the document name edit is empty, conflicting, pending, or not yet committed, while the library is idle/loading/error, or while a library write is pending.

#### 3.2 Add local library state and loading

- Load the library once on the first drawer open for the mounted component. Closing and reopening does not reload or reseed; a real unmount/remount may load the fixed file again.
- Use a ref/in-flight guard so React Strict Mode cannot start competing load or seed attempts, and ignore stale async completion after unmount. Explicit load Retry resets the guard for exactly one new attempt.
- Keep `libraryStyles`, load/error/write state, selected name, and temp style local to `StyleManager` (document-like live-edit pattern).
- Show a shared inline `role="alert"` below the tabs so load and mutation errors are visible from both tabs. A Save to Library failure triggered from Current Document must be visible there immediately without switching tabs.
- Show Retry only for load/seed failures without blocking Current Document.
- Keep mutation failures in the ready state so later field edits, copy, or Delete can retry without reloading.
- Disable overlapping library mutations while a write is pending.

#### 3.3 Add the Style Library tab (live-save)

- Render the existing style controls against a library temp style (like document).
- Non-name field edits persist immediately via `saveStyleLibrary`.
- Rename commits on blur and persists; reject empty/duplicate names without write.
- Create appends a unique name and persists immediately.
- No library-tab “Save to Library” button and no dirty-draft messaging.
- Disable Add to Current Document while no selection, library not ready, write pending, or rename uncommitted/invalid.
- If a document-to-library overwrite targets the selected library entry, refresh its temp from the successfully persisted snapshot.

#### 3.4 Add copy conflict flows

For both directions, compare exact names only:

- destination name absent: perform the copy;
- destination name present: show Overwrite Style / Cancel;
- overwrite: replace in place;
- cancel: perform no write or store mutation;
- never compare style fields or generate an alternate name.

Document -> library must require a ready library, update the authoritative library only after a successful write, and map copy-dialog Escape/backdrop dismissal to the no-op outcome.

Library -> document must clone the selected persisted `libraryStyles` entry and reuse existing `addStyle` / `updateStyle` actions. Its copy dialog also maps Escape/backdrop dismissal to the no-op outcome.

#### 3.5 Deletion (no draft navigation guards)

- Library delete uses Delete Style / Cancel and updates state only after successful persistence.
- Current-document delete remains immediate and unconfirmed.
- No discard/keep-editing prompts for selection, tab switch, or close.

#### 3.6 Close paths

- Drawer X and EditorView toolbar both use `toggleStyleManager`.
- No `StyleManagerHandle` / `requestClose`.

#### 3.7 Keep one style form

- Reuse one rendered style-field form with mode-specific value/patch callbacks.
- Do not duplicate the full form and do not create a generalized form framework.
- Continue using existing shadcn primitives and Chinese UI copy.

### Component Tests

Cover the highest-value behaviors:

- opens on Current Document and preserves drawer width;
- existing document edits and deletion behavior remain unchanged;
- library field edits trigger saveStyleLibrary immediately;
- save failure keeps UI values and shows an alert;
- load failure disables document-to-library copy and does not invoke a save;
- create persists immediately; rename on blur persists; duplicate rename rejected;
- both copy directions use name-only overwrite/cancel behavior, including Escape/backdrop cancellation;
- Add to Current Document works without explicit save after live edit;
- document-to-library overwrite refreshes the selected library entry;
- library deletion confirms and applies only after successful write;
- selecting another style / switching tabs / closing after edit does not prompt discard;
- Strict Mode does not duplicate the first load/seed write, and closing/reopening the mounted drawer does not reload or reseed;
- a document-to-library failure is visible on the Current Document tab and leaves document editing usable;
- switching ASS documents leaves the loaded library unchanged while current-document styles change;
- existing empty library stays empty, and existing current-document default insertion/rename/cascade behavior remains unchanged.

### Checkpoint

```bash
pnpm test -- src/components/editor/StyleManager.test.tsx src/stores/projectStore.test.ts tests/StyleVisualEditingBehavior.test.ts
```

### Rollback Point

If the UI integration fails, revert `StyleManager` and `EditorView`; the isolated persistence module and service do not alter current-document behavior by themselves.

## 4. Full Quality Gate

Run the focused checks first, then the complete suites required for a cross-layer user-visible feature.

```bash
pnpm test -- src/services/styleLibrary.test.ts src/services/tauriStyleLibrary.test.ts src/components/editor/StyleManager.test.tsx src/stores/projectStore.test.ts tests/StyleVisualEditingBehavior.test.ts
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml style_library
cargo test --manifest-path src-tauri/Cargo.toml
```

Manually verify:

1. First open creates Primary and Secondary and they survive restart.
2. Deleting or editing a default persists without startup restoration.
3. Current Document and Style Library remain detached after copies.
4. Same-name copies offer only overwrite or cancel.
5. Library field edits, create, and rename-on-blur persist immediately; no discard/keep-editing prompts on select, tab switch, or close.
6. Add to Current Document works after a live library edit without an explicit Save button.
7. Library load/write errors leave Current Document usable.
8. Portable mode resolves the library under `<exe>/data`; installed/dev mode uses the existing application config directory.
9. Toolbar button stays labeled 样式管理 and only toggles the drawer.

## 5. Review Gate Before Completion

- Verify the implementation against every PRD acceptance criterion.
- Confirm no new dependency, capability, global store, `AppSettings` field, Rust style schema, or ASS pipeline change was introduced.
- Confirm all user-facing strings are Simplified Chinese and product naming remains `Hikaru Sub`.
- Confirm only library persistence writes `style-library.json`; no library operation opens or rewrites unrelated ASS files.
