# Pre-implementation Timeline Interactions Research

> Historical snapshot: this document records the codebase before implementation. Statements that features or tests “do not exist” describe that baseline and are not current status. Final requirements and completion state live in `../prd.md`, `../design.md`, and `../implement.md`.
>
> Decision update: the reviewed PRD explicitly allows `startMs === endMs`; the earlier minimum-duration ambiguity below is historical and must not be implemented as a strict-positive-duration invariant. Final requirements in `../prd.md` take precedence.

## Scope

Resolved the active task with `python ./.trellis/scripts/task.py current --source`; it points to `.trellis/tasks/07-24-timeline-timing-enhancement`.

Inspected the current frontend flow across:

- `src/components/editor/Timeline.tsx` end to end
- `src/components/editor/timelineModel.ts` and tests
- `src/services/editorActions.ts` and tests
- `src/stores/projectStore.ts`, `playbackStore.ts`, and tests
- `src/components/editor/SubtitleList.tsx`, `SubtitleEditor.tsx`, and `EditorView.tsx`
- `src/components/player/VideoPlayer.tsx`
- `src/utils/timeInput.ts` and tests
- Existing shadcn dialog/control use in `src/components/workflow/ClipDialog.tsx`
- `.trellis/spec/frontend/component-guidelines.md` and `.trellis/spec/frontend/state-management.md`

## Executive Summary

The current timeline has two canvases with separate contracts. The fixed ruler/waveform canvas seeks immediately on pointer-down and has no drag lifecycle. The subtitle-lane canvas seeks on empty space, selects and seeks on cue body clicks, and captures a pointer only for start/end edge drags. Edge drag already follows the required preview/commit pattern: local preview during movement, one `updateCue` on pointer-up, no commit on pointer-cancel (`src/components/editor/Timeline.tsx:259`, `src/components/editor/Timeline.tsx:290`, `src/components/editor/Timeline.tsx:345`).

The existing stores already support the required one-command history semantics. A single-cue gesture should finish with one `updateCue`; a multi-cue numeric shift should build one transformed cue list and call `replaceCues` once. No project-store API or backend contract is needed (`src/stores/projectStore.ts:369`, `src/stores/projectStore.ts:521`, `.trellis/spec/frontend/state-management.md:49`).

The largest unresolved contract is minimum duration. Existing edge drag can swap endpoints and permits equality, while manual timing explicitly clamps inverted input to a zero-length cue. The task requires `startMs < endMs` and mentions a minimum duration but does not define its value or whether existing timing paths must be changed (`src/services/editorActions.ts:213`, `src/utils/timeInput.ts:170`, `src/components/editor/SubtitleEditor.test.tsx:333`).

## Current Timeline Rendering and View Model

- The timeline uses a fixed 146 px ruler/waveform canvas and a vertically scrollable subtitle-lane canvas. The waveform itself occupies y=24 through y=140 (`src/components/editor/Timeline.tsx:20`, `src/components/editor/Timeline.tsx:391`). This gives a concrete way to distinguish waveform gestures from ruler clicks, but current pointer handling does not inspect y.
- Initial scale is 10 ms/px. Ctrl/Cmd+wheel zooms around the pointer with a 0.8/1.2 factor and clamps scale to 1..100 ms/px. Plain wheel horizontally pans the fixed layer; plain wheel vertically scrolls subtitle lanes (`src/components/editor/Timeline.tsx:201`, `src/components/editor/Timeline.tsx:211`, `src/components/editor/Timeline.tsx:223`).
- Cue rectangles are derived from all cues after `assignCueLanes`; overlapping cues are placed in transient visual lanes. During an edge preview, the preview cue is substituted into the cue list and lanes are recomputed (`src/components/editor/Timeline.tsx:123`, `src/services/editorActions.ts:188`). A lane is therefore not stable domain identity and cannot by itself define “adjacent cue.”
- Hit testing is pure and returns `edge`, `body`, or `empty`. It checks rectangles from last to first, splits very narrow cue handles at the midpoint, and suppresses handles for endpoints clipped outside the viewport (`src/components/editor/timelineModel.ts:13`, `src/components/editor/timelineModel.ts:60`).
- Cue handles are a fixed 6 px screen width, independent of zoom (`src/components/editor/Timeline.tsx:27`, `src/components/editor/Timeline.tsx:540`). A snapping tolerance expressed in pixels would match this existing zoom-independent interaction style.
- Current playhead/selection changes auto-reveal a time only when the target is outside the viewport; outside targets are centered (`src/components/editor/Timeline.tsx:92`, `src/components/editor/timelineModel.ts:30`).

