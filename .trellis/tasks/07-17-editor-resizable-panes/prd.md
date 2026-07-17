# Editor resizable panes

## Goal

Let users resize the three main editor workspace panes so video, subtitle-list, and subtitle-editing space can be allocated to the current task.

## Background

- The previous editor-layout task established three panes: video + timeline on the left, subtitle list on the upper right, and subtitle editor on the lower right.
- The current layout uses fixed CSS grid ratios in `src/components/editor/EditorView.tsx`.
- Resizable splitters were explicitly out of scope for the previous task.
- The repository has no existing resizable-panel component or resizing dependency.

## Requirements

### R1 — Two resizable boundaries

- Add a vertical drag boundary between the left pane and the right column.
- Add a horizontal drag boundary between the upper-right subtitle list and lower-right subtitle editor.
- Dragging either boundary updates the adjacent pane sizes continuously.
- The video and timeline remain one left-side pane; their internal fixed relationship is unchanged.

### R2 — Safe sizing

- Keep every pane above a usable minimum size.
- Panes cannot be fully collapsed.
- Recalculate effective limits when the editor workspace size changes.

### R3 — Global persistence and reset

- Persist one global set of pane ratios shared by all videos.
- Restore the saved ratios after leaving the editor and after restarting Hikaru Sub.
- Double-click either splitter to restore both pane ratios to their defaults.
- Invalid or unavailable persisted data must fall back to the default layout without blocking the editor.

### R4 — Interaction and compatibility

- Splitters must have visible idle, hover, and drag states.
- Splitters retain separator semantics but do not support keyboard resizing or intercept editor arrow-key behavior.
- Preserve the existing toolbar, playback controls, video player, timeline, subtitle-list behavior, and subtitle-editor behavior.

## Acceptance Criteria

- [ ] The left/right boundary can be dragged horizontally to resize the left pane and right column.
- [ ] The right-side boundary can be dragged vertically to resize the subtitle list and subtitle editor.
- [ ] Neither splitter can collapse a pane below its defined usable minimum.
- [ ] Resizing remains bounded when the editor window size changes.
- [ ] The last valid user-set ratios are restored after leaving the editor and restarting Hikaru Sub.
- [ ] Double-clicking either splitter restores and persists both default ratios.
- [ ] Both splitters expose separator semantics without intercepting the editor's existing arrow-key behavior.
- [ ] Existing editor interactions continue to work after resizing.
- [ ] Targeted tests, the full frontend test suite, and `pnpm build` pass.

## Out of Scope

- Arbitrary docking, pane reordering, floating panes, or a general dock-layout framework.
- Making the video/timeline boundary resizable.
- Allowing any pane to collapse completely.
- Changing the contents or responsibilities of the three panes.
- Adding a new third-party resizing dependency.
- Adding a separate reset button or settings-page control.
- Keyboard-based pane resizing.
