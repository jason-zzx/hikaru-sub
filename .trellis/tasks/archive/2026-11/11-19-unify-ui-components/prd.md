# Unify UI styling and shadcn components

## Goal

Complete the migration of Hikaru Sub's React frontend (`src/`) onto the shadcn/ui (`radix-nova`) semantic token and component system: fix broken Tailwind v4 Radix variants and light-mode contrast regressions caused by misused `accent` / hardcoded palette classes, unify all forms, dialogs, buttons, and icons onto `src/components/ui/`, and introduce missing shadcn primitives (`textarea`, `progress`, `popover`, `context-menu`, `sheet`, `slider`, `collapsible`) to replace hand-rolled and raw native controls without changing non-UI business logic or regressing editor live-preview workflows.

## Confirmed Facts & Constraints

- `components.json` configures shadcn `radix-nova` with `lucide` icons and `src/styles/index.css`; `package.json` uses Tailwind CSS v4, `radix-ui`, `tw-animate-css`, and `lucide-react` (no `shadcn/tailwind.css` package).
- `.trellis/spec/frontend/component-guidelines.md` and `/AGENTS.md` mandate: shadcn/ui first (`pnpm dlx shadcn@latest add`), semantic tokens customized in `src/styles/index.css` (no internal class overrides in business files), SVG icons only (`NavIcons` / `lucide-react`, no character or emoji icons), and Simplified Chinese user-facing copy.
- Existing behavioral invariants that must remain intact:
  - `SubtitleEditor.tsx`: `data-history-command` (`HISTORY_COMMAND_ATTR`) undo/redo scoping, IME composition handling, and `commitPendingTimeDraft` / `syncTimeInputsFromStore` coordination.
  - `ColorPicker.tsx`: `deferChange` pending color flush on close/outside click.
  - `FontComboBox.tsx`: live typing filter with `ArrowUp`/`ArrowDown`/`Enter`/`Escape` keyboard navigation.
  - `SubtitleList.tsx`: right-click `onCommitPendingTimeDraft` flush, `playheadMs`/`canSplitTarget` snapshots, and preservation of in-flight segment playback.
  - `StyleManager.tsx`: live style preview alongside the video player and timeline while the style drawer is open.

## Requirements & Technical Scope

### R1. Fix Tailwind v4 Radix state/orientation variants & `src/components/ui/` hygiene
- Define Tailwind v4 `@custom-variant` rules in `src/styles/index.css:1-5` for:
  - `data-open` (`&:where([data-state="open"], [data-open]:not([data-open="false"]))`)
  - `data-closed` (`&:where([data-state="closed"], [data-closed]:not([data-closed="false"]))`)
  - `data-horizontal` (`&:where([data-orientation="horizontal"], [data-horizontal])`)
  - `data-vertical` (`&:where([data-orientation="vertical"], [data-vertical])`)
  so existing (`src/components/ui/separator.tsx:18`, `dialog.tsx:40,62`, `select.tsx:70`, `tooltip.tsx:45`) and newly generated shadcn primitives size and animate properly.
- Remove unnecessary Next.js `"use client"` directives from `src/components/ui/tooltip.tsx:1`, `src/components/ui/label.tsx:1`, and any newly added shadcn UI files.

### R2. Fix visual token bugs, hardcoded colors, and remove deprecated legacy token aliases
- Replace misused `accent` tokens (now subtle hover surface in shadcn, causing invisible/low-contrast fills in light mode) with `primary`:
  - `src/components/workflow/ImportView.tsx:188,192,222,224`
  - `src/components/workflow/TranscribeView.tsx:1064`
  - `src/components/workflow/ModelManager.tsx:260`
  - `src/components/workflow/RuntimeDependenciesPanel.tsx:180`
  - `src/components/workflow/RuntimeDependencyDialog.tsx:79,92,100`
  - `src/components/workflow/BurnView.tsx:491,553,649-650`
  - `src/components/workflow/DownloadView.tsx:470-471`
  - `src/components/editor/EditorView.tsx:526,536,546,555,563,606,610,658,662`
  - `src/components/workflow/WelcomeView.tsx:145`
  - `src/components/editor/ColorPicker.tsx:210`
  - `src/components/editor/StyleManager.tsx:1228`
