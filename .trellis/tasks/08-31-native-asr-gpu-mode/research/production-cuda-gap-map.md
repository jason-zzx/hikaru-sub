# Research: Production Native CTranslate2 CUDA gap map

- Query: Inspect the current codebase end-to-end for adding production Native CTranslate2 CUDA mode: worker build flags/backend behavior, protocol, Rust launch/runtime resolution, runtime dependency metadata/probe/packaging, frontend availability/device UX, model compatibility, tests and release scripts. Reuse existing seams; no speculative redesign.
- Scope: internal
- Date: 2026-08-31

## Executive Summary

The inference and process-boundary seams already support CUDA. Protocol v1 accepts host-resolved `cuda`; the C++ backend has explicit CUDA device 0 / FP16 execution, driver and CTranslate2 capability checks, structured pre-ready errors, truthful `ready.device`, and model-backed Rust host coverage. Archived T07 evidence also proves the same worker source can execute CPU and CUDA substantially faster on an RTX 3070 without Python.

The production gap is primarily **distribution and capability resolution**, not inference design:

1. The only released/locked artifact is CPU-specific (`windows-x64/cpu`, artifact v3), and its build deliberately makes CUDA incompatible with the production flag.
2. Rust always resolves that CPU artifact, rejects `cuda`, converts `auto` to CPU, and advertises one singular `device: "cpu"`.
3. Dependency metadata, Settings labels, resource preparation, portable staging, verifier closure, package budgets, licenses, and release audits all assume exactly one CPU runtime and explicitly forbid CUDA content.
4. Frontend availability disables CUDA by recognizing a CPU-only engine payload; it has no explicit device-capability list or GPU runtime/probe reason.
5. The current eight model identities are device-agnostic CTranslate2 models, but enabling CUDA globally would expose CUDA for all of them. Product qualification must therefore cover all eight, or a new per-model device-support contract would be required.

No new protocol version, inference service, worker executable family, model downloader, job lifecycle, or Python fallback is needed.

## Current End-to-End Flow

```text
React engine/model/device select
  -> list_asr_engines + check_asr_model
  -> start_asr(StartAsrArgs device=auto|cpu today)
  -> Rust validates CPU-only route
  -> resolve_native_asr_cpu_runtime(resource/native-asr/windows-x64/cpu)
  -> NativeAsrHost + ResolvedNativeLaunch(device="cpu")
  -> protocol v1 JSONL request
  -> same hikaru-asr-worker / CTranslate2 Whisper backend
  -> ready/progress/segment/completed or structured error
```

The production CUDA path can reuse this unchanged lifecycle, with device resolution and a CUDA-qualified runtime selected before `ResolvedNativeLaunch`.

## Files Found

| Area | File Path | Current role |
|---|---|---|
| Worker build | `native-asr/CMakeLists.txt` | CT2/CUDA flags, production restriction, worker targets/tests |
| Worker presets | `native-asr/CMakePresets.json` | CPU production preset plus ignored-local CUDA development presets |
| Worker dispatch | `native-asr/src/main.cpp` | Maps request device to CPU/CUDA execution and emits events |
| CT2 backend | `native-asr/src/ctranslate2_whisper.hpp` / `.cpp` | Explicit CPU INT8 and CUDA FP16 configuration/attestation/model load |
| Protocol | `native-asr/include/hikaru_asr/protocol.hpp`, `native-asr/src/protocol.cpp`, `native-asr/docs/protocol-v1.md` | Already accepts resolved `cpu|cuda`; ready must match request |
| Runtime lock | `native-asr/runtime/windows-x64-cpu-lock.json` | Exact CPU artifact/source/import/license/forbidden-content authority |
| Rust route | `src-tauri/src/asr.rs` | CPU-only request validation, CPU runtime selection, public engine capability |
| Rust host | `src-tauri/src/asr_worker.rs` | Device-capable launch/protocol/lifecycle and real CUDA test seam |
| Dependencies | `src-tauri/src/dependencies.rs` | CPU runtime resolution/probe/kind/cleanup contract |
| Models | `src-tauri/src/asr_models.rs`, `src-tauri/resources/native-asr-models.json` | Exact eight-model readiness/download authority |
| Frontend availability | `src/hooks/useAsrAvailability.ts` | Converts engine payload into enabled device options |
| Frontend UX | `src/constants/asr.ts`, `src/components/workflow/TranscribeView.tsx`, `SettingsTranscriptionPanel.tsx` | Existing auto/CPU/CUDA selects and unchanged start flow |
| Runtime UX/types | `src/types/index.ts`, `src/constants/runtimeDependencies.ts`, `RuntimeDependenciesPanel.tsx` | CPU-only dependency kind/label/help |
| Build/package | `scripts/build-native-asr-runtime.ps1`, `package-native-asr-runtime.mjs`, `verify-native-asr-runtime.mjs`, `prepare-asr-resource.mjs`, `package-portable.mjs` | Build, close, extract, and stage one CPU archive |
| Smoke/tests | `scripts/smoke-native-asr-runtime.mjs`, verifier/resource tests, Rust/native CTests | Mostly CPU-fixed production gates; reusable host CUDA tests exist |
| CI/release | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `docs/release.md` | Prepare/stage/audit only CPU resource |
| Prior evidence | `.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/research/*` | Accepted development CUDA design, lock, speed evidence, commands |

