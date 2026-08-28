# Migrate Native ASR runtime and settings backend

## Goal

Deliver the Tauri backend contract required for the first Hikaru Sub Native ASR MVP: consume the completed T12 large-v3 model manager and T13 bundled CPU runtime, remove Python/venv from production runtime and settings behavior, and prepare the stable ASR commands for a single Native cutover without changing their public names or job semantics.

T16 is a backend migration task. T17 owns the visible frontend migration, and T18 owns enabling and qualifying the Release/default Native route.

## Background and dependencies

- Parent roadmap: `(T12 model manager + T13 CPU runtime) -> T16 -> T17 -> T18`.
- T12 already provides exact `faster-whisper/large-v3` identity, readiness, download, immutable install, legacy snapshot reuse, and per-model disposition metadata through `NativeAsrModelManager`.
- T13 already provides the verified Windows x64 CPU CTranslate2 runtime artifact under the packaged `native-asr/windows-x64/cpu` resource tree, with no model weights, Python, VAD, GPU, or non-MVP engine capability.
- Existing `NativeAsrHost` and `ResolvedNativeLaunch` own worker lifecycle, protocol v1, cancellation, crash handling, recovery snapshots, ASS fallback, and the shared active-job gate.
- Current production commands and dependency/settings paths still depend on the Python sidecar, Python 3.11, and an ASR venv.

## Requirements

### R1 - Preserve the stable product command and job contracts

- Keep the existing Tauri command names: `list_asr_engines`, `start_asr`, `get_asr_progress`, `cancel_asr`, `check_asr_model`, `download_asr_model`, and `get_model_download_progress`.
- Preserve camelCase inputs, existing frontend-compatible boolean/status fields, `AsrJobSnapshot`, `includeSegments=false`, missing-job error semantics, cancellation, recovery, and the shared one-active-job limit.
- Do not add a second Native command family, frontend raw invoke path, job manager, reducer, or recovery format.

### R2 - Integrate one complete Native backend route without premature Release cutover

- Consume the T13 worker at the verified packaged resource path and T12's exact resolved large-v3 model path.
- Resolve `auto` and `cpu` to the bundled CPU route. Reject CUDA, Vulkan, unsupported engines/models, missing/corrupt runtime, missing model readiness, and unsupported VAD through controlled errors.
- A Native route failure must never start or fall back to the Python sidecar.
- Model list/status/download and inference start/progress/cancel must select Native or legacy as one coherent route; a native-only model download must never feed a legacy Python launch.
- T16 must land and test the Native branch behind one internal route-policy decision. Release/default remains legacy until T18 changes that single decision after T17 and release qualification. No persisted user route setting or Release environment override is allowed.

### R3 - Expose Native engine and per-model availability

- `list_asr_engines` must be able to report the built-in Faster-Whisper CPU engine without probing Python; known non-MVP engines remain visible as unavailable metadata.
- `check_asr_model` must map T12 dispositions as follows while retaining the current fields:
  - `ready` -> `available: true`, `downloaded: true`;
  - `supportedMissing` -> `available: true`, `downloaded: false`;
  - `postMvpUnavailable` -> `available: false`, `downloaded: false`;
  - `unsupported` -> `available: false`, `downloaded: false`.
- The response must also expose typed Native disposition, backend/revision/origin where known, and a concise unavailable reason suitable for T17.
- `download_asr_model` and `get_model_download_progress` must delegate to `NativeAsrModelManager` for the MVP model, preserve current polling fields, and return controlled errors for unavailable/unknown identities.

### R4 - Migrate runtime dependency reporting and storage

- Production runtime probe results must replace Python 3.11 and ASR venv entries with a built-in Native ASR CPU runtime entry and exact MVP model readiness.
- A valid package reports the CPU runtime as built-in/ready, unmanaged, and not downloadable or cleanable. Missing or invalid resource files report a controlled packaging/runtime failure; they never trigger Python setup.
- `probe_runtime_dependencies` remains status/path/version only and performs no recursive disk-size scan.
- `measure_runtime_dependency_storage` remains an explicit user action and reports managed FFmpeg when applicable, Native ASR models, downloads, and app cache; it must not report Python or venv storage as production dependencies.
- Native ASR model storage measurement/cleanup must cover bounded managed model data under `deps/models`, including direct CTranslate2 installs and exact legacy Hugging Face cache reuse. Download/staging data remains under the existing bounded `deps/downloads` item.
- Built-in runtime resources must never be deleted by `cleanup_runtime_dependency`.
- Probe, exact readiness hashing, recursive measurement, and recursive cleanup must keep blocking work off async workers with `spawn_blocking`; writable/elevation checks stay before managed `deps` cleanup.

### R5 - Migrate settings without destructive rewrite

