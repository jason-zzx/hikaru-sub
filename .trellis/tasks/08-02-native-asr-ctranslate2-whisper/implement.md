# Native CTranslate2 Faster-Whisper 产品化实施计划

> 状态：`in_progress / selected closure branch: migration-handoff-stop-revise`。该分支已由独立 checker 接受，但只表示 evidence-complete migration handoff，不代表 native qualification、GPU-required decision 或 route enablement。Candidate B direct ORT 1.28.0 CPU + faster-whisper 1.2.1 Silero V6 已实现。最后独立审查 blocker 修复后的 final lock `e687ead6...` / config `75dedb49...` 绑定 actual CPU/module paths、restricted PATH roots `77f4714a...` 与 module layout `a650e185...`，并通过 21 项 mutation matrix。Authoritative large-v3 short（1 cold + 3 warm）全部通过：CER `0.2667`、warm RTF `0.654`、cold `29.544s`、RSS `3.44 GB`、0 timeline/gap；medium（1 measured）CER `0.1055`、RTF `0.599`、RSS `3.44 GB`、timeline 0，但有 1 个 confirmed gap `>=1500ms`，因此立即停止为 `stop-revise`。long-v1、large-v2、其余模型和七模型矩阵未运行；Candidate A long 保留 7 个 confirmed gaps；Release/default 保持 Python legacy，native route disabled，T07 未激活。

## Dependencies

- Archived T01 benchmark contract, authoritative manifest identity and shared comparator.
- Archived T02 `inputs.lock.json`, source, raw-evidence contract and final report.
- T04 implementation `96077103e0c3070894b70ffa9fcd888bcc93075d`: final protocol library, canonical limits, `windows-x64-release` preset and fake-worker contract; T06 creates the production worker entry point.
- T05 implementation `74d1a4e`: generic `NativeAsrHost::new(executable, worker_args, active_gate)`, `ResolvedNativeLaunch::resolve(...)`, active gate, reducer, cancellation and recovery lifecycle; archive `a18509a`.
- `research/start-gate-lock.md` locks official/community Candidate A, one conditional Silero V6 Candidate B asset, all seven current model revisions/model-weight hashes/licenses and the ignored local boundary.
- `research/candidate-b-lock.md` converges the required planning gate on official ONNX Runtime 1.28.0 Windows x64 CPU, exact faster-whisper 1.2.1 V6 behavior/asset, upstream attribution, direct-session boundary, local smoke, and conditional T13 packaging impact.

Context manifests are refreshed to final tracked T04 protocol/limits, T05 durable Tauri spec and archived T05 planning evidence. No active T04/T05 task path remains.

## Execution Checklist

### 1. Finalize Runtime Input Lock

- [x] Record T01 corpus/manifest identity and frozen gates in `start-gate-lock.md`.
- [x] Record T02 CT2/oneDNN/toolchain primitives to promote and PoC algorithm pieces explicitly rejected.
- [x] Pin official OpenAI/faster-whisper Candidate A sources and exactly one conditional Silero V6 Candidate B source/model asset.
- [x] Lock all seven repository revisions, model-weight SHA-256 values, metadata identities, MIT licenses and qualification semantics; Tiny is remote-only but pinned/public/ungated.
- [x] Add active/archive task-local `research/local/` ignore boundary.
- [x] Before first model load, acquire the required pinned snapshot(s), compute every local required-file SHA-256, freeze selected algorithm config/reproduction commands, and write `algorithm-lock.md`.

### 2. Create Production Worker And Promote Proven Primitives

- [x] Add production `hikaru-asr-worker` CMake target and `src/main.cpp` using T04 protocol parse/validate/event serialization; keep fake worker test-only.
- [x] Dispatch ordinary faster-whisper to the CT2 backend and return stable pre-ready errors for unimplemented routes.
- [x] Integrate WAV validation, official mel, tokenizer/special token metadata and CT2 CPU int8 model load into the production worker.
- [x] Preserve source-vs-30s-model timestamp windows, raw token ranges and explicit WAV-end bounding.
- [x] Add CTest vectors for leading silence, final partial windows, consecutive timestamps, invalid token ranges and start-after-audio failure.
- [x] Do not move T02 evidence-only CLI/scorer into production code.

### 3. Implement Candidate A Timestamp-Driven Long Form

- [x] Advance seek from decoded timestamp evidence rather than fixed non-overlap steps.
- [x] Implement pinned prompt/history reset, no-speech and invalid-generation semantics.
- [x] Keep overlap dedupe narrow and auditable; no text/time generation.
- [x] Emit monotonic source progress and protocol-compliant segments/errors.
- [x] Keep window/generation boundaries process-cancellable through the T05 process-tree host and suppress completed after cancel/error.

