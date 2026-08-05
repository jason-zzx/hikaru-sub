# T07 CUDA Development Design Inputs

## Recommendation

Implement one opt-in Windows x64 CUDA build of the existing `hikaru-asr-worker`. Keep the existing protocol, worker entry point, Whisper algorithm, tokenizer, model, Rust host, and CPU presets. The CUDA-enabled binary should support both paired CPU and CUDA requests; request mapping is explicit, CUDA is device index `0`, CPU uses CTranslate2 `INT8`, and CUDA uses CTranslate2 `FLOAT16`.

Do not add a runtime pack, resolver, downloader, UI, production environment variable, second worker, second protocol, automatic fallback, or CUDA-specific decoding algorithm.

## Findings From The Current Tree

- Protocol v1 and the Rust host already accept `device="cuda"` for CTranslate2 and reject a `ready` event whose backend/device differs from the request.
- `native-asr/src/main.cpp` currently rejects every non-CPU request and emits `ready.device=cpu`.
- `native-asr/src/ctranslate2_whisper.cpp` constructs Whisper with `Device::CPU`, `ComputeType::INT8`, and device index `{0}`.
- `native-asr/CMakeLists.txt` keeps the CT2 worker opt-in, but the CT2 branch currently forces `WITH_CUDA=OFF` and `WITH_CUDNN=OFF`.
- The protocol-only preset remains independent because `HIKARU_ASR_BUILD_CT2_WORKER=OFF` by default. Preserve this boundary.
- The existing evidence runner already records feature, generate, inference, load, process wall, token/window, model, worker, DLL, CPU, and module data. It currently hard-codes CPU/int8 and only performs full loaded-module validation for Candidate B.
- The existing model-backed Rust seam is entirely under `#[cfg(test)]`. It covers success, structured pre-ready failure, recovery, and real-worker cancellation, but its helper hard-codes CPU.
- The T06 cancellation test waits for product status `running`, not proof that `ready` was consumed. For the CUDA case, wait until `durationMs > 0` (or another ready-derived field) before cancelling.
- The pinned local CTranslate2 checkout is clean tag `v4.8.0`, commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`.

## CUDA And cuDNN Inputs

### CUDA

Use the already installed CUDA Toolkit `12.8.93` as an attested development compiler/runtime input. Before configuration, lock:

- official installer/product identity and local `nvcc --version`;
- sizes and SHA-256 values of `nvcc.exe`, the CUDA headers/import libraries consumed by CMake, and every CUDA DLL actually loaded by a measured run;
- MSVC, CMake, Ninja, Windows, GPU, driver, and CTranslate2 identities;
- `CUDA_TOOLKIT_ROOT_DIR`/`CUDA_PATH` as ignored raw path data, publishing only a stable root role plus component hashes.

Configure the CUDA build with:

- `WITH_DNNL=ON` so the same CUDA-enabled binary can run the paired CPU baseline;
- `WITH_CUDA=ON`;
- `CUDA_DYNAMIC_LOADING=ON`;
- `CUDA_ARCH_LIST=8.6` for the declared RTX 3070-only development lane;
- `WITH_CUDNN=OFF` initially;
- existing `WITH_HIP`, tensor parallel, flash attention, CLI, and upstream tests disabled as today.

Using exact architecture `8.6` is smaller and faster to build than upstream `Common`, and T07 explicitly supports only the declared development machine. `Common` belongs to later pack/matrix work unless another development GPU is added by requirement.

The device still comes only from the protocol request. `CUDA_PATH` is DLL discovery input for CTranslate2 dynamic loading; it must never select or relabel the requested device.

### cuDNN

The pinned CTranslate2 Windows preparation script downloads CUDA `12.8.1` and cuDNN `9.10.2`, but its actual CMake command uses `WITH_CUDNN=OFF`. CTranslate2 documentation requires cuDNN only when `WITH_CUDNN=ON`; it is not a prerequisite for the CUDA backend itself.

Therefore the smallest safe T07 lane should **not download, install, link, or load cuDNN**. Record cuDNN `9.10.2` as reviewed but intentionally unused, and have evidence reject unexpected `cudnn*.dll` modules for this build identity. This also avoids the upstream script's unsuitable global install/copy into the CUDA Toolkit directory.

Only if the CUDA path cannot execute, or a measured no-speedup result is traced specifically to operations requiring cuDNN, open a new build identity: download the exact official cuDNN `9.10.2` archive/installer below `research/local/downloads/`, verify size/SHA-256, extract without global installation below `research/local/deps/`, pass explicit include/library paths, place runtime DLLs under an ignored task-local runtime root, and set `WITH_CUDNN=ON`. Do not mutate the system CUDA installation.

## Compute Type

Use this fixed mapping in structured backend configuration:

| Protocol device | CTranslate2 device | Device index | Compute type |
|---|---|---:|---|
| `cpu` | `Device::CPU` | `0` | `ComputeType::INT8` |
| `cuda` | `Device::CUDA` | `0` | `ComputeType::FLOAT16` |

RTX 3070 has compute capability `8.6`, which supports CTranslate2 CUDA FP16. `FLOAT16` is also the parent design's selected CUDA default and the ordinary faster-whisper CUDA baseline. Do not introduce `INT8_FLOAT16`, BF16, flash attention, or a compute-type search in T07; those would create another algorithm/runtime variant and are unnecessary for the development-speed decision.

Before model construction for CUDA, require device count `> 0` and require `FLOAT16` in CTranslate2's supported compute types for device `0`. There is no CPU fallback.

## Minimal Device Plumbing

Add one small structured configuration passed to the existing backend constructor, for example the semantic equivalent of:

```text
BackendExecutionConfig {
  protocolDevice,
  ctranslate2Device,
  computeType,
  deviceIndex
}
```

The exact type need not be public beyond the current backend header.

Flow:

1. `main.cpp` maps `request.device` to the fixed table above; Vulkan remains rejected.
2. Validate CUDA build support, device `0`, and FP16 support before constructing the model.
3. Construct the existing `CTranslate2WhisperBackend` with the structured configuration.
4. Constructing the backend/model must fail closed before `ready` when CUDA runtime/device/model loading fails.
5. Emit `ready.device=request.device` only after successful construction and pre-ready attestation.
6. Run the unchanged timestamp-driven, no-history, beam-1 pipeline.

Keep stable pre-ready codes, with narrow categories such as `cuda_not_built`, `cuda_device_unavailable`, `cuda_compute_type_unsupported`, and `cuda_runtime_failed`. Do not expose raw driver exceptions or absolute paths.

The CPU preset may compile the same source without CUDA; a CUDA request to that binary must return `cuda_not_built` before `ready`, not silently run CPU.

## GPU And Module Attestation

### Worker-side fail-closed checks

Before `ready` on a CUDA request:

- the binary was built with CUDA support;
- CTranslate2 reports at least one CUDA device;
- device index is exactly `0`;
- device `0` supports `FLOAT16`;
- the CTranslate2 Whisper model successfully constructs with `Device::CUDA`, `FLOAT16`, `{0}`.

CTranslate2 receives an explicit device and does not use `auto`, so construction failure must propagate as a structured pre-ready error.

### Evidence-run attestation

Extend the existing Windows evidence runner rather than creating another benchmark executable. After a completed CUDA transcription, record in ignored raw evidence:

- requested and resolved device;
- compute type and device index;
- GPU 0 name, compute capability, and driver version (CUDA Driver API or a locked `nvidia-smi` query; no new library is required);
- the measurement executable, production worker, CT2 DLL, tokenizer DLL, model/config/audio identities;
- actual loaded relevant modules with size, SHA-256, version, and canonical path;
- feature, generate, inference, sample wall, load, and cold process wall timings.

For the recommended dynamic-loading/no-cuDNN build, run separate unscored completed CPU and CUDA discovery processes under the same CUDA-enabled binary identity. Compare them to derive shared, CPU-only, and CUDA-only required module sets before formal measurements. Do not guess names permanently from one CUDA row; likely CUDA-only Windows modules include `nvcuda.dll`, `cublas64_12.dll`, `cublasLt64_12.dll`, CUDA runtime/curand modules, while `ctranslate2.dll` belongs to the shared set. Require `nvcuda.dll` from the Windows driver root and toolkit modules from the locked CUDA root. Reject module-root or hash drift.

The publisher/validator must reject:

- requested CUDA with resolved CPU;
- CUDA evidence without device `0`, FP16 support, or a completed transcription;
- missing required loaded CUDA modules;
- unexpected cuDNN modules in the no-cuDNN identity;
- worker/runner/CT2/tokenizer/model/config/audio drift between paired rows;
- module hash/root drift, including a correlated rewrite of all module paths;
- raw transcript/event content or absolute paths in tracked output.

Module loading plus an explicitly constructed CUDA model and a completed `generate` is the execution attestation. A device string alone is not evidence.

## Paired CPU/GPU Benchmark Harness

Reuse the existing `hikaru-asr-ctranslate2-tests` evidence mode and T06 timing structs. Add a device/config argument only to the evidence path; do not add benchmark fields to protocol v1.

Use the CUDA-enabled binary for both CPU and GPU measurements so worker source, runner, CT2 build, tokenizer, algorithm, and model are identical. Only the fixed device/compute mapping differs.

Samples:

- authoritative `short-v1` (`24.102s`);
- the existing deterministic first `120s` slice of `medium-v1`, whose T06 identity is already fixed privately (`d7b8c62d...` slice from the locked medium WAV). Reuse it instead of creating another sample.

For each sample and device:

- construct one backend/model;
- run exactly four transcriptions: first `cold`, next three `warm`;
- retain all four raw timing rows;
- compute the median of the three warm inference RTF values;
- also record feature, generate, sample wall, load, cold process wall, GPU/CPU identity, loaded modules, requested/resolved device, and compute type.

The deterministic stdlib publisher has two valid input shapes. The success/no-speedup path consumes four ignored raw files (short CPU/GPU and 120s CPU/GPU), validates identities, and publishes aggregate data. The unavailable path consumes a separately validated sanitized failure envelope and is limited to configure/build failure or structured pre-ready CUDA runtime/device/model failure. It should emit exactly one result only for a valid input shape:

- `development-gpu-unavailable` only for the valid unavailable envelope above;
- `development-gpu-no-speedup` if CUDA execution is attested and completed but either sample has `gpuWarmMedianRtf > cpuWarmMedianRtf * 0.80`;
- `development-gpu-ready` only when both samples satisfy `gpuWarmMedianRtf <= cpuWarmMedianRtf * 0.80`.

Missing raw files, identity/module attestation drift, publisher validation failure, or post-ready incomplete execution produce no development result and do not authorize CPU fallback.

Report `GPU median RTF <= 0.5` separately as diagnostic. Do not run CER, gap, segmentation-quality, or subtitle-text scoring in this publisher.

Run CPU and GPU as separate process invocations. This keeps each cold/warm series independent and avoids holding both large-v3 replicas in memory simultaneously.

## Host Compatibility And Cancellation

Reuse `src-tauri/src/asr_worker.rs`; production host code already validates CUDA and enforces `ready` route equality. Only the `#[cfg(test)]` model-backed helper needs generalization.

