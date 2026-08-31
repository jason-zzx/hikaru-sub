# Research: CUDA 12.9 deterministic Native ASR build migration

- Query: Investigate the concrete CUDA 12.8 Update 1 `nvcc` anonymous-namespace nondeterminism blocker; determine from official NVIDIA sources whether CUDA 12.9 / 12.9 Update 1 provides `--frandom-seed`, preserves offline SASS for `sm_61/sm_75/sm_86/sm_89/sm_120`, exact Windows MSVC and driver compatibility, and the redistributable/build component identities required to replace the current baseline. Verify pinned CTranslate2 4.8.0 CUDA 12.x compatibility, identify risks, and recommend the smallest migration preserving GTX 10 through RTX 50 and byte-identical builds with stable per-source seeds.
- Scope: mixed
- Date: 2026-08-31

## Executive conclusion

The current blocker is real executable-device-code nondeterminism, not a PE timestamp, build-root, linker, or scheduling artifact. The accepted local evidence shows that CUDA 12.8.93 changes `nvcc`-generated `_INTERNAL_..._<numeric>` names between otherwise identical builds, causing 114 of 150 extracted cubin/PTX payloads and the final `ctranslate2.dll` to differ. `/Brepro`, path remapping, same-root rebuilds, independent roots, and serialization did not solve it (`.trellis/tasks/08-31-native-asr-gpu-mode/research/implementation-progress.md:49-55`).

**CUDA 12.9 GA is the first of the inspected releases that documents `--frandom-seed`; CUDA 12.9 Update 1 retains it. CUDA 12.8 GA and 12.8 Update 1 documentation do not contain the option.** NVIDIA documents that the seed replaces random numbers used when generating symbol and variable names and that the option can produce deterministically identical PTX and object files. NVIDIA also explicitly says users must assign different seeds to different files. This is an exact match for the observed `_INTERNAL_...` blocker.

The smallest support-preserving migration is therefore:

1. keep CTranslate2 pinned at **4.8.0 / `54a546cec4262f9770d4674a0bfb4ac3c4f05698`**;
2. keep the existing build topology and architecture policy: native SASS for `sm_61`, `sm_75`, `sm_86`, `sm_89`, `sm_120`, plus optional `compute_120` PTX;
3. replace CUDA 12.8 Update 1 with **CUDA 12.9 Update 1** (`nvcc 12.9.86`, CUDART 12.9.79, cuBLAS 12.9.1.4, cuobjdump 12.9.82);
4. keep the exact MSVC 14.44 / compiler 19.44 toolset and explicitly reject 14.50 / `_MSC_VER >= 1950`;
5. pass a stable, distinct `--frandom-seed` to every `.cu` translation unit through a deterministic `nvcc` launcher or an equivalently reviewed per-source FindCUDA patch;
6. rerun two independent clean builds and require byte-identical `ctranslate2.dll` and complete ZIP bytes before enabling the product source.

CUDA 12.9 GA is technically sufficient to obtain `--frandom-seed`, but Update 1 is the better replacement baseline because it is the patched 12.9 release and does not require any broader product or source migration. The implementation delta is the same. This research does **not** claim reproducibility is already proved: NVIDIA documents the intended option, but the project must still execute its two-clean-build gate with the final seed mapping and final toolchain bytes.

## Findings

### Files found