### 4. Large-v3 Decision Gate

- [x] Retain T02 fixed-window result as the named failing baseline under the shared comparator.
- [x] Run Candidate A on short (1 cold + 3 warm), medium and long; long was terminated at the controlled 7,200s limit and retained unscored.
- [x] Candidate A failed mandatory gates; do not qualify or continue to the full model matrix yet.
- [x] Candidate B remained inactive for the initial Candidate A CER/RTF blockers; the later selected long-v1 gap-only failure activated the mandatory planning gate without retroactively changing this historical result.
- [x] Do not treat Candidate A `stop-revise` as final until the CPU RTF same-binary diagnostic gate below completes; the warmed matrix now rejects an inherent CPU ceiling and confirms history/beam overhead.
- [x] Freeze one algorithm/config identity before measurement; completed short/medium rows use one final identity, while the pre-final-build long timeout remains a separate unscored attempt identity.

### 5. Product-Model Matrix Gate (Stopped At Long Gap Gate)

- [x] Preserve historical Candidate A large-v3 evidence: short failed CER, medium failed CPU RTF, and long timed out unscored under separate identities.
- [x] Selected CPU candidate large-v3 short rerun has 1 cold + 3 warm and passes CER/RTF/cold/RSS/timeline/gap gates.
- [x] Selected CPU candidate large-v3 medium has one measured sample and passes CER/RTF/RSS/timeline/gap gates.
- [x] Selected CPU candidate large-v3 long completed under lock `0be239a...`: CER `0.2653`, CPU RTF `0.550`, RSS `3.43 GB`, 0 timeline errors, but 7 confirmed gaps `>=1500ms`; result is `stop-revise`.
- [ ] large-v2 short/medium/long hard gate — `blocked-not-run` because the mandatory large-v3 long gap gate failed; do not start it from this candidate.
- [ ] tiny/base/small/medium/large-v3-turbo short/medium/long — `blocked-not-run` because the mandatory large-v3 gate failed.
- [x] Report measured CER/RTF/cold/RSS/timeline/gaps and subtitle length distributions without averaging away failures.

### 6. Host/Protocol Compatibility

- [x] Real backend runs through T05 `NativeAsrHost::new(worker, vec![], gate)` and `ResolvedNativeLaunch::resolve(...)` using task-local locked model paths/resolved CPU, then T04 request/events, without new product IPC or protocol fields.
- [x] Add test-only real-worker host cases in `src-tauri/src/asr_worker.rs`; they consume `HIKARU_ASR_PRODUCTION_WORKER`, `HIKARU_ASR_CT2_MODEL_PATH`, and `HIKARU_ASR_CT2_AUDIO_PATH`, copy audio into a temporary managed workspace, and never change Release/default routing.
- [x] success/progress/structured-error/cancel/recovery tests pass with the model-backed route; Candidate A never emits `segmentsReplace` because no emitted segment is revised.
- [x] Completed is impossible after user/process cancellation.
- [x] Non-cooperative single-call cancellation remains bounded by T05 process termination.

### 7. Publish Provisional Candidate A Evidence

- [x] Enforce one executable/DLL/lock/algorithm identity for completed short/medium evidence; keep the pre-final-build long timeout as a separate unscored identity instead of merging it.
- [x] Validate model/corpus/case identities before scoring; retain the controlled long process-timeout record unscored with its identity/failure trace and explicit missing-token-trace limitation.
- [x] Generate deterministic `product-model-disposition.md`, JSON evidence and report twice with byte-identical output.
- [x] Keep all raw transcript/token/model/build data ignored and scan tracked output for private text/paths.
- [x] Preserve the measured executable hashes in this provisional baseline. It remains diagnostic input and must not be represented as the final selected candidate after the CPU gate reopens.

### 8. Diagnose CPU RTF Before Closure