Recommended focused coverage with the CUDA-enabled worker:

1. CUDA success through `NativeAsrHost`, asserting completed, legal timeline, recovery file, output file, reaped process, and released active gate.
2. Structured pre-ready CUDA failure, asserting the safe machine code is preserved in recovery and no `ready`/completed state is accepted.
3. CUDA cancellation using the private 120s sample: wait until a ready-derived `durationMs > 0`, cancel, require `cancelled`, no detected language/completed output, process reaped, active gate released, and elapsed cancellation no more than two seconds.

A test-only device selector may be added beside the existing three model-backed environment inputs, but it must remain inside `#[cfg(test)]`. Release/default/product routing must not read it. Prefer reusing the same worker/model/audio path variables and adding only the device value; do not add a product CUDA path resolver.

Keep the fake-worker process-tree tests unchanged; they remain the deterministic child-tree kill coverage. The real CUDA cancellation test proves compatibility with a GPU-loaded production worker, not a new cancellation mechanism.

## CMake And CI Isolation

Smallest safe build shape:

- keep `HIKARU_ASR_BUILD_CT2_WORKER=OFF` by default;
- add one default-off CUDA cache option consumed only inside the existing CT2 block;
- keep `windows-x64-release` protocol-only and `windows-x64-ct2-release` CPU-only;
- add `windows-x64-ct2-cuda-development` with a distinct binary directory below this task's ignored `research/local/build/`;
- set CUDA toolkit/architecture/dynamic-loading values only in that preset;
- do not add the CUDA preset to ordinary CI, package scripts, release workflows, trusted manifests, installer inputs, or portable ZIP inputs.

