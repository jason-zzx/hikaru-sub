# Native ASR GPU mode implementation plan

## Execution rules

- Do not modify the released CPU artifact bytes or weaken its lock to make CUDA fit.
- Do not enable product CUDA until a final managed pack identity exists and the relevant gates pass.
- Do not use or restore Python fallback.
- Bind every real GPU result to the exact final worker/runtime SHA-256.
- Keep changes minimal: reuse protocol v1, Native host lifecycle, runtime dependency jobs, model manager and frontend controls.

## Phase A - Freeze CUDA build and distribution inputs

- [x] Download the official pinned CUDA 12.9 Update 1 redistributable metadata plus nvcc/cudart/cuobjdump/cuBLAS/cuRAND archives into ignored cache staging.
- [x] Verify every metadata/archive size and SHA-256 against official values.
- [x] Extract and lock `cublas64_12.dll` / `cublasLt64_12.dll` plus the exact cuBLAS archive `LICENSE`; official CUDA 12.9.1 bytes supersede the prior CUDA 12.8 evidence identity.
- [x] Freeze NVIDIA license/notice requirements, build-only versus runtime component roles, driver policy (`528.33` absolute / `576.57` qualified), and compressed/unpacked budgets.
- [x] Add a CUDA runtime lock schema/input document without changing CPU capability claims.
- [x] Rollback point: no product code or runtime source metadata enabled yet.

## Phase B - Native worker CUDA release build

- [x] Add focused native tests for capability→compute mapping:
  - CC 6.1 → `INT8_FLOAT32`;
  - CC 7.5/8.6/8.9/12.0 → `FLOAT16`;
  - all other rows rejected.
- [x] Extend `ExecutionComputeType` and CTranslate2 mapping with `Int8Float32`.
- [x] Refactor CUDA device attestation so both model construction and capability probe reuse one internal implementation.
- [x] Add bounded `--probe-cuda` worker mode with stable structured result/error codes and no model/user data.
- [x] Add a release CUDA CMake preset/configuration with Candidate B/VAD/CrispASR/optional engines excluded.
- [x] Lock native targets `sm_61/sm_75/sm_86/sm_89/sm_120` and optional `compute_120`; avoid an upstream CMake patch unless the explicit flag route fails.
- [x] Keep CPU/protocol presets independent of CUDA inputs.
- [x] Verify the unchanged protocol/CPU route before continuing: protocol-only Native CTest, released CPU runtime verification, verifier mutation coverage and the full Rust host suite pass. The byte-identical locked CPU artifact was not rebuilt from its optional local input staging.
- [x] Preserve the rollback point while CUDA is gated: worker source supports a release CUDA build, while the published product still resolves to the existing CPU route until the remote artifact/source gate is deliberately opened.

## Phase C - Deterministic CUDA artifact and verifier

- [x] Generalize packaging/verifier code only where necessary to accept an explicit lock/artifact identity; preserve exact CPU tests.
- [x] Add `windows-x64-cuda-lock.json`, CUDA build-input authority and CUDA artifact packaging.
- [x] Package only the discovered runtime closure; keep `nvcuda.dll` system-owned and cuDNN forbidden.
- [x] Add lock-driven import owner and dynamic loaded-module expectations.
- [x] Add NVIDIA license inventory and human-readable project-license exclusion notice.
- [x] Add mutation tests for missing/tampered cuBLAS/cuBLASLt/license/manifest, injected Toolkit DLLs, unexpected cuDNN/CUDART, wrong architecture flags and private-path leakage.
- [x] Build from two independent clean roots and require byte-identical complete ZIPs.
- [x] Inspect final `ctranslate2.dll` with locked CUDA 12.9.82 `cuobjdump`; require exact SASS/PTX policy.
- [x] Run restricted-path `--probe-cuda`, final large-v3 short smoke, and refreshed model-backed module closure before freezing the final SHA.
- [x] Rollback point: exact artifact exists locally, while app download remains disabled because no stable remote asset/source row exists.

## Phase D - Managed runtime dependency

- [x] Add `RuntimeDependencyKind::NativeAsrCuda` / `nativeAsrCuda` across Rust and TypeScript.
- [x] Add canonical `deps/asr-runtime/cuda/current` and CUDA-specific download staging helpers.
- [ ] Add exact official/China source-profile entry for the immutable combined pack; intentionally blocked until the exact remote asset is published. China source must be byte-identical or omitted for CUDA.
- [x] Implement probe as bounded manifest/tree verification plus worker `--probe-cuda`; do not recurse for storage size.
- [x] Implement prepare/download/progress/cancel/safe extraction/tree verification/atomic publish/repair/rollback using the existing dependency job model.
- [x] Implement explicit storage measurement and contained cleanup with `spawn_blocking`, covering the CUDA runtime root and CUDA-specific staging.
- [x] Preserve previous valid pack until replacement is fully verified.
- [x] Add focused Rust tests for closed-tree corruption, product/source gate closure, exact RTX 3070 evidence projection, cleanup blocking, and CPU independence; broader failed-update/device cases remain covered by the full Rust suite where applicable.
- [x] Rollback point: capability/source metadata can keep CUDA disabled without changing CPU/model data.

