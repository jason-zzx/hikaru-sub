# Services and Tauri Bridge

## Role of `src/services/tauri.ts`

Single frontend façade for product Tauri commands and common dialogs:

- `invoke(...)` wrappers with typed args/results from `src/types`
- File/directory pickers via `@tauri-apps/plugin-dialog`
- Event listeners (e.g. audio extract progress)
- Small helpers (`transcribedAssPath`, `translatedAssPath`, FFmpeg status cache + invalidation event)

Components and hooks should import from this module (or a thin domain service that uses it), not scatter raw `invoke("command_name")` calls.

## New Command Wiring (Frontend End)

When Rust adds a command, frontend work ends here:

1. Add/adjust types in `src/types/index.ts`
2. Export a wrapper in `src/services/tauri.ts`
3. Call the wrapper from stores/hooks/views
4. Cover behavior with tests when logic is non-trivial (`src/services/tauri*.test.ts`, store tests, etc.)

Full chain (must stay intact): **Rust impl → `lib.rs` `generate_handler!` → `tauri.ts` → UI**. Capability updates live on the Tauri side (`src-tauri/capabilities/`).

## Related Services (Not Raw Invoke)

| Module | Purpose |
|--------|---------|
| `previewFontDiscovery.ts` | Singleton cache over `discoverPreviewFonts` |
| `libassPreview.ts` / `libassFontSelection.ts` / `fontCoverage.ts` | Preview rendering / glyph fallback |
| `translation/` | OpenAI-compatible / Gemini / Anthropic HTTP, model discovery, shared batching/fallback, and request scheduling |
| `editorActions.ts` | Pure editor list actions (split/merge/timing/delete) on cue arrays |
| `subtitleClipboard.ts` | Whole-row ASS event copy/cut/paste via `@tauri-apps/plugin-clipboard-manager` + `eventLine` codec |

Official Tauri plugins (e.g. clipboard-manager) are called from a focused domain service (`subtitleClipboard.ts`), not from React components and not via a custom Rust command / `tauri.ts` invoke. Still register the plugin in `lib.rs` and grant only needed capabilities (`clipboard-manager:allow-read-text`, `allow-write-text`).

Translation API keys are the approved exception to the general invoke-secret rule: every provider carries an `apiKey: string` in the existing complete `AppSettings` get/set IPC and plaintext local `settings.json` flow so Settings can round-trip, replace, and clear it. Empty or whitespace-only keys fail provider readiness and model-discovery gating. Do not add keys to unrelated invoke payloads, source, fixtures, request-body logs, or auth-header logs.

## Scenario: Persisted Subtitle Editor Shortcuts

### 1. Scope / Trigger

This contract applies when Settings exposes configurable subtitle-editor shortcuts and the editor consumes them. It is a cross-layer settings change, but it uses the existing `get_settings` / `set_settings` commands rather than a new command.

### 2. Signatures

- Rust field: `AppSettings.editor_hotkeys: Vec<EditorHotkeyOverride>`
- TypeScript field: `AppSettings.editorHotkeys: EditorHotkeyOverride[]`
- Override record: `{ id: string; key: string; ctrl: boolean; alt: boolean; shift: boolean }`
- Existing frontend boundary: `getSettings(): Promise<AppSettings>` and `setSettings(settings: AppSettings): Promise<void>`

### 3. Contracts

- Rust serializes the field as `editorHotkeys` using camelCase.
- The field defaults to an empty array when it is absent from an older settings file.
- Only stable shortcut IDs and key/modifier values are persisted. Scope, action, description, category, and display labels remain in the frontend default registry.
- The frontend applies only known IDs with complete, non-empty bindings. Unknown or malformed records do not disable settings loading and do not override defaults.
- The editor starts with the default registry, then applies loaded overrides after `getSettings()` resolves; a load failure keeps defaults active.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Missing `editorHotkeys` | Deserialize as an empty array and use defaults. |
| Non-array or malformed Rust records | Ignore invalid records; retain valid records and keep loading. |
| Unknown frontend ID | Ignore it when deriving effective definitions. |
| Duplicate effective key/modifier tuple | Show a Settings conflict error and block saving until corrected or reset. |
| Valid custom binding | Apply it to dispatch, local editor handling, help display, and shortcut tooltips. |

### 5. Good/Base/Bad Cases

- Good: `editorHotkeys` contains a known ID with a non-empty key and all boolean modifiers; the editor uses the override.
- Base: the field is absent in a legacy settings file; all existing defaults remain unchanged.
- Bad: two effective definitions share the same key and modifier tuple; Settings rejects the assignment or disables Save.
- Bad: a settings record omits a modifier flag; Rust filters it and the frontend does not treat it as an active override.

### 6. Tests Required

- Rust settings tests assert default empty data, legacy deserialization, malformed-record filtering, and valid record round trips.
- Frontend hotkey tests assert override application, unknown-record ignoring, conflict detection, label derivation, and local matching.
- Settings panel tests assert recording, conflict rejection, restore-defaults, and invalid-state reporting.
- Editor tests assert customized global dispatch, local Enter/Shift+Enter/Escape behavior, and effective help labels.

### 7. Wrong vs Correct

#### Wrong

```ts
const hotkeys = (settings as { shortcuts?: Record<string, string> }).shortcuts;
```

This duplicates the IPC contract and stores derived labels that cannot express modifier semantics reliably.

#### Correct

```ts
const defs = applyEditorHotkeyOverrides(settings.editorHotkeys);
useEditorHotkeys({ hotkeys: defs, onSave, onUndo, onRedo, onToggleHelp });
```

The typed `AppSettings` field is the single persistence boundary, while the default registry remains the source of truth for editor behavior.

## Patterns to Preserve

- **FFmpeg status**: `checkFfmpeg` caches a promise; `invalidateFfmpegStatus` clears it and dispatches `hikaru-sub:ffmpeg-status-invalidated`.
- **ASS I/O**: `loadAssText` / `saveAssText` move bytes; parse/serialize stays in `lib/ass`.
- **Media playback**: `registerMediaPlayback(path)` → `http://127.0.0.1:.../media/{token}` URL for `<video>`.
- **Runtime deps**: `probeRuntimeDependencies` for status; `measureRuntimeDependencyStorage` only when user asks to compute size; cleanup only after measure > 0 for managed targets.

## Anti-Patterns

- Calling `invoke` from a React component for a command that already has a wrapper
- Skipping type updates when Rust payload changes
- Putting translation API keys into unrelated Tauri invoke payloads, source, fixtures, or logs
- Using Tauri `asset://` as the primary editor playback path again
