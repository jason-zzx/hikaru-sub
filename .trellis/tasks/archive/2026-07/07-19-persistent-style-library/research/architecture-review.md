# Architecture Review: Persistent Subtitle Style Library

## Executive decision

The proposed direction is the minimum architecture that fits the approved PRD:

- persist a separate, versioned `style-library.json` under `app_paths::app_config_dir`;
- let Rust own only the fixed path and text file I/O;
- let the frontend own the `AssStyle` schema, JSON parsing/validation, version check, and first-run default seeding;
- keep the loaded library and a document-like local temp style in `StyleManager` rather than adding a Zustand store;
- live-persist library field edits, create, and rename-on-blur (same semantics as Current Document).

This preserves the existing ASS document boundary and avoids duplicating `AssStyle` in Rust. Because library edits live-persist, the drawer X and EditorView toolbar both use normal `toggleStyleManager`; no draft guard and no `StyleManagerHandle` / `requestClose` are required. The toolbar label stays 样式管理.

## Current architecture findings

### `AssStyle` and document ownership

- The canonical `AssStyle` interface is `src/lib/ass/types.ts`. It is a flat object containing only primitive fields, so `{ ...style }` is a sufficient detached snapshot; no deep-clone library is needed.
- Built-in Primary and Secondary styles already come from `createDefaultStyles()` in `src/lib/ass/defaults.ts`. The persistent library should reuse this function for first-run seeding rather than copying default values into a second schema.
- ASS parse and serialization already own document styles as `AssDocument.styles`. No library data should enter `AssDocument`, `parseAss`, or `serializeAss`.

### `projectStore` style behavior

`src/stores/projectStore.ts` owns current-document `assStyles` and already exposes all operations needed for copies into the document:

- `addStyle(style)` appends and advances `nonHistoryRevision`;
- `updateStyle(name, updates)` replaces fields on a same-named style and advances `nonHistoryRevision`;
- `deleteStyle(name)` removes the document style without changing cue references;
- `renameStyle(oldName, newName, cascade)` preserves the current cue-reference confirmation behavior.

The existing store tests in `src/stores/projectStore.test.ts` establish the required regression contract: style edits dirty the project, do not enter cue undo history, deletion does not rewrite cue references, and cascading rename is the only style operation that can create a cue-history item.

No project-store change is needed:

- library -> document, no conflict: `addStyle({ ...persistedLibraryStyle })`;
- library -> document, confirmed same-name overwrite: `updateStyle(name, { ...persistedLibraryStyle })`;
- cancel: no store call.

Using `updateStyle` for overwrite intentionally does not compare fields. That matches the PRD rule that copy conflict detection depends on the name only. It can dirty the document even if the confirmed replacement is field-identical, which is preferable to introducing forbidden field-comparison semantics.

### Current `StyleManager`

`src/components/editor/StyleManager.tsx` is a manually rendered fixed right drawer with the required existing width:

```text
w-[440px] max-w-[calc(100vw-24px)]
```

Current-document editing is live:

- non-name field changes update both `tempStyle` and `projectStore` immediately;
- name editing remains temporary until blur because it may need the existing cue-reference rename confirmation;
- document deletion is immediate and unconfirmed;
- when a document has no styles, opening the manager inserts the built-in defaults into the document.

That behavior should remain in the Current Document tab. In particular, the library must not reuse the current `displayStyles = assStyles.length > 0 ? assStyles : createDefaultStyles()` fallback. An existing, intentionally empty library is valid and must stay empty after restart.

`StyleManager` is only rendered from `EditorView`, so a new application-wide store would have no second consumer. Local component state is the smaller and clearer ownership model.

### Drawer close seam

The open flag is stored in `uiStore.styleManagerOpen`. Both close paths use normal `toggleStyleManager`:

1. the close icon inside `StyleManager`;
2. the toolbar button in `EditorView`, which stays labeled 样式管理 and only toggles the drawer.

No draft navigation guard is needed because library edits live-persist (or retry on the next edit after a write failure).

### Paths and Tauri wiring

`src-tauri/src/app_paths.rs` already defines the correct compatibility boundary:

- installed / `tauri dev`: Tauri `app_config_dir()`;
- portable: `<exe>/data` after successful portable bootstrap.