- Replace hardcoded Tailwind palette classes and undefined `text-text-dimmed` with semantic tokens (`warning`, `success`, `destructive`, `muted-foreground`, `primary`):
  - `src/components/workflow/TranslateView.tsx:588-609,641-652,658,662,717,726-757,771,779-782` (fixes unreadable `text-red-300`/`text-red-400` in light mode and undefined `text-text-dimmed`)
  - `src/components/player/VideoPlayer.tsx:495,505` (`text-red-400` → `text-destructive`, `bg-blue-500` → `Progress` / `bg-primary`)
- Migrate all legacy color aliases across `src/` (`bg-surface` → `bg-background`, `bg-surface-raised` → `bg-card`, `bg-surface-overlay` → `bg-muted`, `text-text` → `text-foreground`, `text-text-muted` → `text-muted-foreground`, `*-danger` → `*-destructive`, `accent-muted` → `primary`) and remove the deprecated alias variables (`--color-surface`, `--color-surface-raised`, `--color-surface-overlay`, `--color-text`, `--color-text-muted`, `--color-accent-muted`, `--color-danger`) from `src/styles/index.css:8-157` while retaining `--color-success`, `--warning`, and `--timeline-*`.

### R3. Unify icons and fix Sidebar / ModeToggle / BrandMark defects
- `src/components/layout/Sidebar.tsx:96-104`: replace character icon `{collapsed ? "»" : "«"}` with `lucide-react` SVG chevron/panel icons inside `<Button variant="ghost" size="icon">`.
- `src/components/layout/Sidebar.tsx:113` & `src/components/ModeToggle.tsx:18-41`: pass `collapsed` prop to `ModeToggle` so the collapsed sidebar renders icon-only without clipped text.
- `src/components/layout/NavIcons.tsx:119-136`: give `IconBurn` a distinct SVG path instead of duplicating `IconDownload` (`NavIcons.tsx:41-58`).
- Replace inline `<svg>` elements in `src/components/player/PlaybackControls.tsx:51-144` (7 inline SVGs across 6 buttons) and `src/components/editor/HotkeyHelpOverlay.tsx:55-67` (close icon) with `NavIcons.tsx` / `lucide-react`, avoiding redundant custom generic icons where `lucide-react` is already used.
- `src/components/brand/BrandMark.tsx:25`: replace hardcoded `id="brandMarkHGrad"` with React `useId()` so simultaneous renders (`Sidebar` + `WelcomeView`/`SettingsAboutPanel`) never produce duplicate DOM IDs.

