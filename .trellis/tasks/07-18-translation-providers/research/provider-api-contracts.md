# Translation Provider API Contracts

Accessed: 2026-07-18

## Scope

This report defines the minimum REST contracts needed for three provider types: `openai-compatible`, `gemini`, and `anthropic`. Base URLs remain editable, so adapters must treat these defaults as initial values rather than fixed hosts.

## Recommended Defaults

| API type | Default Base URL | Generation endpoint | Model-list endpoint |
| --- | --- | --- | --- |
| `openai-compatible` | `https://api.openai.com/v1` | `POST /chat/completions` | `GET /models` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta` | `POST /models/{model}:generateContent` | `GET /models` |
| `anthropic` | `https://api.anthropic.com/v1` | `POST /messages` | `GET /models` |

Adapters should join paths through the URL API and remove only redundant trailing slashes from user-entered Base URLs. They must not silently replace an edited host or path prefix.

## OpenAI-Compatible

### Authentication

Send `Authorization: Bearer <api-key>` when a key is present. Keep the key optional because local endpoints such as Ollama may not require authentication.

### Model Discovery

Call `GET {baseUrl}/models`. Normalize the common OpenAI response shape:

```json
{
  "data": [{ "id": "gpt-4.1-mini", "object": "model" }]
}
```

Return non-empty `id` values. Do not require optional OpenAI metadata because compatible gateways commonly expose only the ID.

### Translation

Preserve the existing `POST {baseUrl}/chat/completions` contract with `model`, `messages`, and `temperature`. Extract `choices[0].message.content` as text and retain the existing structured JSON-array translation prompt.

### Compatibility Boundary

"OpenAI-compatible" means the current Chat Completions and Models endpoints only. The task does not add the Responses API, streaming, tool calling, embeddings, or vendor-specific model metadata.

## Gemini

### Authentication

Send the API key in the `x-goog-api-key` header. Header authentication avoids putting credentials in query strings, browser history, or diagnostic URLs.

### Model Discovery

Call `GET {baseUrl}/models` and follow `nextPageToken` through the `pageToken` query parameter until exhausted. The response contains a `models` array whose `name` values use the `models/<id>` form.

Only expose models whose `supportedGenerationMethods` contains `generateContent`. Normalize fetched model IDs by removing the leading `models/` segment so the adapter can construct `/models/{model}:generateContent` exactly once. At generation time, also remove one optional `models/` prefix from a manually entered model value.

Track pagination tokens and fail model discovery if `nextPageToken` repeats. This preserves the selected model instead of allowing a malformed proxy response to loop indefinitely.

### Translation

Call `POST {baseUrl}/models/{encodedModel}:generateContent`. Send user text through `contents[].parts[].text`; use `systemInstruction.parts[].text` for the translation system prompt and `generationConfig.temperature` for temperature.

Extract and concatenate text parts from the first candidate's `content.parts`. Treat missing candidates, prompt blocking, or a candidate without text as a provider response error rather than a successful empty translation.

### Version Scope

Use the documented REST `v1beta` Base URL for this implementation. Do not add the OpenAI-compatibility facade for Gemini because the requested Gemini API type should exercise the native protocol and model discovery contract.

## Anthropic

### Authentication And Versioning

Send these headers:

- `x-api-key: <api-key>` when a key is configured
- `anthropic-version: 2023-06-01`
- `anthropic-dangerous-direct-browser-access: true`
- `content-type: application/json`

Anthropic's TypeScript SDK uses the direct-browser header when browser access is explicitly enabled. Hikaru Sub performs provider HTTP from a Tauri WebView, so the native REST adapter must send the equivalent header. This acknowledges that credentials are present in the frontend process under the user-approved local settings model.

The official Anthropic endpoint requires an API key. The shared UI and adapter contract nevertheless keeps the key optional so a user-edited proxy can provide authentication out of band; an official endpoint with no key surfaces its normal authentication error.

### Model Discovery

Call `GET {baseUrl}/models`. Follow pagination with `after_id` and `limit` while `has_more` is true, using the returned `last_id` as the next cursor. Normalize non-empty `data[].id` values and optionally retain `display_name` for model-picker labels without persisting the fetched list. If `has_more` is true but `last_id` is absent or repeated, fail discovery rather than loop indefinitely.

### Translation

Call `POST {baseUrl}/messages` with `model`, `max_tokens: 4096`, `messages`, optional `system`, and `temperature`. Anthropic requires an explicit output limit; 4096 is sufficient for the configured subtitle batch sizes without adding another user setting.

Extract and concatenate `content` blocks whose `type` is `text`. Treat a response with no text block as an error. Preserve `stop_reason` in diagnostic context when it indicates truncation, but do not log request bodies or API keys.

### Version Scope

Use the stable `2023-06-01` API version header. Do not add beta headers, prompt caching, message batches, token counting, streaming, or tool-use support in this task.

## Shared Error And Proxy Rules

- Parse non-2xx response bodies only for a concise provider message; never include credentials or request prompts in logs.
- Apply the existing request timeout to model listing and translation calls.
- Validate Base URL and model ID before dispatch. Keep API keys optional for custom proxy compatibility; official services report missing credentials through normal non-2xx responses.
- Preserve user-entered path prefixes for proxies.
- Model lists are fetched on demand and kept as transient UI state; the selected model is persisted.
- A failed refresh must not erase an already selected model.

## Minimum Implementation Scope

Implement native request/response adapters for Gemini and Anthropic, keep the current OpenAI-compatible Chat Completions adapter, and add a small provider-level `listModels` contract. Do not introduce vendor SDK dependencies: the existing frontend `fetch` architecture is sufficient for these REST calls.

## Official Sources

- Google, "Method: models.list": https://ai.google.dev/api/models
- Google, "Method: models.generateContent": https://ai.google.dev/api/generate-content
- Google, "Using Gemini API keys": https://ai.google.dev/gemini-api/docs/api-key
- Anthropic, "List Models": https://docs.anthropic.com/en/api/models-list
- Anthropic, "Create a Message": https://docs.anthropic.com/en/api/messages
- Anthropic, "API versioning": https://docs.anthropic.com/claude/reference/versioning
- Anthropic TypeScript SDK browser-access handling: https://github.com/anthropics/anthropic-sdk-typescript/blob/e400d2e8a54aa736717ed849ef8b44a3490fce68/src/index.ts
- OpenAI, API definition: https://platform.openai.com/docs/static/api-definition.yaml
- OpenAI, "List models": https://platform.openai.com/docs/api-reference/models/list
- OpenAI, "Create chat completion": https://platform.openai.com/docs/api-reference/chat/create
