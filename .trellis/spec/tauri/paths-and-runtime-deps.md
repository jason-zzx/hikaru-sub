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

Current packaging bundles independently verified CT2 and CrispASR Native ASR CPU runtimes and does **not** bundle CUDA packs, FFmpeg, a Python sidecar/runtime/venv/packages, or model weights. Resource preparation deletes any stale packaged legacy sidecar before NSIS/portable staging.

Typical production install-dir layout (see `/AGENTS.md`):

- `deps/ffmpeg/current` — managed FFmpeg
- `deps/models/huggingface` — exact legacy Hugging Face snapshot reuse after full validation
- `deps/models/ctranslate2/<engine>/<model-id-segments>/<revision>` — immutable direct Native ASR CT2 installs; ordinary model IDs use one segment, exact repository-style IDs such as Kotoba use validated `owner/name` segments
- `deps/downloads/native-asr-models/<engine>/<model-id-segments>/<revision>` — Native ASR `.part`, staging, and repair data
- `deps/downloads` — other temporary archives

Old `deps/python311` / `deps/asr-service` directories may remain from prior releases but are not production dependency probe, measure, cleanup, or route inputs. Cutover and rollback never delete them automatically.

Native model manifest IDs must reject traversal, absolute/drive paths, backslashes, extra separators, Windows reserved device names, trailing-dot/space aliases, and ASCII case collisions before joining paths. A model ID is either one safe segment or exactly one safe `owner/name`; each repository-style segment is validated independently before the existing contained path builder runs. Direct required files reject symlinks/reparse points; legacy HF symlinks are allowed only when the snapshot and canonical file target stay below the canonical managed Hugging Face root. Concurrent model jobs may race while creating shared parent directories: accept only `AlreadyExists`, immediately re-read with `symlink_metadata`, and reject link/reparse-like or non-directory entries before descending.

Download sources: `src-tauri/resources/runtime-dependency-sources.json`. UI chooses official vs China mirror (default official). Legacy `auto`/`custom` migrate silently to official. Native model URLs derive from the selected profile and exact bundled manifest; the China profile uses `https://hf-mirror.com`. Historical Python source rows remain rollback metadata only.

## Probe / Prepare / Cleanup UX Contract

Settings entry: **probe only**. Storage sizes: user-triggered measure. Cleanup buttons: only when measured size > 0 and the target is managed.

Dependency probes still perform exact runtime/model hashes; `spawn_blocking` does not make unoptimized SHA256 cheap. Keep `[profile.dev.package.sha2] opt-level = 3` in `src-tauri/Cargo.toml` so debug/dev probes do not spend minutes hashing weights. This changes neither release settings nor hash/path/device checks. Engine listing reuses both results from one `crispasr::items` call instead of hashing its CPU payload again for CUDA capability.

Manual, read-only regression profiles (ignored in ordinary Cargo tests): `dependency_hash_throughput` checks a fixed 32 MiB fixture; `dependency_probe_profile` profiles actual default-model cold/cached readiness and runtime/CUDA probes. Set test-only `HIKARU_PROFILE_RESOURCES` to the resource directory and `HIKARU_PROFILE_DEPS` to executable-adjacent `deps`, then run `cargo test --manifest-path src-tauri/Cargo.toml dependency_probe_profile -- --ignored --nocapture --test-threads=1`. These inputs never affect production resolution. Compare unoptimized hashing with `--config profile.dev.package.sha2.opt-level=0`; do not run competing profiles concurrently or substitute size-only readiness to improve timings.

## Scenario: Native CPU Runtime Dependency Payload

### 1. Scope / Trigger

The original CT2 CPU payload below applies to `nativeAsrCpu`, not every current dependency kind. Apply its storage/probe safety when changing Native dependencies; current CUDA and independent `crispasrCpu`/`crispasrCuda` kinds retain their own roots and authority as described below.

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

