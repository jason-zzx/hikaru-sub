# Persistent Subtitle Style Library — Technical Design

## 1. Overview

Add a versioned application-level style library without changing the ASS document model.

The minimum architecture is:

```text
StyleManager UI
  -> frontend style-library service (AssStyle validation + versioned JSON)
  -> typed wrapper in src/services/tauri.ts
  -> fixed-path Tauri commands
  -> <app_config_dir>/style-library.json
```

Current-document styles remain in `projectStore.assStyles` and continue to serialize into the active ASS file. Library styles remain independent snapshots and never enter `AssDocument` automatically.

## 2. Design Decisions

1. Store the library in a separate `style-library.json`, not `settings.json` or WebView `localStorage`.
2. Resolve its directory through `app_paths::app_config_dir()` so installed and portable modes keep their existing behavior.
3. Keep `AssStyle` ownership in `src/lib/ass`; Rust performs only fixed-path text I/O and does not define a duplicate style schema.
4. Keep library state local to `StyleManager`; no global Zustand store is needed because there is only one consumer.
5. Update the authoritative in-memory library only after a successful file write.
6. Reuse the existing drawer, tabs, buttons, `ConfirmDialog`, `FontComboBox`, `ColorPicker`, project-store style actions, and built-in defaults. Add no dependency.
7. Copy operations create detached shallow copies. Every `AssStyle` field is primitive, so `{ ...style }` is sufficient.
8. Use exact, case-sensitive name matching, consistent with the current document style lookups.

## 3. Persistence Contract

### 3.1 Fixed path

```text
<app_config_dir>/style-library.json
```

The frontend never supplies a path. Rust joins the fixed filename to the directory returned by `crate::app_paths::app_config_dir(app)`.

### 3.2 Version 1 payload

```json
{
  "version": 1,
  "styles": []
}
```

`styles` is an ordered array of canonical `AssStyle` objects. Ordering is preserved across edits and overwrites.

### 3.3 Tauri command surface

```text
load_style_library() -> Result<Option<String>, String>
save_style_library(content: String) -> Result<(), String>
```

- `None` means only that the file does not exist.
- Read errors must not be treated as a missing file.
- Save creates the configuration directory when necessary.
- Save creates a unique same-directory temporary file with `OpenOptions::create_new`, writes and flushes the complete content, then replaces the target.
- On Windows, follow the existing handwritten Win32 FFI precedent in `app_paths.rs`: use `ReplaceFileW` when the target exists and `MoveFileExW` with replacement/write-through flags for first creation. On non-Windows targets, use same-filesystem `std::fs::rename`.
- Never implement replacement as delete-target-then-rename. Failed replacement cleans up the temporary file and preserves the previous library file. No dependency is added.
- Commands use the fixed path only and return contextual Simplified Chinese error messages.
- The file is small and access is non-recursive, so synchronous file I/O is consistent with the existing settings implementation; no `spawn_blocking` or capability change is required.

### 3.4 Frontend schema owner

A focused `src/services/styleLibrary.ts` module owns:

- `STYLE_LIBRARY_VERSION = 1`;
- JSON parsing and serialization;
- validation of all current `AssStyle` fields;
- rejection of unsupported versions, malformed records, non-finite numbers, empty names, and duplicate exact names;
- first-run seeding through `createDefaultStyles()`;
- orchestration of raw Tauri load/save wrappers.

Numeric values are validated as finite but are not clamped. ASS files may contain valid values outside current UI input hints, and the library must preserve them rather than silently normalize them.

## 4. First-Run and Load Flow

1. The first drawer open for the mounted `StyleManager` starts one library load for that mounted component. Closing and reopening the drawer does not reload or reseed; a real unmount/remount may load the fixed file again.
2. A ref/in-flight guard ensures React Strict Mode does not start competing load or seed attempts; stale async completion is ignored after unmount. An explicit Retry after a load/seed failure resets only this guard and starts one new attempt.
3. The frontend service calls `load_style_library`.
4. If the file exists, parse and validate it. An existing `{ styles: [] }` remains empty.
5. If the file does not exist, create `createDefaultStyles()` and persist a version 1 file through the failure-safe replacement flow.
6. Expose Primary and Secondary only after the seed write succeeds. A failed seed leaves no claimed library state and can be retried.
7. Once a file exists, startup never re-adds a deleted default or overwrites an edited default.
8. Invalid JSON, an unsupported version, malformed styles, duplicate names, or I/O errors leave the library unavailable and show an inline retryable load error. They never overwrite the existing file.
9. Current-document style editing remains available even when the library cannot load.

## 5. UI Structure

Keep the existing `440px` drawer and add controlled tabs using `src/components/ui/tabs.tsx`.

### 5.1 Current Document tab

- Default tab whenever the drawer opens.
- Uses `projectStore.assStyles`.
- Keeps existing live field updates, rename/cascade confirmation, dirty-state behavior, immediate creation, and immediate unconfirmed document deletion.
- Adds **Save to Library** for the selected authoritative document style.
- The action is disabled while the document name field has an uncommitted rename or invalid name, while the library is not ready, or while a library write is pending.

### 5.2 Style Library tab

- Displays the last successfully loaded or written `libraryStyles`.
- Selecting an entry loads it into a local temp style (same pattern as Current Document).
- Non-name field edits update the temp style and persist the full library immediately.
- Rename commits on blur, then persists (no cue cascade; library has no cue refs).
- Create via + appends, selects, and persists immediately.
- **Add to Current Document** uses the selected authoritative library entry. It is disabled while loading/error, while a write is pending, or while a rename is uncommitted/invalid.
- Library deletion still requires confirmation.
- No library-tab “Save to Library” button and no dirty-draft navigation guards.

