# Native ASR GPU mode implementation progress

- Date: 2026-08-31
- Product CUDA status: intentionally disabled pending publication of the exact immutable remote asset; no runtime-dependency source row is advertised.

## CUDA 12.9 Update 1 authority

The previous CUDA 12.8 input/artifact state is superseded. The tracked authorities now pin:

- `redistrib_12.9.1.json` size `54,256`, SHA-256 `8335301010b0023ee1ff61eb11e2600ca62002d76780de4089011ad77e0c7630`;
- `cuda_nvcc 12.9.86`, `cuda_cudart 12.9.79`, `cuda_cuobjdump 12.9.82`, `libcublas 12.9.1.4`, and build-only `libcurand 10.3.10.19` official archives;
- runtime `cublas64_12.dll` size `102,518,272`, SHA-256 `90052a83efd1b57a8e3616a6590b335855f81b814a4f16eecb7b5bf6d1b1d4eb`;
- runtime `cublasLt64_12.dll` size `668,669,952`, SHA-256 `c3a05ea244c937314afec09f87b91f814c7e27977681f6c67eb51bb06ced3a4a`;
- unchanged packaged archive `LICENSE` size `67,876`, SHA-256 `72c22161fc1ebf242443d45158a7dd382d68597b00eeb7a7f539be5c6114be33`.

CUDART remains statically linked. cuRAND remains build-only because final PE imports and model-backed loaded-module sampling do not require `curand64_10.dll`. `nvcuda.dll` remains system-driver-owned; cuDNN, dynamic CUDART, NCCL, and ambient Toolkit overrides remain forbidden.

## Deterministic build result

The release build uses exact nvcc `12.9.86` plus the pinned deterministic launcher and 25-entry per-source seed manifest. Every CTranslate2 `.cu` translation unit receives one unique `--frandom-seed` derived from its normalized relative path. Stable tracked AVX/AVX2/AVX512 wrappers replace build-root-generated ISA source copies.

Independent final roots:

- `.trellis/tasks/08-31-native-asr-gpu-mode/research/local/build/windows-x64-ct2-cuda-final-a`
- `.trellis/tasks/08-31-native-asr-gpu-mode/research/local/build/windows-x64-ct2-cuda-final-b`

Both roots pass all five Native CTests when the shared ignored launcher config is set to the root under test. Their complete set of 156 CTranslate2 objects is byte-identical: total `133,579,526` bytes, canonical object-manifest SHA-256 `f89590f9cf584281dd3e62d6652b9a2e6ef8aeee12a5c119d4d6966df815dc95`.

| Output | Size | SHA-256 |
|---|---:|---|
| `ctranslate2.dll` | 68,624,896 | `d0c3c0041426afcc4f21dcbd56c5af251d63af949599529dd2a1b2a8a36a2a76` |
| `ctranslate2.lib` | 51,321,322 | `fd18883a8fee176d6af504227e80d461c6604eb9e03f3ec2d88a30b9e43f5603` |
| `hikaru-asr-worker.exe` | 504,832 | `3179ab970e42735f3c42dc13267bbaa372e5d50a7404e4f6069372a997081ac6` |
| `hikaru_asr_tokenizer.dll` | 2,139,136 | `8971a5d90287e636bc5cbcf33b1c3173fba3f73fb0a91bdbc6aebb6f88ce672b` |
| tokenizer import library | 45,560 | `b00175ba4698011ca3667cbcb993147d754d1181fa24f8600e04187e5c9d0ab2` |

## Final package result

The package script now:

- verifies the exact final build output identities before staging;
- consumes only the locked official CUDA 12.9.1 component roots;
- uses the locked CUDA 12.9.82 `cuobjdump`, never ambient `CUDA_PATH`;
- packages the selected cuBLAS/cuBLASLt DLLs and exact 12.9 license;
- normalizes only locked private diagnostic prefixes in the copied CTranslate2 and tokenizer DLLs, preserving byte length with underscore padding;
- runs the lock-driven closed-tree verifier, fatbin audit, restricted RTX 3070 probe, and budget checks.

Independent packages:

- `.trellis/tasks/08-31-native-asr-gpu-mode/research/local/artifacts/windows-x64-cuda-final-a.zip`
- `.trellis/tasks/08-31-native-asr-gpu-mode/research/local/artifacts/windows-x64-cuda-final-b.zip`

They are completely byte-identical:

- size: `571,034,856` bytes;
- SHA-256: `9ca8511365009794a32f14e6fcaeb5aada9e088e9186125e9f3b54db74e300b4`;
- unpacked runtime: `843,553,473` bytes.

Selected final staged identities after approved diagnostic-path normalization:

| File | Size | SHA-256 |
|---|---:|---|
| `hikaru-asr-worker.exe` | 504,832 | `3179ab970e42735f3c42dc13267bbaa372e5d50a7404e4f6069372a997081ac6` |
| `ctranslate2.dll` | 68,624,896 | `550ba82825f747abc0fd00ea7a58cc28993c8b542c3d5a30faf1dee89bafd6cf` |
| `hikaru_asr_tokenizer.dll` | 2,139,136 | `587d0518fb0fea58ef3acb72a284b823abfc39de2ee13f5dcda5b6d278c7286c` |
| `runtime-manifest.json` | 13,468 | `9f2ff545c125c531dcb3d4fa0637edc1170c611daa9d698eb68883b2ba4d7adf` |
| `SHA256SUMS` | 2,053 | `df380e65771a99703a1be77611e0dc0c5543fae77004fd0a55282b613e95814f` |
| `cuda-fatbin.json` | 560 | `dd3dcceff808ef37394ef100e6329760e2c6dc7ee5d4191b64a4c46778a27780` |

