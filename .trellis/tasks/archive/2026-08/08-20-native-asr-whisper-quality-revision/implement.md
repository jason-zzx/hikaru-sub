# Native Faster-Whisper GPU quality revision implementation plan

## Execution policy

- Do not start implementation until the user reviews `prd.md`, `design.md`, and this plan, then separately approves `task.py start`.
- Do not commit, push, archive, or change production/default routing without a separate explicit user instruction.
- All model-backed acquisition uses `native-gpu-authoritative-v1` on the pinned CUDA route. Do not run CPU model qualification rows.
- Keep archived T06/T07 artifacts immutable. New raw/build/model aliases and absolute paths stay under the T06R ignored local root.
- A diagnostic row is never a candidate row. A selected config requires a new lock, rebuild, and formal rerun.
- After a formal candidate is frozen, continue all six anchor cases after quality failures. Stop only for invalid evidence that requires repair.

## Expected file surface

Existing files:

```text
.gitignore
native-asr/CMakeLists.txt
native-asr/CMakePresets.json
native-asr/src/ctranslate2_whisper.hpp
native-asr/tests/ctranslate2_whisper_tests.cpp
```

New task-owned tracked files during execution:

```text
.trellis/tasks/08-20-native-asr-whisper-quality-revision/research/
  gpu-diagnostic-lock.md
  publish_whisper_gpu_diagnostic.py
  test_publish_whisper_gpu_diagnostic.py
  whisper-gpu-diagnostic.json
  whisper-gpu-diagnostic.md
  gpu-vad-diagnostic-lock.md
  whisper-gpu-vad-diagnostic.json
  whisper-gpu-vad-diagnostic.md
  upstream-parity-audit.md
  gpu-fallback-diagnostic-lock.md       # only after separate Phase 3C approval
  next-candidate-causal-audit.md
  gpu-short-parity-bisect-lock.md       # Phase 3D pre-model only
  generate_whisper_short_parity_inputs.py
  publish_whisper_short_parity_bisect.py
  test_publish_whisper_short_parity_bisect.py
  short-parity-bisect-pre-model-evidence.md
  gpu-candidate-lock.md
  publish_whisper_gpu_candidate.py
  test_publish_whisper_gpu_candidate.py
  evidence/whisper-gpu-candidate.json
  whisper-gpu-candidate-report.md
  whisper-gpu-handoff.md
  reproduction-commands.md
  local/                              # ignored
```

No Tauri/React/protocol production file is expected to change. If implementation discovers that one is required, return to planning before broadening scope.

## Phase 1 - Preflight and isolation

- [ ] Load `trellis-before-dev`, task artifacts, curated context, and the current ASR quality spec.
- [ ] Verify the worktree and record unrelated user changes without modifying them.
- [ ] Add an active/archive-safe `.gitignore` rule for `08-20-native-asr-whisper-quality-revision/research/local/` before creating local files.
- [ ] Verify the current `.asr-benchmark` manifest/case identities match the authoritative Python baseline rows; never print or track subtitle text.
- [ ] Verify pinned large-v3 and large-v2 CT2 model revisions, required files, sizes, hashes, and licenses from the archived handoffs.
- [ ] Verify the T07 CUDA toolkit/GPU/driver/module inputs are present and the restricted PATH can still build and execute.
- [ ] Create only the ignored T06R local directory structure needed for build, model aliases, raw, adapted, mutation, and determinism outputs.

Rollback point: remove only the empty/ignored T06R local root and the new ignore rule.

## Phase 2 - Build the closed GPU diagnostic harness

- [ ] Add configure/build/test preset `windows-x64-ct2-cuda-whisper-quality` with its binary directory below the T06R local root; keep protocol-only, CPU CT2, and archived T07 presets unchanged.
- [ ] Add the canonical T06R local root compile definition to the existing CT2 test runner.
- [ ] Add a T06R output-containment check that accepts only the canonical active/archive-safe task-local root.
- [ ] Add `--run-whisper-quality-diagnostic` with exactly six accepted cell IDs:
  - [ ] `short-b1-off`
  - [ ] `short-b5-off`
  - [ ] `medium-b1-off`
  - [ ] `medium-b1-on`
  - [ ] `medium-b5-off`
  - [ ] `medium-b5-on`
- [ ] Reject arbitrary beam/history values, CPU/Vulkan requests, VAD, unknown cases/models, wrong repeat counts, and output outside the T06R local root.
- [ ] Reuse existing `CandidateAConfig`, CUDA execution config, CT2 backend, segment/trace JSON, timing, GPU/module/PATH attestation, model/runtime identity, and atomic output helpers.
- [ ] Emit one clean-process raw row per cell with `qualificationEligible=false`; bind diagnostic lock, cell, config, case, model, audio, worker/runner/DLL, GPU/driver/modules/PATH, resources, segments, and token traces.
- [ ] Add focused C++ self-checks for the six-cell mapping, short history deduplication, timestamp/no-VAD invariants, GPU-only enforcement, and task-local path rejection.

