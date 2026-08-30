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

## Scenario: Native ASR Availability and Frontend UX

### 1. Scope / Trigger

Apply when changing the Native ASR engine/model/device selectors, model download gate, or runtime dependency UI that consumes the stable Tauri ASR commands. Backend metadata and the shared T17 availability owner remain authoritative after the Release/default Native cutover and packaged Python removal.

### 2. Signatures

```typescript
type NativeAsrModelDisposition =
  | "supportedMissing"
  | "ready"
  | "postMvpUnavailable"
  | "unsupported";

interface AsrEngineInfo {
  name: string;
  available: boolean;
  backend?: string | null;
  device?: string | null;
  reason?: string | null;
}

interface AsrModelStatus {
  engine: string;
  model: string;
  available: boolean;
  downloaded: boolean;
  disposition?: NativeAsrModelDisposition;
  backend?: string | null;
  revision?: string | null;
  origin?: "directInstall" | "legacyHuggingFaceSnapshot" | null;
  reason?: string | null;
}

type RuntimeDependencyKind =
  | "ffmpeg"
  | "nativeAsrCpu"
  | "asrModels"
  | "downloads"
  | "appCache";

useAsrAvailability(engine: string, model: string, device: string)
```

`AppSettings` keeps `asrEngine`, `asrModel`, and `asrDevice`; frontend `pythonPath` / `asrServicePath` and ASR setup job/environment types no longer exist. Rust may still accept legacy settings keys for rollback compatibility.

### 3. Contracts

- `ASR_ENGINE_OPTIONS`, `ASR_ENGINE_MODELS`, and `ASR_DEVICE_OPTIONS` are presentation registries only. `listAsrEngines` / `checkAsrModel` decide whether each known option is enabled.
- One mounted `useAsrAvailability` owner supplies Settings and Transcribe with typed engine/model/device options, selected status, route gate, refresh, and stale-request rejection. `ModelManager` must consume that owner; it must not call `checkAsrModel` through a fallback checker.
- Load the product model list when the engine changes. A same-engine model selection reuses the loaded status map; check only a selected legacy/unknown model missing from that map. This prevents repeated exact hashing across the seven manifest-backed Faster-Whisper models.
- Disabled options remain visible with a concise backend reason. An unavailable persisted value stays displayed and is never silently rewritten; only an explicit user selection changes settings.
- `ready` and `supportedMissing` are runnable routes; only `supportedMissing` offers model download. Deferred/unsupported identities never show Python setup actions.
- A Native engine reporting `device: "cpu"` enables `auto` / `cpu` and disables CUDA. Legacy payloads without device metadata remain compatibility input for rollback/tests, but the production route emits Native metadata.
- Native CPU transcription sends `useVad: false` and `vadConfig: null`; the request schema remains for rollback/future runtime capability work.
- Before Native worker progress has advanced, Transcribe renders indeterminate launch/model-load/first-window progress. After `processedMs > 0`, the existing audio-based percentage remains authoritative.
- User cancellation is separate from document-guard invalidation and unmount. Cancelling before `startAsr` returns keeps duplicate starts locked as `取消中…`, cancels the late job ID immediately, and reports only `已取消转录`; genuine document changes keep their own stale-result message.
- Frontend runtime dependencies contain only production-visible kinds. `nativeAsrCpu` is bundled/status-only and has no prepare or cleanup action; missing `asrModels` routes the user to Transcription.
- Components continue using typed wrappers from `src/services/tauri.ts`; no raw invoke, local payload cast, or second support registry.

### 4. Validation & Error Matrix

| Condition | Required frontend behavior |
|---|---|
| `ready` | option enabled; show model ready; no download button |
| `supportedMissing` | option enabled; show model download button; refresh shared status after completion |
| `postMvpUnavailable` | option visible/disabled with backend later-support reason |
| `unsupported` | option visible/disabled with unsupported reason |
| Engine/model check error | keep persisted value; disable Start; show controlled retryable error |
| Stale engine/model response | ignore it; never replace the current selection's state |
| Native CPU + CUDA | CUDA visible/disabled; Start remains disabled |
| `nativeAsrCpu` missing | show application runtime/reinstall error; no download/cleanup action |
| Legacy payload without disposition/device | use compatibility booleans and do not infer missing Python |

### 5. Good / Base / Bad Cases

- Good: one engine change checks its known model list once; selecting an already-loaded model performs no extra readiness scan.
- Base: an old unavailable setting remains selected with a disabled/reason label until the user explicitly chooses a supported CPU model; new/default settings still select `large-v3`.
- Bad: `ModelManager` performs its own `checkAsrModel`, a component hardcodes `large-v3` as the only enabled ID, or unavailable means “install Python”.

### 6. Tests Required

- `useAsrAvailability.test.tsx`: option projection, stale engine result, same-engine no-rescan, unknown persisted model, and route/device gates.
- `ModelManager.test.tsx` plus legacy gate/diagnostic suites: four dispositions, download promise reuse, diagnostics, completion refresh, and compatibility booleans.
- Settings/runtime tests: no Python/venv/setup UI, unavailable values are not rewritten, Native runtime is status-only, and ASR model action routes to Transcription.
- Transcribe seam tests: unavailable/CUDA gating, `useVad: false`, download-to-start, indeterminate startup/first-window progress, pre-job-ID user cancellation, polling/document guard/recovery/PlayRes/ASS save/translation handoff.
- Run full `pnpm test` and `pnpm build` after shared availability/type/UI changes.

### 7. Wrong vs Correct

```typescript
// Wrong: a second support registry and a second model checker.
const enabledModels = new Set(["large-v3"]);
const status = await checkAsrModel(engine, model);

// Correct: one typed owner projects backend metadata for every consumer.
const availability = useAsrAvailability(engine, model, device);
<ModelManager
  status={availability.selectedModelStatus}
  checking={availability.modelLoading}
  checkError={availability.selectedModelError}
  refreshStatus={availability.refreshSelectedModel}
/>;
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