## Phase E - Native execution resolver and capability payload

- [x] Add the small `resolve_native_execution(auto|cpu|cuda)` seam.
- [x] Key CPU/CUDA host caches by runtime identity so independent artifacts cannot alias.
- [x] Add explicit child environment configuration for CUDA pack DLL precedence and ambient Toolkit isolation.
- [x] Implement the approved policy:
  - [x] `cpu` always CPU;
  - [x] explicit `cuda` missing → download-required;
  - [x] explicit `cuda` failure → error, no fallback;
  - [x] `auto` available CUDA → CUDA;
  - [x] `auto` missing/incompatible CUDA → CPU + one user-visible nonfatal notice through the structured `start_asr` result;
  - [x] no fallback after GPU worker launch.
- [x] Keep `ResolvedNativeLaunch`, protocol v1, job snapshots, cancellation and recovery unchanged except for the resolved device/runtime.
- [x] Extend `list_asr_engines` with additive `devices` capability payload while retaining compatibility `device` temporarily; the CUDA row now carries the required `device="cuda"` discriminator.
- [x] Add Rust tests for every resolution row, no-Python fallback, ready route equality and CUDA host lifecycle. Focused payload/gate/evidence tests and the full Rust suite pass; the exact final packaged worker additionally passed the existing real-host completion and cancellation tests through `NativeAsrHost`, including recovery, reap and active-slot release.
- [x] Rollback point: backend and frontend remain disabled while the product/source gate is closed.

## Phase F - Frontend availability and download flow

- [x] Add typed `AsrDeviceCapability` and `nativeAsrCuda` runtime kind.
- [x] Update `useAsrAvailability` to trust backend `devices`, preserve saved unavailable CUDA and keep `auto` available through CPU.
- [x] Update Settings copy and Runtime Dependencies UI for managed CUDA download/repair/measure/cleanup and device/evidence details; the closed publication gate does not expose a guaranteed-failing download button.
- [x] Reuse existing shadcn controls and existing runtime dependency jobs; do not add a second downloader UI.
- [x] In TranscribeView, preserve a pending explicit-CUDA start intent, confirm pack download, display progress/cancel, then continue model readiness/download and ASR start. Fresh route results are consumed directly so React state publication cannot strand the continuation.
- [x] Ensure `auto` never triggers pack download.
- [x] Surface one-time auto CPU fallback notice and explicit CUDA errors in Simplified Chinese. `start_asr` now returns `{ jobId, notice? }`; TranscribeView renders the sanitized fallback notice once in a non-error informational surface and clears it for a new start or configuration/session change.
- [x] Add/update focused hook tests for capability rows, fresh post-prepare continuation, and the already-ready dependency race; existing component/start-payload regressions remain green.
- [x] Rollback point: keep `productEnablementAllowed=false` and omit the source row without touching CPU/model/settings data.

## Phase G - Final qualification on RTX 3070

- [x] Freeze final CUDA artifact SHA and stop changing runtime bytes.
- [x] Run `--probe-cuda`; assert device 0 / RTX 3070 / CC 8.6 / FLOAT16 / expected driver policy.
- [x] Run completed loaded-module discovery under restricted environment; require pack cuBLAS/cuBLASLt + system `nvcuda.dll`, reject ambient Toolkit/cuDNN/unexpected modules.
- [x] Run all seven Faster-Whisper + exact Kotoba short smokes on the final artifact.
- [x] Run `large-v2` and Kotoba >10-minute gates (both used 4,144,235 ms audio).
- [x] Run large-v3 regression, cancellation after ready, recovery, process reap, active-slot release and offline rerun. The exact final artifact SHA was exercised with the pinned `large-v3` model through the real Rust `NativeAsrHost` under a PATH restricted to the final runtime, an intentionally empty CUDA Toolkit `bin`, and System32. The completion test passed in `6.85s`; the post-ready cancellation test passed in `5.39s`, never published `completed`, wrote no ASS, persisted `cancelled` recovery, reaped within two seconds, and released the active slot.
- [x] Run an RTX 3070 pass with `CUDA_DISABLE_PTX_JIT=1` to prove native `sm_86` execution.
- [x] Validate installed-like and portable-like package behavior through `pnpm release:local`; CUDA pack is absent from NSIS/portable payloads and CPU remains bundled. Managed-pack runtime path tests are covered in Rust path/resolver tests.
- [x] Publish sanitized tracked evidence with artifact/summary hashes, timings, module roots and limitations; no transcript text, model bytes or private paths.

