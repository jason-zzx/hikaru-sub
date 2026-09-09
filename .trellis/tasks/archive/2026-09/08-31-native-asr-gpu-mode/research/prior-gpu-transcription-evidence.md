# Research: Prior Native ASR GPU transcription evidence

- Query: Inspect archived/current Trellis tasks—especially T07 CUDA development, T08 Kotoba compatibility, T06R Whisper quality revision, related quality specs, and tracked evidence—to identify exactly what CUDA transcription was proven, reusable artifacts, and development-only versus production-ready boundaries.
- Scope: internal
- Date: 2026-08-31

## Executive conclusion

Real Native CTranslate2 CUDA transcription was proven repeatedly on one Windows 11 x64 development machine: NVIDIA GeForce RTX 3070 8 GiB, device 0, compute capability 8.6, driver 596.49 / `nvcuda.dll` 32.0.15.9649, CUDA Driver API 13020, CUDA Toolkit 12.8.93, CTranslate2 4.8.0, CUDA dynamic loading, `WITH_CUDNN=OFF`, and CUDA `FLOAT16`. The first proof used ordinary Systran Faster-Whisper large-v3 and established completed GPU generation plus a large paired speedup. Later tasks used the same reviewed CUDA lane to run full Kotoba short/medium/long transcription and multiple ordinary large-v3 quality diagnostics.

None of those CUDA binaries or rows is a production GPU runtime qualification. The current product contract is still a bundled Native **CPU** runtime; product Native routing accepts only `auto|cpu`, rejects CUDA before launch, and ships no CUDA runtime. Historical documents that say “Python legacy remains product/default” describe their task-time boundary; the later/current owning specification supersedes that historical routing status and defines Native CPU as production/default. The reusable value is the proven CUDA execution seam, exact machine/runtime/module identities, locked models and corpora, evidence/publisher patterns, Kotoba K2 algorithm input, and test-host seam—not promotion of an archived worker DLL set into release.

## Findings

### Files found

| File path | Description |
|---|---|
| `.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/research/cuda-input-lock.md` | Exact T07 machine, toolchain, model, sample, device/compute, and restricted-PATH identity. |
| `.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/research/cuda-module-lock.json` | Exact queried GPU and discovered shared/CUDA-only loaded modules, worker/runner hashes. |
| `.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/research/evidence/cuda-development-result.json` | Sanitized paired CPU/GPU measurements and `development-gpu-ready` disposition. |
| `.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/research/cuda-development-commands.md` | Reproduction/build/runner/host-test command shapes and frozen output hashes. |
| `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/kotoba-k1-lock.md` | Exact Kotoba model, CUDA runtime, worker/runner/modules, algorithm, and command shape. |
| `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/evidence/kotoba-candidate.json` | K1 short/medium/long GPU transcription results and exact runtime/model identity. |
| `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/kotoba-k2-lock.md` | Accepted K2 candidate geometry, worker identity, CUDA identity, and module hashes. |
| `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/evidence/kotoba-k2-candidate.json` | Complete accepted K2 CUDA quality matrix. |
| `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/kotoba-k2-handoff.md` | Accepted algorithm contract and explicit downstream/non-pack boundary. |
| `.trellis/tasks/archive/2026-08/08-20-native-asr-whisper-quality-revision/research/gpu-diagnostic-lock.md` | Ordinary large-v3 quality diagnostic GPU worker/runtime/module identity. |
| `.trellis/tasks/archive/2026-08/08-20-native-asr-whisper-quality-revision/research/whisper-gpu-diagnostic.json` | Six model-backed GPU diagnostic rows. |
| `.trellis/tasks/archive/2026-08/08-20-native-asr-whisper-quality-revision/research/whisper-gpu-vad-diagnostic.json` | Two model-backed CUDA + exact Silero V6 diagnostic rows. |
| `.trellis/tasks/archive/2026-08/08-20-native-asr-whisper-quality-revision/research/whisper-gpu-fallback-diagnostic.json` | Two model-backed CUDA + VAD + generation-fallback diagnostic rows. |
| `.trellis/tasks/archive/2026-08/08-20-native-asr-whisper-quality-revision/research/reproduction-commands.md` | Exact fallback acquisition/publication command shape and later invalid parity attempts. |
| `.trellis/tasks/archive/2026-08/08-20-native-asr-whisper-quality-revision/research/whisper-quality-non-qualified-handoff.md` | Final ordinary Faster-Whisper non-qualified boundary. |
| `.trellis/spec/asr/quality-guidelines.md` | Current evidence hierarchy and development-CUDA versus qualification rules. |
| `.trellis/spec/tauri/media-ffmpeg-asr.md` | Current production CPU route/runtime and model-backed CUDA host-test contract. |

