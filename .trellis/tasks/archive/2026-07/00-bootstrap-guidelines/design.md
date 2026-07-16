# Design: Hikaru Sub Trellis Spec Bootstrap

## Architecture / Boundaries

Single-repo Trellis layout (no `packages:` in `config.yaml`). Spec layers are directories under `.trellis/spec/`:

| Layer | Owns | Source roots |
|-------|------|----------------|
| `frontend` | React UI, Zustand, ASS domain TS, Tauri invoke wrappers, hooks | `src/` |
| `tauri` | Commands, FFmpeg/media, paths/portable, ASR process mgmt, download/clip/burn | `src-tauri/` |
| `asr` | FastAPI sidecar, engines, job schemas, model/download diagnostics | `asr-service/` |
| `guides` | Cross-cutting thinking (not layer ownership) | N/A |

**Contract with `AGENTS.md`**: each layer `index.md` opens with a short pointer to `/AGENTS.md` for global hard rules (git commit policy, naming, security, portable paths, runtime dependency policy). Specs do not re-copy those sections; they document how the layer implements them.

## Spec File Inventory

### `frontend/` (replace templates)

| File | Focus |
|------|--------|
| `index.md` | Checklist + link to AGENTS.md + guideline table |
| `directory-structure.md` | `components/{layout,workflow,editor,player,ui}`, `stores/`, `hooks/`, `services/`, `lib/ass/`, `types/` |
| `component-guidelines.md` | shadcn-first UI, `NavIcons.tsx` for business icons, Chinese copy, ThemeProvider |
| `hook-guidelines.md` | Job pollers, preview fonts, editor hotkeys; App-level poller ownership |
| `state-management.md` | Zustand stores (`projectStore`, `taskStore`, `uiStore`, …); session vs settings |
| `type-safety.md` | Shared types in `types/`; ASS/`SubtitleCue` in `lib/ass/`; merge mode display |
| `quality-guidelines.md` | `pnpm test` / `pnpm build`; no emoji icons; minimal diffs |
| `services-and-tauri-bridge.md` | **New**: `services/tauri.ts` wrappers; command add wiring ends in frontend here |

### `tauri/` (create)

| File | Focus |
|------|--------|
| `index.md` | Checklist + AGENTS.md link |
| `directory-structure.md` | `src-tauri/src/*.rs`, `capabilities/`, `resources/` |
| `command-guidelines.md` | Implement → `lib.rs` register → frontend `tauri.ts`; capabilities when needed |
| `async-and-blocking.md` | async commands + `spawn_blocking` for disk/CPU (fonts, storage measure/cleanup) |
| `paths-and-runtime-deps.md` | `app_paths.rs`, portable `.portable`, cache layout, probe vs measure storage |
| `media-ffmpeg-asr.md` | FFmpeg resolve order, media HTTP server, ASR sidecar process, download/clip/burn ownership |
| `quality-guidelines.md` | `cargo test --manifest-path src-tauri/Cargo.toml`; no secrets in logs |

### `asr/` (create)

| File | Focus |
|------|--------|
| `index.md` | Checklist + AGENTS.md link |
| `directory-structure.md` | `server.py`, `jobs.py`, `engines/`, `schemas.py`, `tests/` |
| `engine-plugins.md` | Pluggable engines; default vs optional (parakeet/qwen); Kotoba-specific cache rules |
| `api-and-jobs.md` | HTTP job API, schemas, diagnostics / `asr-debug.log` events |
| `quality-guidelines.md` | `python -m unittest discover tests`; optional engine deps |

### `guides/` (light edit)

| File | Change |
|------|--------|
| `cross-layer-thinking-guide.md` | Replace generic API/DB examples with React ↔ Tauri invoke ↔ ASR HTTP; ASS as subtitle contract; VideoSession path conventions |
| `index.md` | Update triggers to mention Tauri commands / ASR / ASS |
| `code-reuse-thinking-guide.md` | Only if a Hikaru-specific reuse trap is clear; otherwise leave mostly intact |

## Data Flow / Contracts (for guide + layer specs)

```text
UI (React) --invoke--> Tauri commands --spawn/HTTP--> ASR sidecar
                |                |
                v                v
         ASS files / VideoSession paths     audio.wav + transcription
                |
                v
         Translation (frontend OpenAI-compatible API)
                |
                v
         Editor / burn (FFmpeg via Tauri)
```

Ownership reminders to encode:

- File I/O, FFmpeg, process mgmt, download/clip/burn → Tauri
- ASS parse/edit/serialize, translation API, UI → React
- ASR inference only → Python sidecar
- New Tauri command wiring chain must stay intact

## Compatibility / Migration

- Delete or overwrite template “To be filled” content; no need to keep template headings that do not apply.
- Frontend template filenames mostly kept for continuity; add `services-and-tauri-bridge.md` instead of forcing that content into unrelated files.
- After adding `tauri/` and `asr/`, `get_context.py --mode packages` should list the new layers (directory discovery).

## Trade-offs

| Choice | Why |
|--------|-----|
| Three layers, not one flat `app/` | Matches runtime ownership; selective jsonl loading |
| Reference AGENTS.md vs self-contained | Avoid drift; agents still need AGENTS for hard global rules |
| English specs | Aligns with Trellis templates / agent tooling |
| Medium depth | Enough for agents to match local patterns; not a second AGENTS.md |

## Rollback

Specs-only change: revert `.trellis/spec/` (and task artifacts) via git if needed. No product code rollback.
