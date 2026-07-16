# Frontend State Management

## Stack

Zustand stores under `src/stores/`. Session subtitle edits use Immer (`produce`) inside `projectStore`.

## Stores

| Store | File | Owns |
|-------|------|------|
| Project / session | `projectStore.ts` | `VideoSession`, active subtitle kind/path, cues, ASS script info/styles, dirty + undo history |
| UI navigation | `uiStore.ts` | Current workflow step, sidebar collapse, busy/nav locks as used by gates |
| Tasks (status bar) | `taskStore.ts` | Lightweight `Record` of task id → status/progress/message |
| Playback | `playbackStore.ts` | Player timing / selection coupling |
| Clip job | `clipStore.ts` | Clip `jobId`, snapshot, options (`useAsWorkingVideo`), success/error messages |
| Burn job | `burnStore.ts` | Burn job lifecycle mirroring clip |

Settings (`AppSettings`) are loaded/saved via Tauri (`getSettings` / `setSettings`), not mirrored as a full Zustand store by default. Transient VAD config is **session-only** and must not be written to project or global settings (see `/AGENTS.md`).

## VideoSession vs ASS Document

`VideoSession` (`src/types/index.ts`) is a **runtime path bundle** from `prepare_video_session`:

- `transcribedAssPath` / `translatedAssPath` next to the video
- `audioPath`, `burnAssPath`, `workspacePath` under work cache
- `sourceLang` fixed to `"ja"`

`projectStore` holds the in-memory ASS document pieces (`cues`, `assScriptInfo`, `assStyles`). Opening a video prefers translated ASS, then transcribed; else empty session.

### Clip replace behavior

When a clip finishes and becomes the working video, call `setSession(next)` only. That clears cues. Do **not** load or migrate previous ASS onto the new file.

## History

`projectStore` keeps cue undo/redo (max depth 50). Prefer `updateCue` / `replaceCues` / `setCues` APIs over mutating arrays outside the store.

## Anti-Patterns

- Reintroducing a hidden on-disk project metadata directory
- Persisting VAD settings into `AppSettings`
- Duplicating job progress only in local React state without `taskStore` / job stores when StatusBar or App pollers need it
- Calling `loadAssDocument` after clip `setSession` “to preserve subtitles”
