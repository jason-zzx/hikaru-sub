# Native Faster-Whisper model expansion design

## Summary

Extend the released Windows x64 Native CPU route from `large-v3` to six additional ordinary Faster-Whisper models by adding exact model identities to the existing Rust model manager and exposing their independent availability through the existing production contracts.

The minimum design is manifest-first:

```text
six pinned CT2 model rows
        |
        v
NativeAsrModelManager
  exact readiness / download / atomic install
        |
        v
released CTranslate2 CPU worker
  model-derived Mel + tokenizer + vocabulary
        |
        v
existing T18 ASR commands and T17 availability UI
```

No new backend, downloader, command family, frontend registry, Python dependency, or GPU runtime is planned.

## Activation boundary

This design is based on the parent sequence:

```text
T12 model manager + T13 CPU runtime
        -> T16 runtime/settings
        -> T17 frontend migration
        -> T18 Native large-v3 cutover
        -> this expansion
```

Planning and identity research may happen before T18. Production code changes and model enablement start only after T18 provides the stable baseline, unless the user explicitly changes the parent roadmap and this task's scope.

At activation, re-read the T16-T18 final artifacts and update only contract names or file locations that actually changed. Do not pull their unfinished responsibilities into this task.

## Existing architecture reused

### Rust model manager

`src-tauri/src/asr_models.rs` remains the single owner of:

- manifest parsing and validation;
- exact direct and legacy Hugging Face readiness;
- official/China endpoint selection;
- resumable `.part` downloads;
- exact size/SHA-256 verification;
- staged atomic publication and repair;
- one active download job per logical model;
- terminal download snapshots.

The schema already supports multiple model rows, so schema version 1 remains sufficient unless a failing implementation test proves otherwise.

### Native worker

The released worker already:

- accepts ordinary `faster-whisper` independently of model name;
- reads the model's actual `n_mels` and accepts 80/128;
- accepts `vocabulary.txt` or `vocabulary.json`;
- requires `preprocessor_config.json` only for Kotoba;
- preserves the protocol, cancellation, recovery, and segment legality contracts.

Therefore worker/runtime bytes should remain unchanged by default. A runtime revision is allowed only after an exact target model fails for a worker defect that cannot be fixed in model delivery or integration.

### Frontend

`src/constants/asr.ts` already owns the product model list and already contains all six targets. The expansion must not introduce another registry or per-view hardcoded support list.

The T17/T18 availability result remains authoritative for whether an option is downloadable, ready, runnable, unavailable, or failed. `large-v3` remains the default.

## Model manifest design

Add one independent schema-v1 row for each passing model:

- `faster-whisper/tiny`
- `faster-whisper/base`
- `faster-whisper/small`
- `faster-whisper/medium`
- `faster-whisper/large-v2`
- `faster-whisper/large-v3-turbo`

Each row freezes:

- logical ID, engine, model, backend, and format;
- canonical repository and immutable 40-character revision;
- license SPDX, attribution, and pinned source URL;
- four logical required roles: model config, model weights, tokenizer, vocabulary;
- exact path, byte size, and SHA-256 for every required file.

Expected repository closures:

- Systran `tiny/base/small/medium/large-v2`: `config.json`, `model.bin`, `tokenizer.json`, `vocabulary.txt`.
- Canonical turbo repository: `config.json`, `model.bin`, `tokenizer.json`, `vocabulary.json`.

The turbo repository's `preprocessor_config.json` is not part of ordinary Whisper readiness. Extra repository files are not downloaded merely because they exist upstream.

Manifest inclusion is the support boundary. A model that has not passed functional qualification stays absent from the release manifest and remains visible as post-MVP unavailable. Do not add an `enabled` flag or a second rollout configuration.

## Availability and launch flow

After T18, the intended flow is:

```text
UI selects engine/model
  -> check_asr_model
  -> NativeAsrModelManager.status
       manifest absent  -> unavailable with reason
       manifest present + invalid/missing bytes -> downloadable/missing
       exact bytes ready -> ready
  -> download_asr_model when needed
  -> exact resolved model path
  -> start_asr through existing Native host
  -> released CPU worker
```

The exact T16/T17 response fields must be reused. If T18 has already made `start_asr` generic over the selected manifest entry, this task does not add launch routing. If T18 hardcodes `large-v3`, replace only that hardcoded selection with the existing manager lookup; do not add a parallel launch path.

