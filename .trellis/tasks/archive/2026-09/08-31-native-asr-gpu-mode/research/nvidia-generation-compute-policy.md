# Research: NVIDIA generation compute and architecture policy for Native ASR CUDA

- Query: Research pinned CTranslate2 4.8.0 and official CUDA 12.8 support to define the minimum correct GPU compute-type and compiled-architecture policy for common desktop GTX 10 and RTX 20/30/40/50 series, with real qualification only on the local RTX 3070.
- Scope: mixed
- Date: 2026-08-31

## Executive decision

Use **one CUDA-enabled CTranslate2 4.8.0 runtime** containing native SASS for exactly the five desktop architecture rows required by the PRD:

- `sm_61` — common desktop GeForce GTX 10 series (Pascal)
- `sm_75` — GeForce RTX 20 series (Turing)
- `sm_86` — GeForce RTX 30 series (Ampere)
- `sm_89` — GeForce RTX 40 series (Ada)
- `sm_120` — GeForce RTX 50 series (Blackwell)

The required runtime compute mapping is:

- **CC 6.1 → CTranslate2 `INT8_FLOAT32`**
- **CC 7.5 / 8.6 / 8.9 / 12.0 → CTranslate2 `FLOAT16`**
- all other capabilities → unsupported by this first desktop policy, even if generic CTranslate2 could run some of them

This is the smallest truthful policy that covers the named desktop generations. It avoids pretending that Pascal supports CTranslate2's efficient FP16 path, keeps the already proven RTX 3070 lane on FP16, and avoids adding unrelated Volta, datacenter Ampere, Hopper, or Jetson architectures.

The recommended artifact should additionally contain **`compute_120` PTX** as non-claimed forward-compatibility insurance, but it must still contain native `sm_120` SASS. PTX must not be used to claim support for an untested future device or for CC 12.1.

CUDA 12.8 can compile native SASS for `sm_61`, `sm_75`, `sm_86`, `sm_89`, and `sm_120`. It **cannot** compile `sm_121`; the installed official `nvcc 12.8.93` does not list that target. Current GeForce RTX 50 desktop cards are CC **12.0**, so `sm_120` is the correct RTX 50 target. NVIDIA's current table assigns CC **12.1** to GB10/DGX Spark, not to GeForce RTX 50.

Only `sm_86` / RTX 3070 may be described as **real tested** in this task. The other four rows may be described only as **theoretically compatible**, subject to a successful final multi-architecture build, fatbin inspection, model-fit/VRAM checks, and the caveats below.

## Files found

| File path | Description |
|---|---|
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/python/ctranslate2/version.py:1-3` | Confirms the vendored/pinned source is CTranslate2 `4.8.0`. |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/docs/quantization.md:54-103` | Pinned compute-type options and GPU capability fallback table. |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/docs/quantization.md:108-132` | INT8 support floor and explanation that non-quantized layers retain a floating-point type. |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/include/ctranslate2/types.h:44-54` | C++ capability-query API and `resolve_compute_type`, whose explicit-request fallback default is false. |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/src/types.cc:110-149` | `mayiuse_float16` and `mayiuse_int8` implementations. |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/src/types.cc:151-291` | Exact explicit/default/auto compute-type resolution behavior. |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/src/cuda/utils.cc:225-238` | NVIDIA capability predicates: INT8 on major >6 or exactly 6.1; FP16 Tensor Core policy on major >=7. |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/src/models/model.cc:176-195` | Model load resolves the explicitly requested type before moving/converting weights. |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/python/cpp/module.cc:13-44` | Runtime supported-compute-type query is assembled from the same C++ predicates. |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/src/cuda/primitives.cu:487-597` | FP32, FP16, and INT8 CUDA GEMM paths delegate to cuBLAS without a hard-coded maximum compute capability. |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/CMakeLists.txt:494-543` | Pinned CUDA build uses legacy `FindCUDA`, accepts `CUDA_ARCH_LIST`, appends generated `-gencode` flags, and preserves caller-supplied `CUDA_NVCC_FLAGS`. |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/src/CTranslate2/docs/installation.md:94-111` | Documents `CUDA_ARCH_LIST` and `CUDA_NVCC_FLAGS` as supported build inputs. |
| `native-asr/src/ctranslate2_whisper.hpp:37-64` | Current product backend only represents CPU INT8 and CUDA FP16; it cannot yet represent Pascal's required `INT8_FLOAT32`. |
| `native-asr/src/ctranslate2_whisper.cpp:962-1040` | Current CUDA preflight hard-requires FP16 and major >=7, then maps CUDA to `ComputeType::FLOAT16`. |
| `.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/research/cuda-input-lock.md:15-47` | Prior real lane: RTX 3070, CC 8.6, CUDA 12.8.93, CTranslate2 4.8.0, exact `CUDA_ARCH_LIST=8.6`. |
| `.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/research/cuda-input-lock.md:71-91` | Prior real lane used CUDA FP16 and records the large-v3 model identity and 3,087,284,237-byte `model.bin`. |
| `.trellis/tasks/08-31-native-asr-gpu-mode/research/prior-gpu-transcription-evidence.md:9-49` | Accepted real RTX 3070 execution evidence and its exact tool/runtime identity. |