The style library module should call `crate::app_paths::app_config_dir(app)` and join the fixed file name `style-library.json`. It must not call raw Tauri path APIs and must not accept a path from the frontend.

The required command chain is the existing project pattern:

```text
src-tauri/src/style_library.rs
  -> src-tauri/src/lib.rs generate_handler!
  -> src/services/tauri.ts wrappers
  -> src/services/styleLibrary.ts schema/orchestration
  -> StyleManager
```

Because the commands use Rust `std::fs` internally rather than the frontend FS plugin, no capability change is required. The file is small and access is non-recursive, so a synchronous command is consistent with `settings.rs`; `spawn_blocking` is not required by the repository rule for recursive/heavy disk work.

### Existing UI primitives

The existing primitives are enough; no dependency or new shadcn generation is needed:

- `src/components/ui/tabs.tsx`: controlled Current Document / Style Library tabs;
- `src/components/ui/ConfirmDialog.tsx`: existing multi-option dialog, usable for all required two-result confirmations and the existing three-result document rename;
- `src/components/ui/button.tsx`: action buttons;
- existing `FontComboBox`, `ColorPicker`, and style form controls.

The current manual drawer should remain instead of migrating to `Sheet`: `Sheet` has different default width/overlay/close behavior and would widen the change. The style form can be extracted as a private component or render helper inside `StyleManager.tsx` so both tabs share exactly the same controls without creating another business component file.

## Recommended persistence contract

### File and schema

Fixed path:

```text
<app_config_dir>/style-library.json
```

Version 1 payload:

```json
{
  "version": 1,
  "styles": [
    {
      "name": "Primary",
      "fontName": "Noto Sans SC",
      "fontSize": 54,
      "primaryColor": "&H00FFFFFF",
      "secondaryColor": "&H000000FF",
      "outlineColor": "&H00000000",
      "backColor": "&H80000000",
      "bold": false,
      "italic": false,
      "underline": false,
      "strikeOut": false,
      "scaleX": 100,
      "scaleY": 100,
      "spacing": 0,
      "angle": 0,
      "borderStyle": 1,
      "outline": 2,
      "shadow": 1,
      "alignment": 2,
      "marginL": 20,
      "marginR": 20,
      "marginV": 40,
      "encoding": 1
    }
  ]
}
```

Recommended frontend constants/types stay private to `src/services/styleLibrary.ts`:

```text
STYLE_LIBRARY_VERSION = 1
StyleLibraryFile = { version: 1; styles: AssStyle[] }
```

There is no need to add an IPC type to `src/types/index.ts`, because the Tauri boundary is only `string | null` on read and `string` on write. `AssStyle` remains canonical in `src/lib/ass`.

### Frontend validation

The file is local but still untrusted input. The parser should:

- require a non-null object root;
- require exactly supported `version === 1`;
- require `styles` to be an array;
- require every current `AssStyle` field with the correct primitive type;
- reject non-finite numeric values;
- require a non-empty, trimmed style name;
- reject duplicate exact names;
- reject unsupported versions rather than resetting or overwriting the file.

The smallest maintainable validator can use `createDefaultStyles()[0]` as the required field/type template, reconstructing each accepted object in canonical field order. This reuses the existing schema-shaped default instead of maintaining parallel string/number/boolean field lists. Do not add a schema dependency for one small flat object.

Avoid clamping numeric ranges during load. Current ASS documents can contain values outside the UI input hints, and a reusable style library should preserve a valid `AssStyle` snapshot rather than silently normalize it. Type/finite/name/uniqueness validation is enough for this boundary.

### Rust commands

Recommended command surface:

```text
load_style_library() -> Result<Option<String>, String>
save_style_library(content: String) -> Result<(), String>
```

`None` must mean only “the fixed file does not exist.” Other read failures must be errors. This distinction is necessary so first-run seeding does not overwrite an unreadable file.

Rust should:

- resolve `app_config_dir` through `app_paths`;
- create the config directory before write;
- read/write only `style-library.json`;
- return contextual Simplified Chinese read/write errors without exposing file contents;
- not parse JSON, know `AssStyle`, seed defaults, or accept arbitrary paths.

