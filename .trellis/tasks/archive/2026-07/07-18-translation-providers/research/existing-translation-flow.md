# Existing Translation Configuration and Execution Flow

## Scope and headline

> Planning status: this report records pre-decision repository evidence. Product and protocol questions identified here were subsequently resolved in `prd.md`, `design.md`, and `research/provider-api-contracts.md`; those artifacts are authoritative for implementation.

This research traces the repository as it exists before supplier management is designed. The current product has one global, OpenAI-compatible translation configuration. It does **not** currently have a translation API-type field, provider registry, provider/model discovery, default-provider concept, or translation-concurrency setting.

That last point conflicts with the PRD background wording about moving an existing "interface type" and concurrency value: repository evidence identifies only one existing interface type (`openai-compatible`) and sequential execution. Planning should treat those fields as new behavior rather than migration of already persisted values.

## 1. Settings types, ownership, and UI flow

### Current shape

- `src/types/index.ts:28-46` defines the frontend `AppSettings`. Translation connection fields are the scalar `translationBaseUrl`, `translationModel`, and optional `translationApiKey` (`:35-37`). Translation behavior fields are `translationBatchSize`, `translationContextWindow`, optional prompt/glossary, merge mode, and target language (`:38-45`).
- There is no `translationApiType`, provider/supplier array, provider ID/name, default provider ID, model list, or max-concurrency field in that type (`src/types/index.ts:28-46`).
- `src-tauri/src/settings.rs:30-50` mirrors the settings as a camelCase serde payload. The same three scalar connection fields live at `:39-41`; batch/context behavior lives at `:44-48`.
- Defaults are one OpenAI endpoint and model: `https://api.openai.com/v1`, `gpt-4o-mini`, no API key, 25 cues per batch, and context window 2 (`src-tauri/src/settings.rs:52-72`).

### No settings store

- Settings are not held in a Zustand settings store. The repository specification states that `AppSettings` is loaded/saved through Tauri and is not mirrored in Zustand (`.trellis/spec/frontend/state-management.md:18`).
- `SettingsView` owns a local `AppSettings | null` draft, plus `dirty`/`saving` flags (`src/components/workflow/SettingsView.tsx:64-85`). It loads once on mount with `getSettings()` (`:87-99`).
- The generic `update` shallow-copies one top-level setting and marks the whole draft dirty (`src/components/workflow/SettingsView.tsx:136-140`). Save sends the entire object to `setSettings` (`:142-155`).
- The Tauri facade is intentionally thin: `getSettings` and `setSettings` are direct typed invokes (`src/services/tauri.ts:139-145`).

**Reusable pattern:** supplier CRUD can remain a nested top-level `AppSettings` value managed by the existing local draft and whole-object save. The repository does not justify a new global supplier/settings Zustand store. Async model-list request state can remain local to a supplier panel, as ASR model status does in `ModelManager` (`src/components/workflow/ModelManager.tsx:64-83`).

**Compatibility implication:** because saves replace the complete settings document, a redacted secret representation cannot safely round-trip through the current command without explicit merge/preserve semantics. Otherwise opening Settings and saving an unrelated field could erase stored supplier secrets.

## 2. Persistence, defaults, and migration behavior

### Disk path and serialization

- `settings_path` resolves through `app_paths::app_config_dir`, creates the directory, and appends `settings.json` (`src-tauri/src/settings.rs:76-80`).
- Installed mode uses Tauri's app config directory, while portable mode uses `<exe>/data` (`src-tauri/src/app_paths.rs:124-131`; portable roots are defined at `:21-26`).
- `load_settings` returns all defaults when the file does not exist, otherwise reads and deserializes the JSON before runtime-path sanitation (`src-tauri/src/settings.rs:82-96`).
- `save_settings` pretty-serializes the complete struct and calls `fs::write` (`src-tauri/src/settings.rs:98-102`). The `get_settings`/`set_settings` commands are direct wrappers (`:104-112`) and are registered at `src-tauri/src/lib.rs:40-43`.

### Existing compatibility mechanism