## Current Pointer Gesture Contract

### Fixed ruler/waveform canvas

- Any pointer-down prevents the default event, converts x directly to time, clamps to `[0, durationMs]`, and calls `setCurrentTime` immediately (`src/components/editor/Timeline.tsx:259`).
- There is no pointer capture, move, up, cancel, lost-capture, button, or primary-pointer handling on this canvas; only `onPointerDown` is attached (`src/components/editor/Timeline.tsx:391`).
- Consequence for waveform range selection: click-to-seek and drag-to-range currently start with the same event. Preserving click seek requires a drag threshold or deferred gesture classification. The y range should also be checked if selection is truly limited to waveform blank space rather than the ruler.

### Subtitle-lane canvas

- Empty-space pointer-down seeks to the clicked time and leaves cue selection unchanged (`src/components/editor/Timeline.tsx:300`).
- Any cue hit calls `setSelectedCueId`, which collapses multi-selection to that one cue, and clears `playUntilMs` (`src/components/editor/Timeline.tsx:306`, `src/stores/playbackStore.ts:36`).
- A body hit immediately seeks to the cue start and returns. It has no pointer capture or drag state (`src/components/editor/Timeline.tsx:308`).
- An edge hit captures the pointer, records the original cue and edge, computes an immediate preview, and switches to the horizontal-resize cursor (`src/components/editor/Timeline.tsx:313`).
- Pointer movement without an active drag only updates the cursor from hit testing. Movement with the captured pointer updates the preview from the original cue plus current pointer time (`src/components/editor/Timeline.tsx:325`).
- Pointer-up recomputes the final preview and calls `finishDrag(true)`. `finishDrag` calls `updateCue` once and then releases capture/clears preview state (`src/components/editor/Timeline.tsx:345`, `src/components/editor/Timeline.tsx:362`).
- Pointer-cancel clears the preview without committing (`src/components/editor/Timeline.tsx:370`). There is no `onLostPointerCapture` handler, unlike editor pane resizing in `EditorView`; a lost capture not accompanied by cancel could leave stale drag state.
- Existing handlers do not require primary pointer or left button. New gesture work should decide whether to preserve this literally or align with pane drag’s explicit `isPrimary`/button guard.

### Existing boundary normalization

`normalizeBoundaryDrag` rounds to integer milliseconds and clamps the dragged time to `[0, durationMs]`. Crossing the opposite endpoint swaps start and end rather than clamping the dragged edge (`src/services/editorActions.ts:208`, `src/services/editorActions.ts:213`). Tests lock in swap behavior and duration clamping (`src/services/editorActions.test.ts:288`). Equality is allowed.

## History Update Contract

- `projectStore` stores full cue snapshots plus editor context. A normal mutation accepts/cancels incomplete text editing state, rejects reference-preserving no-ops, pushes one past snapshot, clears redo, advances one cue revision, and marks dirty (`src/stores/projectStore.ts:369`).
- `updateCue` produces one updated cue and routes through that normal mutation helper. It rejects value no-ops (`src/stores/projectStore.ts:531`). This is already correct for one completed edge drag, body drag, or waveform range selection.
- `replaceCues` routes one transformed list through the same helper. It is the required path for a batch numeric shift; calling `updateCue` once per selected row would create multiple history commands (`src/stores/projectStore.ts:521`, `.trellis/spec/frontend/state-management.md:50`).
- Existing tests prove `replaceCues` is one undoable dirty change and no-op updates do not push history (`src/stores/projectStore.test.ts:165`, `src/stores/projectStore.test.ts:191`).
- History snapshots capture active cue and multi-selection. Undo/redo restores those selections but intentionally does not restore playback time, play/pause, or segment-play state (`src/stores/projectStore.ts:178`, `src/stores/projectStore.ts:225`, `src/stores/projectStore.test.ts:670`).
- The editor’s start/end inputs keep local drafts. `EditorView` explicitly flushes them before undo, save, and export (`src/components/editor/EditorView.tsx:197`, `src/components/editor/EditorView.tsx:230`, `src/components/editor/EditorView.tsx:285`). A cross-component shift command must not silently overwrite a pending draft; modal ownership/wiring should account for this rather than assuming store values are always the latest visible values.

