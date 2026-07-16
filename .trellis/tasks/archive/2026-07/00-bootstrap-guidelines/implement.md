# Implement: Hikaru Sub Trellis Spec Bootstrap

## Preconditions

- [x] Decisions locked: layers A, AGENTS relationship A, language English
- [x] `prd.md` / `design.md` / this file written
- [x] User approves planning → then dispatch `trellis-implement`

## Checklist

### 0. Context manifests

- [x] Curate `implement.jsonl` / `check.jsonl` with real entries (`AGENTS.md`, `design.md`, key existing sources, guides)
- [x] Update `task.json` `relatedFiles` to include `tauri/` and `asr/` spec dirs

### 1. Repository analysis (before writing specs)

- [x] Skim `AGENTS.md` for rules to **reference** (not copy)
- [x] Sample frontend: stores, hooks, `services/tauri.ts`, `lib/ass/`, a workflow view, `components/ui` usage
- [x] Sample tauri: `lib.rs` command list, `app_paths.rs`, one async+blocking command, capabilities touchpoints
- [x] Sample asr: `server.py` / `jobs.py` / `engines/` / `schemas.py` / tests
- [x] Optional: GitNexus/ABCoder if MCP available; otherwise source inspection only

### 2. Write `frontend/` specs

- [x] Replace all six template files + rewrite `index.md`
- [x] Add `services-and-tauri-bridge.md`
- [x] Ensure every important rule has a real path/symbol

### 3. Create `tauri/` specs

- [x] Create directory + files per `design.md` inventory
- [x] Encode command wiring chain and portable/path rules by reference + local detail

### 4. Create `asr/` specs

- [x] Create directory + files per `design.md` inventory
- [x] Document engine plug-in and default-vs-optional dependency reality

### 5. Customize `guides/`

- [x] Rewrite Hikaru-relevant sections of `cross-layer-thinking-guide.md`
- [x] Adjust `guides/index.md` triggers
- [x] Touch `code-reuse-thinking-guide.md` only if needed

### 6. Verify

- [x] Search `.trellis/spec` for placeholders: `To be filled`, `TODO: fill`, `(To be filled`, `Replace with your`
- [x] Confirm `python ./.trellis/scripts/get_context.py --mode packages` lists `frontend`, `tauri`, `asr`
- [x] Spot-check 5–10 cited paths exist
- [x] Dispatch `trellis-check` after implement

## Validation Commands

```bash
rg -n "To be filled|TODO: fill|Replace with your|\(To be filled" .trellis/spec
python ./.trellis/scripts/get_context.py --mode packages
```

Manual: open each `index.md` and confirm links resolve to existing files.

## Out of Scope During Implement

- Product source edits
- `git commit` / push
- Rewriting `AGENTS.md`

## Rollback Points

- After each layer write: if quality is poor, rewrite that layer only before moving on
- Full rollback: restore `.trellis/spec` from git (currently largely untracked templates — keep copies in task `research/` if needed)

## Review Gate (before coding)

User reviews `prd.md` + `design.md` + this checklist and explicitly asks to implement.
