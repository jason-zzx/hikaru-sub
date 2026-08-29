# T18 Native ASR release-cutover design

## Summary

T18 changes two existing release seams and leaves the rest of the ASR system intact:

```text
stable ASR commands
  -> one process-lifetime AsrRoutePolicy
  -> NativeMvp by default
  -> T12 exact large-v3 path
  -> T13 verified bundled CPU worker

release preparation
  -> remove stale Python sidecar resource
  -> verify/extract tracked Native runtime ZIP
  -> Tauri NSIS + explicit portable staging
  -> package-content/size/license qualification
```

No new command family, route setting, worker, model registry, package manager, dependency, version change, or release automation is planned.

## Architecture boundaries

### Tauri remains the route and process authority

`src-tauri/src/asr.rs` already owns a single `AsrRoutePolicy` used by engine listing, model status/download/progress, transcription start/progress/cancel, and missing-job behavior. T18 changes the default policy from conditional legacy to `NativeMvp`.

The existing Native path remains unchanged:

1. validate the stable request;
2. reserve the shared active-job slot;
3. resolve T12 exact model readiness;
4. resolve and verify the T13 packaged CPU runtime;
5. start the existing `NativeAsrHost` with `ResolvedNativeLaunch`;
6. expose the existing progress/cancel/recovery snapshots.

Native failures return directly. They must never call the legacy `ensure_base_url` path.

The debug fake-worker environment remains only a host-injection seam for tests. It no longer determines whether the product uses Native routing.

### Python legacy source remains inert rollback evidence

T18 removes Python from release artifacts and product routing, not from repository history in one broad deletion.

For one stable release cycle, the following may remain in source:

- repo-root `asr-service/` development and historical benchmark code;
- legacy sidecar functions in `src-tauri/src/asr.rs`;
- legacy setup implementation/commands in `src-tauri/src/asr_setup.rs` and `lib.rs`;
- legacy settings/source metadata required to inspect or build a rollback patch.

They are not production route inputs and are not copied into NSIS or portable resources. No frontend caller exposes them after T17.

This boundary avoids a risky mixed cutover/deletion refactor while still satisfying the user-visible and artifact-level “no Python dependency” requirement.

## Release resource design

### Keep one preparation command

Retain `pnpm asr:prepare-resource` and `scripts/prepare-asr-resource.mjs` to avoid renaming package scripts, workflows, docs, and release entry points solely for terminology.

Its post-T18 behavior is minimal:

1. delete `src-tauri/resources/asr-service` recursively with `force: true`;
2. load the tracked Native runtime lock;
3. verify the tracked archive;
4. atomically extract/replace `src-tauri/resources/native-asr` through the existing verifier.

The script no longer reads or copies repo-root Python source. A small exported function may be introduced only to make stale-resource cleanup and Native extraction testable; no generic resource pipeline is needed.

### Tauri NSIS resource closure

`tauri.conf.json` continues to bundle `resources/` because it also contains the runtime source manifest, Native model manifest, Native runtime, icons/licenses, and other approved resources.

Safety comes from:

- deleting the tracked legacy `src-tauri/resources/asr-service` tree;
- release/CI always running `pnpm asr:prepare-resource` before Tauri build;
- testing that preparation removes a stale local legacy tree;
- auditing final package contents.

Changing the broad Tauri resource mapping to dozens of individual entries is unnecessary and more error-prone.

### Portable staging closure

`createPortableStaging` keeps its explicit allowlist and removes only the `asr-service` entry. The stage contains:

- `hikaru-sub.exe`;
- `runtime-dependency-sources.json`;
- verified `native-asr/`;
- `.portable`.

It must not contain source templates, `deps/`, models, caches, PDBs, build directories, or stale resources copied from `target/release`.

A focused test should deliberately leave a stale `resourceDir/asr-service` and `releaseDir/asr-service`, then prove neither reaches the portable stage.

## Runtime and model integrity

T18 does not change:

- `native-asr/runtime/windows-x64-cpu-lock.json`;
- `native-asr/artifacts/windows-x64-cpu.zip`;
- `src-tauri/resources/native-asr-models.json`;
- worker protocol, inference algorithm, tokenizer, timestamp logic, model hashes, download paths, or readiness rules.

The existing verifier remains the sole runtime artifact authority. T12 remains the sole exact model authority.

If implementation changes any runtime/model byte or identity, stop and return to T13/T12-level rebuild and evidence rules; T18 cannot silently absorb such drift.

## Qualification data flow

### Automated gates

```text
tracked runtime lock/archive
  -> pnpm asr:runtime:verify
  -> pnpm asr:prepare-resource
  -> unit/integration tests
  -> pnpm release:local
  -> NSIS + portable package audit
```

Package audit binds:

- runtime artifact/manifest identity;
- package hashes and sizes;
- forbidden resource/file counts;
- model-weight count;
- license inventory.

### Model-backed gates

Reuse `scripts/smoke-native-asr-runtime.mjs` for worker-output legality. Run it against the exact packaged worker/model identity for both installed-like and portable-like layouts using:

- `.asr-benchmark/short.wav`;
- a >10-minute input derived from or equal to `.asr-benchmark/long.wav`;
- the exact T12-ready large-v3 snapshot.

Do not add another transcript parser. If orchestration is needed, use shell/PowerShell commands and write one sanitized task-local evidence file rather than building a permanent qualification framework for a one-time matrix.