## 1. Exact desktop compute capabilities

NVIDIA's official current and legacy tables support this mapping:

| Product family in scope | Common desktop models | NVIDIA architecture | Compute capability | Exact native target | Evidence status in this task |
|---|---|---|---:|---|---|
| GeForce GTX 10 | GTX 1080 Ti, 1080, 1070 Ti, 1070, 1060, 1050 | Pascal | **6.1** | `sm_61` | theoretical only |
| GeForce RTX 20 | RTX 2080 Ti, 2080/SUPER, 2070/SUPER, 2060/SUPER | Turing | **7.5** | `sm_75` | theoretical only |
| GeForce RTX 30 | RTX 3090 Ti through RTX 3050, including Ti variants | Ampere | **8.6** | `sm_86` | **real tested only on local RTX 3070 8 GiB** |
| GeForce RTX 40 | RTX 4090 through RTX 4060 and current desktop/SUPER/Ti variants | Ada | **8.9** | `sm_89` | theoretical only |
| GeForce RTX 50 | RTX 5090, 5080, 5070 Ti, 5070, 5060 Ti, 5060, 5050 | Blackwell | **12.0** | `sm_120` | theoretical only |

Important boundaries:

- NVIDIA's legacy table places the listed GTX 10 cards in the **6.1** row. Pascal is not uniformly CC 6.1 across all NVIDIA products: Tesla P100/Quadro GP100 are CC 6.0, while Jetson TX2 is CC 6.2. Those are not the common desktop GTX 10 target and should not be admitted by a loose `major == 6` rule.
- NVIDIA's current table places all listed GeForce RTX 20 cards in **7.5**, RTX 30 in **8.6**, RTX 40 in **8.9**, and current GeForce RTX 50 cards in **12.0**.
- The same current table has a **12.1** row for NVIDIA GB10/DGX Spark. CC 12.1 is not the GeForce RTX 50 target.
- Marketing-family matching is unnecessary at runtime. The authoritative decision input should be queried numeric compute capability plus the explicit compiled-target allowlist.

Official references:

- [NVIDIA CUDA GPU Compute Capability](https://developer.nvidia.com/cuda-gpus) — current RTX rows, including CC 12.0 GeForce RTX 50 and CC 12.1 GB10.
- [NVIDIA Legacy CUDA GPU Compute Capability](https://developer.nvidia.com/cuda-legacy-gpus) — CC 6.1 GTX 1080 Ti through GTX 1050.
- [RTX 3070 family specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/30-series/rtx-3070-3070ti/) — official product-page CC 8.6 confirmation.
- [RTX 4080 family specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4080-family/) — official product-page CC 8.9 confirmation.
- [RTX 5090 specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/) — official product-page CC 12.0 confirmation.

## 2. CUDA 12.8 compiler targets

The locally installed official compiler used by the prior GPU lane reports:

```text
nvcc: release 12.8, V12.8.93

--list-gpu-code:
sm_50 sm_52 sm_53 sm_60 sm_61 sm_62 sm_70 sm_72 sm_75
sm_80 sm_86 sm_87 sm_89 sm_90 sm_100 sm_101 sm_120

--list-gpu-arch:
compute_50 compute_52 compute_53 compute_60 compute_61 compute_62
compute_70 compute_72 compute_75 compute_80 compute_86 compute_87
compute_89 compute_90 compute_100 compute_101 compute_120
```

Therefore:

| Requested target | CUDA 12.8 result | Policy consequence |
|---|---|---|
| Pascal 6.1 | `sm_61` and `compute_61` available | Native GTX 10 SASS is buildable. |
| Turing 7.5 | `sm_75` and `compute_75` available | Native RTX 20 SASS is buildable. |
| Ampere 8.6 | `sm_86` and `compute_86` available | Native RTX 30 SASS is buildable. |
| Ada 8.9 | `sm_89` and `compute_89` available | Native RTX 40 SASS is buildable. |
| Blackwell 12.0 | `sm_120` and `compute_120` available | Native RTX 50 SASS and latest PTX are buildable. |
| 12.1 | no `sm_121` or `compute_121` | CUDA 12.8 cannot emit native 12.1 SASS; do not configure or claim it. |

CUDA 12.8 still supports offline compilation for Pascal. NVIDIA marks Maxwell, Pascal, and Volta feature-complete/deprecated and says their offline compiler support is removed in the next major toolkit, not in CUDA 12.8. This pins Pascal support to the CUDA 12.x toolchain family and is a reason not to casually move this runtime to CUDA 13.

Official references:

- [CUDA Compiler Driver 12.8](https://docs.nvidia.com/cuda/archive/12.8.0/cuda-compiler-driver-nvcc/index.html) — `--list-gpu-code`, `--list-gpu-arch`, and `-gencode` semantics.
- [CUDA 12.8 release notes](https://docs.nvidia.com/cuda/archive/12.8.0/cuda-toolkit-release-notes/) — deprecated-architecture status.
- [CUDA Toolkit 12.8 delivers Blackwell support](https://developer.nvidia.com/blog/cuda-toolkit-12-8-delivers-nvidia-blackwell-support/) — full Blackwell compiler support and continued CUDA 12.x offline support for older architectures.
- [Blackwell compatibility guide](https://docs.nvidia.com/cuda/blackwell-compatibility-guide/index.html) — native cubin/SASS avoids PTX JIT; PTX is forward-compatible fallback, not a substitute for native code on claimed targets.

## 3. CTranslate2 4.8.0 behavior by compute type

### Capability predicates

Pinned CTranslate2 4.8.0 defines:

- `mayiuse_float16(CUDA)` as true when the GPU has FP16 Tensor Cores, implemented as compute-capability major >=7, unless the user forcibly bypasses it with `CT2_CUDA_ALLOW_FP16` (`src/types.cc:110-124`; `src/cuda/utils.cc:235-238`).
- `mayiuse_int8(CUDA)` as true when major >6 or exactly CC 6.1 (`src/types.cc:135-149`; `src/cuda/utils.cc:225-228`).
- `FLOAT32` as unconditionally supported by compute-type resolution (`src/types.cc:168-170`).

The production runtime should keep `CT2_CUDA_ALLOW_FP16` unset/false. Forcing this environment variable would bypass CTranslate2's declared efficient-FP16 policy on Pascal and undermine truthful capability reporting.

### Explicit request versus implicit fallback

The pinned documentation's fallback table must not be read as “an explicit FP16 request silently works everywhere.” The source distinguishes two cases:

1. `Model::set_compute_type` calls `resolve_compute_type` for the application's requested type (`src/models/model.cc:176-195`).
2. `resolve_compute_type` defaults `enable_fallback=false` (`include/ctranslate2/types.h:49-54`).
3. Therefore an explicit unsupported `FLOAT16` or `INT8_FLOAT32` request throws (`src/types.cc:172-177,229-239`).
4. Fallback is enabled for `DEFAULT`/saved-model resolution (`src/types.cc:284-291`) and internally while resolving generic `INT8` (`src/types.cc:200-226`).

For this product, explicit deterministic compute types are preferable to saved-model-dependent fallback.

### Exact behavior matrix

| GPU capability | Explicit `FLOAT16` | Explicit `FLOAT32` | Explicit `INT8_FLOAT32` | CT2 `AUTO` result | Product selection |
|---:|---|---|---|---|---|
| 6.0 | rejected | works | rejected | `FLOAT32` | unsupported |
| **6.1** | rejected | works | **works** | `INT8_FLOAT32` | **`INT8_FLOAT32`** |
| 6.2 | rejected | works | rejected | `FLOAT32` | unsupported |
| 7.0–7.x, including **7.5** | works | works | works | `INT8_FLOAT16` | **`FLOAT16`** for 7.5 |
| 8.x, including **8.6/8.9** | works | works | works | `INT8_FLOAT16` | **`FLOAT16`** |
| 12.0 | works by CT2's major-based predicates | works | works | `INT8_FLOAT16` | **`FLOAT16`**, theoretical until real hardware evidence |

Two consequences are important:

- Do **not** use CTranslate2 `AUTO` for this feature. On every RTX row it chooses `INT8_FLOAT16`, which changes the already accepted RTX 3070 FP16 execution identity and quality/performance evidence (`src/types.cc:267-281`).
- Do **not** use `FLOAT32` as the normal GTX 10 mapping. It is technically valid but consumes substantially more VRAM and leaves the CC 6.1 INT8 path unused. `INT8_FLOAT32` is the CTranslate2-documented Pascal 6.1 path.

Pinned upstream references:

- [CTranslate2 v4.8.0 quantization documentation](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/docs/quantization.md#L54-L132)
- [CTranslate2 v4.8.0 compute-type resolution](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/src/types.cc#L110-L291)
- [CTranslate2 v4.8.0 CUDA capability predicates](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/src/cuda/utils.cc#L225-L238)
- [CTranslate2 v4.8.0 model compute-type setup](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/src/models/model.cc#L176-L224)

## 4. Can one runtime select the compute type at runtime?

Yes. A separate Pascal and RTX CTranslate2 DLL is not required.

A single fat binary can contain all five SASS images. At process startup, the product can query device 0's compute capability, choose the product compute type, and then construct the same CTranslate2 Whisper model with that type. CTranslate2 itself already queries the selected device for FP16 and INT8 support; its Python `get_supported_compute_types` wrapper is only a thin set assembled from the C++ `mayiuse_*` functions (`python/cpp/module.cc:13-44`).

Recommended decision function:

```text
capability = (major, minor) from CUDA Driver API for visible device 0

if capability == (6, 1):
    require ctranslate2::mayiuse_int8(CUDA, 0)
    compute_type = INT8_FLOAT32
else if capability in {(7,5), (8,6), (8,9), (12,0)}:
    require ctranslate2::mayiuse_float16(CUDA, 0)
    compute_type = FLOAT16
else:
    unsupported architecture for this runtime policy
```

Then construct the model exactly once with the resolved type and attest the **effective requested compute type** in the ready/capability result. Do not try FP16 first and catch/fallback to INT8; choose before model construction. Do not silently switch to CPU.

The explicit allowlist is intentional. A test such as `major >= 7` would wrongly report architectures absent from the artifact—e.g. `sm_70`, `sm_80`, or `sm_90`—as supported, leading to `no kernel image` at execution. Availability is the intersection of:

1. an allowed queried capability;
2. the matching native SASS image in the final CTranslate2 DLL;
3. CTranslate2's compute-type predicate;
4. a compatible NVIDIA driver and bundled CUDA libraries;
5. enough free VRAM for the selected model.

### Current repo gap

The current backend cannot express this mapping yet:

- `ExecutionComputeType` contains only `Int8` and `Float16` (`native-asr/src/ctranslate2_whisper.hpp:42-50`).
- CUDA validation hard-requires `Float16`, major >=7, and `mayiuse_float16` (`native-asr/src/ctranslate2_whisper.cpp:962-1026`).
- CUDA construction maps only to `ComputeType::FLOAT16` (`native-asr/src/ctranslate2_whisper.cpp:1037-1040`).

A later implementation therefore needs an internal `Int8Float32` representation and a capability-to-config resolver. This research does not modify that code.

## 5. Minimum correct CMake/NVCC architecture policy

### Required native SASS

The strict minimum for the named desktop scope is:

```text
-gencode=arch=compute_61,code=sm_61
-gencode=arch=compute_75,code=sm_75
-gencode=arch=compute_86,code=sm_86
-gencode=arch=compute_89,code=sm_89
-gencode=arch=compute_120,code=sm_120
```

Recommended addition:

```text
-gencode=arch=compute_120,code=compute_120
```

The PTX row is optional for current named-card correctness. It should be included as a modest forward-compatibility/debugging measure, while product support remains limited to exact native-SASS rows. It does not establish CC 12.1 support, and it must not replace `sm_120`.

### Pinned CTranslate2/FindCUDA Blackwell trap

Pinned CTranslate2 4.8.0 uses legacy `FindCUDA` and calls `cuda_select_nvcc_arch_flags` (`CMakeLists.txt:494-543`). The exact CMake 4.1.1-msvc1 helper used in the prior lane has an old numeric parser:

- numeric architecture regex accepts only one digit, a dot, and one digit (`select_compute_arch.cmake:201-216`);
- `12.0` is therefore rejected as an unknown named architecture (`select_compute_arch.cmake:217-249`);
- generated SASS/PTX flags are otherwise straightforward (`select_compute_arch.cmake:260-293`).

So **do not** set `CUDA_ARCH_LIST=...;12.0` or `12.0+PTX` with this exact build stack.

Minimum no-source-patch configuration:

```text
CUDA_ARCH_LIST=6.1;7.5;8.6;8.9
CUDA_NVCC_FLAGS=
  -gencode=arch=compute_120,code=sm_120;
  -gencode=arch=compute_120,code=compute_120
```

CTranslate2 documents both cache inputs (`docs/installation.md:94-111`), preserves caller-supplied `CUDA_NVCC_FLAGS`, and then appends the `CUDA_ARCH_LIST`-generated flags (`CMakeLists.txt:525-543`). The final build lock must record the fully expanded flags emitted by CMake, not only the cache variables.

This is preferable to patching upstream source for the minimum implementation. If the project later patches the numeric regex to accept multi-digit capabilities, that patch becomes a new pinned source input and requires reproducibility and qualification review.

External CMake reference:

- [CMake FindCUDA](https://cmake.org/cmake/help/latest/module/FindCUDA.html) — numeric and `+PTX` architecture syntax.
- [CMake 4.1.1 `select_compute_arch.cmake`](https://gitlab.kitware.com/cmake/cmake/-/blob/v4.1.1/Modules/FindCUDA/select_compute_arch.cmake#L178-298) — exact helper behavior that blocks `12.0` through `CUDA_ARCH_LIST`.

## 6. Per-generation recommended mapping

| Series | CC | Compiled code | Selected compute type | Why | Product statement |
|---|---:|---|---|---|---|
| GTX 10 | 6.1 | native `sm_61` | `INT8_FLOAT32` | CT2 INT8 is supported exactly on Pascal 6.1; FP16 is rejected; FP32-only wastes VRAM | “Theoretically compatible; no task-local GTX 10 execution test” |
| RTX 20 | 7.5 | native `sm_75` | `FLOAT16` | CT2 efficient FP16 floor is >=7.0; preserves one quality/performance mode across RTX | “Theoretically compatible; no task-local RTX 20 execution test” |
| RTX 30 | 8.6 | native `sm_86` | `FLOAT16` | Existing accepted lane and local hardware | “Real tested only on RTX 3070 8 GiB with final artifact SHA after requalification” |
| RTX 40 | 8.9 | native `sm_89` | `FLOAT16` | CT2 predicate supports it; CUDA 12.8 emits native SASS | “Theoretically compatible; no task-local RTX 40 execution test” |
| RTX 50 | 12.0 | native `sm_120` plus recommended `compute_120` PTX | `FLOAT16` | Correct current GeForce Blackwell target; CT2 has no maximum-capability rejection; CUDA/cuBLAS 12.8 is the first full Blackwell toolchain | “Theoretically compatible; compiler/fatbin evidence only, no task-local RTX 50 execution test” |

`INT8_FLOAT32` also technically works on all RTX rows, and `FLOAT32` works on every row. Neither should be automatically selected in v1: multiple choices increase qualification scope, while the requested product mapping only needs one deterministic compute type per capability.

## 7. VRAM, performance, and feature caveats

### GTX 10 / Pascal

- GTX 10 lacks Tensor Cores. CTranslate2's FP16 predicate intentionally rejects CC 6.1, even though Pascal exposes some lower-precision instructions.
- CC 6.1 does have CTranslate2's supported INT8 path; the implementation permits INT8 on major >6 or exactly 6.1 (`src/cuda/utils.cc:225-228`). This is the reason for selecting `INT8_FLOAT32`.
- `INT8_FLOAT32` stores/uses INT8 for quantizable weights while non-quantized layers use FP32 (`docs/quantization.md:108-132`). It can change output slightly relative to FP16/FP32 and needs Pascal model-backed evidence before it can be upgraded from theoretical.
- Low-end GTX 10 cards often have 2–4 GiB VRAM. Architecture compatibility must not be presented as “every model fits.” Tiny/base/small may work where medium/large models do not.
- Pascal is feature-complete/deprecated in CUDA 12.8 and will not be compilable with the next major toolkit. The frozen runtime can remain on CUDA 12.8, but future driver/library lifecycle is a support risk.

### RTX generations

- FP16 is the stable common selection for Turing, Ampere, Ada, and Blackwell in pinned CTranslate2.
- RTX cards vary widely in VRAM. Capability support is not a model-memory guarantee; model construction can still fail with an OOM and must produce a distinct model-load/VRAM error.
- RTX 3070 8 GiB is the only real lane required here. A successful RTX 3070 run does not validate Turing, Ada, or Blackwell kernels.
- Blackwell is newer than CTranslate2 4.8.0's release-era qualification. The source uses generic major comparisons and cuBLAS APIs and has no hard maximum capability in the reviewed paths, but that only supports a theoretical claim until an RTX 50 actually loads all required models and transcribes.

### Large model reference points

- The pinned large-v3 `model.bin` is 3,087,284,237 bytes (`cuda-input-lock.md:84-91`), before runtime workspace/activations.
- Faster-whisper's published large-v2 benchmark reports approximately 4,525 MB VRAM for FP16 and 2,926 MB for INT8 in its stated benchmark configuration. These are comparison points, not Hikaru Sub guarantees; model version, beam/batch, allocator state, audio, and concurrent GPU usage change the peak.
- Consequently, 2 GiB and many 3 GiB Pascal cards should be expected to reject large models; 4 GiB remains model/configuration-dependent. The UI should separate “architecture supported” from “selected model failed to fit.”

External reference:

- [faster-whisper GPU benchmark](https://github.com/SYSTRAN/faster-whisper/blob/master/README.md#benchmark) — published FP16/INT8 VRAM comparison for large-v2.

## 8. How to verify theoretical support without owning the GPUs

There is no official CUDA GPU emulator that turns an RTX 3070 into Pascal, Turing, Ada, or Blackwell hardware. Static/compiler evidence must remain labeled theoretical.

### Build-time gates requiring no target GPU

1. **Tool identity gate**
   - Lock `nvcc 12.8.93` and its hash.
   - Record `nvcc --version`, `--list-gpu-code`, and `--list-gpu-arch`.
   - Assert presence of `sm_61`, `sm_75`, `sm_86`, `sm_89`, `sm_120`; assert absence of `sm_121`.

2. **Exact flag gate**
   - Configure two independent clean CTranslate2 builds with the architecture policy above.
   - Capture the `NVCC compilation flags:` line emitted by `CTranslate2/CMakeLists.txt:551-552`.
   - Assert one native SASS row per required architecture and only the allowed PTX row.

3. **Compilation gate**
   - Successfully compile every CTranslate2 CUDA translation unit for all five targets. This catches source/header incompatibilities, including pinned AWQ/CUDA sources that are compiled even if Whisper does not use AWQ.
   - A compiler success for `sm_120` is stronger than merely seeing `sm_120` in `nvcc --list-gpu-code`, but it is still not execution proof.

4. **Fatbin gate**
   - Run CUDA 12.8 `cuobjdump` against the final `ctranslate2.dll` and enumerate embedded code objects.
   - Require SASS/cubin images for exactly `sm_61`, `sm_75`, `sm_86`, `sm_89`, and `sm_120` in every relevant CUDA fatbin.
   - Require `compute_120` PTX if the recommended PTX row is adopted.
   - Fail for missing, accidental `Auto`-derived, or extra unreviewed architectures.

5. **Pure policy tests**
   - Test the capability resolver with mocked numeric inputs: 6.1→INT8_FLOAT32; 7.5/8.6/8.9/12.0→FLOAT16; 6.0/6.2/7.0/8.0/9.0/12.1/unknown→unsupported under this exact desktop artifact policy.
   - Test that the selected type is attested and passed to model construction without try/fallback behavior.
   - Test that a capability allowed by CT2 but absent from the compiled allowlist is rejected before launch.

6. **Static CTranslate2 contract gate**
   - Pin/assert the reviewed source predicates and compute resolution. This prevents a future CTranslate2 update from silently changing Pascal INT8 or FP16 floors.

### Real local RTX 3070 gates

Against the final artifact SHA, not the old T07 bytes:

- run the full eight-model short matrix and required long/cancel/recovery/offline gates on device 0;
- assert queried CC 8.6 and selected/effective `FLOAT16`;
- set `CUDA_DISABLE_PTX_JIT=1` for a qualification pass so success proves the native `sm_86` image is usable;
- capture loaded modules and prove real CUDA generation, not only DLL loading;
- retain the existing distinction between CPU and CUDA runtime identities.

Because the recommended artifact contains only `compute_120` PTX, that PTX is not backward-compatible to CC 8.6. A successful CC 8.6 run already requires `sm_86`; `CUDA_DISABLE_PTX_JIT=1` makes the evidence explicit.

### What static verification cannot prove

Without each GPU generation, the task cannot prove:

- cuBLAS runtime behavior and performance on that hardware;
- driver-specific failures;
- actual `INT8_FLOAT32` transcript quality/speed on Pascal;
- model-specific peak VRAM and fragmentation;
- Blackwell execution correctness;
- thermal/power behavior or sustained long-audio stability.

These limitations must appear in support documentation and release evidence. “Compiled for” or “theoretically compatible” is the correct wording; “tested” is not.

## 9. Concrete release-policy recommendation

### Capability and compute mapping

```text
SupportedCapabilityRow {
  (6,1)  -> sm_61  -> INT8_FLOAT32 -> theoretical GTX 10
  (7,5)  -> sm_75  -> FLOAT16      -> theoretical RTX 20
  (8,6)  -> sm_86  -> FLOAT16      -> real RTX 3070 qualification
  (8,9)  -> sm_89  -> FLOAT16      -> theoretical RTX 40
  (12,0) -> sm_120 -> FLOAT16      -> theoretical RTX 50
}
```

### Binary architecture contract

Required:

```text
SASS = {sm_61, sm_75, sm_86, sm_89, sm_120}
```

Recommended:

```text
PTX = {compute_120}
```

Forbidden as claimed support in v1:

```text
sm_60, sm_62, sm_70, sm_72, sm_80, sm_87, sm_90,
sm_100, sm_101, sm_121, and any architecture not in the lock
```

This does not mean those GPUs can never run CTranslate2. It means they are not part of the minimum desktop series contract and are not represented by native SASS in this artifact.

### Runtime behavior

- Query device 0 and resolve the row before model construction.
- Use explicit `INT8_FLOAT32` or `FLOAT16`; never CT2 `AUTO`/`DEFAULT` for the product CUDA route.
- Keep `CT2_CUDA_ALLOW_FP16` unset.
- Treat insufficient VRAM/model load as a separate failure after architecture readiness.
- Explicit CUDA never falls back to CPU; `auto` follows the PRD's pre-start CPU fallback rule only.
- Capability reporting should expose GPU name, numeric CC, selected compute type, support-evidence level (`real-tested` only for final RTX 3070 evidence versus `theoretical`), and a model-load/OOM reason when applicable.

## External references

- [NVIDIA CUDA GPU Compute Capability](https://developer.nvidia.com/cuda-gpus)
- [NVIDIA Legacy CUDA GPU Compute Capability](https://developer.nvidia.com/cuda-legacy-gpus)
- [CUDA Compiler Driver 12.8](https://docs.nvidia.com/cuda/archive/12.8.0/cuda-compiler-driver-nvcc/index.html)
- [CUDA 12.8 release notes](https://docs.nvidia.com/cuda/archive/12.8.0/cuda-toolkit-release-notes/)
- [CUDA Toolkit 12.8 delivers NVIDIA Blackwell support](https://developer.nvidia.com/blog/cuda-toolkit-12-8-delivers-nvidia-blackwell-support)
- [Blackwell compatibility guide](https://docs.nvidia.com/cuda/blackwell-compatibility-guide/index.html)
- [CTranslate2 v4.8.0 quantization](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/docs/quantization.md)
- [CTranslate2 v4.8.0 compute-type source](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/src/types.cc)
- [CTranslate2 v4.8.0 CUDA capability source](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/src/cuda/utils.cc)
- [CTranslate2 v4.8.0 build system](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/CMakeLists.txt)
- [CTranslate2 v4.8.0 installation/build options](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/docs/installation.md)
- [CMake FindCUDA](https://cmake.org/cmake/help/latest/module/FindCUDA.html)
- [CMake 4.1.1 architecture selector](https://gitlab.kitware.com/cmake/cmake/-/blob/v4.1.1/Modules/FindCUDA/select_compute_arch.cmake)
- [faster-whisper benchmark](https://github.com/SYSTRAN/faster-whisper/blob/master/README.md#benchmark)

## Caveats / not found

- No GTX 10, RTX 20, RTX 40, or RTX 50 GPU was available for real execution. Their rows remain theoretical.
- No CC 12.1 target exists in CUDA 12.8 `nvcc`; CC 12.1 was not included in the recommended artifact.
- This research did not build a new multi-architecture DLL because the research-agent scope permits only Markdown outputs. The final implementation must run the clean-build and fatbin gates described above.
- CTranslate2 4.8.0 predates task-local Blackwell execution evidence. Generic source compatibility plus CUDA 12.8 compiler support is not a substitute for an RTX 50 run.
- VRAM figures from faster-whisper are reference measurements, not guaranteed thresholds for Hikaru Sub's exact worker/model/configuration.
- The prior RTX 3070 evidence is valid as design input only. Any newly built final worker/CTranslate2/runtime bytes require fresh evidence bound to their final SHA-256 values.