## Selection and Context Menu Semantics

- `playbackStore` owns both `selectedCueId` and ordered `selectedCueIds`. Setting one cue collapses selection to that cue. Setting multiple IDs deduplicates while preserving order and makes the last ID active (`src/stores/playbackStore.ts:36`, `src/stores/playbackStore.ts:38`).
- Subtitle-list plain click selects one row. Ctrl/Cmd toggles membership. Shift selects the contiguous list range from a local anchor and orders the IDs toward the clicked target. Every list click seeks to that cue’s start and clears segment playback (`src/components/editor/SubtitleList.tsx:153`, `src/components/editor/SubtitleList.tsx:165`).
- Right-clicking an already selected row snapshots the full current multi-selection into context-menu state. Right-clicking an unselected row collapses selection and menu scope to that row (`src/components/editor/SubtitleList.tsx:199`, `src/components/editor/SubtitleList.tsx:206`). Existing menu commands then use the snapshotted IDs (`src/components/editor/SubtitleList.tsx:219`).
- This established behavior is the strongest code-level answer to the PRD’s batch-scope question: “平移时间轴” should act on all selected rows when invoked on a selected row, and only the hit row when invoked on an unselected row. Product confirmation is still needed because the PRD leaves it open.
- The list menu is a custom fixed-position div with local `MenuButton` native buttons, not the installed shadcn context-menu primitive (`src/components/editor/SubtitleList.tsx:383`, `src/components/editor/SubtitleList.tsx:532`). Adding one item to this existing menu is the minimal consistent change; converting the whole menu is unrelated scope.
- `SubtitleEditor` currently treats timing fields as active-row-only even when multiple rows are selected, while style/format controls use one `replaceCues` for batch edits (`src/components/editor/SubtitleEditor.tsx:127`, `src/components/editor/SubtitleEditor.tsx:164`, `.trellis/spec/frontend/component-guidelines.md:41`). Numeric shift is therefore a new explicit batch command, not an extension of the right-panel time fields.

## FPS and Duration Sources

- `VideoPlayer` probes the original video path with `getVideoInfo` whenever `videoPath` changes, clears FPS while probing, stores `info.fps`, and falls back to `null` on failure (`src/components/player/VideoPlayer.tsx:147`). The typed backend result is `VideoInfo.fps: number | null` (`src/types/index.ts:330`).
- Existing frame stepping uses `fps > 0 ? fps : 30`, targets frame centers, and clamps to video duration (`src/services/editorActions.ts:62`, `src/services/editorActions.ts:70`). Tests explicitly lock the 30 fps fallback and center semantics (`src/services/editorActions.test.ts:112`). Frame-count shift and frame snapping can reuse the same effective-FPS fallback, but whether snap targets should be frame centers or frame boundaries is not specified.
- Playback duration comes from the loaded HTML video element’s metadata, floored to integer milliseconds (`src/components/player/VideoPlayer.tsx:279`). Timeline operations read that `durationMs` from `playbackStore` (`src/components/editor/Timeline.tsx:62`).
- There is no per-frame timestamp list or variable-frame-rate mapping in the frontend. With no backend contract changes allowed, “snap to video frame” can only mean a constant cadence derived from the single probed FPS value.

## Reusable Helpers and UI Patterns

### Timing and selection helpers

