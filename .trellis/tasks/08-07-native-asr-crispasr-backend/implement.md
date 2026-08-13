# T09 CrispASR Backend Core — Implementation Plan

> Status: executed after user approval. Implementation, model-backed evidence, independent checks, and final verification are recorded below.

## Preconditions

- Parent T03/T03C, T04/T05, and the T06 production-worker seam are T09 dependencies. T07 is referenced only for the paired warmed-median rule; T08 is not a T09 dependency.
- Task decisions in `research/t09-planning-decisions.md` are frozen: external development GPU attestation, strict Qwen policy seam, and separate `parakeet-family` / `qwen3-family` results.
- Release/default remains Python legacy; the single T09 compile gate defaults off and all Rust model inputs are `#[cfg(test)]`.
- Private benchmark media, models, runtimes, build trees, and raw output stay below this task's ignored `research/local/` root.

## Step 1 — Freeze T09 source/runtime/model inputs

- [x] Create a tracked input lock for CrispASR v0.8.22 commit `cf0fdbbe...`, public header/open-layout source hashes, exact Parakeet/Reazon/Qwen/aligner model identities, T01 current manifest and first-120-second derivation, compiler/CMake/CUDA toolchain, and permitted licenses/attribution.
- [x] Record the official T03 CPU DLL only as `historicalAbiReference`. Step 1 freezes source/model/audio/toolchain inputs only; worker/runner/CUDA runtime hashes are frozen after those artifacts are built in Step 5.
- [x] Add ignored-local source/build/download/model/raw directories only under the exact canonical task root; assert active and future archive paths remain ignored.
- [x] Reuse the pinned upstream source already researched locally or reacquire it by immutable commit/archive identity; never resolve mutable `main`/latest.
- [x] Define candidate G1 open params: ABI v2, 16 threads, verbosity 0, flash attention 0 on both lanes, CPU `use_gpu=0/n_gpu_layers=0`, CUDA `use_gpu=1/n_gpu_layers=-1` plus pre-open CUDA preference.
- [x] Freeze the structured upstream-runtime and Hikaru worker/runner configure/build argv roles plus non-timeout prepare limits in the input lock. Missing source/toolchain/executable is input absence, not a GPU-unavailable build failure.
- [x] Record the two independent family matrices and exact repeat order before any model-backed run.

Validation/gate:

```bash
python scripts/asr-benchmark.py validate --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark
python scripts/asr-benchmark.py self-check
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
git check-ignore <task research/local sentinel paths>
```

Rollback: delete only task-local ignored inputs; no source behavior has changed.

## Step 2 — Add the private ABI module and no-model fake library

- [x] Extract the existing verified WAV reader unchanged into neutral `wav_audio.hpp/.cpp`; link both native backends, preserve CT2 error codes through thin translation, and lock behavior with existing plus cross-backend goldens.
- [x] Add `crispasr_backend.hpp/.cpp` with the narrow nested source-segment interface from `design.md`; keep opaque handles, function table, open-params layout, callbacks, and guards private.
- [x] Verify exact permitted runtime DLL size/SHA-256 before safe absolute loading, bind the exact required exports, and assert the wrapper's pinned open-params size/alignment/offsets. Do not claim `static_assert` alone proves DLL layout.
- [x] Implement explicit route mapping: Parakeet -> `parakeet`, ReazonSpeech -> `parakeet`, Qwen -> `qwen3`; verify advertised/opened backend before success.
- [x] Implement borrowed-data copying with native words nested under their source segment, callback normalization/reset, conditionally derived result/alignment/session cleanup, and stable error codes.
- [x] Implement strict Qwen capability output as copied source segments plus copied raw aligner entries; do not add a duplicate policy flag or accepted final segments.
- [x] Add one deterministic fake ABI DLL and one missing-export variant. The fake-test adapter alone uses a test-only runtime-hash bypass while separately testing the hash validator; the development worker/runner cannot bypass exact runtime identity.
- [x] Add fake/model-free tests for every lifecycle, callback, result/replacement, route, path, audio, device-param, and Qwen policy case listed in `design.md`.

