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

`SettingsView` uses a left category nav (`runtime` / `transcription` / `providers` / `translation` / `shortcuts` / `about`) and a right content pane. Provider connection/auth/model/limits live under `providers`; translation behavior remains under `translation`; product identity / version / GitHub / license live under `about` (no Save button). Cross-page jumps into Settings should use `uiStore.openSettings(category)` rather than bare `setStep("settings")`.

### Editor / player

- Editor workspace layout stays left video+timeline / upper-right list / lower-right editor. The two outer pane ratios are pointer-resizable and persist globally through `editorPaneLayout.ts`; use CSS Grid `minmax(<px>, <ratio>fr)` tracks for window-size constraints so no resize observer overwrites the preferred value. Keep the video/timeline boundary fixed, keep layout state out of project history/per-video metadata, do not intercept editor arrow keys for pane resizing, retain separator semantics, and retain double-click reset to defaults.
- Mode-agnostic physical rows: list and selected-row editor show `cue.primaryText` with one generic 字幕 field; do not branch on `subtitleMergeMode` or show dual original/translation fields.
- Multi-row formatting: when more than one valid `selectedCueIds` entry exists, right-panel style and ASS override controls apply to every selected physical row's complete `primaryText`. Ignore stale IDs when deciding whether the operation is multi-row. With one valid row, preserve textarea selection/caret behavior; timing, subtitle text, new-row, and right-panel delete remain active-row operations. Single-row inline formatting/alignment is one discrete `updateCue`; multi-row remains one `replaceCues`.
- Live text preview while typing/IME must stay immediate; project history groups via store + `editorTextHistory`, not one snapshot per keystroke. React 19 may omit synthetic `onBeforeInput` for Backspace/Delete, so deletion grouping must pair native `input.inputType` with the pre-edit selection cached by textarea select/keydown events. Missing or unknown `inputType` remains discrete; never infer an operation from text-length changes. Mark only subtitle text + start/end time inputs with `data-history-command`: project undo/redo must respond immediately there and outside inputs, while unmarked transient inputs retain browser/WebView native undo/redo.
- `SubtitleEditor` exposes `commitPendingTimeDraft()` for shared undo/save coordination; it must normalize with the last edited field (`start` vs `end`) so inverted ranges clamp in the correct direction. Track whether the user actually edited a time input explicitly; do not infer a pending draft only because local controlled values temporarily differ from a synchronous external Store update, or immediate undo will first write stale values and appear to do nothing. When EditorView commits a real time draft and immediately undoes it in one event, explicitly resync the controlled time inputs from the resulting Store state because React may batch away the intermediate Store value. Focus/blur without an effective edit must not dirty or push history.
- Editor and clip-dialog time inputs use `H:MM:SS.cc` (unpadded hours) through `src/utils/timeInput.ts`. Caret/edit logic follows visible digit positions; do not reintroduce a hidden fixed-width `HH` slot model. Structured values such as `1:02:03.45` must retain field boundaries during normalization.
- Timeline timing gestures keep pointer/preview/snap state inside the component, snapshot playhead/FPS/other-cue boundaries at gesture activation, and commit only once on pointer-up (`updateCue` for one cue); cancel/lost capture is a no-op. Batch numeric shifts build one reference-preserving list and call `replaceCues` once. Before a timeline interaction or context-menu timing action changes selection or cue timing, synchronously flush the active `SubtitleEditor` time draft and then re-read the cue from `projectStore`; this includes a sub-threshold cue-body click because canvas pointer prevention cannot rely on input blur. Otherwise changing the active cue can discard the visible draft. Disable global editor hotkeys while the shift dialog is open so radio-button focus cannot route document commands behind the modal. Frame stepping continues to seek frame centers, while subtitle timing snaps to frame starts; FPS falls back to 30 for both. Snapping uses source tiers: legal playhead/other-cue boundaries within 12 CSS px beat any frame candidate, then frame starts use a 4 CSS px fallback; whole-cue start/end anchors preserve the same strong-before-frame ordering.
- Preview/save/burn serialize physical cues (prefer `preserveOrder: true` where row order must match the store); do not re-merge by settings. Editor save awaits path selection first, then flushes pending time + `captureSaveSnapshot` / token `markSaved`.
- Playback uses local HTTP media URLs from `registerMediaPlayback` — not `asset://` as the primary path.
- Libass WASM preview is preferred; CSS fallback only when libass is unavailable (`LibassFallbackNotice`).

### Translation view

- Initialize a page-local provider selection from `defaultTranslationProviderId`. The Translation view dropdown changes only that mounted view's selection; it must not persist settings or change the configured default. Missing/incomplete selections, including an empty API key, deep-link to `openSettings("providers")`.
- Page-owned source loads from **transcribed** ASS on enter; do not treat current `projectStore` physical rows as translation source.
- Entering the page must not write or delete the existing translated ASS file.
- On complete translation success: serialize logical results with `settings.subtitleMergeMode` and `settings.subtitleTextOrder`; re-parse with `mergeBilingual: false`, then load physical cues into the store for editor/burn.
- A partial failure or user cancellation remains a page-local logical draft: do not call project-store setters or write `translatedAssPath` until the user explicitly selects `保存当前结果`. That action must run `confirmDiscardUnsavedChanges` again, preserve the existing document guard/recovery/token-aware save sequence, and only then enable `进入编辑`.
- `重试失败条目` sends only cues without a non-empty `secondaryText`; merge retry successes by cue `id` into the page-local result while preserving existing translations and source order.
- Each mounted translation run owns an `AbortController`. Pass its signal through the translation service, cancel only while provider requests are active, and abort/invalidate the run on unmount or session-video change. A cancellation accepted before the request phase closes must never proceed to automatic apply/save, even when the last HTTP response settles concurrently. Cancellation caused by leaving Translation or switching the session video must remain visible in the global status bar and as the previous status when Translation mounts again, explicitly saying it will not continue in the background. Manual cancellation may keep the concise success/failure count message.
- Translation service retry and error-redaction contracts live under [Type Safety > Translation Types](./type-safety.md#translation-types).
- A non-cancelled result with zero successes and at least one failure is `翻译失败`, not `翻译部分完成`; saving the current result remains disabled. Translation's root container must keep `min-h-0 flex-1 overflow-y-auto overflow-x-hidden` so the status section cannot be clipped by AppLayout.

## Anti-Patterns

- New native `<button>` / `<select>` / `<input>` with one-off Tailwind instead of shadcn
- Cards/panels that reimplement focus rings inconsistently
- Embedding clip/burn completion side effects only inside a page that can unmount mid-job
- Using English UI copy for product surfaces (specs are English; the app is Chinese)