| File path | Description |
|---|---|
| `.trellis/tasks/08-31-native-asr-gpu-mode/research/implementation-progress.md:49-70` | Concrete CUDA 12.8 nondeterminism evidence and the remaining release gate. |
| `native-asr/runtime/windows-x64-cuda-inputs.json:1-123` | Current CUDA 12.8 Update 1 input/policy authority. |
| `native-asr/runtime/windows-x64-cuda-lock.json:69-176` | Current pending artifact lock, toolchain, driver, and fatbin identities. |
| `native-asr/CMakeLists.txt:477-509` | Current CTranslate2 CUDA configuration and architecture flags. |
| `native-asr/CMakeLists.txt:113-115` | Current cache description hard-codes the CUDA 12.8 Update 1 baseline. |
| `scripts/package-native-asr-cuda-runtime.ps1:114-132` | Fatbin audit currently discovers `cuobjdump` from ambient `CUDA_PATH` and names CUDA 12.8. |
| `scripts/package-native-asr-cuda-runtime.ps1:191-220` | Current package assembly uses the task-local CUDA 12.8 cuBLAS extraction. |
| `.cache/native-asr-cuda-runtime/manual/sources/CTranslate2-4.8.0/docs/installation.md:17-24` | Pinned upstream documentation says Windows/Linux GPU wheels use CUDA 12.x. |
| `.cache/native-asr-cuda-runtime/manual/sources/CTranslate2-4.8.0/docs/installation.md:94-127` | Source build options and `WITH_CUDA=ON` minimum CUDA >=11.0. |
| `.cache/native-asr-cuda-runtime/manual/sources/CTranslate2-4.8.0/CONTRIBUTING.md:146-160` | Upstream states any CUDA 12.x providing major-12 cuBLAS is supported by the dynamic-loading design. |
| `.cache/native-asr-cuda-runtime/manual/sources/CTranslate2-4.8.0/CHANGELOG.md:75` | Pinned release line includes explicit CUDA 12.8 support. |
| `.cache/native-asr-cuda-runtime/manual/sources/CTranslate2-4.8.0/CMakeLists.txt:494-569` | Legacy FindCUDA path, global `CUDA_NVCC_FLAGS`, C++17, vendored Thrust/CUB ordering, and architecture selection. |
| `.cache/native-asr-cuda-runtime/manual/sources/CTranslate2-4.8.0/CMakeLists.txt:571-607` | cuDNN remains optional/off; dynamic cuBLAS stub remains selected. |
| `.trellis/tasks/08-31-native-asr-gpu-mode/research/local/build/windows-x64-ct2-cuda-repro-a/ctranslate2/CMakeFiles/ctranslate2.dir/src/cuda/ctranslate2_generated_primitives.cu.obj.Release.cmake:257-270` | Actual FindCUDA generated invocation: one `.cu` source is passed first to `CUDA_NVCC_EXECUTABLE`, making a deterministic launcher feasible. |

## 1. Concrete blocker and why CUDA 12.9 addresses it

### Observed CUDA 12.8 failure mode

The current evidence is stronger than a final-DLL hash mismatch:

- `hikaru-asr-worker.exe` and `hikaru_asr_tokenizer.dll` were byte-identical across independent clean roots and same-root repeats.
- Only CUDA-enabled `ctranslate2.dll` drifted, including 512/1024-byte size changes.
- `cuobjdump -xelf all -xptx all` found **114/150 device payloads different**.
- PTX changes include `nvcc`-generated anonymous/internal symbol suffixes such as `_INTERNAL_..._359084` versus `_INTERNAL_..._367604`.
- `/Brepro`, source/build remapping, identical pinned source/toolchain, and serial scheduling did not eliminate the changes.