## Phase H - Full quality gate and documentation

- [x] Run two complete release CUDA Native CTest roots (5/5 each); protocol-only/CPU artifact gates also pass under the recorded commands.
- [x] Run runtime verifier and mutation tests for CUDA (10/10) plus CPU verification.
- [x] Run `pnpm test` (109 files / 824 tests before this review; targeted regressions added here also pass).
- [x] Run `pnpm build` (rerun after review fixes).
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml` (248 tests before this review; targeted Rust regressions added here also pass).
- [x] Run `pnpm release:local` and audit NSIS/portable: CPU runtime present, CUDA runtime absent, eight model identities present, no Python/GPU leakage into bundled resources.
- [x] Run Trellis validation and `git diff --check` after the final review edits.
- [x] Keep `AGENTS.md` truthful while product enablement is false; task/design/spec evidence records the gated managed CUDA implementation without claiming it is currently shipped.
- [x] Document RTX 3070 as real-tested and GTX 10 / RTX 20 / RTX 40 / RTX 50 as theoretical compatibility with VRAM and driver caveats.

## Validation commands

Core commands, adjusted to final script names if implementation parameterizes them:

```powershell
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm asr:runtime:verify
pnpm release:local
python ./.trellis/scripts/task.py validate 08-31-native-asr-gpu-mode
git diff --check
```

Native build/qualification commands to add or parameterize:

```powershell
cmake --preset windows-x64-ct2-cuda-release
cmake --build --preset windows-x64-ct2-cuda-release
ctest --preset windows-x64-ct2-cuda-release
pnpm asr:runtime:build:cuda
pnpm asr:runtime:verify:cuda
pnpm asr:runtime:smoke:cuda
```

## Risky files and rollback points

- `native-asr/CMakeLists.txt`, presets and CT2 backend: a wrong build flag can silently change CPU or CUDA compute identity. Keep CPU tests first and separate release presets.
- runtime lock/package/verifier scripts: never relax CPU forbidden-content or closure checks; use explicit per-artifact lock inputs.
- `src-tauri/src/dependencies.rs`: path containment, elevation, async blocking and atomic replacement are trust-boundary code; reuse existing helpers.
- `src-tauri/src/asr.rs` / `asr_worker.rs`: central route/fallback logic belongs in one resolver seam, not duplicated across commands.
- `TranscribeView.tsx`: pack download continuation must not regress model download, navigation lock, cancellation or ASS output.
- source manifest and artifact hashes: do not enable a URL until final immutable pack bytes exist.

## Final artifact freeze update

- [x] CUDA 12.9 Update 1 input/lock/package authorities are exact and complete, including build-only nvcc/CUDART/cuobjdump/cuRAND and runtime cuBLAS 12.9.1.4.
- [x] The pinned launcher, 25-source seed manifest, exact MSVC/CMake/Ninja identities, and stable ISA wrapper policy are locked.
- [x] Both independent final build roots pass all five Native CTests and have byte-identical 156-object CT2 sets plus runtime binaries.
- [x] Both independent final ZIPs are byte-identical: `571,034,856` bytes / SHA-256 `9ca8511365009794a32f14e6fcaeb5aada9e088e9186125e9f3b54db74e300b4`.
- [x] Verifier, mutation suite, exact architecture audit, restricted RTX 3070 probe, final short model smoke, and loaded-module closure pass.
- [x] Final lock freezes raw build outputs, normalized runtime files, complete ZIP identity, NVIDIA files/license, toolchain, and local qualification evidence.
- [ ] **Only pending artifact-distribution gate:** externally publish those exact immutable ZIP bytes at a stable URL, then add the reviewed source row and deliberately reconsider `productEnablementAllowed`. This run must not publish or add the row.

## Completion gate

Implementation is complete only when:

1. CPU remains fully releasable without CUDA.
2. The managed CUDA pack has a final closed identity and can be installed/repaired/removed independently.
3. Explicit CUDA and auto follow the approved non-fallback/fallback policy.
4. All eight models run on the final RTX 3070 artifact.
5. Static/fatbin policy covers GTX 10 and RTX 20/30/40/50 with truthful evidence labels.
6. Full tests, package audits, docs and specs agree with the shipped behavior.
