# Persistent Subtitle Style Library

## Goal

Add an application-level subtitle style library to Hikaru Sub so users can reuse common ASS styles across videos and application sessions while each ASS document continues to store the styles it actually uses.

## Background

- `StyleManager` currently manages `projectStore.assStyles`, which belongs to the active ASS document. Those styles persist with that ASS file but do not become reusable application-level templates.
- Opening or switching videos replaces `projectStore.assStyles` with the styles loaded from the new ASS document, so document styles cannot serve as a global library.
- Document style edits mark the current project dirty but stay outside cue undo/redo history. This behavior must remain unchanged.
- The application already resolves configuration directories consistently for installed and portable modes.

## Requirements

- **R1 — Application-level persistence:** Styles saved to the library survive application restarts and remain available across videos.
- **R2 — Document boundary:** Current-document styles remain embedded in the ASS file. The library must not replace or hide the document's `[V4+ Styles]` section.
- **R3 — Explicit copy operations:** Users can copy a current-document style into the library and copy a library style into the current document.
- **R4 — Detached copies:** Copying a style in either direction creates an independent snapshot. Later edits do not automatically synchronize between the library and the document.
- **R5 — Library management:** Users can view, create, edit, rename, and delete library entries from the style-management UI.
- **R6 — Copy conflict rule:** Copy operations compare style names only. If the destination already contains the same name, the UI asks whether to overwrite it. The only outcomes are overwriting the destination style or making no change.
- **R7 — Safe mutation:** Library operations must not silently rewrite other ASS files, and a persistence failure must not discard current-document styles.
- **R8 — Path compatibility:** Library persistence must follow Hikaru Sub's existing installed and portable configuration-directory rules.
- **R9 — Existing document behavior:** Current-document style editing, dirty-state tracking, saving, and cue-reference behavior remain unchanged unless the user explicitly copies a style between the document and the library.
- **R10 — First-run defaults:** When no style-library file exists, initialize the library with Hikaru Sub's built-in Primary and Secondary styles. Once a library exists, startup must not reinsert or overwrite either name.
- **R11 — Library live save:** Non-name library field edits, create, and rename-on-blur persist immediately to the style library (same live semantics as Current Document). There is no library-tab draft/save button. Write failure shows an error, keeps UI values, and later edits retry the write.
- **R12 — Library deletion confirmation:** Deleting a persistent library style requires confirmation with exactly two outcomes: delete the style or cancel without changes. Current-document style deletion keeps its existing behavior.
- **R13 — Tabbed style manager:** Keep the existing drawer width and present two tabs: Current Document and Style Library. Current Document is the default tab, retains live editing, and exposes Save to Library (copy into the library). Style Library uses live editing and exposes Add to Current Document.
- **R14 — No draft navigation guard:** Selecting another library style, switching tabs, or closing the drawer does not prompt discard/keep-editing; library edits are already live-persisted (or retried on next edit after failure).
- **R15 — Current library source for document copies:** Add to Current Document uses the currently selected library style from the authoritative in-memory list. It may be disabled while a library write is pending or while a rename is uncommitted/invalid.

## Acceptance Criteria

- [ ] On first use with no existing library file, the library contains the built-in Primary and Secondary styles.
- [ ] After the library has been created, startup does not reinsert deleted defaults or overwrite edited defaults.
- [ ] Editing a library non-name field persists immediately to the style library file.
- [ ] Creating a library style and renaming on blur persist immediately.
- [ ] Opening Style Manager defaults to the Current Document tab within the existing drawer width.
- [ ] The Current Document and Style Library tabs share the style-editing controls; both use live field updates (library also auto-persists).
- [ ] Selecting another style, switching tabs, or closing the drawer does not show a discard/keep-editing prompt.
- [ ] Add to Current Document uses the current selected library style without requiring an explicit Save.
- [ ] A failed library write keeps UI values, shows an alert, and leaves Current Document usable.
- [ ] Current-document style controls continue updating the document immediately and keep the existing dirty-state behavior.
- [ ] A style created or saved in the library remains available after restarting the application.
- [ ] Opening another video leaves the library unchanged while current-document styles still come from that video's ASS file.
- [ ] A current-document style can be copied into the library.
- [ ] A library style can be copied into the current document and saved with that ASS file.
- [ ] Copying into a destination with the same style name prompts for overwrite; confirming replaces the destination style and cancelling makes no change.
- [ ] Copy conflict detection depends only on the style name and does not compare style fields or generate a new name.
- [ ] After a copy operation, editing either copy does not modify the other copy.
- [ ] Editing or renaming a library entry does not automatically rewrite any saved ASS file.
- [ ] Deleting a library style requires confirmation; confirming persists the deletion and cancelling makes no change.
- [ ] Deleting a current-document style retains the existing behavior and does not gain the library confirmation flow.
- [ ] A library read or write failure produces a user-understandable error while current-document styles remain usable.
- [ ] Installed and portable modes use their existing configuration directories.
- [ ] Existing current-document style editing and save behavior continues to pass its tests.

## Out of Scope

- Cloud or multi-device synchronization.
- An online style marketplace or sharing service.
- Automatic discovery or migration of style libraries from other subtitle applications.
- Automatic synchronization of same-named styles across saved ASS files.
- Persistent identity links between library entries and document styles.
