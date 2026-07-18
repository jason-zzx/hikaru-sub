# Translation Provider Management - Design

## Architecture

Keep the existing ownership boundaries:

- Rust/Tauri owns persisted settings, legacy migration, and trusted numeric normalization.
- React owns Provider settings UI and default-provider selection.
- `src/services/translation/` owns provider HTTP, model discovery, batching, fallback, concurrency, and RPM scheduling.
- `TranslateView` continues to own the page-scoped translation run and the existing logical-to-physical ASS boundary.

No new Tauri command, Zustand store, vendor SDK, or dependency is required.

## Settings Contract

Add these cross-layer types:

```ts
type TranslationApiType = "openai-compatible" | "gemini" | "anthropic";

interface TranslationProviderSettings {
  id: string;
  name: string;
  apiType: TranslationApiType;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxConcurrency: number;
  requestsPerMinute: number;
}
```

Replace the legacy scalar connection fields in frontend `AppSettings` with:

```ts
translationProviders: TranslationProviderSettings[];
defaultTranslationProviderId?: string;
```

Keep translation behavior fields (`translationBatchSize`, context, prompt, glossary, merge mode, and target language) unchanged.

### Defaults

A new settings document contains one provider:

| Field | Value |
| --- | --- |
| ID | `default-provider` |
| Name | `OpenAI` |
| API type | `openai-compatible` |
| Base URL | `https://api.openai.com/v1` |
| Model | `gpt-4o-mini` |
| API key | empty string |
| Maximum concurrency | `1` |
| Requests per minute | `10` |

`defaultTranslationProviderId` points to `default-provider`.

New providers created in the UI use `crypto.randomUUID()`, start as `openai-compatible`, use its default Base URL, have empty name/model/key strings, and use concurrency `1` and RPM `10`. Empty keys are persisted but make providers incomplete.

## Legacy Migration

Keep the public Rust `AppSettings` shape new-format only. At file load, parse `settings.json` once as `serde_json::Value` so migration can distinguish an absent `translationProviders` key from a present empty array before deserializing the value into `AppSettings` with defaults.

1. If `translationProviders` is present, the new format wins even when stale legacy keys also exist; do not remigrate or replace the provider array.
2. If `translationProviders` is absent and legacy endpoint/model fields are present, build one migrated `openai-compatible` provider from those values.
3. Preserve the exact legacy endpoint, model, and non-empty API key; use an empty API key string when the legacy key is absent.
4. Use ID `default-provider`, concurrency `1`, and RPM `10`.
5. Name the provider `OpenAI` only when endpoint/model equal the old defaults and the key is absent; otherwise name it `默认供应商`.
6. Set `defaultTranslationProviderId` to the migrated provider.
7. Serialize only the new `AppSettings` fields, making migration one-way on the next save.

This presence-aware JSON migration avoids duplicating the full settings schema in a compatibility DTO and prevents a new-format save/load from being mistaken for legacy data.

Run provider normalization after both load and before save:

- clamp maximum concurrency to `1..50`;
- clamp RPM to `1..100`;
- normalize a whitespace-only API key to an empty string;
- repair a dangling default ID to the first provider;
- clear the default ID when the provider list is empty.

Incomplete names, URLs, and models are intentionally preserved.

## Provider Settings UI

Add `providers` to `SettingsCategory` and place the Chinese `供应商` category immediately before `翻译`.

Create `SettingsProvidersPanel` under `src/components/workflow/`. It receives the existing `SettingsView` draft and updates the two provider-related top-level settings fields; no settings store is introduced.

The panel uses a compact provider list plus one detail editor:

- add provider command;
- select provider for editing;
- mark the selected provider as default;
- delete with confirmation;
- edit name, API type, Base URL, API key, model, maximum concurrency, and RPM;
- fetch model candidates on demand and select one;
- retain a normal model input for manual values.

Use existing shadcn controls and `lucide-react` icons. All product copy remains Simplified Chinese. API keys remain password inputs with the existing local-plaintext notice.

### UI State And Mutations

Fetched model candidates, fetch errors/loading, delete confirmation, and the selected editor row remain local component state. Only the selected model is persisted.

Changing API type:

- replaces Base URL with that type's official default;
- clears the selected model and transient fetched candidates;
- preserves provider name, API key, concurrency, and RPM.

Deleting the default provider selects the first remaining provider. Deleting the final provider clears the default. Incomplete providers can be saved and can remain default.

Model discovery uses the provider's current draft API type, Base URL, and API key. It is disabled while Base URL or API key is empty. Failure shows an inline error but never clears the model.

## Translation Service

### Provider Factory

Extend `TranslationProviderConfig` with API type, maximum concurrency, and RPM. `createTranslationProvider` dispatches to:

- `OpenAITranslationProvider`;
- `GeminiTranslationProvider`;
- `AnthropicTranslationProvider`.

Add `listModels(): Promise<string[]>` to the provider contract. Remove the unused `testConnection` method instead of implementing it three times.

### Shared Translation Pipeline

Move protocol-independent behavior from the current OpenAI class into the abstract base provider:

- system and batch prompt construction;
- batch/context slicing;
- strict JSON-array response parsing;
- single-cue fallback;
- progress accounting;
- index-stable result and error assembly.

Each protocol adapter implements only:

- one text-generation request from system/user prompt strings;
- model-list discovery and normalization.

