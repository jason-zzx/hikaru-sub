# Design: Editor resizable panes

## Summary

Replace the two fixed grid boundaries in `EditorView` with native pointer-operated separators. Keep the implementation frontend-only and editor-specific: no docking framework, no new package, no Tauri command, and no global Zustand store.

The layout stores two preferred percentages:

```ts
interface EditorPaneLayout {
  leftPercent: number;
  listPercent: number;
}
```

- `leftPercent`: left video/timeline pane share of the horizontal workspace.
- `listPercent`: upper-right subtitle-list share of the right column height.

Default values match the current CSS ratios:

- left pane: `1.4 / 2.4` = approximately `58.33%`
- subtitle list: `1.1 / 2` = `55%`

## Boundaries

### Frontend ownership

This is a local editor layout preference. `EditorView` owns the live interaction state, while a small editor-specific helper owns ratio constraints and persistence parsing. Do not add this state to project history, `projectStore`, `uiStore`, `AppSettings`, or the Tauri backend.

### Minimal file shape

- `src/components/editor/EditorView.tsx`: render separators, handle pointer drag/reset interactions, and apply native minimum-constrained grid tracks.
- `src/components/editor/editorPaneLayout.ts`: constants plus minimal pointer-ratio and persistence helpers.
- focused tests for the helper and existing `EditorView` behavior guards.

Do not introduce a generic resizable-panel abstraction used only by this page.

## Sizing model

Use a `6px` interaction track for each separator. Put the pixel minima directly in CSS Grid `minmax()` tracks so native layout handles window-size changes without a `ResizeObserver` or mirrored workspace-size state:

```text
horizontal: minmax(320px, <leftPercent>fr) 6px minmax(360px, <remaining>fr)
vertical:   minmax(160px, <listPercent>fr) 6px minmax(200px, <remaining>fr)
```

Minimum pane sizes:

- left video/timeline pane: `320px`
- right column: `360px`
- upper-right subtitle list: `160px`
- lower-right subtitle editor: `200px`

During pointer movement, read the current workspace rectangle, subtract the separator track, and clamp the requested percentage against the adjacent pixel minima before storing it. During ordinary window resizing, CSS Grid enforces the same minima without changing React state or persisted preferences, so expanding the window restores the user's chosen proportion. The configured Tauri minimum window size keeps both track pairs feasible.

## Persistence

Use one versioned local-storage key for the global editor preference, following the existing theme preference's frontend-local persistence pattern.

- Read once in the initial state.
- Validate JSON shape and require finite percentages strictly between `0` and `100`.
- Invalid JSON, invalid values, or storage access errors return the defaults.
- Use direct guarded `localStorage` reads/writes; no injectable storage interfaces or write-result contract.
- Persist on completed pointer drag and double-click reset.
- Do not persist observer-derived temporary clamps caused only by a smaller window.

No video path or project identifier is included because the preference is global.

## Interaction flow

### Pointer

- Pointer down on a separator starts the matching drag and captures the pointer.
- Pointer move converts the cursor position inside the current workspace rectangle into a desired percentage, then applies the same minimum-size constraint function.
- Pointer up ends capture and persists the current preferred ratios.
- Pointer cancel ends the drag without throwing or leaving an active visual state.
- Separator hit areas use `touch-action: none`, prevent accidental selection, and show the matching resize cursor.

### Keyboard policy

Separators retain `role="separator"`, the correct `aria-orientation`, and percentage value metadata for assistive semantics, but are not focusable and do not handle key events. Editor arrow keys keep their existing playback/cue-navigation responsibilities; pane resizing is pointer-only by product decision.

### Reset

Double-clicking either separator restores both default ratios and persists them in one update. A Chinese `title`/accessible label explains dragging and the double-click reset behavior; no separate button or menu item is added.

## Visual behavior

Keep the existing `bg-border` separation semantics while widening only the hit target. Use an inner one-pixel line so the divider does not appear as a heavy six-pixel bar. Hover and active-drag states use existing semantic accent tokens.

The left video/timeline nested grid remains unchanged. The right list/editor content wrappers and all toolbar/playback responsibilities remain unchanged.

## Compatibility and failure behavior

- Existing installs without the storage key use the current layout defaults.
- Corrupt storage does not block rendering.
- CSS Grid applies pane minima during window-size changes without rewriting the preferred ratio.
- No subtitle, project, ASS, playback, or undo-history data is changed.

## Validation strategy

- Focused unit tests cover default/invalid persistence fallback, round-trip persistence, and ratio clamping.
- Existing source guards stay intentionally small: two semantic separators, no keyboard resizing, native minimum-constrained grid tracks, and reset wiring.
- Run targeted tests, full `pnpm test`, and `pnpm build`.

## Rollback

Revert the helper/tests and restore the two fixed `EditorView` grid templates. The local-storage key is harmless if left behind, but the implementation should remove its reads/writes when rolling back.
