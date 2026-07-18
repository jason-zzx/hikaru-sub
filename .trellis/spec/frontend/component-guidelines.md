# Frontend Component Guidelines

## UI Stack

- **shadcn/ui first**: buttons, dialogs, selects, inputs, sheets, etc. from `src/components/ui/`.
- Form controls use semantic tokens (`border-input`, `bg-card`, `focus-visible:ring-ring/50`). Number inputs already hide spinners globally in `src/styles/index.css`.
- Change appearance via tokens in `src/styles/index.css` (`:root` / `.dark`), not by overriding shadcn internals in business files.
- Theme: `ThemeProvider` (`src/components/theme-provider.tsx`) — light / dark / system; `ModeToggle` for switching.

## Icons

- Workflow / nav / tool icons: `src/components/layout/NavIcons.tsx` (lucide-style hand-written SVG, `stroke="currentColor"`).
- Generic UI / theme: `lucide-react` is allowed.
- **Forbidden**: emoji or text characters as icons (cross-platform missing glyphs).

## Copy and Naming

- User-visible strings: **Simplified Chinese**.
- Product display name: `Hikaru Sub`. Machine ids / package names: `hikaru-sub` (see `/AGENTS.md`).

## Composition Patterns

### App shell

`AppLayout` (`src/components/layout/AppLayout.tsx`) maps `WorkflowStep` → view component, mounts App-level pollers (`useBurnJobPoller`, `useClipJobPoller`), and wraps the active view with `ClipInProgressGate`.

### Workflow views

Examples: `ImportView`, `TranscribeView`, `TranslateView`, `BurnView`, `SettingsView`, `DownloadView`. They:

- Read/write Zustand stores
- Call `services/tauri.ts` (and translation services) for side effects
- Must not own long-running job finalization that must survive leaving the page (clip/burn pollers belong at App layer)

`SettingsView` uses a left category nav (`runtime` / `transcription` / `providers` / `translation`) and a right content pane. Provider connection/auth/model/limits live under `providers`; translation behavior remains under `translation`. Cross-page jumps into Settings should use `uiStore.openSettings(category)` rather than bare `setStep("settings")`.

### Editor / player

- Editor workspace layout stays left video+timeline / upper-right list / lower-right editor. The two outer pane ratios are pointer-resizable and persist globally through `editorPaneLayout.ts`; use CSS Grid `minmax(<px>, <ratio>fr)` tracks for window-size constraints so no resize observer overwrites the preferred value. Keep the video/timeline boundary fixed, keep layout state out of project history/per-video metadata, do not intercept editor arrow keys for pane resizing, retain separator semantics, and retain double-click reset to defaults.
- Mode-agnostic physical rows: list and selected-row editor show `cue.primaryText` with one generic 字幕 field; do not branch on `subtitleMergeMode` or show dual original/translation fields.
- Multi-row formatting: when more than one valid `selectedCueIds` entry exists, right-panel style and ASS override controls apply to every selected physical row's complete `primaryText`. Ignore stale IDs when deciding whether the operation is multi-row. With one valid row, preserve textarea selection/caret behavior; timing, subtitle text, new-row, and right-panel delete remain active-row operations. Single-row inline formatting/alignment is one discrete `updateCue`; multi-row remains one `replaceCues`.
- Live text preview while typing/IME must stay immediate; project history groups via store + `editorTextHistory`, not one snapshot per keystroke. React 19 may omit synthetic `onBeforeInput` for Backspace/Delete, so deletion grouping must pair native `input.inputType` with the pre-edit selection cached by textarea select/keydown events. Missing or unknown `inputType` remains discrete; never infer an operation from text-length changes. Mark only subtitle text + start/end time inputs with `data-history-command`.
- `SubtitleEditor` exposes `commitPendingTimeDraft()` for shared undo/save coordination; it must normalize with the last edited field (`start` vs `end`) so inverted ranges clamp in the correct direction. Focus/blur without an effective edit must not dirty or push history.
- Editor and clip-dialog time inputs use `H:MM:SS.cc` (unpadded hours) through `src/utils/timeInput.ts`. Caret/edit logic follows visible digit positions; do not reintroduce a hidden fixed-width `HH` slot model. Structured values such as `1:02:03.45` must retain field boundaries during normalization.
- Preview/save/burn serialize physical cues (prefer `preserveOrder: true` where row order must match the store); do not re-merge by settings. Editor save awaits path selection first, then flushes pending time + `captureSaveSnapshot` / token `markSaved`.
- Playback uses local HTTP media URLs from `registerMediaPlayback` — not `asset://` as the primary path.
- Libass WASM preview is preferred; CSS fallback only when libass is unavailable (`LibassFallbackNotice`).

### Translation view

- Initialize a page-local provider selection from `defaultTranslationProviderId`. The Translation view dropdown changes only that mounted view's selection; it must not persist settings or change the configured default. Missing/incomplete selections, including an empty API key, deep-link to `openSettings("providers")`.
- Page-owned source loads from **transcribed** ASS on enter; do not treat current `projectStore` physical rows as translation source.
- Entering the page must not write or delete the existing translated ASS file.
- On successful translation: serialize logical result with `settings.subtitleMergeMode`, re-parse with `mergeBilingual: false`, then load physical cues into the store for editor/burn.

## Anti-Patterns

- New native `<button>` / `<select>` / `<input>` with one-off Tailwind instead of shadcn
- Cards/panels that reimplement focus rings inconsistently
- Embedding clip/burn completion side effects only inside a page that can unmount mid-job
- Using English UI copy for product surfaces (specs are English; the app is Chinese)
