# Expand Translation Provider Management

## Goal

Let users preconfigure multiple translation API providers and reliably reuse a default provider and its selected model in the translation workflow, reducing repeated setup and switching effort.

## Background

The current application persists one Base URL, model, and optional API key and sends OpenAI-compatible translation requests serially. The new provider model must add native Gemini and Anthropic protocols without losing existing OpenAI, DeepSeek, Ollama, proxy, or self-hosted configurations.

## Requirements

### R1. API Types And Protocols

- Support `openai-compatible`, `gemini`, and `anthropic` API types.
- Use editable default Base URLs:
  - `openai-compatible`: `https://api.openai.com/v1`
  - `gemini`: `https://generativelanguage.googleapis.com/v1beta`
  - `anthropic`: `https://api.anthropic.com/v1`
- OpenAI-compatible uses Chat Completions and `/models` with Bearer authentication.
- Gemini uses native `generateContent` and `models.list` with `x-goog-api-key` authentication.
- Anthropic uses native Messages and model-list APIs with `x-api-key`, `anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access: true` for the Tauri WebView request path.
- Every provider record has an API key string. An empty or whitespace-only key is an incomplete configuration and cannot discover models or start translation.
- Every API type supports batched subtitle translation and on-demand model discovery.

### R2. Provider Settings

- Add a Chinese `供应商` category immediately before `翻译` in Settings.
- Let users create, edit, and delete providers with these fields:
  - name;
  - API type;
  - editable Base URL;
  - API key;
  - selected model;
  - maximum concurrency;
  - requests per minute (RPM).
- Selecting an API type supplies its official Base URL default while still allowing later edits for proxies and self-hosted services.
- Maximum concurrency defaults to `1` and accepts integers from `1` through `50`.
- RPM defaults to `10` and accepts integers from `1` through `100`.
- UI validation, translation scheduling, and persisted-settings normalization enforce both numeric ranges.
- API keys keep the current behavior: plaintext local `settings.json` persistence, password inputs with a local-storage notice, and clear-then-save deletion. Clearing stores an empty string and makes the provider incomplete.
- Remove provider connection, authentication, API type, model, concurrency, and RPM fields from the Translation settings category. Keep translation behavior fields there.

### R3. Model And Default Selection

- Persist one selected model on each provider and only one global `defaultProviderId`.
- The active/default model is the selected model of the default provider.
- Switching the default provider restores that provider's previously selected model.
- Users may enter a model manually or fetch model candidates and select one.
- Model discovery is advisory: failure or an incomplete response preserves the current model and leaves manual entry available.
- Incomplete providers may be saved and may remain the default.
- Deleting the default provider selects the first remaining provider; deleting the final provider clears `defaultProviderId`.

### R4. Translation Scheduling

- All batch and single-cue fallback requests in one translation run share the active provider's limits.
- In-flight requests never exceed maximum concurrency.
- Request starts are evenly spaced according to `60,000 / RPM` milliseconds.
- Concurrent completion must not change source cue order, result order, or final ASS order.
- A concurrency slot covers one HTTP attempt only and is released before any single-cue fallbacks are queued, including when concurrency is `1`.
- Invalid response indexes, duplicate indexes, and missing translations must trigger existing single-cue fallback behavior rather than corrupt ordering.

### R5. Translation View

- Initialize the Translation view's active provider from `defaultProviderId` and that provider's selected model.
- Let users select another provider in the Translation view. This selection is local to the mounted Translation view and must not update persisted settings or `defaultProviderId`.
- Replace the Base URL summary with the active provider's name and continue showing the active model.
- A missing provider, dangling selection, or selected provider without a name, Base URL, API key, or model disables translation and shows an action that opens Provider settings.
- Preserve existing target-language, glossary, prompt, progress, ASS generation, translated-file path, and save-token behavior.

### R6. Legacy Migration

- Migrate legacy `translationBaseUrl`, `translationModel`, and `translationApiKey` values into one `openai-compatible` provider.
- Preserve the exact endpoint, model, and non-empty API key. A legacy configuration without a key migrates with an empty API key string and remains incomplete until configured.
- Use maximum concurrency `1`, RPM `10`, and make the migrated provider the default.
- Name the migrated provider `OpenAI` only when the endpoint and model still equal the old defaults and no API key is present.
- Name it `默认供应商` when an API key is present or the endpoint/model differs from the old defaults, including keyless local/self-hosted configurations.
- New-format saves omit the deprecated scalar connection fields.
- Old settings must load without crashing Settings or Translation views.

## Acceptance Criteria

- [ ] AC1: Settings shows `供应商` immediately before `翻译`, and users can create, edit, select, default, and delete provider records.
- [ ] AC2: Provider forms support all fields and API types in R1/R2, editable prefilled URLs, required API key strings, concurrency `1..50`, and RPM `1..100`.
- [ ] AC3: Users can type a model or fetch/select candidates; failed discovery preserves the current model.
- [ ] AC4: Each provider remembers its model, switching the default restores it, and default deletion follows R3.
- [ ] AC5: Incomplete providers can be saved; a missing/empty API key is incomplete, and an incomplete/missing active provider disables translation and links to Provider settings.
- [ ] AC6: OpenAI-compatible, Gemini, and Anthropic mocked contract tests use synthetic credentials/prompts to verify model discovery, authentication header construction, generation request shapes, and response extraction.
- [ ] AC7: Translation scheduling enforces shared concurrency/RPM limits across batch and fallback requests while preserving cue order, monotonic progress, and fallback completion at concurrency `1`.
- [ ] AC8: Translation settings no longer contain provider fields, and Translation view shows provider name plus model without Base URL and supports a non-persisted session-local provider selection.
- [ ] AC9: Legacy migration preserves endpoint, model, and API key, applies the required name/default/limits, and omits deprecated fields on new saves.
- [ ] AC10: Existing ASS physical-boundary and translated-path behavior remains passing.
- [ ] AC11: No real API keys, captured authentication values, private endpoints, real subtitle/prompt payloads, or sensitive request bodies are added to source, fixtures, or logs; contract tests use clearly synthetic values only.

## Out Of Scope

- Migrating API keys to an OS credential store.
- Persisting Translation-view provider selection or changing the configured default provider from the Translation view.
- Persisting fetched model lists.
- Streaming, vendor SDKs, tool use, prompt caching, beta headers, OpenAI Responses API, or provider-specific advanced features.
- Automatic quota discovery or token-per-minute limiting.
