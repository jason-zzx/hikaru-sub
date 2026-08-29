# Media, FFmpeg, and ASR

## FFmpeg Resolve Order

`ffmpeg::resolve_ffmpeg` / `resolve_ffprobe`:

1. User settings path  
2. System `PATH`  
3. Managed install under `deps/ffmpeg/current`

Frontend caches status via `checkFfmpeg` / invalidation events; backend remains source of truth for resolution.

## Media Playback

- Editor playback: `register_media_playback` → local HTTP server (`media_server.rs`) with Range/seek support.
- Unsupported codecs (HEVC/VP9/AV1, etc.): FFmpeg proxy to 480p H.264 under work cache `transcode/*.mp4`.
- Do not restore Tauri `asset://` as the primary editor video path.

## Audio Decode Timeline Contract (waveform / ASR)

### Scope / Trigger

HLS-merged media (m3u8 downloads) can carry AAC streams whose timestamp span exceeds the decoded frame total — silent inter-segment gaps. Verified on real material: 4144.256s nominal vs 4108.224s decoded, **zero decode warnings**. Plain sequential decode squeezes the gaps out, so anything mapped onto the playback timeline (waveform buckets, ASR timestamps) drifts late linearly (~36s at the tail of a 69-min file).

### Signatures

```rust
#[tauri::command]
async fn extract_waveform(video_path: String, samples: usize) -> Result<WaveformData, String>

#[serde(rename_all = "camelCase")]
struct WaveformData { peaks: Vec<f32>, covered_ms: u64 } // peaks 0..1, quantized to 0.001
```

`covered_ms` = decoded PCM sample count / 16 (16 kHz mono).

### Contracts

- Every ffmpeg audio decode whose output maps onto the playback timeline (waveform, ASR `audio.wav`) **must** include `-af aresample=async=1:first_pts=0` — const `ARESAMPLE_SYNC_FILTER`, referenced by `waveform_decode_args` / `audio_decode_args` in `ffmpeg.rs`. The filter inserts silence at timestamp gaps and anchors the first sample to t=0.
- Frontend draws the waveform with `peaks.length / coveredMs`, **never** `<video>.duration` (container duration is not the decoded coverage).
- Bucketing uses even boundaries `[i*len/samples, (i+1)*len/samples)` — a fixed `len/samples` chunk size drops the tail remainder and reintroduces drift at high sample counts.

### Validation & Error Matrix

- Audio shorter than bucket count → sparse samples land in their time-correct buckets, rest 0.0
- `covered_ms == 0` → frontend skips drawing (no division by zero)

### Good/Base/Bad Cases

- Good: HLS-merged mp4 → PCM length equals the container audio span; waveform aligned at the tail.
- Base: clean local file → filter is a no-op, output identical to plain decode.
- Bad (regression): dropping the filter or mapping by `video.duration` → linear drift on gap-carrying media; renaming `coveredMs` breaks the camelCase IPC contract silently.

### Tests Required

- Rust: `waveform_decode_args` / `audio_decode_args` contain `ARESAMPLE_SYNC_FILTER`; `downsample_waveform_peaks` pulse-localization test (impulse at 90% lands in bucket ≈ 0.9·samples, no cumulative drift) and tail-retention test on non-divisible lengths.
- Frontend: Timeline mapping test with `coveredMs != durationMs` asserting pixel position follows `coveredMs`.

### Wrong vs Correct

```text
Wrong:   ffmpeg -i in -vn -f s16le -ar 16000 -ac 1 -   → spread peaks across video.duration
Correct: … -vn -af aresample=async=1:first_pts=0 …     → return covered_ms, map by it
```

## Download / Clip / Burn

| Feature | Module | Notes |
|---------|--------|-------|
| m3u8 / video download | `download.rs` + `hls_*` | Default strategy `auto`: Rust concurrent segments, FFmpeg fallback. Frontend does not expose concurrency/strategy (debug-only arg may exist). |
| Clip | `clip.rs` | Soft/hard cut; progress polling; optional replace working video is a **frontend** session decision |
| Burn | `burn.rs` | Hard-sub export via FFmpeg/libass; burn page has no subtitle preview |

