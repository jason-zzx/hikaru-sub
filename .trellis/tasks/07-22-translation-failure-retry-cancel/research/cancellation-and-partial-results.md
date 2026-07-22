# Translation cancellation and partial-result research

## Scope and evidence

This research traces the current frontend-only translation path and identifies the minimum changes needed for visible partial failure, failed-only retry, cancellation, and explicit saving of incomplete output.

Relevant code:

- `src/components/workflow/TranslateView.tsx` owns the page-scoped provider, translation run, progress, logical result, ASS expansion, project-store apply, and file save.
- `src/services/translation/base.ts` owns batch construction, concurrent batch execution, response parsing, single-cue fallback, result counts, and error strings.
- `src/services/translation/requestScheduler.ts` owns FIFO concurrency and RPM start spacing.
- `src/services/translation/http.ts` owns request timeout and bounded/redacted provider HTTP errors.
- `src/services/translation/openai.ts`, `gemini.ts`, and `anthropic.ts` own protocol-specific `fetch` calls.
- `src/services/translation/translationProviders.test.ts` already tests scheduler timing, fallback, ordering, malformed responses, and credential/request-body redaction.
- `src/components/workflow/translatePhysicalBoundary.test.ts` protects logical cue to physical ASS expansion.

## Confirmed behavior and gaps

1. `TranslateView` creates a new provider for each run, so cancellation can remain page/run scoped. No global translation store, Tauri command, or app-level poller is required.
2. `translateBatch` schedules every batch concurrently through one provider-owned scheduler. A failed batch schedules each cue through the same scheduler, preserving provider concurrency and RPM limits.
3. `Promise.all` currently rejects only if a batch helper lets an exception escape. User cancellation must therefore be converted into a normal cancelled batch result, otherwise completed batches are lost when the aggregate rejects.
4. During single-cue fallback, every cue is already wrapped in its own catch. If cancellation is distinguished from provider failure, successful fallback cues completed before cancellation can be retained while queued/in-flight cues return unchanged.
5. `RequestScheduler` removes an item from its queue before its RPM timer fires. Merely aborting `fetch` is insufficient: a queued item needs immediate rejection/removal, and a timer-delayed item must not invoke its request callback after cancellation.
6. `fetchWithTimeout` currently overwrites any caller signal with `AbortSignal.timeout(timeout)`. It must compose the run signal with the timeout signal.
7. Provider HTTP errors currently redact configured credentials and whole request prompts/bodies, but a provider may echo only part of a sensitive value. Generation errors therefore need an executable stricter contract: exact known sensitive values are always redacted; a residual API credential/Authorization overlap of 4+ characters or request body/subtitle/glossary/custom/system/user prompt overlap of 8+ characters suppresses the structured server reason. Arbitrary generation exception text and non-JSON provider bodies remain hidden.
8. The current `errors` array may contain a recovered batch error even when all single-cue fallbacks succeed. Final UI state should use `failedCount`, not `errors.length`, to decide complete versus partial success.
9. Serializing cues without `secondaryText` is already safe: inline mode emits the source event unchanged, and separate mode omits the secondary event. This supports explicitly saving an incomplete logical result without changing the ASS model or serializer.
10. Existing project application and save protections are reusable: `confirmDiscardUnsavedChanges`, `captureProjectDocumentGuard`, `withDiscardedSubtitleRecovery`, physical re-parse, `captureSaveSnapshot`, and token-aware `markSaved`.

## Minimum cancellation contract

Add an optional `AbortSignal` to `TranslationOptions` and a `cancelled` boolean to `TranslationResult`.

The same signal must flow through:

```text
TranslateView AbortController
  -> TranslationProvider.translateBatch options.signal
  -> RequestScheduler.schedule(..., signal)
  -> generateText(..., signal)
  -> fetchWithTimeout(... RequestInit.signal ...)
```

Use native abort primitives already available in the Node 22 test runtime and modern WebView2:

- `AbortController` for one translation run.
- `AbortSignal.timeout(timeout)` for the existing timeout.
- `AbortSignal.any([runSignal, timeoutSignal])` when a caller signal exists.

Do not identify all `AbortError` exceptions as user cancellation because timeout also aborts a fetch. The authoritative test is `options.signal?.aborted`. The final product decision narrows single-cue fallback to two sequential local batch index/translation JSON validation failures of the same batch; the first format failure retries that batch with queue priority. Deterministic errors do not retry and stop immediately. A batch or fallback single request retries one transient `408/409/425/429/5xx`, timeout, or network failure once with queue priority; only the second failure counts as a failed work unit. The shared streak follows work-unit completion order: two retry-exhausted failures completing with no successful work-unit completion between them stop the run, and any completed success resets the streak. This completion-order streak is separate from the same-batch sequential format retry. Internal stops do not set user-cancelled state.

## Scheduler shape

Keep `RequestScheduler` generic and signal-driven; do not add a translation-specific `cancelAll` API.

- `schedule(run, signal?)` immediately rejects a pre-aborted request.
- While queued, an abort listener removes that exact item and rejects its promise.
- Keep the next item in the queue until its RPM timer fires instead of shifting it early. This lets queued abort remove timer-waiting work before `run` is invoked.
- Remove the scheduler abort listener immediately before starting `run`; the same signal then belongs to the HTTP request.
- If cancellation empties the queue, a remaining no-op timer may be cleared, but no request callback may run.

This preserves FIFO, maximum concurrency, RPM spacing, and immediate cancellation settlement without introducing scheduler lifecycle state.

## Partial-result assembly

Each batch helper should return a normal result even after user cancellation:

- Batch cancelled before translation: return all batch cues unchanged, success count `0`, no cancellation-as-error string, and `cancelled: true`.
- Local batch index/translation JSON validation fails: retry the same batch once with scheduler priority; only a second consecutive format failure records the safe batch error and begins fallback.
- Deterministic HTTP/provider-envelope failure: record the safe error, stop queued/in-flight batches immediately, and do not begin fallback.
- `408/409/425/429/5xx`, timeout, or network failure: retry the same batch or fallback single once with priority; record a safe error only if the second attempt fails and count that as one failed work unit. Update the shared streak by completion order: stop when two retry-exhausted failures complete with no successful work-unit completion between them, and reset whenever a work unit completes successfully. Same-batch format validation remains a separate sequential two-attempt rule.
- Fallback cue succeeds before cancellation: retain its `secondaryText` and count it.
- Fallback cue fails normally: retain the source cue and add a safe cue error.
- Fallback cue is cancelled: retain the source cue without adding a duplicate cancellation error.

Aggregate all batch results in source order. `TranslationResult.cancelled` is true when the run signal is aborted (or any batch reports cancellation). `failedCount` remains `input length - successCount`, so untranslated cancelled cues are eligible for the same failed-only retry path.

Progress must not be forced to 100% by cancelled queued batches. Suppress completion progress for a cancelled batch/run; keep the last real completion value until the final cancelled summary replaces the progress UI.

## Retry and save semantics

The user approved this policy:

- Complete success: keep current automatic apply/save behavior.
- Partial failure or cancellation: keep the logical result only in `TranslateView`; do not update project cues and do not write `translatedAssPath`.
- Show `保存当前结果` only as an explicit action. If zero cues have translations, keep the action disabled because saving would create a source-only “translated” file.
- `重试失败条目` passes only cues without non-empty `secondaryText`.
- Merge retry successes into the previous logical result by cue `id`, preserving prior successful translations and the original cue order.
- Recompute cumulative success/failed counts from the merged cues. Replace stale error details with errors from the latest retry attempt.
- A retry that reaches zero failures becomes complete success and follows the normal automatic apply/save path.
- Starting a new full translation discards the prior page-local draft; retry starts from the current page-local draft.

Explicit save must ask for unsaved-change confirmation at save time, then use the existing guarded apply/save pipeline. A confirmation obtained before a translation request must not be reused later for a partial draft.

## React lifecycle and task status

Use one controller/run token ref in `TranslateView`:

- `取消翻译` is available only while the run is accepting provider requests. It aborts the current controller and synchronously marks the run as cancel-requested.
- When `translateBatch` settles, close the cancel window before any apply/save await. A cancel accepted before that boundary forces the incomplete/cancelled result path even if the final HTTP response resolved concurrently.
- Session video-path change and component unmount abort and invalidate the run token.
- Progress/results/finally handlers check the token before setting component state or applying results.
- Cleanup changes the status-bar task from `running` to `idle`; it must not leave an invisible running task. Unmount or session-switch cancellation explicitly says it will not continue in the background, while manual cancellation may retain the concise completed-count message.

No new `TaskStatus` values are required for the minimum version. Use:

- complete success -> `success`
- partial result -> `error` with a partial-completion message
- user cancellation -> `idle` with a cancellation message
- fatal exception -> `error`

The page itself owns the richer `success | partial | cancelled | error` presentation.

## Safe error display

- Decide the state from counts/cancelled, not `errors.length`.
- Render errors only for partial/cancelled results.
- Reuse native `<details>` (already used by workflow/editor components) rather than add a new UI dependency.
- Render at most the first 20 error entries and indicate how many were omitted.
- Generation requests use a safe error classifier before errors enter the result: retain an application-defined category (`请求超时`, `网络请求失败`, `API 错误 <status>`, `响应格式无效`) plus batch/cue identity. Exact known API credential/Authorization, request body, subtitle, glossary, and custom/system/user prompt values are always redacted. A residual credential/Authorization overlap of 4+ characters or request-content/subtitle/glossary/prompt overlap of 8+ characters suppresses the entire structured JSON server reason. Reasons that pass are flattened and bounded; non-JSON bodies and arbitrary exception text are discarded.
- `listModels()` may keep its current bounded provider message because it does not contain translation prompts; translation generation must opt out of response-message display.
- Never log the errors array, request body, prompt, glossary, subtitle text, or API key.

## Verification matrix

Extend `src/services/translation/translationProviders.test.ts` to prove:

1. queued scheduler jobs reject immediately and never start after signal abort;
2. in-flight provider `fetch` receives the run signal through the timeout composition;
3. user cancellation does not start single-cue fallback;
4. cancellation during fallback retains already successful singles;
5. completed batches remain in the final cancelled result in source order;
6. deterministic failures do not retry and stop immediately; batch and fallback single transient failures retry once with priority, update the shared streak by work-unit completion order, stop after two retry-exhausted failures complete without an intervening completed success, and reset on completed success; only two sequential local batch JSON validation failures of the same batch trigger fallback;
7. arbitrary generation errors stay hidden; exact known sensitive values are redacted, a 4-character API credential fragment suppresses the reason, request-content residual overlap uses the 8-character threshold, and non-JSON bodies remain hidden;
8. a cancel racing with the final HTTP resolution cannot proceed into automatic project apply/save;
8. retry merge/count behavior preserves prior translations and order (pure helper or page test).

Keep the existing page-level pure logic and physical-boundary coverage. The previously deferred `TranslateView` component tests are not added in this task.

Run:

```bash
pnpm test -- src/services/translation/translationProviders.test.ts
pnpm build
```
