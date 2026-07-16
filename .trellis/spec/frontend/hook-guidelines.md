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

`useSubtitleMergeMode` loads `settings.subtitleMergeMode` (`inline` | `separate`). Editor list, editor pane, and player preview must all use `getCueDisplay` with this mode.

## Editor Hotkeys

`useEditorHotkeys` + `components/editor/hotkeys.ts` own keyboard bindings. Keep hotkey definitions centralized; test via `useEditorHotkeys.test.ts` / `hotkeys.test.ts`.

## Runtime Dependency Preparation

`useRuntimeDependencyPreparation` coordinates prepare/progress UI for managed deps — pair with Settings / setup panels, not ad-hoc invoke loops in unrelated views.

## Anti-Patterns

- Putting clip/burn finalize logic only in `ImportView` / `BurnView` effects
- Re-discovering system fonts on every StyleManager open without `enabled` gating
- New pollers that ignore cancel (`jobId` cleared) and still mutate session