Response parsing must accept exactly one translation for every expected index, reject duplicates/out-of-range indexes, and rebuild cues in source order regardless of request completion order.

### Request Scheduler

Use one FIFO scheduler per provider instance. Every batch request and every single-cue fallback passes through it.

- In-flight operations never exceed `maxConcurrency`.
- Request starts are spaced by `60_000 / requestsPerMinute` milliseconds.
- Scheduled-but-not-started HTTP operations reserve a concurrency slot so timers cannot later exceed the limit.
- A slot covers exactly one HTTP attempt and is released before a failed batch queues single-cue fallback requests. The scheduler must therefore complete fallback without deadlock when concurrency is `1`.
- A completed batch updates progress independently of completion order, and exposed progress values remain monotonic.
- Batch results and errors are stored by source batch index and flattened only after all work settles.

Model-list requests are one-shot settings actions and do not use the translation-run scheduler.

### Shared HTTP Boundary

Use the standard `URL` API to append paths while preserving a user-entered path prefix. Apply `AbortController` timeouts to generation and model-list requests. Non-2xx errors include a bounded provider response message, never credentials, auth headers, or translation request bodies.

## Protocol Adapters

### OpenAI-Compatible

- Default Base URL: `https://api.openai.com/v1`.
- `Authorization: Bearer` authentication using the provider API key.
- `POST /chat/completions`; extract `choices[0].message.content`.
- `GET /models`; return non-empty `data[].id` values.

### Gemini

- Default Base URL: `https://generativelanguage.googleapis.com/v1beta`.
- `x-goog-api-key` authentication using the provider API key.
- `POST /models/{model}:generateContent`; use `systemInstruction` and `contents`.
- Extract text parts from the first candidate; missing text is an error.
- `GET /models`, follow `nextPageToken`, retain models supporting `generateContent`, and strip the `models/` prefix.
- Treat an absent `nextPageToken` as normal completion and reject only repeated non-empty continuation tokens. At request time, also strip one optional `models/` prefix from manually entered model values.

### Anthropic

- Default Base URL: `https://api.anthropic.com/v1`.
- `x-api-key` authentication using the provider API key plus fixed `anthropic-version: 2023-06-01` and `anthropic-dangerous-direct-browser-access: true` for direct WebView requests.
- `POST /messages` with `max_tokens: 4096`, system text, and one user message.
- Concatenate response blocks with `type: "text"`; no text block is an error.
- `GET /models`, follow `has_more` with `after_id`, and return non-empty `data[].id` values. Reject `has_more` responses with an absent or repeated `last_id` cursor.

## Translation View

Initialize a page-local `selectedProviderId` from `defaultTranslationProviderId`, then resolve the active provider from that local selection. The Provider dropdown updates only this local state; it does not call settings persistence or change the configured default. Translation readiness requires:

- an existing selected provider;
- non-empty provider name, Base URL, API key, and model;
- non-empty source cues and the existing page readiness conditions.

A missing/incomplete provider disables translation and shows an action that calls `openSettings("providers")`. The configuration summary displays `供应商` and `模型`; Base URL is not shown.

Session-local provider selection does not alter the existing target language, glossary, prompt, task progress, ASS generation, save token, translated path, or physical-row behavior.

## Error Handling

- Settings load/migration errors remain surfaced through the existing settings error path.
- Model-list errors stay in Provider settings and preserve the current model.
- Provider request errors participate in the existing batch-to-single fallback.
- Partial translation failure preserves untranslated source cues and reports errors without exposing secrets or prompt bodies.
- Invalid numeric values are bounded in the UI, provider constructor, and Rust persistence boundary.
- API keys are required provider fields. Empty or whitespace-only keys fail common readiness, disable model discovery, and prevent translation from starting.

## Compatibility And Rollback

- Existing settings are readable and migrate without losing endpoint, model, or API key.
- New settings omit legacy scalar fields; rolling back after saving new settings would lose provider configuration because the old binary does not understand the array. Rollback before a new-format save is data-neutral.
- No filesystem path, capability, or portable-mode behavior changes.
- No change to subtitle file naming or ASS serialization.

## Verification Strategy

### Rust

Add settings tests for:

- new defaults;
- untouched keyless legacy migration to `OpenAI`;
- customized/keyed legacy migration to `默认供应商`;
- legacy field omission on serialization;
- mixed old/new input precedence and new-format save/load without remigration;
- concurrency/RPM normalization and dangling-default repair.

### Frontend Services

Add focused tests for:

- factory dispatch;
- OpenAI, Gemini, and Anthropic request/auth/response contracts;
- model-list normalization and pagination;
- strict batch index validation;
- stable output ordering under concurrent completion;
- shared concurrency and evenly spaced RPM limits across batch fallback;
- concurrency-`1` failed-batch fallback without deadlock and monotonic progress;
- pagination cursor-progress guards and manual Gemini model normalization.

### UI And Workflow

Add committed automated coverage for provider add/edit/default/delete behavior, API-type reset, numeric bounds, required-key readiness/model-discovery gating, failed model discovery preserving the model, session-local provider selection, Provider-settings deep links, and provider-name/model summary. Preserve existing translation physical-boundary and file-centered workflow tests.

Run full frontend tests, build, and Rust tests because the change crosses the settings IPC contract and translation workflow.