- `AppSettings` uses `#[serde(rename_all = "camelCase", default)]` (`src-tauri/src/settings.rs:30-32`). Missing fields therefore receive `AppSettings::default`; unknown fields are ignored because `deny_unknown_fields` is not used.
- A concrete migration pattern already exists for `RuntimeDependencySourceMode`: its custom deserializer maps `china` explicitly and maps legacy `auto`, `custom`, or any unknown value to `official` (`src-tauri/src/settings.rs:19-27`). Tests attest that legacy values deserialize safely (`src-tauri/src/settings.rs:248-260`) and deprecated top-level fields are ignored on load/re-serialization (`:273-281`).
- Current settings sanitation only normalizes executable/service paths (`src-tauri/src/settings.rs:114-155`). It does not validate or normalize translation URL, model, batch size, context window, or API key.

### Migration implications for suppliers

1. Adding new supplier/default fields with serde defaults is enough to prevent a missing-field crash, but it is **not** enough to preserve the existing user's endpoint, model, and API key. A default-created supplier must explicitly copy legacy `translationBaseUrl`, `translationModel`, and `translationApiKey`.
2. If legacy scalar fields are removed from the deserialization shape immediately, serde will discard them as unknown fields before migration can inspect them. Use a compatibility disk schema/custom deserializer, or retain legacy optional fields for one migration boundary and omit/deprecate them on the next save.
3. Repository behavior supports arbitrary OpenAI-compatible endpoints, including DeepSeek, Ollama, and self-hosted gateways (`src/services/translation/openai.ts:28-31`). Dropping the legacy Base URL during migration is a functional regression.
4. The only behavior-preserving max-concurrency default inferable from the repository is **1**, because every current request is awaited sequentially. Any larger migrated default changes request load and ordering semantics.
5. Supplier names and IDs cannot be derived authoritatively from current settings. Endpoint/model can seed a supplier, but naming/ID generation is a new contract that must be deterministic and tested.
6. A malformed or incompatible settings file makes `get_settings` fail at deserialization (`src-tauri/src/settings.rs:87-95`). `TranslateView` swallows that rejection and leaves settings null (`src/components/workflow/TranslateView.tsx:55-59`), so migration robustness is required to satisfy the no-crash/no-dead-flow acceptance criterion.

## 3. Secret storage and deletion semantics

### Current facts

- The API key is part of both frontend and Rust `AppSettings` (`src/types/index.ts:37`; `src-tauri/src/settings.rs:41`).
- The settings panel uses `type="password"`, but binds the real value into the controlled input. Empty input maps to `undefined` (`src/components/workflow/SettingsTranslationPanel.tsx:48-58`). Thus current deletion semantics are simply: clear the field, save the whole settings object, and omit/null the optional key.
- The UI explicitly tells users the key is stored in a local configuration file (`src/components/workflow/SettingsTranslationPanel.tsx:28-31`). `save_settings` serializes that field into plaintext `settings.json` (`src-tauri/src/settings.rs:98-102`).
- There is no keyring/keychain/Stronghold/credential dependency in the frontend dependencies (`package.json:29-50`), Rust dependencies (`src-tauri/Cargo.toml:15-36`), registered plugins (`src-tauri/src/lib.rs:30-37`), or capabilities (`src-tauri/capabilities/default.json:1-20`).
- Translation runs in the frontend. The key is attached as `Authorization: Bearer ...` only when present (`src/services/translation/openai.ts:109-120`). This deliberately allows unauthenticated local endpoints.

### Findings

- **High - plaintext multi-secret expansion:** adding multiple supplier keys to the current JSON structure would multiply plaintext credentials in `settings.json`. This is current behavior, not a newly introduced secure-storage pattern.
- **High - redaction/whole-save hazard:** changing to secret storage requires an explicit contract for "unchanged", "replace", and "delete". The current empty-string-to-`undefined` control cannot distinguish an untouched redacted key from deletion, and `set_settings` replaces the entire document.
- **Medium - architecture/spec tension:** the frontend service specification says translation HTTP belongs in the frontend (`.trellis/spec/frontend/services-and-tauri-bridge.md:25-33`) while also listing API keys in Tauri invoke payloads as an anti-pattern (`:44-49`). Current `getSettings` already returns the key through invoke. Planning resolved this by preserving the existing local `AppSettings` behavior for this task and requiring a Phase 3.3 spec clarification; it does not authorize keys in logs or unrelated invoke payloads.
- API keys must remain optional by protocol/configuration: `canTranslate` currently requires endpoint and model but not a key (`src/components/workflow/TranslateView.tsx:222-227`), which is necessary for Ollama or an unauthenticated local gateway.

