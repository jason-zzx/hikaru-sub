# Deduplicate shared frontend and Rust helpers

## Goal

Unify duplicated time, path, ASS/style, language, async, FFmpeg status, and workflow form helpers across the React frontend, and centralize duplicated FFmpeg progress/time parsers in the Rust Tauri backend (fixing the `out_time_ms` microsecond-to-millisecond unit mismatch in `download.rs`) while preserving existing UI appearance and display units.

## Requirements & Technical Scope

### R1. Unify time formatting (`formatMs` → `src/utils/formatTime.ts`)
- **Defect & duplication**:
  - `src/components/workflow/BurnView.tsx:98-108` (`BurnView.tsx:596`) and `src/components/workflow/DownloadView.tsx:31-41` (`DownloadView.tsx:379-380,411`) duplicate identical `formatMs(ms)` helpers (`Math.round(ms / 1000)`, `H:MM:SS` / `M:SS`, non-positive guard returning `"0:00"`).
  - `src/components/workflow/TranscribeView.tsx:63-69` (`TranscribeView.tsx:871`) defines a partial `formatMs(ms)` missing the `h > 0` branch (rendering `>= 1h` durations as `65:00` instead of `1:05:00`).
  - `src/utils/formatTime.ts:7-23` (`formatPlaybackTime`) lacks a `Number.isFinite` guard (producing `"NaN:NaN"` on `NaN`) and its JSDoc (`formatTime.ts:5`) inaccurately states hours are zero-padded to 2 digits despite unpadded behavior (`formatTime.ts:20`, `src/utils/formatTime.test.ts:9`).
- **Requirement**:
  - Extract a shared internal clock formatter in `src/utils/formatTime.ts`, export `formatDurationSeconds(ms)` (using `Math.round(ms / 1000)`, `H:MM:SS` / `M:SS`, and `!Number.isFinite(ms) || ms <= 0` → `"0:00"`), harden `formatPlaybackTime` with the same non-finite/non-positive guard while retaining `Math.floor` semantics, and fix the inaccurate JSDoc comment.
  - Replace all three local `formatMs` definitions in `BurnView.tsx`, `DownloadView.tsx`, and `TranscribeView.tsx` with `formatDurationSeconds`.

### R2. Unify frontend path helpers (`src/utils/path.ts`)
- **Duplication**:
  - `pathDir` and `pathStem` are duplicated in `BurnView.tsx:110-119` (empty stem fallback `"output"`) and `ClipDialog.tsx:72-81` (empty stem fallback `"video"`).
  - `fileName` is duplicated in `WelcomeView.tsx:16` and `ImportView.tsx:60`, and inlined in `Sidebar.tsx:122` and `src/utils/subtitleImport.ts:22`.
  - `WelcomeView.tsx:18-22` defines `parentPath` (preserving a leading `/` when `separator === 0`).
- **Requirement**:
  - Create `src/utils/path.ts` exporting `getFileName`, `getParentDir` (with optional root preservation matching `WelcomeView`), and `getFileStem` (with fallback parameter) and migrate all 6 sites.

### R3. Consolidate ASS, color, and font helpers
- **Duplication**:
  - `src/utils/libassGlyphFallback.ts:44-53` and `src/services/libassFontSelection.ts:159-168` duplicate identical case-insensitive `findStyle(styles, styleName)` functions (distinct from case-sensitive `findAssStyle` in `src/utils/assStyleCss.ts:94-106`, which falls back to default styles when empty).
  - `src/utils/assOverrideTags.ts:89-92` (`formatAssNumber`) is duplicated inline in `src/components/editor/SubtitleEditor.tsx:467-470`.
  - `src/utils/assColor.ts:1-17` is a thin alias wrapper around `src/lib/ass/color.ts` imported only by `src/components/editor/ColorPicker.tsx:3` and `src/utils/assColor.test.ts`; `ColorPicker.tsx:21-39` also re-implements `clamp`, `toByte`, `toHexByte`, and `rgbaCss`.
  - `StyleManager.tsx:31-39` (`COMMON_FONTS`, 7 fonts including `"SimHei"`) and `SubtitleEditor.tsx:55-62` (`QUICK_FONT_OPTIONS`, first 6 fonts) duplicate the same 6 base fonts.