Validation checkpoint:

```powershell
Push-Location native-asr
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release
cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release
cmake --preset windows-x64-ct2-cuda-whisper-quality
cmake --build --preset windows-x64-ct2-cuda-whisper-quality
ctest --preset windows-x64-ct2-cuda-whisper-quality
Pop-Location
```

Rollback point: remove only the T06R preset/root/mode; archived evidence and production defaults remain unchanged.

## Phase 3 - Freeze and run the diagnostic

- [ ] Write `gpu-diagnostic-lock.md` before model load. Bind the corpus/cases, large-v3 model, six cells, selection rule, code/tool/runtime identities, GPU/driver/modules/PATH, raw root, privacy policy, and command shape.
- [ ] Implement `publish_whisper_gpu_diagnostic.py` using standard library plus the existing T01 benchmark module.
- [ ] Validate every raw cell independently before metric recomputation; require exact role/cell/config/case/model/device/compute/module/PATH/repeat/status identity.
- [ ] Apply the frozen selection rule:
  - [ ] matching short beam row and exact medium beam/history row both pass all relative quality and absolute GPU/structural gates;
  - [ ] select lowest medium GPU inference RTF;
  - [ ] tie-break by lower beam, then history off;
  - [ ] emit `no-candidate-selected` when no pair passes.
- [ ] Add publisher unit, mutation, privacy, promotion-rejection, and byte-determinism tests before real publication.
- [ ] Build the diagnostic worker/runner and record their exact hashes in the lock.
- [ ] Run each of the six cells once in a clean process under the restricted CUDA PATH.
- [ ] Publish twice and require byte-identical JSON/Markdown.
- [ ] Independently review the selected config and every failed/pass field against `python-legacy-cuda-v1`.

Representative command shape, with exact paths/hashes copied into `reproduction-commands.md` during execution:

```powershell
$runner = Resolve-Path <t06r-cuda-build>/bin/hikaru-asr-ctranslate2-tests.exe
$worker = Resolve-Path <t06r-cuda-build>/bin/hikaru-asr-worker.exe
& $runner --run-whisper-quality-diagnostic `
  --cell medium-b5-on `
  --model <large-v3-model> `
  --audio .asr-benchmark/medium.wav `
  --output <t06r-local>/diagnostic/medium-b5-on.json `
  --diagnostic-lock <task>/research/gpu-diagnostic-lock.md `
  --production-worker $worker `
  --model-id Systran/faster-whisper-large-v3 `
  --model-revision edaa852ec7e145841d8ffdb056a99866b5f0a478 `
  --model-bin-sha256 69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1
