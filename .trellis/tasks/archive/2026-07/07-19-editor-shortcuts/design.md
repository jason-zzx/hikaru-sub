# Technical Design: Subtitle Editor Shortcuts

## Boundaries

The feature stays within the existing frontend settings/editor boundary and the existing Rust settings serializer:

- React owns the shortcut registry, event matching, recording UI, conflict validation, labels, and editor behavior.
- Tauri owns only persistence of the typed shortcut override records as part of `AppSettings`.
- No new command, capability, file path, or runtime dependency is required.

## Configuration Contract

Add an `editorHotkeys` field to `AppSettings` on both sides of the Tauri boundary:

```text
editorHotkeys: EditorHotkeyOverride[]

EditorHotkeyOverride:
  id: string
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
```

Rust uses `camelCase` serialization and a default empty vector. A missing field in an existing settings file therefore deserializes to no overrides. The frontend treats only known IDs with non-empty keys as valid overrides; unknown or malformed records are ignored and defaults remain active.

Only overrides are persisted. The default registry remains the source of truth for action IDs, scope, descriptions, categories, and local-handling metadata. This avoids storing derived display labels and makes future default changes apply automatically to untouched entries.

## Default Registry and Effective Definitions

Extend each `HotkeyDef` with a stable `id`. IDs must remain stable across releases and must distinguish multiple bindings for the same action, such as the two redo bindings or the two play/pause bindings.

Add shared helpers in `hotkeys.ts` to:

1. Apply known persisted overrides to `EDITOR_HOTKEYS`.
2. Produce display labels from the effective key and modifiers.
3. Compare and canonicalize bindings for conflict detection.
4. Match locally handled definitions when a caller explicitly opts into local definitions; the global dispatcher continues to skip those definitions.

The effective definition list is passed to all editor consumers. The initial render uses defaults, then replaces them with persisted settings after the existing `get_settings` call resolves. A settings-load failure keeps defaults and does not block the editor.

Conflict validation uses the complete key plus modifier tuple. Since scope semantics are intentionally unchanged and the editor currently has no duplicate default combinations, duplicate combinations are rejected conservatively regardless of scope. This prevents ambiguous dispatch and keeps validation predictable for users.

## Settings UI

Create a focused `SettingsShortcutsPanel` using the existing Settings section patterns and shadcn `Input`/`Button` components:

- Group rows by the existing shortcut categories.
- Use a read-only/focused key recorder input. On a valid `keydown`, capture `key`, `ctrlKey || metaKey`, `altKey`, and `shiftKey`; ignore modifier-only, dead, and unidentified events.
- On conflict, leave the previous binding unchanged and show an inline error associated with the row.
- When a binding equals its default, remove that override from the persisted array.
- Restore all defaults by setting the override array to empty.
- Give each row a reset action that removes every override with that shortcut ID while leaving other rows unchanged.
- Surface invalid persisted conflicts in the panel and prevent the Settings save action while invalid.

The Settings page owns the edited `AppSettings` object and keeps the existing Save button flow. It derives shortcut validity directly from `settings.editorHotkeys`; the panel does not synchronize derived validity back into parent state.

## Editor Data Flow

`EditorView` loads `AppSettings` once when mounted and derives effective definitions. It passes the definitions to:

- `useEditorHotkeys`, which uses them for the global dispatcher.
- `SubtitleEditor`, which uses them for Enter/Shift+Enter/Escape local matching.
- `HotkeyHelpOverlay`, which uses them for grouped display.
- `PlaybackControls` and shortcut-related toolbar/notification labels where the current code exposes static shortcut text.

No editor action implementation changes. The only behavior change is that the configured definition selects the same existing action.

For time inputs, the existing Enter commit behavior remains local. It follows the configured local commit binding so changing the listed Enter shortcut does not leave time editing on a stale key. Shift+Enter continues to commit/blur in a time input because inserting a newline is not meaningful there.

## Compatibility and Failure Handling

- Old settings JSON without `editorHotkeys` loads through Rust defaults.
- Unknown shortcut IDs are ignored by the frontend and are preserved only as opaque persisted records if the user does not save; saving from the Settings page writes the current typed array.
- Invalid duplicate records cannot be created through the UI. If encountered from disk, the panel reports the conflict and disables Save until the user changes or restores the affected bindings.
- A failed settings load in the editor does not disable editing; defaults remain active.
- No secrets or external input are introduced.

## Verification Strategy

- Unit-test binding label formatting, override application, canonical conflict detection, and local matching.
- Component-test the Settings panel for recording, conflict rejection, per-row reset, restore-all-defaults, and grouped display.
- Extend existing editor hotkey tests to verify custom definitions and local handlers.
- Add Rust settings tests for default empty shortcut data and deserialization of legacy settings without the new field.
- Run the focused frontend tests, full frontend test suite if practical, `pnpm build`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