- Continue accepting legacy `pythonPath` and `asrServicePath` JSON keys so old settings files deserialize.
- Ignore both values on load, do not return them as active runtime configuration, and omit them from future settings serialization.
- Loading an old settings file must not write or destructively rewrite it. The obsolete keys disappear only when the user later saves settings through the normal flow.
- Preserve `asrEngine`, `asrModel`, `asrDevice`, translation settings, shortcuts, and all unrelated settings.
- Do not silently rewrite a non-MVP/unknown ASR selection to large-v3 and do not use its legacy Python path. The backend reports the selection unavailable until T17 guides the user.

### R6 - Preserve installed/portable paths and containment

- Resolve business config/cache paths through `app_paths.rs` and managed dependencies through the executable-adjacent `deps` helpers.
- Resolve the Native worker from the same packaged `native-asr/windows-x64/cpu` resource layout used by installed and portable builds.
- Reuse T12's exact path, hash, symlink/reparse, staging, and source-profile rules. Do not accept aliases, model-name-only directories, custom URLs, or escaped paths.
- Cleanup remains constrained below approved managed roots and must not delete projects, subtitles, settings, current-video protected app cache, bundled runtime resources, or arbitrary user paths.

### R7 - Provide the minimum typed handoff for T17

- Update shared TypeScript contracts and runtime dependency labels only as needed for the changed backend payloads and a successful `pnpm build`.
- Keep current compatibility fields usable by existing components during the task boundary.
- Do not perform T17's visible UX work in T16: no removal/redesign of setup panels, model/device selector behavior, unavailable-state copy, or transcription-page presentation beyond minimal compile-safe contract handling.

### R8 - Rollback and release boundary

- Keep Python legacy source and ignored settings input fields for one release cycle as rollback/diagnostic evidence; do not package-remove them in T16.
- T16 rollback restores the legacy route-policy selection and prior dependency payloads without deleting user models, downloads, settings, projects, subtitles, or caches.
- T18 alone enables Release/default Native routing, removes packaged Python dependencies, and runs installed/portable/offline release qualification.

## Acceptance criteria

- [x] AC1: Old settings containing `pythonPath`/`asrServicePath` load successfully, expose neither as active configuration, preserve every unrelated field, are not rewritten on load, and omit both keys on the next normal serialization.
- [x] AC2: Production runtime probe returns no Python 3.11 or ASR venv items; it reports the built-in CPU runtime and exact large-v3 readiness without recursive size calculation.
- [x] AC3: Storage measurement reports no Python/venv production storage, covers bounded Native direct/legacy model roots plus downloads/app cache, preserves current-video app cache, and cannot clean the bundled CPU runtime.
- [x] AC4: Engine/model status mapping covers ready, supported-missing, post-MVP-unavailable, and unsupported cases with backward-compatible booleans and typed Native metadata.
- [x] AC5: Stable model download commands use the T12 manager, preserve polling compatibility, isolate errors, and never contact the sidecar in Native mode.
- [x] AC6: Native start resolves the T13 worker and exact T12 model path, accepts CPU/auto, rejects unsupported routes deterministically, and never silently falls back to Python.
- [x] AC7: One route-policy decision keeps model management and inference coherent; T16 tests the Native branch while Release/default remains legacy for T18 to enable.
- [x] AC8: Existing active-job, progress, cancel, crash, recovery, ASS fallback, missing-job, and shutdown contracts remain regression-free.
- [x] AC9: Installed-like and portable-like resource/dependency path tests pass without raw business use of Tauri AppData/cache APIs.
- [x] AC10: Focused Rust/frontend tests, `pnpm test`, `pnpm build`, `pnpm asr:runtime:verify`, and `cargo test --manifest-path src-tauri/Cargo.toml` pass.
- [x] AC11: `python ./.trellis/scripts/task.py validate 08-27-native-asr-runtime-settings-backend` and `git diff --check` pass; no commit, push, archive, or Release cutover occurs without separate user authorization and the later task gates.

## Out of scope

- T17 frontend removal/redesign of Python setup, engine/model/device UX, and unavailable-state presentation.
- T18 Release/default enablement, package removal of Python/sidecar resources, installed/portable end-to-end release smoke, notices, and release documentation.
- New Faster-Whisper models beyond large-v3, Kotoba, Qwen3, Parakeet, ReazonSpeech, GPU/Vulkan, or arbitrary model import.
- Worker inference, timestamp, VAD, subtitle quality, CER/parity, protocol, reducer, or recovery redesign.
- A new route setting, remote manifest, runtime downloader, duplicated runtime verifier, or new crate/dependency.
- Git commit, push, merge, rebase, archive, or remote-state changes without separate explicit user authorization.
