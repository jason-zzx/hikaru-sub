# Final CUDA 12.9 Update 1 artifact qualification

- Date: 2026-08-31
- Scope: local deterministic build, packaging, static architecture audit, restricted RTX 3070 probe, all-eight-model functional matrix, required long gates, native-sm86 proof, loaded-module closure, and exact-final-worker Rust-host lifecycle/offline execution
- Publication status: not published; product enablement remains false

## Frozen artifact

| Field | Value |
|---|---|
| Artifact ID | `hikaru-asr-windows-x64-cuda-v1` |
| ZIP size | `571,034,856` bytes |
| ZIP SHA-256 | `9ca8511365009794a32f14e6fcaeb5aada9e088e9186125e9f3b54db74e300b4` |
| Unpacked bytes | `843,553,473` |
| Root | `windows-x64/cuda/` |

Independent ignored-local copies:

- `.trellis/tasks/08-31-native-asr-gpu-mode/research/local/artifacts/windows-x64-cuda-final-a.zip`
- `.trellis/tasks/08-31-native-asr-gpu-mode/research/local/artifacts/windows-x64-cuda-final-b.zip`

The complete files are byte-identical, not only equal in size/hash.

## Build reproducibility

Independent roots `windows-x64-ct2-cuda-final-a` and `windows-x64-ct2-cuda-final-b` each pass five Native CTests. All 156 CTranslate2 object files are byte-identical; their canonical `relative-path + size + SHA-256` manifest hashes to `f89590f9cf584281dd3e62d6652b9a2e6ef8aeee12a5c119d4d6966df815dc95` and totals `133,579,526` bytes.

Raw output identities:

| Output | Size | SHA-256 |
|---|---:|---|
| `bin/ctranslate2.dll` | 68,624,896 | `d0c3c0041426afcc4f21dcbd56c5af251d63af949599529dd2a1b2a8a36a2a76` |
| `ctranslate2/ctranslate2.lib` | 51,321,322 | `fd18883a8fee176d6af504227e80d461c6604eb9e03f3ec2d88a30b9e43f5603` |
| `bin/hikaru-asr-worker.exe` | 504,832 | `3179ab970e42735f3c42dc13267bbaa372e5d50a7404e4f6069372a997081ac6` |
| `bin/hikaru_asr_tokenizer.dll` | 2,139,136 | `8971a5d90287e636bc5cbcf33b1c3173fba3f73fb0a91bdbc6aebb6f88ce672b` |
| tokenizer import library | 45,560 | `b00175ba4698011ca3667cbcb993147d754d1181fa24f8600e04187e5c9d0ab2` |

The package verifies these raw identities before copying. It then applies two unique fixed-length diagnostic-prefix normalizations to the copied CT2/tokenizer DLLs. Final normalized runtime DLL hashes are frozen in `windows-x64-cuda-lock.json`.

## NVIDIA authority and closure

- CUDA 12.9 Update 1 metadata `8335301010b0023ee1ff61eb11e2600ca62002d76780de4089011ad77e0c7630`.
- nvcc 12.9.86, static CUDART 12.9.79 inputs, cuobjdump 12.9.82, cuBLAS 12.9.1.4.
- cuRAND 10.3.10.19 is build-only.
- Runtime DLLs:
  - `cublas64_12.dll`: `102,518,272`, `90052a83efd1b57a8e3616a6590b335855f81b814a4f16eecb7b5bf6d1b1d4eb`;
  - `cublasLt64_12.dll`: `668,669,952`, `c3a05ea244c937314afec09f87b91f814c7e27977681f6c67eb51bb06ced3a4a`.
- Exact packaged NVIDIA license: `67,876`, `72c22161fc1ebf242443d45158a7dd382d68597b00eeb7a7f539be5c6114be33`.
- System driver provides `nvcuda.dll`; no driver DLL is bundled.

## Verification results

1. Lock-driven archive verifier accepts final A and B.
2. Verifier mutation suite passes 10/10.
3. CUDA 12.9.82 `cuobjdump` reports SASS `sm_61, sm_75, sm_86, sm_89, sm_120` and the locked `compute_120` PTX row (tool label `sm_120`).
4. Restricted probe reports:

```json
{"available":true,"computeCapability":"8.6","computeType":"float16","deviceIndex":0,"deviceName":"NVIDIA GeForce RTX 3070","driverVersion":13020,"supportEvidence":"theoretical","visibleDeviceCount":1}
```

5. All seven Faster-Whisper models plus exact Kotoba pass the final-artifact short matrix with `ready.device="cuda"`, legal non-empty segments, and completed exit 0.
6. Faster-Whisper `large-v2` and exact Kotoba each pass the 4,144,235 ms long gate; a separate `large-v3` run with `CUDA_DISABLE_PTX_JIT=1` proves native `sm_86` execution. The sanitized summary SHA-256 is `c89543ccbe2392cdbfdffb5ed5bc5a93dfa0be3cdbf512315211e29af61c82c3`; see `final-cuda-12-9-model-matrix.md`.
7. Refreshed process-module sampling observes runtime-root `cublas64_12.dll` and `cublasLt64_12.dll`, system `nvcuda.dll`, and no `cudart64_12.dll`, cuDNN, `curand64_10.dll`, or NCCL. Every observed module is under the final runtime root or Windows root.
8. No Python process, Python payload, network fallback, or ambient Toolkit DLL is involved.

The frozen worker still emits conservative `supportEvidence="theoretical"`. This evidence file and the lock separately record the real local RTX 3070 run without changing the already-qualified worker bytes.

## Exact final-worker NativeAsrHost lifecycle and offline route evidence

The final ZIP identity above was extracted under the ignored local matrix runtime and exercised through the real Rust `NativeAsrHost` on the RTX 3070 with the exact pinned Faster-Whisper `large-v3` model. The child PATH was restricted, in order, to the final runtime, an intentionally empty CUDA Toolkit `bin`, and Windows System32. The exercised route therefore used only the packaged CUDA runtime plus the system driver, local model/audio inputs, and the unchanged Native host; it required no ambient Toolkit binary, Python fallback, or network fallback.

Two existing exact lib-only host tests passed against these final bytes:

1. `asr_worker::tests::production_worker_runs_the_selected_device_through_the_native_host` — passed in `6.85s`; proved the `ready`/selected-device route, valid completion, recovery JSON, ASS output, process reap, and active-slot release.
2. `asr_worker::tests::cancelling_the_real_worker_after_ready_never_publishes_completed` — passed in `5.39s` with the dedicated long audio; cancellation occurred after `ready`, `completed` was never published, no ASS output was created, recovery status was `cancelled`, the process was reaped within two seconds, and the active slot was released.

This closes the exact-final-worker model-backed completion, cancellation, recovery, reap, active-slot, and offline/local-runtime evidence boundary without changing the frozen artifact bytes.

## Remaining gates

The exact ZIP has no stable published remote asset. Therefore:

- `productEnablementAllowed=false` remains mandatory;
- no `nativeAsrCuda` source row is added to `runtime-dependency-sources.json`;
- no remote asset is published in this task;
- external publication of these exact bytes, followed by the reviewed source-row/product-enablement decision, is the only remaining external distribution gate.