```

**Gate A:**

- `no-candidate-selected` -> stop implementation, keep todo/task in progress, update PRD/design with the observed full diagnostic distribution, and ask the user to review a new candidate scope.
- selected config -> continue to Phase 4. Do not reinterpret or edit diagnostic rows.

Observed result: `no-candidate-selected`; the user approved the following Phase 3B scope.

## Phase 3B - Run the approved exact-VAD diagnostic

- [ ] Extend the existing task-local CUDA runner with a distinct `--run-whisper-quality-vad-diagnostic` mode accepting exactly `short-b5-vad` and `medium-b5-on-vad`.
- [ ] Reuse the existing Candidate B direct ORT 1.28.0 / exact faster-whisper 1.2.1 Silero V6 implementation and frozen VAD defaults; reject missing/wrong VAD identity, arbitrary VAD config, no-VAD rows, other beam/history values, CPU/Vulkan, wrong cases/repeats, and non-local outputs.
- [ ] Emit a raw kind/schema distinct from the first diagnostic and formal evidence, with `qualificationEligible=false`, exact VAD/ORT identity, compressed/restored provenance, GPU/module/PATH identity, segments, traces and resources.
- [ ] Extend the existing stdlib publisher/tests rather than creating a second implementation. Validate both rows independently, recompute T01 metrics, reject first-diagnostic/formal promotion, and select only when both rows pass every matching Python relative field plus GPU/structural gates.
- [ ] Add focused C++ mapping/identity tests and Python mutation/privacy/byte-determinism tests for the two-cell matrix.
- [ ] Build and hash the updated runner/worker, then freeze `gpu-vad-diagnostic-lock.md` before any second-diagnostic model load.
- [ ] Run each of the two rows once in a clean process under the restricted CUDA PATH and publish `whisper-gpu-vad-diagnostic.{json,md}` twice byte-identically.
- [ ] If either row fails, publish second `no-candidate-selected`, update planning, and stop. If both pass, continue to Phase 4 with a new formal lock/rebuild; never promote either diagnostic row.

Observed result: both rows completed under lock `ee8a7e6bfd062f84359eaa3d86eb54ed843bb4d036613043ed2bc2f8f282b8c3`; deterministic publication `890453f440418d4c418e7916fcbe52b8ea9db2c85f48ef79b7d1b30bc372ecbc` selected no candidate. Stop before Phase 4 and return to planning.

## Phase 3C - Approved upstream fallback parity candidate

Status: source/oracle implementation passed pre-model review; the first authorized acquisition stopped before model load under invalid lock `5fcfe845...`. Gate C3 later blocked v2 `823630f0...` because the publisher did not enforce an exact module set, then repaired and reviewed v3 `b95bdcc1...`. Fresh v3 acquisition completed both rows and deterministically published `no-candidate-selected`; Phase 4 remains blocked.

- [ ] Add the minimum task-local candidate seam for `upstream-generation-fallback-parity-v1` without changing ordinary production defaults. Its base identity is beam 5/history on/exact V6 VAD/timestamp-driven seek; the only causal change is exact faster-whisper 1.2.1 generation fallback.
- [ ] Implement the fixed `0.0,0.2,0.4,0.6,0.8,1.0` attempt ladder, exact compression-ratio `>2.4` and average-log-probability `<-1.0` retry predicates, silence override, first-pass/all-failed selection, and selected-temperature prompt reset.
- [ ] Keep temperature-0 beam 5/patience behavior and positive-temperature beam 1/best-of 5/top-k 0 behavior exact; forbid CLI/config values outside this closed identity.
- [ ] Add fake-generation oracle vectors against the installed faster-whisper 1.2.1 implementation for no retry, compression retry, log-probability retry, silence override, first passing result, all-failed selection, maximum six attempts, and prompt reset.
- [ ] Record only sanitized attempt count, selected temperature, trigger categories and aggregate hashes; keep generated text/tokens/traces ignored-local.
- [ ] Prepare `gpu-fallback-diagnostic-lock.md` for exactly `short-b5-on-vad-fallback` and `medium-b5-on-vad-fallback`, with a distinct raw/publication kind and explicit diagnostic-only/promotion rejection.
- [ ] Run focused CPU/protocol/CUDA CTest, publisher mutation/privacy/determinism tests, and an independent pre-model review.
- [ ] Stop after review. Do not load large-v3 or run either row until the user separately authorizes acquisition.

**Gate C2:** oracle mismatch, non-closed configuration, identity/privacy weakness, or review blocker closes/repairs Phase 3C before model load. A clean review only permits asking for acquisition approval; it does not itself authorize inference.

Observed authorized-acquisition preflight:

- [x] Re-attested lock SHA-256 `5fcfe845451f418a1e21fe8711ba9f367fdc2e13f8c2e02dd598683dde4e073a`, source/publisher, task-local runtime, large-v3 model, short/medium corpus, exact V6 VAD, restricted PATH root, RTX 3070/driver and CUDA toolkit identities; all current values matched.
- [x] Re-attested reviewed `vcomp140.dll`, `nvcuda.dll`, `cublas64_12.dll` and `cublasLt64_12.dll` hashes, then proved none occurs directly in the current fallback lock text.
- [x] Confirmed the frozen publisher rejects such rows with `loaded module is not frozen`; classified the acquisition as invalid evidence and stopped before model load.
- [x] Ran neither fallback cell, generated no row metrics/publication, changed no route/default, and left the frozen lock unchanged.
- [x] Preserved `gpu-fallback-diagnostic-lock.md` byte-for-byte at SHA-256 `5fcfe845...` and bound its invalid-preflight JSON/Markdown hashes in a distinct corrected identity.
- [x] Froze `gpu-fallback-diagnostic-lock-v2.md` at SHA-256 `823630f08ab15ed7dadf4f80f0e5a320c89e3e2171cd55b8ac86cc6463235b82`, directly listing the complete expected loaded-module inventory.
- [x] Gate C3 review found v2 blocked because the publisher still accepted a required subset rather than the exact module set; no acquisition ran under v2.
- [x] Added fallback-only exact module validation for name/size/SHA-256/root-role/raw-version and mutation coverage for missing, additional, identity and version drift.
- [x] Froze reviewed `gpu-fallback-diagnostic-lock-v3.md` at SHA-256 `b95bdcc1e2a33ab30c2064fef70d466cd92842fedaaaed07350a1c111bcdcf29`; preserved the original/v2 locks and invalid/v2 preflight artifacts byte-identically.
- [x] Re-attested 51 current source/tool/runtime/model/corpus/VAD/zlib/authority files plus current module roots/GPU/toolchain; no drift required rebuild.
- [x] Focused publisher selection/mutation/privacy/determinism tests pass 15/15; Gate C3 disposition is `clean-to-request-renewed-acquisition`.
- [x] Received fresh explicit authorization for both model-backed cells under the exact v3 lock.
- [x] Re-attested 55 frozen files, exact eight-module inventory, restricted PATH, RTX 3070/driver, CUDA 12.8.93, MSVC and CMake before model load; no drift.
- [x] Acquired `short-b5-on-vad-fallback` in a clean process: 1 generation / 0 fallback calls, CER/S/D/I `0.333333/19/15/6`, gap 0, GPU RTF `0.116202`, RSS `3232940032`; insertion non-regression failed.
- [x] The first medium process was externally terminated without atomic output and retained only as invalid process history; reran only the affected row in a clean process.
- [x] Acquired `medium-b5-on-vad-fallback`: 17 windows, 29 generation / 12 fallback calls, CER/S/D/I `0.138901/84/167/65`, 2 gaps / `3930ms`, GPU RTF `0.195917`, RSS `3232133120`; quality non-regression failed.
- [x] Published `whisper-gpu-fallback-diagnostic.{json,md}` twice byte-identically. JSON SHA-256 `66dfb00ee41599f78dc3cdf2c757d0946a922988e62bcc016b5d7c674c345f7c`; Markdown SHA-256 `8766aeedd545ec5b4cb2f79144320f730c6d0692ba1d51429ba78740883a443c`; selection `no-candidate-selected`.
- [x] Returned to planning; source/evidence audit isolated Mel bytes and CT2 runtime identity as the two remaining verified short-path differences.
- [x] Received explicit approval for Phase 3D `short-input-runtime-parity-bisect-v1` pre-model planning and implementation only.

## Phase 3D - Approved short input/runtime parity bisect pre-model implementation

Status: fresh v5 authorization completed exact re-attestation and Silero V6 preflight, then stopped in the first cell after successful large-v3 model construction but before encode/generate. The frozen `80×3000` probe shape is incompatible with the model's actual `128` Mel bins, so v5 is immutable `invalid-evidence`; no atomic row, parser artifact or attribution publication exists, and the other three cells remain unrun. Return to planning before any new identity.

### D0 - Freeze the closed probe contract

- [x] Extend PRD/design/implement with the exact four cells, same-harness rule, telemetry, decision matrix, privacy boundary and stop gates.
- [x] Freeze the short waveform, Python/native Mel, prompt, suppression, options, model, archived Python anchor and reviewed native v3 anchor identities without copying private text into tracked files.
- [x] Require later Python V6 VAD preflight to reproduce one full `[0,385637)` interval and the frozen post-VAD waveform hash before ASR model load.
- [x] Define distinct `hikaru-whisper-short-parity-*` raw/publication schemas with `qualificationEligible=false`; every existing diagnostic/final publisher rejects them.

### D1 - Add no-model input and same-runner runtime seams

- [x] Add a default-off `HIKARU_ASR_ENABLE_WHISPER_PARITY_BISECT` build gate and task-local preset/root; ordinary protocol, CPU CT2, CUDA quality and production worker behavior remain unchanged.
- [x] Add a closed native Mel-export mode for short-v1 only. It writes exact `80 × 3000` float32 bytes below the ignored root and rejects other cases/shapes/paths.
- [x] Add a parity-runner-only precomputed-Mel entry that validates the frozen dtype/shape/hash and reuses the exact prompt/options/fallback/token-trace/parser implementation. Do not expose it through protocol v1 or production defaults.
- [x] Use one identical runner executable in two isolated runtime bins. The native bin contains the frozen native CT2 layout; the Python-wheel bin contains the frozen wheel CT2/cuDNN/OpenMP layout. PATH/root policy must prevent cross-root DLL resolution.
- [x] Planning feasibility smoke: unchanged current tests executable passed `--fallback-self-check` and `--self-check` under an isolated Python-wheel CT2/cuDNN/OpenMP root without a model (`phase3d-planning-feasibility.md`).
- [x] Repeat no-model same-executable ABI/load/version smoke for both final rebuilt roots. Python-wheel ABI/load failure stops Phase 3D and returns to design; do not substitute a Python binding harness.
- [x] Generate the Python Mel through the pinned faster-whisper 1.2.1 feature extractor and independently compare shape/hash/stats against the native export.

### D2 - Add parser oracle, fake rows and publisher

- [x] Add a task-local Python parser oracle pinned to faster-whisper 1.2.1 that accepts ignored token IDs and returns only sanitized count/text/timeline hashes.
- [x] Add fake-generation seams for all four cell IDs. Tests cover first-attempt telemetry, fallback attempts/selection, canonical `generationFingerprint`, Python/native parser aggregates and same-cell repeat identity without constructing a model.
- [x] Implement `publish_whisper_short_parity_bisect.py` with exact cell-role/Mel/runtime/root/module/prompt/options/model validation and the frozen A/B/C/D decision rule. Factor equality uses `generationFingerprint`; A reproduces the Python anchor through the Python parser and D reproduces the native anchor through the native parser.
- [x] Mutation-test unknown/missing/duplicate cells, swapped Mel/runtime labels, waveform/VAD/Mel/model/prompt/suppress/options drift, correlated runtime-root rewrites, missing/additional/version/hash module drift, first-attempt/fallback/token/parser aggregate drift, nondeterminism, baseline/native anchor misuse and external termination.
- [x] Assert privacy, ignored containment, byte-identical JSON/Markdown, diagnostic-promotion rejection and absence of CER/reference/CPU-inheritance/formal-candidate fields.

### D3 - Freeze identity and independent pre-model review

- [x] Build and test the parity runner without loading large-v3; hash source, runner, tokenizer, both CT2 runtime roots, Mel artifacts, parser/oracle, publisher/tests, corpus/model metadata, GPU/toolchain and exact expected module sets into `gpu-short-parity-bisect-lock.md`.
- [x] Write sanitized `short-parity-bisect-pre-model-evidence.md` and reproduction commands. Raw Mel bytes, tokens, text, parser segments and module paths stay ignored-local.
- [x] Run focused protocol/CPU/CUDA/parity CTest, Python Mel/parser oracle tests, publisher mutation/privacy/determinism tests, task validation, privacy/ignore checks, `git diff --check` and no-staged check.
- [x] Receive independent `trellis-check` review. Fix only pre-model evidence/harness blockers under a refreshed lock identity; never load the ASR model during review.
- [x] Stop and request explicit authorization for the four model-backed cells. A clean review alone does not authorize acquisition.

**Gate D:**

- ABI/runtime smoke failure, non-closed configuration, inability to isolate runtime roots, Mel/oracle mismatch, module-set ambiguity, privacy/promotion weakness or review blocker -> stop/repair before model load.
- clean pre-model review -> request acquisition approval for exactly the four frozen cells; do not run discovery/formal/quality rows automatically.

### D4 - Repair VAD acquisition identity

- [x] Record that authorization under lock `470f9e0f...` stopped before VAD/ASR model load because the lock/publisher did not directly bind the Python Silero V6 preflight identity/artifact.
- [x] Preserve `gpu-short-parity-bisect-lock.md` byte-identically and create `gpu-short-parity-bisect-lock-v2.md` only after the new tool/publisher identities are final.
- [x] Add a closed task-local VAD preflight tool that freezes `audio.py`, `vad.py`, Silero V6, Python ONNX Runtime files and emits only identity, sample-count, interval and waveform hashes.
- [x] Require the parity publisher to validate the ignored-local VAD artifact against the v2 lock before consuming any four-cell row.
- [x] Add mutation/privacy/determinism tests for VAD asset/source/runtime/interval/waveform/artifact drift without loading VAD or ASR models.
- [x] Run final no-model checks and independent review under v2, then stop for renewed acquisition authorization.

### D5 - Authorized v2 acquisition attempt

- [x] Re-attest immutable locks plus frozen tool/VAD/model/Mel disk identities before VAD execution.
- [x] Run exact Silero V6 preflight; fail closed at post-VAD loaded-module attestation because sibling `onnxruntime.dll` was not loaded.
- [x] Preserve no atomic VAD artifact, no ASR model load, zero cell/parser rows and no parity publication.
- [x] Write one ignored sanitized invalid-preflight record and one tracked minimal report; stop before any cell.
- [x] Return to planning for a newly reviewed actual Python ORT loaded-module contract. Do not modify v2 in place.

### D6 - Freeze actual Python ORT execution identity

- [x] Preserve v1/v2 locks and v2 invalid JSON/report byte-identically.
- [x] Run import-only CPython 3.11.15 / ORT 1.26.0 smoke without `InferenceSession` or any VAD/ASR model.
- [x] Freeze exact loaded capi-root modules `onnxruntime_providers_shared.dll` and `onnxruntime_pybind11_state.pyd`, plus exact not-loaded sibling `onnxruntime.dll`, in distinct v3 lock `62ef486a...`.
- [x] Update VAD tool and parity publisher for closed loaded/not-loaded inventories and reject missing/additional/root/hash/status/old-lock drift.
- [x] Add mutation/privacy/determinism tests and sanitized v3 pre-model evidence/reproduction boundary.
- [x] Repair Gate D3 producer cross-root escape: enumerate all process modules first, then select every `onnxruntime*` basename and reject any non-frozen root before exact-set comparison; add producer regression test.
- [x] Repair Gate D3 incomplete-inventory escape: any failed module-path lookup now rejects the preflight instead of silently skipping the handle; add producer regression test.
- [x] Receive renewed independent no-model review: Gate D3 is clean. Stop and request fresh exact-v3 authorization; review is not authorization.

### D7 - Authorized v3 acquisition attempt

- [x] Receive fresh explicit authorization under exact lock `62ef486a...`.
- [x] Re-attest v1/v2/v3 locks plus frozen source/tool/model/Mel/runtime/module disk identities; ignored JSON SHA-256 `ad48d75a8a85d4cdf6090cde10b4280653362d91b9876d4b754fb6e9478b38e8`.
- [x] Run exact Silero V6 preflight and reproduce one `[0,385637)` interval, the frozen waveform hash, exact loaded `.pyd + providers_shared.dll`, and exact not-loaded `onnxruntime.dll`; ignored atomic artifact SHA-256 `f7201eef4c0e912eb181291038f66942d218ef7fb5e14ff86a0783f62a447246`.
- [x] Start only the first frozen cell, `python-runtime-python-mel`, and fail closed before CT2 Whisper model construction because the reviewed runner passes no VAD model path to the fallback-enabled backend.
- [x] Record ignored invalid evidence SHA-256 `808dd23c1f69e395bd759aad183e04e6b32e8c354a54f151b64c001e22882132`; preserve no atomic row/model metrics and run no remaining cell/parser/publisher command.
- [x] Preserve all locks and prior evidence byte-identically. Return to planning for a new rebuilt/reviewed identity; do not repair or retry v3 in place.

### D8 - Repair parity-runner VAD wiring under v4

- [x] Preserve v1/v2/v3 locks, invalid evidence, completed v3 VAD artifact and prior publications byte-identically.
- [x] Require closed `--vad-model` input in both parity preflight and acquisition modes; canonically restrict it to the active isolated runtime bin and validate exact Silero V6 name/size/SHA-256 before backend construction.
- [x] Pass the validated VAD path to the unchanged fallback-enabled backend; do not weaken the production fallback invariant or expose the seam through protocol/product routes.
- [x] Bind VAD asset identity in future raw/publisher validation and add missing/cross-root/wrong-identity/old-lock mutation coverage.
- [x] Rebuild the identical runner/worker in both isolated runtime roots and run only no-model smoke/preflight checks.
- [x] Freeze `gpu-short-parity-bisect-lock-v4.md` at SHA-256 `e38e23f5fc28405ffb2554324b2967c077d6eeda46b010ec51aac5bece378ff8`; four preflights report `vadModelLoaded=false`, `asrModelLoaded=false`, `modelLoaded=false`.
- [x] Pass protocol `6/6`, CPU CT2 `8/8`, CUDA fallback `9/9`, CUDA parity `10/10`, parity publisher `15/15`, parser/input/ORT `10/10`, fallback oracle `16` vectors, existing GPU publisher `15/15`, lock regeneration, privacy/ignore/task/diff/no-staged and 30-file predecessor immutability checks.
- [x] Receive independent Gate D4 review: `clean-to-request-fresh-v4-acquisition` with no review-time source edits.
- [x] Received fresh explicit authorization under exact v4 lock for the new VAD preflight and four closed model-backed parity cells.

### D9 - Authorized v4 acquisition attempt

- [x] Re-attest exact v4 lock/source/tools, both isolated runtime roots, Mel/model/corpus/VAD identities, restricted PATH, GPU/CUDA identity and predecessor immutability; ignored JSON SHA-256 `385353870ebba5d20c894daf595e80f735ff95d0e629992a7dc52c2fde46b5ef`.
- [x] Freshly rerun all four closed no-model preflights and reproduce the reviewed v4 byte hashes with `vadModelLoaded=false`, `asrModelLoaded=false`, and `modelLoaded=false`.
- [x] Run the exact-v4 Python Silero V6 preflight command and fail closed before faster-whisper/ORT import because the frozen tool accepts only the v3 lock path.
- [x] Preserve no atomic v4 VAD artifact, no ASR model load, zero parity rows/parser artifacts/publications, and one ignored sanitized invalid record SHA-256 `47299ae4a7d52b818dae72afa4e69f429e8ddd4e8a8a561ff5a96d0d894013c0`.
- [x] Stop without source/tool/runtime/lock/config repair, quality candidate, formal matrix, route/default, CPU inheritance, packaging or commit changes. V4 authorization is consumed.

### D10 - Repair exact lock selection under v5

- [x] Preserve v1-v4 locks, invalid artifacts, completed v3 VAD artifact, runtime/model/Mel inputs and the prior immutable evidence set byte-identically.
- [x] Change only the task-local Python VAD preflight and publisher lock selector to canonical exact v5; reject v1-v4, unknown, cross-root same-name, malformed child and wrong-audio inputs before faster-whisper/ORT import.
- [x] Add focused v5 lock-selection and publisher mutation coverage without constructing `InferenceSession` or loading VAD/ASR models.
- [x] Keep native C++, CMake, parity runner/worker, both isolated CT2 runtime roots, `--vad-model` contract, production fallback invariant, protocol and product/default routes unchanged from v4.
- [x] Freeze `gpu-short-parity-bisect-lock-v5.md` at SHA-256 `6a2ee4ee58cde783be473e907a4fe56aa72c7afcdba7b567644d2dfce74ac8fb` and bind v4 lock/invalid evidence plus exact tool/test/runtime/model/Mel/VAD/Python/ORT identities.
- [x] Reproduce native/Python-wheel runtime smoke and all four closed preflight hashes with `vadModelLoaded=false`, `asrModelLoaded=false`, `modelLoaded=false`.
- [x] Pass lock-selection `5/5`, parity publisher `15/15`, parser/input/ORT `10/10`, fallback oracle `16`, existing GPU publisher `15/15`, protocol `6/6`, CPU CT2 existing CTest `8/8`, CUDA fallback `9/9`, CUDA parity `10/10`, lock regeneration, privacy/ignore/task/diff/no-staged and predecessor immutability checks.
- [x] Record the fresh CPU CT2 rebuild timeout while unchanged dependencies were rebuilding; no compile/test failure occurred and the unchanged CPU binary passed `8/8`.
- [x] Receive independent Gate D5 review: `clean-to-request-fresh-v5-acquisition` with no review-time tracked edits.
- [x] Receive fresh explicit authorization under exact v5 lock for the new Silero V6 preflight and four closed model-backed parity cells.

### D11 - Authorized v5 acquisition attempt

- [x] Re-attest exact v5 lock/source/tools, both isolated runtime roots, model/Mel/corpus/VAD/Python/ORT, restricted PATH, GPU/CUDA and predecessor identities; ignored JSON SHA-256 `d9414b5ce92f772b011c5509b40b513b07f897d360b4a82e4f60adaf81eb00bb`.
- [x] Freshly rerun both runtime smokes and all four no-model preflights and reproduce their reviewed hashes with all model-loaded flags false.
- [x] Execute exact Silero V6 preflight and reproduce `[0,385637)`, frozen pre/post waveform and exact ORT loaded/not-loaded set; ignored artifact SHA-256 `90e58fed46551047a55d89a537a8d91a692a844d73b6041c5d87ca4393b12002`.
- [x] Start only `python-runtime-python-mel`; construct the frozen large-v3 CTranslate2 model, then fail closed before encode/generate because the frozen `80×3000` Mel probe does not match the model's actual `128` Mel bins.
- [x] Preserve no atomic row, parser artifact or parity publication; do not run the remaining three cells. Ignored invalid record SHA-256 `3c8ebeddabe4b3e68b8c426a256293fd4cc0cc9d00d18d84e6cbaf1fff185d2c`; tracked report SHA-256 `725e6da1e3a0d7929d167d9455dcec3489847dadd9311217fed23b9897858676`.
- [x] Stop without source/runtime/lock/config/shape repair, v6 creation, quality candidate, formal matrix, route/default, CPU inheritance, packaging or commit changes. V5 authorization is consumed.

Rollback point: remove only Phase 3D gated code, preset and task-local tracked/ignored artifacts. Preserve all prior locks, invalid evidence, raw rows and publications byte-for-byte.

## Phase 4 - Freeze the formal GPU candidate

- [ ] Enter Phase 4 only after Phase 3D localizes one divergence stage and a separately planned, reviewed and acquired short/medium quality diagnostic selects a new candidate. Apply only that frozen candidate identity; do not carry failed v3 fallback behavior forward by default or reinterpret any parity-probe row as quality evidence.
- [ ] Update existing focused default/config tests; do not add a runtime setting or arbitrary config surface.
- [ ] Add `--run-whisper-quality-evidence` that uses only the selected production defaults and CUDA device 0/FLOAT16.
- [ ] Allow only large-v3/large-v2 and short-v1/medium-v1/long-v2 with short repeats `4`, medium/long repeats `1`.
- [ ] Emit formal raw schema distinct from diagnostics and require `qualificationEligible=true`.
- [ ] Rebuild from the T06R CUDA preset after the selected default change.
- [ ] Write `gpu-candidate-lock.md` before formal model load, binding:
  - [ ] selected diagnostic output/hash and selection reason;
  - [ ] current source/config/worker/runner/DLL/toolchain identities;
  - [ ] CUDA toolkit, RTX 3070, driver, modules and restricted PATH;
  - [ ] current corpus manifest and all three case identities;
  - [ ] both exact model revisions and required file hashes;
  - [ ] sample roles/repeats, timeout/failure policy, output root and privacy policy.
- [ ] Implement and pass lock/config/identity mutation tests before acquisition.

**Gate B:** Final worker, runner, DLL, config, model, corpus, GPU/module/PATH, and lock identities are immutable. Any subsequent change invalidates affected formal rows.

Rollback point: restore pre-T06R ordinary defaults and delete only the unaccepted T06R final build/raw outputs.

## Phase 5 - Acquire the complete formal matrix

- [ ] Run large-v3 short-v1 as `1 cold + 3 warm`.
- [ ] Run large-v3 medium-v1 once.
- [ ] Run large-v3 long-v2 once under a controlled process timeout with atomic output.
- [ ] Run large-v2 short-v1 as `1 cold + 3 warm`.
- [ ] Run large-v2 medium-v1 once.
- [ ] Run large-v2 long-v2 once under a controlled process timeout with atomic output.
- [ ] Continue later cases after every identity-valid quality, performance, resource, or candidate-caused structured failure.
- [ ] Repair and rerun only rows with identity drift, harness corruption, incomplete trace, external termination, or missing atomic output.
- [ ] Preserve every raw/formal/adapted hash under the candidate lock; track no raw text/path data.

Representative formal command shape:

```powershell
& $runner --run-whisper-quality-evidence `
  --model-key large-v3 `
  --case-id short-v1 `
  --model <large-v3-model> `
  --audio .asr-benchmark/short.wav `
  --output <t06r-local>/formal/large-v3-short-v1.json `
  --candidate-lock <task>/research/gpu-candidate-lock.md `
  --production-worker $worker `
  --repeats 4
