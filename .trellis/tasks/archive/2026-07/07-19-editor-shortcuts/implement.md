# Implementation Plan: Subtitle Editor Shortcuts

## Ordered Checklist

1. [x] Update the typed settings contract in TypeScript and Rust with the optional-by-compatibility `editorHotkeys` override array; add Rust default/deserialization coverage.
2. [x] Extend the centralized editor shortcut registry with stable IDs and shared helpers for effective definitions, labels, recording values, local matching, and conflict validation; add focused unit tests.
3. [x] Build `SettingsShortcutsPanel` with grouped rows, key recording, conflict feedback, per-shortcut reset, and restore-all-defaults; add it to `SettingsCategory`, `SettingsView`, and the existing save flow with validity derived by the parent.
4. [x] Load saved shortcut overrides in `EditorView` with defaults-first fallback and pass effective definitions to the global dispatcher, local subtitle editor handlers, help overlay, and static shortcut labels that are exposed to users.
5. [x] Update or add frontend tests for the settings panel, customized dispatch, per-shortcut reset, local Enter/Shift+Enter/Escape handling, help overlay labels, and backward-compatible defaults.
6. [x] Run focused tests, the complete frontend test suite, `pnpm build`, and Rust settings/full tests. Fix findings before the final quality review.
7. [x] Perform the final full-scope spec check across the frontend and Tauri layers, then review the diff for unrelated changes and confirm that no commit has been created without explicit user authorization.

## Validation Commands

```bash
pnpm test -- src/components/editor/hotkeys.test.ts src/components/editor/HotkeyHelpOverlay.test.ts
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml settings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Risk Points and Rollback Boundaries

- **Settings schema:** keep the new field defaultable so old settings files remain readable. If Rust serialization fails, revert only the settings contract changes before touching UI behavior.
- **Shortcut matching:** preserve existing scope and IME rules. If custom matching changes native input behavior, revert the matcher integration while retaining registry/UI tests.
- **Local editor handlers:** use the shared matcher with an explicit local-definition option; do not duplicate key parsing in `SubtitleEditor`.
- **Settings save validation:** invalid shortcut state must not disable unrelated settings unless the shortcut panel itself is invalid; verify existing runtime/provider save flows remain unchanged.
- **Static labels:** update only labels that describe editor shortcuts; do not refactor unrelated player controls.

## Completion Gate

Before activation, `prd.md`, `design.md`, and this file must be reviewed for a consistent scope. After implementation, all acceptance criteria must be checked against code and tests, and the working tree must remain uncommitted unless the user separately authorizes a commit.
