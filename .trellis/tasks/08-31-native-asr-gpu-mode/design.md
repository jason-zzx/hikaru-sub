# Native ASR GPU mode design

## Summary

Add one optional managed Windows x64 CUDA runtime beside the existing bundled CPU runtime. Keep the existing Native worker source, protocol v1, model cache, Tauri job family, frontend selects, cancellation/recovery flow, and ASS output unchanged.

The central seam is a Tauri-side **Native ASR execution resolver**. Its small interface accepts `auto|cpu|cuda` and returns one concrete runtime plus `cpu|cuda`, hiding pack verification, CUDA preflight, auto fallback, and host caching. Callers never choose executable paths or implement fallback themselves.

```text
requested auto|cpu|cuda
        |
        v
Native ASR execution resolver
  - verify bundled CPU runtime
  - verify/probe managed CUDA pack when relevant
  - apply auto/explicit policy
  - return concrete runtime + cpu|cuda + optional notice
        |
        v
existing ResolvedNativeLaunch / NativeAsrHost
        |
        v
existing protocol v1 worker request
```

## Design principles

- Preserve the existing CPU artifact and its lock byte-for-byte unless shared tooling requires a schema-compatible change.
- Add one real runtime variation at the resolver seam: bundled CPU and managed CUDA. Do not add a second ASR command family or inference implementation.
- Resolve `auto` before protocol v1; the worker continues receiving only `cpu|cuda`.
- Keep pack acquisition inside the existing runtime-dependency module and UI.
- Keep model support device-agnostic: the same eight exact model installs are used by CPU and CUDA.
- Treat real execution evidence and theoretical architecture compatibility as separate claims.

## 1. Runtime layout and identities

### Bundled CPU runtime

Unchanged:

```text
<resource>/native-asr/windows-x64/cpu/
```

- Built into NSIS and portable packages.
- `managed=false`, not downloadable or cleanable.
- Existing artifact v3 and CPU lock remain authoritative.

### Managed CUDA runtime

New:

```text
<exe>/deps/asr-runtime/cuda/
├─ current/                  # atomically published verified pack
├─ previous/                 # retained only during update/rollback
└─ install.json              # active artifact identity and state

<exe>/deps/downloads/native-asr-cuda/
├─ <artifact-id>.part
└─ <artifact-id>.staging/
```

The final exact names may follow existing dependency helpers, but every join stays below canonical executable-adjacent `deps/`. Preparation verifies the archive before extraction, verifies the extracted tree, and only then replaces `current`. Failed update leaves `current` intact. Cleanup targets only the managed CUDA root and its CUDA download staging.

### CUDA artifact

Add sibling authorities such as:

```text
native-asr/runtime/windows-x64-cuda-lock.json
native-asr/build-inputs/windows-x64-cuda-ct2.zip
native-asr/artifacts/windows-x64-cuda.zip
```

The application downloads the final immutable Hikaru Sub CUDA pack referenced by `runtime-dependency-sources.json`; it does not download NVIDIA archives directly. NVIDIA component archives are build inputs only.

The likely pack payload is:

```text
hikaru-asr-worker.exe
ctranslate2.dll
hikaru_asr_tokenizer.dll
Microsoft runtime DLLs already required by the CPU pack
cublas64_12.dll
cublasLt64_12.dll
runtime-manifest.json
SHA256SUMS
licenses/*
THIRD_PARTY_NOTICES.txt or equivalent lock-owned notice
```

`nvcuda.dll` remains system/driver-owned. `cudart64_12.dll` and any other CUDA DLL are added only if final PE imports or completed loaded-module discovery prove them necessary. cuDNN remains disabled and forbidden.

## 2. Native worker build and capability policy

### Release CUDA preset

Add a release CUDA preset independent of the development preset:

- pinned CTranslate2 4.8.0 source/build inputs;
- `WITH_CUDA=ON`;
- `CUDA_DYNAMIC_LOADING=ON`;
- `WITH_CUDNN=OFF`;
- static CUDA runtime unless final imports prove otherwise;
- Candidate B/CrispASR/VAD/Qwen/Parakeet/Reazon/development runners excluded from the final target graph;
- reproducible-build controls matching the CPU artifact;
- architecture flags locked as:

```text
CUDA_ARCH_LIST=6.1;7.5;8.6;8.9
CUDA_NVCC_FLAGS=
  -gencode=arch=compute_120,code=sm_120
  -gencode=arch=compute_120,code=compute_120   # optional but recommended
```