## 4. Settings category navigation

### Current implementation

- `SettingsCategory` is the union `runtime | transcription | translation` (`src/types/index.ts:11-12`).
- The visible category list is ordered runtime, transcription, translation (`src/components/workflow/SettingsView.tsx:46-62`).
- `uiStore.openSettings(category)` changes both workflow step and category; leaving Settings clears the requested category (`src/stores/uiStore.ts:24-36`). Default is `runtime` (`:35-36`).
- `SettingsView` initializes from the requested category and listens for later deep-link changes (`src/components/workflow/SettingsView.tsx:67-70`, `:101-105`). It renders nav from the category array (`:301-321`) and conditionally mounts translation content (`:370-372`).
- The translation page's missing-API action currently deep-links to `openSettings("translation")` (`src/components/workflow/TranslateView.tsx:288-300`). Sidebar Settings always opens runtime (`src/components/layout/Sidebar.tsx:49-60`).

### Supplier implication

Add the supplier category to the `SettingsCategory` union and insert its metadata immediately before `translation`; add a corresponding conditional panel branch. When no usable default supplier exists, `TranslateView` should deep-link to the new supplier category, while translation-behavior settings remain under `translation`. The existing `openSettings` pattern should be reused rather than adding routing state.

## 5. Translation adapter and model-listing surface

### Existing adapter contract

- `TranslationProviderConfig` contains only `baseUrl`, optional `apiKey`, `model`, and optional `temperature` (`src/services/translation/types.ts:29-35`). It has no API type or concurrency.
- The abstract provider supports `translateBatch`, `translateSingle`, and `testConnection` (`src/services/translation/base.ts:9-42`). It does not define model listing.
- The factory accepts only that config and always returns `OpenAITranslationProvider`; its comment says the first version supports only OpenAI-compatible APIs (`src/services/translation/index.ts:15-22`).
- `testConnection` is implemented by making a chat-completion request (`src/services/translation/openai.ts:309-325`) but has no repository caller. There is likewise no translation model-list implementation or `/models` request anywhere under `src/services/translation/`.

### OpenAI-compatible protocol details

- Requests POST to string-concatenated `${baseUrl}/chat/completions` (`src/services/translation/openai.ts:101-123`).
- They use JSON `{ model, messages, temperature }` and optional Bearer auth (`:109-121`). Non-2xx responses include the response text in the thrown error (`:125-127`).
- Batch output is prompted as a JSON array (`:61-99`) and parsed by extracting the first array-looking span, requiring expected array length and `number`/`string` field types (`:137-163`). Index bounds, uniqueness, and original order are not validated.

### Supplier/protocol implications

- The repository's only existing API type is best named `openai-compatible`. "Existing interface types" cannot refer to any persisted enum or alternate adapter.
- Gemini and Anthropic require new adapters and factory dispatch, not just labels in Settings. Their request/response/auth/model-list contracts are not present in the repository and require explicit design/external protocol verification.
- Model listing should be added as a focused provider/domain service contract rather than embedded fetch logic in a React panel. The existing provider abstraction is reusable, but whether `listModels` belongs on the translation provider itself or a sibling discovery interface is a design choice; there is no current precedent.
- Keep custom Base URL capability at least for `openai-compatible`. The current adapter explicitly supports Ollama/self-hosted gateways (`src/services/translation/openai.ts:28-31`), so a fixed OpenAI URL would regress current users.
- Endpoint joining currently assumes no trailing slash. New adapters/model-listing code should normalize endpoints with structured URL handling rather than propagating `${baseUrl}/...` double-slash behavior.
- Provider-specific default URLs, API-version headers, auth style, model-list response shape, and filtering were not repository-answerable; `research/provider-api-contracts.md` and `design.md` now define them from official sources.

## 6. Concurrency and batch semantics

### Current execution is serial

- `translationBatchSize` means cues included in one API request, not concurrent requests (`src/components/workflow/SettingsTranslationPanel.tsx:60-73`; `src/services/translation/openai.ts:171-175`).
- `OpenAITranslationProvider.translateBatch` iterates batches with a normal `for` loop (`src/services/translation/openai.ts:181-199`) and awaits one API request before advancing (`:210-225`).
- If a batch response cannot be parsed, it retries each cue sequentially (`src/services/translation/openai.ts:239-254`). If the batch request throws, it also retries each cue sequentially (`:256-273`).
- Progress and result ordering depend on serial appends to `results` (`src/services/translation/openai.ts:175-179`, `:201-208`, `:277-286`). There is no scheduler, queue, semaphore, `Promise.all`, or cancellation API in the translation service.

