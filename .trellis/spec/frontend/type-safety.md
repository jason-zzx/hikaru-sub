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
  name?: string       // ASS Dialogue Name; absent means ""
  marginL?: number    // absent means 0
  marginR?: number
  marginV?: number
  effect?: string     // absent means ""
}
```

Physical ASS parse paths populate the optional Dialogue fields. Synthetic cues may omit them; list/serialize boundaries must normalize with `?? ""` / `?? 0`. Operations that clone or inherit a physical cue must preserve any present values. Do not export a shared defaults object solely to make every synthetic cue/test fixture spell out empty fields.

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

OpenAI-compatible, Gemini, and Anthropic adapters live under `src/services/translation/` with shared batching, fallback, scheduling, and `types.ts`. Persist provider records in `AppSettings.translationProviders`; every provider carries an `apiKey: string`, where an empty/whitespace-only value is persisted but fails readiness. `defaultTranslationProviderId` initializes the Translation view's page-local provider selection; changing that selection does not update settings.

Translation runs use the shared contracts below:

```ts
interface TranslationOptions {
  signal?: AbortSignal;
}

interface TranslationResult {
  cues: SubtitleCue[];
  successCount: number;
  failedCount: number;
  errors: string[];
  cancelled: boolean;
}
```

`cancelled` means the page/run signal was aborted, not that a request timed out. Only two sequential local batch index/translation JSON validation failures of the same otherwise valid provider response may enter single-cue fallback; the first format failure retries that batch once with priority. This same-batch format rule is independent of the shared transient-failure streak. Deterministic HTTP/provider-envelope errors do not retry and stop immediately. A batch or fallback single request that receives `408/409/425/429/5xx` or a timeout/network `GenerationError` explicitly wrapped by `fetchWithTimeout` retries the same request once with priority over queued normal work; only a second failure counts as one failed work unit. Unknown exceptions default to deterministic and expose only a controlled generic message. Update the shared streak by work-unit completion order: two retry-exhausted failures completing with no successful work-unit completion between them stop the run, and any completed success resets the streak. Internal stops do not set `cancelled`; cancelled and failed cues retain their source text. `failedCount` is `input.length - successCount`, so partial/cancelled output shares the failed-only retry path.

Generation HTTP error details use application-controlled categories and may append only a structured JSON server reason. Exact known API credential/Authorization, request body, subtitle, glossary, and custom/system/user prompt values are always redacted. A residual API credential/Authorization overlap of 4+ consecutive characters, or request-content/subtitle/glossary/prompt overlap of 8+ consecutive characters, suppresses the entire server reason. Non-JSON bodies and arbitrary exception text remain hidden.

## Anti-Patterns

- Defining a second `SubtitleCue`-like interface in a view
- Casting invoke results inline instead of typing the wrapper
- Changing PlayResX/Y on every save — transcription sets resolution via `get_video_info`; later saves reuse `assScriptInfo`
- Exposing source-language pickers; new sessions stay `sourceLang: "ja"`