The final lock records the expanded `nvcc` flags and `cuobjdump` output. No `Auto` architecture selection is allowed.

### Compute mapping

Extend the internal backend compute enum with `Int8Float32`.

```text
CC 6.1  -> sm_61  -> INT8_FLOAT32
CC 7.5  -> sm_75  -> FLOAT16
CC 8.6  -> sm_86  -> FLOAT16
CC 8.9  -> sm_89  -> FLOAT16
CC 12.0 -> sm_120 -> FLOAT16
other   -> cuda_architecture_unsupported
```

The worker queries device 0 through the CUDA Driver API before model construction, resolves the exact mapping once, validates CTranslate2 support, and constructs the model with the explicit compute type. It never tries one type and silently falls back to another.

CPU remains `INT8`; no CPU behavior changes.

### Capability probe mode

Add one bounded worker CLI mode, separate from protocol v1, for runtime/device availability:

```text
hikaru-asr-worker.exe --probe-cuda
```

It emits exactly one bounded JSON object and exits. It performs no model load and contains no transcript or user path. Suggested result:

```json
{
  "available": true,
  "deviceIndex": 0,
  "deviceName": "NVIDIA GeForce RTX 3070",
  "computeCapability": "8.6",
  "computeType": "float16",
  "driverVersion": 13020,
  "supportEvidence": "realTested"
}
```

Failures use stable codes already present where possible: `cuda_runtime_failed`, `cuda_device_unavailable`, `cuda_compute_type_unsupported`, plus `cuda_architecture_unsupported` for the locked desktop allowlist. The probe runs with a restricted environment that makes the pack directory authoritative and does not allow an installed Toolkit to override bundled DLLs.

`supportEvidence` is artifact policy metadata:

- CC 8.6: `realTested` only after final RTX 3070 evidence exists for the exact artifact SHA.
- CC 6.1/7.5/8.9/12.0: `theoretical`.

This is informational and does not replace actual availability checks.

## 3. Tauri execution resolver

### Interface

Keep the interface small and testable:

```rust
struct ResolvedNativeExecution {
    host: NativeAsrHost,
    device: NativeDevice,        // Cpu | Cuda
    notice: Option<String>,      // e.g. auto fell back before start
}

async fn resolve_native_execution(
    app: &AppHandle,
    state: &AsrState,
    requested: RequestedDevice,  // Auto | Cpu | Cuda
) -> Result<ResolvedNativeExecution, String>;
```

Implementation details remain private:

- bundled CPU lock resolution;
- managed CUDA tree verification;
- worker capability probe;
- requested-device policy;
- CPU/CUDA host cache keyed by runtime artifact identity;
- restricted child environment for CUDA;
- controlled errors and fallback notice.

### Resolution policy

| Request | CUDA pack/probe | Result |
|---|---|---|
| `cpu` | ignored | bundled CPU runtime |
| `cuda` | pack missing | download-required error; frontend may start pack setup |
| `cuda` | pack corrupt/incompatible | explicit CUDA error; no CPU fallback |
| `cuda` | available | CUDA runtime/device |
| `auto` | pack missing | CPU, no download |
| `auto` | corrupt/incompatible/preflight fail | CPU + one non-fatal notice |
| `auto` | available | CUDA runtime/device |

No fallback occurs after the worker has emitted `ready` or the GPU job has started. A GPU OOM/model-load/runtime error ends that job.

### Host process environment

Extend `NativeAsrHost` construction only enough to support an explicit environment overlay or launch configuration. CUDA launch must:

- make the verified CUDA pack directory the first/only non-system DLL source;
- keep System32 available for `nvcuda.dll` and Windows DLLs;
- remove or neutralize ambient `CUDA_PATH`/Toolkit paths that could override pack DLLs;
- preserve stdout JSONL-only, stderr diagnostics, cancellation, process-tree cleanup and active-job behavior.

Do not add environment-variable-based product route selection.

## 4. Runtime dependency module

Add `RuntimeDependencyKind::NativeAsrCuda` / frontend `nativeAsrCuda`.

### Probe

`probe_runtime_dependencies` reports:

- built-in CPU runtime as today;
- managed CUDA pack status/path/version/expected download bytes;
- no recursive size;
- capability detail only from bounded manifest reads and the bounded worker probe.

The device capability returned by `list_asr_engines` is derived from the same resolver/probe result, not from frontend heuristics.

### Prepare

Reuse the existing dependency job model:

