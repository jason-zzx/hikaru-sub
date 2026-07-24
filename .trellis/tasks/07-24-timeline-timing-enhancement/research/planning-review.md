# Planning Review: Timeline Timing Enhancement

## Verdict

The plan is implementable in the existing React/store architecture, and the proposed `updateCue`/`replaceCues` split matches current history behavior. Resolve the two blockers below before implementation; the remaining items are contract/test clarifications rather than architecture changes.

## Findings

### 1. Blocker: list right-click can discard the old active cue's pending time draft

**Refs:** `prd.md` R5; `design.md` Boundaries, Numeric Shift Contract; `implement.md` step 2; `src/components/editor/SubtitleList.tsx:199-216`; `src/components/editor/SubtitleEditor.tsx` `commitPendingTimeDraft` and cue-sync effect.

The design flushes the draft when the shift dialog opens, but `SubtitleList` already calls `setSelectedCueId(cue.id)` during the earlier `contextmenu` event when the hit row is not selected. That changes `selectedCue`, causing `SubtitleEditor` to replace its local start/end drafts before the menu command can call `EditorView`.

The plan must flush the draft before any right-click selection mutation, then snapshot/collapse selection. The same ordering must be explicit for timeline edge/body pointer-down: flush first, then re-read the cue from `useProjectStore.getState()`, then change selection/start the gesture. The current `design.md` edge branch does not state this ordering. Flushing only when opening the dialog is too late and also creates a history item when a user merely opens and cancels the dialog.

### 2. Blocker: deferred body-click seek conflicts with current auto-reveal behavior

**Refs:** `design.md` Pointer Gesture Contract / Subtitle Lane; `src/components/editor/Timeline.tsx:88-107`, `:300-318`; `src/components/editor/timelineModel.ts` `revealTimelineTime`.

The design collapses selection on body pointer-down but defers the existing seek-to-cue-start behavior until pointer-up if movement stays below 4 px. Today, a selection change triggers the reveal effect, which reveals `currentTimeMs`, not the selected cue. If the user has panned away from the playhead, pointer-down can therefore move `viewStartMs` while the gesture is being classified, invalidating body anchoring and producing a jump.

Specify one stable behavior: capture the pre-gesture playhead for snapping, then either seek to the hit cue start before changing selection (matching current click timing), or suppress selection-triggered reveal while a pending body gesture exists. In all cases, anchor movement to the pointer-down time/grab offset and the post-draft cue snapshot, not to a rectangle that may be recomputed into another lane.

### 3. High: whole-cue bounds are undefined for cues made illegal by numeric shift

**Refs:** `prd.md` R1/R2; `design.md` Numeric Shift Contract, Snap Contract / body drag; `implement.md` step 1.

Numeric shifting intentionally allows times beyond video end, and an end-only delay can create a cue whose duration exceeds the video duration. Such a cue cannot later be moved wholly into `[0, durationMs]` while preserving duration, so “bounded movement” has no valid result.

Define and test this case. Minimal contract: if cue duration is greater than video duration, whole-cue drag is a no-op; otherwise clamp the requested delta to `[-startMs, durationMs - endMs]`, which also brings a fitting but currently out-of-range cue back into range. Do not shrink duration during body drag.

### 4. High: snap inputs must be gesture snapshots, not live async values

**Refs:** `design.md` Snap Contract; `src/components/player/VideoPlayer.tsx:147-154`; `src/stores/playbackStore.ts` `fps`; `src/components/editor/Timeline.tsx` drag refs.

The design snapshots the playhead but does not explicitly snapshot FPS or other-cue boundaries. FPS is populated asynchronously and can change from the 30 FPS fallback during a drag; live candidates would make the snap grid jump mid-gesture. Capture playhead, effective FPS, and other-cue boundaries after draft flush at gesture start and use that immutable set until finish/cancel.

Lock frame-start semantics as `k * 1000 / effectiveFps` for integer `k >= 0`, consider only legal candidates in the video range, and round only the final cue times to integer milliseconds. Add a non-integer-FPS case such as 29.97 and a duration that is not an exact frame multiple. Keep existing `frameStepTarget` frame-center behavior unchanged.

### 5. Medium: one-sided shift precedence needs explicit asymmetric examples

**Refs:** `prd.md` R1 and acceptance criterion 7; `design.md` Numeric Shift Contract; `implement.md` step 1.