## Exactly what CUDA transcription was proven

### 1. T07: ordinary Faster-Whisper large-v3, explicit Native CUDA execution and speed

#### Hardware and toolchain

The frozen T07 identity was Windows 11 x64 build 26200; NVIDIA GeForce RTX 3070 8 GiB, device 0, compute capability 8.6; driver 596.49; loaded `nvcuda.dll` 32.0.15.9649; CUDA Driver API 13020; CUDA Toolkit 12.8.93; MSVC 19.44.35221/tool root 14.44.35207; CMake 4.1.1-msvc1; Ninja 1.12.1; and CTranslate2 4.8.0 commit `54a546...` (`cuda-input-lock.md:15-30`). Build flags included `WITH_CUDA=ON`, `CUDA_DYNAMIC_LOADING=ON`, exact architecture 8.6, `WITH_CUDNN=OFF`, no HIP/tensor parallel/flash attention, shared CT2, and oneDNN retained for the paired CPU lane (`cuda-input-lock.md:32-47`).

The GPU identity was not accepted from caller labels: it was queried through the CUDA Driver API on device 0 and bound to the loaded driver module (`cuda-input-lock.md:69-69`). The discovered GPU record reports one visible device and FP16 support (`cuda-module-lock.json:33-42`).

#### Backend, model, compute type, and algorithm

The protocol/backend mapping was CPU → CTranslate2 CPU index 0 `INT8`; CUDA → CTranslate2 CUDA index 0 `FLOAT16`, with no automatic fallback (`cuda-input-lock.md:71-80`). The exact model was `Systran/faster-whisper-large-v3` revision `edaa852ec7e145841d8ffdb056a99866b5f0a478`; `model.bin` SHA-256 was `69f74147...` and the tokenizer/vocabulary identities were frozen (`cuda-input-lock.md:82-91`). The algorithm remained timestamp-driven seek, no previous-text history, beam 1, temperature 0, and no VAD (`cuda-input-lock.md:78-80`; full config in `cuda-development-result.json:14-45`).

#### Worker, runner, and runtime modules

The final T07 CUDA worker was `hikaru-asr-worker.exe`, 497,664 bytes, SHA-256 `73aa6f0d993f5d2ee74f3451ae3657bca219ec2ef07e400d966802df8851312a`; the evidence runner was 732,672 bytes, SHA-256 `143926ca86d9d149516489f10e2fdd63de4a776e249ff28731eea9328385e245` (`cuda-module-lock.json:77-80,121-124`). Required task-local DLLs were `ctranslate2.dll`, `hikaru_asr_tokenizer.dll`, `onnxruntime.dll`, and `onnxruntime_providers_shared.dll` (`cuda-module-lock.json:125-146`).

Separate completed CPU/CUDA discovery processes froze these actual loaded sets:

- Shared: `ctranslate2.dll`, the runner executable, `hikaru_asr_tokenizer.dll`, `onnxruntime.dll`, and system `vcomp140.dll` (`cuda-module-lock.json:151-187`).
- CUDA-only: `cublas64_12.dll`, `cublasLt64_12.dll`, and `nvcuda.dll`; there were no CPU-only modules (`cuda-module-lock.json:2-25`).
- No `cudnn*.dll` was permitted or observed; the task PRD records the same three CUDA-only modules (`.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/prd.md:20-24`).