1. select official/China source profile;
2. download final pack to CUDA-specific staging with progress/cancel;
3. verify outer SHA/size;
4. safely extract to staging;
5. run full tree/manifest/license/import closure verification;
6. atomically publish `current` while retaining previous until success;
7. run CUDA capability probe;
8. report completed path or controlled capability warning.

Pack installation may succeed even if the current machine has no compatible GPU; the pack is valid, while device availability remains false.

### Measure and cleanup

- measurement is explicit and uses `spawn_blocking`;
- count only managed CUDA current/previous and CUDA download staging;
- cleanup is shown only after measurement > 0;
- reject any target outside the canonical managed CUDA root;
- refuse cleanup while a CUDA ASR job or CUDA dependency job is active.

## 5. Backend capability payload

Extend `AsrEngineInfo` additively rather than replacing the compatibility `device` field immediately.

```ts
type AsrDeviceValue = "auto" | "cpu" | "cuda"

interface AsrDeviceCapability {
  device: "cpu" | "cuda"
  available: boolean
  reason?: string | null
  downloadRequired?: boolean
  deviceName?: string | null
  computeCapability?: string | null
  computeType?: "int8Float32" | "float16" | null
  supportEvidence?: "realTested" | "theoretical" | null
}

interface AsrEngineInfo {
  name: string
  available: boolean
  backend?: string | null
  device?: string | null       // temporary compatibility field
  devices?: AsrDeviceCapability[]
  reason?: string | null
}
```

Both released engines share the same CPU/CUDA runtime capabilities. Do not duplicate device capability per model.

## 6. Frontend flow

### Availability

`useAsrAvailability` consumes backend `devices` and keeps the existing select controls:

- `auto` remains available while CPU is available;
- `cpu` reflects bundled CPU status;
- `cuda` is enabled only when the current pack/device probe is available;
- a saved unavailable `cuda` value remains visible with its reason;
- no direct browser/Tauri invoke probe is added outside the existing hook/service path.

### Settings

- Replace CPU-only explanatory copy with Native CPU + optional CUDA wording.
- Runtime Dependencies shows “Native ASR CUDA 运行时” as managed, downloadable, repairable and cleanable.
- Show detected device 0, compute capability, selected compute type, and evidence label when available.
- Clearly state multi-GPU selection is not supported in v1.

### Transcription start

For explicit CUDA:

1. if CUDA pack is missing, show confirmation with expected download size;
2. start existing runtime dependency job and show progress/cancel;
3. after successful install/probe, continue the original transcription intent;
4. then use the existing model-ready/download flow;
5. start ASR with `device="cuda"`.

For auto:

- do not prompt or download CUDA;
- Tauri chooses installed/probed CUDA or CPU;
- surface a one-time non-fatal CPU fallback notice when relevant.

Do not redesign the ASR page or add a new global state store unless the existing runtime dependency/model job state cannot carry the continuation token. Prefer a local pending-start intent plus existing pollers.

## 7. Packaging, source, and licenses

### Build inputs

Use official pinned NVIDIA CUDA 12.9 Update 1 redistributable metadata/component archives as build inputs. Lock URL, size, SHA-256 and extracted file identities. The release compiler is nvcc 12.9.86 with one unique stable per-source `--frandom-seed`; never scrape an installed Toolkit for release bytes.

### Download artifact

Publish one immutable project-controlled combined CUDA pack. `runtime-dependency-sources.json` points to that pack with exact size/SHA. China source, if present, must serve byte-identical bytes; otherwise CUDA uses official only.

### Licenses

- Include exact NVIDIA CUDA license/third-party notices unchanged.
- Record CUDA Runtime static linkage and bundled cuBLAS/cuBLASLt files in machine-readable inventory.
- State that NVIDIA and Microsoft runtime components are excluded from the project Apache-2.0 grant and governed by included terms.
- Treat legal-owner review of NVIDIA application-distribution terms as a release gate.

## 8. Compatibility and migration

- Existing settings values `auto|cpu|cuda` require no schema migration; saved CUDA becomes usable when capability is ready.
- Existing model cache layout and model manifests remain unchanged.
- Existing CPU users do not download the CUDA pack.
- Existing CPU artifact/package budgets remain unchanged; CUDA gets separate compressed/unpacked/storage budgets.
- The GPU pack can be removed independently; `auto` then uses CPU, while explicit CUDA reports download-required.

## 9. Verification strategy

### No-GPU/static gates