Validation/gate:

```bash
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release -R "protocol|fake-worker|crispasr-backend-core" --output-on-failure
```

The model-free fake ABI suite is available in the normal test build and requires no CrispASR runtime. Do not add a tracked task-rooted preset.

Review gate: independently review ABI signatures/layout, callback reset ordering, exact-once counter derivation, fake-DLL missing-export realism, Qwen zero-output boundary, and absence of a generic backend hierarchy.

Rollback: remove the default-off CrispASR module/targets; protocol and CT2 builds remain unchanged.

## Step 3 — Wire the existing worker dispatch without changing protocol v1

- [x] Split `run_worker` into a narrow backend dispatch while preserving the existing CT2 branch byte-for-behavior as far as practical.
- [x] Add `run_crispasr` behind `HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT`.
- [x] Reject unsupported T09 VAD and Vulkan requests before `ready`; do not ignore or fall back.
- [x] Resolve exact model/aligner roles from the validated request and worker-local runtime path.
- [x] Emit `ready` only after audio/model identity/session/backend validation, exact runtime hash verification, and the internal minimum post-session-open device invariant. Document that `ready.device` matches the validated request under the development envelope and is not an ABI-resolved device claim.
- [x] Keep protocol JSON construction in `main.cpp`; callbacks return Hikaru `Segment` values only.
- [x] For Parakeet/Reazon, emit eligible previews and one `segmentsReplace` only when copied final output differs, then `completed`.
- [x] For Qwen, suppress ineligible session timing, run/copy ForcedAligner capability, then emit `qwen_timeline_policy_not_implemented` after `ready` with zero timed output.
- [x] Ensure post-ready errors use `Emitter`; do not serialize them through the pre-ready path.

Validation/gate:

```bash
ctest --preset windows-x64-release --output-on-failure
ctest --preset windows-x64-ct2-release --output-on-failure
ctest --preset windows-x64-ct2-cuda-development --output-on-failure
ctest --test-dir .trellis/tasks/08-07-native-asr-crispasr-backend/research/local/build/windows-x64-crispasr -C Release --output-on-failure
```

Add a direct negative that the normal `windows-x64-ct2-release` worker returns pre-ready `route_not_implemented` for a valid CrispASR request, and inspect that build's CMake cache to require `HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=OFF`.

Mutation checks: wrong backend/engine, Reazon filename inference attempt, extra/missing aligner role, VAD, Vulkan, CPU-only CUDA request, Qwen native timing promotion, preview/final divergence, invalid final timing, and error emitted through the wrong sequence path must fail.

Rollback: disable the CrispASR compile gate; CT2 and protocol behavior remain available.

## Step 4 — Add real Rust-host test-only CrispASR inputs

- [x] Add a separate `#[cfg(test)]` CrispASR ignored-local JSON input decoder while preserving the CT2 environment decoder.
- [x] Generalize the existing common model-backed launch helper to accept an exact vector of model roles/paths; reuse one `NativeAsrHost` launch/poll/recovery/cancellation state machine rather than adding a sibling lifecycle launcher.
- [x] Accept worker/locked model/optional aligner/audio/cancel-audio/device/engine through the single test-only `HIKARU_ASR_CRISPASR_INPUTS` JSON path; production and release code must not read it.
- [x] Cover Reazon CPU success, Qwen expected post-ready policy failure, host-resolver missing/non-regular model/aligner rejection, test-decoder hash mismatch rejection, native unloadable/invalid aligner failure with zero timed output, CPU-only CUDA rejection, active-gate release, recovery, and hard cancellation/reap within two seconds.
- [x] Record that hard cancellation proves OS reclamation/no orphan only; do not assert DLL/session cleanup counters from the killed process.

