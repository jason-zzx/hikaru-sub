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

## Shared Qwen + Parakeet + ReazonSpeech CrispASR application dependencies

- `native-asr/runtime/crispasr-product-lock.json` enables Qwen, Parakeet and ReazonSpeech ordinary-build use. External CUDA publication remains a download-only condition, not an application release. Both
  CPU and CUDA must still pass exact runtime manifest/file closure verification;
  CUDA additionally passes the bounded model-free compute probe at resolution.
- CPU root: `resource_dir()/native-asr/windows-x64/crispasr/cpu`; managed CUDA:
  `<exe>/deps/asr-runtime/crispasr/cuda/current`. Never load CT2 files into this tree.
  Valid installed CUDA reports available even without published source rows.
  Missing/invalid CUDA reports missing and offers download only when both bundled
  `crispasrCuda` source rows and the publication flag match the locked archive.
  The published asset is `hikaru-asr-crispasr-windows-x64-cuda-shared-v3.zip` on the existing
  `native-asr-cuda-v1` dependency release: official GitHub plus the same URL prefixed
  by `https://ghfast.top/`, both verified at 719,771,622 bytes / SHA-256 `5d927f797b149521fe68bb842db17a782592a4837a7ea54cf8d9b9c47b2f76b0`. Never replace the CT2 asset,
  infer all-generation GPU qualification from PTX coverage, or disable Qwen CPU.
  Producer metadata may retain publication only for exact already-uploaded bytes;
  a changed archive remains unpublished until separately authorized and verified.
- Exact Qwen pair: `deps/models/crispasr/qwen3-asr/Qwen/Qwen3-ASR-1.7B/<pair-revision>`;
  required shared CPU Silero: `deps/models/shared/silero/vad/<vad-revision>`.
  The existing manager owns pair atomic readiness, all hashes, combined progress,
  repair and offline reuse. VAD missing/corrupt means Qwen is not ready.
- Resource preparation verifies existing archives and never resets model support
  metadata. Enabling application selection is not installer/UI/release acceptance.
- Published shared-v3 advertises `reazonspeech-nemo` on both devices and preserves the exact reviewed Q8_0 candidate bytes. The CPU/CUDA short/medium/long functional matrix, local application flows, official/China download/install/probe checks and ordinary-build gating pass. Status, download and start still require matching embedded CPU-and-CUDA engine authority plus exact model/VAD readiness. Exact shared-v2 lock, CPU archive and remote asset remain immutable rollback authority.

## Capability-gated Parakeet managed delivery

### 1. Scope / Trigger

Exact `nvidia/parakeet-tdt_ctc-0.6b-ja` uses cstr F16 GGUF at immutable revision `d9e3ba65a6579796389ea89e5939509ed257f972`, CC-BY-4.0 attribution and conversion notice. Ordinary builds now embed published shared-v3 CPU/CUDA support for Qwen, Parakeet and ReazonSpeech and permit public status/download/start when exact model readiness also passes. Remote CUDA publication remains a download-only condition, not a verified installed-use prerequisite or application release. General long-path limitations below remain open.

### 2. Signatures

- `ProductLock::supports_engine(&self, engine: &str) -> bool`
- `ResolvedNativeAsrCpuRuntime::require_engine(&self, engine: &str) -> Result<(), String>`
- `select_native_runtime(backend, engine, requested, resolve)` authorizes the selected engine before host-cache lookup or launch.
- Existing `list_asr_engines`, `check_asr_model`, `download_asr_model` and `start_asr` command contracts are unchanged.

### 3. Contracts

