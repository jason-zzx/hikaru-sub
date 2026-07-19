# Manage Subtitle Editor Shortcuts

## Goal

Add a **Shortcuts** category to Settings so users can inspect and manage the keyboard shortcuts available in the subtitle editor. The editor's execution, inline editing behavior, and shortcut help overlay must all use the same effective shortcut configuration.

## Confirmed Facts

- The default shortcut definitions are centralized in `src/components/editor/hotkeys.ts` as `EDITOR_HOTKEYS`.
- Global editor shortcuts are dispatched by the single `window` listener in `src/hooks/useEditorHotkeys.ts`.
- Enter, Shift+Enter, and Escape are currently handled locally by `SubtitleEditor` because they depend on draft state.
- `HotkeyHelpOverlay` currently reads the default shortcut table directly.
- Settings categories are driven by `SettingsCategory` and `SettingsView`; application settings are persisted through the existing Tauri `get_settings` and `set_settings` commands.
- The user confirmed that management includes editing individual shortcuts, conflict feedback, and restoring defaults, including locally handled editor shortcuts.

## Requirements

- Add a **Shortcuts** category to the Settings navigation.
- List every current subtitle-editor shortcut with its category and action description.
- Let the user record a replacement key combination for each listed shortcut.
- Persist shortcut changes through the existing application settings flow. Reloading Settings or opening the editor again must retain the changes.
- Make the editor dispatcher, locally handled editor shortcuts, shortcut help overlay, and shortcut-related editor tooltips use the same effective shortcut definitions.
- Preserve the existing default behavior when the shortcut configuration is absent, incomplete, or contains unknown entries from an older/newer configuration.
- Detect conflicting key combinations and prevent a conflicting assignment from being accepted or saved; show a clear Simplified Chinese error state in the Settings UI.
- Provide a one-click restore-all-defaults action and a per-shortcut restore-default action; each per-shortcut action removes only that shortcut's custom override.
- Keep shortcut scope semantics unchanged; management changes only key and modifier bindings.

## Acceptance Criteria

- [x] Settings contains a reachable **Shortcuts** category that lists all existing subtitle-editor shortcuts grouped by their existing categories.
- [x] A user can record and save a custom binding for any listed shortcut, then see and use it after reloading the application settings or reopening the editor.
- [x] The shortcut help overlay displays the effective customized bindings rather than stale defaults.
- [x] Enter, Shift+Enter, and Escape behavior in subtitle text/time inputs follows the configured local bindings.
- [x] A conflicting binding is rejected with visible feedback and cannot be persisted as a valid configuration.
- [x] Restoring all defaults removes custom overrides and restores the original behavior and labels.
- [x] Each shortcut row can restore only its own default without changing other custom bindings.
- [x] Existing settings files without shortcut data load successfully and retain the current default behavior.
- [x] Focused text inputs continue to receive native text-editing shortcuts unless the configured editor shortcut explicitly owns that scope.
- [x] Relevant frontend tests, `pnpm build`, and Rust settings tests pass.

## Out of Scope

- Configuring shortcuts outside the subtitle editor.
- Changing shortcut action semantics or editor workflow behavior.
- Adding OS-level global hotkeys that work when Hikaru Sub is unfocused.
- Adding a new Tauri command or introducing a new persistence mechanism.