Validation/gate:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_worker::tests -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --release --manifest-path src-tauri/Cargo.toml
```

Security review: canonical managed paths remain Rust-owned; test env cannot affect release behavior; real-host tests report only sanitized codes plus ignored-local stderr-log identity and never print raw worker stderr into test failure output.

Rollback: remove only the test-only CrispASR parser/tests; production host behavior is unchanged.

## Step 5 — Build, discover, and freeze the ignored-local CUDA-enabled runtime

- [x] Implement one stdlib `run_crispasr_development.py` orchestrator before relying on the native runner. `prepare-runtime` builds only the upstream CUDA runtime; `prepare-worker` requires its reviewed locked identity before building Hikaru; `acquire` runs discovery/formal rows. Every mode executes only locked structured argv, captures ignored logs, and performs no metric adaptation or result classification.
- [x] Run `prepare-runtime` for the exact pinned upstream source/toolchain below ignored storage. On success, stop and independently review/freeze the produced CUDA-enabled `crispasr.dll` plus common GGML runtime identities into the tracked lock; do not configure Hikaru yet.
- [x] Run `prepare-worker` only after the tracked lock contains the reviewed runtime identity. It configures Hikaru with required private runtime size/hash inputs and builds the generated-identity backend, worker, and runner. On success, stop and independently freeze worker/runner/formal-runtime identities before acquisition.
- [x] The final `formalPairedRuntime` is used byte-identically by formal CPU and CUDA rows. CPU differs only by frozen open params/preference and absence of lazily loaded GPU-only modules.
- [x] On a validated non-timeout configure/build failure, require two family pre-runner envelopes with one shared attempt identity, locked stage/command/source/toolchain identity, nonzero exit, log hashes, and privacy pass; skip runner discovery/formal rows.
- [x] Missing source/toolchain/executable, prepare timeout, invalid log/privacy, or incomplete pairing yields no result and blocks T09.
- [x] The runner and Rust test-input decoder validate exact model/aligner/audio lock identities before worker launch; model hashes are not public backend interface fields.
- [x] Implement the frozen native runner CLI from `design.md`: `--run-development-evidence --phase discovery|formal --family ... --device ... --sample ... --input-lock ... --library ... --model ... [--aligner ...] --audio ... --output ...`.
- [x] Discovery is exactly one fresh process, one session, and one generation. Run all four family/device discovery rows on short-v1; Qwen discovery executes both session transcription and ForcedAligner.
- [x] Capture checkpointed module identities after session open, after transcription, and after Qwen alignment. Bind sanitized root role, relative name/path, size, SHA-256, CUDA Driver API identity, restricted PATH, runtime/build identity, and `resolvedComputeDeviceAvailable=false`.
- [x] Freeze reviewed shared/CPU-only/CUDA-only checkpoint envelopes before formal measurement or real-host CUDA smoke.
- [x] Prove the official T03 CPU DLL substituted into a formal CPU row, CPU-only DLL under CUDA request, missing/renamed/post-align GPU module, CPU params relabeled CUDA, device identity rewrite, role/root swap, family label swap, and correlated root rewrite all fail.
- [x] A complete family discovery/configure/build/session-load/aligner-load/device failure may publish `development-gpu-unavailable`. Missing required local input, runner exit `2`, invalid/incomplete evidence, or unreviewed timeout publishes no result and blocks T09 completion.

Prepare/build and discovery shape:

```powershell
$Task = ".trellis/tasks/08-07-native-asr-crispasr-backend"
$Build = "$Task/research/local/build/windows-x64-crispasr"
$Lock = "$Task/research/crispasr-development-lock.md"
$Raw = "$Task/research/local/raw"
$RawIndex = "$Task/research/crispasr-development-raw-index.json"