- [x] Record the existing differential hypothesis without claiming proof: both T02/T06 medium runs use 17 windows; T06 adds `1.51%` source reprocessing, `53.69%` model generate time, `17.04%` generated tokens and `3,559` versus `34` prompt-prefix tokens.
- [x] Add one same-binary diagnostic mode and use the same 120s slice for exactly four warmed/measured cells: fixed/no-history/beam5; timestamp/no-history/beam5; timestamp/full-history/beam5; timestamp/full-history/beam1.
- [x] Record per-window prompt/history/prefix/generated token counts, feature/generate timing, seek/overlap, generation/fallback count, resolved threads, CPU/oneDNN/OpenMP/loaded-module/ISA evidence.
- [x] Change one variable per probe. Both no-history controls pass RTF `<=1.0`, so `return_scores` and thread sweeps are not activated.
- [x] Keep all diagnostic outputs ignored and ineligible for qualification; publish only deterministic sanitized aggregates in `research/cpu-rtf-diagnosis.md`.
- [x] Run same-binary authoritative short-v1 beam 1/5 selection with timestamp-driven seek and history disabled. Beam 1 passes CER/RTF/timeline/gap (`0.2667/0.632/0/0`); beam 5 fails CER (`0.3583`) despite 0 timeline/gap, so beam 1 is selected and beam 3/10 are not activated.
- [x] Freeze `selected-cpu-candidate-lock.md` without rewriting historical `algorithm-lock.md`, rebuild production defaults to beam 1/no-history, and rerun authoritative short (1 cold + 3 warm) plus medium (one measured sample).
- [x] Independent review fixed diagnostic-default drift and hardened selected evidence identity/containment, revised the lock, rebuilt, and reran only short/medium. Selected short passes: CER `0.2667`, warm RTF median `0.623`, cold wall `28.342s`, RSS `3.43 GB`, 0 timeline errors, 0 confirmed gaps. Selected medium passes: CER `0.1134`, RTF `0.559`, RSS `3.43 GB`, 0 timeline errors, 0 confirmed gaps.
- [x] Preserve Candidate A, CPU RTF, decode-selection, selected short/medium, and selected long evidence as five separate identity sets. The completed selected long row binds raw/result/publisher identities and fails only the confirmed-gap gate; no other model, seven-model matrix, or GPU-required handoff was started.

### 9. Candidate B Planning And Next Implementation Gate

- [x] Select exactly Microsoft ONNX Runtime `1.28.0` official Windows x64 CPU release ZIP; lock tag/commit, archive URL/size/SHA-256, required headers/import library/DLL/providers-shared/license/notices, C API 28, MIT license, VC runtime dependencies and package size in `candidate-b-lock.md`.
- [x] Acquire/extract/verify ORT only below canonical ignored `research/local/candidate-b/`; copy and verify the exact pinned faster-whisper `silero_vad_v6.onnx`.
- [x] Compile/run an ignored task-local direct C++ preflight using the locked ORT DLL/import library. It explicitly selects CPU, registers no custom ops, validates `input/h/c -> speech_probs/hn/cn` names/types/shapes, and passes one zero-input stateful inference.
- [x] Pin upstream Silero VAD tag `v6.0` commit `fba061d...` and MIT LICENSE; record that all three immutable upstream tag ONNX assets differ from faster-whisper asset SHA-256 `4cbf549b...`, which remains authoritative.
- [x] Freeze ordinary faster-whisper 1.2.1 V6 behavior: PCM16 `/32768.0`, 512/64 frames/context, recurrent h/c with 10,000-row calls, infinite max speech, `0.5/0.35`, `0ms/2000ms/400ms`, interval padding/merge, silence compression, source timestamp/progress restoration, cancellation and fail-closed ORT. Exclude batched `160ms/30s`, current Hikaru Python settings and silent Candidate A fallback.
- [x] After independent planning review, add one direct ORT session inside the existing CT2 backend. No executor interface/provider factory/custom build/protocol field/downloader/readiness/Python call.
- [x] Add focused CTest goldens for native probability, tail padding/context/recurrent carry, interval timestamps, compressed-to-source restoration, schema/hash errors and no-fallback ORT failure.
- [x] Rebuild and freeze a new final worker/test/DLL/VAD/config/tool identity without editing historical Candidate A/diagnosis/selection/selected locks. Last-review replacement lock `e687ead6...` binds actual CPU/module paths, canonical restricted PATH roots `77f4714a...`, and fixed module layout `a650e185...`; canonical config remains `75dedb49...`.
- [x] Add and pass a focused 21-case Candidate B mutation matrix covering manifest/case/audio/model, lock/config, runner/worker/DLL/VAD, loaded module/CPU/PATH, correlated all-module/all-root rewrite, metrics, timeout and failure drift.
- [x] Run the authorized large-v3 gate through T01 and stop on first hard failure: short 1 cold + 3 warm passes all gates; medium 1 measured fails only the zero-confirmed-gap gate with 1 gap. long-v1, large-v2 and remaining models were not run.
- [x] Candidate B is not retained, so ORT/VAD remains absent from T13 release packaging inputs.

### 10. Downstream Handoff