The child PATH was deliberately restricted and ordered: task-local runtime bin, CUDA Toolkit 12.8 bin, Windows System32 (`cuda-input-lock.md:101-109`). This proves exactly which toolkit/driver modules supported the run, but also means the old artifact depended on an installed toolkit and system driver rather than a redistributable closed GPU pack.

#### Commands

The documented build/test sequence configured and tested protocol-only, CPU CT2, then `windows-x64-ct2-cuda-development` (`cuda-development-commands.md:19-30`). The runner was called under the restricted PATH with `--run-cuda-development-evidence`, exact model/revision/model hash, production worker, explicit `--device cpu|cuda`, and task-local raw outputs (`cuda-development-commands.md:32-70`). Four formal processes covered short CPU, short CUDA, 120-second CPU, and 120-second CUDA; each used one cold plus three warm generations (`cuda-development-commands.md:66-79`).

The Rust host compatibility suite set the CUDA-enabled worker, a CPU-only worker for deterministic `cuda_not_built`, exact model/audio/cancel audio, and `HIKARU_ASR_CT2_DEVICE=cuda`, then ran the ASR worker tests (`cuda-development-commands.md:83-91`). The current Tauri spec preserves this test-only pattern and explicitly forbids product code from reading those keys (`.trellis/spec/tauri/media-ffmpeg-asr.md:113-114`).

#### Results

The proof produced `development-gpu-ready` (`cuda-development-result.json:1-3`):

| Sample | CPU warm median RTF | GPU warm median RTF | GPU/CPU ratio | Result |
|---|---:|---:|---:|---|
| short-v1, 24.102 s | 0.577901 | 0.062971 | 0.10897 | >20% speedup, GPU RTF <=0.5 |
| medium-v1 first 120 s | 0.591635 | 0.077707 | 0.13134 | >20% speedup, GPU RTF <=0.5 |

Exact timings and raw evidence hashes are recorded in `cuda-development-result.json:191-227`. This was completed CTranslate2 generation, not merely CUDA library loading. Host compatibility additionally proved CUDA success/recovery/fallback ASS/reap/active-slot release, structured CPU-only `cuda_not_built`, and cancellation after a ready-derived duration (`.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/implement.md:160-177`).

The speed decision intentionally did not inspect subtitle text or calculate CER/gaps/timeline quality (`cuda-development-report.md:12-13`; `cuda-development-result.json:120-123`).

### 2. T08: Kotoba model-backed CUDA transcription, including a complete accepted K2 quality matrix

#### Hardware/backend/runtime identity

K1 and K2 reused the same machine lane: CTranslate2 4.8.0, CUDA Toolkit 12.8.93, architecture 8.6, dynamic loading, cuDNN off, RTX 3070 device 0, driver 596.49, and CUDA `FLOAT16` (`kotoba-k1-lock.md:76-91`; `kotoba-k2-lock.md:29-41`). The route was `kotoba-faster-whisper -> ctranslate2`, not a Python backend or second worker. The exact model was `kotoba-tech/kotoba-whisper-v2.0-faster` revision `f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc`, opened directly from its immutable Hugging Face snapshot without copying/mutation (`kotoba-k1-lock.md:31-57`).

K1 used worker SHA-256 `bc8f5f...` and runner SHA-256 `695174...` (`kotoba-k1-lock.md:103-110`). K2 used a rebuilt worker SHA-256 `93b8b678...` and runner SHA-256 `314cb67d...` (`kotoba-k2-lock.md:43-52`). Both retained the CUDA module identities for cuBLAS/cuBLASLt/nvcuda and task-local CT2/tokenizer/ORT (`kotoba-k1-lock.md:112-125`; `kotoba-k2-lock.md:90-101`). The evidence JSON binds the production worker, measurement executable, loaded modules, restricted PATH, queried GPU, model files, and exact lock (`kotoba-k2-candidate.json:134-290`).