python "$Task/research/run_crispasr_development.py" prepare-runtime `
  --input-lock $Lock --source-root "$Task/research/local/upstream" `
  --runtime-build-root "$Task/research/local/build/crispasr-cuda" `
  --raw-root $Raw --raw-index $RawIndex
if ($LASTEXITCODE -eq 20) { Write-Host "validated shared runtime-prepare failure"; return }
if ($LASTEXITCODE -ne 0) { throw "runtime prepare produced no eligible result" }

# Independently review/freeze prepared-runtime.json into the tracked lock, then:
python "$Task/research/run_crispasr_development.py" prepare-worker `
  --input-lock $Lock --worker-build-root $Build --raw-root $Raw --raw-index $RawIndex
if ($LASTEXITCODE -eq 20) { Write-Host "validated shared worker-prepare failure"; return }
if ($LASTEXITCODE -ne 0) { throw "worker prepare produced no eligible result" }

# Independently review/freeze prepared-worker.json/formalPairedRuntime into the lock, then acquire.
$Runner = "$Build/bin/hikaru-asr-crispasr-tests.exe"

# Repeat for cpu/cuda, or use the acquire command below.
& $Runner --run-development-evidence --phase discovery `
  --family parakeet-family --device cpu --sample short-v1 `
  --input-lock $Lock --library $CrispAsrDll --model $ReazonModel `
  --audio $ShortAudio --output "$Raw/discovery/parakeet-family/cpu/short-v1.json"
if ($LASTEXITCODE -notin @(0,20)) { throw "invalid parakeet discovery" }

& $Runner --run-development-evidence --phase discovery `
  --family qwen3-family --device cpu --sample short-v1 `
  --input-lock $Lock --library $CrispAsrDll --model $QwenModel --aligner $QwenAligner `
  --audio $ShortAudio --output "$Raw/discovery/qwen3-family/cpu/short-v1.json"
if ($LASTEXITCODE -notin @(0,20)) { throw "invalid qwen discovery" }
```

Use the fixed 600-second process timeout for each discovery invocation. Discovery rows never enter performance medians. Run a family's four formal rows only when both of its discovery rows are measurement-eligible; a validated unavailable discovery skips that family's formal rows.

Rollback: delete ignored CUDA outputs; CPU/protocol/CT2 builds remain unchanged.

## Step 6 — Run `parakeet-family` development matrix

- [x] Use ReazonSpeech with explicit upstream backend `parakeet`.
- [x] Use short-v1 and the locked first 120 seconds of medium-v1.
- [x] For each sample/device, run one fresh process containing one backend session and exactly four sequential generations: repeat `0`/`cold`, then repeats `1..3`/`warm`.
- [x] Any missing, failed, duplicate, or reordered generation invalidates the whole row. A retry uses a new attempt identity and reruns all four generations; never mix attempts.
- [x] Keep source/model/audio/runner/worker/DLL/common runtime fixed byte-for-byte; only the frozen CPU/CUDA params/preference and validated GPU-only module presence may differ.
- [x] Retain complete conditional lifecycle, timing, module checkpoints, device, stderr-log identity, and raw-file identity under ignored local storage.
- [x] Derive the family result solely from validated availability and both warmed-median speed ratios; never read CER/gaps/segmentation to decide the device.

Gate:

```text
both GPU medians <= 0.80 * paired CPU -> development-gpu-ready
valid GPU but either ratio misses            -> development-gpu-no-speedup
validated discovery/build/session-load/device envelope failure -> development-gpu-unavailable
otherwise                                             -> no result; T09 remains incomplete
```

Do not stop the Qwen family matrix because this family fails; results are independent.

## Step 7 — Run `qwen3-family` development matrix

- [x] Use Qwen3-ASR plus the exact required ForcedAligner.
- [x] Use the same short-v1/locked-120-second and `1 cold + 3 warm` process structure.
- [x] Measure one wall interval around session transcription plus raw ForcedAligner execution.
- [x] A performance-eligible row requires non-null session and aligner results, ordered copied source segments and raw entries, exact terminal policy identity, and zero accepted timing. Fake-ABI tests prove conditional cleanup counters; the separate real Rust-host worker smoke proves the structured `qwen_timeline_policy_not_implemented` exit with zero `segment`, `segmentsReplace`, or `completed` output.
- [x] Raw alignment validation permits any `0 <= start <= end`, including zero-duration entries, with no audio-end upper bound; preserve tail overruns unchanged, record each generation's and the family's maximum overrun, and never clip or accept raw entries as subtitle timing. Do not run T11 grouping, score alignment accuracy, expand entries, or accept session getter timing.
- [x] Apply the same exact repeat ordering, whole-row retry, runtime pairing, checkpoint, and privacy rules as Step 6.
- [x] Derive the family result independently from the Qwen rows using the same speed/failure rules.

Gate: same per-family result matrix as Step 6, with complete Qwen discovery/aligner-load failure eligible for `development-gpu-unavailable`. A missing model/aligner/input or incomplete policy-pending row remains no-result and blocks T09.

Acquisition command for Steps 5–7:

```powershell
python .trellis/tasks/08-07-native-asr-crispasr-backend/research/run_crispasr_development.py acquire `
  --runner $Runner --input-lock $Lock --library $CrispAsrDll `
  --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark `
  --reazon-model $ReazonModel --qwen-model $QwenModel --qwen-aligner $QwenAligner `
  --raw-root .trellis/tasks/08-07-native-asr-crispasr-backend/research/local/raw `
  --raw-index .trellis/tasks/08-07-native-asr-crispasr-backend/research/crispasr-development-raw-index.json
```

