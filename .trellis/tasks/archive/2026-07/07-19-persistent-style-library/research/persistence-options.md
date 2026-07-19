# Style Library Persistence Options

## Existing Boundaries

- `src/components/editor/StyleManager.tsx` reads and mutates `projectStore.assStyles`, so its current list belongs to the active ASS document.
- `src/stores/projectStore.ts` replaces or clears document styles during `loadAssDocument`, `setSession`, and `clearSession`. Style mutations advance the document's `nonHistoryRevision` and participate in its unsaved state.
- `src/lib/ass/types.ts` already defines the complete ASS V4+ `AssStyle` model. A second style-field model is unnecessary.
- `src-tauri/src/app_paths.rs` already centralizes installed and portable configuration paths. Business data should use that resolver.
- `src-tauri/src/settings.rs` writes the complete `AppSettings` object to `settings.json`; every frontend settings save sends the whole object back to Rust.

## Options

### 1. WebView `localStorage`

Advantage: the smallest frontend-only change.

Rejected: `localStorage` is appropriate for disposable UI preferences such as theme or pane proportions. A user-created style library is creative data and should not silently disappear with WebView profile cleanup. It would also bypass the application's established portable configuration path.

### 2. Add the Library to `settings.json`

Advantage: reuses the existing `get_settings` and `set_settings` commands.

Disadvantages: library edits would repeatedly read and write the entire settings payload and couple style data to unrelated runtime paths, translation providers, and API keys. Corruption of library data could also prevent all settings from loading.

### 3. Separate `style-library.json` File (Recommended)

Store a dedicated file under `app_paths::app_config_dir()` and expose focused Tauri load/save commands. The frontend continues to use the existing `AssStyle` domain model.

Advantages:

- Separates the library from ASS documents and general application settings.
- Follows installed and portable configuration-path rules.
- A damaged library file does not prevent unrelated settings from loading.
- Future explicit import, export, or backup features would not enlarge `AppSettings`.

The minimum file envelope is a version number plus an ordered style array, for example `{ "version": 1, "styles": [...] }`. The version exists only to support future compatibility migration; no additional abstraction is required.

## Interaction Recommendation

Use two clearly named collections, following Aegisub's broad storage/current-script semantics without copying its layout exactly:

- Current document → library: copy a snapshot.
- Library → current document: copy a snapshot.
- The copied style is detached. Later edits on either side never synchronize automatically.
- Copy conflicts compare names only. If the destination already contains the name, ask whether to overwrite it; cancelling makes no change. Do not compare style fields or generate a new name.

The confirmed layout keeps the existing drawer width and uses two tabs with one shared style editor. Current Document is the default tab and retains live editing with a Save to Library action (copy into the library). Style Library uses the same live-edit semantics and an Add to Current Document action.

## Confirmed Product Decision

Copying a style in either direction creates an independent copy. The library and document do not keep persistent identity links and do not auto-synchronize after the copy.

Copy conflict detection uses the style name only. A same-name destination produces a two-result confirmation: overwrite the destination style or cancel without changes.

When no library file exists, initialize it with the built-in Primary and Secondary styles. Once the file exists, do not reinsert a deleted default or overwrite a user-edited default during startup.

Library-style editing is live-save: non-name field edits, create, and rename-on-blur persist immediately to the style library (same semantics as Current Document). There is no library-tab draft or explicit Save button. Write failure shows an error, keeps UI values, and later edits retry the write. Current-document style editing retains its existing live-update behavior.

Deleting a persistent library entry requires a two-result confirmation: delete the style or cancel without changes. Current-document style deletion retains its existing behavior.

Selecting another library style, switching tabs, or closing the drawer does not prompt discard/keep-editing, because library edits are already live-persisted (or retried on the next edit after failure). The EditorView toolbar button stays labeled 样式管理 and only toggles the drawer.

Add to Current Document uses the currently selected library style from the authoritative in-memory list. It may be disabled while a library write is pending or while a rename is uncommitted/invalid.