The prose is consistent if transforms run in this order: apply signed delta, clamp each adjusted field to zero, then for one-sided modes clamp a crossed boundary to the unchanged opposite boundary. For example, end-only advance of `1000..1500` by 2000 ms must finish as `1000..1000`, not `1000..0`; start-only delay past end must finish at `end..end`. Both-side advance still clamps each side independently and may shorten to `0..positive` or `0..0`.

The planned “single-side zero duration” test is too broad. Add a table covering start-only advance below zero, start-only delay across end, end-only advance below zero/across start, end-only delay past video end, and both-side independent zero clamping. Numeric helpers should not accept `durationMs`, preventing accidental end-of-video clipping.

### 6. Medium: fixed-canvas hit regions and click/cancel behavior need a complete contract

**Refs:** `design.md` Pointer Gesture Contract / Waveform Layer; `src/components/editor/Timeline.tsx:259-265`, `:391`; `prd.md` R4/R5.

The current fixed canvas seeks from every y position on pointer-down. The design starts range selection only in `WAVE_TOP..WAVE_TOP + WAVE_HEIGHT`, but mentions only the ruler outside that band. Preserve click-to-seek for every non-waveform pixel too, including the 2 px ruler/wave gap and 6 px bottom gap. Treat the whole waveform band as selectable “blank area”; canvas pixels do not provide a meaningful waveform-trace hit target.

For an active cue, capture on pointer-down, classify using horizontal CSS-pixel movement, seek only on sub-threshold pointer-up, and make cancel/lost-capture neither seek nor mutate. With no active cue, retain ordinary seek and never create range state. Re-read the active cue after flushing its draft when the threshold is crossed.

### 7. Medium: pointer cleanup must be idempotent around intentional capture release

**Refs:** `design.md` Pointer Gesture Contract, History And Draft Safety; `implement.md` steps 3-4; `src/components/editor/Timeline.tsx:345-372`.

Adding `onLostPointerCapture` is necessary, but intentional `releasePointerCapture` after a successful pointer-up also emits lost-capture. Clear/mark the gesture finished before releasing capture, and make finish/cancel idempotent so the lost event cannot clear a new gesture or cause a second commit. Pointer-cancel, lost-capture, and unmount must clear preview/snap guides without calling `updateCue`.

### 8. Medium: planned tests do not yet prove draft ordering or history grouping

**Refs:** `implement.md` steps 2-5; `tests/EditorViewBehavior.test.ts`; `tests/TimelineBehavior.test.ts`; `src/stores/projectStore.ts:369-400`, `:521-543`.

`tests/EditorViewBehavior.test.ts` and the existing timeline/list behavior tests are source-text guards; they cannot prove callback order, latest-cue reads, or one-command history. Add behavioral integration coverage for:

- pending draft on cue A, right-click unselected cue B, then open/confirm shift: A's draft survives and B is shifted;
- no pending draft: one confirmation adds exactly one history entry and one undo restores the whole batch;
- pending draft plus shift: two ordered history entries (the prior draft and the shift), with one undo removing only the shift;
- each timeline gesture commits once on pointer-up and zero times on cancel/lost-capture/no-op.

`Timeline.test.tsx` is feasible in jsdom, but the plan should name the required minimal mocks: Tauri `invoke`, canvas context/dimensions, `getBoundingClientRect`, and pointer-capture methods. Keep timing/snap assertions in pure helper tests and component tests focused on routing, selection collapse, and commit counts.

### 9. Stale research warning: zero-duration cues are explicitly allowed

**Refs:** `research/current-timeline-interactions.md` Executive Summary and Product Ambiguities 1-5; current `prd.md` R1 and acceptance criterion 7; `design.md` Numeric Shift Contract.

The earlier research note says the task requires `startMs < endMs` and an unspecified minimum duration. The current PRD instead requires `startMs <= endMs` and explicitly allows zero-duration cues. The design is correct on this point; do not add a minimum-duration invariant or alter existing edge-drag swap behavior.

## Confirmed Decisions

- Batch advance clamps each selected cue/field independently at zero; batch delay is not clipped to video duration.
- One-sided crossing clamps to the unchanged opposite boundary and may produce zero duration; it never swaps boundaries.
- Existing edge drag keeps its swap semantics, separately from numeric one-sided shift.
- Snap tie order of playhead, other-cue boundary, then frame start is deterministic; body start wins an exact start/end-anchor tie.
- `updateCue` once per completed single-cue gesture and `replaceCues` once per numeric confirmation provide the required history grouping without store changes.
- No backend, ASS model, shared domain type, dependency, or new persistent state is needed.