No unavailable model may silently invoke Python or fall back to `large-v3`.

## Independent failure behavior

Each model has its own logical ID, immutable revision directory, download namespace, active job, readiness result, and UI state.

A failure for one model must not:

- change another model's readiness;
- delete another revision directory or partial download;
- change the default model;
- invalidate the bundled worker;
- disable `large-v3`;
- trigger Python fallback.

The existing model manager already provides these boundaries; implementation should extend tests before changing architecture.

## Worker compatibility qualification

Qualification is functional, not Python-parity based.

For every model:

1. exact manifest readiness or verified download;
2. worker model load using the released CPU runtime;
3. short Japanese end-to-end transcription through the Rust host;
4. non-empty valid UTF-8 output;
5. ordered, positive-duration, audio-bounded segments;
6. normal protocol completion and persisted recovery/fallback behavior.

Additional checks:

- `large-v2`: one Japanese input longer than ten minutes;
- `large-v3`: existing regression smoke remains green;
- cancellation/crash/recovery: rerun the generic host suite and at least one real newly added model cancellation smoke where the existing test contract permits it;
- installed/portable: exercise at least one small model and `large-v2` through the packaged layout, while exact path/readiness tests cover every model.

CER, S/D/I, semantic gaps, and Python comparisons may be recorded as diagnostics but do not block support unless they expose empty/corrupt output or another functional failure.

## Runtime revision rule

Keep the T13 runtime artifact unchanged when all six models load and transcribe successfully.

If a real model fails because of worker code:

1. add the smallest failing model-backed regression;
2. fix the shared model-derived behavior, not a model-name special case;
3. freeze a new runtime identity and rebuild reproducibly;
4. rerun all six new model smokes plus the complete `large-v3` runtime/package regression gate;
5. update package hashes, licenses, and installed/portable evidence for the new bytes.

Do not rebuild merely because the manifest changes; model weights are external to the runtime artifact.

## Frontend behavior

Reuse the existing model selector, `ModelManager`, Tauri wrappers, and T17 availability presentation.

Expected behavior:

- `large-v3` remains selected by default for new/default settings;
- a manifest-backed missing model is visible and downloadable;
- a ready model is selectable and runnable;
- an unsupported or failed model remains visible with a concise reason;
- switching models cancels or ignores stale status requests using the existing request identity behavior;
- download progress remains per job and uses the existing snapshot contract.

No new screen or advanced model-management UI is required.

## Compatibility and migration

- Existing settings values for the six model IDs remain valid; they are already product IDs.
- A previously selected post-MVP model becomes runnable only when its exact manifest entry is present and ready.
- Existing `large-v3` direct installs and legacy snapshots keep their current paths and priority.
- No user model, partial download, setting, project, subtitle, or cache is deleted during enablement or rollback.
- Official/China source behavior remains unchanged.

## Rollout and rollback

### Rollout

- Qualify all six rows against the stable T18 baseline.
- Ship only rows that passed every required gate; task completion still requires all six.
- Release notes list each supported model, approximate download size, CPU-only status, and known diagnostic quality limitations.

### Rollback

- Remove or revert only the affected manifest row and any row-specific availability assertion.
- Keep downloaded model directories and partials intact for a later fixed release.
- If worker bytes changed, restore the previous runtime artifact and manifest identity together.
- Never delete user data or silently reroute to Python.

## Security and privacy

- Manifest values are bundled release input but remain validated before joining paths or building URLs.
- Canonical repository/revision/file values are the only URL inputs; no custom model URLs are introduced.
- Existing Windows path alias, symlink/reparse, containment, resume, and atomic publication checks remain mandatory.
- Logs and task evidence must not include transcript text, model bytes, credentials, headers, response bodies, or private absolute paths.

## Decisions

- **D1:** Reuse schema-v1 multi-entry manifest; no new model registry.
- **D2:** Keep the released worker unchanged unless real model evidence proves a shared compatibility defect.
- **D3:** Manifest inclusion is the enablement switch; no speculative `enabled` field.
- **D4:** Keep `large-v3` as default and make every model's readiness/failure independent.
- **D5:** Functional legality gates support; Python quality parity remains diagnostic.
- **D6:** Do not start production implementation before the T18 baseline or an explicit roadmap revision.