### Risks for supplier max concurrency

- **High - zero/invalid concurrency:** existing numeric settings rely only on HTML `min`/`max`, convert with `Number(...)`, and have no Rust or service validation (`src/components/workflow/SettingsTranslationPanel.tsx:60-85`; `src-tauri/src/settings.rs:82-102`). A concurrency scheduler must validate/clamp a finite integer greater than zero at a trusted boundary; zero can deadlock a queue/semaphore.
- **High - result order and progress:** naive concurrent `results.push` will make ASS cue order completion-dependent. Results should be stored by original batch/cue index and flattened in source order; progress counts can increment on settlement independently.
- **Medium - fallback fan-out:** a failed batch currently degrades into N single requests. Under concurrency, nested unrestricted fallback can exceed the supplier limit unless batch and fallback requests share the same limiter.
- **Medium - migrated behavior:** defaulting existing users above 1 changes remote load, rate-limit exposure, completion ordering, and error timing. Concurrency 1 is the compatibility default supported by current evidence.
- **Medium - progress/error tests absent:** there are no adapter tests asserting serial ordering, fallback, progress, timeout, or partial failure. Concurrency changes therefore need direct service tests with mocked `fetch`.

## 7. TranslationView end-to-end flow and display

### Settings and source loading

- `TranslateView` loads settings once on mount (`src/components/workflow/TranslateView.tsx:55-59`) and uses `defaultTargetLang` when a session/settings change (`:61-102`).
- It owns the logical source cues and always reads `session.transcribedAssPath`; it parses with `mergeBilingual: false` and does not overwrite editor metadata on entry (`src/components/workflow/TranslateView.tsx:73-97`). This boundary is also specified at `.trellis/spec/frontend/component-guidelines.md:49-53`.

### Translation execution

- `handleTranslate` constructs the one provider directly from the scalar settings (`src/components/workflow/TranslateView.tsx:104-125`).
- It parses glossary lines locally (`:127-138`) and passes Japanese source, selected target, batch/context/prompt/glossary, and a fixed 60-second timeout (`:140-157`).
- Progress is mirrored both locally and to `taskStore` (`:112-117`, `:151-155`). Translation itself remains page-owned; there is no App-level translation job poller or cancellation.
- The logical bilingual result is serialized once using `subtitleMergeMode`, then parsed back as physical rows before entering `projectStore` (`src/components/workflow/TranslateView.tsx:159-184`). It writes `session.translatedAssPath`, updates active-subtitle state only around save success/failure, and marks the captured revision token saved only after successful I/O (`:184-199`). Supplier work should leave this ASS boundary unchanged.

### Current display/gating

- The start condition requires nonempty source, Base URL, and model, but not API key (`src/components/workflow/TranslateView.tsx:222-227`).
- Missing Base URL displays an API warning and links to translation settings (`:288-301`).
- Config summary displays `API: <translationBaseUrl>` and `模型: <translationModel>` (`:303-314`).

### Supplier implication

Resolve the effective supplier/model once before constructing the provider. The summary should render the supplier's user-visible name and effective model, not Base URL. Gating should require a valid default supplier, supported API type, and effective model; key presence must follow API-type/endpoint requirements rather than becoming universally mandatory. Missing configuration should link to supplier settings.

## 8. Tests defining current behavior

### Existing coverage

- `src/components/workflow/translatePhysicalBoundary.test.ts:22-68` verifies that logical translated cues serialize/reparse to one inline physical row or two separate physical rows. It protects ASS generation, not API behavior.
- `tests/FileCenteredWorkflow.test.ts:53-60` asserts translation writes the strict `session.translatedAssPath` and does not derive an ad hoc `.ass` path.
- `tests/SettingsViewCategoryNav.test.ts:28-40` source-checks the default category and current three Chinese labels/panels. Its deep-link test requires `TranslateView` to contain `openSettings("translation")` (`:49-54`). This test must deliberately change when missing supplier configuration links to the new category.
- Rust settings tests demonstrate defaults and migration style for runtime source modes (`src-tauri/src/settings.rs:239-281`) but do not test translation defaults, API-key round-trip/deletion, malformed translation values, or legacy-to-supplier migration.
- `tests/SettingsViewAsrSetup.test.ts:102-108` protects an analogous pattern where changing ASR engine resets the model and wires model management. This is a useful interaction precedent, though ASR model download is not reusable protocol code for remote translation model listing.