## Native ASR Job Host (Production MVP)

### Scope / Trigger

Use the Rust host in `asr_worker.rs` for the production Native ASR route and for reviewed worker compatibility tests through the existing product job contract. Release/default routing, model list/status/download, and inference use the bundled CPU worker with the exact managed large-v3 model. `HIKARU_ASR_FAKE_WORKER` remains debug/test-only host injection and never selects the product route.

### Signatures

```rust
#[tauri::command]
async fn start_asr(state: State<'_, AsrState>, app: AppHandle, args: StartAsrArgs)
    -> Result<serde_json::Value, String>;

#[tauri::command]
async fn get_asr_progress(
    state: State<'_, AsrState>,
    app: AppHandle,
    job_id: String,
    include_segments: Option<bool>,
) -> Result<serde_json::Value, String>;

#[tauri::command]
async fn cancel_asr(state: State<'_, AsrState>, job_id: String) -> Result<(), String>;

struct ResolvedNativeLaunch {
    // resolved engine/backend, role/path models, device, audio/output/recovery paths
}
```

### Contracts

- Preserve command names, camelCase `StartAsrArgs`, missing-job text containing `转录任务不存在`, and `AsrJobSnapshot` fields. `includeSegments=false` omits `segments`.
- Legacy and native routes share one active-job gate. Start failure releases an unactivated reservation; terminal poll/recovery, successful cancel, and shutdown release an active legacy slot; ordinary connection failure does not.
- Worker `completed` is only a candidate until stdout reaches EOF and the process exits 0. The terminal snapshot must not become queryable until terminal recovery JSON and any minimal fallback ASS are persisted, or React's authoritative ASS write can race with the fallback.
- Every terminal source uses first-terminal-wins. A later cancel/shutdown may still terminate and reap an outstanding PID, but must not overwrite the committed status/error.
- Release the active slot before publishing `reaped`/returning cancel, so a caller cannot observe cleanup completion while a replacement start is still rejected.
- Bound both `segment` append accumulation and `segmentsReplace` with canonical `maxReplacementSegments`. Embed `native-asr/protocol-v1-limits.json`; do not maintain a handwritten Rust limits copy.
- Recovery/stderr artifact job IDs must use the host-safe generated character set, not merely the protocol's byte/control-character rules; otherwise separators can escape managed directories.
- `HIKARU_ASR_FAKE_WORKER` and `HIKARU_ASR_FAKE_SCENARIO` are debug/test-only host-injection inputs. `#[cfg(not(debug_assertions))]` ignores them, while Release/default remains Native and resolves only the packaged runtime.
- Model-backed worker compatibility tests use required `HIKARU_ASR_PRODUCTION_WORKER`, `HIKARU_ASR_CT2_MODEL_PATH`, and `HIKARU_ASR_CT2_AUDIO_PATH` only inside `asr_worker.rs`'s test module. All three must be set together; optional `HIKARU_ASR_CT2_DEVICE` is exactly `cpu|cuda`, optional `HIKARU_ASR_CT2_ENGINE` is exactly `faster-whisper|kotoba-faster-whisper` (default ordinary), and optional `HIKARU_ASR_CT2_CANCEL_AUDIO_PATH` selects a longer cancellation input. Kotoba tests require the exact immutable Hugging Face snapshot revision directory. CUDA mode additionally requires `HIKARU_ASR_CT2_CPU_WORKER` so the same suite can deterministically prove pre-ready `cuda_not_built` without damaging the machine CUDA environment. The test copies every exercised audio into a temporary managed workspace before `ResolvedNativeLaunch::resolve(...)`. Product/Release code never reads these keys.
- Keep the generic CrispASR real-worker input contract (`HIKARU_ASR_CRISPASR_INPUTS`) available for T09/T10 Parakeet/Qwen/Reazon compatibility tests. A task-specific lifecycle matrix must use separate test-only keys rather than replacing or reinterpreting that decoder. Reazon R2 uses `HIKARU_ASR_R2_STEP6_MANIFEST`, `HIKARU_ASR_R2_STEP6_REQUIRED=1`, and `HIKARU_ASR_R2_STEP6_LANE`; the reviewed manifest bytes are source/lock-bound and required mode fails instead of skipping. Each decoder reads only its own keys, and bytes from the generic config cannot satisfy the R2 manifest contract or vice versa.

