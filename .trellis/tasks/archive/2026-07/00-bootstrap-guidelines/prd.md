# Fill Hikaru Sub Trellis Specs

## Goal

Populate `.trellis/spec/` with project-specific coding guidance from the real Hikaru Sub codebase and `AGENTS.md`, so future implement/check agents follow local patterns instead of empty templates.

## Background

Trellis init left frontend-only placeholder specs. Hikaru Sub is a single-repo desktop app with three runtime layers: React (`src/`), Tauri/Rust (`src-tauri/`), and Python ASR (`asr-service/`). Root `AGENTS.md` is the global convention source (also via `CLAUDE.md`).

## Decisions

| Decision | Choice |
|----------|--------|
| Spec layers | `frontend` + `tauri` + `asr`; lightly customize `guides/` for this stack |
| vs `AGENTS.md` | Specs **reference** global hard rules; body = layer-local patterns, paths, anti-patterns, verification |
| Spec language | **English** |

## Requirements

1. Replace all frontend template placeholders with source-backed rules.
2. Create `.trellis/spec/tauri/` and `.trellis/spec/asr/` (topic files + `index.md`).
3. Each layer `index.md` links to `AGENTS.md` and lists only real files, with pre-dev / quality-check pointers.
4. Customize `guides/cross-layer-thinking-guide.md` (and index triggers if needed) for React ↔ Tauri ↔ ASR and ASS as the subtitle contract.
5. Do not modify product source code; do not invent aspirational patterns absent from the repo.
6. Do not rewrite `AGENTS.md`; do not commit unless the user explicitly asks later.

## Out of Scope

- Application behavior changes / refactors
- Declaring Trellis monorepo `packages:` in `config.yaml`
- Full duplication of `AGENTS.md` into specs
- Chinese-language specs

## Acceptance Criteria

- [x] No placeholder text under `.trellis/spec/` (`To be filled`, `TODO: fill`, template boilerplate)
- [x] Layers present: `frontend/`, `tauri/`, `asr/`; `guides/` updated for Hikaru boundaries
- [x] Topic files cite real repo paths/symbols
- [x] `index.md` files match the final file set and link `AGENTS.md`
- [x] Cross-layer ownership (UI / Tauri commands / ASR inference) is explicit enough to stop logic landing in the wrong layer
- [x] Spot-check: claims match source; search finds no placeholders

## Technical Notes

- Evidence sources: `AGENTS.md`, representative files under `src/`, `src-tauri/src/`, `asr-service/`, existing tests, `docs/agents/` only when accurate.
- Prefer path + symbol references over long code dumps.
- Analysis tools (GitNexus/ABCoder) optional; direct source inspection is required and sufficient.