- Production probe emits FFmpeg, `nativeAsrCpu`, and exact `faster-whisper/large-v3` readiness as the default-model dependency summary. Per-model availability for the original eight CT2 identities and exact Qwen pair + required VAD remains owned by `check_asr_model` / `NativeAsrModelManager`; the probe is not a second support registry. It emits no Python 3.11 or ASR venv item.
- `nativeAsrCpu` resolves from `resource_dir()/native-asr/windows-x64/cpu`, requires artifact `hikaru-asr-windows-x64-cpu-v3` with exact ordered engines `["faster-whisper", "kotoba-faster-whisper"]`, reports `source: "builtIn"`, `managed: false`, and is never downloadable or cleanable.
- Exact model readiness comes from the process-owned `NativeAsrModelManager`; do not duplicate size/hash/path validation in `dependencies.rs`.
- Probe remains status/path/version only. Runtime reads and model hashing use `spawn_blocking`; probe never calls recursive `dir_size`.
- Explicit storage measurement emits managed FFmpeg when applicable, bounded `deps/models`, `deps/downloads`, and application work cache. It emits no Python/venv or bundled-runtime storage item.
- `asrModels` cleanup targets only executable-adjacent `deps/models`; `downloads` remains `deps/downloads`; app-cache cleanup preserves current-video workspace/proxy data.
- Legacy Python/venv enum variants may remain temporarily for rollback compatibility, but production payloads do not offer them.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Valid locked Native runtime resource | `nativeAsrCpu: available`, unmanaged |
| Missing/wrong runtime v3 identity, engine order/capability, or required entry | `nativeAsrCpu: missing`; controlled runtime error on Native start |
| Exact default large-v3 direct or contained legacy snapshot | `asrModels: available` with exact path/revision; other model statuses stay in the model manager |
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
- Default large-v3 dependency item maps exact ready/missing state and source without duplicating the eight-entry support registry; runtime tests reject Faster-Whisper-only, extra-engine, and wrong-order capability lists.
- Measure/cleanup cover only bounded models/downloads/app cache and preserve current-video cache.
- Full Cargo tests plus frontend runtime-kind label test/build.

### 7. Wrong vs Correct

```text
Wrong:   dir_nonempty(deps/models) -> model ready
Correct: NativeAsrModelManager exact readiness -> model dependency status

Wrong:   include bundled native-asr resources in managed storage/cleanup
Correct: report builtIn unmanaged runtime -> reject cleanup
```

## Qwen CrispASR application dependencies

- `native-asr/runtime/crispasr-product-lock.json` enables Qwen application use while
  external CUDA publication remains a separate download-only condition. Both
  CPU and CUDA must still pass exact runtime manifest/file closure verification;
  CUDA additionally passes the bounded model-free compute probe at resolution.
- CPU root: `resource_dir()/native-asr/windows-x64/crispasr/cpu`; managed CUDA:
  `<exe>/deps/asr-runtime/crispasr/cuda/current`. Never load CT2 files into this tree.
  Valid installed CUDA reports available even without published source rows.
  Missing/invalid CUDA reports missing and offers download only when both bundled
  `crispasrCuda` source rows and the publication flag match the locked archive.
  The published asset is `hikaru-asr-crispasr-windows-x64-cuda-v1.zip` on the existing
  `native-asr-cuda-v1` dependency release: official GitHub plus the same URL prefixed
  by `https://ghfast.top/`, both with identical size/SHA. Never replace the CT2 asset,
  infer all-generation GPU qualification from PTX coverage, or disable Qwen CPU.
  Producer metadata may retain publication only for exact already-uploaded bytes;
  a changed archive remains unpublished until separately authorized and verified.
- Exact Qwen pair: `deps/models/crispasr/qwen3-asr/Qwen/Qwen3-ASR-1.7B/<pair-revision>`;
  required shared CPU Silero: `deps/models/shared/silero/vad/<vad-revision>`.
  The existing manager owns pair atomic readiness, all hashes, combined progress,
  repair and offline reuse. VAD missing/corrupt means Qwen is not ready.
- Resource preparation verifies existing archives and never resets model support
  metadata. Enabling application selection is not installer/UI/release acceptance.

## Anti-Patterns

- Reintroducing `%APPDATA%` / `%LOCALAPPDATA%\com.hikaru.sub` as large managed dependency roots
- Treating a model-name-only directory, framework cache, wrong revision, or escaped HF symlink as a ready Native model
- Streaming model bytes directly into the final immutable revision directory instead of verified download staging
- Using `app.path().app_cache_dir()` directly as the workspace root (missing the `cache/` child on installed builds)
- Recursive size in probe
- Portable bootstrap that sets `is_portable` before directories succeed
