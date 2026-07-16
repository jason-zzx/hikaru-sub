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

### Editor / player

- Mode-agnostic physical rows: list and selected-row editor show `cue.primaryText` with one generic 字幕 field; do not branch on `subtitleMergeMode` or show dual original/translation fields.
- Preview/save/burn serialize physical cues (prefer `preserveOrder: true` where row order must match the store); do not re-merge by settings.
- Playback uses local HTTP media URLs from `registerMediaPlayback` — not `asset://` as the primary path.
- Libass WASM preview is preferred; CSS fallback only when libass is unavailable (`LibassFallbackNotice`).

### Translation view

- Page-owned source loads from **transcribed** ASS on enter; do not treat current `projectStore` physical rows as translation source.
- Entering the page must not write or delete the existing translated ASS file.
- On successful translation: serialize logical result with `settings.subtitleMergeMode`, re-parse with `mergeBilingual: false`, then load physical cues into the store for editor/burn.

## Anti-Patterns

- New native `<button>` / `<select>` / `<input>` with one-off Tailwind instead of shadcn
- Cards/panels that reimplement focus rings inconsistently
- Embedding clip/burn completion side effects only inside a page that can unmount mid-job
- Using English UI copy for product surfaces (specs are English; the app is Chinese)