## Gap Map

### 1. Worker Build and Backend Behavior

**Already reusable**

- `native-asr/src/ctranslate2_whisper.hpp:37-64` defines `ExecutionDevice::{Cpu,Cuda}`, `ExecutionComputeType::{Int8,Float16}`, device index, and execution attestation.
- `native-asr/src/ctranslate2_whisper.cpp:962-1028` fails before model construction for invalid index, non-FP16 CUDA, non-CUDA build, missing driver/device, inaccessible CT2 CUDA device, and unsupported FP16. Stable codes already include `cuda_not_built`, `cuda_runtime_failed`, `cuda_device_unavailable`, and `cuda_compute_type_unsupported`.
- `native-asr/src/ctranslate2_whisper.cpp:1052-1058` fixes CPU to INT8 and CUDA to FP16/device 0.
- `native-asr/src/ctranslate2_whisper.cpp:1646-1712` validates execution before loading and maps CUDA model initialization failure to `cuda_model_load_failed`.
- `native-asr/src/main.cpp:235-304` already selects `cuda_execution_config()` for a CUDA request and emits `ready.device=request.device` only after backend construction.
- Archived T07 recommends the same worker/protocol/backend and reports `development-gpu-ready`; see `cuda-development-design-inputs.md:3-8,53-92` and `cuda-development-report.md:1-19`.

**Production gaps**

- The CUDA option is explicitly development-only: `native-asr/CMakeLists.txt:81-89`.
- The production flag and CUDA are mutually exclusive: `native-asr/CMakeLists.txt:152-159`.
- CPU final preset sets `HIKARU_ASR_MVP_CPU_RUNTIME=ON`: `native-asr/CMakePresets.json:43-60`; CUDA presets inherit development inputs and task-local paths: `native-asr/CMakePresets.json:63-96`.
- CT2 CUDA is built only under the development option, requires ambient `CUDA_PATH`, enables dynamic loading, and targets only architecture 8.6: `native-asr/CMakeLists.txt:456-470`. That is not a distributable GPU matrix.
- `HIKARU_ASR_CT2_WITH_CUDA` is also tied to the development option: `native-asr/CMakeLists.txt:527-532`.
- The CUDA development preset inherits `windows-x64-ct2-release`, which enables rejected Candidate B development by default (`native-asr/CMakePresets.json:27-40,63-73`). A release CUDA preset must explicitly keep Candidate B/CrispASR/VAD/parity development features off.
- Production-only route wording and tests say “CPU runtime”: `native-asr/src/main.cpp:238-243`; `native-asr/tests/assert_mvp_route_disabled.py:21-54` has no release-CUDA assertion.

**Minimal change direction**

Generalize the existing restricted production CT2 build gate so it can create a second locked CUDA artifact while preserving the same two engines and no-VAD/no-CrispASR route. Do not fork the worker or backend. Add a release CUDA preset with pinned build inputs and a declared architecture policy; keep current CPU preset intact.

### 2. Protocol and Worker/Host Contract

**No protocol redesign needed**