```

Do not run any CPU model-backed command.

## Phase 6 - Publish disposition and inheritance metadata

- [ ] Implement `publish_whisper_gpu_candidate.py` and its unittest module before final publication.
- [ ] Validate the complete six-row role matrix and reject diagnostic schemas, cross-model rows, missing rows, wrong repeats, GPU/runtime/config/model/corpus drift, incomplete failures, and mutable adapted metrics.
- [ ] Recompute every metric through the T01 implementation and compare only against the exact logical-model/case `python-legacy-cuda-v1` row.
- [ ] Require GPU RTF `<=0.5`, short cold wall `<=120s`, CT2 RSS `<=6 GiB`, and every structural/identity/path/protocol/cancel/recovery/privacy/license gate.
- [ ] Publish one truthful GPU disposition:
  - [ ] `accepted-whisper-algorithm-input` only if both anchors and all six rows pass;
  - [ ] `stop-revise` for any valid failed quality/engineering row;
  - [ ] no disposition while any evidence row is invalid/incomplete.
- [ ] Emit CPU `qualificationSource=inherited-from-gpu` metadata only for an accepted GPU disposition and exact matching model/algorithm hashes.
- [ ] Assert CPU CER/S/D/I/RTF/wall/RSS fields are absent; reject copied GPU values or CPU model rows.
- [ ] Generate sanitized JSON, report, and handoff twice and require byte-identical outputs.
- [ ] Record that T14/T15 must rebuild and rerun under the final GPU pack identity.

Rollback point: remove generated T06R publication and inheritance metadata; keep raw evidence ignored and production/default Python legacy unchanged.

## Phase 7 - Host and compatibility checks

- [ ] Exercise the selected CUDA worker through the existing Rust real-worker test seam with T06R worker/model/audio/device inputs.
- [ ] Verify success, route equality, legal segments, recovery output, reap, and active-gate release.
- [ ] Verify structured pre-ready CUDA failure remains safe.
- [ ] Verify cancellation after ready-derived progress exits/reaps/releases within two seconds with no completed output.
- [ ] Verify protocol-only and CPU compile/CTest remain independent of CUDA environment; do not run CPU model evidence.
- [ ] Confirm Kotoba configs, Candidate B history, CrispASR routes, protocol v1, and frontend/Tauri types are unchanged.

## Phase 8 - Final quality gate

Run focused checks first, then the complete task gate:

```powershell
python .trellis/tasks/08-20-native-asr-whisper-quality-revision/research/test_publish_whisper_gpu_diagnostic.py
python .trellis/tasks/08-20-native-asr-whisper-quality-revision/research/test_publish_whisper_gpu_candidate.py
python scripts/asr-benchmark.py self-check
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"

