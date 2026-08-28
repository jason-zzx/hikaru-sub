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

## Subtitle Generation Settings Contract

### 1. Scope / Trigger

`AppSettings` persists subtitle layout through Tauri, but these fields apply only when the Translation page turns logical bilingual cues into ASS. Editor/save/preview/burn remain physical-row consumers.

### 2. Signatures

```typescript
subtitleMergeMode: "inline" | "separate" | "translation-only"
subtitleTextOrder: "translation-first" | "source-first"

serializeAss(doc, {
  mergeMode: settings.subtitleMergeMode,
  textOrder: settings.subtitleTextOrder,
})
```

### 3. Contracts

- `inline`: one Dialogue, with source/translation ordered by `subtitleTextOrder` and joined by the fixed ` / ` separator.
- `separate`: two Dialogue rows in the selected text order. The first uses `secondaryStyle`, the second uses the cue/primary style; both default styles use `marginV: 40`.
- `translation-only`: one primary-style Dialogue for a non-empty translation; source-only cues are omitted.
- Defaults are `inline` and `translation-first`.
- After generation, re-parse with `mergeBilingual: false`; each Dialogue becomes one physical editor cue.

### 4. Validation & Error Matrix

- Missing fields in old `settings.json` -> Rust `AppSettings::default()` values.
- Unknown mode/order -> normalize to `inline` / `translation-first`.

### 5. Good/Base/Bad Cases

- Good: source-first inline -> `原文 / 译文`.
- Base: defaults -> `译文 / 原文`.
- Bad input: unknown mode/order -> repaired defaults before persistence/use.

### 6. Tests Required

- `translatePhysicalBoundary.test.ts`: each mode, both orders, fixed separator, and translation-only omission.
- `SettingsTranslationPanel.test.tsx`: conditional order control.
- Rust `settings::tests::subtitle_generation_settings_default_and_normalize`: old-config defaults and normalization.

### 7. Wrong vs Correct

```typescript
// Wrong: order silently falls back during translation generation.
serializeAss(doc, { mergeMode: settings.subtitleMergeMode })

// Correct: apply the complete persisted generation contract once.
serializeAss(doc, {
  mergeMode: settings.subtitleMergeMode,
  textOrder: settings.subtitleTextOrder,
})
```

After generation, ASS is re-parsed with `mergeBilingual: false` so the editor holds **physical rows**: one `SubtitleCue` per `Dialogue:` event, text in `primaryText`, no paired `secondaryText` editing.

`getCueDisplay` in `src/lib/ass/bilingual.ts` remains for translation/logical display helpers. Editor list, selected-row form, preview, burn, and editor save operate on physical `primaryText` and must **not** re-apply `settings.subtitleMergeMode`.

Clipboard codec: `formatDialogueEventLine` / `parseDialogueEventLine` in `src/lib/ass/eventLine.ts` for strict single-event lines (do not use full-document `parseAss` as the sole paste validity check).

## Tauri Payload Shapes

Frontend types mirror camelCase JSON from Tauri and the ASR sidecar (e.g. `durationMs`, `processedMs`). When adding fields:

1. Update Rust / Python schemas
2. Update `src/types/index.ts`
3. Update wrappers in `services/tauri.ts`
4. Prefer shared types over local `as` casts in views

## Scenario: Native ASR Availability Payload (T16 Handoff)

### 1. Scope / Trigger

Apply when Rust changes Native ASR engine/model availability or runtime dependency payloads consumed by the existing `tauri.ts` wrappers. T16 adds backend metadata; T17 owns the final visible UX.

### 2. Signatures

```typescript
type NativeAsrModelDisposition =
  | "supportedMissing"
  | "ready"
  | "postMvpUnavailable"
  | "unsupported";

type NativeAsrModelOrigin =
  | "directInstall"
  | "legacyHuggingFaceSnapshot";

interface AsrModelStatus {
  engine: string;
  model: string;
  available: boolean;
  downloaded: boolean;
  disposition?: NativeAsrModelDisposition;
  backend?: string | null;
  revision?: string | null;
  origin?: NativeAsrModelOrigin | null;
  reason?: string | null;
}

type RuntimeDependencyKind =
  | "ffmpeg"
  | "nativeAsrCpu"
  | "python311"
  | "asrVenv"
  | "asrModels"
  | "downloads"
  | "appCache";
```

### 3. Contracts

- `available` / `downloaded` remain for current `ModelManager` compatibility. Native metadata is additive and optional until T17 migrates all callers.
- Disposition mapping is backend-owned: ready `true/true`, supported-missing `true/false`, deferred or unsupported `false/false`.
- Components continue using `checkAsrModel`, `downloadAsrModel`, and `getModelDownloadProgress` from `src/services/tauri.ts`; do not parse invoke payloads locally.
- Download progress keeps numeric `progress`, byte counts, `error`, and compatibility `hfEndpoint`; optional revision/resolved path are diagnostics.
- Every backend-emitted runtime kind must exist in the TypeScript union and `RUNTIME_DEPENDENCY_LABEL`; `nativeAsrCpu` is built-in and has no frontend prepare/cleanup action.
- T16 does not remove legacy optional settings/type fields needed by the still-present T17 UI. T17 removes the visible Python setup flow after all callers migrate.

### 4. Validation & Error Matrix

| Payload | Frontend meaning |
|---|---|
| `ready` | model selectable/usable and already downloaded |
| `supportedMissing` | model route exists; offer model download |
| `postMvpUnavailable` | keep visible but disabled with later-support reason (T17) |
| `unsupported` | disabled unsupported identity; never imply missing Python |
| `nativeAsrCpu` | render built-in runtime status; no prepare/cleanup |
| Unknown runtime kind | Type/build failure rather than unchecked local cast |

### 5. Good / Base / Bad Cases

- Good: one typed wrapper returns compatibility booleans plus Native disposition; T17 renders the reason.
- Base: legacy sidecar response omits optional Native fields; current components continue using booleans.
- Bad: a view casts `disposition` from raw JSON, or interprets `available: false` only as “Python engine not installed”.

### 6. Tests Required

- Runtime dependency constant test includes `nativeAsrCpu`.
- `pnpm build` verifies Rust camelCase payload additions match shared types.
- T17 component tests must later cover every disposition/reason and removal of Python setup copy.
- Full `pnpm test` after shared type or wrapper changes.

### 7. Wrong vs Correct

```typescript
// Wrong: local duplicate payload definition
const disposition = (status as { disposition?: string }).disposition;

// Correct: shared IPC contract
const disposition: NativeAsrModelDisposition | undefined = status.disposition;
```

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