- `assignCueLanes` should remain the rendering helper; it is not an adjacency model (`src/services/editorActions.ts:188`).
- `findSubtitleBoundary` already gathers all cue start/end times, deduplicates and sorts them, then finds the next boundary in one direction (`src/services/editorActions.ts:44`). Candidate collection can be reused or factored minimally, but its current global/all-lane behavior is not yet a snap policy.
- `frameStepTarget` establishes effective FPS and frame-center math (`src/services/editorActions.ts:64`).
- `normalizeBoundaryDrag` is the current integer-ms/video-clamp helper, but it does not enforce strict positive duration (`src/services/editorActions.ts:213`).
- `formatTimeInput`, `parseTimeInput`, `normalizeTimeInputValue`, caret helpers, and `TIME_INPUT_TEMPLATE` provide the existing `H:MM:SS.cc` input contract (`src/utils/timeInput.ts:2`, `src/utils/timeInput.ts:124`, `src/utils/timeInput.ts:135`). Because shift direction is a separate option, the unsigned parser can represent a time magnitude without adding signed-time parsing.
- `hasMultipleSelectedCues` and the existing list transforms show the expected reference-preserving batch style (`src/services/editorActions.ts:93`).

### Dialog/control pattern

- Project specs require shadcn controls and simplified-Chinese UI copy (`.trellis/spec/frontend/component-guidelines.md:5`, `.trellis/spec/frontend/component-guidelines.md:18`).
- `ClipDialog` is the closest rich-form pattern: controlled `Dialog`, `DialogContent/Header/Title/Description/Footer`, shadcn `Input` + `Label`, `RadioGroup` for mutually exclusive modes, and outline/primary footer buttons (`src/components/workflow/ClipDialog.tsx:404`, `src/components/workflow/ClipDialog.tsx:421`, `src/components/workflow/ClipDialog.tsx:463`, `src/components/workflow/ClipDialog.tsx:563`).
- A shift options dialog can reuse these installed primitives. No dependency is needed. A segmented control is not currently required by the codebase; radio groups are the established option-set pattern.

## Likely Change Surface

Required or strongly likely:

- `src/services/editorActions.ts`: pure timing transforms for numeric shift, strict range normalization, whole-cue movement, effective FPS/frame conversion, and snapping candidate resolution. Keeping nontrivial math here matches the spec description of this file as pure editor list/timing actions.
- `src/services/editorActions.test.ts`: table tests for time/frame shift, advance/delay, target modes, clamping, minimum duration, whole-cue movement, frame fallback, snap threshold/ties, and no-op reference preservation.
- `src/components/editor/Timeline.tsx`: extend drag state beyond edge-only, add body drag preview, fixed-canvas waveform drag preview, shared snap application, cursor/overlay drawing, and robust finish/cancel handling.
- `src/components/editor/timelineModel.ts` and `timelineModel.test.ts`: only if hit/gesture geometry or pixel-threshold snap selection is kept with the existing pure canvas model. Avoid duplicating timing rules between this file and `editorActions`.
- `src/components/editor/SubtitleList.tsx`: add the “平移时间轴” menu command while preserving the current snapshotted context-menu selection scope.
- A focused dialog component under `src/components/editor/` (for example `ShiftTimesDialog.tsx`) plus a component test: justified because the command has three independent option groups and validation. It should reuse current shadcn primitives rather than adding controls.

Potential wiring only:

- `src/components/editor/EditorView.tsx`: likely modal owner or callback bridge if opening/confirming shift must coordinate with `SubtitleEditor.commitPendingTimeDraft()`. This is preferable to inventing a store for modal state.
- `src/components/editor/SubtitleEditor.tsx` / tests: only if the task’s strict positive-duration rule is meant to replace the existing zero-length manual timing contract across all editor paths.

Probably unchanged:

- `src/stores/projectStore.ts`: existing `updateCue`/`replaceCues` already provide the required history grouping.
- `src/stores/playbackStore.ts`: existing `currentTimeMs`, `durationMs`, active/multi-selection, and `fps` are sufficient.
- `src/types/`, `src/services/tauri.ts`, and Tauri/Rust files: no contract additions are needed or allowed by R5.

## Existing Test Coverage and Gaps

Covered now:

- Timeline hit testing, clipping, active-time, and reveal behavior in `src/components/editor/timelineModel.test.ts:19`.
- Lane assignment, boundary jumps, frame stepping/fallback, and boundary-drag normalization in `src/services/editorActions.test.ts:93`, `src/services/editorActions.test.ts:112`, `src/services/editorActions.test.ts:260`, and `src/services/editorActions.test.ts:288`.
- Store no-op/history/selection restoration in `src/stores/projectStore.test.ts:165`, `src/stores/projectStore.test.ts:191`, and `src/stores/projectStore.test.ts:670`.
- Playback multi-selection/FPS setters in `src/stores/playbackStore.test.ts:32`.
- Manual time draft behavior, including the current zero-length result, in `src/components/editor/SubtitleEditor.test.tsx:333`.

Missing now:

- No `Timeline.test.tsx`: pointer capture, body drag, edge drag commit count, cancel/lost capture, waveform click-vs-drag, preview rendering, and snapping integration are untested at component level.
- No `SubtitleList.test.tsx`: right-click selection scope and menu-to-dialog wiring are untested.
- No snap, whole-cue movement, numeric batch shift, or waveform range transform helpers/tests exist.

The lowest-maintenance test strategy is to put all timing/snap/range math in pure helpers and keep component tests focused on gesture routing and “one store commit on release/confirm.”

## Product Ambiguities the Code Cannot Resolve

1. **Minimum duration value and scope.** The task says “minimum duration” and acceptance says `startMs < endMs`, but gives no value. Existing manual and timeline paths allow 0 ms. Decide whether minimum is 1 ms, one frame, 10 ms (ASS centisecond display), or another value, and whether the new invariant applies only to new commands or all editor timing paths.
2. **Crossing behavior.** Existing edge drag swaps endpoints when crossing. Strict minimum duration could instead clamp the dragged edge before the opposite edge. The task does not say whether swap behavior must remain under R5.
3. **Batch menu scope.** Existing context-menu precedent favors all selected rows when right-clicking within selection, but the PRD explicitly leaves this open.
4. **Batch boundary clamping.** When several selected cues are shifted and one reaches 0/video end, decide whether every cue keeps the same applied delta (global clamp) or each cue clamps independently. “平移” usually implies a shared delta, but current code has no batch timing precedent.
5. **Single-boundary batch behavior.** For “start only” or “end only,” decide whether cues that would violate minimum duration clamp individually, make the entire command invalid, or reduce one shared delta.
6. **Meaning of adjacent boundaries.** Visual lanes are recomputed and unstable. Decide between all other cues across all lanes, immediate neighbors in document order, nearest time neighbors, or same visual lane. Also decide whether the dragged cue’s own unchanged endpoint is excluded.
7. **Snap tolerance and tie priority.** No threshold exists. Specify a screen-pixel tolerance for zoom predictability and precedence/tie rules among playhead, cue boundary, and frame candidates.
8. **Body-drag snap anchor.** A moved cue has two endpoints. Decide whether either endpoint may snap (nearest wins), only the grabbed offset/leading edge snaps, and how ties preserve duration.
9. **Frame snap location.** Existing stepping targets frame centers, but subtitle boundaries often align to frame boundaries. The task only says “视频帧.”
10. **Variable-frame-rate limitation.** Current frontend has one average FPS. True VFR frame snapping is impossible without the backend/media contract explicitly excluded by R5.
11. **Temporary snap bypass.** The PRD asks whether one is needed but defines no modifier. Current gestures do not use Alt/Shift bypass semantics.
12. **Waveform gesture discrimination.** Decide drag threshold, whether pointer-down seeks immediately or only click release seeks, whether ruler drags remain playhead-only, and what happens when a drag starts on the waveform trace versus “blank” background (canvas has no semantic blank hit target today).
13. **Waveform selection under multi-selection.** `selectedCueId` is the active/last selected row. R4 says current selected cue singular, but does not state whether range selection should collapse multi-selection, update only the active cue while preserving it, or update all selected cues.
14. **Timeline body drag under multi-selection.** Current body pointer-down collapses to one cue. R2 describes one cue, but does not state whether dragging an already multi-selected cue should preserve selection or move the group.
15. **Snap feedback.** No requirement says whether the snapped target needs a guide/highlight. The code has only cue preview and playhead drawing, so visual feedback cannot be inferred.