- **Requirement**:
  - Deduplicate `findStyle` into a shared helper (without changing `findAssStyle` in `assStyleCss.ts`).
  - Export `formatAssNumber` from `src/utils/assOverrideTags.ts` and reuse it in `SubtitleEditor.tsx`.
  - Consolidate `ColorPicker.tsx` color conversion onto `@/lib/ass` (exporting `clampByte`/`toHexByte` or `rgbaToCss` if helpful), remove redundant `src/utils/assColor.ts`, and preserve/migrate `assColor.test.ts` coverage into `src/lib/ass/color.test.ts`.
  - Share the 6-font base list from a shared constant while keeping `StyleManager.tsx`'s `"SimHei"` addition and `SubtitleEditor.tsx`'s 6-item list unchanged.

### R4. Consolidate frontend async, language constants, and FFmpeg hook
- **Duplication**:
  - `sleep(ms)` is declared in `ModelManager.tsx:18`, `TranscribeView.tsx:53`, `SettingsView.tsx:44`, and `src/hooks/useRuntimeDependencyPreparation.ts:16`, and inlined in `useBurnJobPoller.ts:53`, `useClipJobPoller.ts:124`, and `useDownloadJobPoller.ts:61`.
  - `TARGET_LANGS` (`zh-CN`, `zh-TW`, `en`, `ja`, `ko`) is duplicated in `TranslateView.tsx:32-38` and `SettingsTranslationPanel.tsx:9-15`, while `src/services/translation/base.ts:510-524` (`getLangName`) keeps a superset `langMap`.
  - `useState<FfmpegStatus | null>` + `refreshFfmpeg(force)` + mount `useEffect` is repeated in `ImportView.tsx:49-58`, `DownloadView.tsx:72-81`, `TranscribeView.tsx:139-148`, and `BurnView.tsx:219-228`.
