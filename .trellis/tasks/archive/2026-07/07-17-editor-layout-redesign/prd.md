# Editor layout redesign

## Goal

Reshape the subtitle editor workspace so the watch → scan list → edit flow is easier: video + waveform on the left, a scannable column-aligned cue list on the upper right, and style/text editing on the lower right. Also preserve full ASS Dialogue event fields on the editor cue model so optional columns can reflect real data.

## Confirmed facts (from code)

- Current `EditorView` main area is a 3-column grid: `grid-cols-[280px_1fr_320px]` + `grid-rows-[minmax(0,1fr)_226px]`
  - Left: cue list (~280px, spans both rows)
  - Center top: video player; center bottom: timeline/waveform (~226px)
  - Right: `SubtitleEditor` panel (~320px, spans both rows)
- Top toolbar (save / file / style manager), bottom `PlaybackControls`, `StyleManager` dialog, and hotkey help stay separate; this task does not change their responsibilities by default
- `SubtitleList` is currently card-like multi-line rows (index+style, then time, then text) — hard to scan as aligned columns
- `SubtitleEditor` is a narrow vertical stack: times → style/font/quick tags → body textarea
- ASS Events Format: `Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`
- Editor `SubtitleCue` today stores `layer` but drops Name / margins / Effect on load and blanks them on save

## Requirements

### R1 — Main region rearrange

- Left: video player + timeline/waveform stacked as one left column
- Upper right: cue list
- Lower right: style controls + subtitle text editing (keep existing `SubtitleEditor` capabilities; reflow for the new container)
- **Pane sizes: fixed sensible defaults** (no user-draggable splitters in this task). Target roughly left ~55–60% width; within the right column, list ~55% / editor ~45%. Exact CSS values decided in design.

### R2 — Column-aligned cue list

- Always-visible columns (left → right): index (`#`), start time, end time (separate columns), style, text
- A single cue row does not wrap to multiple lines
- Rows share aligned columns (consistent sticky header / column widths)
- **Sticky column header** while the list scrolls
- **Overflow for long content: truncate with ellipsis**; full text available via hover `title` (or equivalent tooltip)
- **Optional columns** (document-level: show if any cue is non-default/non-empty):
  - `Layer` if any `layer !== 0`
  - `Name` if any non-empty `name`
  - `MarginL` / `MarginR` / `MarginV` each if any that margin `!== 0`
  - `Effect` if any non-empty `effect`
  - When a column is shown, other rows still render default/empty in that cell (keep alignment)
- Full column order when all optional columns are visible:
  `# | Layer | Start | End | Style | Name | MarginL | MarginR | MarginV | Effect | Text`

### R3 — Editor panel reflow

- Lower-right container is wider and shorter than today’s tall narrow column
- **Layout: compact horizontal control strips + body textarea filling remaining height**
  - Row(s): start/end time, new/delete, style, font, font size, B/I/U/S and inline overrides
  - Body textarea expands vertically in the leftover space (not a fixed small `rows` box)
- Keep existing editor capabilities and behaviors; only reflow presentation

### R4 — Preserve optional Dialogue fields on `SubtitleCue`

- Extend editor cue model with: `name`, `marginL`, `marginR`, `marginV`, `effect` (keep existing `layer`)
- Load paths that build physical cues (`parseAss` with `mergeBilingual: false`, `parseDialogueEventLine`, and equivalent imports) must retain these fields
- Save / clipboard serialize paths (`formatDialogueEventLine`, physical `serializeAss` path) must write them back (stop blanking to `""` / `0`)
- Defaults when absent: `name=""`, margins `0`, `effect=""`, `layer=0`
- No new `SubtitleEditor` controls to edit Name / margins / Effect in this task (list display + round-trip only)
- Do not expand bilingual merge / translation product scope beyond what physical editor load/save needs

## Out of scope (provisional)

- No changes to hotkeys, undo history, or list multi-select / context-menu semantics (beyond layout + field round-trip)
- No changes to Timeline interaction model or playback control logic
- No changes to the StyleManager dialog itself (entry remains in the top toolbar)
- No full dockable multi-pane framework
- No new form controls in `SubtitleEditor` for Name / margins / Effect

## Acceptance Criteria

- [ ] Main workspace is left: video+waveform / upper-right: list / lower-right: editor
- [ ] Cue list always shows `#`, start, end, style, text as single-line aligned columns; long text truncates with ellipsis
- [ ] Optional Dialogue columns appear only when the document has non-default/non-empty values, in Format order
- [ ] Loading and saving a physical ASS round-trips Layer/Name/MarginL/MarginR/MarginV/Effect (no longer wiped to blank/0)
- [ ] Existing list behaviors still work: select, multi-select, context menu, scroll-to-selected
- [ ] Editor panel usable in the new aspect ratio: time, style, quick format, and body remain operable with flexible body height
- [ ] Top save/file/style-manager and bottom playback controls still work; related tests updated and passing

## Open questions

1. ~~Long list content: truncate vs horizontal scroll?~~ → **A: truncate + ellipsis**
2. ~~Pane sizes: fixed vs resizable?~~ → **A: fixed sensible defaults (no splitters)**
3. ~~Sticky column header while scrolling?~~ → **A: yes, sticky header**
4. ~~Lower-right editor reflow?~~ → **A: horizontal toolbar strips + large body textarea**
5. ~~Optional Dialogue fields?~~ → **A: extend `SubtitleCue` + conditional columns + round-trip**

## Notes

- Complex task: need `design.md` + `implement.md` before `task.py start`
- Primary touch points: `EditorView.tsx`, `SubtitleList.tsx`, `SubtitleEditor.tsx`, `src/lib/ass/*` cue/event mapping, and related tests
- All Trellis task artifacts under `.trellis/` are written in English
- Visual companion session used for editor-reflow choice (A selected)