### Validation & Error Matrix

| Condition | Result |
|---|---|
| Second legacy/native start while one is active | Reject before spawning a second process |
| Malformed/unknown/version-mismatched/oversized event | Controlled failed snapshot; preserve last valid segments |
| Nonzero exit without structured worker error | `[worker_abnormal_exit] ...` |
| Exit 0 without terminal event | Stable protocol-incomplete failure |
| `completed` followed by nonzero exit | Failure, not completed |
| Cancel after a terminal snapshot but before reap | Keep first terminal status; terminate/reap remaining process tree |
| Unsafe artifact job ID or path outside approved workspace/cache root | Reject before launch/write |
| Only some required real-worker test env keys are set, or optional keys exist without the required triple | Fail the test setup clearly; never guess model/audio/worker paths |
| `HIKARU_ASR_CT2_DEVICE` is not `cpu|cuda`, or `HIKARU_ASR_CT2_ENGINE` is not an exact supported CT2 engine | Fail test setup before launch |
| Kotoba model path is not the exact pinned immutable Hugging Face snapshot directory | Fail test setup before launch |
| CUDA mode lacks the CPU-only worker or dedicated cancel audio | Fail test setup; do not weaken the negative/cancel coverage |
| CPU-only worker receives the CUDA request | Preserve structured `cuda_not_built` in recovery; accept no `ready`/completed snapshot |
| Generic `HIKARU_ASR_CRISPASR_INPUTS` is absent | Ordinary optional generic tests may skip according to the existing contract |
| R2 Step 6 required mode lacks manifest/lane/hash/artifact | Fail test setup; never silently skip or fall back to generic inputs |
| Generic and R2-specific keys are simultaneously present | Decode each contract independently from its own keys; neither authorizes the other |
| Generic config bytes are supplied as the R2 manifest, or R2 bytes are interpreted as generic inputs | Reject the mismatched schema/hash before launch |
| Rust supplies a canonical extended Windows model path to CT2 4.8.0 | Worker normalizes only the `\\?\` spelling at the inference boundary; host validation remains canonical |

### Good/Base/Bad Cases

- Good: valid fake-worker success → pending/running, bounded progress/segments, exit 0, recovery writes, then completed becomes visible and the active slot is free. A model-backed CUDA suite selects `cuda`, uses a CUDA-enabled worker for success/cancel, a CPU-only worker for deterministic `cuda_not_built`, and temporary managed audio copies throughout.
- Base: no debug/test host override → the product resolves the verified packaged Native CPU worker; the required model-backed test triple absent with no optional keys means only those optional real-worker tests skip.
- Bad: let product code read model-backed test env keys, partially configure the optional CUDA keys, sabotage the system CUDA environment to force failure, pass authoritative corpus audio directly from an unmanaged root, publish completed before fallback ASS persistence, release the slot after notifying reap, or return early from terminal cancel while a PID remains.

### Tests Required

- Reducer: ready ordering, duration/progress monotonicity, bounded append/replace, replacement atomicity, and first-terminal-wins.
- Fake worker: success/replace/structured error/malformed/version/unknown/oversize/incomplete/crash/completed-nonzero/stderr scenarios.
- Lifecycle: shared active slot, legacy release/retain branches, cancel/shutdown process-tree cleanup within two seconds, terminal-but-unreaped cleanup, and no orphan parent/child process.
- Persistence/security: partial recovery after failure/cancel/crash, minimal ASS only after non-empty completion, safe artifact job IDs, canonical path containment, and stderr byte/retention bounds.
- Compatibility: Release cargo check with malicious debug/test env values, full Rust tests, and `pnpm build` without frontend contract changes.
- Real worker: with the required three production-worker test env keys set, assert selected-device success/recovery/fallback ASS, structured pre-ready failure/recovery, cancellation with no completed snapshot, managed audio copy, and active-gate release. CUDA mode also sets `HIKARU_ASR_CT2_CPU_WORKER`, `HIKARU_ASR_CT2_CANCEL_AUDIO_PATH`, and `HIKARU_ASR_CT2_DEVICE=cuda`, then asserts `durationMs > 0` before cancellation and `cuda_not_built` from the CPU-only negative. Without the required triple, ordinary test runs skip only when no optional model-backed keys are present.
- CrispASR regression: decode representative generic Parakeet and Qwen `HIKARU_ASR_CRISPASR_INPUTS` configurations after adding any task-local suite. Prove the separate R2 required decoder rejects missing manifest/lane/required state and cross-decoded manifest bytes, binds each lane's command/environment/log digest, and leaves the generic decoder available.

### Wrong vs Correct

```text
Wrong:   completed visible → React writes formal ASS → Rust fallback overwrites it
Correct: persist recovery/fallback under the terminal lock → publish completed