### Important absent coverage

There are no tests for:

- `OpenAITranslationProvider` request URL/headers/body, response parsing, fallback, timeout, progress, or errors.
- `createTranslationProvider` dispatch (it currently has no dispatch branch).
- Translation model listing or connection testing.
- Translation batch concurrency or maximum enforcement.
- Translation settings UI behavior beyond source-text category assertions.
- Legacy scalar translation settings migration to supplier records.
- Supplier secret preservation/replacement/deletion.
- Default supplier/default model repair after supplier/model deletion.
- `TranslateView` effective-supplier resolution and supplier-name/model summary.

Minimum feature tests should cover those contracts directly. Keep the existing physical-boundary and file-path tests intact because supplier management is upstream of them.

## 9. Review findings, ordered by severity

1. **Blocker - requirements/repository mismatch:** `src/types/index.ts:28-46`, `src-tauri/src/settings.rs:30-50`, and `src/services/translation/index.ts:18-22` show no existing API-type or concurrency settings and only one OpenAI-compatible adapter. The design must define the new enum and cannot claim to migrate fields that do not exist.
2. **High - legacy credential/config loss:** serde defaulting alone will create new defaults but will not copy the old endpoint/model/key into a supplier. Removing old fields before an explicit compatibility read makes serde ignore the values (`src-tauri/src/settings.rs:30-32`, `:82-102`).
3. **High - plaintext secrets and ambiguous deletion:** API keys are plaintext in `settings.json`, returned in full settings, and cleared by emptying a controlled input (`src-tauri/src/settings.rs:39-41`, `:98-102`; `src/components/workflow/SettingsTranslationPanel.tsx:48-58`). Multi-supplier storage needs an explicit approved secret contract.
4. **High - concurrency validation/order:** current translation is entirely serial and numeric settings are not validated beyond HTML attributes (`src/services/translation/openai.ts:181-273`; `src/components/workflow/SettingsTranslationPanel.tsx:60-85`). A shared limiter, positive-integer validation, and index-stable assembly are required.
5. **Medium - custom endpoint regression:** OpenAI-compatible support explicitly includes Ollama/self-hosted gateways (`src/services/translation/openai.ts:28-31`). Making Base URL non-editable for that API type would break a documented current capability.
6. **Medium - default deletion invariants:** no current default-provider/model contract exists. Deleting the active supplier or a selected model can otherwise leave `TranslateView` with dangling IDs and no actionable warning.
7. **Medium - settings load failure is silent in TranslationView:** rejection becomes `settings = null` (`src/components/workflow/TranslateView.tsx:55-59`), after which neither the missing-API warning nor a translation action is available. Migration tests should prove old settings deserialize to a usable effective supplier.
8. **Medium - adapter test vacuum:** all provider/model-list/concurrency behavior is currently untested; existing translation tests cover only ASS expansion and output path.
9. **Low - response index trust:** OpenAI response parsing checks array length and field types but not unique/in-range indexes (`src/services/translation/openai.ts:137-163`). Concurrent/indexed result assembly should tighten this boundary rather than carry it forward.

## 10. Planning resolutions

The repository-supported conclusions remain:

- preserve `openai-compatible` and editable custom Base URLs;
- migrate the legacy endpoint/model/key into one provider with concurrency `1`;
- keep translation behavior in Translation settings and provider connection/auth/model/limits in Provider settings;
- reuse the `SettingsView` draft, `openSettings`, frontend translation service, and existing ASS boundary;
- keep API keys optional at the common contract level for proxy compatibility;
- display provider name plus selected model in `TranslateView`.

Product decisions in `prd.md` resolve the former unknowns: plaintext local key storage remains, Base URLs stay editable, each provider owns one selected model, one global ID selects the default, deletion falls back to the first provider, manual model input remains available, and migrated naming is deterministic. `research/provider-api-contracts.md` resolves native Gemini/Anthropic endpoints, headers, pagination, and response shapes. No unresolved research question blocks implementation.
