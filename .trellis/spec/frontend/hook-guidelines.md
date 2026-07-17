# Frontend Hook Guidelines

## Job Pollers (App-Level Ownership)

Long-running Tauri jobs that must finish even if the user navigates away are polled from **App layout**, not only from the page that started them.

| Hook | Store | Why App-level |
|------|-------|----------------|
| `useClipJobPoller` | `clipStore` | Clip completion unlocks navigation / may `setSession`; leaving ImportView must not strand busy state |
| `useBurnJobPoller` | `burnStore` | Same pattern for burn jobs |

Reference: `src/hooks/useClipJobPoller.ts`, mounted in `AppLayout`.

Rules observed in code:

- Poll while `jobId` is set; treat store `jobId` as source of truth for cancel/replace
- On clip success with “use as working video”: `prepareVideoSession` → `setSession` only — **do not** `loadAssDocument` or migrate ASS
- Update `taskStore` for status bar progress; call `finishJob` once per completion path

## Preview Fonts

- Discovery singleton: `getPreviewFonts` in `src/services/previewFontDiscovery.ts` (dedupes concurrent invokes, caches success).
- Components subscribe via `usePreviewFontNames(..., { enabled })` — pass `enabled: false` when UI is closed (e.g. StyleManager) to avoid unnecessary work.
- Do **not** call `discoverPreviewFonts` / `discover_preview_fonts` from multiple components directly.

## Subtitle Merge Mode

`settings.subtitleMergeMode` (`inline` | `separate`) is **translation-generation only**. Do not reintroduce `useSubtitleMergeMode` or read merge mode in the editor list, selected-row form, preview, burn, or save paths.

Physical editor cues are one row per ASS `Dialogue:` event (`primaryText` only). Translation applies merge mode when serializing logical results, then re-parses with `mergeBilingual: false` before writing `projectStore`.

## Editor Hotkeys and Row Clipboard

`useEditorHotkeys` + `components/editor/hotkeys.ts` own keyboard bindings. Whole-row copy/cut/paste use `src/services/subtitleClipboard.ts` (Tauri clipboard-manager plugin), not an in-memory cue array.

### Scopes

- **outside-input** (default for most editor actions): match only when focus is not inside `input` / `textarea` / `contentEditable`.
- **history-command**: match outside editable controls **or** inside an editable control marked with `data-history-command` (subtitle text textarea and start/end time inputs only).
- Copy/cut/paste and other text-editing shortcuts still do **not** intercept focused unmarked inputs — keep native browser/WebView text editing there.
- Keep the existing composition (`isComposing`) guard so IME in progress never routes project undo/redo.

### Undo / redo routing

- Keyboard undo/redo and playback-control undo/redo buttons must share the same `EditorView` wrappers, not call `projectStore.undo/redo` with divergent side effects.
- Pending changed start/end-time drafts: Undo commits the draft synchronously then undoes; Redo is a prevented no-op that does **not** flush the draft (button disabled parity).
- Unmarked transient inputs (font search, quick format parameters, inline color/number popovers, filters, StyleManager fields) retain native undo/redo until their value is applied as a cue edit (one discrete project-history item).

### Row clipboard

- Outside focused text inputs: copy/cut write canonical `Dialogue:` lines; paste is line-by-line ASS or plain-text fallback after the selected row.
- Cut deletes selected rows only after a successful clipboard write.

Keep hotkey definitions centralized; test via `useEditorHotkeys.test.ts` / `hotkeys.test.ts` / `subtitleClipboard.test.ts`.

## Runtime Dependency Preparation

`useRuntimeDependencyPreparation` coordinates prepare/progress UI for managed deps — pair with Settings / setup panels, not ad-hoc invoke loops in unrelated views.

## Anti-Patterns

- Putting clip/burn finalize logic only in `ImportView` / `BurnView` effects
- Re-discovering system fonts on every StyleManager open without `enabled` gating
- New pollers that ignore cancel (`jobId` cleared) and still mutate session
- Branching editor/player/burn UI on `subtitleMergeMode` or restoring in-memory cue-row clipboard modules
- Wiring keyboard undo/redo to `projectStore` while playback buttons use a different flush/availability path
- Intercepting undo/redo inside unmarked transient inputs, or leaving marked subtitle text/time inputs on native-only undo