- `model_supported` requires both the model flag and embedded build authority: schema 1, product enablement, valid CPU **and** CUDA artifact engine membership. This check precedes readiness-cache reuse. Listing uses verified per-engine runtime capabilities; launch independently checks membership returned by exact payload verification. No runtime environment override is permitted.
- ASR installs under `deps/models/crispasr/parakeet/nvidia/parakeet-tdt_ctc-0.6b-ja/<revision>`. A logical download/readiness unit includes the identical existing shared Silero asset; combined size is 1,247,817,898 bytes. Reuse the existing stages, Range restart/resume, hash verification, atomic publication, VAD publication mutex and cleanup storage lease. Different references to the same shared VAD are a manifest error.
- There is no per-model cleanup/download-cancel API. Parakeet staging/repair must not remove shared VAD or sibling Qwen installs; the existing explicit all-model storage cleanup still owns the complete managed models root.
- Private model-backed tests may exercise managed complete-partial publication and host/ASS without overriding public support. They are not proof that the immutable Qwen-only published runtime contains Parakeet.
- The existing full-CLI packager generates a fresh `shared-*` CPU/CUDA candidate with exact ordered engines `["qwen3-asr", "parakeet", "reazonspeech-nemo"]`, complete four/seven-DLL closure and full model-source credit. Default builds embed the verified published shared-v3 authority; exact shared-v2 rollback bytes remain in `crispasr-product-lock-v2.json`, and Qwen-only rollback remains in `crispasr-product-lock-v1.json`. Absolute `HIKARU_CRISPASR_CANDIDATE_LOCK` selects an immutable candidate at build time across resource preparation, Rust embedding and portable packaging; running apps never read it or a mutable external lock. Default source rows point to shared-v3: 719,771,622 bytes, SHA-256 `5d927f797b149521fe68bb842db17a782592a4837a7ea54cf8d9b9c47b2f76b0`; both official and ghfast.top bytes were verified. Old remote assets are untouched.
- Local extracted NSIS/portable file/probe checks and real short-path portable WebView CPU/CUDA selection/start/frontend ASS save are recorded separately. Synthetic file-drop and a verified preseeded audio cache were used; this is not manual install/uninstall or a fresh model network download. No release readiness or support beyond measured hardware is inferred.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Retained Qwen-only v1 rollback + permitted Parakeet model row | Public unavailable before cache/download/start; Qwen remains supported |
| Missing/mixed device authority | Parakeet unsupported; no single-device build authorization |
| Shared authority + exact installed CPU/CUDA payload | Normal local model readiness/start, regardless of CUDA publication |
| Missing/corrupt/wrong-engine runtime | Structured failure; no explicit CUDA fallback or cached-host bypass |
| Candidate CUDA missing, old public download rows present | Missing and no candidate download offer; never download old bytes as candidate |
| Deep private CLI cwd (observed 272 characters) | Source runner uses verified/pinned CLI own-root only when private cwd reaches MAX_PATH; canonical same-volume relative audio and original private result/cache/TEMP remain unchanged. Model-free real-I/O regression passes, and the new default build contains the fix; old retained app is pre-fix. No writable ancestor/alias/cache relocation. Long/expanded-relative audio paths, deep CLI roots and cross-volume deep-work remain unsupported |

### 5. Good / Base / Bad Cases

Good: shared embedded authority, verified model+VAD and local CUDA → normal Parakeet UI start/save. Base: ordinary shared build → both engines supported, exact model+required VAD still needed; Qwen-only rollback → Parakeet unavailable. Bad: globally enabling Parakeet from Qwen readiness, or requiring remote publication for an already verified local CUDA install.

### 6. Tests Required

`build_engine_support_requires_both_devices_not_cuda_publication`, `selected_engine_is_authorized_before_host_cache_or_launch`, shared closure/capability rejection, and model-manager public/default/candidate support checks must cover both authorities. Retained complete Cargo runs are 301 passed/3 ignored per authority. Historical Parakeet UI evidence remains in its archived task; `research/local_app_publish.py --check` is not a current build or UI verification gate. For new behavior, exercise the actual current UI/device flow; a harness-only change needs no inference rerun.

### 7. Wrong vs Correct

Wrong: `verified Qwen backend -> Parakeet ready`, or `unpublished CUDA -> installed CUDA unusable`.
Correct: `embedded both-device engine support -> exact payload verification -> selected-engine authorization -> existing cached host/start`; publication controls download only.

## Anti-Patterns

- Reintroducing `%APPDATA%` / `%LOCALAPPDATA%\com.hikaru.sub` as large managed dependency roots
- Treating a model-name-only directory, framework cache, wrong revision, or escaped HF symlink as a ready Native model
- Streaming model bytes directly into the final immutable revision directory instead of verified download staging
- Using `app.path().app_cache_dir()` directly as the workspace root (missing the `cache/` child on installed builds)
- Recursive size in probe
- Portable bootstrap that sets `is_portable` before directories succeed