## Final local qualification

- Both final ZIPs pass the lock-driven runtime verifier.
- Focused verifier mutation suite passes `10/10`.
- `cuobjdump` reports exact native SASS closure `sm_61, sm_75, sm_86, sm_89, sm_120` and the locked `compute_120` PTX row (reported by the tool as `sm_120`).
- Restricted `--probe-cuda` reports device 0, `NVIDIA GeForce RTX 3070`, CC `8.6`, `float16`, driver API `13020`, one visible device, and `available=true`.
- All seven Faster-Whisper models plus exact Kotoba pass the final-artifact short matrix; `large-v2` and Kotoba pass 4,144,235 ms long gates, and `large-v3` passes with `CUDA_DISABLE_PTX_JIT=1`. The sanitized summary SHA-256 is `c89543ccbe2392cdbfdffb5ed5bc5a93dfa0be3cdbf512315211e29af61c82c3`; see `final-cuda-12-9-model-matrix.md`.
- Refreshed process-module sampling proves runtime-root `cublas64_12.dll` and `cublasLt64_12.dll`, system `nvcuda.dll`, and no dynamic CUDART, cuDNN, cuRAND, or NCCL. Every observed module is under the final runtime root or Windows root; no Python or network fallback is involved.

The worker's frozen probe payload still conservatively reports `supportEvidence="theoretical"`. The Tauri capability projection now promotes only the exact lock-matching RTX 3070 / device 0 / CC 8.6 / float16 row to `realTested`; every other architecture remains `theoretical` without changing the qualified worker bytes.

## Exact final-worker Rust-host lifecycle and offline route

The ZIP at SHA-256 `9ca8511365009794a32f14e6fcaeb5aada9e088e9186125e9f3b54db74e300b4` was extracted under the ignored local matrix runtime and exercised through the real Rust `NativeAsrHost` on the RTX 3070 with the exact pinned Faster-Whisper `large-v3` model. The child PATH contained only the final runtime, an intentionally empty CUDA Toolkit `bin`, and Windows System32. This proves the packaged CUDA worker used its final runtime plus the system driver and local model/audio inputs, without ambient Toolkit binaries, Python fallback, or network fallback.

Two existing exact host tests passed:

- `asr_worker::tests::production_worker_runs_the_selected_device_through_the_native_host` passed in `6.85s`, proving the `ready`/selected-device route, valid completion, recovery JSON, ASS output, process reap, and active-slot release.
- `asr_worker::tests::cancelling_the_real_worker_after_ready_never_publishes_completed` passed in `5.39s` with the dedicated long audio, proving cancellation after `ready`, no published `completed`, no ASS output, `cancelled` recovery, process reap within two seconds, and active-slot release.

The exact-final-worker completion, cancellation, recovery, reap, active-slot, and offline/local-runtime evidence items are therefore closed without changing the frozen runtime bytes.

## Publication boundary

All local deterministic build, packaging, verifier, architecture, probe, module-closure, eight-model functional, and exact-final-worker Rust-host lifecycle/offline gates for this artifact identity are complete. External publication of these exact immutable bytes, followed by the reviewed source-row/product-enablement decision, is the only remaining external distribution gate.

Until that happens:

- `productEnablementAllowed=false` remains locked;
- `src-tauri/resources/runtime-dependency-sources.json` receives no CUDA source row;
- no remote asset is committed or published;
- CPU production remains independently available and unchanged.

## Quality-role review corrections

The direct Trellis quality review additionally fixed and regression-tested these integration defects:

- backend `devices` payload now includes the required CUDA device discriminator;
- the managed runtime verifier expects the locked CUDA 12.9 license filename rather than the superseded 12.8 name;
- product enablement now requires the lock's enable bit, both publication flags, and an exact size/SHA-matching ZIP source row, so flipping one field cannot open the gate;
- exact lock-matching RTX 3070 capability is projected as `realTested`, while every other row remains `theoretical`;
- explicit-CUDA continuation consumes a fresh availability result instead of a stale React closure, and an already-ready dependency still executes the pending continuation;
- CUDA preparation extraction/verification runs in `spawn_blocking`, checks cancellation before publication, and rejects concurrent same-kind preparation jobs;
- CUDA storage measurement/cleanup covers the managed runtime root plus CUDA-specific download staging, while cleanup remains blocked during active CUDA dependency/ASR work;
- Settings no longer offers a guaranteed-failing CUDA download action while the publication/source gate is closed.

Targeted frontend/Rust regressions, `pnpm build`, CUDA lock validation, `git diff --check`, and Trellis task validation pass after these corrections. The full slow suites were not rerun because the prompt supplied current successful full-suite evidence and the review changes were covered by focused tests.