Wrong:   terminal already committed → cancel returns while PID still runs
Correct: preserve first terminal snapshot → terminate/reap PID → release slot → return

Wrong:   Release/product code reads model-backed env keys, or a CUDA test breaks CUDA_PATH to manufacture an error
Correct: test module validates the required/optional env set → uses a CPU-only worker for deterministic cuda_not_built → copies audio to temporary workspace → exercises the unchanged host
```

## Native ASR Backend Routing (Production MVP)

### 1. Scope / Trigger

Apply this contract when changing the stable ASR engine/model commands, the production Native route, the packaged CPU worker resolution, or the conversion of a T12-ready model path into `ResolvedNativeLaunch`.

### 2. Signatures

```rust
enum AsrRoutePolicy { Legacy, NativeMvp }

#[tauri::command]
async fn list_asr_engines(app: AppHandle, state: State<'_, AsrState>)
    -> Result<serde_json::Value, String>;
#[tauri::command]
async fn check_asr_model(app: AppHandle, state: State<'_, AsrState>, engine: String, model: String)
    -> Result<serde_json::Value, String>;
#[tauri::command]
async fn download_asr_model(app: AppHandle, state: State<'_, AsrState>, engine: String, model: String)
    -> Result<String, String>;
#[tauri::command]
async fn get_model_download_progress(state: State<'_, AsrState>, job_id: String)
    -> Result<serde_json::Value, String>;
```

The existing `start_asr` / `get_asr_progress` / `cancel_asr` signatures and `AsrJobSnapshot` remain unchanged.

### 3. Contracts

- One immutable process-lifetime `AsrRoutePolicy` selects engine list, model status/download/progress, and inference as one family. Never let Native direct download feed legacy Python launch.
- `AsrState::default` is always `NativeMvp` in debug and Release. A valid debug fake host changes only the injected host executable; there is no persisted route setting or Release environment switch.
- Native MVP accepts exactly `faster-whisper/large-v3`, `auto|cpu`, Japanese source, and no VAD. It resolves the T13 worker from `resource_dir()/native-asr/windows-x64/cpu` and passes only T12's exact hash-verified model path to `ResolvedNativeLaunch`.
- Native preflight/runtime/model failures return directly. They never call `ensure_base_url` or silently fall back to Python.
- Model status keeps compatibility booleans and adds `disposition`, `backend`, `revision`, `origin`, and `reason`. Download progress keeps current polling fields and maps T12 `sourceEndpoint` to compatibility field `hfEndpoint`.
- Progress/cancel check the Native host first. In Native mode, an unknown job returns the established missing-job error rather than starting the sidecar.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Release/default | Entire command family uses Native MVP |
| Native large-v3 ready + CPU/auto | Resolve T13 worker + exact T12 path; start existing host |
| Native model missing | Controlled download-required error; release unactivated slot |
| Post-MVP/unknown model or engine | Explicit unavailable/unsupported result; no fallback |
| CUDA/Vulkan/non-Japanese/VAD request | Reject before worker launch |
| Missing/wrong T13 runtime identity or required entry | Controlled runtime error; no sidecar |
| Native progress/cancel unknown job | `转录任务不存在`; no sidecar |

### 5. Good / Base / Bad Cases

- Good: `NativeMvp` + exact ready large-v3 + CPU -> one host job with unchanged progress/cancel/recovery behavior.
- Base: normal Release build -> packaged Native large-v3 CPU route with no Python dependency.
- Bad: model commands use T12 but `start_asr` still enters Python, or a Native preflight error falls through to `ensure_base_url`.

### 6. Tests Required

- Route-policy/default tests, including Release check with malicious debug env values.
- All T12 disposition-to-public-payload mappings.
- CPU/auto acceptance and engine/model/device/language/VAD rejection.
- Native missing-job progress/cancel does not contact the sidecar.
- Existing host reducer, recovery, crash, cancellation, active-slot, and full Cargo regressions.
- `pnpm build` for additive TypeScript payload compatibility and `pnpm asr:runtime:verify` for the exact T13 archive.

### 7. Wrong vs Correct

```text
Wrong:   check/download -> Native manager; start failure -> Python sidecar fallback
Correct: one route policy -> all model/inference commands -> direct controlled failure

Wrong:   accept model name/path from settings and build a worker request
Correct: T12 exact readiness -> resolved path -> ResolvedNativeLaunch
```

## Bundled Native ASR CPU Runtime

### Scope / Trigger

Apply this contract whenever changing the Windows x64 bundled Native ASR worker, its binary dependencies, runtime lock/manifest, release resource preparation, NSIS/portable staging, or package evidence. This runtime is the Release/default inference dependency.

### Signatures

```text
pnpm asr:runtime:build
  -> scripts/build-native-asr-runtime.ps1
  -> native-asr/artifacts/windows-x64-cpu.zip

pnpm asr:runtime:verify
  -> scripts/verify-native-asr-runtime.mjs

pnpm asr:prepare-resource
  -> verify/extract native-asr/artifacts/windows-x64-cpu.zip
  -> src-tauri/resources/native-asr/windows-x64/cpu/
```

Tracked identities:

```text
native-asr/runtime/windows-x64-cpu-lock.json
native-asr/build-inputs/windows-x64-cpu-ct2.zip   # build/link input only
native-asr/artifacts/windows-x64-cpu.zip          # the only native archive shipped
```

The extracted Tauri resource is generated and ignored. End-user packaging never invokes CMake or consumes the build-input ZIP.

### Contracts

- `windows-x64-cpu-lock.json` is the outer authority for artifact/build-input size and SHA-256, source/toolchain identities, Candidate A config, exact payload roles, import allowlists, license components/Rust packages, forbidden capabilities/files, and size budgets.
- The final preset sets `HIKARU_ASR_MVP_CPU_RUNTIME=ON`, reproducible-build mode on, and Candidate B/CUDA/CrispASR development flags off. Development-only fake/CrispASR/Parakeet targets are excluded from the default final target graph.
- Final capability is exactly ordinary `faster-whisper` through CTranslate2 on CPU. `useVad=true` returns `vad_not_built`; GPU requests return `cuda_not_built`; CrispASR, Kotoba, and other non-MVP routes return the controlled route-not-built error. Missing DLLs are not capability control.
- Runtime verification is closed-world: archive root/path safety, outer hash, manifest/checksum/file closure, source/toolchain/config equality, imports, license inventory, forbidden content, and ASCII/UTF-16 private build paths must all pass before extraction.
- Resource preparation verifies the ZIP, extracts to a temporary sibling, verifies the tree again, then atomically replaces `src-tauri/resources/native-asr/`. NSIS and portable staging consume that same generated tree.
- If any payload byte, manifest field, or target graph changes, rebuild two independent roots to a byte-identical complete ZIP, rerun model-backed installed/portable smoke against the final worker SHA, rebuild NSIS/portable packages, and refresh the handoff. Evidence for an older worker is invalid even if source code is unchanged.
- The package includes no model weights, Python sidecar/runtime/venv/packages, ORT/Silero VAD, CrispASR, CUDA/Vulkan runtime, PDB, or development/test executable. Resource preparation deletes stale `src-tauri/resources/asr-service` before bundling.
- Bundled VC145 DLLs come unmodified from VS18 `VC/Redist`, are excluded from Hikaru Sub's Apache-2.0 project license, and are governed by the official **Microsoft Visual C++ V14 Redistributable and Runtime 2026** terms. Package the unchanged official DOCX locally, lock its immutable URL/size/SHA-256, record `https://aka.ms/vs/18/redistribution`, and preserve Microsoft's `BY USING THE SOFTWARE, YOU ACCEPT THESE TERMS` statement; do not substitute the VS2022 terms or invent a custom EULA.

### Validation & Error Matrix

| Condition | Result |
|---|---|
| Archive/build-input size or SHA-256 differs from lock | Fail before extraction/build |
| Tokenizer lock, nlohmann source, toolchain version, or required license inventory drifts | Fail before compilation/package acceptance |
| Microsoft Runtime terms URL/version/local path/use-acceptance/project-license exclusion/DLL list or official DOCX bytes drift | Fail before compilation/package acceptance |
| ZIP contains absolute/drive/`..` path, missing/extra file, undeclared DLL, model, ORT/VAD/GPU/CrispASR file, or private build path | Verifier rejects it |
| Manifest source/toolchain/config/capability/import/license data differs from outer lock or payload bytes | Verifier rejects it |
| Final preset enables a development capability or default-builds a development-only target | CMake configure/check fails; artifact is not releasable |
| `useVad=true` on bundled CPU worker | Structured `vad_not_built` before model loading |
| Non-CPU or non-MVP backend/engine request | Structured controlled not-built error; no fallback |
| Prepared runtime differs from tracked ZIP, or portable embeds a stale manifest | Packaging/evidence gate fails; rebuild packages |
| Setup `>80 MiB`, portable ZIP `>90 MiB`, unpacked runtime `>250 MiB`, or model count `>0` | Release blocker |

### Good/Base/Bad Cases

- Good: two independent clean roots produce the same ZIP; shared verifier accepts it; installed-like and portable-like final bytes pass short and `>10` minute large-v3 smoke; packages embed that manifest identity.
- Base: normal frontend/Tauri development and Release use the same packaged Native resource identity; debug fake-worker injection may replace only the host executable in tests.
- Bad: update the worker/manifest, reuse old smoke or package hashes, or let release packaging rebuild/download a different runtime. The handoff then describes bytes users will not receive.

### Tests Required

- Verifier mutation tests: outer/file/manifest hash drift, missing/extra/wrong DLL, traversal/absolute paths, forbidden capability/file, private-path leakage, source/toolchain/config mismatch, incomplete/duplicate license inventory, and Microsoft Runtime notice/document identity drift.
- Final CMake/CTest: protocol core, ordinary CT2 core, CrispASR-route rejection, and non-Whisper-route rejection; final default target graph must not build development-only workers/tests.
- Build gate: two independent roots, complete ZIP byte comparison, restricted PATH launch, import closure, and non-system module containment under the artifact root.
- Model-backed gate against the final worker SHA: installed-like and portable-like short plus `>10` minute audio; UTF-8 JSONL-only output, non-empty ordered positive-duration audio-bounded segments, normal completion, controlled unsupported request, host recovery/active-gate, and cancel within two seconds.
- Release gate: `pnpm asr:prepare-resource`, full tests/build/Cargo tests, `pnpm release:local`, manifest equality in portable staging, package sizes, model count zero, `git diff --check`, and no staged files unless the user explicitly authorizes commit preparation.

### Wrong vs Correct

```text
Wrong:   change worker bytes -> keep previous smoke/package evidence -> claim the new artifact passed
Correct: freeze final worker SHA -> rerun model/host smoke -> rebuild NSIS/portable -> record matching hashes

Wrong:   omit ORT/VAD files but compile/link Candidate B -> capability fails via missing DLL
Correct: compile Candidate B out -> useVad=true returns vad_not_built before model loading

Wrong:   release:local runs CMake or consumes a machine-local dependency tree
Correct: release:local verifies/extracts the tracked final ZIP; only the dedicated build command compiles
```

## Native ASR Model Delivery

### Scope / Trigger

Apply this contract when changing the bundled Native ASR model manifest, exact readiness, legacy Hugging Face reuse, direct CT2 installs, resumable download jobs, or stable Tauri command wiring. Production/default model commands use this manager.

### Signatures

```rust
struct NativeAsrModelManager;

async fn status(app, engine, model) -> Result<NativeAsrModelStatus, String>;
async fn resolve_ready_model(app, engine, model)
    -> Result<Option<ResolvedNativeAsrModel>, String>;
async fn start_download(app, engine, model) -> Result<String, String>;
async fn job_snapshot(job_id) -> Option<ModelDownloadSnapshot>;
```

Bundled authority:

```text
src-tauri/resources/native-asr-models.json
  schemaVersion = 1
  faster-whisper/large-v3
  Systran/faster-whisper-large-v3
  revision edaa852ec7e145841d8ffdb056a99866b5f0a478
```

### Contracts

- The bundled manifest is the sole model identity authority. Reject unsupported schemas, duplicate logical/model identities, unsafe segments, malformed hashes, missing roles, Windows reserved/trailing-dot aliases, and ASCII case-colliding identities/paths before network or filesystem mutation.
- Ordinary faster-whisper large-v3 requires exactly `config.json`, `model.bin`, `tokenizer.json`, and `vocabulary.json`; do not extend Kotoba's `preprocessor_config.json` requirement to ordinary Whisper.
- Readiness order is exact direct install, then exact immutable HF snapshot. Every required file must match size and SHA-256; readiness hashing and blocking directory verification run through `spawn_blocking` from async callers.
- The process-owned manager caches only successful exact ready resolutions for the current process. Repeated status and start preflight reuse that immutable identity; missing/corrupt results are not cached, and a verified managed download may seed the cache after publication. A new process always performs fresh exact verification.
- Direct model paths and required files reject symlinks/reparse points. Legacy HF snapshot/file canonical targets must remain below the canonical managed HF root; legacy snapshots are read-only and never copied, mutated, or deleted by the model manager.
- Official/China URLs derive only from the validated repository/revision/file row plus the existing runtime source profile. Do not accept custom model URLs or log headers/response bodies.
- `.part` resume appends only for matching `206 Content-Range`; ignored ranges (`200`), incompatible `206`, `416`, oversized partials, and known-corrupt complete partials restart safely. Useful network-interrupted partials remain resumable.
- Verify every file and the complete staging tree before renaming into the immutable final revision directory. Preserve a valid final install; move an invalid final only after replacement staging validates, and restore it when publication fails.
- Same logical-model requests share one active job. Terminal snapshots remain pollable for the process lifetime. Do not hold manager locks across network waits or multi-gigabyte hashing.
- `check_asr_model`, `download_asr_model`, and `get_model_download_progress` use the Native manager under the same process-lifetime route policy as inference; never expose a mixed Native-download/Python-launch product state.

### Validation & Error Matrix

| Condition | Result |
|---|---|
| Wrong schema/revision/hash/size, missing role/file, framework-only cache | Not ready / controlled manifest error; no fallback |
| `CON.json`, trailing-dot component, traversal, case-colliding path or identity | Reject manifest before path join |
| Direct symlink/reparse point or legacy canonical target outside managed HF root | Reject candidate before ready |
| Matching partial + valid `206 Content-Range` | Append and continue aggregate progress |
| Range ignored with `200` | Truncate and restart the file from byte 0 |
| Incompatible `206`, `416`, oversized or corrupt complete partial | Remove/restart once; never append uncertain bytes |
| Network interruption | Fail job but preserve useful bounded partial |
| Hash mismatch after complete transfer | Remove corrupt complete partial; never publish |
| Valid final exists | Reuse it; never replace or damage it |
| Same-model request while active | Return the existing active job ID |
| Known non-MVP model / unknown identity | `postMvpUnavailable` / `unsupported`; no Python or model fallback |

### Good / Base / Bad Cases

- Good: exact manifest row → resumable verified staging → immutable direct install → exact resolved path accepted by the packaged CPU worker.
- Base: exact legacy HF snapshot exists → full validation → reuse in place through the production Native route; no copy or Python fallback occurs.
- Bad: accept `main`, model-name-only directories, same-name framework caches, Windows path aliases, escaped symlinks, or stream directly into the final model directory.

### Tests Required

- Manifest: exact frozen four-file closure/license/source plus schema, duplicate, unsafe segment, Windows alias, case-collision, hash, and missing-role rejection.
- Readiness: direct/legacy preference, missing/wrong-size/wrong-hash/wrong-revision/framework-cache failure, direct link rejection, and contained/escaped legacy link behavior.
- Download: fresh, matching resume, ignored range, incompatible range, `416`, oversized partial, interruption preservation, bad hash, complete-stage publication, repair rollback, and same-model coalescing.
- Gates: focused `asr_models` tests including ready-cache reuse/missing non-cache/download seeding, full Cargo tests, `pnpm build`, task validation, implementation `rustfmt`, and `git diff --check`.
- Real handoff: exact cached large-v3 path + packaged CPU worker + short audio; long installed/portable release smoke remains owned by T18.

### Wrong vs Correct

```text
Wrong:   model alias/name exists -> report ready -> Python/native silently chooses files
Correct: exact repo + revision + four size/hash rows -> resolve one exact contained path

Wrong:   append any 206 body to a partial, or download directly into the final revision path
Correct: validate Content-Range -> verify .part -> verify complete stage -> rename immutable directory

Wrong:   T12 rewires public model commands while start_asr still defaults to Python
Correct: T12 lands the internal seam -> T16/T17 wire contracts -> T18 cuts over production
```

## Legacy ASR Sidecar Source

- Production/default inference and model management use the independent Native worker; Tauri does not start or fall back to the Python FastAPI sidecar.
- Legacy sidecar/setup source in `asr.rs` and `asr_setup.rs` may remain for one stable release cycle as rollback/diagnostic evidence, but no frontend caller or packaged `asr-service` resource exposes it.
- App exit calls idempotent `AsrState.shutdown()` so active Native workers and any explicitly constructed legacy test process share cleanup policy; `lib.rs` must not reach into process fields.
- Legacy `HIKARU_ASR_DEBUG_LOG`/`deps/asr-service/asr-debug.log` guidance applies only to intentional sidecar development or rollback testing, not production model downloads.
- Rust owns orchestration only. The independent Native worker owns production inference; do not run model inference inside the Tauri process.

## ASS Files on Disk

`ass.rs` loads/saves text. Semantic parse/serialize is frontend `src/lib/ass/`. The Native host may persist a minimal fallback ASS after non-empty completion; the frontend remains authoritative for the final transcription ASS, and the legacy sidecar writer applies only to intentional rollback testing. Editor still owns bilingual merge modes on save.

## Anti-Patterns

- Decoding timeline-mapped audio without `aresample=async=1:first_pts=0`, or mapping waveform by container duration instead of `covered_ms`
- Bundling FFmpeg/Python/models into the release payload again
- ASR inference inside Rust
- Exposing download concurrency knobs in the UI
- Burn-page libass preview feature creep (preview belongs to editor)
