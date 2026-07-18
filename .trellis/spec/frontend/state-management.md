# Frontend State Management

## Stack

Zustand stores under `src/stores/`. Session subtitle edits use Immer (`produce`) inside `projectStore`.

## Stores

| Store | File | Owns |
|-------|------|------|
| Project / session | `projectStore.ts` | `VideoSession`, active subtitle kind/path, cues, ASS script info/styles, dirty + undo history |
| UI navigation | `uiStore.ts` | Current workflow step, sidebar collapse, busy/nav locks as used by gates; `openSettings(category?)` deep-links Settings categories (`runtime` / `transcription` / `translation`) |
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

`projectStore` owns one chronological project undo/redo stack for committed `SubtitleCue` edits (max depth 50). Prefer `updateCue` / `replaceCues` / `setCues` / grouped text APIs over mutating arrays outside the store.

### Snapshot model

History entries are revisioned snapshots, not raw cue arrays:

- `cueRevision` advances for each committed cue history item (coalesced text amends the current item without a new revision).
- `nonHistoryRevision` advances for style-library mutations / explicit dirty marks that are outside cue undo.
- Dirty state is derived from whether current `(cueRevision, nonHistoryRevision)` equals the last successful save token, plus transient composition preview.
- Each snapshot stores cues plus normalized editor context: active cue, multi-selection, and optional text caret/selection. Undo/redo restores that context via `playbackStore` selection only — never video time, play/pause, or segment-play state.

### Mutation and grouping contracts

- Normal cue mutations (`updateCue`, `replaceCues`, `addCue`, `deleteCue`) go through one private helper: end active text session/group first, reject no-ops, push one bounded past snapshot, apply under a fresh cue revision, clear redo.
- Batch cue edits must build one transformed list and call `replaceCues` once (not per-row `updateCue`). Preserve unchanged cue references so a no-op replacement creates no history entry. Batch application itself must not rewrite selection; undo/redo may restore the selection/context captured with the snapshot.
- Live subtitle text uses Aegisub-style grouping via pure `src/services/editorTextHistory.ts` + store grouped-text actions: adjacent insert / Backspace / Delete runs coalesce; selection replace, paste/cut, formatting, cue switch, other cue ops, and 30s idle start a new group. Intermediate IME composition is preview-only; only the committed composition participates as an insertion.
- Escape rolls back the current cancellable text session (including the pre-session redo branch). Blur, Enter, save, undo/redo, cue switch, and non-text cue commands accept/end the session even when they change no cue data.
- Opening/switching sessions or loading a new ASS document clears history, active grouping, text-session, composition, and pending caret restore. `projectStore.documentEpoch` advances only for `setSession`, `clearSession`, `loadAssDocument`, and `setCues`; editor components with local input/composition refs subscribe to it so same-cue-ID document reloads still clear stale state.

### Save checkpoint pairing

Use token-aware save APIs:

```ts
captureSaveSnapshot(): ProjectSaveSnapshot  // token + cues + scriptInfo + styles
markSaved(token: RevisionToken): void       // only after successful I/O
```

Capture the snapshot in the same uninterrupted synchronous section as the payload you will write. Edits after capture / during await leave the project dirty relative to the token that reached disk. Failed writes must not move the checkpoint. Style-library changes keep the project unsaved even if cue undo returns to the last saved cue revision.

### Style library boundary

`StyleManager` mutations are outside cue undo history but advance `nonHistoryRevision`. A cascading style rename that rewrites cue style names is one undoable cue item plus a non-history style change, so undoing the cue rewrite still leaves the project dirty until the next successful save.

## Anti-Patterns

- Reintroducing a hidden on-disk project metadata directory
- Persisting VAD settings into `AppSettings`
- Duplicating job progress only in local React state without `taskStore` / job stores when StatusBar or App pollers need it
- Calling `loadAssDocument` after clip `setSession` “to preserve subtitles”
- Calling boolean-only `markSaved()` after save without pairing the written payload to a `RevisionToken`
- Recording one history entry per keystroke, or treating whole focus sessions as the only text undo unit
- Putting ASS style-library edits, video playhead, or transient UI drafts into cue history