- Protocol enums already include CUDA: `native-asr/include/hikaru_asr/protocol.hpp:14-25,45-55`.
- Request parser accepts `cuda` and rejects only Vulkan for CT2: `native-asr/src/protocol.cpp:116-121,397-463`.
- Fixed matrix allows Faster-Whisper and Kotoba on CPU/CUDA: `native-asr/docs/protocol-v1.md:41-67`.
- Ready events carry and validate device identity: `native-asr/src/protocol.cpp:491-504`; lifecycle requires ready route match: `native-asr/docs/protocol-v1.md:94-126`.
- Rust host validation already accepts CT2 CUDA: `src-tauri/src/asr_worker.rs:329-372`; event parser accepts CUDA: `src-tauri/src/asr_worker.rs:995-1061`.

**Gap**

The host must continue resolving `auto` above protocol v1. No `auto` should be added to worker protocol. The unresolved product policy is when `auto` chooses CUDA and whether it may fall back to CPU after a CUDA preflight/runtime failure.

### 3. Rust Launch and Runtime Resolution

**Already reusable**

- `ResolvedNativeLaunch` is device-generic and validates the route, managed audio, exact model paths, output/recovery/log containment: `src-tauri/src/asr_worker.rs:138-252`.
- `NativeAsrHost` is executable-agnostic and preserves lifecycle/recovery/cancel behavior: `src-tauri/src/asr_worker.rs:573-717`.
- Real-worker tests already accept `HIKARU_ASR_CT2_DEVICE=cpu|cuda`, require a CPU worker for deterministic `cuda_not_built`, and require longer cancel audio for CUDA: `src-tauri/src/asr_worker.rs:1990-2085`.
- CUDA success, CPU-worker negative, and GPU-loaded cancellation are already exercised through the unchanged host seam: `src-tauri/src/asr_worker.rs:3131-3258,3368-3399`.

**Production gaps**

- `validate_native_request` rejects anything except `auto|cpu`: `src-tauri/src/asr.rs:300-317`.
- `packaged_native_host` always resolves the CPU runtime and caches one host: `src-tauri/src/asr.rs:172-185`. A single cached host cannot represent independent CPU and CUDA executable identities unless one combined artifact is deliberately chosen.
- Production launch hard-codes `"cpu"` regardless of selected setting: `src-tauri/src/asr.rs:790-815`.
- Debug launch also hard-codes CPU: `src-tauri/src/asr.rs:320-353` (debug-only, but tests may need truthfulness).
- `list_asr_engines` advertises singular `device: "cpu"`: `src-tauri/src/asr.rs:716-735`. It is synthesized from known model engines and does not resolve/probe the packaged runtime, so frontend `routeAvailable` can currently be true even when the runtime is missing or corrupt; actual runtime resolution is deferred until start (`src-tauri/src/asr.rs:172-184`).
- Error strings and module names are CPU-specific throughout `asr.rs` and `dependencies.rs`, increasing stale-claim/test churn.
- `NativeAsrHost::start` inherits the parent environment and does not set an explicit runtime directory/PATH: `src-tauri/src/asr_worker.rs:610-632`. This is sufficient for current sibling DLLs, but a managed CUDA DLL pack needs an explicit, attested DLL search policy rather than incidental user PATH discovery.

**Minimal change direction**

Resolve a concrete device and runtime before `ResolvedNativeLaunch`:

```text
requested auto|cpu|cuda
  -> runtime/device capability resolver
  -> selected worker identity + resolved cpu|cuda
  -> existing ResolvedNativeLaunch
  -> existing NativeAsrHost
```

Keep CPU and CUDA hosts keyed by runtime identity/device if separate artifacts are used. Do not move inference into Rust or add a second job API.

### 4. Runtime Dependency Metadata, Probe, and Storage

**Current CPU-only assumptions**

- Constants, resource path, required files, result type, manifest type, and enum are CPU-named: `src-tauri/src/dependencies.rs:18-76`.
- Runtime resolver requires artifact `hikaru-asr-windows-x64-cpu-v3`, path `native-asr/windows-x64/cpu`, `device==cpu`, and `cuda==false`: `src-tauri/src/dependencies.rs:768-827`.
- Probe exposes one unmanaged `NativeAsrCpu` item: `src-tauri/src/dependencies.rs:1806-1828`.
- Preparation and cleanup explicitly reject that built-in CPU runtime: `src-tauri/src/dependencies.rs:1466-1475,1588`.
- Frontend type/label/help are CPU-specific: `src/types/index.ts:206-231`; `src/constants/runtimeDependencies.ts:6-12`; `src/components/workflow/RuntimeDependenciesPanel.tsx:131-140`.
- Runtime source metadata has no Native CUDA runtime/archive row: `src-tauri/resources/runtime-dependency-sources.json:1-58`.

