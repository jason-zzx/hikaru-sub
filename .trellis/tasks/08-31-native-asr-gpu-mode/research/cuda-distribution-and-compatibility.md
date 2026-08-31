# Research: CUDA distribution and compatibility for the Windows x64 Native ASR GPU pack

- Query: Research official, current sources needed to design a redistributable Windows x64 managed CUDA runtime pack for the repo's pinned CTranslate2 4.8.0 CUDA worker. Determine redistributable status and notice/EULA obligations for likely runtime DLLs, CUDA 12.x minor-version/driver compatibility, practical minimum NVIDIA compute capability for CUDA 12.8 + FP16/CTranslate2, whether device 0-only is reasonable, and a safe pack source/update strategy. Cross-check archived T07 loaded-module evidence and the current lock/verifier architecture.
- Scope: mixed
- Date: 2026-08-31

## Executive conclusion

A self-contained, optional Hikaru Sub CUDA pack is legally and technically plausible without requiring the user to install the full CUDA Toolkit. For the exact reviewed CTranslate2 4.8.0 build shape (`WITH_CUDA=ON`, `CUDA_DYNAMIC_LOADING=ON`, `WITH_CUDNN=OFF`), the likely NVIDIA payload is only `cublas64_12.dll` and `cublasLt64_12.dll`; `nvcuda.dll` must remain system/driver-owned, and `cudart64_12.dll` is probably unnecessary because CTranslate2's legacy `FindCUDA` path defaults to the static CUDA runtime and T07 did not load a CUDART DLL. The final release build must re-prove this through PE imports plus completed model-backed loaded-module discovery; do not infer closure solely from the old build.

NVIDIA's CUDA 12.8 EULA Attachment A explicitly makes Windows `cublas.dll`, `cublasLt.dll`, `cudart.dll`, and `cudart_static.lib` redistributable, including versioned/architecture-specific filename variants. Distribution is conditional: the DLLs must be incorporated into an application with material additional functionality, accessed only by that application, not distributed as a stand-alone SDK, and the application's terms must be consistent with NVIDIA's agreement. The EULA's special NVIDIA source-code notice applies to modified/derivative CUDA sample source, not merely to shipping unmodified runtime DLLs. However, the official cuBLAS license contains third-party BSD-style notices that expressly require reproduction for binary redistribution. The safest verifiable policy is therefore to ship the exact official NVIDIA `LICENSE.txt` unchanged, list CUDA Runtime as statically linked and cuBLAS/cuBLASLt as bundled DLLs in the machine-readable notice inventory, preserve binary notices, and explicitly exclude NVIDIA components from the project's Apache-2.0 grant.

For CUDA 12.x, NVIDIA's Windows minor-version compatibility floor is driver `528.33`; newer drivers continue to support CUDA 12 applications through backward compatibility. That floor is conditional: newer-toolkit features that span toolkit and driver can fail with `cudaErrorCallRequiresNewerDriver`, PTX cannot be relied on with an older driver, and the application must contain explicitly targeted SASS (`-arch=sm_xx`). CUDA 12.8 Update 1 shipped with Windows driver `572.61`. Recommended product policy: treat `528.33` as the absolute technical floor, but initially publish/enable only a separately qualified driver floor—conservatively `572.61` or later—unless the exact final pack is tested successfully on lower 12.x-compatible driver branches with no PTX-only execution. The support floor can later be relaxed without changing the pack bytes after evidence is acquired.

CTranslate2's documented FP16 floor is compute capability `>= 7.0`; the repo independently enforces major capability `>= 7` and asks CTranslate2 whether FP16 is usable. CUDA 12.8 still supports Volta, while noting Maxwell/Pascal/Volta are feature-complete and will be frozen in a later release. Therefore the practical technical minimum for this fixed FP16 route is **SM 7.0**, not the lower minimum of CUDA 12.8 itself. Actual product support is additionally bounded by the explicit `CUDA_ARCH_LIST` compiled into the final CTranslate2 DLL and by tested hardware. T07's exact `8.6` build proves only SM 8.6; it cannot support a broader claim.

Device 0-only is a reasonable first-release product constraint because it matches the existing protocol/backend, the task explicitly excludes multi-GPU selection, and it avoids a new persisted device-index contract. It is not an optimal general multi-GPU policy: device 0 may be an older, low-memory, or busy adapter. Capability reporting must identify device 0, its compute capability and FP16 support, and failures must not silently choose another GPU. A future device picker can be additive.