The final evidence records hashes, durations, event/segment counts, artifact/model identity, layout role, package sizes/hashes, and pass/fail status only. It never records transcript text, ASS text, model bytes, credentials, or absolute private paths.

### Product-level smoke

After package creation, perform the smallest manual release check needed to prove the built application reaches the same Native route:

- start extracted portable and installed build;
- confirm runtime/model availability presentation;
- run cached large-v3 transcription without Python installed/configured;
- confirm progress, completion, output creation, cancel, and restart/recovery behavior;
- confirm no sidecar/Python process or resource is used.

Manual evidence is acceptable only as a supplement; artifact identity, package content, route defaults, and worker output legality remain automated/tested.

## Release-smoke UX corrections

### Process-lifetime ready-model cache

`NativeAsrModelManager` may retain only successful exact ready resolutions for the current process. The first resolution still performs the complete T12 size/SHA-256 and containment verification. Later Settings/Transcribe checks and the `start_asr` preflight reuse that immutable resolved identity instead of hashing `model.bin` again.

The cache is not a persistent trust database and does not cache missing/corrupt results. A successful manager-owned download may seed the cache because publication already verified the complete staging/final tree. Runtime/model load errors remain controlled failures.

### Progress presentation

Protocol v1 remains unchanged. Before the worker has produced meaningful `processedMs`, the frontend shows an indeterminate progress bar for launch/model-load/first-window work. Once `processedMs > 0`, the existing real audio-based percentage and segment counts remain authoritative.

### Cancellation state separation

User cancellation, document-guard invalidation, and component unmount are separate states. Cancelling before `start_asr` returns a job ID keeps the controls locked with `取消中…`; when the ID arrives the frontend cancels it immediately, releases the task state, and shows only `已取消转录`. Document changes retain their existing stale-result wording.

## Compatibility and migration

- Existing `asrEngine`, `asrModel`, and `asrDevice` settings are preserved. T17 keeps unavailable saved values visible; T18 does not rewrite them on load.
- A user with `faster-whisper / large-v3 / auto|cpu` uses Native immediately when the model is ready.
- An unavailable saved engine/model/device stays unavailable until the user explicitly selects the supported route.
- Existing exact managed large-v3 snapshots remain reusable; no migration or copy is required.
- Existing Python paths/settings keys remain ignored compatibility input and are not reactivated.
- No user model, partial, project, subtitle, cache, or setting is deleted during rollout or rollback.

## Documentation design

Update documentation only after the cutover behavior is implemented and verified.

### Product docs

- `README.md`: Native large-v3 CPU is the production ASR route; Python is development/legacy only.
- `docs/release.md`: package contains Native runtime, no sidecar/Python/model; replace Python setup validation with Native package/model/offline checks.
- `docs/runtime-dependencies.md`: FFmpeg remains external/managed; Native runtime is bundled/status-only; models live under bounded `deps/models`; remove production Python/venv setup and cleanup claims.
- `THIRD_PARTY_NOTICES.md`: describe actual bundled Native components/licenses and distinguish unbundled legacy/optional Python components.
- `asr-service/README.md`: mark the sidecar as development, historical engine research, and rollback evidence rather than the production desktop runtime.

### Agent/spec docs

- `AGENTS.md`: update architecture, common commands, directories, runtime dependency and diagnostic rules without deleting guidance still needed when intentionally modifying legacy sidecar source.
- `.trellis/spec/tauri/media-ffmpeg-asr.md`: convert pre-cutover route/package clauses to production Native contracts.
- `.trellis/spec/frontend/type-safety.md`: remove transitional “T18 owns” wording; keep metadata-driven selection and no-Python UX contracts.
- `.trellis/spec/asr/index.md` or the smallest owning ASR doc: state that repo-root sidecar is not packaged and is no longer the production inference path.

Historical quality evidence and archived tasks remain unchanged.

## Error handling and security

- Missing/corrupt runtime or model returns a controlled Native error and releases the active slot.
- No error path starts Python or reads arbitrary custom model/runtime paths.
- Runtime archive verification remains fail-closed and path-contained.
- Model resolution remains exact, hash-verified, symlink/reparse-contained, and bounded to managed roots.
- Package preparation removes only the known generated legacy resource target; it does not delete repo-root source or user data.
- Logs/evidence omit transcript/request text, private headers, credentials, and absolute private paths.

## Rollout

1. Add focused route/resource/package tests.
2. Switch the one route-policy default.
3. stop copying and package-remove the legacy sidecar resource.
4. run full automated validation.
5. build NSIS/portable and run package + model-backed qualification.
6. update product/agent/spec documentation against verified behavior.
7. run independent review and final full gate.

## Rollback

A rollback patch restores:

- `AsrRoutePolicy::Legacy` as the default;
- legacy resource preparation/staging if a prior release truly requires it;
- previous documentation.

Rollback does not remove Native runtime/model data or any user project/settings/subtitle/cache. No destructive migration exists.

## Decisions

- **D1:** Change the existing single route-policy default; do not add a setting or second command family.
- **D2:** Remove packaged Python resources but retain legacy source for one stable release cycle.
- **D3:** Keep the existing preparation command name and Tauri resource root; explicitly remove stale legacy resources instead of redesigning packaging.
- **D4:** Reuse the existing verifier and smoke harness; no permanent release-qualification framework unless implementation proves a missing repeatable gate.
- **D5:** T18 does not update version, add a version-specific changelog entry, commit, tag, push, or publish.
- **D6:** Any runtime/model identity drift rolls back to the owning T12/T13 process rather than being accepted inside T18.