- **Requirement**:
  - Extract `sleep(ms)` (e.g., `src/utils/async.ts`) and reuse across all 7 sites.
  - Extract `TARGET_LANGS` into a shared constant module (e.g., `src/constants/translation.ts` or `translationProviders.ts`) and reuse in `TranslateView.tsx`, `SettingsTranslationPanel.tsx`, and `base.ts` (preserving `base.ts`'s extra language codes `zh`/`fr`/`de`/`es`/`ru`).
  - Extract `useFfmpegStatus()` hook (`src/hooks/useFfmpegStatus.ts`) and reuse across `ImportView.tsx`, `DownloadView.tsx`, `TranscribeView.tsx`, and `BurnView.tsx` without altering force-refresh behavior.

### R5. Deduplicate workflow form class/Field without changing UI appearance or units
- **Decision (User-approved Option 1)**: Preserve exact existing visual appearance, layout, and progress display units—do **not** migrate `<input>` elements to shadcn `<Input>` (`h-8 bg-transparent`) and do **not** replace `ModelManager.tsx:20-22` `formatMB` with `formatDependencyBytes`.
- **Duplication**:
  - `settingsInputClass` in `src/components/workflow/settingsForm.tsx:3-4` is duplicated as `INPUT_CLASS` in `DownloadView.tsx:28-29` and `BurnView.tsx:29-30`.
  - `SettingsField` in `settingsForm.tsx:26-39` is identical to `Field` in `DownloadView.tsx:506-519`.
- **Requirement**:
  - Reuse `settingsInputClass` across `DownloadView.tsx` and `BurnView.tsx` (removing local `INPUT_CLASS`), and reuse `SettingsField` (or a shared `FormField` preserving identical classes) in `DownloadView.tsx`. Leave `BurnView.tsx:695-704` (`text-xs font-medium`), `StyleManager.tsx:28-29,1205-1218` (compact editor panel sizing), and `ModelManager.tsx` `formatMB` visually unchanged.

### R6. Centralize Rust FFmpeg progress/time parsing and fix `download.rs` unit bug
- **Defect & duplication (`src-tauri/src/`)**:
  - `parse_hhmmss_ms` and `parse_time_token` (plus 3 copies of `parse_duration_line`) are duplicated across `ffmpeg.rs:116-156`, `burn.rs:123-165`, `clip.rs:297-329`, and `download.rs:293-330`; `transcode.rs:472-476,541-551` parses `time=HH:MM:SS.ms` via `parse_time_to_seconds`.
  - **Bug (Medium/High severity)**: FFmpeg `-progress` outputs `out_time_ms=` in microseconds. `burn.rs:152-155` and `clip.rs:316-319` divide by `1000` to convert to milliseconds, whereas `download.rs:333-337` omits `/ 1000` (with a self-consistent unit test at `download.rs:2030-2033` expecting `Some(12345)` for `"out_time_ms=12345"`), even though `download.rs:512,555,614` passes `-progress pipe:2` and `download.rs:780,1740` compares the output against millisecond `duration_ms`.
- **Requirement**:
  - Expose `parse_hhmmss_ms`, `parse_duration_line`, `parse_time_token`, and `parse_progress_out_time_ms` (`us / 1000`) from `src-tauri/src/ffmpeg.rs`, remove the duplicate copies in `burn.rs`, `clip.rs`, `download.rs`, and `transcode.rs` (`parse_time_to_seconds` → `parse_time_token` in `transcode.rs:476`), and update `download.rs:2030-2033` tests to reflect microsecond input (`"out_time_ms=12345000"` → `Some(12345)`).

## Out of Scope

- Time formatters with different contracts/formats: `Timeline.tsx:1013-1019` (`M:SS.cc`), `ClipDialog.tsx:84-91` (`HHMMSS` token), `WelcomeView.tsx:24-33` (`formatRelativeTime`), `src/lib/ass/time.ts` / `src/utils/timeInput.ts` (`H:MM:SS.cc`), `src/utils/subtitleExport.ts` (SRT `HH:MM:SS,mmm`).
- Migrating existing raw `<input>` elements to `src/components/ui/input.tsx`, altering `StyleManager.tsx` / `BurnView.tsx` field typography/spacing, or changing `ModelManager.tsx` `formatMB` units.
- Unrelated refactoring outside the duplicated definitions listed above.

## Acceptance Criteria

- [x] **AC-R1**: `BurnView.tsx`, `DownloadView.tsx`, and `TranscribeView.tsx` have no local `formatMs`; all three use `formatDurationSeconds` from `src/utils/formatTime.ts` (`Math.round` seconds, `H:MM:SS` for `>= 1h`), `formatPlaybackTime` guards non-finite inputs, and `formatTime.test.ts` covers both functions and edge cases.
- [x] **AC-R2**: `src/utils/path.ts` owns `getFileName`, `getParentDir`, and `getFileStem` with unit tests; `BurnView.tsx`, `ClipDialog.tsx`, `WelcomeView.tsx`, `ImportView.tsx`, `Sidebar.tsx`, and `subtitleImport.ts` have no duplicate path-splitting helpers.
- [x] **AC-R3**: `findStyle` has a single shared implementation (preserving `findAssStyle` untouched); `SubtitleEditor.tsx` reuses `formatAssNumber` from `assOverrideTags.ts`; `ColorPicker.tsx` uses `@/lib/ass` color utilities directly without `src/utils/assColor.ts` (tests preserved in `src/lib/ass/color.test.ts`); font presets share the common 6-font base without changing UI options.
- [x] **AC-R4**: `sleep` lives in `src/utils/async.ts` and is reused across the 4 workflow/hook files and 3 job pollers; `TARGET_LANGS` has a single source of truth shared by `TranslateView.tsx`, `SettingsTranslationPanel.tsx`, and `base.ts`; `useFfmpegStatus` replaces the 4 identical FFmpeg status blocks in workflow views.
- [x] **AC-R5**: `DownloadView.tsx` and `BurnView.tsx` reuse `settingsInputClass` from `settingsForm.tsx` and `DownloadView.tsx` reuses `SettingsField`, with zero visual changes to input styling, `BurnView` / `StyleManager` field labels, or `ModelManager` `MB` progress text.
- [x] **AC-R6**: `src-tauri/src/ffmpeg.rs` provides the single implementation of FFmpeg time/progress parsing (`parse_hhmmss_ms`, `parse_duration_line`, `parse_time_token`, `parse_progress_out_time_ms`) reused by `burn.rs`, `clip.rs`, `download.rs`, and `transcode.rs`, and `download.rs` converts `out_time_ms=` microseconds to milliseconds with updated unit tests.
- [x] **AC-Verify**: `pnpm test`, `pnpm build`, and `cargo test --manifest-path src-tauri/Cargo.toml` all pass after final edits.
