# Design: Editor layout redesign

## Summary

Re-arrange the subtitle editor workspace to left video+timeline / upper-right cue list / lower-right editor, turn the cue list into a sticky-header column table with conditional ASS Dialogue columns, reflow the editor into compact toolbars + flexible body, and extend `SubtitleCue` so optional Dialogue fields round-trip.

## Architecture

```text
EditorView
├── toolbar (unchanged responsibilities)
├── main grid (2 columns)
│   ├── left column
│   │   ├── VideoPlayer (flex 1fr)
│   │   └── Timeline (~226px)
│   └── right column
│       ├── SubtitleList (~55% height)  ← sticky header + dynamic columns
│       └── SubtitleEditor (~45% height) ← toolbar strips + flex textarea
├── PlaybackControls (unchanged)
├── StyleManager / HotkeyHelp / toast (unchanged)
└── src/lib/ass SubtitleCue + parse/serialize (field round-trip)
```

No new shell framework, no splitters, no Tauri/ASR changes.

## Layout contracts (`EditorView`)

- Replace `grid-cols-[280px_1fr_320px]` with a two-column grid, e.g. `grid-cols-[minmax(0,1.4fr)_minmax(360px,1fr)]` (or equivalent ~58/42).
- Left: nested flex/grid — video `minmax(0,1fr)`, timeline fixed ~`226px`.
- Right: nested rows ~`minmax(0,1.1fr)` list / `minmax(200px,0.9fr)` editor (list slightly taller; editor has a usable minimum).
- Keep `min-h-0` / `overflow-hidden` so nested scroll works (list scrolls; editor body scrolls if needed).

## Cue list (`SubtitleList`)

### Always-visible columns

`#` | Start | End | Style | Text

- `#`: 1-based index
- Start/End: existing list `formatTime` (or shared helper); monospace
- Style: missing-style warning styling preserved; truncate
- Text: `primaryText`; truncate + `title`

### Conditional columns (document-level)

Compute once per render from `cues`:

| Column | Show when |
|--------|-----------|
| Layer | any `layer !== 0` |
| Name | any non-empty `name` |
| MarginL / MarginR / MarginV | any that margin `!== 0` |
| Effect | any non-empty `effect` |

Full order when all visible:

`# | Layer | Start | End | Style | Name | MarginL | MarginR | MarginV | Effect | Text`

Implementation: shared CSS grid template string for header + rows; sticky header row; `whitespace-nowrap` + `truncate` on cells. Prefer div+grid over `<table>` to avoid rewriting selection/context-menu handlers.

Selection, multi-select, context menu, scroll-into-view: behavior unchanged.

## Editor panel (`SubtitleEditor`)

- Outer: `flex h-full flex-col gap-2 p-3` (or similar)
- Control region `shrink-0`: 1–2 wrap rows with time inputs, new/delete, style, font, size, BIUS, `InlineOverridePanel`
- Text region `min-h-0 flex-1`: textarea `h-full w-full` (drop fixed `rows={5}`)
- No new controls for Name / margins / Effect

## ASS model (`SubtitleCue` + I/O)

Extend `SubtitleCue`:

```ts
name: string;      // default ""
marginL: number;   // default 0
marginR: number;   // default 0
marginV: number;   // default 0
effect: string;    // default ""
```

Update:

- `parseAss` physical path (`mergeBilingual: false`) — map from `AssEvent`
- `parseDialogueEventLine` / `formatDialogueEventLine` — stop discarding / blanking
- Cue factories in `editorActions` / bilingual expand paths that construct cues — use defaults; preserve fields when cloning/splitting/merging where the operation copies a base cue
- Tests in `eventLine.test.ts` and related ASS tests

Bilingual merge mode remains a separate product path; do not broaden translation UX. Where bilingual expand creates Dialogue events, continue writing event fields from available cue data (layer + new fields when present).

## Error handling / edge cases

- Empty cue list: keep empty-state UX
- All optional fields default: only always-visible columns
- Very long Name/Effect/Text: ellipsis + title
- Clipboard paste of Dialogue lines: preserve optional fields via updated parse/format

## Testing strategy

- Unit: ASS round-trip for optional fields; cue factory defaults; column-visibility helper if extracted
- Component: EditorView/SubtitleEditor tests updated for layout smoke if they assert structure; list behavior regression via existing tests where present
- Commands: `pnpm test --` targeted files, then broader `pnpm test` if ASS shared; `pnpm build` for type changes

## Compatibility / rollback

- Older ASS without optional values: defaults, UI unchanged visually
- Rollback: revert layout + model field commits; no migration files (in-memory + on-disk ASS only)

## Out of scope

- Resizable splitters
- Editing UI for Name/margins/Effect
- Timeline / playback logic / StyleManager dialog / hotkey map changes
- Dockable multi-pane framework
