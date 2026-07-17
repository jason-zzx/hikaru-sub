# Implement: Editor layout redesign

## Goal

Ship the approved editor layout, column list, editor reflow, and `SubtitleCue` Dialogue-field round-trip per `prd.md` / `design.md`.

## Checklist

### 1. Extend `SubtitleCue` + ASS I/O

- [ ] Add `name`, `marginL`, `marginR`, `marginV`, `effect` to `SubtitleCue` with defaults
- [ ] `parseAss` physical mapping retains AssEvent optional fields
- [ ] `parseDialogueEventLine` / `formatDialogueEventLine` round-trip those fields
- [ ] Update cue constructors/cloners (`editorActions`, bilingual helpers as needed) so copies preserve fields and new cues use defaults
- [ ] Update `src/lib/ass` unit tests (especially `eventLine.test.ts`)

**Validate:** `pnpm test -- src/lib/ass`

### 2. Column-visibility helper + `SubtitleList`

- [ ] Helper: given `cues`, return which optional columns are visible + grid template
- [ ] Sticky header; always columns `# | Start | End | Style | Text`
- [ ] Insert optional columns in Format order when visible
- [ ] Single-line truncate + `title`; keep selection / multi-select / context menu / scroll-to-selected
- [ ] Tests for visibility helper (and list smoke if practical)

**Validate:** `pnpm test --` list/helper-related files

### 3. `EditorView` main grid rearrange

- [ ] Two-column layout: left video+timeline, right list+editor
- [ ] Fixed ratios per design; preserve `min-h-0` overflow behavior
- [ ] Toolbar / PlaybackControls / overlays unchanged in responsibility

**Validate:** visual via `pnpm tauri dev` or `pnpm dev` smoke; update `SubtitleEditor.test.tsx` / editor tests if they assume old DOM

### 4. `SubtitleEditor` reflow

- [ ] Compact horizontal control strips + flex-growing textarea
- [ ] Preserve existing edit/history/hotkey-related behavior
- [ ] No Name/margins/Effect edit controls

**Validate:** `pnpm test -- src/components/editor`

### 5. Full verification

- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Manual smoke: open editor, scan list columns, edit text, save ASS and confirm optional fields survive if present in file

## Review gates

- After steps 1–2: ASS round-trip + list columns correct before polishing layout CSS
- After steps 3–4: layout usable at typical desktop sizes; body textarea not cramped
- Before claiming done: acceptance criteria in `prd.md` all checked

## Rollback points

- After step 1 only: revert ASS model if round-trip regresses bilingual unexpectedly
- After UI steps: revert `EditorView` / list / editor files independently of ASS if needed

## Notes for implementers

- Follow `.trellis/spec/frontend` (components, type-safety for `SubtitleCue`, quality)
- Minimal diffs; Chinese UI strings for new headers (`#` / `开始` / `结束` / `样式` / `文本` and optional field labels)
- Do not `git commit` unless the user explicitly asks
