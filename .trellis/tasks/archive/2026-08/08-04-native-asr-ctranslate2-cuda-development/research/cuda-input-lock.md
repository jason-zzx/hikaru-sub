# T07 CUDA Development Input Lock

## Scope And Status

Frozen before the opt-in CUDA configure/build and before any model-backed discovery or measurement. Independent check then found that the first evidence runner accepted caller-supplied GPU metadata and omitted cold process-wall/raw-file bindings. This revised lock requires CUDA Driver API-derived GPU name/capability, the loaded `nvcuda.dll` identity, cold process wall timing, and ignored raw SHA-256 bindings; it is re-frozen before the final rebuild, discovery, and paired measurements. This identity is ignored-local development evidence only; it is not a runtime pack, redistribution manifest, product qualification, driver floor, or Release route input.

Canonical ignored root:

```text
.trellis/tasks/08-04-native-asr-ctranslate2-cuda-development/research/local/
```

The active/archive-safe `.gitignore` rule was verified with `git check-ignore --no-index` before creating local output. CUDA builds, absolute paths, private audio, model aliases, requests/events/transcripts, and raw module inventories remain below this root. Tracked outputs contain only root roles, versions, sizes, SHA-256 values, aggregate timings, and the development result.

## Build Identity

| Input | Locked identity |
|---|---|
| Platform | Windows 11 x64, version `10.0.26200`, build `26200` |
| GPU | NVIDIA GeForce RTX 3070, 8 GiB, compute capability `8.6`, device index `0` |
| Driver | `596.49`; Windows driver module `nvcuda.dll` version `32.0.15.9649`; CUDA Driver API version integer `13020` |
| CUDA Toolkit | NVIDIA CUDA Toolkit `12.8.93`; `nvcc` build `cuda_12.8.r12.8/compiler.35583870_0` |
| CTranslate2 | `4.8.0`, commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`, clean tracked worktree |
| oneDNN | `3.1.1`, pinned T06 static library; retained for paired CPU execution |
| MSVC | x64 compiler `19.44.35221`, tool root version `14.44.35207` |
| CMake | `4.1.1-msvc1` |
| Ninja | `1.12.1` |
| CUDA architecture | exact `8.6` |
| CUDA loading | `CUDA_DYNAMIC_LOADING=ON` |
| cuDNN | `WITH_CUDNN=OFF`; upstream reviewed reference `9.10.2`, intentionally not downloaded, installed, linked, or loaded |

Primary CTranslate2 flags:

```text
WITH_DNNL=ON
WITH_CUDA=ON
WITH_CUDNN=OFF
CUDA_DYNAMIC_LOADING=ON
CUDA_ARCH_LIST=8.6
WITH_HIP=OFF
WITH_TENSOR_PARALLEL=OFF
WITH_FLASH_ATTN=OFF
BUILD_CLI=OFF
BUILD_TESTS=OFF
BUILD_SHARED_LIBS=ON
OPENMP_RUNTIME=COMP
```

## Tool And CUDA Component Identity

Root roles are `msvc-toolchain`, `cuda-toolkit-12.8`, and `windows-system32`; absolute paths remain raw-local.

| Root role | Component | Bytes | SHA-256 | Version / note |
|---|---|---:|---|---|
| `msvc-toolchain` | `cmake.exe` | 13,395,024 | `537f551032fec66f9a1ad629257ff8348577376cf044ea436c9413f69d6fea20` | `4.1.1-msvc1` |
| `msvc-toolchain` | `ninja.exe` | 3,466,696 | `5020138b3757035df9dca9a2243624d5810ffa6ae24444bd95f752cbd1b89123` | `1.12.1` |
| `msvc-toolchain` | `cl.exe` | 677,968 | `6cadddca8c19e76991bbb44dff2eab5cab6807f9145e8bce9a800235a5975e51` | `19.44.35221` |
| `cuda-toolkit-12.8` | `bin/nvcc.exe` | 17,741,312 | `07565c215cc96e3b3609a931eb6eaffb1ecca24339442603f92832494c656727` | `12.8.93` |
| `cuda-toolkit-12.8` | `include/cuda.h` | 1,183,268 | `167e383a3791226c5e809dfd6a9614b29b1e11f4d6346c29a921943a71e3e566` | configure/compile input |
| `cuda-toolkit-12.8` | `include/cuda_runtime_api.h` | 670,876 | `6c60f63697575ff18156d397ec506ab286b147f33a5ce9e72f95bfec162fd3ea` | compile input |
| `cuda-toolkit-12.8` | `lib/x64/cuda.lib` | 160,840 | `1f2fd7eb50512a5d12d1c1ff8803cc6499a9dbbaa8bb9a8320d4ff771ab7f0b3` | driver import library |
| `cuda-toolkit-12.8` | `lib/x64/cudart.lib` | 117,462 | `0fc74e7cd9e3d68d1dbec554dab94c17d17bc15e489e851fb8b876586bac02b2` | runtime import library |
| `cuda-toolkit-12.8` | `bin/cudart64_12.dll` | 573,952 | `c2c9a9c22a9bcba90e261825968836787b331038047a26770cffb7a583c28344` | version `6,14,11,12080`; required only if actually discovered |
| `cuda-toolkit-12.8` | `bin/cublas64_12.dll` | 113,716,224 | `9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99` | version `6,14,11,1284`; expected CUDA math module |
| `cuda-toolkit-12.8` | `bin/cublasLt64_12.dll` | 674,667,520 | `b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7` | version `6,14,11,1284`; expected CUDA math module |
| `cuda-toolkit-12.8` | `bin/curand64_10.dll` | 71,955,968 | `3465fd1b46e551339b8f44c455756a0f2cba8bd846562eb659040d48edb7aaac` | required only if actually discovered |
| `windows-system32` | `nvcuda.dll` | 4,466,920 | `ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c` | driver `32.0.15.9649` |

The final required shared, CPU-only, and CUDA-only module sets are derived only from separate completed CPU/CUDA discovery processes under the final CUDA-enabled binary identity. Discovery rows are unscored and formal measurements start in new processes after the sets are frozen. GPU name and compute capability come from CUDA Driver API calls against device `0`, not caller-supplied labels; the marketing driver version is accepted only with the locked loaded `nvcuda.dll` version. No `cudnn*.dll` module is permitted.

## Execution Configuration

| Protocol device | CTranslate2 device | Index | Compute type |
|---|---|---:|---|
| `cpu` | `CPU` | `0` | `INT8` |
| `cuda` | `CUDA` | `0` | `FLOAT16` |

CUDA requests require a CUDA-enabled binary, visible device `0`, CTranslate2 FP16 support on device `0`, and successful model construction before `ready`. There is no automatic CPU fallback. CPU requests retain the T06 behavior.

Selected algorithm identity is unchanged: timestamp-driven seek, no previous-text history, beam size `1`, VAD disabled. The T06 canonical selected config SHA-256 is `77120c8543e780231d8c65b3868c07f44d685a22a136da56c64e6a6922d4f9e6`; T07 changes only the explicit device/compute mapping.

## Model And Sample Identity

Model: `Systran/faster-whisper-large-v3`, revision `edaa852ec7e145841d8ffdb056a99866b5f0a478`, MIT.

| File | Bytes | SHA-256 |
|---|---:|---|
| `config.json` | 2,394 | `a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9` |
| `model.bin` | 3,087,284,237 | `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` |
| `tokenizer.json` | 2,480,617 | `6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca` |
| `vocabulary.json` | 1,068,114 | `c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1` |

| Sample | Duration | SHA-256 | Use |
|---|---:|---|---|
| authoritative `short-v1` | 24.102 s | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` | paired `1 cold + 3 warm` |
| `medium-v1` first-120s PCM slice | 120.000 s | `d7b8c62d1358eee4f7ca40596ec424e91cde6992654add5c0219cdeed3907b42` | paired `1 cold + 3 warm` |
| authoritative `medium-v1` source | 498.872 s | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` | private prefix relationship authority |

The 120-second slice must be verified locally as the exact PCM prefix of the source WAV before measurement.

## Restricted Child-Process PATH

Ordered root roles:

1. `task-local-runtime-bin` — final CUDA-enabled worker/runner and local CT2/tokenizer/ORT siblings;
2. `cuda-toolkit-12.8-bin` — locked installed CUDA Toolkit DLLs;
3. `windows-system32` — Windows and NVIDIA driver modules.

The raw canonical paths and a root-identity hash are recorded below the ignored root. Device resolution never depends on `PATH`, `CUDA_PATH`, an executable name, or an environment-variable guess; the protocol request is the only device selector. Each cold row records model load and process wall time, and the sanitized result binds every formal raw file by SHA-256.

## Decision Rule

For each sample, compute the median of exactly three warmed inference RTF values after one cold run:

```text
gpuWarmMedianRtf <= cpuWarmMedianRtf * 0.80
```

Both samples must pass for `development-gpu-ready`. Valid completed CUDA execution with either sample missing the threshold produces `development-gpu-no-speedup`. Only a validated configure/build failure or structured pre-ready CUDA runtime/device/model failure can produce `development-gpu-unavailable`. Missing, incomplete, or identity-invalid evidence produces no development result. CER, gaps, segmentation, and timeline quality are intentionally not inputs. GPU median `RTF <= 0.5` is reported only as a future T15 diagnostic.
