# Frontend Development Guidelines

> React / TypeScript UI layer for Hikaru Sub (`src/`).

**Global hard rules** (git commit policy, product naming, security, portable paths, runtime dependency policy): see [`/AGENTS.md`](/AGENTS.md). Do not restate those sections here; this layer documents frontend-local patterns.

---

## Overview

The frontend owns:

- All UI (workflow pages, editor, player overlays, settings)
- ASS parse / edit / serialize (`src/lib/ass/`)
- OpenAI-compatible, Gemini, and Anthropic translation API calls (`src/services/translation/`)
- Zustand session and task state (`src/stores/`)
- Typed Tauri invoke wrappers (`src/services/tauri.ts`) and job pollers

It does **not** own: FFmpeg/process management, portable path roots, ASR inference, or recursive disk scan/cleanup.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | `components/`, `stores/`, `hooks/`, `services/`, `lib/ass/`, `types/` |
| [Component Guidelines](./component-guidelines.md) | shadcn-first UI, `NavIcons`, Chinese copy, ThemeProvider |
| [Hook Guidelines](./hook-guidelines.md) | Job pollers, preview fonts, merge mode, App-level ownership |
| [State Management](./state-management.md) | Zustand stores; session vs settings vs task UI |
| [Type Safety](./type-safety.md) | Shared types vs ASS domain; `SubtitleCue`; merge mode |
| [Services and Tauri Bridge](./services-and-tauri-bridge.md) | `tauri.ts` wrappers; command wiring endpoint |
| [Quality Guidelines](./quality-guidelines.md) | `pnpm test` / `pnpm build`; icons; minimal diffs |

---

## Pre-Development Checklist

Before coding in this layer:

- [ ] Read [`/AGENTS.md`](/AGENTS.md) architecture boundaries (React vs Tauri vs ASR)
- [ ] Confirm logic belongs in frontend (UI / ASS / translation), not Rust or Python
- [ ] Check existing stores, hooks, and `services/tauri.ts` before adding new wrappers
- [ ] For UI controls, prefer `src/components/ui/` (shadcn) over raw HTML elements
- [ ] For ASS text, use `src/lib/ass/` (parse/serialize, `eventLine` for single Dialogue clipboard lines) — do not invent parallel models
- [ ] `subtitleMergeMode` is translation-generation only; editor/preview/burn consume physical Dialogue rows

---

## Quality Check Pointers

- Unit / component logic: `pnpm test` (or `pnpm test -- <file>`)
- Types / build / Tauri wrapper signatures: `pnpm build`
- After adding a Tauri command, frontend must expose it from `src/services/tauri.ts` with types in `src/types/`

---

**Language**: Specs in this tree are written in **English**. User-facing UI strings remain Simplified Chinese.