The style library should use a unique same-directory temporary file followed by platform-correct replacement. On Windows, follow the existing handwritten Win32 FFI precedent in `app_paths.rs`: use `ReplaceFileW` for an existing target and `MoveFileExW` with replacement/write-through flags for first creation. On non-Windows targets, use same-filesystem `std::fs::rename`. Never delete the target before replacement. This keeps the previous library intact when writing or replacement fails and leaves no file behind when first-run seeding fails, without a new dependency or duplicate style schema.

## Concrete data flow

### 1. Open and load

1. Opening the drawer always sets the controlled tab to Current Document.
2. On the first open for that mounted `StyleManager`, call `loadStyleLibrary()` from `src/services/styleLibrary.ts`. Closing and reopening the mounted drawer does not reload or reseed; a real remount may read the fixed file again.
3. A ref/in-flight guard prevents React Strict Mode from starting competing load or seed attempts, and stale completion is ignored after unmount. Explicit load Retry resets the guard for one new attempt.
4. The service calls `loadStyleLibraryText()` in `tauri.ts`.
5. If text exists, parse and validate it, then return detached `AssStyle` objects.
6. If the Rust command returns `null`, create `createDefaultStyles()`, serialize version 1, and write it through the failure-safe replacement flow.
7. Only after that seed write succeeds does the service return the defaults and the component set authoritative `libraryStyles`.
8. If the file exists with `styles: []`, return an empty array and do not seed anything.

This satisfies “seed once” without a sentinel setting. File existence is the sentinel.

### 2. Current Document tab

- Continue selecting and editing `projectStore.assStyles` exactly as today.
- Continue live updates for all non-name fields.
- Continue the current blur/cascade behavior for document rename.
- Continue immediate current-document deletion without the new library confirmation.
- “Save to Library” copies the authoritative selected document style, not an uncommitted name draft.
- If the name field currently differs from `editingStyleName`, or if the library is not ready, disable the copy action until rename/load state is resolved; otherwise a click after blur could copy a proposed name or overwrite an unavailable library.

### 3. Style Library tab (live-save)

Keep separate local state from the document editor state, mirroring the document temp-style pattern:

```text
libraryStyles              authoritative last successfully loaded/written list
librarySelectedName        selected entry identity
libraryTempStyle           local edit buffer (mirrors document tempStyle)
libraryLoadState           idle | loading | ready | error
libraryWritePending        serializes writes and disables racing mutations
libraryError               load/write error in a shared drawer alert
```

- Selecting an entry loads it into `libraryTempStyle`.
- Non-name field edits update temp + in-memory list and persist the full library immediately.
- Create appends a unique name, selects it, and persists immediately.
- Rename commits on blur (no cue cascade), then persists; reject empty/duplicate names without write.
- No library-tab “Save to Library” button and no dirty-draft navigation guards.
- On write failure: keep UI values, show error, keep ready; later field edits, copy, or Delete retry the write.

Because every `AssStyle` field is primitive and every transition uses a spread/reconstruction, later editing cannot mutate the document copy or library copy by reference.

### 4. Current document -> library copy

1. Require the library to be ready and no library write to be pending.
2. Read the selected authoritative document style from `projectStore.assStyles`.
3. Clone it.
4. Find a library entry by exact `style.name` only.
5. If absent, build append result and write immediately.
6. If present, show exactly two choices: overwrite or cancel; Escape and backdrop dismissal are cancel.
7. On overwrite, replace the one same-named library entry and write.
8. Only after write success update `libraryStyles`; if that name is selected, refresh its temp style from the persisted snapshot.
9. On cancel or write error, neither destination memory nor document styles change.

No field comparison and no auto-generated renamed copy should occur.

### 5. Library -> current document copy

Add to Current Document uses the currently selected entry from `libraryStyles`. It may be disabled while the library is not ready, a write is pending, or a rename is uncommitted/invalid.

1. Resolve the selected entry from `libraryStyles` and clone it.
2. Find a document entry by exact name only.
3. If absent, call `addStyle(clone)`.
4. If present, show exactly overwrite/cancel.
5. On overwrite, call `updateStyle(name, clone)`.
6. Do not mutate `libraryStyles` or the library temp style.

The existing store actions provide document dirty tracking and save-to-ASS behavior automatically.

### 6. Library deletion

