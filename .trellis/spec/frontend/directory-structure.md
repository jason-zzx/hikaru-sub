# Frontend Directory Structure

## Root: `src/`

| Path | Role |
|------|------|
| `components/layout/` | Shell: `AppLayout`, `Sidebar`, `StatusBar`, `NavIcons` |
| `components/workflow/` | Import, download, transcribe, translate, burn, settings, clip dialogs |
| `components/editor/` | Subtitle list/editor, timeline, styles, hotkeys |
| `components/player/` | Video playback, libass/CSS subtitle overlays |
| `components/ui/` | shadcn/ui primitives (CLI-generated; do not restyle ad hoc) |
| `components/` | Top-level: `theme-provider.tsx`, `ModeToggle.tsx`, brand |
| `stores/` | Zustand stores (`projectStore`, `taskStore`, `uiStore`, …) |
| `hooks/` | Job pollers, preview fonts, editor hotkeys, merge mode |
| `services/` | Tauri bridge (`tauri.ts`), translation, libass helpers, font discovery |
| `lib/ass/` | ASS domain: types, parse, serialize, bilingual display |
| `types/` | Shared TS contracts with Tauri / settings / jobs (`index.ts`) |
| `utils/` | Display helpers (ASS→CSS, font aliases, time formatting) |
| `constants/` | Frontend constants and config maps |
| `styles/index.css` | Tailwind 4 + semantic tokens (`:root` / `.dark`) |

## Placement Rules

- **Workflow step views** live under `components/workflow/` and are wired in `AppLayout` via `uiStore.currentStep`.
- **Editor-only UI** stays under `components/editor/`; player/preview under `components/player/`.
- **Business navigation icons** → `components/layout/NavIcons.tsx`. Do not scatter ad-hoc SVGs for nav tools.
- **New shadcn components**: `pnpm dlx shadcn@latest add <name>` into `components/ui/`.
- **ASS domain types and transforms** → `lib/ass/` only. Re-export `SubtitleCue` from `types/` if needed for shared contracts; do not fork the model.
- **Tauri invoke wrappers** → `services/tauri.ts` (or a focused sibling service that still calls through that bridge). Components should not call `invoke()` directly for product commands.

## Anti-Patterns

- Putting FFmpeg/path/portable logic in the frontend
- Duplicating ASS parse/serialize outside `lib/ass/`
- Growing `components/ui/` with hand-rolled button/select styles instead of shadcn tokens
- Adding new workflow pages without registering them in `AppLayout` / `uiStore` step types