#### Commands

K1 documented a direct CUDA build with `HIKARU_ASR_BUILD_CT2_WORKER=ON` and `HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT=ON`, then `ctest` (`kotoba-k1-lock.md:140-158`). Its runner used `--run-kotoba-evidence`, the exact snapshot, input lock, production worker, audio/case/repeats/output, under the restricted CUDA PATH (`kotoba-k1-lock.md:160-180`). Short ran `--repeats 4` (one cold plus three warm); medium and long were one measured run each (`kotoba-k1-lock.md:127-138,178-183`). K2 retained the same evidence mode and froze a distinct candidate/worker identity before acquisition (`kotoba-k2-lock.md:1-18,43-67`).

#### K1 result: real CUDA transcription, but algorithm rejected

K1 completed short, medium, and long-v2 on CUDA. Short RTF 0.035/CER 0.325 and medium RTF 0.032/CER 0.2163 passed, while long-v2 RTF 0.030/CER 0.2268 retained seven semantic gaps and failed (`kotoba-candidate-report.md:1-15`). The evidence records segment/window counts, RSS ~1.66 GB, timeline=0, and raw hashes (`kotoba-candidate.json:3-102`). Therefore K1 proves substantial Kotoba CUDA transcription and immutable-cache compatibility, but not an accepted algorithm or production route (`kotoba-k1-handoff.md:36-42`).

#### K2 result: accepted algorithm input on the reviewed CUDA lane

K2 changed the Kotoba-only stride/overlap/ownership algorithm, not the CUDA execution identity. It completed the entire short/medium/long-v2 matrix and every frozen gate passed (`kotoba-k2-handoff.md:3-17`):

| Case | GPU RTF | CER | Peak RSS | Timeline errors | Semantic gaps | Result |
|---|---:|---:|---:|---:|---:|---|
| short-v1 | 0.052 | 0.3500 | 1.66 GB | 0 | 0 | pass |
| medium-v1 | 0.047 | 0.2796 | 1.66 GB | 0 | 0 | pass |
| long-v2 | 0.043 | 0.2948 | 1.66 GB | 0 | 0 | pass |

The sanitized evidence includes exact raw hashes, process walls, segment ownership counts, and the disposition `accepted-kotoba-algorithm-input` (`kotoba-k2-candidate.json:3-106`). All seven K1 long-v2 gap coordinates became covered (`kotoba-k2-candidate.json:292-335`).

This is the strongest reusable algorithm evidence in the prior GPU tasks. However, the handoff explicitly assigns formal GPU runtime-pack/device qualification to later work and says it is not a publishable GPU pack or route enablement (`kotoba-k2-handoff.md:48-54`).

### 3. T06R/T20: ordinary large-v3 GPU quality diagnostics, all model-backed but non-qualified

#### Common runtime identity

The first six-cell ordinary Whisper diagnostic reused the reviewed T07 CT2 CUDA shared library and rebuilt the Hikaru backend/worker/runner. It used CTranslate2 4.8.0, CUDA 12.8.93, sm86, dynamic loading, no cuDNN; worker SHA-256 `aec9e98...`, runner `d6d2c1d...`, CT2 DLL `e2d74b6...`, and the same RTX 3070/driver identity (`gpu-diagnostic-lock.md:51-67`). Its expected loaded modules were runner, CT2, tokenizer, ORT, vcomp, nvcuda, cuBLAS, and cuBLASLt (`gpu-diagnostic-lock.md:69-82`). Every cell ran once in a clean process on CUDA device 0/FLOAT16 (`gpu-diagnostic-lock.md:24-37`).

The representative command was `hikaru-asr-ctranslate2-tests.exe --run-whisper-quality-diagnostic --cell ... --model ... --audio ... --output ... --diagnostic-lock ... --production-worker ... --model-id ... --model-revision ... --model-bin-sha256 ...` (`.trellis/tasks/archive/2026-08/08-20-native-asr-whisper-quality-revision/implement.md:119-134`).

