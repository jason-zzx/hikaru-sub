# Frontend Type Safety

## Two Type Homes

| Concern | Location | Examples |
|---------|----------|----------|
| Cross-layer / IPC contracts | `src/types/index.ts` | `VideoSession`, `AppSettings`, `AsrJobSnapshot`, burn/clip/download snapshots, runtime deps |
| ASS domain model | `src/lib/ass/types.ts` (re-exported from `src/lib/ass/index.ts`) | `SubtitleCue`, `AssStyle`, `AssDocument`, `AssScriptInfo`, parse/serialize options |

`SubtitleCue` is re-exported from `src/types` for convenience (`export type { SubtitleCue } from "@/lib/ass"`). **Canonical definition stays in `lib/ass`.**

## SubtitleCue

```typescript
interface SubtitleCue {
  id: string
  startMs: number
  endMs: number
  primaryText: string      // source (transcription)
  secondaryText?: string   // translation
  style: string
  layer: number
}
```

Bilingual **generation** (translation page only) may serialize as:

- **inline**: one Dialogue with `译文 / 原文` (`mergeMode: "inline"`)
- **separate**: Primary + Secondary Dialogue lines (`mergeMode: "separate"`)

After generation, ASS is re-parsed with `mergeBilingual: false` so the editor holds **physical rows**: one `SubtitleCue` per `Dialogue:` event, text in `primaryText`, no paired `secondaryText` editing.

`getCueDisplay` in `src/lib/ass/bilingual.ts` remains for translation/logical display helpers. Editor list, selected-row form, preview, burn, and editor save operate on physical `primaryText` and must **not** re-apply `settings.subtitleMergeMode`.

Clipboard codec: `formatDialogueEventLine` / `parseDialogueEventLine` in `src/lib/ass/eventLine.ts` for strict single-event lines (do not use full-document `parseAss` as the sole paste validity check).

## Tauri Payload Shapes

Frontend types mirror camelCase JSON from Tauri and the ASR sidecar (e.g. `durationMs`, `processedMs`). When adding fields:

1. Update Rust / Python schemas
2. Update `src/types/index.ts`
3. Update wrappers in `services/tauri.ts`
4. Prefer shared types over local `as` casts in views

## Translation Types

OpenAI-compatible adapters live under `src/services/translation/` with their own `types.ts`. Keep batching / glossary options aligned with `AppSettings` fields.

## Anti-Patterns

- Defining a second `SubtitleCue`-like interface in a view
- Casting invoke results inline instead of typing the wrapper
- Changing PlayResX/Y on every save — transcription sets resolution via `get_video_info`; later saves reuse `assScriptInfo`
- Exposing source-language pickers; new sessions stay `sourceLang: "ja"`