The safest source/update strategy is to build the Hikaru pack from NVIDIA's immutable component redistributable archives described by a pinned `redistrib_12.8.1.json`, not by scraping an installed Toolkit or following a `latest` URL. The T07 `nvcc.exe` version `12.8.93` aligns with CUDA 12.8 Update 1, whose official redistributable metadata pins cuBLAS `12.8.4.1` and CUDART `12.8.90`. The final lock should pin metadata URL/hash, component archive URL/size/SHA-256, extracted DLL sizes/hashes/versions, the exact unchanged NVIDIA license hash, and the final combined Hikaru pack hash. Any CUDA component update—even within 12.x—must create a new pack identity and rerun reproducible build, module closure, driver/device, and model-backed qualification gates.

## Findings

### Files found

| File path | Description |
|---|---|
| `.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/research/cuda-module-lock.json` | Authoritative T07 loaded-module and GPU identity. |
| `.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/research/cuda-input-lock.md` | Exact CUDA 12.8.93 build inputs, DLL identities, build flags, restricted PATH, and device/compute mapping. |
| `.trellis/tasks/08-31-native-asr-gpu-mode/research/prior-gpu-transcription-evidence.md` | Cross-task summary of T07/T08/T20 GPU proof and production boundary. |
| `.trellis/tasks/08-31-native-asr-gpu-mode/research/production-cuda-gap-map.md` | Current product/runtime/package gaps and minimal integration seams. |
| `native-asr/src/ctranslate2_whisper.cpp` | Current device-0, FP16, driver API, capability, and structured failure validation. |
| `native-asr/runtime/windows-x64-cpu-lock.json` | Current closed-world runtime lock schema, source/license/file/import policy, forbidden content, and budgets. |
| `scripts/verify-native-asr-runtime.mjs` | Current extracted/archive verifier, exact file closure, hashes, imports, notices, private-path rejection, and budget checks. |
| `scripts/package-native-asr-runtime.mjs` | Parameterized lock-driven deterministic runtime packager and notice/manifest generation. |
| `src-tauri/resources/runtime-dependency-sources.json` | Existing official/China source-profile architecture; currently has no Native CUDA pack entry. |
| `.trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local/src/CTranslate2/CMakeLists.txt` | Pinned CTranslate2 4.8.0 CUDA linkage/build behavior. |
| `.trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local/src/CTranslate2/src/cuda/cublas_stub.cc` | Dynamic cuBLAS loading behavior and Windows DLL name. |
| `.trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local/src/CTranslate2/docs/quantization.md` | Pinned CTranslate2 4.8.0 compute-type/compute-capability table. |

## 1. Exact likely NVIDIA runtime closure

### T07 actual loaded modules

The completed T07 CPU/CUDA differential discovery recorded exactly three CUDA-only modules:

| Module | Root role | Bytes | SHA-256 | Evidence |
|---|---|---:|---|---|
| `cublas64_12.dll` | installed CUDA Toolkit 12.8 `bin` | 113,716,224 | `9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99` | `cuda-module-lock.json:3-10` |
| `cublasLt64_12.dll` | installed CUDA Toolkit 12.8 `bin` | 674,667,520 | `b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7` | `cuda-module-lock.json:11-17` |
| `nvcuda.dll` | Windows System32 / NVIDIA display driver | 4,466,920 | `ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c` | `cuda-module-lock.json:18-24` |

There were no CPU-only modules and no `cudnn*.dll` or `cudart64_12.dll` in the completed discovery (`cuda-module-lock.json:1-25,151-187`). T07's restricted PATH was task-local runtime, installed CUDA Toolkit 12.8 `bin`, and System32 (`cuda-module-lock.json:112-119`; `cuda-input-lock.md:101-109`). Thus the evidence proves the run's actual dependencies, but not a clean-machine pack.

### Why cuBLAS and cuBLASLt are both required

CTranslate2 4.8.0 with `CUDA_DYNAMIC_LOADING=ON` adds `src/cuda/cublas_stub.cc` rather than directly linking `${CUDA_CUBLAS_LIBRARIES}` (`CTranslate2/CMakeLists.txt:603-607`). On Windows the stub constructs the major-version DLL name `cublas64_<major>.dll` and calls `LoadLibraryA` (`cublas_stub.cc:8-14,53-68`). The stub does not directly name cuBLASLt, but completed T07 execution loaded `cublasLt64_12.dll`; it is therefore a transitive runtime dependency of the selected cuBLAS implementation and must be in the pack closure.

### Why `cudart64_12.dll` is probably not needed

T07 locked `cudart64_12.dll` only as “required only if actually discovered,” and it was not discovered (`cuda-input-lock.md:61-66`; `cuda-module-lock.json:3-24`). CTranslate2 uses CMake's legacy `FindCUDA` and `cuda_add_library` (`CTranslate2/CMakeLists.txt:494-542,680-684`). CMake documents `CUDA_USE_STATIC_CUDA_RUNTIME` as default `ON`, so absent an explicit override the CUDA runtime is statically linked. The pinned CTranslate2 build does not set this option to `OFF`.