#### Six-cell beam/history diagnostic

All six cells actually ran model-backed transcription. GPU RTFs ranged from 0.0707 to 0.3429 on medium and 0.0861 to 0.1033 on short, with RSS about 3.08 GiB (`whisper-gpu-diagnostic.md:1-12`). Five rows completed with scored output; `medium-b1-on` produced an identity-valid `timestamp_after_audio` failed trace (`whisper-gpu-diagnostic.json:251-270`). The selection was `no-candidate-selected`, and `qualificationEligible=false` (`whisper-gpu-diagnostic.json:11-18`).

#### Exact Silero V6 diagnostic

The exact-VAD worker/runner identity was frozen with worker `aec9e98...`, runner `e17379f...`, CT2 `e2d74b6...`, ORT 1.28.0, exact Silero V6 SHA-256 `4cbf549...`, and the same CUDA modules/GPU (`gpu-vad-diagnostic-lock.md:61-101`). Two clean-process rows ran on CUDA device 0/FLOAT16 (`gpu-vad-diagnostic-lock.md:3-14,120-124`). Short RTF was 0.121906, medium RTF 0.118600; both were structurally valid but failed relative text quality, so selection remained `no-candidate-selected` (`whisper-gpu-vad-diagnostic.md:1-10`; detailed VAD/sample and quality evidence at `whisper-gpu-vad-diagnostic.json:19-195`).

#### Upstream generation-fallback diagnostic

The fallback candidate rebuilt worker SHA-256 `b73301c...` and runner `1f72c282...`, retained CT2 `e2d74b6...`, ORT/Silero, exact eight-module loaded set, RTX 3070, CUDA 12.8.93, and CUDA device 0/FLOAT16 (`gpu-fallback-diagnostic-lock-v3.md:121-170`). The actual command shape is preserved in `reproduction-commands.md:12-46`, and publication in `reproduction-commands.md:50-71`.

Both rows completed model-backed transcription. Short performed 1 generation and no fallback, GPU RTF 0.116202; medium performed 29 generations with 12 fallback calls over 17 windows, GPU RTF 0.195917 (`whisper-gpu-fallback-diagnostic.json:19-118,119-221`). Both failed the relative quality gate and selection was again `no-candidate-selected` (`whisper-gpu-fallback-diagnostic.md:1-10`).

#### Final ordinary-Whisper status

The task closed `stop-revise / non-qualified`: no accepted ordinary Faster-Whisper candidate, no formal large-v3/large-v2 six-row matrix, and no CPU inherited qualification (`whisper-quality-non-qualified-handoff.md:1-15`). T14/T15 received no accepted ordinary Faster-Whisper algorithm input (`whisper-quality-non-qualified-handoff.md:23-29`). Later Phase 3D parity attempts are not reusable transcription proof: they either stopped before ASR model load/encode/generate or, in v5, after model construction but before encode/generate because an 80-mel probe contradicted the model's 128-mel contract (`whisper-quality-non-qualified-handoff.md:17-21`; `reproduction-commands.md:355-379`).

## Reusable artifacts and how far they can be reused

### Directly reusable as planning/build/test inputs

