# T16 planning evidence

## Roadmap authority

- The parent Native ASR migration fixes the MVP route as Windows x64, `faster-whisper / large-v3 / CTranslate2 / CPU`, with T16 after T12 + T13, T17 after T16, and T18 owning final Release/default cutover.
- Parent requirements replace production Python/venv dependency reporting with a built-in CPU runtime, the MVP model, downloads, and app cache. Legacy `pythonPath` and `asrServicePath` must be ignored without silently choosing Python.
- T12 and T13 are complete inputs. T16 must consume them; it must not rebuild a downloader, worker, runtime verifier, job reducer, or recovery format.

## T12 model-manager handoff

- `src-tauri/src/asr_models.rs` already owns the bundled schema-v1 model manifest, exact direct/legacy readiness, official/China source routing, resumable downloads, atomic publication, process-lifetime job snapshots, and managed paths.
- The frozen MVP identity is `faster-whisper/large-v3`, repository `Systran/faster-whisper-large-v3`, revision `edaa852ec7e145841d8ffdb056a99866b5f0a478`.
- `NativeAsrModelStatus` distinguishes `supportedMissing`, `ready`, `postMvpUnavailable`, and `unsupported`; `POST_MVP_MODELS` already records the known deferred model identities.
- `ResolvedNativeAsrModel.path` is the exact model directory T16 must pass into the existing `ResolvedNativeLaunch` seam.
- `AsrState.native_models` already owns one `NativeAsrModelManager`; public model commands in `src-tauri/src/asr.rs` still proxy the Python sidecar.

## T13 runtime handoff

- `native-asr/runtime/windows-x64-cpu-lock.json` freezes artifact `hikaru-asr-windows-x64-cpu-v1`, root `windows-x64/cpu/`, protocol v1, CPU CTranslate2, ordinary Faster-Whisper only, no VAD/GPU/CrispASR, and zero bundled model weights.
- `scripts/prepare-asr-resource.mjs` verifies/extracts the tracked ZIP into `src-tauri/resources/native-asr/windows-x64/cpu/`; installed and portable packaging already consume the same generated `native-asr` resource tree.
- The worker entry is `hikaru-asr-worker.exe`; the runtime directory contains `runtime-manifest.json` and `SHA256SUMS` already verified by the T13 tooling.
- T16 should resolve and consume the verified resource. It should not duplicate the JavaScript closed-world verifier in Rust. T18 re-runs release/package verification before shipping.

## Current backend state

- `src-tauri/src/asr.rs` keeps Release/default on the Python HTTP sidecar. `list_asr_engines`, `check_asr_model`, `download_asr_model`, and `get_model_download_progress` all require `ensure_base_url`; `start_asr` uses Native only for the debug fake-worker override.
- `NativeAsrHost`, `ResolvedNativeLaunch`, the shared active-job gate, cancellation, crash handling, terminal arbitration, recovery snapshots, and ASS fallback already exist in `src-tauri/src/asr_worker.rs`.
- The stable Tauri command names and `AsrJobSnapshot` shape are already consumed throughout React and must remain unchanged.
- A safe T16/T18 boundary needs one route-policy decision for model management and inference. Native model download must never be paired with legacy Python launch, and a Native launch failure must never silently fall back to Python.

## Current settings state

- `src-tauri/src/settings.rs::AppSettings` still deserializes and serializes `pythonPath` and `asrServicePath`.
- Runtime sanitization currently checks, preserves, or clears those filesystem paths depending on development/package context.
- The least destructive migration is to continue accepting the legacy JSON keys as ignored input, return `None` in memory, omit them from serialization, and avoid writing the settings file merely because it was loaded.
- Existing `asrEngine`, `asrModel`, and `asrDevice` values should be preserved. Non-MVP or unsupported choices become explicit unavailable states; they are not auto-rewritten to large-v3 and never trigger Python fallback.

## Current runtime-dependency state

- `RuntimeDependencyKind` currently exposes `ffmpeg`, `python311`, `asrVenv`, `asrModels`, `downloads`, and `appCache`.
- `probe_runtime_dependencies` reports FFmpeg, Python, the ASR venv, and the old Hugging Face model-cache root. `measure_runtime_dependency_storage` includes Python and venv storage. `cleanup_runtime_dependency` can delete only bounded managed targets.
- Probe, measure, and cleanup are already async and use `spawn_blocking` around blocking work. Probe has no recursive `dir_size`; storage measurement is user-triggered.
- Native direct models live under `deps/models/ctranslate2`, exact legacy reuse under `deps/models/huggingface`, and Native download/staging data under `deps/downloads/native-asr-models`. T16 model storage must account for both managed model roots without weakening containment.
- The bundled CPU runtime is an application resource, not a user-managed dependency: valid packages report it ready, it has no download/cleanup action, and a missing/corrupt worker is a packaging/runtime error rather than a Python fallback trigger.

## Current frontend contract relevant to T16

- `AsrModelStatus` currently contains only `{ engine, model, available, downloaded }`; `ModelManager` relies on those booleans and the existing download snapshot fields.
- `RuntimeDependencyKind` and `RUNTIME_DEPENDENCY_LABEL` must know any new backend-emitted kind or the current generic runtime panel cannot render safely.
- T17 owns the visible UX migration: removing Python setup controls, explaining deferred models, constraining device/model selection, and presenting Native availability. T16 should make only the minimum TypeScript/label additions needed to keep the typed bridge and build valid.

## Planning conclusions

1. Reuse existing stable commands; do not add a parallel Native command family.
2. Add one small native-route policy seam so T16 can implement/test the complete backend and T18 can enable Release/default in one place.
3. Keep the public boolean model fields for compatibility and add typed Native disposition metadata for T17.
4. Keep legacy dependency enum variants accepted temporarily if needed by the still-present T17 UI, but stop emitting Python/venv items from production probe and measure results.
5. Add a built-in CPU runtime dependency kind, exact large-v3 readiness through T12, and model storage rooted at the bounded managed models directory.
6. Do not add crates, persisted route settings, a second runtime verifier, or a second job manager.