After successful prepare, the acquire mode always runs four discovery processes, then runs 0/4/8 formal processes according to family discovery eligibility. It owns the fixed 600/300/1800-second timeouts, fresh attempt IDs, canonical ignored-root checks, exact output names, exit-code handling, and acquisition-index generation. It does not calculate or adapt quality metrics. Review and freeze the generated sanitized raw index before running the publisher.

## Step 8 — Publish deterministic development evidence

- [x] Review/freeze the sanitized acquisition index before aggregation. It binds one entry per pre-runner/discovery/formal attempt file: row role, family, case/device where applicable, phase/stage, attempt identity, relative raw identifier, size, and SHA-256. Formal repeat indices/order/completeness are validated inside the bound file.
- [x] Implement one stdlib deterministic publisher/validator for pre-runner, completed, failed, discovery, derived, and negative T09 rows. It first verifies raw bytes against the frozen index and rejects missing, extra, duplicate, renamed, symlink/reparse, or hash-drifted inputs. Pre-runner unavailable requires exact stage/command/source/toolchain/exit/log/privacy identity and both family rows sharing one attempt.
- [x] Bind the raw-index hash, shared input/formal-runtime lock, family/representative route, binary/DLL/model/aligner/audio/device/checkpoint-module/PATH identity, repeat counts, timing values, lifecycle status, stderr scan result, and family-result derivation.
- [x] Publish separate family result sections in one sanitized JSON/Markdown handoff; never promote one family's result to the other.
- [x] Add mutation tests for identity role/family/case swaps, pre-runner stage/command/exit/log/shared-family pairing, params, checkpoint modules, roots, devices, discovery promotion, dropped/duplicated/reordered repeats, CPU raw copied into GPU, timing/median/result promotion, Qwen policy status, conditional cleanup counts, raw index/hash drift, and nested/escaped private text/path injection.
- [x] Mutate a raw timing and regenerate every publisher-computed hash; publication must still fail against the independently frozen acquisition index.
- [x] Run the real publisher twice and require byte-identical files.
- [x] Publish no transcript, segment/token/alignment text, model bytes, absolute path, credential, or private benchmark content. Scan actual ignored-local worker stderr for transcript sentinels, model/audio roots, credentials, and escaped Unicode private text; any hit invalidates the row.