- native unit tests for compute mapping and unsupported capability rows;
- two clean multi-architecture CUDA builds and byte comparison;
- exact expanded NVCC flags;
- `cuobjdump` SASS/PTX inspection;
- archive/tree/import/dynamic-module/license mutation tests;
- Rust resolver policy tests with fake CPU/CUDA runtimes and probe outputs;
- frontend capability/download/continuation tests;
- CPU full regression.

### RTX 3070 real gates

Against the final artifact SHA:

- capability probe reports device 0 / CC 8.6 / FLOAT16 / real-tested;
- loaded-module discovery proves pack cuBLAS/cuBLASLt plus system `nvcuda.dll`, with no ambient Toolkit/cuDNN override;
- all eight models pass short smoke;
- large-v2 and Kotoba pass their >10 minute gates;
- cancel after ready, recovery, reap and active-slot release pass;
- installed-like and portable-like managed-pack resolution pass;
- offline rerun proves no network or Python fallback;
- a pass with `CUDA_DISABLE_PTX_JIT=1` proves native `sm_86` execution.

### Theoretical compatibility gates

For CC 6.1/7.5/8.9/12.0:

- compiler accepts target;
- final DLL contains exact native SASS;
- policy resolver selects the documented compute type;
- CTranslate2 source predicates remain pinned;
- docs label the row theoretical and describe VRAM/driver caveats.

## 10. Rollout and rollback

1. Land worker/build/verifier changes while product CUDA remains disabled.
2. Produce and verify final CUDA artifact.
3. Land managed dependency/probe and backend capability reporting.
4. Land frontend download/selection flow behind actual capability.
5. Run final RTX 3070 and package gates.
6. Update specs/docs and enable CUDA in production metadata.

Rollback removes or disables the CUDA source/profile and capability advertisement; CPU runtime, models, settings and commands continue unchanged. Do not delete user models or restore Python.

## 11. Final local artifact freeze and publication gate

The reviewed release artifact is now frozen locally on CUDA 12.9 Update 1:

- build-only authorities: nvcc 12.9.86, CUDART 12.9.79 static inputs, cuobjdump 12.9.82, and cuRAND 10.3.10.19;
- build/runtime authority: cuBLAS 12.9.1.4, with only `cublas64_12.dll` and `cublasLt64_12.dll` selected for deployment;
- deterministic CUDA compilation: one normalized-relative-path seed per 25 CTranslate2 CUDA translation units through the locked launcher;
- stable host ISA policy: tracked AVX/AVX2/AVX512 wrappers, not build-root-generated source copies;
- independent build roots: byte-identical 156-object CTranslate2 sets and byte-identical worker/CT2/tokenizer outputs;
- independent packages: byte-identical complete ZIPs, size `571,034,856`, SHA-256 `9ca8511365009794a32f14e6fcaeb5aada9e088e9186125e9f3b54db74e300b4`.

Packaging verifies the raw final build identities first, then performs two fixed-length diagnostic-string normalizations on copied payloads only: the legacy oneDNN private source prefix and the Cargo registry user prefix. Both replacements are unique, fail closed, preserve file length with underscore padding, and are frozen by final staged file hashes plus complete ZIP equality.

The final local pack passes closed-tree verification, exact SASS/PTX audit, restricted RTX 3070 probe, model-backed CUDA completion, and loaded-module closure. cuRAND stays build-only because `curand64_10.dll` is absent from both PE imports and the completed module sample.

Product enablement remains deliberately separate from local qualification. The lock keeps `productEnablementAllowed=false`; no source profile row is allowed until the exact ZIP bytes are published at a stable immutable remote URL. External publication is the only pending artifact-distribution gate and is explicitly outside this implementation run. The all-eight-model/long/native-sm86 matrix is complete, but an exact-final-worker Rust-host cancellation/recovery/reap/active-slot record is still required before the broader product-enable conclusion is truthful.

## 12. Risks and mitigations

- **Large pack size:** on-demand managed pack with separate budget; no installer impact.
- **Ambient Toolkit DLL hijack:** restricted child environment and loaded-module root attestation.
- **Pascal quality/performance uncertainty:** deterministic `INT8_FLOAT32`, theoretical label, controlled OOM/model errors.
- **Blackwell uncertainty with pinned CT2:** native `sm_120` compilation/fatbin evidence and theoretical label until real hardware exists.
- **Driver drift:** absolute technical floor plus a product-qualified floor and structured probe errors.
- **Old evidence reuse:** every release claim binds to the final artifact SHA; archived evidence is design input only.
- **CPU regression:** separate artifact roots, locks, host caches and package gates.
