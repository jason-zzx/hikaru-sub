# Cross-Layer Thinking Guide

> **Purpose**: Think through data flow across Hikaru Sub layers before implementing.

---

## The Problem

**Most bugs happen at layer boundaries**, not within layers.

In this repo the runtime layers are:

| Layer | Root | Owns |
|-------|------|------|
| Frontend (React) | `src/` | UI, ASS parse/edit/serialize, translation HTTP, Zustand, Tauri wrappers |
| Tauri (Rust) | `src-tauri/` | File I/O, FFmpeg, paths/portable, sidecar process, download/clip/burn, media HTTP |
| ASR (Python) | `asr-service/` | Inference engines, transcription jobs, model download inside sidecar |

Putting logic in the wrong layer (e.g. Whisper in Rust, FFmpeg in React, ASS merge rules in Python) causes duplicated contracts and half-fixed bugs.

---

## Primary Data Flow

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

### Ownership reminders

- **File I/O, FFmpeg, process mgmt, download/clip/burn, portable paths** → Tauri
- **ASS parse/edit/serialize, translation API, UI, job pollers** → React
- **ASR inference only** → Python sidecar
- **New Tauri command wiring** must stay intact: Rust impl → `lib.rs` register → `src/services/tauri.ts` → UI

Global hard rules: [`/AGENTS.md`](/AGENTS.md).

---

## Before Implementing Cross-Layer Features

### Step 1: Map the Data Flow

Draw how data moves for *this* feature. Example — transcription:

```text
Video path → prepare_video_session → extract_audio → start_asr
  → sidecar /transcribe → segments / optional ASS write
  → frontend load/parse ASS → projectStore cues → editor
```

For each arrow ask: format, validation owner, failure mode.

### Step 2: Identify Boundaries

| Boundary | Common issues |
|----------|----------------|
| React ↔ Tauri invoke | Missing wrapper, camelCase drift, capabilities denied |
| Tauri ↔ ASR HTTP | Job snapshot shape, sidecar not running, debug log path |
| ASS file ↔ `SubtitleCue` | inline vs separate merge mode; PlayRes not re-probed on every save |
| VideoSession paths ↔ UI | Clip `setSession` clears cues; do not migrate ASS |
| Settings ↔ runtime deps | Probe ≠ measure; portable vs installed roots |

### Step 3: Define Contracts

For each boundary, pin:

- Exact TypeScript / serde / Pydantic field names
- Who writes the file vs who parses it
- How cancel/progress is polled (`jobId` stores + App-level pollers)

---

## Hikaru-Specific Boundary Mistakes

### Mistake 1: Wrong layer for the work

**Bad**: Calling Whisper from Rust, or shelling FFmpeg from React.

**Good**: React invokes Tauri; Tauri runs FFmpeg / proxies ASR; Python runs engines.

### Mistake 2: Breaking the command wiring chain

**Bad**: Adding a Rust command without `generate_handler!` or without `tauri.ts`.

**Good**: Complete Rust → `lib.rs` → `services/tauri.ts` → types → UI; update capabilities when needed.

### Mistake 3: ASS contract drift

**Bad**: Editor list/preview re-apply `subtitleMergeMode` after translation already expanded physical rows; or save merges/splits rows that the store holds 1:1 with Dialogue events.

**Good**: Translation page applies `settings.subtitleMergeMode` once when generating ASS, then loads physical rows (`mergeBilingual: false`). Editor list/form/preview/burn use one cue per Dialogue (`primaryText`). Clipboard whole-row I/O uses `formatDialogueEventLine` / `parseDialogueEventLine`.

### Mistake 4: VideoSession / clip semantics

**Bad**: After clip replace, `loadAssDocument` from the old video “to keep subtitles”.

**Good**: `setSession(next)` only — cues clear; ASS stays with the previous file paths.

### Mistake 5: Job finalization only on a page

**Bad**: Clip/burn completion solely inside `ImportView` / `BurnView` effects.

**Good**: App-level `useClipJobPoller` / `useBurnJobPoller` in `AppLayout` so navigation does not strand busy state.

### Mistake 6: Probe vs measure / path roots

**Bad**: Recursive `dir_size` inside `probe_runtime_dependencies`, or using raw `app_cache_dir()` as workspace root.

**Good**: Probe = status; measure = explicit; paths via `app_paths` / `work_cache_dir`.

### Mistake 7: Every consumer re-parses the same payload

**Bad**: Casting invoke/HTTP JSON fields inline in multiple views.

**Good**: One typed wrapper / schema owner (`src/types`, `schemas.py`, Rust structs).

---

## Checklist for Cross-Layer Features

Before implementation:

- [ ] Mapped the complete data flow across React / Tauri / ASR (as needed)
- [ ] Chose the owning layer for each step
- [ ] Defined file paths (`VideoSession`, work cache) and where `subtitleMergeMode` applies (translation generation only vs physical editor rows)
- [ ] Planned cancel + progress polling ownership

After implementation:

- [ ] Round-trip ASS (parse → edit → serialize) preserves script info/styles
- [ ] New commands have full wiring + types
- [ ] Optional engines / missing FFmpeg called out if unverified
- [ ] No secrets in logs or fixtures

---

## When to Create Flow Documentation

Create or extend task `design.md` flow notes when:

- Feature spans all three runtime layers
- ASS or VideoSession path semantics change
- Job lifecycle can outlive a single view
- A prior bug already came from this boundary