Validation/gate:

```bash
python .trellis/tasks/08-07-native-asr-crispasr-backend/research/test_publish_crispasr_development.py
python .trellis/tasks/08-07-native-asr-crispasr-backend/research/publish_crispasr_development.py <locked args>
# repeat the same publication and compare bytes
```

Independent review gate: a fresh reviewer must attempt coordinated mutations and verify both result derivations from bound raw bytes.

## Step 9 — Complete downstream handoff and durable guidance

- [x] Write `research/crispasr-backend-handoff.md` with the stable module interface, exact ABI/lifecycle rules, route mappings, both family device results, limitations, T03C dispositions, and T10/T11 ownership.
- [x] Update the parent PRD/design/implement map to record family-scoped T09 development results without marking any engine/product route qualified.
- [x] Update `.trellis/spec/asr/quality-guidelines.md` only with durable executable contracts learned from implementation: ABI ownership, hard-cancel semantics, strict Qwen seam, external device evidence, family result derivation, tests, and wrong-vs-correct examples.
- [x] Mark every T09 acceptance criterion only from checked evidence.

## Step 10 — Final full-scope verification

Required:

```bash
# Native protocol/backend lanes
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release --output-on-failure

cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release --output-on-failure

cmake --preset windows-x64-ct2-cuda-development
cmake --build --preset windows-x64-ct2-cuda-development
ctest --preset windows-x64-ct2-cuda-development --output-on-failure

cmake -S native-asr -B .trellis/tasks/08-07-native-asr-crispasr-backend/research/local/build/windows-x64-crispasr -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON -DHIKARU_ASR_BUILD_CT2_WORKER=ON -DHIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=ON -DHIKARU_ASR_CRISPASR_RUNTIME_FILE=<locked-crispasr.dll> -DHIKARU_ASR_CRISPASR_RUNTIME_SIZE=<locked-size> -DHIKARU_ASR_CRISPASR_RUNTIME_SHA256=<locked-sha256>
cmake --build .trellis/tasks/08-07-native-asr-crispasr-backend/research/local/build/windows-x64-crispasr --config Release
ctest --test-dir .trellis/tasks/08-07-native-asr-crispasr-backend/research/local/build/windows-x64-crispasr -C Release --output-on-failure

# Host/product regressions
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --release --manifest-path src-tauri/Cargo.toml
pnpm test
pnpm build

# Benchmark/evidence/task checks
python scripts/asr-benchmark.py self-check
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
python .trellis/tasks/08-07-native-asr-crispasr-backend/research/test_publish_crispasr_development.py
python ./.trellis/scripts/task.py validate .trellis/tasks/08-07-native-asr-crispasr-backend
git diff --check
```

Also verify:

- tracked output plus actual ignored worker-stderr privacy scans;
- task-local ignored raw/build/model/runtime files under active and archive path forms;
- normal CT2 release worker CrispASR rejection and CMake cache gate-off assertions;
- no staged files, no product runtime binaries/models, and no Release/default/native-routing/UI/package changes;
- final independent `trellis-check` has no blocking findings.

T09 cannot complete until each family has exactly one valid result. A validated family discovery/configure/build/session-load/aligner-load/device failure may yield `development-gpu-unavailable`; missing model/audio/aligner/toolchain inputs, invalid evidence, or unreviewed timeouts yield no result and keep the task in progress. Do not substitute a label or partial row.

## Rollback points

1. After Step 2: remove only the default-off backend/fake tests.
2. After Step 3: disable CrispASR dispatch; protocol/CT2 remain unchanged.
3. After Step 4: remove test-only Rust inputs; production host is untouched.
4. After Steps 5–8: delete ignored build/raw outputs and tracked development publication; no product route was enabled.
5. At any evidence identity change: invalidate and rerun every affected family row; never merge old/new identities.
