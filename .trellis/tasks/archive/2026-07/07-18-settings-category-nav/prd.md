# Settings category navigation redesign

## Goal

Replace the single long scrolling settings page with a left category menu + right content pane, so settings stay scannable as the item count grows and new categories can be added later.

## Background / Confirmed Facts

- Settings is a shell (`SettingsView`) with left category nav + right content pane.
- Categories (UI: 运行依赖 / 转录 / 翻译):
  1. **Runtime** — `RuntimeDependenciesPanel` (download source, managed dependency status, storage measure/cleanup)
  2. **Transcription** — `SettingsTranscriptionPanel` (ASR engine / model / device, ModelManager, AsrEngineSetupPanel)
  3. **Translation** — `SettingsTranslationPanel` (OpenAI-compatible API, batch params, prompt, glossary, merge mode, default target language)
- Shared form helpers live in `settingsForm.tsx`.
- Theme toggle (`ModeToggle`) lives in the main app sidebar, not in Settings.
- Product decisions:
  - Save: single page-header Save; switching categories keeps the draft and does not prompt
  - Runtime panel "去配置" switches to the Transcription category (no in-pane scroll)
  - Sidebar opens Settings on Runtime via `openSettings("runtime")`; last category is not persisted after leaving Settings
  - Cross-page deep links use `uiStore.openSettings(category)` (Transcribe → transcription, Translate → translation when Base URL missing, runtime dialogs → runtime)

## Requirements

- R1. Settings uses a left category nav + right content pane layout.
- R2. Keep all existing settings fields and `AppSettings` semantics; keep one local settings draft + header-level global Save.
- R3. Left categories are fixed: Runtime, Transcription, Translation (UI copy in Simplified Chinese as above).
- R4. Runtime panel "去配置" switches the left selection to Transcription.
- R5. Switching categories must not discard unsaved edits or show a confirm dialog; `dirty` accumulates across categories; Save from any category writes the full draft.
- R6. Sidebar entry into Settings lands on Runtime; do not persist the last selected category after leaving Settings.
- R7. Other workflow pages that navigate to Settings must deep-link the matching category via `openSettings`.

## Acceptance Criteria

- [x] AC1. Opening Settings shows the left category menu (运行依赖 / 转录 / 翻译); Runtime is selected by default from the sidebar; clicking a category swaps only the right pane.
- [x] AC2. Every existing settings control lives under one of the three categories and remains editable/savable.
- [x] AC3. Header keeps global Save; edits made under category A survive a switch to B and are included when Save is clicked on B.
- [x] AC4. Clicking "去配置" on Runtime selects Transcription and shows transcription settings on the right.
- [x] AC5. Leaving Settings and re-entering from the sidebar still defaults to Runtime.
- [x] AC6. Transcribe "前往设置" opens Transcription; Translate "前往设置" opens Translation; runtime dependency "更改下载源" opens Runtime.

## Out of Scope

- No new settings fields (e.g. moving theme into Settings).
- No empty fourth "General" category (future expansion is a separate task).
- No ASR / translation / runtime-dependency backend behavior changes.
- No settings search; no separate settings window.
- No "unsaved changes" prompt on category switch; no per-category Save.
- "去配置" does not secondary-scroll within Transcription (category switch only).
- Do not persist last selected category.