- [x] T07 boundary is recorded as the same production-worker seam, CPU diagnosis and selected algorithm for optional ignored-local CTranslate2 CUDA development; no CPU ceiling was proven, so T07/GPU is not activated and no release pack is implied.
- [x] T08 handoff is limited to reusable CT2 primitives; T08 remains the next independent Kotoba/native CT2 task and native faster-whisper may remain disabled while it proceeds.
- [x] T12/T16 handoff preserves all model IDs and the current provisional dispositions.
- [x] T13/T18 handoff records the development dependency/source/config identities but no accepted release artifact; Candidate B failed the medium gap gate, so ORT/VAD is not a T13 package input.
- [x] T14/T15 receive no qualification claim from this handoff; the complete CUDA matrix remains their later responsibility only if a reviewed `gpu-required-pending` branch is established.
- [x] T17 requirement remains: display all models, disable/explain non-qualified native routes, never silently use Python.
- [x] Selected reviewed closure branch is `migration-handoff-stop-revise`; it records the evidence-complete worker/host/publisher/downstream handoff while preserving native disabled status and all unresolved qualification gates.

### 11. Planning-Only Validation And Archive Handoff

This closure update is planning-only. Validate the T06 and parent task artifacts, inspect the diff, and do not run model inference, rerun authoritative measurements, alter evidence identities, stage/commit, or archive. A `migration-handoff-stop-revise` archive handoff is valid only after the independent review gate confirms the worker/evidence/publisher/host/protocol/downstream prerequisites above; it does not close qualification or activate T07/GPU.

## Python Migration Comparison (Non-Gating)

- [x] Run the existing T01 Python reference runner with the development interpreter, application `HF_HOME`, CPU, Japanese `large-v3`, and no extra VAD/config override for `short-v1`, `medium-v1`, and `long-v1`.
- [x] Publish the deterministic sanitized report at `research/python-large-v3-reference-report.md`; raw JSON remains below ignored `research/local/python-comparison/`.
- [x] Record the comparison as migration diagnostics only. Python short: CER `0.358`, warm inference RTF `0.886`, 1 timeline error, 0 gaps. Python medium: CER `0.099`, 1 timeline error, 1 gap, cold total RTF `1.084`. Python long: CER `0.295`, 0 timeline errors, 1 gap, cold total RTF `1.355`. The medium/long published RTF values are total RTF and are not substituted for native inference RTF.
- [x] Keep Candidate A as the native CPU baseline: it is better on short/medium absolute gates and native CPU inference cost, while its long-v1 seven-gap failure remains unresolved. Python being worse on some metrics does not qualify native or repair the native long-gap failure.

## Planned Files

Production scope, finalized against T04 layout:

```text
native-asr/src/main.cpp                      # production hikaru-asr-worker entry
native-asr/src/ctranslate2_whisper.hpp
native-asr/src/ctranslate2_whisper.cpp
native-asr/tests/ctranslate2_whisper_tests.cpp
native-asr/CMakeLists.txt                    # production + existing fake targets
src-tauri/src/asr_worker.rs                  # focused test-module additions only
```

Task evidence:

```text
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/python-large-v3-reference-report.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/python-comparison/*  # ignored
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/start-gate-lock.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/algorithm-lock.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/candidate-b-lock.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/candidate-b-final-lock.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/candidate-b-short-medium-report.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/candidate-b-product-model-disposition.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/candidate_b_adapter.py
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/publish_candidate_b.py
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/product-model-disposition.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/ctranslate2-whisper-report.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/selected-cpu-long-report.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/publish_selected_cpu_long.py
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/selected_cpu_long_adapter.py
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/evidence/*
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/*   # ignored
```

No T07/T08 or T12～T18 child files are modified; this task only records their handoff contracts. Candidate B planning acquisition/preflight remains under ignored `research/local/candidate-b/`.

## Validation

Candidate B locked input/preflight identity:

```powershell
$cb = ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b"
(Get-Item "$cb/downloads/onnxruntime-win-x64-1.28.0.zip").Length
(Get-FileHash "$cb/downloads/onnxruntime-win-x64-1.28.0.zip" -Algorithm SHA256).Hash.ToLowerInvariant()
(Get-FileHash "$cb/model/silero_vad_v6.onnx" -Algorithm SHA256).Hash.ToLowerInvariant()
& "$cb/preflight/run-preflight.cmd"
Get-Content "$cb/preflight/result.txt"
python ./.trellis/scripts/task.py validate .trellis/tasks/08-02-native-asr-ctranslate2-whisper
git check-ignore -v "$cb/preflight/result.txt"
git diff --check
git diff --cached --name-only
```