**Required gap closure depends on distribution choice**

- If CUDA is bundled: add a second built-in/unmanaged runtime item and resource resolver, then raise/audit package budgets.
- If CUDA is downloaded on demand: add a managed CUDA runtime dependency source with exact URL/archive/size/SHA, prepare/progress/cancel/repair, bounded storage and cleanup. Reuse the existing runtime-dependency job UX; do not overload model delivery.
- If system CUDA is required: add a non-recursive, non-mutating probe with precise driver/runtime failure reasons. This is the smallest package but weakest reproducibility and likely not sufficient by itself for “production-ready.”

Probe must remain status/path/version only; storage measurement remains explicit and recursive work stays in `spawn_blocking`, per `.trellis/spec/tauri/paths-and-runtime-deps.md:37-100`.

### 5. Runtime Lock, Verification, Licenses, and Packaging

**Hard blockers in current release closure**

- Only CPU lock/archive/root exist: `native-asr/runtime/windows-x64-cpu-lock.json:1-41`.
- The lock explicitly forbids `cuda`/`cudnn` path fragments: `native-asr/runtime/windows-x64-cpu-lock.json:291-303`.
- Current size budgets are setup 80 MiB, portable 90 MiB, unpacked runtime 250 MiB: `native-asr/runtime/windows-x64-cpu-lock.json:313-318`.
- Archived development inputs observed `cublas64_12.dll` about 108 MiB and `cublasLt64_12.dll` about 643 MiB alone: archived `cuda-input-lock.md:53-67`. Therefore bundling that exact toolkit envelope is incompatible with current package budgets.
- Build script forces CUDA off/CPU production on: `scripts/build-native-asr-runtime.ps1:350-390`.
- Staging copies only worker, CT2, tokenizer and VC runtime: `scripts/build-native-asr-runtime.ps1:404-479`.
- Restricted launch uses runtime root + System32 and sends a CPU/VAD-negative request: `scripts/build-native-asr-runtime.ps1:245-297`; it does not prove CUDA module closure or execution.
- Verifier assumes artifact root from one CPU lock, exactly three PE import owners, and rejects undeclared DLLs: `scripts/verify-native-asr-runtime.mjs:57-65,353-473`.
- Resource preparation reads one CPU lock and atomically replaces the complete `resources/native-asr` tree: `scripts/prepare-asr-resource.mjs:11-28`. Preparing two independent artifacts would currently erase the first unless orchestration is generalized.
- Portable packaging verifies the CPU lock and copies the whole generated `native-asr` resource: `scripts/package-portable.mjs:35-73,131-153`.
- Tauri bundles all `resources/`: `src-tauri/tauri.conf.json:31-42`.
- Notices describe only CPU CT2/oneDNN and no NVIDIA redistributables: `THIRD_PARTY_NOTICES.md:9-24`.

**Minimal change direction**

Keep separate closed-world locks/artifacts for CPU and CUDA rather than weakening the CPU lock. Reuse the package/verifier module with an explicit lock argument for each artifact and prepare both into sibling roots without deleting the other. NVIDIA runtime/toolkit redistribution terms, exact source bytes, loaded-module closure, and any required license/notices must become lock authority before a CUDA artifact can ship or be downloaded.

### 6. Frontend Availability and Device UX

**Already reusable**

- CUDA is already a visible option: `src/constants/asr.ts:15-19`.
- Settings and Transcription both use the same availability hook and existing select controls: `src/components/workflow/SettingsTranscriptionPanel.tsx:14-83`; `src/components/workflow/TranscribeView.tsx:83-106,633-689`.
- Start flow already forwards the selected device unchanged and preserves model download/progress/cancel/ASS behavior: `src/components/workflow/TranscribeView.tsx:396-471`.
- Saved unavailable values remain visible without silent rewriting: `src/components/workflow/SettingsTranscriptionPanel.test.tsx:70-100`; Rust settings currently preserves `asrDevice="cuda"`: `src-tauri/src/settings.rs:580-612`.

**Gaps**