This is recorded at `.trellis/tasks/08-31-native-asr-gpu-mode/research/implementation-progress.md:49-55`. The matching NVIDIA Developer Forums report is [Non-deterministic compilation when anonymous namespaces are used](https://forums.developer.nvidia.com/t/non-deterministic-compilation-when-anonymous-namespaces-are-used/303243), but the migration decision below relies on NVIDIA's formal compiler documentation rather than the forum alone.

### Version comparison

The official archived NVCC manuals were inspected for the literal option:

| NVCC documentation | `--frandom-seed` present? |
|---|---:|
| [CUDA 12.8 GA NVCC](https://docs.nvidia.com/cuda/archive/12.8.0/cuda-compiler-driver-nvcc/index.html) | No |
| [CUDA 12.8 Update 1 NVCC](https://docs.nvidia.com/cuda/archive/12.8.1/cuda-compiler-driver-nvcc/index.html) | No |
| [CUDA 12.9 GA NVCC](https://docs.nvidia.com/cuda/archive/12.9.0/cuda-compiler-driver-nvcc/index.html) | **Yes** |
| [CUDA 12.9 Update 1 NVCC](https://docs.nvidia.com/cuda/archive/12.9.1/cuda-compiler-driver-nvcc/index.html) | **Yes** |

Therefore the feature was introduced in the 12.9 line, not Update 1 specifically; Update 1 retains it.

### Exact official semantics

NVIDIA's [CUDA 12.9 Update 1 NVCC manual, `--frandom-seed`](https://docs.nvidia.com/cuda/archive/12.9.1/cuda-compiler-driver-nvcc/index.html#frandom-seed-frandom-seed) states:

- the user seed replaces random numbers used in generating symbol and variable names;
- it can generate deterministically identical PTX and object files;
- decimal, octal, or hexadecimal numbers are used directly;
- otherwise NVCC uses the CRC of the supplied string;
- the option is forwarded to GCC/Clang host compilers, but not MSVC;
- users are responsible for assigning different seeds to different files.

The changing symbols in this task are exactly the class named by the option. No executable-device-payload post-processing should be introduced.

## 2. Offline SASS and desktop-generation coverage

CUDA 12.9 Update 1 still supports all five required offline targets. The NVCC manual's supported target list contains, among others:

- `compute_61` / `sm_61`;
- `compute_75` / `sm_75`;
- `compute_86` / `sm_86`;
- `compute_89` / `sm_89`;
- `compute_120` / `sm_120`.

It additionally contains newer 12.9 targets such as `sm_103` and `sm_121`, but those must **not** expand this product's first-release policy.

Official references:

- [CUDA 12.9 Update 1 NVCC target options](https://docs.nvidia.com/cuda/archive/12.9.1/cuda-compiler-driver-nvcc/index.html)
- [CUDA 12.9 Update 1 release notes, deprecated architectures](https://docs.nvidia.com/cuda/archive/12.9.1/cuda-toolkit-release-notes/index.html#deprecated-architectures)

The release notes explicitly say Maxwell, Pascal, and Volta are feature-complete and that **CUDA Toolkit 12.x continues to support building applications for them**; offline compilation and library support are removed in the next major toolkit release. Thus CUDA 12.9 remains the last appropriate major-family direction for the GTX 10 / `sm_61` requirement. CUDA 13 must not replace it for this artifact.

Keep the current exact architecture flags:

```text
-gencode=arch=compute_61,code=sm_61
-gencode=arch=compute_75,code=sm_75
-gencode=arch=compute_86,code=sm_86
-gencode=arch=compute_89,code=sm_89
-gencode=arch=compute_120,code=sm_120
-gencode=arch=compute_120,code=compute_120   # optional, locked, does not broaden support
```

The existing workaround for legacy FindCUDA's multi-digit `12.0` parser remains valid: retain `CUDA_ARCH_LIST=6.1;7.5;8.6;8.9` and provide `sm_120`/`compute_120` through explicit `CUDA_NVCC_FLAGS` (`native-asr/CMakeLists.txt:492-497`). Do not add 12.1 merely because CUDA 12.9 can compile it.

## 3. Exact Windows MSVC compatibility

### Formal installation-guide support

The [CUDA 12.9 Update 1 Windows installation guide](https://docs.nvidia.com/cuda/archive/12.9.1/cuda-installation-guide-microsoft-windows/index.html#system-requirements) gives this Windows compiler table:

| Compiler / IDE | Native x86_64 | Dialects |
|---|---:|---|
| MSVC 193x / Visual Studio 2022 17.x | Yes | C++14 default, C++17, C++20 |
| MSVC 192x / Visual Studio 2019 16.x | Yes | C++14 default, C++17 |

The same guide says Visual Studio 2017 support is dropped in CUDA 12.9 and 32-bit compilation is unavailable in CUDA 12.x.

The table's `193x` label is narrower than its IDE row: later Visual Studio 2022 17.x releases ship 19.4x compilers. The official CUDA 12.9.79 `crt/host_config.h` from the pinned `cuda_nvcc` archive was therefore also inspected. Its compiler guard is:

```c
#if _MSC_VER < 1910 || _MSC_VER >= 1950
#error -- unsupported Microsoft Visual Studio version!
#endif
```

Consequences for this repository:

- the existing pinned **MSVC 14.44 / compiler 19.44.35221 (`_MSC_VER=1944`) is accepted** by the official CUDA 12.9 compiler guard and is a Visual Studio 2022-generation toolset;
- the installed Visual Studio 18 IDE may host that older toolset, but the build must continue to select it explicitly with `-vcvars_ver=14.44`;
- **MSVC 14.50 / compiler 19.50 (`_MSC_VER=1950`) is rejected** by CUDA 12.9 unless `-allow-unsupported-compiler` is used;
- `-allow-unsupported-compiler` must remain forbidden;
- lock and configure checks should assert the exact `cl.exe` version/path and fail if CMake/NVCC drift to 14.50.

This preserves the existing host compiler and avoids a second, unrelated compiler migration. If the project later wants the least ambiguous formal-doc configuration, it could pin a Visual Studio 2022 17.x installation directly, but that is not required to resolve this NVCC blocker and would enlarge the change.

## 4. Driver floors

NVIDIA distinguishes major-family minor-version compatibility from the driver paired with a particular Toolkit release.

### Absolute CUDA 12.x technical floor

The [CUDA minor-version compatibility guide](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html) and CUDA release tables retain the Windows CUDA 12.x minimum of **528.33**. This is the absolute major-family compatibility floor, subject to limited-feature and PTX caveats.

### Release-paired / qualified floors

The [CUDA 12.9 Update 1 release notes](https://docs.nvidia.com/cuda/archive/12.9.1/cuda-toolkit-release-notes/index.html#cuda-driver) list:

| Toolkit | Windows toolkit-driver floor |
|---|---:|
| CUDA 12.9 GA | 576.02 |
| CUDA 12.9 Update 1 | **576.57** |
| CUDA 12.8 Update 1 (current baseline) | 572.61 |

Recommended policy after migration:

- keep `528.33` as the absolute CUDA 12.x reject floor in technical diagnostics;
- change the initial qualified product floor from `572.61` to **`576.57`** for the CUDA 12.9 Update 1 artifact;
- only lower the product floor after the final exact-SHA artifact is model-backed tested on the lower driver branch;
- preserve native SASS for all claimed architectures; do not depend on PTX to justify low-driver support.

Drivers newer than the CUDA 12.x minor-compatibility range remain usable through backward compatibility. Runtime qualification should still cover the chosen minimum, the current production branch, and a newer branch.

## 5. Official CUDA 12.9 Update 1 component lock

The official metadata authority is:

| Item | URL | Size | SHA-256 |
|---|---|---:|---|
| `redistrib_12.9.1.json` | `https://developer.download.nvidia.com/compute/cuda/redist/redistrib_12.9.1.json` | 54,256 | `8335301010b0023ee1ff61eb11e2600ca62002d76780de4089011ad77e0c7630` |

Metadata release date: `2025-06-05`; release label: `12.9.1`.

### Required build/audit/runtime-source archives

For this exact CTranslate2 build shape, the minimal official archive set replacing reliance on an installed CUDA 12.8 Toolkit is:

| Role | Component/version | Official URL | Size | SHA-256 |
|---|---|---|---:|---|
| Compiler, NVVM/PTXAS, CUDA compiler headers | `cuda_nvcc 12.9.86` | `https://developer.download.nvidia.com/compute/cuda/redist/cuda_nvcc/windows-x86_64/cuda_nvcc-windows-x86_64-12.9.86-archive.zip` | 126,917,884 | `227b109663b5e57d2718bcabb24a4ba0d9d4e52d958e327dc476f7c28691be85` |
| CUDA runtime headers and static CUDART | `cuda_cudart 12.9.79` | `https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-12.9.79-archive.zip` | 3,521,238 | `179e9c43b0735ffe67207b3da556eb5a0c50f3047961882b7657d3b822d34ef8` |
| cuBLAS headers/import libraries and selected redistributable DLLs | `libcublas 12.9.1.4` | `https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-12.9.1.4-archive.zip` | 549,755,186 | `d534d98b0b453a98914dbf3adf47d7e84b55037abf02f87466439e1dcef581ed` |
| Fatbin audit tool | `cuda_cuobjdump 12.9.82` | `https://developer.download.nvidia.com/compute/cuda/redist/cuda_cuobjdump/windows-x86_64/cuda_cuobjdump-windows-x86_64-12.9.82-archive.zip` | 6,219,088 | `1eda43a76a2eac25fce5bdb4b68673b5bda737d54cca5513148c36362ab7c811` |

`cuda_cccl 12.9.27` is available in the metadata, but should **not** be added automatically. Pinned CTranslate2 4.8.0 explicitly places its vendored Thrust/CUB/libcudacxx include directories before the Toolkit include directory (`CTranslate2/CMakeLists.txt:554-563`). The existing CUDA 12.8 build therefore does not need a new standalone CCCL input unless a traced clean 12.9 build proves it is consumed. Adding it speculatively would enlarge the input closure.

`cuda_nvdisasm` is not required by the current verifier, which uses `cuobjdump`. It may be pinned separately only if future audits invoke it.

### Selected runtime DLL identities

The official cuBLAS 12.9.1.4 archive was streamed and its selected entries hashed without persisting product files:

| Runtime file | Size | SHA-256 |
|---|---:|---|
| `bin/cublas64_12.dll` | 102,518,272 | `90052a83efd1b57a8e3616a6590b335855f81b814a4f16eecb7b5bf6d1b1d4eb` |
| `bin/cublasLt64_12.dll` | 668,669,952 | `c3a05ea244c937314afec09f87b91f814c7e27977681f6c67eb51bb06ced3a4a` |

Expected deployed NVIDIA closure remains unchanged in shape:

- static CUDART linked into `ctranslate2.dll`;
- runtime-root `cublas64_12.dll` and `cublasLt64_12.dll`;
- system-driver `nvcuda.dll`;
- no cuDNN, no dynamic `cudart64_12.dll`, no NCCL.

Final PE imports and loaded-module sampling remain authoritative after rebuild.

### License identity

The following official component license URLs returned identical bytes:

- `https://developer.download.nvidia.com/compute/cuda/redist/cuda_nvcc/LICENSE.txt`
- `https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/LICENSE.txt`
- `https://developer.download.nvidia.com/compute/cuda/redist/libcublas/LICENSE.txt`

Identity:

- size: `63,021` bytes;
- SHA-256: `e2c71babfd18a8e69542dd7e9ca018f9caa438094001a58e6bc4d8c999bf0d07`.

This is byte-identical to the current frozen CUDA 12.8 license input. The lock should still update its terms/source reference to [CUDA 12.9 Update 1 EULA](https://docs.nvidia.com/cuda/archive/12.9.1/eula/index.html) and rename the packaged license path to `NVIDIA-CUDA-Toolkit-12.9-License.txt` for unambiguous inventory.

### CUDA 12.9 GA comparison

CUDA 12.9 GA already contains `--frandom-seed`. Its official component identities are:

| Component | Version | Archive SHA-256 |
|---|---:|---|
| metadata | 12.9.0 | `4e4e17a12adcf8cac40b990e1618406cd7ad52da1817819166af28a9dfe21d4a` |
| `cuda_nvcc` | 12.9.41 | `b83e3d6e57a078ba064051782d6312fbe4a3c8f73d6fe771b768e924a5d95788` |
| `cuda_cudart` | 12.9.37 | `f96afe6df898bc8510c48b44668bd9f825731efbf460f3640a922b2b8ae59ccc` |
| `cuda_cuobjdump` | 12.9.26 | `f70ab180164382140ebb73ac8d6318d1e5d4087d3997617c0052b30ec8b572ce` |
| `libcublas` | 12.9.0.13 | `20d9c2cd3810c948b875820917b38053dacf200b23cb3b8b8a14ff3569aa1f31` |

GA is a viable fallback if Update 1 reveals a new source-build regression, but Update 1 should be tried first.

## 6. CTranslate2 4.8.0 compatibility and risks

### Positive compatibility evidence

Pinned upstream evidence supports CUDA 12.9 as a same-major migration:

1. `docs/installation.md:17-20` says install **CUDA 12.x** for GPU execution.
2. `docs/installation.md:121-122` says source `WITH_CUDA=ON` requires CUDA >=11.0; cuDNN is separately optional.
3. `CONTRIBUTING.md:152-160` explains static CUDART + dynamically loaded major-version cuBLAS and says users can install **any CUDA 12.x** providing `libcublas.so.12` (Windows uses the corresponding `cublas64_12.dll`).
4. `CHANGELOG.md:75` records explicit CUDA 12.8 support in this pinned release.
5. The dynamic cuBLAS DLL major name remains `12` in CUDA 12.9, so the loader contract does not change.
6. The project already disables cuDNN and uses CTranslate2's pure-CUDA convolution path, so CUDA 12.9 does not require a cuDNN migration.

Official/pinned upstream references:

- [CTranslate2 v4.8.0 installation](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/docs/installation.md)
- [CTranslate2 v4.8.0 contribution/build notes](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/CONTRIBUTING.md)
- [CTranslate2 v4.8.0 release](https://github.com/OpenNMT/CTranslate2/releases/tag/v4.8.0)

### Compatibility risks requiring a clean build gate

1. **12.9 is allowed by the 12.x contract but not specifically named by the 4.8.0 changelog.** Compile/CTest/model qualification is mandatory.
2. **Legacy FindCUDA remains in use.** It is deprecated, uses generated CMake scripts, and cannot express the multi-digit `12.0` architecture via the current numeric parser. Preserve the current explicit `sm_120` workaround.
3. **`CUDA_NVCC_FLAGS` is global.** Simply appending one `--frandom-seed` there would violate NVIDIA's instruction to use different seeds per file.
4. **Vendored CUDA header stacks can expose compiler regressions.** CTranslate2 pins its own Thrust/CUB/libcudacxx and CUTLASS. The same sources compile under 12.8, but 12.9 must be checked for newly diagnosed warnings/errors and ABI changes.
5. **Do not accidentally select Toolkit CCCL before the vendored copy.** Preserve CTranslate2's include order and capture include provenance if the build changes.
6. **MSVC drift is dangerous.** The workstation's 14.50 toolset is outside CUDA 12.9's guard. Continue pinning 14.44 and fail closed.
7. **The final device linker may still expose another nondeterministic input.** `--frandom-seed` directly addresses known generated-name randomness, but byte equality must be measured at `.obj`, extracted PTX/cubin, `ctranslate2.dll`, and ZIP levels.
8. **Runtime bytes change substantially.** The new cuBLAS/cuBLASLt DLL hashes and sizes require budget, module closure, and model-backed requalification; old RTX 3070 performance evidence does not qualify the new artifact.

No CTranslate2 source/API change is indicated solely for CUDA 12.9. Do not upgrade to CTranslate2 4.8.1 or patch CUDA kernels unless the pinned 4.8.0 clean build demonstrates an actual source incompatibility.

## 7. Stable per-source seed assignment

### Requirements derived from NVIDIA's option contract

A valid scheme must be:

- stable across absolute source/build roots;
- different for every compiled `.cu` translation unit;
- independent of build order and parallel scheduling;
- locked and reviewable;
- passed on every NVCC phase for that source;
- fail-closed for unknown or duplicate mappings.

### Recommended seed derivation

For each pinned CTranslate2 CUDA source, define the canonical identity:

```text
ctranslate2-4.8.0/<repo-relative-path-with-forward-slashes>
```

Then:

1. UTF-8 encode that canonical identity.
2. Compute SHA-256.
3. Use the first 8 hexadecimal digits as an unsigned 32-bit numeric seed: `0xXXXXXXXX`.
4. Fail configuration if the seed is `0` or if any two source identities collide.
5. Sort entries by canonical path and persist the complete `path -> seed` map or its exact canonical JSON hash in the CUDA build lock.

Example shape (illustrative; implementation must generate and lock the actual values):

```text
ctranslate2-4.8.0/src/cuda/primitives.cu       -> --frandom-seed=0x........
ctranslate2-4.8.0/src/cuda/random.cu           -> --frandom-seed=0x........
ctranslate2-4.8.0/src/ops/conv1d_gpu.cu        -> --frandom-seed=0x........
ctranslate2-4.8.0/src/ops/awq/gemm_gpu.cu      -> --frandom-seed=0x........
```

Using the normalized relative path prevents independent-root drift. Using a direct hexadecimal number avoids relying on an undocumented CRC implementation. A collision check satisfies NVIDIA's requirement that different files receive different seeds.

### Smallest integration mechanism with pinned FindCUDA

The generated FindCUDA script invokes:

```cmake
COMMAND "${CUDA_NVCC_EXECUTABLE}"
  "${source_file}"
  ...
```

(`ctranslate2_generated_primitives.cu.obj.Release.cmake:257-270`). The smallest implementation that does not patch CTranslate2 CUDA source is therefore a **deterministic NVCC launcher** configured as `CUDA_NVCC_EXECUTABLE`:

- no `.cu` argument (for `--version`, discovery, etc.): forward unchanged to the pinned real `nvcc.exe`;
- exactly one recognized `.cu` argument: normalize it relative to the pinned CTranslate2 source root, look up the locked seed, append `--frandom-seed=0xXXXXXXXX`, and invoke real `nvcc.exe` without shell re-parsing;
- unknown, multiple, outside-root, or already-seeded source arguments: fail;
- preserve exit code and stdout/stderr exactly;
- log the canonical source and seed in verbose build evidence, but not private absolute paths.

This launcher must itself be pinned/hashed as a build tool and must use structured argument forwarding. A reviewed patch to the pinned FindCUDA templates that injects the same mapping is also valid, but it creates a larger third-party build-system patch surface. A single global seed in `CUDA_NVCC_FLAGS` is not acceptable.

### Verification sequence

Before product enablement:

1. compile every `.cu` twice in independent roots and compare generated `.obj` bytes;
2. compare `cuobjdump -xelf all -xptx all` extraction and confirm stable `_INTERNAL_...` names;
3. compare final `ctranslate2.dll` and import library bytes;
4. compare complete normalized runtime ZIP bytes;
5. assert every NVCC source invocation contains exactly one expected seed;
6. mutation-test missing seed, duplicate seed, unknown source, absolute-path-derived seed, and accidental global seed;
7. rerun fatbin closure, restricted PATH/module closure, RTX 3070 probe, model-backed smoke, cancellation/recovery, and all final model gates on the identical final SHA.

## 8. Exact implementation implications

No product code was modified by this research. A later implementation should make only the following baseline changes before rerunning qualification:

### Build configuration

- `native-asr/CMakeLists.txt:114`: change the cache description from CUDA 12.8 Update 1 to CUDA 12.9 Update 1.
- Preserve `CUDA_ARCH_LIST=6.1;7.5;8.6;8.9`, explicit `sm_120/compute_120`, static CUDART, dynamic cuBLAS, `WITH_CUDNN=OFF`, and `WITH_FLASH_ATTN=OFF`.
- Add a required, pinned real-NVCC path plus deterministic launcher/seed-map input for release CUDA builds only.
- Assert `nvcc --version` is exactly `12.9.86` and `cl.exe` is exactly the locked 19.44 version; reject 12.8, 12.9 GA, 14.50, and ambient `CUDA_PATH` drift.

### Input and artifact locks

- Replace CUDA rows in `native-asr/runtime/windows-x64-cuda-inputs.json` and `windows-x64-cuda-lock.json` with the 12.9.1 metadata/component/archive identities above.
- Add compiler/audit build component locks (`cuda_nvcc`, `cuda_cudart`, `cuda_cuobjdump`) instead of treating an installed Toolkit as an untracked authority.
- Update static CUDA Runtime inventory version from 12.8.90 to 12.9.79.
- Update cuBLAS version and selected DLL size/hash rows.
- Update `cudaCompilerVersion`, `cuobjdump` version, product qualified driver floor, EULA URL, and packaged license filename.
- Add seed algorithm version, canonical source root identity, complete source/seed mapping hash, launcher hash, and evidence that each source invocation received a unique seed.

### Packaging and verification

- `scripts/package-native-asr-cuda-runtime.ps1:114-132`: use the lock-pinned 12.9.82 `cuobjdump`, not ambient `CUDA_PATH`, and remove the hard-coded “CUDA 12.8” message.
- `scripts/package-native-asr-cuda-runtime.ps1:202`: replace the task-local 12.8.4.1 cuBLAS path with an input resolved from the locked 12.9.1 component archive.
- Keep runtime payload closure to the two selected cuBLAS DLLs unless final imports/module sampling proves otherwise.
- Keep the product source row absent and `productEnablementAllowed=false` until two independent clean builds, final pack identity, and final RTX 3070/model gates pass.

### Driver/product policy

- Keep the absolute floor `528.33` for CUDA 12.x diagnostics.
- Set initial qualified floor to `576.57` for the 12.9 Update 1 artifact.
- Preserve CC mapping and support language: GTX 10 / RTX 20 / RTX 40 / RTX 50 remain theoretical until their required non-real qualification evidence is complete; RTX 3070 is the required real lane.

## Recommendation

Adopt **CUDA 12.9 Update 1**, not CUDA 13 and not a CTranslate2 upgrade, as the smallest supported migration:

- it is the first patched CUDA line containing NVIDIA's official deterministic-symbol seed control;
- it retains offline `sm_61` through `sm_120`, preserving GTX 10 through RTX 50;
- it stays inside CTranslate2 4.8.0's documented CUDA 12.x contract and major-12 cuBLAS loader ABI;
- it preserves the exact existing architecture and compute policy;
- it allows the current MSVC 14.44/19.44 host toolset while rejecting 14.50;
- it changes only compiler/runtime component identities, driver qualification floor, and the deterministic per-source seed injection.

Do not claim the blocker resolved until the final seed-enabled 12.9.86 build produces byte-identical device objects, `ctranslate2.dll`, and complete runtime ZIPs in two independent clean roots.

## External references

### Official NVIDIA

- [CUDA 12.9 GA NVCC manual](https://docs.nvidia.com/cuda/archive/12.9.0/cuda-compiler-driver-nvcc/index.html) — first inspected release containing `--frandom-seed`.
- [CUDA 12.9 Update 1 NVCC `--frandom-seed`](https://docs.nvidia.com/cuda/archive/12.9.1/cuda-compiler-driver-nvcc/index.html#frandom-seed-frandom-seed) — deterministic symbol/variable naming semantics and per-file seed responsibility.
- [CUDA 12.9 Update 1 release notes](https://docs.nvidia.com/cuda/archive/12.9.1/cuda-toolkit-release-notes/index.html) — component versions, driver rows, and deprecated architecture policy.
- [CUDA 12.9 Update 1 Windows installation guide](https://docs.nvidia.com/cuda/archive/12.9.1/cuda-installation-guide-microsoft-windows/index.html) — supported Windows and Visual Studio/compiler table.
- [CUDA minor-version compatibility](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html) — CUDA 12.x driver compatibility model and caveats.
- [CUDA 12.9.1 redistributable metadata](https://developer.download.nvidia.com/compute/cuda/redist/redistrib_12.9.1.json) — authoritative component versions, archive paths, sizes, and SHA-256 values.
- [CUDA 12.9 Update 1 EULA](https://docs.nvidia.com/cuda/archive/12.9.1/eula/index.html) — redistribution terms.
- [NVIDIA forum report matching anonymous-namespace nondeterminism](https://forums.developer.nvidia.com/t/non-deterministic-compilation-when-anonymous-namespaces-are-used/303243) — corroborating issue context, not the primary authority for the solution.

### Pinned CTranslate2

- [CTranslate2 v4.8.0 release](https://github.com/OpenNMT/CTranslate2/releases/tag/v4.8.0) — pinned source identity and CUDA 12.8 support release.
- [CTranslate2 v4.8.0 installation/build options](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/docs/installation.md) — CUDA 12.x runtime and CUDA >=11.0 source-build contract.
- [CTranslate2 v4.8.0 contributing notes](https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/CONTRIBUTING.md) — major-12 cuBLAS dynamic-loading compatibility statement.

## Implementation outcome and remaining caveat

The implementation subsequently proved the recommendation on exact CUDA 12.9 Update 1 bytes:

- two independent final roots produced byte-identical sets of all 156 CTranslate2 objects plus byte-identical CT2 DLL/import library, worker, tokenizer DLL, and tokenizer import library;
- both complete normalized runtime ZIPs are byte-identical at `571,034,856` bytes / SHA-256 `9ca8511365009794a32f14e6fcaeb5aada9e088e9186125e9f3b54db74e300b4`;
- exact architecture, restricted probe, final large-v3 short smoke, and module closure pass;
- the traced overlay additionally requires build-only `libcurand 10.3.10.19`; final runtime audit proves `curand64_10.dll` is not deployed or loaded.

The exact final evidence is frozen in `final-cuda-12-9-artifact-qualification.md` and `native-asr/runtime/windows-x64-cuda-lock.json`. The only remaining artifact-distribution gate is external publication of those exact immutable bytes. This remains technical license research, not legal advice; legal-owner review is still required before publication.
