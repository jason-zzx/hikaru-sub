# Paths and Runtime Dependencies

## Path Ownership: `app_paths.rs`

| Mode | Marker | Config/data | Work cache | WebView2 |
|------|--------|-------------|------------|----------|
| Portable | `<exe>/.portable` file | `<exe>/data` | `<exe>/cache` | `<exe>/webview` (`WEBVIEW2_USER_DATA_FOLDER`) |
| Installed / `tauri dev` | no marker | system AppData via Tauri path APIs | `app_cache_dir()/cache` | default |

Rules encoded in code:

- Call `bootstrap_portable_paths()` before WebView creation (`lib.rs`). Failure → fatal dialog + exit; **do not** lock `is_portable()` true on failed bootstrap.
- Business code uses `app_config_dir` / `app_data_dir` / `work_cache_dir` from `app_paths`, not raw `app.path().app_*` for those roots.
- No migration from old AppData layouts.
- Do not rewrite `APPDATA` / `LOCALAPPDATA` to work around `tauri-plugin-persisted-scope` (tiny scope files in system AppData on portable are accepted).

Work cache children of interest: `workspace/`, `transcode/`, `preview/`, `clip-frames/` (and similar). App-cache measure/cleanup targets these under `work_cache_dir`, preserving caches tied to the current working video. Legacy same-named dirs directly under `com.hikaru.sub\` root are **out of scope**.

## Managed Dependencies Layout

Release packages bundle the verified Native ASR CPU runtime and do **not** bundle FFmpeg, a Python sidecar/runtime/venv/packages, or model weights. Resource preparation deletes any stale packaged legacy sidecar before NSIS/portable staging.

Typical production install-dir layout (see `/AGENTS.md`):

- `deps/ffmpeg/current` — managed FFmpeg
- `deps/models/huggingface` — exact legacy Hugging Face snapshot reuse after full validation
- `deps/models/ctranslate2/<engine>/<model>/<revision>` — immutable direct Native ASR CT2 installs
- `deps/downloads/native-asr-models/<engine>/<model>/<revision>` — Native ASR `.part`, staging, and repair data
- `deps/downloads` — other temporary archives

Old `deps/python311` / `deps/asr-service` directories may remain from prior releases but are not production dependency probe, measure, cleanup, or route inputs. Cutover and rollback never delete them automatically.

Native model manifest segments must reject traversal, Windows reserved device names, trailing-dot/space aliases, and ASCII case collisions before joining paths. Direct required files reject symlinks/reparse points; legacy HF symlinks are allowed only when the snapshot and canonical file target stay below the canonical managed Hugging Face root.

Download sources: `src-tauri/resources/runtime-dependency-sources.json`. UI chooses official vs China mirror (default official). Legacy `auto`/`custom` migrate silently to official. Native model URLs derive from the selected profile and exact bundled manifest; the China profile uses `https://hf-mirror.com`. Historical Python source rows remain rollback metadata only.

## Probe / Prepare / Cleanup UX Contract

Settings entry: **probe only**. Storage sizes: user-triggered measure. Cleanup buttons: only when measured size > 0 and the target is managed.

## Scenario: Native MVP Runtime Dependency Payload (T16)

### 1. Scope / Trigger

Apply when changing `RuntimeDependencyKind`, production dependency probe/storage payloads, Native model storage cleanup, or the bundled CPU runtime status exposed to Settings.

### 2. Signatures

```rust
enum RuntimeDependencyKind {
    Ffmpeg,
    NativeAsrCpu,
    Python311, // accepted legacy input; not emitted by T16 production probe/measure
    AsrVenv,   // accepted legacy input; not emitted by T16 production probe/measure
    AsrModels,
    Downloads,
    AppCache,
}

#[tauri::command]
async fn probe_runtime_dependencies(app: AppHandle, asr_state: State<'_, AsrState>)
    -> Result<RuntimeDependencyProbe, String>;
```

### 3. Contracts

- Production probe emits FFmpeg, `nativeAsrCpu`, and exact `faster-whisper/large-v3` readiness. It emits no Python 3.11 or ASR venv item.
- `nativeAsrCpu` resolves from `resource_dir()/native-asr/windows-x64/cpu`, reports `source: "builtIn"`, `managed: false`, and the locked artifact ID. It is never downloadable or cleanable.
- Exact model readiness comes from the process-owned `NativeAsrModelManager`; do not duplicate size/hash/path validation in `dependencies.rs`.
- Probe remains status/path/version only. Runtime reads and model hashing use `spawn_blocking`; probe never calls recursive `dir_size`.
- Explicit storage measurement emits managed FFmpeg when applicable, bounded `deps/models`, `deps/downloads`, and application work cache. It emits no Python/venv or bundled-runtime storage item.
- `asrModels` cleanup targets only executable-adjacent `deps/models`; `downloads` remains `deps/downloads`; app-cache cleanup preserves current-video workspace/proxy data.
- Legacy Python/venv enum variants may remain temporarily for rollback compatibility, but production payloads do not offer them.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Valid locked Native runtime resource | `nativeAsrCpu: available`, unmanaged |
| Missing/wrong runtime identity/capability/required entry | `nativeAsrCpu: missing`; controlled runtime error on Native start |
| Exact large-v3 direct or contained legacy snapshot | `asrModels: available` with exact path/revision |
| Missing/wrong model bytes | `asrModels: missing`; no model-name-only readiness |
| Cleanup `nativeAsrCpu` | Reject before deletion |
| Cleanup target outside canonical `deps` | Reject |
| Symlink/reparse entry during recursive measurement | Do not follow/count it |

### 5. Good / Base / Bad Cases

- Good: Settings probe shows built-in CPU runtime and exact model state; storage size appears only after explicit measure.
- Base: model is missing -> runtime stays built-in/ready and the model item is missing/downloadable through the model manager.
- Bad: report Python/venv as required production dependencies, include recursive size in probe, or delete packaged runtime resources through dependency cleanup.

### 6. Tests Required

- Installed-like and portable-like resource roots resolve the same locked runtime layout.
- Missing/wrong artifact identity or capability fails.
- Probe output contains no Python/venv kinds and no recursive size path.
- Model dependency item maps exact ready/missing state and source.
- Measure/cleanup cover only bounded models/downloads/app cache and preserve current-video cache.
- Full Cargo tests plus frontend runtime-kind label test/build.

### 7. Wrong vs Correct

```text
Wrong:   dir_nonempty(deps/models) -> model ready
Correct: NativeAsrModelManager exact readiness -> model dependency status

Wrong:   include bundled native-asr resources in managed storage/cleanup
Correct: report builtIn unmanaged runtime -> reject cleanup
```

## Anti-Patterns

- Reintroducing `%APPDATA%` / `%LOCALAPPDATA%\com.hikaru.sub` as large managed dependency roots
- Treating a model-name-only directory, framework cache, wrong revision, or escaped HF symlink as a ready Native model
- Streaming model bytes directly into the final immutable revision directory instead of verified download staging
- Using `app.path().app_cache_dir()` directly as the workspace root (missing the `cache/` child on installed builds)
- Recursive size in probe
- Portable bootstrap that sets `is_portable` before directories succeed
