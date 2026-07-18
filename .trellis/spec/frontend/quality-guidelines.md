# Frontend Quality Guidelines

## Verification

| Change type | Command |
|-------------|---------|
| Stores, ASS utils, hooks, services | `pnpm test` or `pnpm test -- <file>` |
| Shared / cross-module behavior | full `pnpm test` |
| Types, Vite/Tauri wrappers, user-visible flows | `pnpm build` |

Always use **pnpm** (never npm/yarn).

## Coding Standards (Frontend-Local)

- **Minimal diffs**: only files needed for the task; no drive-by refactors
- **Match existing style**: `@/` imports, Zustand patterns, Chinese UI strings
- **Icons**: SVG via `NavIcons` / `lucide-react` — never emoji icons
- **shadcn**: prefer existing UI primitives; add via CLI
- **No secrets** in source, fixtures, or logs (translation API keys stay only in the approved local `AppSettings` / `settings.json` flow; tests use synthetic values)

## Forbidden Patterns

- Emoji / character icons in the UI
- Hand-rolled form controls that bypass `components/ui`
- Direct `invoke` for product commands when `tauri.ts` should own them
- Re-scanning fonts without the discovery singleton
- Clip completion that only runs inside an unmounted ImportView effect
- Aspirational abstractions not present in the repo

## Self-Check Before Hand-Off

- [ ] Types compile (`pnpm build` when signatures changed)
- [ ] Relevant tests pass
- [ ] Translation generation still honors `subtitleMergeMode`; editor/player/burn stay physical-row / mode-agnostic
- [ ] Whole-row clipboard goes through `subtitleClipboard` (not in-memory cue arrays)
- [ ] New product Tauri commands have a `tauri.ts` wrapper + types (official plugins may use their typed JS API instead of a custom command)
- [ ] No placeholder / TODO-left-in-spec style comments in product code for unfinished features you claimed done
