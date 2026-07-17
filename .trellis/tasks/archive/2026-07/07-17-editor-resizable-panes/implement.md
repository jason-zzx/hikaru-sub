# Implement: Editor resizable panes

## 1. Add layout math and persistence helpers

- [ ] Add editor-specific defaults, storage key, separator size, and pane minimum constants.
- [ ] Add a minimal ratio constraint function for pointer movement and adjacent pixel minima.
- [ ] Add direct guarded local-storage read/write helpers with finite-value validation and default fallback; no injectable reader/writer layer or boolean write result.
- [ ] Add focused unit tests for defaults/invalid storage, ratio constraints, and persistence round-trip.

**Validate:**

```bash
pnpm test -- src/components/editor/editorPaneLayout.test.ts
```

## 2. Replace fixed EditorView boundaries

- [ ] Initialize preferred ratios from global persisted layout data.
- [ ] Replace the fixed two-column template with native `minmax(<px>, <ratio>fr)` left pane / separator / right column tracks.
- [ ] Replace the fixed right-column row template with native minimum-constrained list / separator / editor tracks.
- [ ] Do not add `ResizeObserver` or mirrored workspace-size state; CSS Grid owns window-resize constraints.
- [ ] Keep the existing left video/timeline nested grid and pane contents unchanged.

## 3. Add separator interactions

- [ ] Add pointer capture drag handling for each orientation.
- [ ] Continuously constrain rendered sizes while dragging and persist on drag completion.
- [ ] Add `role="separator"` plus orientation/value ARIA attributes without focusability or key handlers.
- [ ] Keep editor arrow-key navigation untouched; pane resizing is pointer-only.
- [ ] Double-click either separator to restore and persist both default ratios.
- [ ] Add hover, active, resize-cursor, and touch-safe hit-area styling using existing semantic tokens.

## 4. Protect editor behavior

- [ ] Keep `tests/EditorViewBehavior.test.ts` source guards minimal: two pointer separators, no keyboard resizing, reset wiring, and native minimum-constrained grid tracks; do not parse JSX or pin every handler detail.
- [ ] Confirm list scrolling, selected-row editing, timeline pointer interaction, video playback, toolbar actions, and playback controls remain structurally unchanged.
- [ ] Keep pane layout state outside subtitle history and project/session state.

**Validate:**

```bash
pnpm test -- src/components/editor/editorPaneLayout.test.ts tests/EditorViewBehavior.test.ts
```

## 5. Final verification

- [ ] Run the full frontend suite.
- [ ] Run the TypeScript/Vite build.
- [ ] Manually smoke-test both pointer splitters, editor arrow-key behavior, minimum bounds, persistence across editor navigation/restart, narrow-window clamping, and double-click reset.

```bash
pnpm test
pnpm build
```

## Review gates

- Ratio math and storage tests must pass before wiring pointer interaction.
- Pointer movement must not change subtitle/project history or interfere with the timeline's pointer handling.
- Window-size clamping must not overwrite the persisted preferred ratios.
- No new dependency or general docking/resizable-panel framework may be introduced.

## Rollback points

- Helper/tests can be reverted independently before `EditorView` integration.
- If interaction wiring regresses editor behavior, restore the fixed grid templates while retaining no unused helper code.

## Notes for implementers

- Read `prd.md` and `design.md` before coding.
- Keep the implementation frontend-only and minimal.
- User-facing labels/tooltips must be Simplified Chinese.
- Do not commit unless the user explicitly asks.