- `asrDeviceSelectOptions` disables CUDA whenever the engine payload says singular CPU: `src/hooks/useAsrAvailability.ts:105-125`.
- `deviceAvailable` repeats the same singular CPU inference: `src/hooks/useAsrAvailability.ts:290-319`.
- `AsrEngineInfo` has only `device?: string`, not an explicit device set or per-device reason: `src/types/index.ts:111-118`.
- Tests freeze CPU-only behavior: `src/hooks/useAsrAvailability.test.tsx:41-102`; Settings mocks label CUDA “后续版本支持”: `src/components/workflow/SettingsTranscriptionPanel.test.tsx:22-39`.
- User-facing copy says “内置 Native CPU 运行时”: `src/components/workflow/SettingsTranscriptionPanel.tsx:29-33`; runtime label/help are CPU-only as cited above.

**Minimal change direction**

Make backend capability authoritative with an additive `devices` list (and optionally per-device reason/status), while retaining singular `device` temporarily for compatibility. The hook should enable only returned devices. Keep one shared hook and the existing selects; do not create a frontend GPU probe or duplicate runtime registry.

For `auto`, show what it means in product copy only after the fallback/selection policy is decided. Availability detection must distinguish at least: runtime missing/corrupt, NVIDIA driver/GPU unavailable, unsupported compute capability, and available.

### 7. Model Compatibility

**What can be reused**

- Model bytes/readiness are not device-specific. The exact eight-row manifest remains the identity/download authority; no second CUDA model cache is needed.
- The worker uses the same model path for CPU/CUDA and validates multilingual/mel shape after device-specific model construction: `native-asr/src/ctranslate2_whisper.cpp:1696-1723`.
- Kotoba dispatch chooses the same K2 profile on either device: `native-asr/src/main.cpp:286-297`.
- Existing host test input supports both Faster-Whisper and exact Kotoba on CUDA: `src-tauri/src/asr_worker.rs:2034-2076`.

**Qualification gap**

The UI/model manager currently treats all eight released models as supported independent of device. Enabling CUDA at engine level therefore enables CUDA for every model. To reuse existing seams, production CUDA should qualify all seven Faster-Whisper rows plus exact Kotoba. If product wants a subset, `native-asr-models.json`, public model status, `check_asr_model`, and availability calls need an explicit device compatibility dimension; that is a larger contract change and should not be invented implicitly.

Also decide whether fixed FP16 is accepted for all models. The Native backend currently has only CPU INT8 and CUDA FP16; no `computeType` is exposed in protocol or UI. Adding user-selectable compute type is not required for this task unless qualification rejects FP16 for a specific model.

### 8. Tests and Release Scripts

**Existing high-value seams**

- C++ self-check covers CUDA config and CPU-only `cuda_not_built`: `native-asr/tests/ctranslate2_whisper_tests.cpp:1205-1208,1758-1762`.
- T07 runner contains GPU/module attestation and completed CUDA evidence paths: `native-asr/tests/ctranslate2_whisper_tests.cpp:2533-3262`.
- Rust real-host CUDA success/error/cancel seam is already present as cited above.
- Runtime verifier has strong closed-world mutation coverage: `scripts/verify-native-asr-runtime.test.mjs:285-420`.
- Resource preparation test asserts exact CPU extraction and stale sidecar removal: `scripts/prepare-asr-resource.test.mjs:29-74`.

**Missing production gates**

1. A release CUDA CMake preset/CTest route contract proving both released engines, CUDA accepted, VAD/CrispASR/Vulkan rejected, and CPU artifact still returns `cuda_not_built`.
2. Reproducible CUDA runtime archive builds from two roots and byte identity.
3. Closed-world CUDA runtime verification including dynamically loaded NVIDIA modules, root policy, versions/hashes/licenses, forbidden extras/private paths, and negative mutation tests.
4. Functional short smoke parameterized by device/engine/model; current script hard-codes ordinary Faster-Whisper CPU: `scripts/smoke-native-asr-runtime.mjs:11-37`.
5. Eight-model CUDA short matrix, plus existing long gates (`large-v2` and Kotoba >10 min), legal ordered timestamps, no Python/network fallback, offline rerun, and cancellation after ready.
6. Installed and portable CUDA resolution/probe/start tests, including CUDA unavailable/corrupt while CPU remains usable.
7. Frontend tests for returned `devices`, selected/saved CUDA, `auto`, precise unavailability reasons, and start payload.
8. Dependency probe/measure/cleanup tests for the chosen bundled/managed/system topology.
9. Package audits and docs no longer requiring “GPU absent.” Current release validation explicitly forbids GPU runtimes and keeps CUDA unavailable: `docs/release.md:93-105`.
10. CI/release orchestration. Current CI/release only runs `pnpm asr:prepare-resource`: `.github/workflows/ci.yml:65-78`; `.github/workflows/release.yml:90-120`. It does not build/qualify CUDA and GitHub-hosted runners should not be treated as the real-GPU qualification machine.