**Recommendation:**

- Do not put `cudart64_12.dll` into the initial closure merely because it exists in the Toolkit.
- Record CUDA Runtime as a statically linked NVIDIA component of `ctranslate2.dll` in the license inventory.
- Make final PE import inspection and completed loaded-module discovery authoritative. If the release build imports or loads `cudart64_12.dll`, include the exact DLL from NVIDIA's pinned `cuda_cudart` redistributable archive and update all locks/budgets/evidence.
- Do not include unrelated Toolkit DLLs such as `curand64_10.dll`; T07 marked them discovery-dependent and they were not loaded.

Official CMake reference: [`CUDA_USE_STATIC_CUDA_RUNTIME` defaults to `ON`](https://cmake.org/cmake/help/latest/module/FindCUDA.html).

### Why `nvcuda.dll` must not be bundled

`nvcuda.dll` is the CUDA driver user-mode API supplied by the installed NVIDIA display driver, not a Toolkit runtime DLL in CUDA EULA Attachment A. T07 loaded it from System32, and the current backend deliberately loads the driver API and queries `cuInit`, driver version, device count, name, and compute capability before model construction (`native-asr/src/ctranslate2_whisper.cpp:981-1010`).

**Recommendation:** classify `nvcuda.dll` as a required system DLL with root role `windows-system32/nvidia-driver`; never copy it into the managed pack. Probe its presence/version and instruct the user to install/update an NVIDIA driver.

### Why cuDNN remains excluded

Current CTranslate2 documentation says users running models with convolutional layers “should also install cuDNN 8,” but its source build options independently default `WITH_CUDNN=OFF`; `WITH_CUDNN=ON` is optional and requires cuDNN >=8. In the pinned source, cuDNN replaces the native `conv1d_gpu.cu` path only when explicitly enabled (`CTranslate2/CMakeLists.txt:571-601`). T07 explicitly built `WITH_CUDNN=OFF`, completed Whisper/Kotoba transcription, and loaded no cuDNN.

**Recommendation:** keep `WITH_CUDNN=OFF` and exclude cuDNN from the initial pack. The generic wheel-install recommendation does not override exact model-backed module evidence for this custom build. Enabling cuDNN later is a distinct runtime/license/size/performance qualification change.

Official reference: [CTranslate2 installation and build options](https://opennmt.net/CTranslate2/installation.html).

### Likely complete first-pack runtime file shape

Subject to a new final build/discovery pass, the first CUDA sibling runtime should likely contain:

- `hikaru-asr-worker.exe`;
- CUDA-enabled `ctranslate2.dll` built from pinned CTranslate2 4.8.0;
- `hikaru_asr_tokenizer.dll`;
- the same required Microsoft Visual C++ runtime DLLs as the CPU pack;
- `cublas64_12.dll`;
- `cublasLt64_12.dll`;
- runtime manifest, checksums, NVIDIA/CTranslate2/tokenizer/Microsoft license files, and machine-readable third-party notices.

Current production no longer needs the T07-era ORT/VAD DLLs. The current CPU lock's required runtime closure contains CT2, tokenizer, and Microsoft runtime but no ONNX Runtime (`windows-x64-cpu-lock.json:204-272`). A final GPU build must determine its own closure rather than copying T07's task-local `onnxruntime.dll` rows.

## 2. Redistributable status and legal/notice obligations

### Attachment A expressly covers the likely files

The versioned CUDA 12.8 EULA states:

> “The following CUDA Toolkit files may be distributed with applications developed by you, including certain variations of these files that have version number or architecture specific information embedded in the file name.”

Attachment A then lists:

- CUDA Runtime / Windows: `cudart.dll`, `cudart_static.lib`, `cudadevrt.lib`;
- CUDA BLAS Library / Windows: `cublas.dll`, `cublasLt.dll`.

Therefore `cublas64_12.dll`, `cublasLt64_12.dll`, and either dynamic or statically linked CUDA runtime variants are within the express redistribution list.

Official references:

- [CUDA 12.8 EULA, Attachment A](https://docs.nvidia.com/cuda/archive/12.8.0/eula/index.html#attachment-a)
- [Current CUDA EULA](https://docs.nvidia.com/cuda/eula/index.html)

### Conditions on the redistribution grant

CUDA 12.8 EULA sections 1.1.1, 1.1.2, 1.2, and 2.2 provide the operative conditions:

1. Only portions identified as distributable may be distributed.
2. They must be incorporated in object-code form into an application with “material additional functionality.”
3. The distributable portions “shall only be accessed by your application.”
4. Developer tools are internal-only unless separately identified as distributable.
5. Application distribution terms must be consistent with the NVIDIA agreement and protect NVIDIA intellectual property.
6. The SDK may not be distributed as a stand-alone product.
7. Copyright/proprietary notices may not be removed.
8. Attachment A defines which CUDA Toolkit files are distributable.

A Hikaru-managed pack downloaded and used only by Hikaru Sub is consistent with this shape. Avoid presenting it as a general CUDA runtime installer or exposing it as a shared system Toolkit.

### Sample-source notice is not a DLL notice requirement

EULA section 1.1.2(3) requires the sentence:

> “This software contains source code provided by NVIDIA Corporation.”

for “modifications and derivative works of sample source code distributed.” The pack design does not propose distributing modified CUDA sample source, so this specific sentence is not triggered merely by shipping unmodified runtime DLLs. If CUDA sample source is later incorporated, reassess.

### Third-party notices inside the official CUDA license are mandatory in practice

The official cuBLAS redistributable `LICENSE.txt` includes third-party license sections. For example, the Vasily Volkov/UC Berkeley, Davide Barbieri, and University of Tennessee cuBLAS-derived routines use BSD-style terms stating:

> “Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.”

The file also contains other third-party notices with equivalent binary-distribution conditions. Thus a short NVIDIA attribution alone is insufficient.

**Recommendation:** ship the exact official NVIDIA `LICENSE.txt` unchanged and lock its bytes. For the inspected official CUDA redistributable license URL, the current observed identity was:

- URL: `https://developer.download.nvidia.com/compute/cuda/redist/libcublas/LICENSE.txt`
- size: `63,021` bytes
- SHA-256: `e2c71babfd18a8e69542dd7e9ca018f9caa438094001a58e6bc4d8c999bf0d07`

The `cuda_cudart/LICENSE.txt` URL returned the same observed size/hash. The final build must acquire and re-lock these bytes itself; this research observation is not a release lock.

### Recommended notice/EULA contract for the verifier

Add NVIDIA to the CUDA lock's `licenseInventory.components`, for example as two logical rows:

- `NVIDIA CUDA Runtime 12.8.90` — statically linked into `ctranslate2.dll`; governed by CUDA Toolkit EULA;
- `NVIDIA cuBLAS 12.8.4.1` — files `cublas64_12.dll`, `cublasLt64_12.dll`; governed by CUDA Toolkit EULA and included third-party notices.

Require:

- an unchanged `licenses/NVIDIA-CUDA-Toolkit-12.8-License.txt` (or similarly unambiguous name) with locked URL/size/SHA-256;
- human-readable notice that NVIDIA CUDA components are excluded from Hikaru Sub's Apache-2.0 project license and governed by the included NVIDIA terms;
- machine-readable component names, versions, source URLs, files/linkage mode, and license path;
- no endorsement language;
- preservation of DLL-embedded proprietary notices;
- end-user application terms that do not purport to relicense NVIDIA binaries under Apache-2.0.

The current CPU verifier already has a strong precedent for Microsoft runtime terms: lock-owned component metadata, exact license document identity, human-readable exclusion notice, and required license roles (`verify-native-asr-runtime.mjs:83-153,295-350`; `windows-x64-cpu-lock.json:106-116,159-174,266-272`). NVIDIA should receive an analogous generalized component contract rather than an ad hoc README.

**Legal caveat:** this is technical license research, not legal advice. Before release, project counsel/owner should review whether the app's end-user terms satisfy NVIDIA section 1.1.2(5), especially “only accessed by your application” and the open-source-license limitation.

## 3. CUDA 12.x minor-version and driver compatibility

### Official floor and ranges

NVIDIA's compatibility guide states:

> “From CUDA 11 onwards, applications compiled with a CUDA Toolkit release from within a CUDA major release family can run, with limited feature-set, on systems having at least the minimum required driver version.”

For CUDA 12.x:

- general major-family table: minimum driver `>= 525`, minor-version compatibility upper range `< 580`; drivers newer than the range remain supported by backward compatibility;
- exact release-note table for Windows x86-64: minimum minor-version compatibility driver `>= 528.33`;
- CUDA 12.8 GA Toolkit-bundled Windows driver: `571.96`, with toolkit-driver floor row `>= 570.65`;
- CUDA 12.8 Update 1 Windows driver component: `572.61`.

Official references:

- [CUDA minor-version compatibility](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html)
- [CUDA 12.8 release notes](https://docs.nvidia.com/cuda/archive/12.8.0/cuda-toolkit-release-notes/)
- [CUDA 12.8 Update 1 release notes](https://docs.nvidia.com/cuda/archive/12.8.1/cuda-toolkit-release-notes/index.html)

T07 used driver `596.49` and Driver API version `13020`, which is newer than CUDA 12.8 and valid through backward compatibility (`cuda-module-lock.json:33-41`). That single row says nothing about the lower supported driver floor.

### Compatibility caveats that matter to this pack

NVIDIA lists three important caveats:

1. A limited feature set: a feature spanning new Toolkit and driver may fail with `cudaErrorCallRequiresNewerDriver` on an older driver.
2. PTX runtime issues: applications using PTX will not work on older drivers and require a driver upgrade.
3. Minor compatibility requires an explicit target architecture argument such as `nvcc -arch=sm_xx`.

NVIDIA also warns that libraries have interdependencies, so mixing arbitrary cuBLAS/cuDNN versions is unsafe. This pack avoids that by pinning a same-release component set and excluding cuDNN.

### Recommended driver policy

Use a two-level contract:

- **Absolute technical reject floor:** Windows driver `< 528.33` is incompatible with CUDA 12.x minor-version compatibility and must be reported unsupported before worker launch.
- **Qualified product floor:** initially require the lowest driver branch on which the exact pack is model-backed tested. Conservatively use `572.61` (the CUDA 12.8 Update 1 Windows driver component) until lower branches are tested. If release qualification proves exact-SASS execution on `528.33` or another lower branch, lower the supported floor explicitly.

The UI/backend should distinguish “below CUDA 12.x absolute floor” from “meets NVIDIA compatibility floor but below Hikaru Sub's qualified driver floor.” Do not imply that `nvidia-smi`'s displayed “CUDA Version” is the installed Toolkit version; query the actual driver/API and module version as the current backend already does.

### Build implications for minor compatibility

- Freeze an explicit `CUDA_ARCH_LIST`; do not use `Auto` for a redistributable artifact.
- Include native SASS for every claimed supported architecture.
- Do not rely on PTX-only forward JIT for the published lower-driver support claim.
- Capture `nvcc`'s final `-gencode` flags in the lock and verify fatbin architectures as part of the artifact audit.
- Test at the minimum qualified driver, a current production driver, and at least one newer major driver.
- Treat `cudaErrorCallRequiresNewerDriver`, `no kernel image`, and driver initialization errors as distinct structured capability failures where possible.

## 4. Practical minimum compute capability for CUDA 12.8 + CTranslate2 FP16

### CTranslate2's FP16 floor is authoritative for this route

Pinned CTranslate2 4.8.0 documentation says FP16 is supported on NVIDIA GPUs with compute capability `>= 7.0`. Its GPU fallback table shows:

- `>= 8.0`: FP16 remains FP16;
- `>= 7.0, < 8.0`: FP16 remains FP16;
- `6.2`, `6.1`, and `<= 6.0`: requested FP16 falls back to FP32 in generic CTranslate2 behavior (`CTranslate2/docs/quantization.md:90-103`).

The Hikaru backend intentionally disallows such fallback: it checks `compute_capability_major >= 7` and `ctranslate2::mayiuse_float16(...)`, then emits `cuda_compute_type_unsupported` if false (`native-asr/src/ctranslate2_whisper.cpp:1011-1026`).

Official current reference: [CTranslate2 quantization/compute-type support](https://opennmt.net/CTranslate2/quantization.html).

### CUDA 12.8 architecture status

CUDA 12.8 release notes say Maxwell, Pascal, and Volta are “feature-complete and will be frozen in an upcoming release,” not yet removed. For Hikaru's fixed FP16 route:

- Maxwell/Pascal are below the CTranslate2 FP16 floor and must be rejected regardless of CUDA Toolkit support;
- Volta SM 7.0 meets the documented FP16 floor;
- Turing SM 7.5, Ampere SM 8.0/8.6, Ada SM 8.9, and Hopper SM 9.0 also meet it;
- Blackwell support cannot be inferred solely from CUDA 12.8 compiler support because the pinned CTranslate2 4.8.0 build system/default architecture list and kernels must be validated explicitly.

### Recommended product statement

- **Technical minimum:** NVIDIA compute capability **7.0**.
- **Actual support set:** intersection of (a) capability >=7.0, (b) explicit SASS targets in the locked CTranslate2 DLL, and (c) hardware/driver rows that pass final qualification.
- **Do not claim:** “all CUDA 12.8 GPUs” or Blackwell support without a matching fatbin and real/model-backed test.

At minimum, qualification should include one floor device (SM 7.0 if it is claimed), a common consumer Turing device (SM 7.5), the existing Ampere SM 8.6 lane, and an Ada device. If SM 7.0 hardware is unavailable, set the public minimum to the lowest architecture actually tested rather than advertising the theoretical CTranslate2 floor.

## 5. Device 0-only assessment

### Existing contract

The current backend rejects any `device_index != 0`, verifies device 0 through CUDA Driver API and CTranslate2, and constructs CUDA models with device vector `{0}` (`native-asr/src/ctranslate2_whisper.cpp:962-1027,1056-1058,1696-1711`). T07 had exactly one visible RTX 3070 and proved device 0/FLOAT16 (`cuda-module-lock.json:33-41`). The active PRD explicitly places user-selectable multi-GPU/device index out of scope.

### Recommendation

Device 0-only is reasonable for the first release if all of the following are true:

- capability reporting names the actual device 0 and reports visible device count, compute capability, driver, and FP16 status;
- explicit CUDA never silently changes to another GPU or CPU;
- `auto` only selects CUDA after device-0 preflight;
- OOM/model-load errors identify that device 0 was selected;
- documentation says multi-GPU selection is not supported;
- tests cover a multi-GPU/mock inventory where device 0 is unsupported even if another device would work, proving no hidden selection.

### Known limitation

On a multi-GPU workstation, device 0 may be the wrong adapter due to age, VRAM, workload, or ordering. Device 0-only reduces initial protocol/settings complexity but may reject a machine that has a usable GPU at another index. Record this as a product limitation, not an availability bug. A future additive `deviceIndex` setting can reuse CTranslate2's existing API after a separate UX/persistence design.

## 6. Safe source, pack construction, and update strategy

### Use NVIDIA's component redistributable metadata, not an installed Toolkit

NVIDIA publishes immutable component archives and JSON metadata under:

- index: `https://developer.download.nvidia.com/compute/cuda/redist/`
- CUDA 12.8 Update 1 metadata: `https://developer.download.nvidia.com/compute/cuda/redist/redistrib_12.8.1.json`

Observed metadata identity during this research:

- size: `50,197` bytes;
- SHA-256: `249e28a83008d711d5f72880541c8be6253f6d61608461de4fcb715554a6cf17`.

The JSON pins these Windows x86-64 components:

| Component | Version | Official relative path | Archive size | Archive SHA-256 |
|---|---|---|---:|---|
| `libcublas` | `12.8.4.1` | `libcublas/windows-x86_64/libcublas-windows-x86_64-12.8.4.1-archive.zip` | 563,660,944 | `57a470112cec7e112c95253dde8b3c7184d795dbd92b0bde77a4cb7f8c94c8aa` |
| `cuda_cudart` | `12.8.90` | `cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-12.8.90-archive.zip` | 3,037,735 | `4a39058fd8519444a81cfc7ae055d136f48d1a31ffa41ae255b35b2edd61e13b` |

Official archive indexes:

- [CUDA redistributable metadata index](https://developer.download.nvidia.com/compute/cuda/redist)
- [Windows x64 cuBLAS redistributables](https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64)
- [Windows x64 CUDART redistributables](https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/windows-x86_64)

The T07 `nvcc.exe` was `12.8.93` and the installed cuBLAS file version ended in `12.8.4`, strongly aligning with Update 1 (`cuda-input-lock.md:58-65`). However, this research did **not** download/extract the 563 MB official archive and byte-compare its DLLs to T07's installed-toolkit SHA-256 values. That comparison is a mandatory build-input preflight. If the bytes differ, prefer the official redistributable archive, rebuild the CUDA CTranslate2 worker against the selected official component set, and acquire fresh evidence; do not publish Toolkit-scraped DLLs merely to preserve old hashes.

### Recommended pack publication topology

1. **Build input acquisition:** download NVIDIA archives only from the pinned HTTPS URLs; verify archive size/SHA before extraction.
2. **Selective extraction:** copy only the final discovered redistributable DLL closure and exact license, not headers, import libraries, tools, samples, profilers, compiler binaries, or the full Toolkit tree.
3. **Combined Hikaru artifact:** package the CUDA worker, CT2/tokenizer/MSVC runtime, NVIDIA DLLs, notices, manifest, and checksums into a Hikaru-owned immutable pack such as `hikaru-asr-windows-x64-cuda-v1.zip`.
4. **Distribution URL:** publish the final combined pack as a versioned immutable Hikaru Sub release asset or equivalent project-controlled official artifact. The app should download that final pack, not assemble it from NVIDIA components on the user's machine.
5. **Source profile:** `runtime-dependency-sources.json` should contain exact final-pack URL/archive type/size/SHA. A China source, if offered, must serve byte-identical pack bytes and retain the same SHA; do not accept a separately repacked mirror. If a trustworthy byte-identical mirror is unavailable, expose official only for this dependency.
6. **Install:** download to task-specific staging under managed `deps/downloads`, verify outer hash, safely extract, verify inner closure, then atomically publish a versioned directory and switch `current`/active metadata only after success.
7. **Repair/rollback:** retain the previous verified pack until the new version passes verification; corruption or failed update must leave CPU and the prior CUDA pack usable. Cleanup stays within the managed CUDA dependency root.

### Update policy

Never follow `latest` and never automatically substitute another CUDA 12.x minor/component version because CUDA minor compatibility exists. CUDA libraries are independently versioned and may change behavior, kernels, size, dependencies, or driver needs.

Every update must:

- create a new artifact ID and immutable source lock;
- record the NVIDIA metadata JSON identity and component archive identities;
- re-extract and lock every DLL version/size/SHA;
- rebuild CTranslate2/worker twice from independent clean roots and prove deterministic output;
- re-run PE imports and separate CPU/CUDA completed loaded-module discovery under restricted DLL search paths;
- re-run mutation tests for missing/tampered cuBLAS/cuBLASLt/license/manifest files;
- re-run minimum-driver and supported-architecture gates;
- re-run the eight-model short matrix and required long/cancel/recovery/offline gates against the final worker/runtime SHA;
- publish only after the combined pack and source manifest agree.

## 7. Fit with the current lock/verifier architecture

### What can be reused

The CPU runtime system already provides most required mechanics:

- outer artifact ID/path/root/size/SHA and deterministic timestamp (`windows-x64-cpu-lock.json:1-10`);
- source, build-input, toolchain, capability, license, required-file, allowlist, forbidden-content, and budget authority (`windows-x64-cpu-lock.json:11-318`);
- safe ZIP entry validation and extraction (`verify-native-asr-runtime.mjs:179-248`);
- exact manifest/checksum/file closure and SHA validation (`verify-native-asr-runtime.mjs:363-449`);
- license inventory equality and exact license-file checking (`verify-native-asr-runtime.mjs:295-350`);
- PE import closure against bundled/system allowlists (`verify-native-asr-runtime.mjs:450-472`);
- deterministic packaging parameterized by a supplied lock (`package-native-asr-runtime.mjs:102-166`).

### Necessary CUDA-specific extensions

Keep an independent CUDA lock/root; do not weaken the CPU lock or remove its CUDA forbiddance. The CUDA verifier/lock needs additional concepts:

1. **Dynamic module closure:** expected completed loaded modules by root role, not only static PE imports. This is essential because CTranslate2 calls `LoadLibraryA` for cuBLAS and cuBLASLt appears transitively.
2. **Driver system role:** allow `nvcuda.dll` only from System32/NVIDIA driver, record version/API but do not hash-lock one universal driver binary for all users. Qualification evidence can lock exact test-machine driver bytes; product probe should use version/capability policy.
3. **Explicit CUDA component source rows:** metadata JSON, archive URL/size/SHA, extracted DLL identities, license URL/size/SHA, and static/dynamic linkage mode.
4. **Architecture identity:** exact `CUDA_ARCH_LIST`, generated `-gencode` flags, and audited embedded SASS/PTX targets.
5. **Driver policy:** absolute CUDA 12.x floor plus separately qualified product floor.
6. **Negative mutations:** missing/tampered/wrong-major cuBLAS, missing Lt, injected Toolkit DLL, unexpected PATH CUDA DLL, unexpected cuDNN/CUDART, wrong license, driver below floor, unsupported architecture, and device-0 unavailable.
7. **CUDA budget:** independent from the CPU/setup/portable budgets. T07's two cuBLAS DLLs alone are about 752 MiB unpacked, while the official Update 1 cuBLAS archive is about 537.5 MiB compressed; this confirms the active PRD's on-demand optional pack decision.

The current verifier hard-codes import owners to worker/CT2/tokenizer (`verify-native-asr-runtime.mjs:456-463`). That owner list should become lock-driven before adding any CUDA-specific owner, while preserving exact closure per artifact.

## 8. Recommended design decisions

1. **CUDA baseline:** CUDA Toolkit/redistributable family 12.8 Update 1, matching T07's `nvcc 12.8.93`, subject to official archive-to-T07 byte comparison and a fresh production build.
2. **NVIDIA dynamic DLLs:** `cublas64_12.dll` + `cublasLt64_12.dll` only, unless final discovery proves more.
3. **CUDA runtime:** static CUDART inside `ctranslate2.dll`; no `cudart64_12.dll` unless final imports/modules prove dynamic CUDART.
4. **Driver:** system-installed `nvcuda.dll`; never bundled.
5. **cuDNN:** off and excluded.
6. **Compute type:** fixed FP16.
7. **Compute capability:** technical floor SM 7.0; public support floor/set must match explicit fatbin targets and tested hardware.
8. **Device index:** device 0 only for v1, disclosed and truthfully attested.
9. **Absolute driver floor:** 528.33; initial supported floor should be the lowest model-backed qualified driver, conservatively 572.61 until lower-branch evidence exists.
10. **Source:** pinned official NVIDIA redistributable JSON/component archives as build inputs; project-published immutable combined pack as the application download.
11. **Licenses:** exact NVIDIA license shipped unchanged, third-party notices preserved, NVIDIA components excluded from Apache-2.0 project licensing, machine-readable linkage/file inventory.
12. **Updates:** new immutable identity and complete rebuild/requalification for every byte/version change; no floating latest or in-place component swaps.

## 9. Implementation implications

- Create a sibling lock such as `native-asr/runtime/windows-x64-cuda-lock.json` and artifact root `windows-x64/cuda/`; keep CPU bytes and policy independent.
- Generalize license verification so NVIDIA gets the same exact-document/exclusion-notice rigor as Microsoft without hard-coding every vendor into one function.
- Generalize import owners and add a separate lock-driven loaded-module verifier.
- Build CTranslate2 from source with locked `WITH_CUDA=ON`, `CUDA_DYNAMIC_LOADING=ON`, `WITH_CUDNN=OFF`, `CUDA_USE_STATIC_CUDA_RUNTIME=ON`, and explicit architecture list.
- Sanitize DLL loading so the pack directory and System32 are authoritative; do not let an installed Toolkit PATH override pack DLLs. The upstream CTranslate2 stub consults `CUDA_PATH` and calls `SetDllDirectoryA` (`cublas_stub.cc:53-61`), so the worker launch environment should remove/neutralize `CUDA_PATH` and use a reviewed DLL search policy, or the pinned source should be safely adjusted and requalified.
- Probe CUDA by driver API/device 0 before launch, but final readiness still requires CTranslate2 capability and model construction.
- Add the final combined pack to the managed runtime source manifest with exact progress/repair/cleanup behavior; do not place it in the main installer/portable archive.
- Set a dedicated unpacked/download budget of at least the measured final pack plus margin; existing 250 MiB runtime and 80/90 MiB release budgets cannot apply.
- Keep CPU runtime verification and launch fully independent when CUDA pack is missing, corrupt, unsupported, or rolled back.

## External references

- [CUDA 12.8 EULA](https://docs.nvidia.com/cuda/archive/12.8.0/eula/index.html) — redistribution grant, requirements, limitations, CUDA supplement, and Attachment A.
- [Current CUDA EULA](https://docs.nvidia.com/cuda/eula/index.html) — current governing-form reference; verify again at release time.
- [CUDA minor-version compatibility](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html) — CUDA 12.x driver range and compatibility caveats.
- [CUDA 12.8 release notes](https://docs.nvidia.com/cuda/archive/12.8.0/cuda-toolkit-release-notes/) — component versions, Windows driver tables, and deprecated architecture status.
- [CUDA 12.8 Update 1 release notes](https://docs.nvidia.com/cuda/archive/12.8.1/cuda-toolkit-release-notes/index.html) — Update 1 driver/component context.
- [NVIDIA CUDA redistributable index](https://developer.download.nvidia.com/compute/cuda/redist) — immutable component JSON and archive indexes.
- [NVIDIA cuBLAS Windows redistributables](https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64) — official component archives.
- [NVIDIA CUDART Windows redistributables](https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/windows-x86_64) — official component archives if dynamic CUDART becomes required.
- [Official NVIDIA CUDA redistributable license text](https://developer.download.nvidia.com/compute/cuda/redist/libcublas/LICENSE.txt) — full CUDA EULA plus third-party notices.
- [CTranslate2 installation](https://opennmt.net/CTranslate2/installation.html) — CUDA 12.x, optional cuDNN, and source build options.
- [CTranslate2 quantization](https://opennmt.net/CTranslate2/quantization.html) — FP16 and compute-capability support.
- [CMake FindCUDA](https://cmake.org/cmake/help/latest/module/FindCUDA.html) — static CUDA runtime default.

## Caveats / uncertainties

- The official CUDA 12.8 Update 1 cuBLAS archive was not downloaded/extracted in this research, so its internal DLL hashes were not byte-compared to the T07 Toolkit-installed DLL hashes. This must be resolved before freezing build inputs.
- The current online CTranslate2 documentation renders as 4.8.1; claims specific to 4.8.0 were cross-checked against the repo's pinned v4.8.0 source/docs.
- NVIDIA's EULA may change. Freeze the agreement applicable to the selected component bytes and re-review the current EULA immediately before release.
- Compute capability >=7.0 is a technical FP16 floor, not proof of performance, memory sufficiency, kernel coverage, or qualification on every GPU.
- Blackwell support for the pinned CTranslate2 4.8.0 build is not established.
- A universal lower-driver claim is not established. T07 used driver 596.49; lower branches require dedicated evidence.
- Device 0-only is intentionally limited on multi-GPU systems.
- This report does not constitute legal advice.
