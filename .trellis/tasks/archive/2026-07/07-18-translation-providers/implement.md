# Translation Provider Management - Implementation Plan

## Checklist

1. **Replace the persisted translation connection schema**
   - Add Rust `TranslationApiType` and `TranslationProviderSettings` types.
   - Replace serialized scalar translation connection fields with `translationProviders` and `defaultTranslationProviderId`.
   - At file load, inspect parsed JSON field presence before normal `AppSettings` deserialization; migrate legacy scalars only when `translationProviders` is absent.
   - Make an explicitly present new provider array win over stale legacy keys and serialize only the new fields.
   - Add migration and normalization helpers used on load and before save.
   - Add Rust tests for defaults, both migration names, secret preservation/deletion, mixed old/new precedence, new-format reload without remigration, numeric bounds, and default-ID repair.
   - Run filtered Rust settings tests before continuing.

2. **Mirror the new settings contract in TypeScript**
   - Add `TranslationApiType` and `TranslationProviderSettings` to `src/types/index.ts`.
   - Add `providers` to `SettingsCategory`.
   - Replace legacy scalar fields in `AppSettings` with the provider array/default ID and make each provider API key a required string whose empty value is incomplete.
   - Add a small translation-provider constants/helper module for API labels, default URLs, numeric defaults/ranges, and new-provider creation.

3. **Introduce shared scheduling and translation orchestration**
   - Add a FIFO request scheduler with validated concurrency and evenly spaced RPM starts.
   - Move shared prompt construction, batching, strict response parsing, fallback, progress, and source-order assembly into the base provider.
   - Extend provider config with API type/concurrency/RPM and add `listModels`.
   - Remove the unused `testConnection` contract.
   - Define the limiter slot around one HTTP attempt so it is released before fallback work is queued.
   - Add fake-timer service tests for scheduler limits, stable ordering, strict indexes, monotonic progress, and failed-batch fallback completing at concurrency `1` through the same limiter.

4. **Implement the three protocol adapters**
   - Refactor OpenAI-compatible HTTP behind the shared pipeline and add `/models` discovery.
   - Add native Gemini generation/model-list pagination, cursor-progress guards, and optional `models/` input normalization.
   - Add native Anthropic Messages/model-list pagination with cursor-progress guards, `max_tokens: 4096`, the stable version header, and the WebView direct-browser header.
   - Dispatch by API type in `createTranslationProvider`.
   - Add mocked-fetch tests for URL joining, auth headers, request bodies, response extraction, model filtering/pagination, and concise non-2xx errors.

5. **Add Provider settings UI**
   - Create `SettingsProvidersPanel` using existing shadcn controls and `lucide-react` icons.
   - Implement add/select/edit/default/delete flows against the existing `SettingsView` draft.
   - Implement API-type default URL/reset behavior, required API key input, manual model input, key-gated on-demand model candidates, preserved model on fetch failure, and bounded concurrency/RPM inputs.
   - Add the `供应商` category before `翻译` and render the panel.
   - Remove Base URL/model/API key fields from `SettingsTranslationPanel`; keep only translation behavior and target-language settings.
   - Add component/pure-helper tests for add/edit/default/delete, API-type reset, numeric bounds, model-fetch failure preservation, and incomplete-provider/default readiness.
   - Update category navigation/deep-link assertions and verify that the Provider panel is mounted before Translation.

6. **Add session-local provider selection to the Translation view**
   - Initialize a page-local selected provider from the configured default and let the Translation view switch it without persisting the selection.
   - Construct the provider with API type, endpoint, key, model, concurrency, and RPM.
   - Gate translation on provider name/Base URL/API key/model readiness.
   - Deep-link incomplete configuration to `openSettings("providers")`.
   - Display provider name and model instead of Base URL and model.
   - Add automated coverage for session-local provider resolution, required-key readiness, incomplete-provider deep linking, and provider-name/model summary.
   - Leave target language, glossary, progress, ASS generation, save-token handling, and output paths unchanged.

7. **Update executable project specifications**
   - Run the Phase 3.3 spec review after implementation.
   - Update frontend Settings category lists and translation-provider descriptions that become stale.
   - Record the user-approved exception that translation API keys remain inside the existing local `AppSettings` IPC/persistence flow; do not broaden that exception to logs or unrelated invoke payloads.

8. **Run full-scope verification**
   - Run targeted frontend service/settings/workflow tests while iterating.
   - Run the complete frontend test suite.
   - Run the TypeScript/Vite build.
   - Run the complete Rust test suite.
   - Review the final diff for real API keys, captured auth values, private endpoints, or real subtitle/prompt payloads; synthetic protocol fixtures remain allowed.
   - Smoke-check Provider settings navigation, model fetching failure behavior, default deletion fallback, and Translation view readiness in Tauri development mode when the local desktop environment permits it.

## Validation Commands

```bash
cargo test --manifest-path src-tauri/Cargo.toml settings::tests
pnpm test -- src/services/translation src/components/workflow/SettingsProvidersPanel.test.tsx tests/SettingsViewCategoryNav.test.ts src/components/workflow/translatePhysicalBoundary.test.ts
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Risky Files And Rollback Points

| Area | Risk | Rollback point |
| --- | --- | --- |
| `src-tauri/src/settings.rs` | Legacy endpoint/model/key loss or malformed default repair | Do not proceed past step 1 until migration fixtures and serialization tests pass |
| Shared translation base/scheduler | Ordering regressions, concurrency-`1` fallback deadlock, non-monotonic progress, or fallback exceeding limits | Keep protocol adapters unmodified until fake-timer scheduler/pipeline tests pass |
| Gemini/Anthropic adapters | Vendor-specific auth, pagination, or response-shape mistakes | Validate each adapter independently with mocked official contract fixtures |
| `SettingsProvidersPanel.tsx` | Default ID and provider list can diverge during delete/edit | Keep provider list/default updates atomic and test default deletion |
| `TranslateView.tsx` | Supplier work could disturb ASS output/save behavior | Preserve existing physical-boundary and file-path tests; revert only provider resolution/display changes if needed |

## Review Gates Before `task.py start`

- [ ] `prd.md` has completed its convergence pass and contains no unresolved product decisions.
- [ ] User has reviewed `prd.md`, `design.md`, and this plan.
- [ ] `implement.jsonl` and `check.jsonl` contain real frontend/Tauri spec and research entries.
- [ ] No vendor SDK, new settings store, new Tauri command, or secure-storage migration has entered scope.
- [ ] Security wording permits only synthetic contract fixtures and forbids real credentials/private payloads.

## Completion Conditions

- All acceptance criteria in `prd.md` are implemented.
- Targeted and full frontend tests pass.
- `pnpm build` passes.
- Full Rust tests pass.
- Any unavailable network/manual provider checks are reported explicitly rather than inferred from mocked tests.
- No commit is created unless the user separately requests it.
