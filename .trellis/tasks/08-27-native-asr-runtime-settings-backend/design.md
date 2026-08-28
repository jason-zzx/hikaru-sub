# T16 technical design

## Design summary

T16 adds no new product command family and no new runtime architecture. It connects three existing seams:

```text
T13 packaged CPU runtime              T12 NativeAsrModelManager
  worker + runtime manifest             status / download / exact path
              \                           /
               \                         /
                v                       v
                 T16 native backend resolver
                  - one route policy
                  - stable Tauri commands
                  - runtime/settings payloads
                           |
                           v
                existing NativeAsrHost
              protocol / jobs / recovery
```

T16 implements and tests the complete Native backend branch but leaves the Release/default route-policy selection on legacy. T17 consumes the new metadata and removes the legacy UX. T18 changes the single Release/default policy decision and performs final package qualification.

## Reused seams

- `NativeAsrModelManager`: exact manifest, readiness, download, job polling, and resolved model path.
- `NativeAsrHost` + `ResolvedNativeLaunch`: process lifecycle, protocol, progress, cancellation, recovery, and fallback ASS.
- `AsrState`: shared active-job gate and one owner for legacy/native state.
- `dependencies.rs`: executable-adjacent `deps`, source profile, writable/elevation checks, storage measurement, cleanup containment, and work cache.
- `settings.rs`: existing `get_settings` / `set_settings` persistence boundary.
- Existing Tauri command names and `src/services/tauri.ts` wrappers.
- T13 JavaScript verifier and resource preparation; Rust does not recreate its closed-world package verifier.

No new crate, daemon, persisted setting, remote registry, trait/factory, or frontend state store is needed.

## Architecture boundaries

### Route policy

Introduce one small internal route-policy value owned by `AsrState` or the command module:

```rust
enum AsrRoutePolicy {
    Legacy,
    NativeMvp,
}
```

The exact representation may be a boolean/enum, but there must be one decision point. It controls the command families as a unit:

| Command family | `Legacy` | `NativeMvp` |
|---|---|---|
| engine list | sidecar | built-in Native metadata |
| model status/download/progress | sidecar | `NativeAsrModelManager` |
| start/progress/cancel | sidecar/native-debug compatibility | T13 worker + T12 model + existing host |

T16 tests `NativeMvp`. The normal Release/default constructor remains `Legacy`; T18 changes only this production selection after the frontend and release gates pass. Debug/test injection may construct Native mode, but Release must not read a user path, environment switch, or persisted route setting.

This single decision prevents the forbidden mixed state: Native direct download plus Python sidecar launch.

### Native runtime resolution

The runtime root is derived from Tauri's resource directory and the T13 locked layout:

```text
<resource_dir>/native-asr/windows-x64/cpu/
  hikaru-asr-worker.exe
  runtime-manifest.json
  SHA256SUMS
  ...DLLs/licenses...
```

A small helper resolves:

- runtime directory;
- worker path;
- artifact/runtime identity for probe display;
- the controlled error when required entry files are missing or the manifest identity/capability does not match the T13 MVP contract.

Rust checks only the fields needed to consume the packaged runtime: schema/artifact/platform/arch/protocol/capability and worker presence. Full file closure/hash/license verification remains the existing T13 build/package verifier and is rerun by T18. `NativeAsrHost::new` retains canonical existing-file validation.

Valid packaged runtime is reported as:

```text
kind: nativeAsrCpu
status: available
source: builtIn
managed: false
path: <runtime root>
version: hikaru-asr-windows-x64-cpu-v1
```

A missing/invalid runtime reports a controlled non-ready state/error. It has no prepare or cleanup action and never triggers Python discovery.

### Native model status contract

Keep current compatibility fields and append Native metadata:

```ts
type NativeAsrModelDisposition =
  | "supportedMissing"
  | "ready"
  | "postMvpUnavailable"
  | "unsupported";

interface AsrModelStatus {
  engine: string;
  model: string;
  available: boolean;
  downloaded: boolean;
  disposition: NativeAsrModelDisposition;
  backend?: string | null;
  revision?: string | null;
  origin?: "directInstall" | "legacyHuggingFaceSnapshot" | null;
  reason?: string | null;
}
```

Mapping is centralized in one pure Rust DTO conversion:

| T12 disposition | `available` | `downloaded` | reason |
|---|---:|---:|---|
| ready | true | true | null |
| supportedMissing | true | false | model download required |
| postMvpUnavailable | false | false | later support |
| unsupported | false | false | unsupported identity |

`available` continues to mean the selected engine/model route may be used or downloaded, not merely that some engine binary exists.

### Engine list contract

`list_asr_engines` keeps its current wrapper shape:

```json
{ "engines": [{ "name": "faster-whisper", "available": true }] }
```

Native mode derives the known engine list from the T12 model catalog/known deferred identities rather than starting the sidecar. Faster-Whisper is available because the bundled CPU runtime supports it. Other known engines are returned as unavailable with an optional reason for T17. Unknown engine IDs are handled by model status as unsupported.

### Model download contract

Native mode delegates directly:

```text
download_asr_model
  -> NativeAsrModelManager.start_download

get_model_download_progress
  -> NativeAsrModelManager.job_snapshot
  -> public compatibility DTO
```

The public DTO retains current polling fields used by `ModelManager`:

- `id`, `status`, `progress`, `downloadedBytes`, `totalBytes`, `error`;
- T12 `sourceEndpoint` maps to the existing `hfEndpoint` compatibility field;
- optional `revision` and `resolvedPath` may be added for diagnostics/T17;
- no full response body, header, secret, or private path is logged.

Unknown job IDs keep the current `下载任务不存在` error. Only the manifest-enabled large-v3 route can start a T16 Native download.

### Native start flow

```text
start_asr(args)
  -> validate output ASS path
  -> reserve shared active slot
  -> require NativeMvp route
  -> validate engine/model/device
  -> resolve T13 worker
  -> await T12 resolve_ready_model(engine, model)
  -> if absent: controlled missing/unavailable error; release reservation
  -> resolve work cache
  -> ResolvedNativeLaunch::resolve(
       generated job id,
       engine,
       [("model", exact path)],
       "cpu",
       language or "ja",
       audio path,
       output ASS path,
       work cache,
       useVad,
       vadConfig,
     )
  -> NativeAsrHost.start(launch, reservation)
```

`auto` and `cpu` resolve to `cpu`. `cuda`, `vulkan`, non-MVP engines/models, missing runtime/model, and unsupported VAD produce explicit failures. Native mode never calls `ensure_base_url` after one of these failures.

Existing `get_asr_progress` and `cancel_asr` already check the Native host first and preserve legacy jobs. T16 changes only host initialization/resolution needed for the packaged worker; it does not alter the reducer or persistence ordering.

### Host lifetime

`AsrState::default` currently lacks `AppHandle`, so production worker resolution should be lazy on the first Native command or initialized in the existing Tauri setup hook. Prefer the smaller change that preserves:

- one `NativeAsrHost` instance per process;
- the existing shared `ActiveJobGate`;
- idempotent `shutdown()`;
- debug fake-worker tests;
- no worker spawn during runtime probe.

A standard-library one-time cell/mutex is sufficient; no factory or dependency-injection framework is needed. Tests may construct state/policy with the existing fake worker and temporary managed paths.

## Settings migration

Keep the Rust fields temporarily for backward-compatible input, but make them inactive:

```rust
#[serde(default, skip_serializing)]
python_path: Option<String>,
#[serde(default, skip_serializing)]
asr_service_path: Option<String>,
```

Parsing/sanitization clears both values unconditionally before returning runtime settings. Saving omits the keys. `load_settings` does not call `save_settings`, so old files are not rewritten merely by opening the app.

T16 leaves the optional TypeScript fields temporarily so the still-present T17 UI compiles; `get_settings` normally returns them absent. T17 removes the visible setup flow and may remove the fields from TypeScript after all callers are gone.

Do not normalize `asrEngine`, `asrModel`, or `asrDevice` to the MVP defaults during migration. Their values remain user data and are interpreted by the new availability contract.

## Runtime dependency migration

### Kinds

Add `nativeAsrCpu`. Keep legacy `python311` / `asrVenv` enum variants temporarily as accepted command/input values while T17 UI still exists, but stop emitting them from production probe and storage results.

### Probe

Native production probe items:

1. FFmpeg — existing resolution/version behavior.
2. Native ASR CPU runtime — built-in resource identity, unmanaged.
3. ASR models — exact large-v3 readiness/path from `NativeAsrModelManager`.

The model item path is the managed models root or exact resolved model path; status is exact readiness. Probe never calls `dir_size`. Runtime manifest reads and model hash verification run off the async worker.

### Measure

User-triggered storage items:

1. managed FFmpeg when applicable;
2. ASR models at bounded `deps/models` (direct CT2 + managed legacy HF cache);
3. `deps/downloads` (including Native model `.part`/staging);
4. application work cache with current-video preservation.

No Python or venv item is emitted. The built-in runtime is omitted because it is part of application resources and not user-managed storage.

### Cleanup