1. **Device/compute seam and failure semantics.** The existing worker design already maps CUDA to device 0/FLOAT16 and fails closed before `ready`; the quality spec preserves this development contract (`.trellis/spec/asr/quality-guidelines.md:425-450`). Reuse this interface and its structured errors rather than inventing a second GPU worker/protocol.
2. **Model-backed Rust host test seam.** Reuse `HIKARU_ASR_PRODUCTION_WORKER`, model/audio path, `HIKARU_ASR_CT2_DEVICE=cuda`, CPU-only worker negative, and cancel audio as test-only inputs; current product code must never consume them (`.trellis/spec/tauri/media-ffmpeg-asr.md:113-114,140-151`).
3. **T07 evidence architecture.** Reuse separate CPU/CUDA discovery, exact loaded-module set freezing, restricted PATH roles, clean-process formal rows, raw SHA binding, deterministic publication, and no-promotion rules (`.trellis/spec/asr/quality-guidelines.md:446-455,481-486`).
4. **Exact machine/tool identities as a regression reference.** RTX 3070/sm86, driver/API/module, CUDA 12.8.93, CT2 4.8.0, and cuBLAS/cuBLASLt hashes are valid reference inputs for reproducing the old lane. They are not a general support matrix or driver floor.
5. **Exact model identities.** The large-v3 revision/file hashes and exact Kotoba immutable snapshot/file hashes are reusable for identity comparison and model-manager/cache tests. Kotoba’s in-place immutable Hugging Face snapshot reuse was proven (`kotoba-k1-handoff.md:17-23`).
6. **Kotoba K2 algorithm contract.** The bounded stride/overlap/latest-start ownership algorithm is an accepted algorithm input and can be used as the algorithm side of a future GPU pack qualification (`kotoba-k2-handoff.md:19-29,48-53`).
7. **Tracked sanitized publishers/locks/evidence.** The JSON/Markdown locks, reports, raw-file hashes, and command shapes are reusable as provenance and mutation-test patterns. They do not replace fresh acquisition against a new worker/runtime artifact.
8. **Ignored/local build trees and raw evidence, if still byte-identical.** Task-local CUDA build outputs visibly remain under the task `research/local/` trees. They may accelerate local reproduction or forensic comparison, but must be rehashed against the relevant lock before use. They cannot be copied into a product runtime merely because they are present.

### Reusable only conditionally after byte-for-byte re-attestation

- T07/T08/T20 worker, runner, CT2, tokenizer, ORT, CUDA module, and restricted-PATH identities are tied to exact hashes. Any product change or rebuild creates a new evidence identity; old measurements cannot qualify new bytes. The current runtime spec says any runtime payload/manifest/target-graph change requires two clean reproducible builds, new model-backed smoke, package rebuild, and matching handoff (`.trellis/spec/tauri/media-ffmpeg-asr.md:276-285`).
- The installed CUDA Toolkit DLLs (`cublas64_12.dll`, `cublasLt64_12.dll`) were loaded from the toolkit PATH, not assembled into a reviewed redistributable archive. Licensing, redistribution, dependency closure, import closure, package size, install/update/rollback, and clean-machine launch remain unproven.
- T20’s fallback/VAD variants are useful negative/diagnostic evidence, not accepted ordinary algorithms. Do not make them defaults or qualification inputs (`whisper-quality-non-qualified-handoff.md:9-21`).
- Historical raw output hashes prove provenance only while the raw files remain available and hash-identical. The tracked reports deliberately omit transcript text, absolute paths, model bytes, and raw module paths.

## Development-only versus production-ready

### Proven and development-ready

- Real CUDA model construction and completed generation on RTX 3070 device 0/FLOAT16.
- Ordinary large-v3 paired GPU speedup and stable completed generation.
- Real worker/host CUDA success, recovery/fallback ASS, cancellation/reap, active-gate release, and deterministic CPU-only `cuda_not_built` negative.
- Kotoba exact immutable snapshot CUDA execution, short/medium/long quality acquisition, and accepted K2 algorithm behavior.
- Ordinary large-v3 CUDA quality diagnostics with no VAD, exact Silero V6, and exact generation fallback.
- Exact loaded-module evidence showing no cuDNN for the native CT2 lane.

These claims are explicitly development-only. The owning quality spec says the lane proves truthful execution and relative speed on one machine but does not qualify a runtime pack, release route, subtitle quality, installer input, downloader, or device matrix (`.trellis/spec/asr/quality-guidelines.md:417-421`).

### Algorithm-ready but not GPU-product-ready

