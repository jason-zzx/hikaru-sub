# Technical Design

## Scope and ownership

This task changes two coupled frontend contracts:

1. The translation page owns bilingual composition and applies `subtitleMergeMode` exactly once when it generates translated ASS text.
2. Every surface after that boundary treats each physical ASS `Dialogue:` event as one ordinary editor cue.

The system clipboard boundary uses Tauri's official clipboard manager plugin. ASS parsing, event formatting, cue insertion, and editor behavior remain frontend-owned.

## Data contracts

### Translation boundary

`SubtitleCue` remains unchanged. Its `secondaryText` field is still used by the translation provider while the translation page holds a logical source/result. The translation page must not expose that logical result directly to the editor store.

After translation:

```text
transcribed ASS -> logical source cues -> translation result with secondaryText
  -> serializeAss(result, subtitleMergeMode)
  -> parseAss(serializedText, { mergeBilingual: false })
  -> projectStore physical editor cues
```

Consequences:

- `inline` produces one physical cue whose text is `translation / source`.
- `separate` produces two physical cues with the generated primary/secondary styles.
- Physical editor cues do not use `secondaryText`.
- Re-entering translation loads the transcribed ASS as a page-owned source document. It does not translate the current project-store rows, and it does not touch the existing translated file until translation is explicitly run.

This keeps `subtitleMergeMode` effective only at translated ASS generation while allowing editor, burn, and preview paths to operate on one stable row model.

### Editor ASS loading and saving

All ASS entry points that feed the editor use `parseAss(text, { mergeBilingual: false })`:

- translated/transcribed files loaded when a video is opened
- external ASS files selected from the editor
- freshly generated translation output before it is put into `projectStore`

SRT import remains one cue per SRT block.

Editor save and burn serialization do not load settings or pass `subtitleMergeMode`. They serialize physical cues one-to-one. Serialization must preserve project-store row order so row swap/reordering is not undone by time sorting.

The existing editor model does not expose ASS Name, margins, or Effect. Clipboard/import parsing accepts complete Dialogue field positions but normalizes those unsupported fields to the existing blank/zero values when subsequently serialized. No new metadata fields or editor controls are introduced.

## Clipboard architecture

### Native boundary

Add the official Tauri 2 clipboard manager:

- JS dependency: `@tauri-apps/plugin-clipboard-manager`
- Rust dependency: `tauri-plugin-clipboard-manager = "2"`
- Tauri builder registration in `src-tauri/src/lib.rs`
- main-window capabilities:
  - `clipboard-manager:allow-read-text`
  - `clipboard-manager:allow-write-text`

No custom Rust command or `src/services/tauri.ts` invoke wrapper is needed because the official typed plugin API is the boundary. A focused frontend service owns plugin calls so editor components do not import the plugin directly.

Only text permissions are granted. Image/HTML clipboard permissions remain disabled.

### ASS event-line codec

Add one ASS-domain codec, reused by copy and paste:

- serialize one physical cue to canonical `Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`
- convert real text newlines to `\\N`
- parse one complete `Dialogue:` line while allowing commas in the Text field
- reject malformed prefixes, missing fields, non-numeric layer/margins, and invalid ASS time fields
- do not accept `Comment:` as an editable pasted subtitle row

The full-document parser is not used as the validity check because it requires an `[Events]` section and intentionally falls back on malformed numeric/time fields.

### Copy and cut

1. Resolve selected cues in list order.
2. Serialize each to one canonical `Dialogue:` line.
3. Join lines with a newline and await system clipboard `writeText`.
4. Copy ends after a successful write.
5. Cut deletes the captured selected rows only after a successful write.
6. A write failure reports an editor error and leaves rows unchanged.

### Paste

1. Await system clipboard `readText`.
2. A read failure, empty value, or text containing no non-empty lines is a no-op. This includes image-only/non-text clipboard content.
3. Process every non-empty line independently and in source order.
4. Valid Dialogue lines retain modeled layer/time/style/text fields and receive fresh IDs.
5. Plain-text lines inherit the selected cue's style/layer. Their time cursor begins at the selected cue's end and advances by two seconds for each fallback row.
6. Insert all created rows as one block immediately after the active/context-menu target and select all inserted IDs.
7. Apply one `replaceCues` call so the whole paste is one undo step.

With no selected target, valid ASS rows retain the existing append behavior. Plain-text fallback requires a selected base cue and otherwise performs no edit because there is no timing/style inheritance source.

Both global hotkeys and the subtitle-list context menu call the same async clipboard service and pure paste helper. The context-menu Paste item cannot synchronously inspect an external clipboard, so it remains enabled when a row target exists and lets the async read decide whether the operation is a no-op.

## Mode-agnostic editor UI

- `SubtitleList` renders `cue.primaryText` directly.
- `SubtitleEditor` has one text draft, one textarea labeled `字幕`, and updates only `primaryText`.
- Inline/separate-specific state, refs, splitting, labels, and field targeting are removed.
- `VideoPlayer` no longer loads `useSubtitleMergeMode`.
- Preview/font/glyph utilities may use their existing inline serialization default internally, but no editor surface reads or branches on the user setting; physical cues contain no secondary field to reinterpret.
- The now-unused `useSubtitleMergeMode` hook is removed after all consumers are eliminated.

## Failure handling

- Clipboard write failure: show an error; cut does not delete.
- Clipboard read failure/non-text content: silent no-op as requested.
- Translation source load failure: translation page shows its existing missing/error state and does not reuse translated physical rows as source.
- Translation ASS save failure: retain the generated physical document in memory as unsaved translated content so the editor can still request a save target; do not claim the file was saved.
- Parser rejects malformed event lines per line; those lines use the plain-text fallback rather than aborting valid sibling lines.

## Compatibility and rollout

No on-disk migration is required. Existing ASS files are reparsed as physical Dialogue rows the next time they are loaded. Inline files remain one combined-text row; separate files become two independent rows.

No new user-facing settings or controls are added. Existing `subtitleMergeMode` remains stored and visible for translation output.

## Rollback

The change is reversible by restoring merged editor parsing/UI and removing the clipboard plugin registration, dependencies, and two text capabilities. There is no schema, project metadata, or irreversible data migration to roll back.