- `asrModels` removes only the bounded managed models root after existing writable/elevation and containment checks.
- `downloads` and `appCache` keep existing boundaries; app cache keeps current-video preservation.
- `nativeAsrCpu` is rejected as non-cleanable.
- Legacy enum variants may keep their old internal cleanup implementation only for rollback compatibility, but the production probe/storage contract no longer offers them.
- Recursive deletion stays inside `spawn_blocking`; no symlink/reparse escape is accepted.

## Frontend handoff boundary

T16 performs only compile-safe bridge changes:

- add `nativeAsrCpu` to `RuntimeDependencyKind` and `RUNTIME_DEPENDENCY_LABEL`;
- extend `AsrEngineInfo`/`AsrModelStatus` with optional typed Native metadata while retaining current fields;
- retain existing wrapper names in `src/services/tauri.ts`;
- update focused constant/type tests.

T16 does not remove `AsrEngineSetupPanel`, redesign `ModelManager`, change selector copy, or implement the final unavailable UX. Those are T17 deliverables.

## Expected files

Minimum likely product files:

- `src-tauri/src/settings.rs`
- `src-tauri/src/dependencies.rs`
- `src-tauri/src/asr_models.rs` (only if a small known-catalog helper is needed)
- `src-tauri/src/asr.rs`
- `src/types/index.ts`
- `src/constants/runtimeDependencies.ts`
- focused existing test files

`src/services/tauri.ts` should change only if payload typing/comments require it; command names and wrappers remain stable. No new module is required unless the existing files cannot share the runtime-path helper without a circular dependency.

## Compatibility and rollout

### T16

- Implement/test the Native backend branch and new payloads.
- Keep Release/default route policy on legacy.
- Stop production runtime/settings reporting from requiring Python/venv.
- Keep legacy source/resources and compile-safe frontend callers.

### T17

- Consume disposition/reason metadata.
- Remove production Python setup UI and obsolete user controls.
- Present large-v3 and deferred models correctly.

### T18

- Flip the one Release/default route policy to Native MVP.
- Remove packaged Python/sidecar dependencies.
- Reverify T13 artifact and run installed/portable/offline short + long integration gates.

## Testing strategy

### Settings

- legacy keys deserialize but clear in memory;
- serialization omits obsolete keys;
- unrelated settings round-trip unchanged;
- load-only behavior does not write the file.

### Runtime dependencies

- probe emits FFmpeg/native CPU/model only, with no Python/venv;
- built-in runtime resolves installed-like and portable-like layouts and rejects missing/wrong identity;
- probe contains no recursive size call;
- measure includes bounded models/downloads/app cache and excludes Python/venv/runtime resources;
- cleanup rejects built-in runtime and cannot escape `deps` or protected app cache.

### Model commands

- all T12 dispositions map to compatibility booleans and metadata;
- Native engine list does not call the sidecar;
- download/progress delegate to one manager and preserve not-found/error behavior;
- model errors remain isolated and sanitized.

### Native start and route coherence

- CPU/auto with exact resolved model builds the expected `ResolvedNativeLaunch`;
- unsupported device/engine/model, missing runtime/model, and VAD-not-built fail without sidecar fallback;
- one policy selects both model commands and start routing;
- fake-worker lifecycle regressions cover progress/cancel/crash/recovery/slot release;
- Release build remains legacy until T18.

### Validation commands

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml settings::tests
cargo test --manifest-path src-tauri/Cargo.toml dependencies::tests
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests
cargo test --manifest-path src-tauri/Cargo.toml asr::tests
pnpm test
pnpm build
pnpm asr:runtime:verify
cargo test --manifest-path src-tauri/Cargo.toml
python ./.trellis/scripts/task.py validate 08-27-native-asr-runtime-settings-backend
git diff --check
```

## Rollback

- Set the single route policy back to legacy and restore the previous probe/storage payloads.
- Keep reading ignored legacy settings keys; do not restore them as active paths unless the whole migration is intentionally reverted.
- Do not delete direct/legacy model data, download partials, user settings, projects, subtitles, or caches during rollback.
- Leave the T12 manager and T13 bundled runtime artifact intact; they are independently accepted inputs.

## Decisions

- **D1:** Reuse stable commands; no parallel Native IPC family.
- **D2:** One route-policy decision switches model management and inference together; T18 owns Release enablement.
- **D3:** Reuse T13 verification tooling; Rust performs only consumption-time identity/entry checks.
- **D4:** Keep compatibility booleans and add disposition metadata rather than breaking current frontend callers.
- **D5:** Accept obsolete Python path keys as ignored input and omit them on future save; never rewrite settings on load.
- **D6:** Keep legacy dependency variants temporarily but stop emitting them from production probe/measure.
- **D7:** Built-in runtime is not user-managed and cannot be downloaded or cleaned.
- **D8:** No new dependency, route setting, registry, worker, reducer, or job state owner.