### R4. Standardize Dialogs and ConfirmDialog
- Customize `DialogFooter` directly in `src/components/ui/dialog.tsx:96-121` to use a seamless layout (`flex flex-col-reverse gap-2 sm:flex-row sm:justify-end`), removing the `radix-nova` split muted bar and top border (`-mx-4 -mb-4 rounded-b-xl border-t bg-muted/50 p-4`) and adding a brief comment noting the intentional project-wide choice so future CLI updates do not silently revert it.
- Remove the business-file `DialogFooter` class override in `src/components/workflow/SettingsView.tsx:424` and align its `DialogContent`/`DialogHeader` padding with standard `DialogContent`.
- Refactor `src/components/ui/ConfirmDialog.tsx:33-82`, `src/components/editor/HotkeyHelpOverlay.tsx:39-91`, and `src/components/workflow/RuntimeDependencyDialog.tsx:41-114` onto standard shadcn `Dialog` (`DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `showCloseButton`), preserving `ConfirmDialog`'s multi-option API (`options`, `onSelect`, `escValue`) while unifying all 6 dialogs (`ClipDialog`, `ShiftTimesDialog`, `SettingsView`, `RuntimeDependencyDialog`, `ConfirmDialog`, `HotkeyHelpOverlay`) on Portal rendering, focus trapping, `role="dialog"`, Escape handling, and a seamless body-to-footer appearance.
- Standardize confirmation button order in `src/components/editor/StyleManager.tsx:708-746` to Cancel-left, Confirm/Destructive-right matching all other dialogs.

### R5. Migrate raw `<input>`, `<input type="checkbox">`, and `<button>` controls, unify sizing/buttons, and fix accessibility
- Migrate all raw text/number/url `<input>` elements to `src/components/ui/input.tsx`:
  - `src/components/workflow/DownloadView.tsx:243,255,266,291`
  - `src/components/workflow/BurnView.tsx:389,436,452,505` (also add missing `disabled={busy}` on directory inputs and picker buttons at `L389,395,505,512`)
  - `src/components/workflow/SettingsTranslationPanel.tsx:30,45`
  - `src/components/editor/StyleManager.tsx:882,914,928,945,959,975,1069,1084,1127,1141,1156`
  - `src/components/editor/SubtitleEditor.tsx:750,765,820`
  - `src/components/editor/InlineOverridePanel.tsx:197,222`
  - `src/components/editor/ColorPicker.tsx:232,249,258`
  - `src/components/editor/FontComboBox.tsx:136`
  - Remove `settingsInputClass` from `src/components/workflow/settingsForm.tsx:3-4` and `INPUT_CLASS` from `src/components/editor/StyleManager.tsx:29-30`.
- Migrate `src/components/editor/StyleManager.tsx:1224-1229` (`CheckboxField`) from native `<input type="checkbox">` to `src/components/ui/checkbox.tsx`.
- Migrate missed raw `<button>` elements:
  - `src/components/workflow/ImportView.tsx:116` → `<Button variant="outline" size="sm">`
  - `src/components/workflow/SettingsAboutPanel.tsx:126,145` → `<Button variant="link">`
  - `src/components/workflow/ClipDialog.tsx:465,485` → `<Button variant="ghost" size="icon-xs">`
  - `src/components/workflow/ImportView.tsx:218` → shadcn `Button` or unified focus-visible styling matching shadcn focus rings
  - `src/components/editor/InlineOverridePanel.tsx:150-163` → shadcn `Tabs` (`TabsList`/`TabsTrigger`), and unify 9-grid alignment buttons in `InlineOverridePanel.tsx:176-189` and `StyleManager.tsx:1110-1121` onto `Button`
  - Deduplicate `ModeButton` in `src/components/workflow/DownloadView.tsx:453-478` and `src/components/workflow/BurnView.tsx:629-657` into a shared selectable mode card/button component using shadcn tokens and focus rings
  - Align sidebar/category nav buttons in `Sidebar.tsx:53`, `ModeToggle.tsx:30`, and `SettingsView.tsx:330` onto shadcn `Button` (`variant="ghost"`) or unified ring/focus styling.
- Button & layout normalization:
  - Remove redundant/conflicting `<Button>` padding, radius, and disabled overrides (`px-4 py-2`, `px-3 py-1.5`, `rounded-lg`, `disabled:opacity-50`) across workflow and editor views in favor of `Button` `size` variants.
  - Unify destructive/cancel buttons in `TranscribeView.tsx:880-887` and `SubtitleEditor.tsx:788-795` to `variant="destructive"`.
  - Align inline row heights (`h-8`) in `SubtitleEditor.tsx:799-884`, `DownloadView.tsx:290-308`, and `BurnView.tsx:388-403,504-520`.
  - Update `PlaybackControls.tsx:45-145` icon buttons to `size="icon-sm"` with explicit `aria-label` attributes.
  - Fix `EditorToast.tsx:41-49` close button contrast on solid `bg-success`/`bg-destructive` banners (e.g. `hover:bg-white/15 hover:text-white` rather than `bg-muted text-foreground`).
- Accessibility fixes:
  - Replace nested interactive `<div role="button">` in `StyleManager.tsx:802-848` with a sibling select `<Button>` + delete `<Button>` (mirroring `WelcomeView.tsx:217-268`).
  - Bind unbound `<label>` / `<Label>` elements via `htmlFor`/`id` in `TranslateView.tsx:615-630`, `SubtitleEditor.tsx:749-887`, `SubtitleFindPanel.tsx:254-310`, and `StyleManager.tsx:881`.

### R6. Introduce missing shadcn primitives via CLI and migrate remaining native/hand-rolled widgets
- Install missing shadcn primitives via `pnpm dlx shadcn@latest add`: `textarea`, `progress`, `popover`, `context-menu`, `sheet`, `slider`, `collapsible`.
- **`Textarea`**: replace raw `<textarea>` in `DownloadView.tsx:277`, `SettingsTranslationPanel.tsx:60,70`, and `SubtitleEditor.tsx:888` (preserving `ref`, IME composition handlers, and `data-history-command`).
- **`Progress`**: unify all 9 progress indicators (`ImportView.tsx:190`, `DownloadView.tsx:367`, `TranscribeView.tsx:1062`, `TranslateView.tsx:684`, `BurnView.tsx:551`, `ModelManager.tsx:258`, `RuntimeDependenciesPanel.tsx:178`, `RuntimeDependencyDialog.tsx:77`, `VideoPlayer.tsx:503`), including indeterminate styling when progress percentage is `null`.
- **`Popover`**: migrate `InlineOverridePanel.tsx:145-245`, `ColorPicker.tsx:221-275`, and `FontComboBox.tsx:158-188` onto Portal-based `Popover` so `EditorView.tsx:666` (`overflow-hidden`) never clips popovers while preserving `ColorPicker` `deferChange` flush on close and `FontComboBox` typing/keyboard navigation without stealing focus from the input.
- **`ContextMenu`**: migrate `SubtitleList.tsx:362-509,616-631` onto shadcn `ContextMenu` (preventing viewport overflow and adding keyboard navigation while preserving right-click draft flush, selection updates, `playheadMs`/`canSplitTarget` snapshots, and in-flight segment playback; update `SubtitleList.test.tsx` menu item queries to `role="menuitem"`).
- **`Sheet`**: migrate `StyleManager.tsx:545` drawer onto non-modal shadcn `Sheet` (`modal={false}`, no blocking backdrop overlay, keeping `w-[440px]`, Escape close, and uninterrupted interaction with the video player/timeline while editing styles; update `StyleManager.test.tsx` drawer selector if needed).
- **`Slider`**: migrate `PlaybackControls.tsx:112-119` bare `<input type="range">` onto shadcn `Slider` (preserving seek requests; update `PlaybackControls.test.tsx` to target `role="slider"`).
- **`Collapsible`**: migrate all 8 `<details>/<summary>` blocks (`StyleManager.tsx:898-1172` [5], `TranscribeView.tsx:743`, `TranslateView.tsx:761`, `RuntimeDependenciesPanel.tsx:191`) onto shadcn `Collapsible` with consistent chevron indicators.

## Key Decisions

- **Lightweight task scope**: `prd.md` only (`design.md` and `implement.md` omitted per user instruction).
- **Seamless shadcn `DialogFooter`**: adopt standard shadcn `Dialog` across all modals, while adjusting `DialogFooter` once inside `src/components/ui/dialog.tsx` to remove the `radix-nova` split muted bar and top border (`border-t bg-muted/50`), giving every dialog a unified seamless body-to-footer layout without business-layer overrides.
- **Non-modal `StyleManager` `Sheet`**: configure `Sheet` with `modal={false}` and without a blocking backdrop so users can scrub/play the video preview on the left while adjusting styles live.
- **Full removal of legacy CSS color aliases**: migrate all `src/` call sites onto shadcn semantic tokens and remove deprecated `--color-surface*`, `--color-text*`, `--color-accent-muted`, and `--color-danger` aliases from `src/styles/index.css` (retaining `--color-success`, `--warning`, and `--timeline-*`).
- **Coordinated unit test updates**: update existing component tests coupled to replaced DOM primitives (`PlaybackControls.test.tsx` `input[type="range"]`, `SubtitleList.test.tsx` `role="button"` menu items, `StyleManager.test.tsx` `<aside>` selector) to query accessible shadcn/Radix semantics without relaxing behavioral assertions.

## Out of Scope

- Rust/Tauri backend changes, refactoring `VideoPlayer.tsx` direct `invoke` calls into `src/services/tauri.ts`, ASS domain parsing/serialization (`src/lib/ass/`), translation/ASR/FFmpeg logic, timeline Canvas rendering, or git commits.

## Acceptance Criteria

- [x] **AC-R1**: `src/styles/index.css` defines Tailwind v4 `@custom-variant` rules for `data-open`, `data-closed`, `data-horizontal`, and `data-vertical`; `src/components/ui/` contains no `"use client"` directives; `Dialog`, `Select`, `Tooltip`, and `Separator` render and animate properly.
- [x] **AC-R2**: Zero occurrences of deprecated legacy aliases (`bg-surface`, `bg-surface-raised`, `bg-surface-overlay`, `text-text`, `text-text-muted`, `text-text-dimmed`, `*-danger`, `accent-muted`) remain in `src/`, zero `accent` tokens are misused as primary emphasis/progress fills, and `TranslateView` / `VideoPlayer` use semantic tokens instead of hardcoded `red-*`/`yellow-*`/`green-*`/`blue-*` palette classes.
- [x] **AC-R3**: `Sidebar` collapse toggle uses a `lucide-react` SVG icon and `ModeToggle` hides its text label when `collapsed` is true; `IconBurn` has a distinct icon from `IconDownload`; `BrandMark` uses `useId()` for its gradient ID; `PlaybackControls` and `HotkeyHelpOverlay` contain no inline `<svg>` tags.
- [x] **AC-R4**: `src/components/ui/dialog.tsx` renders a seamless `DialogFooter` (no split `bg-muted/50` bar or `border-t` divider); `ConfirmDialog`, `HotkeyHelpOverlay`, `SettingsView` cleanup dialog, `RuntimeDependencyDialog`, `ClipDialog`, and `ShiftTimesDialog` all use standard shadcn `Dialog` without business-file footer overrides; and `StyleManager` dialogs use Cancel-left, Confirm/Destructive-right ordering.
- [x] **AC-R5**: Zero raw `<input>` (text/number/url/checkbox), `<select>`, or missed raw `<button>` controls exist outside `src/components/ui/`; `BurnView` directory inputs/buttons honor `disabled={busy}`; `DownloadView` and `BurnView` share a deduplicated mode selector; `SubtitleEditor` row heights and destructive button variants are consistent; `StyleManager` style items do not nest interactive controls and form labels are properly bound.
- [x] **AC-R6**: `textarea`, `progress`, `popover`, `context-menu`, `sheet`, `slider`, and `collapsible` exist in `src/components/ui/` and replace all raw `<textarea>`, `<input type="range">`, `<details>`, custom progress bars, clipped `absolute` popovers (`InlineOverridePanel`, `ColorPicker`, `FontComboBox`), `SubtitleList` right-click menu, and `StyleManager` non-modal side drawer without breaking existing interactive behaviors.
- [x] **AC-Verify**: `pnpm test` and `pnpm build` pass completely after final edits with no skipped or weakened assertions.