- **Kotoba K2** is an accepted algorithm input. Its model/config/window/ownership behavior is reusable, and current production CPU support ultimately consumes that algorithm family. Its CUDA evidence still does not qualify CUDA packaging, broad device support, or a release GPU route (`kotoba-k2-handoff.md:48-54`).
- **Ordinary Faster-Whisper** has no accepted algorithm input from T20. The fact that many GPU diagnostic rows were fast and structurally valid does not overcome the quality disposition (`whisper-quality-non-qualified-handoff.md:23-29`).

### Current production-ready state

The current production contract is Native CPU only:

- Production accepts `faster-whisper|kotoba-faster-whisper`, `auto|cpu`, Japanese, no VAD, with seven Faster-Whisper models plus exact Kotoba; CUDA requests are rejected before worker launch (`.trellis/spec/tauri/media-ffmpeg-asr.md:197-215`).
- The bundled final runtime capability is exactly the two engines through CTranslate2 on CPU. GPU requests return `cuda_not_built`, and the package excludes CUDA/Vulkan runtime and development executables (`.trellis/spec/tauri/media-ffmpeg-asr.md:276-285`).
- The final CPU runtime is a closed-world verified archive with reproducibility, import/license/forbidden-content checks, package staging, and model-backed installed/portable gates (`.trellis/spec/tauri/media-ffmpeg-asr.md:243-315`). No analogous GPU archive exists in the inspected evidence.

Therefore the prior CUDA proof cannot be described as production-ready GPU support. It is a strong single-machine development proof and a source of exact qualification inputs.

## What remains for the active GPU-mode task

1. Build a **new production GPU runtime identity**, not reuse the archived worker ZIP/binaries as-is. It needs a closed artifact/manifest, exact runtime dependency closure, redistribution/license inventory, path safety, forbidden-file checks, and reproducible clean builds analogous to the current CPU runtime.
2. Decide whether GPU dependencies are bundled, separately managed, or rely on a narrowly specified system driver/toolkit contract. The old evidence relied on installed CUDA Toolkit DLLs and only proves one machine.
3. Define hardware/driver compatibility, device discovery, capability reporting, install/update/rollback, and controlled CPU fallback/product behavior. T07 explicitly left these downstream (`.trellis/tasks/archive/2026-08/08-04-native-asr-ctranslate2-cuda-development/prd.md:99-105`).
4. Rebuild and rerun model-backed evidence against the **final GPU worker SHA**. Old rows cannot qualify new bytes.
5. Requalify required model/algorithm matrices under the final pack identity. Kotoba K2 supplies an accepted algorithm candidate; T20 supplies no accepted ordinary Faster-Whisper candidate. The current quality contract requires discovery → frozen acquisition → qualification separation and forbids promotion of development diagnostics (`.trellis/spec/asr/quality-guidelines.md:63-82`).
6. Run clean-machine/package-level installed and portable tests, restricted-PATH/import closure, cancellation/recovery, unsupported-device failures, and no-Python-fallback behavior.
7. Update product routing/UI only after the GPU artifact and model/device qualification are complete. Current Tauri routing rejects CUDA and current package verification forbids GPU content.

## Caveats / not found

- No inspected artifact is a reviewed Windows x64 CUDA runtime ZIP, production runtime lock, installer/portable payload, managed CUDA downloader, or driver/device support matrix.
- No clean-machine launch proof was found for a self-contained GPU artifact; prior runs used an installed CUDA Toolkit 12.8 bin directory plus System32 driver module.
- No final-GPU-pack full seven-Faster-Whisper-model matrix was found.
- No accepted ordinary Faster-Whisper GPU quality candidate was found in T20; all valid model-backed scopes selected no candidate.
- Historical T07/T08/T20 task text often states Python legacy was product/default at that time. Do not copy that historical status into current requirements: the current Tauri spec now owns production Native CPU routing, while CUDA remains unavailable.
- The archived/current duplicate T07 `research/local/` build trees are ignored-local artifacts, not tracked release inputs. Their continued presence is not evidence that they match the frozen hashes until revalidated.
