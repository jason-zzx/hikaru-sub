# Settings category navigation — design

## Architecture

Refactor `SettingsView` into a **shell + category panes** (runtime reuses `RuntimeDependenciesPanel` directly; transcription/translation are extracted panels). No backend, settings schema, or Tauri command changes.

```
SettingsView (shell)
├── header: title + global Save
├── left nav: runtime | transcription | translation
└── right pane (one mounted at a time)
    ├── RuntimeDependenciesPanel (direct)
    ├── SettingsTranscriptionPanel
    └── SettingsTranslationPanel
```

### Category IDs and UI labels

| ID | Chinese UI label | Right-pane content |
|----|------------------|--------------------|
| `runtime` | 运行依赖 | Download source, managed deps, storage measure/cleanup |
| `transcription` | 转录 | ASR engine / model / device, ModelManager, AsrEngineSetupPanel |
| `translation` | 翻译 | OpenAI-compatible API fields, batch/context/prompt/glossary, merge mode, default target language |

Code uses English category IDs. User-visible strings stay Simplified Chinese.

## Component boundaries

### `SettingsView` (shell)

Owns:

- `activeCategory` (`"runtime"` default on mount / when the settings step is shown)
- Settings draft (`settings`), `dirty`, `saving`, `message`
- Runtime probe / storage / cleanup dialog / preparation job state and handlers (unchanged behavior)
- ASR setup flags (`asrSetupRunning`, `asrSetupRefreshKey`) and `refreshSettingsAfterAsrSetup`
- Header Save → existing `setSettings(settings)` for the full draft
- Renders left nav; mounts exactly one right panel

Does **not** keep `asrSectionRef` / `scrollIntoView`.

### Panels

- **Runtime category**: render existing `RuntimeDependenciesPanel` directly from the shell; `onConfigureAsr` → `setActiveCategory("transcription")`.
- **`SettingsTranscriptionPanel`**: extract current ASR `Section` block (engine, model, device, ModelManager, AsrEngineSetupPanel). Receives draft fields + `update` / setup callbacks via props.
- **`SettingsTranslationPanel`**: extract translation `Section` + default target language `Section`.

Shared helpers (`SettingsSection`, `SettingsField`, `settingsInputClass`) live in colocated `settingsForm.tsx`.

### Placement

New panel files under `src/components/workflow/` next to `SettingsView.tsx` (matches directory-structure guidelines for workflow UI).

## Data flow

1. Shell loads `getSettings()` once on mount; draft is the single source of truth for editable fields.
2. Panels call `update(key, value)` → shell updates draft + sets `dirty`.
3. Category switches only change `activeCategory`; draft and `dirty` are preserved; no confirm dialog.
4. Global Save writes the entire draft via `setSettings`.
5. Runtime download-source change keeps its existing immediate-save path (`handleRuntimeSourceModeChange`).
6. ASR setup `onBeforeStart` still persists the current draft before install (existing behavior).
7. Runtime probe refresh stays in the shell mount effect (not tied to which panel is visible).

## Cross-category action

`RuntimeDependenciesPanel` "去配置" → shell `setActiveCategory("transcription")`. No in-pane scroll target.

## Cross-page deep links

`uiStore.openSettings(category?)` sets `currentStep: "settings"` and `settingsCategory`. `SettingsView` initializes from / syncs to `settingsCategory`. Leaving Settings via `setStep` clears it. Sidebar uses `openSettings("runtime")`.

Call sites:

| Source | Category |
|--------|----------|
| Sidebar 设置 | `runtime` |
| Transcribe「前往设置」 | `transcription` |
| Translate「前往设置」 | `translation` |
| RuntimeDependencyDialog「更改下载源」(download/import/transcribe/burn) | `runtime` |
| In-settings「去配置」 | `transcription` (local state only) |

## UI details

- Layout: flex row under the header; left nav ~`w-44`–`w-52`; right pane `flex-1 overflow-auto`.
- Left nav: text-only items; selected state uses existing semantic tokens (same family as app sidebar selection), no new palette.
- No category icons this round.
- Header subtitle: prefer short copy that follows the active category (fallback: one static overview line).
- Cleanup confirm `Dialog` remains on the shell.

## Compatibility / rollback

- No `AppSettings` schema or migration changes.
- Rollback = revert the settings UI files; no data repair.

## Testing

- Update `tests/SettingsViewAsrSetup.test.ts` source assertions after the ASR block moves (point at shell + `SettingsTranscriptionPanel` as needed).
- Keep `tests/SettingsRuntimeDependencies.test.tsx` as panel-unit coverage; optionally add a thin shell test for category default + "去配置" → transcription.
- Validate with targeted `pnpm test` and `pnpm build` (settings UI change).

## Out of scope (design)

URL/hash routing, persisting last category, per-category save, unsaved prompts, new settings fields, theme inside Settings, fourth empty category.