- Clicking a library trash action opens a two-choice delete/cancel confirmation.
- Build the filtered `nextStyles`, write it, and only then replace `libraryStyles`.
- If deleting the selected entry succeeds, clear its selection/temp.
- If the write fails, keep the entry and selection available.
- Current-document trash actions continue calling `projectStore.deleteStyle` directly and must not use this dialog.

Deleting all library entries is valid. Later loads must keep the empty list and must not reinsert defaults.

### 7. Navigation (no draft guard)

Selecting another library style, switching tabs, or closing the drawer requires no discard/keep-editing prompt. Two-result copy and delete dialogs map Escape and backdrop dismissal to their no-op/cancel result. While a library write is pending, disable overlapping library mutations.

### 8. Video and application boundaries

- `setSession`, `clearSession`, and `loadAssDocument` continue replacing only current-document ASS state.
- `libraryStyles` is independent and therefore unchanged while the mounted editor switches document data.
- If `EditorView` unmounts and remounts, the next manager open reloads the fixed file.
- Application restart naturally reloads the file.
- No saved ASS file is opened or rewritten by a library mutation. Only an explicit library -> current document copy puts a snapshot into the active document, and the existing ASS save flow later writes that document.

## Failure behavior matrix

| Failure | Required behavior |
|---|---|
| Library file missing | Seed Primary/Secondary, write version 1, then expose the list. |
| Config directory cannot be created | Show library error; keep Current Document tab usable. |
| Existing file cannot be read | Show error; do not treat it as missing and do not seed/overwrite. |
| Invalid JSON, unsupported version, malformed style, duplicate name | Show validation error; do not overwrite the file; current-document styles remain usable. |
| First-run seed write fails | Do not claim the library is ready; clean up the temporary file so retry still sees a missing library; document state is untouched. |
| Save/edit/rename/delete/copy-to-library write fails | Show error, keep UI values, keep ready; later field edits, copy, or Delete retry the write. |
| Copy conflict cancelled | Make no destination change and perform no write/store action. |
| Document-to-library overwrite targets the selected entry | Refresh the selected library temp style from the successful persisted snapshot. |
| Library -> document overwrite confirmed | Use existing `updateStyle`; mark document dirty via existing non-history revision behavior. |
| Library load/write error while editing document | Document edits, dirty state, undo behavior, and ASS save remain unchanged. |

A persistent inline `role="alert"` below the tabs is preferable to relying only on the short-lived editor toast for load errors. A Retry button is limited to load/seed failures. Mutation failures remain ready and are retried by later field edits, copy, or Delete without reloading. No reset/overwrite-corrupt-file action is required by the PRD.

## Minimum file changes

### Required production files

1. **New `src-tauri/src/style_library.rs`**
   - fixed filename/path helpers;
   - raw load/save commands;
   - small path/read/write unit tests in the same module.
2. **`src-tauri/src/lib.rs`**
   - declare the module;
   - register `load_style_library` and `save_style_library`.
3. **`src/services/tauri.ts`**
   - typed raw text wrappers.
4. **New `src/services/styleLibrary.ts`**
   - version 1 envelope;
   - validation and serialization;
   - missing-file default seed orchestration.
5. **`src/components/editor/StyleManager.tsx`**
   - controlled tabs;
   - separate document/live and library/live-save state;
   - shared form rendering;
   - copy, live persist, delete, conflicts, and errors.
6. **`src/components/editor/EditorView.tsx`**
   - keep the toolbar button labeled 样式管理 and using `toggleStyleManager` only.

### Required test files

7. **New `src/services/styleLibrary.test.ts`**
8. **New `src/services/tauriStyleLibrary.test.ts`**
9. **New `src/components/editor/StyleManager.test.tsx`**

Rust tests remain inside the new Rust module, so they do not add another file.

### Files that should not change

- `src/lib/ass/types.ts`, parse, or serialize modules;
- `src/stores/projectStore.ts` and its ownership model;
- `src/stores/uiStore.ts`;
- `src-tauri/src/app_paths.rs`;
- `src/types/index.ts`;
- `src-tauri/capabilities/default.json`;
- `AppSettings` / `settings.json`;
- any saved ASS file other than through the existing explicit document save flow.

This is the minimum cross-layer surface. A separate global library store, Rust `AssStyle` structs, migrations, import/export UI, cloud sync, file watchers, and new dependencies are unnecessary.

## Test seams

### Frontend schema/service tests

