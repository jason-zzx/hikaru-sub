# Phase A: CUDA build and distribution input freeze

- Date: 2026-08-31
- Status: superseded and re-frozen on CUDA 12.9 Update 1; local final artifact qualified, external publication intentionally pending.

## Official NVIDIA authorities

| Input | Usage | Size | SHA-256 |
|---|---|---:|---|
| `redistrib_12.9.1.json` | metadata authority | 54,256 | `8335301010b0023ee1ff61eb11e2600ca62002d76780de4089011ad77e0c7630` |
| `cuda_nvcc-windows-x86_64-12.9.86-archive.zip` | build-only compiler/NVVM/PTXAS | 126,917,884 | `227b109663b5e57d2718bcabb24a4ba0d9d4e52d958e327dc476f7c28691be85` |
| `cuda_cudart-windows-x86_64-12.9.79-archive.zip` | build-only headers/static CUDART | 3,521,238 | `179e9c43b0735ffe67207b3da556eb5a0c50f3047961882b7657d3b822d34ef8` |
| `cuda_cuobjdump-windows-x86_64-12.9.82-archive.zip` | build-audit-only | 6,219,088 | `1eda43a76a2eac25fce5bdb4b68673b5bda737d54cca5513148c36362ab7c811` |
| `libcublas-windows-x86_64-12.9.1.4-archive.zip` | build and selected runtime DLLs | 549,755,186 | `d534d98b0b453a98914dbf3adf47d7e84b55037abf02f87466439e1dcef581ed` |
| `libcurand-windows-x86_64-10.3.10.19-archive.zip` | build-only | 67,904,600 | `d0411f0b8c07e90d0fb6e01bfa7a54c9cb80f2ddf67e4ded2d96a50e19aadad6` |

URLs and usage roles are frozen in `native-asr/runtime/windows-x64-cuda-inputs.json`. Downloads, extracted components, and the assembled Toolkit overlay remain under ignored `.cache/native-asr-cuda-runtime/cuda-12.9.1/`.

## Selected runtime and license closure

| File | Size | SHA-256 | Disposition |
|---|---:|---|---|
| `cublas64_12.dll` | 102,518,272 | `90052a83efd1b57a8e3616a6590b335855f81b814a4f16eecb7b5bf6d1b1d4eb` | packaged runtime |
| `cublasLt64_12.dll` | 668,669,952 | `c3a05ea244c937314afec09f87b91f814c7e27977681f6c67eb51bb06ced3a4a` | packaged runtime |
| cuBLAS archive `LICENSE` | 67,876 | `72c22161fc1ebf242443d45158a7dd382d68597b00eeb7a7f539be5c6114be33` | packaged unchanged as `licenses/NVIDIA-CUDA-Toolkit-12.9-License.txt` |

`nvcuda.dll` remains system-driver-owned. CUDART is statically linked. cuRAND stays build-only because the final PE import and loaded-module closure does not require a runtime cuRAND DLL. cuDNN, dynamic CUDART, NCCL, and ambient Toolkit DLLs remain forbidden.

## Deterministic build authority

- Compiler: `nvcc 12.9.86`, exact `nvcc-real.exe` size `19,385,856`, SHA-256 `313cc032fb84bb9d53cb967843bc761f1f8959cb3aa924246659fde13afd8f14`.
- Launcher: exact deterministic wrapper size `370,688`, SHA-256 `5e2f63c1aa2ca3e0c68391b5c9dda662054e489411ae92c5a31f10c87543d001`.
- Seed manifest: 25 sorted CTranslate2 `.cu` translation units, size `1,798`, SHA-256 `68381bf67d036d6afaa81db2065dd38ac717f6008b6388c5309e4ac3d17b1f64`.
- Seed derivation: first unsigned 32-bit hexadecimal word of SHA-256 over `ctranslate2-4.8.0/<normalized-relative-path>`; zero, duplicate, unknown, outside-root, multi-source, and globally seeded invocations fail closed.
- Stable host ISA policy: tracked AVX/AVX2/AVX512 wrappers replace build-root-generated source copies and retain exact `/arch` flags.

## Frozen policy

- CUDA baseline: 12.9 Update 1 / nvcc 12.9.86 / CUDART 12.9.79 / cuBLAS 12.9.1.4 / cuobjdump 12.9.82.
- Architecture closure: native `sm_61`, `sm_75`, `sm_86`, `sm_89`, `sm_120`; optional locked `compute_120` PTX only.
- Absolute driver floor: 528.33; initial qualified product floor: 576.57.
- One immutable project-controlled combined pack; the application never assembles NVIDIA archives on the user machine.
- Independent budget: 700 MiB download, 1 GiB unpacked, zero installer/portable bytes, zero model weights.
- Legal-owner review remains required before release.

## Publication boundary

The exact local combined artifact may be frozen in the CUDA lock after independent packaging equality. `productEnablementAllowed` remains `false`, and `runtime-dependency-sources.json` intentionally has no CUDA source row until the exact bytes are published at a stable immutable remote URL. No remote asset is published by this task.