## Likely Changed Files

### Core production path (high confidence)

- `native-asr/CMakeLists.txt`
- `native-asr/CMakePresets.json`
- `native-asr/src/main.cpp` (mostly naming/release gate; device mapping already exists)
- `native-asr/tests/assert_mvp_route_disabled.py` or a sibling generalized release-route test
- `native-asr/runtime/windows-x64-cpu-lock.json` only if shared tooling/schema changes; otherwise preserve bytes
- new sibling CUDA runtime lock/artifact/build-input metadata under `native-asr/runtime/`, `native-asr/artifacts/`, `native-asr/build-inputs/`
- `src-tauri/src/asr.rs`
- `src-tauri/src/dependencies.rs`
- `src-tauri/src/asr_worker.rs` (runtime environment/production qualification tests; lifecycle core should remain unchanged)
- `src/types/index.ts`
- `src/hooks/useAsrAvailability.ts`
- `src/constants/runtimeDependencies.ts`
- `src/components/workflow/SettingsTranscriptionPanel.tsx`
- `src/components/workflow/RuntimeDependenciesPanel.tsx`

### Build, packaging, and verification (high confidence)

- `package.json`
- `scripts/build-native-asr-runtime.ps1` (likely parameterize or add a CUDA sibling script)
- `scripts/package-native-asr-runtime.mjs`
- `scripts/verify-native-asr-runtime.mjs`
- `scripts/verify-native-asr-runtime.test.mjs`
- `scripts/prepare-asr-resource.mjs`
- `scripts/prepare-asr-resource.test.mjs`
- `scripts/smoke-native-asr-runtime.mjs`
- `scripts/package-portable.mjs`
- `src-tauri/resources/runtime-dependency-sources.json` if CUDA runtime is managed/on-demand
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

### Tests/docs that encode CPU-only behavior (high confidence)

- `src/hooks/useAsrAvailability.test.tsx`
- `src/components/workflow/SettingsTranscriptionPanel.test.tsx`
- `src/components/workflow/TranscribeView.test.tsx`
- `src/constants/runtimeDependencies.test.ts`
- `src-tauri/src/asr.rs` tests
- `src-tauri/src/dependencies.rs` tests
- `AGENTS.md`
- `docs/runtime-dependencies.md`
- `docs/release.md`
- `THIRD_PARTY_NOTICES.md`
- `.trellis/spec/tauri/paths-and-runtime-deps.md`
- `.trellis/spec/tauri/media-ffmpeg-asr.md`

### Probably unchanged unless product chooses subset support

- `native-asr/include/hikaru_asr/protocol.hpp`
- `native-asr/src/protocol.cpp`
- `native-asr/protocol-v1-limits.json`
- `src-tauri/src/asr_models.rs`
- `src-tauri/resources/native-asr-models.json`
- `src/services/tauri.ts`
- ASR job polling/cancel/ASS logic in `TranscribeView`

## Minimal Architecture

```text
Existing model manifest + model manager (unchanged)
                  |
requested device auto|cpu|cuda
                  v
Tauri Native CT2 capability resolver
  - CPU artifact status
  - CUDA artifact/runtime + NVIDIA device status
  - explicit auto policy
                  |
        concrete runtime + cpu|cuda
                  v
Existing NativeAsrHost / ResolvedNativeLaunch
                  |
       existing protocol v1 JSONL
                  v
Same hikaru-asr-worker source
  - CPU INT8
  - CUDA FP16 device 0
  - same Faster-Whisper/Kotoba algorithms
```

Recommended seam constraints:

- Preserve the CPU artifact and its closed-world lock.
- Use a sibling CUDA-qualified artifact/runtime identity, not a second protocol or inference implementation.
- Resolve `auto` in Rust; worker receives only `cpu|cuda`.
- Backend returns device capabilities; frontend renders them.
- Keep exact model downloads shared across devices.
- Keep VAD, CrispASR, Qwen3, Parakeet, ReazonSpeech, and Vulkan out of this slice.
- Never fall back to Python.

## Unresolved Product Decisions

These decisions materially change the implementation and release contract and should be fixed in the PRD/design before implementation:

1. **CUDA distribution topology (blocking):** bundle NVIDIA user-mode runtime with the app, download a separately locked managed CUDA pack on demand, or require a compatible system CUDA installation? The development CUDA DLL envelope exceeds current setup/portable budgets by a large margin.
2. **`auto` semantics (blocking):** prefer CUDA when fully available and otherwise CPU, or remain CPU unless the user explicitly selects CUDA? If CUDA was selected/auto-resolved and fails after launch, is CPU fallback allowed? Existing T07 contract says no automatic fallback; protocol expects a resolved device.
3. **Runtime artifact topology:** separate CPU and CUDA worker/runtime roots (lowest risk to existing CPU closure) or one CUDA-enabled artifact used for both devices? Separate roots fit current locks/probes and deterministic negative tests better.
4. **Runtime acquisition UX:** if managed/on-demand, is downloading the CUDA pack an explicit Settings action, an action-resume confirmation when CUDA is selected, or both? What is the expected size shown to users?
5. **Hardware floor:** supported NVIDIA architectures/compute capability, minimum driver/API version, CUDA toolkit/runtime line, and whether only device index 0 is supported in v1. Current development build is RTX 3070 / SM 8.6 / CUDA 12.8 evidence, not a release matrix.
6. **Model scope:** all eight current Native CT2 model identities on CUDA (best reuse) or a subset? A subset requires per-model device compatibility metadata and UX. Current product instructions specifically constrain Kotoba to CPU even though protocol/worker code accepts Kotoba CUDA, so promotion requires an explicit qualification/contract decision.
7. **Compute and memory policy:** accept fixed FP16 for every CUDA model, or require model-specific `int8_float16`/other modes? What VRAM/OOM floor is supported for large models, and is OOM a controlled incompatibility or ordinary job failure? Current Native protocol/UI has no compute-type or memory field, and T07 intentionally froze FP16.
8. **Package budgets and licensing:** if any CUDA DLLs are shipped, what new NSIS/portable/runtime size budgets are accepted, and which NVIDIA redistribution/license/source obligations must be locked and displayed?
9. **GPU qualification ownership:** what physical GPU/driver matrix is release-blocking, where it runs, and how its evidence is bound to the exact artifact? Ordinary GitHub Windows runners cannot provide the model-backed GPU release gate.
10. **Failure UX:** exact user-facing distinction and recovery action for no NVIDIA GPU, old driver, unsupported compute capability, insufficient VRAM/OOM, missing/corrupt managed CUDA pack, CUDA model-load failure, and CPU availability remaining intact.

## Related Specs

- `.trellis/spec/tauri/media-ffmpeg-asr.md:74-168` — existing Native host lifecycle and real-worker CUDA-compatible test contract.
- `.trellis/spec/tauri/media-ffmpeg-asr.md:170-331` — current CPU production route and locked runtime package assumptions that CUDA must revise.
- `.trellis/spec/tauri/paths-and-runtime-deps.md:37-100` — probe/measure/cleanup and built-in CPU runtime contracts.
- `.trellis/spec/guides/cross-layer-thinking-guide.md:23-79` — React -> Tauri -> Native worker ownership and boundary mapping.
- `AGENTS.md:171-181` — current release runtime/model/path rules and explicit CUDA-unavailable product statement.

## Caveats / Not Found

- No production CUDA runtime lock, distributable archive, NVIDIA license inventory, managed CUDA source row, or release-qualified hardware matrix exists in the current tree.
- The archived T07 result proves development execution/speed only; it explicitly does not prove product packaging, broad GPU compatibility, subtitle quality, or release qualification.
- No external documentation search was necessary for this internal gap map. Before selecting distributable NVIDIA binaries, official NVIDIA redistribution terms and the exact CTranslate2/CUDA support matrix must be researched and locked separately.