The existing style field UI is rendered once and receives mode-specific values and callbacks. Do not duplicate the form or create a generalized form framework.

## 6. Local State Model

`StyleManager` keeps the minimum additional state:

```text
activeTab                 current | library
libraryStyles             authoritative last successful load/write
libraryLoadState          idle | loading | ready | error
libraryError              load/write error shown in a shared drawer alert
librarySelectedName       selected persisted entry identity
libraryTempStyle          local edit buffer (mirrors document tempStyle)
libraryWritePending       disables overlapping library mutations
```

The existing current-document selection, temporary style, and rename state remain separate. A shared `role="alert"` below the tabs is visible from both tabs, so a Save to Library failure triggered from Current Document is immediately understandable without switching tabs.

## 7. Drawer Close Boundary

Both the drawer X and the EditorView toolbar use the normal `toggleStyleManager` close path. No draft guard and no `StyleManagerHandle` / `requestClose` are required because library edits live-persist.

## 8. Mutation Flows

### 8.1 Save a document style to the library

1. Require `libraryLoadState === ready` and no pending library write.
2. Clone the selected authoritative document style.
3. Find a library entry by exact name only.
4. If absent, append and persist.
5. If present, show exactly **Overwrite Style** and **Cancel**.
6. Confirming replaces the same-named entry in place and persists it.
7. Cancelling makes no change and performs no write.
8. Update `libraryStyles` only after write success.
9. If the overwritten name is currently selected in the library tab, refresh the selected library temp style from the successfully persisted snapshot.

No field comparison and no generated alternate name is allowed.

### 8.2 Live-edit, create, or rename a library style

1. Non-name field patch: update temp + in-memory list, then persist the full library.
2. Create: generate a unique name, append, select, persist immediately.
3. Rename on blur: trim/validate; reject empty or duplicate names; replace in place and persist.
4. On write success, replace `libraryStyles` and clear error state.
5. On write failure, keep UI values, show error, keep ready state; later edits retry write.

### 8.3 Add a library style to the document

1. Require a selected entry and no pending write / uncommitted invalid rename.
2. Clone the authoritative entry from `libraryStyles`.
3. Find a document style by exact name only.
4. If absent, call the existing `addStyle`.
5. If present, show exactly **Overwrite Style** and **Cancel**.
6. Confirming calls the existing `updateStyle(name, clone)`; cancelling makes no change.
7. Existing project-store behavior marks the document dirty and keeps the change outside cue undo history.

### 8.4 Delete a library style

1. Show exactly **Delete Style** and **Cancel**.
2. On confirmation, build the filtered library and persist it.
3. Update the authoritative list and clear selection only after write success.
4. On failure, keep the entry and selection.
5. Deleting every library entry is valid; an existing empty file remains empty on later loads.

### 8.5 Navigation

Selecting another style, switching tabs, and closing the drawer require no draft confirmation. Two-result copy and delete dialogs map Escape and backdrop dismissal to their no-op/cancel outcome.

## 9. Failure Matrix

| Condition | Behavior |
|---|---|
| Library file missing | Seed Primary and Secondary, persist them, then show the library. |
| Existing empty library | Keep it empty; do not reseed defaults. |
| Config directory creation fails | Show a library error; keep Current Document usable. |
| Existing file read fails | Show an error; do not seed or overwrite. |
| Invalid JSON/schema/version/duplicate names | Show a validation error; do not overwrite. |
| First-run seed write fails | Do not claim the library is ready, remove the temporary file, preserve the absence of the library file, and expose retry. |
| Save/copy-to-library/delete write fails | Show error, keep UI values, keep ready; later field edits, copy, or Delete retry the write. |
| Copy conflict is cancelled | Perform no write and no destination mutation. |
| Document-to-library overwrite targets the selected library entry | Refresh the selected library temp from the successfully persisted snapshot. |
| Library-to-document overwrite succeeds | Existing `updateStyle` marks the ASS document dirty. |
| Library failure while editing document | Document edits, undo behavior, and ASS save remain unaffected. |

## 10. Compatibility and Scope

No migration is required because no previous application-level library exists.

The following remain unchanged:

- `AssStyle`, `AssDocument`, ASS parse/serialize behavior;
- `projectStore` and `uiStore` ownership;
- current cue-reference rename behavior;
- current-document deletion behavior;
- `AppSettings` and `settings.json`;
- Tauri capabilities;
- saved ASS files unless the user explicitly copies a library style into the active document and later saves that ASS.

Explicitly excluded: import/export UI, cloud sync, file watching, global library stores, Rust style schemas, automatic cross-document synchronization, and new dependencies.

## 11. Error and Retry Semantics

A persistent inline `role="alert"` below the tabs reports load and mutation failures. A Retry button is shown only for load/seed failures and reruns the load flow. Mutation failures keep UI values and the ready state; later field edits, copy, or Delete retry the write without reloading the library.

## 12. Atomic Write Boundary

The style library is small, but it is user-authored data. The Rust helper writes a unique temporary file beside `style-library.json`, flushes the complete text, and then replaces the destination through `ReplaceFileW`/`MoveFileExW` on Windows or same-filesystem rename elsewhere. It removes the temporary file on every failure. The replacement helper has a controlled failure seam in Rust tests so a failed replacement is proven to leave the previous destination intact and a failed first-run seed leaves no library file to block retry.

## 13. Rollback Shape

The feature is isolated to a new fixed data file and focused UI wiring. Rolling back the code leaves `style-library.json` unused but does not affect existing ASS documents or application settings. No destructive migration or schema rewrite is involved.