Expected archive/model hashes are `abef733dacbe2f571547a7150b479b5cb9cc0df22f96c24983a42cadb1b4f8bc` and `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2`; preflight ends with `result=pass` under ORT `1.28.0`, API `28`, explicit CPU and no custom ops.

Existing/future implementation presets come from T04/T13-compatible project setup:

```powershell
Push-Location native-asr
# windows-x64-release is protocol/fake-worker only; CT2/model builds opt in explicitly.
cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release
Pop-Location

$env:HIKARU_ASR_PRODUCTION_WORKER = (Resolve-Path "native-asr/build/windows-x64-protocol/bin/hikaru-asr-worker.exe").Path
# HIKARU_ASR_CT2_MODEL_PATH / HIKARU_ASR_CT2_AUDIO_PATH are set by the locked model-backed runner recorded in algorithm-lock.md.
cargo test --manifest-path src-tauri/Cargo.toml asr_worker
Remove-Item Env:HIKARU_ASR_PRODUCTION_WORKER

python scripts/asr-benchmark.py self-check
python scripts/asr-benchmark.py validate --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
cargo test --manifest-path src-tauri/Cargo.toml
python ./.trellis/scripts/task.py validate .trellis/tasks/08-02-native-asr-ctranslate2-whisper
git diff --check
```

Candidate B planning and final measurement identities are exact in `candidate-b-lock.md` and `candidate-b-final-lock.md`. Deterministic sanitized publication is `candidate-b-short-medium-report.md`, `candidate-b-product-model-disposition.md`, and `evidence/candidate-b-short-medium.json`; ignored raw/adapted results remain under `research/local/candidate-b/`.

## Review Gates

Before start:

- [x] T04/T05 completed/archived; manifests point to final protocol/limits/spec/research handoffs.
- [x] User-reviewed model policy is reflected: large-v3/large-v2 hard, all models visible later.
- [x] Candidate revisions, model identities/weight hashes, local ignored root and license provenance are lockable in `research/start-gate-lock.md`.
- [x] Candidate B planning gate is complete: `candidate-b-lock.md` pins the sole ORT executor, exact V6 behavior/asset/attribution, packaging impact, local CPU/no-custom-op preflight, commands and rollback.

Before completion:

- [x] CPU RTF four-cell diagnostic gate is complete: warmed A/B no-history controls pass, full history adds `44.2%` RTF, and beam 1 removes `25.2%` relative to full-history beam 5.
- [x] Bounded short decode selection and the selected CPU identity are complete; authoritative large-v3 short/medium pass all applicable frozen gates.
- [x] Independent review accepted the corrected short/medium checkpoint; the subsequent authoritative long-v1 completed and failed only the zero-confirmed-gap gate with 7 gaps.
- [x] Selected reviewed closure branch is `migration-handoff-stop-revise`; no branch may silently enable native routing.
- [x] All other models have reproducible `blocked-not-run` dispositions after the mandatory Candidate B medium failure; no long-v1, full seven-model measurement or qualification is claimed.
- [x] Full worker CTest, T01 focused tests and T05 real-host regression pass for Candidate B.
- [x] Independent checker accepted the Candidate B implementation/evidence and the selected `migration-handoff-stop-revise` branch; no native route or GPU qualification claim was made.

## Stop Conditions

- Authoritative timestamp-driven and one pinned VAD candidate cannot remove required gaps within frozen gates.
- T06 may stop at a reviewed `migration-handoff-stop-revise` branch when its worker, selected CPU baseline, Candidate B stop-revise evidence, Python non-gating comparison, deterministic publishers, host/protocol tests and downstream handoff are complete but no qualification branch is proven. This branch preserves the evidence and sends T08 forward independently; it is not a product qualification or GPU-required decision.
- Optimized CPU still exceeds RTF `1.0` after the reviewed same-binary matrix: publish the reviewed `gpu-required-pending` closure/handoff to T07/T14/T15 instead of treating ordinary faster-whisper as optional or qualified.
- Model/license/runtime identity cannot be pinned.
- Fix requires reference-derived repair, Python parity, synthetic timing or changes owned by T07/T12～T17.

Preserve evidence and report `stop-revise`; do not quietly qualify the route.

## Rollback

Disable ordinary faster-whisper native route and delete task-local ignored Candidate B ORT/preflight/build/raw outputs. Keep all Candidate A/diagnosis/selection/selected evidence, T04/T05 infrastructure and Python legacy; if Candidate B is not retained, T13 omits ORT/VAD. Do not modify user models or projects.