`src/services/styleLibrary.test.ts` should cover pure and orchestrated behavior:

- missing file writes version 1 with exactly `createDefaultStyles()` and returns defaults only after write success;
- existing empty `styles: []` remains empty and performs no seed write;
- existing edited/deleted Primary or Secondary is returned unchanged and performs no seed write;
- malformed JSON, wrong version, missing/wrong field types, non-finite numbers, empty names, and duplicate names reject without writing;
- serialization round-trips every `AssStyle` field;
- seed-write rejection rejects loading rather than exposing a falsely persistent library.

### Tauri wrapper tests

Follow existing `tauri*.test.ts` mocking patterns and assert:

```text
invoke("load_style_library")
invoke("save_style_library", { content })
```

### `StyleManager` interaction tests

Use jsdom Testing Library, mock the style library service and preview-font hook, and reset both Zustand stores. Highest-value cases:

- opens on Current Document and preserves the exact drawer width class;
- current-document non-name edits still update the store immediately and dirty the project;
- current-document deletion stays unconfirmed;
- library field edits, create, and rename-on-blur call `saveStyleLibrary` immediately;
- rejected library write keeps UI values and shows an alert;
- load failure disables document-to-library copy and does not invoke a save;
- selecting another entry, switching tabs, or closing after edit does not prompt discard;
- first open missing-file failure leaves document editing usable;
- a document-to-library failure is visible on the Current Document tab through the shared alert;
- Strict Mode and closing/reopening the mounted drawer do not duplicate the first load/seed write;
- document -> library and library -> document conflict checks use name-only overwrite/cancel outcomes, including Escape/backdrop cancellation;
- document-to-library overwrite refreshes the selected library temp style;
- Add to Current Document works after a live library edit without an explicit Save button;
- both copy directions are detached after later edits;
- library deletion uses confirmation and updates only after successful write;
- switching ASS documents leaves the loaded library unchanged while current-document styles change;
- existing empty library remains empty after close/reopen and current-document default insertion/rename/cascade behavior remains unchanged.

### Rust tests

Pure helpers taking a supplied config root make command behavior testable without constructing an `AppHandle`:

- fixed path is `<root>/style-library.json`;
- missing file returns `None`;
- write creates the config directory and round-trips exact text;
- a controlled test-only replacement failure proves the previous destination is preserved and failed first-run seed cleans up its temporary file;
- platform-specific replacement selection uses Win32 replace/move on Windows and same-filesystem rename elsewhere;
- a real read/write error returns contextual error text.

Path-mode behavior itself remains covered by existing `app_paths.rs` tests; the new module only needs to prove that it uses the provided root and fixed filename.

### Validation commands for implementation

```bash
pnpm test -- src/services/styleLibrary.test.ts src/services/tauriStyleLibrary.test.ts src/components/editor/StyleManager.test.tsx src/stores/projectStore.test.ts
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml style_library
cargo test --manifest-path src-tauri/Cargo.toml
```

## Residual risks and deliberate limits

1. **Crash consistency:** the implementation uses a same-directory temporary file and platform-correct replacement, which protects the previous library from ordinary write/replacement failures. A power loss between filesystem operations remains platform-dependent and is outside the approved acceptance criteria.
2. **Case sensitivity:** existing style lookups use exact `===` name matching. The minimum design keeps conflict matching exact and case-sensitive. Changing this would alter current ASS behavior and requires a product decision.
3. **Malformed current ASS duplicate style names:** `projectStore.updateStyle` updates all exact-name matches. ASS styles are expected to have unique names, and the library validator enforces uniqueness. Repairing malformed document duplicates is out of scope.
4. **Write failure vs UI optimism:** live field edits update the UI immediately and then persist. A failed write keeps the UI values and retries on later edits; it does not silently roll the form back to the previous file snapshot.
5. **Large component:** `StyleManager.tsx` is already large. Extract only a private shared style-fields renderer inside the same file for this task; do not create a generalized form framework.

## Review conclusion

Proceed with the proposed split. It reuses the existing ASS model, defaults, project-store actions, app path resolver, Tauri bridge pattern, tabs, and confirmation dialog. Library editing matches Current Document live-save semantics; both drawer close paths use normal `toggleStyleManager`. No global store, settings migration, Rust style schema, new dependency, capability expansion, or ASS pipeline change is justified.