Push-Location native-asr
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release
cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release
cmake --preset windows-x64-ct2-cuda-whisper-quality
cmake --build --preset windows-x64-ct2-cuda-whisper-quality
ctest --preset windows-x64-ct2-cuda-whisper-quality
Pop-Location

cargo test --manifest-path src-tauri/Cargo.toml asr_worker -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test
pnpm build

python ./.trellis/scripts/task.py validate .trellis/tasks/08-20-native-asr-whisper-quality-revision
git diff --check
git status --short
```

Additional manual/evidence checks:

- [ ] Both publishers reject the planned mutation matrix and produce byte-identical output twice.
- [ ] All six formal rows have exact identity-valid completed/structured-failure status.
- [ ] No raw transcript, ASS text, token IDs, absolute path, private media, binary, model, or module path is tracked.
- [ ] Active and future archived T06R local roots are ignored.
- [ ] No CPU model-backed row or CPU measurement field exists in new qualification evidence.
- [ ] No staged files exist.
- [ ] Independent `trellis-check` review finds no unresolved blocker.

## Completion and rollback

- [x] Closed as `stop-revise / non-qualified` with `research/whisper-quality-non-qualified-handoff.md`; parent state records no accepted ordinary Faster-Whisper input.
- [x] Kept ordinary native Faster-Whisper disabled and production/default on Python legacy; no CPU inheritance metadata was emitted.
- [x] Preserved valid diagnostic publications and v1-v5 invalid-evidence provenance without promotion or in-place repair.
- [x] Moved further investigation to planning-only task `08-25-native-asr-whisper-execution-parity-discovery`, bounded to exact model-derived features, A/D-first reproduction and one harness correction.
- Dormant Phase 4-8 candidate/qualification steps were not executed because no candidate exists.
- Full rollback restores pre-T06R ordinary defaults and removes only T06R code/research outputs. Archived T06/T07 evidence, Python legacy/default, user models, and benchmark corpus are never modified.