The CUDA-enabled CT2 build should retain oneDNN so it can execute paired CPU requests. CUDA/cuDNN discovery must occur only when the explicit CUDA option is on. A machine without CUDA must still configure, build, and test protocol-only and CPU CT2 presets exactly as before.

Required regression commands after implementation:

```text
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release

cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release

cmake --preset windows-x64-ct2-cuda-development
cmake --build --preset windows-x64-ct2-cuda-development
ctest --preset windows-x64-ct2-cuda-development

cargo test --manifest-path src-tauri/Cargo.toml asr_worker -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

The first two preset groups and ordinary Rust tests must not require CUDA environment variables or CUDA/cuDNN installation.

## Privacy And Ignore Boundary

Add the active/archive-safe rule before creating local output:

```text
/.trellis/tasks/**/08-04-native-asr-ctranslate2-cuda-development/research/local/
```

Keep CUDA build trees, dependency archives/extraction, model aliases, private audio, worker requests/events/transcripts, module paths, and raw benchmark JSON below that root. Tracked evidence may contain versions, hashes, root roles, sanitized GPU/driver identity, aggregate timings, commands, limitations, and the one development result, but no absolute paths or subtitle text.

## Minimum Expected Code Surface

Likely existing files only:

- `.gitignore` — one active/archive local-root rule;
- `native-asr/CMakeLists.txt` and `native-asr/CMakePresets.json` — opt-in CUDA build;
- `native-asr/src/ctranslate2_whisper.hpp/.cpp` — structured execution configuration and narrow attestation accessors/checks;
- `native-asr/src/main.cpp` — request mapping and truthful ready device;
- `native-asr/tests/ctranslate2_whisper_tests.cpp` — paired evidence and CUDA module/device attestation;
- `src-tauri/src/asr_worker.rs` — test-module-only CUDA success/failure/cancel generalization;
- T07 `research/` — one lock, one stdlib publisher/validator, sanitized result/report, and ignored `local/` raw data.

No new production subsystem or dependency is justified.

## Risks To Carry Into Design

- CTranslate2 CUDA libraries may load some modules lazily. Freeze shared/CPU-only/CUDA-only module sets only after separate completed CPU and CUDA discovery generations, not merely process start/model construction; rerun all formal measurements afterward.
- The upstream Windows helper's cuDNN download is not evidence that `WITH_CUDNN=ON`; its CMake command explicitly disables cuDNN.
- Dynamic loading consults `CUDA_PATH`; bind and attest the root, but never use it for device resolution.
- The current CT2 CMake block also carries T06 Candidate B ORT inputs. Do not refactor ORT/VAD out solely for T07 unless it blocks the CUDA build; paired runs must set `useVad=false` and use the selected no-history/beam-1 baseline.
- CUDA short inference may finish too quickly for a cancellation race. Use the private 120s diagnostic sample and wait for a ready-derived field before cancelling.
- `development-gpu-ready` is not a product qualification, pack, redistribution, driver floor, or subtitle-quality result.

## Inspected Authority

- Active T07 PRD and parent PRD/design/implementation/research.
- Archived T06 PRD/design/implementation plus start, algorithm, selected CPU, CPU RTF, planning, host, evidence, and privacy handoffs.
- Current native ASR CMake presets, worker/backend/protocol/tests, and Rust native host tests.
- Pinned local CTranslate2 `v4.8.0` source, installation documentation, CMake CUDA/cuDNN logic, Windows/Linux build preparation scripts, device/compute APIs, and CUDA source paths.
