# T08 Kotoba Productization Implementation Plan

## Dependencies

- Parent T08 requirements in `.trellis/tasks/07-25-native-asr-migration/`.
- Archived T01 benchmark contract and shared comparator.
- Archived T02 Kotoba model/input lock and six-case report.
- Archived T06 production worker/backend/host handoff.
- Archived T07 `development-gpu-ready` CUDA lane and module identity.
- Local private T01 corpus and pinned Kotoba snapshot are available only under ignored roots.

Steps 1-8 were completed and committed in `4688624`; they remain below as immutable execution history. K2 implementation begins at Step 9 and must not rerun K1 inference or rewrite K1/correction evidence.

## Execution Checklist

### 1. Freeze K1 Inputs And Local Boundary

- [ ] Add an active/archive-safe `.gitignore` rule for `08-05-native-asr-kotoba-compatibility/research/local/`.
- [ ] Write a K1 lock containing the T01 manifest/case hashes, Kotoba model revision/file hashes/license, model-card/preprocessor sources, worker/backend/runtime identities, T07 CUDA identity, and exact config.
- [ ] Verify the legacy Hugging Face snapshot exists at the pinned commit path and do not copy it.
- [ ] Record reproduction commands without absolute user paths or private text.

Rollback: remove only T08 local aliases/outputs and the new ignore rule.

### 2. Add Kotoba Profile And Readiness

- [ ] Add one source-window cap to the existing CTranslate2 config, defaulting to 3000 frames.
- [ ] Add `kotoba_config()` with 1500 source frames, beam 5, no history, and timestamp-driven seek.
- [ ] Use the configured source-window cap in the existing transcription loop while keeping a 3000-frame model tensor.
- [ ] Add route-aware model validation for Kotoba's non-empty `preprocessor_config.json` and 128-mel model contract.
- [ ] Keep ordinary faster-whisper defaults and preprocessor-optional behavior unchanged.
- [ ] Add focused CTest vectors locking ordinary and Kotoba profiles, source/model-window distinction, final partial windows, and readiness failures.

Rollback: revert the profile/window/readiness changes; ordinary CT2 remains intact.

### 3. Dispatch Kotoba Through The Existing Worker

- [ ] Extend `main.cpp` to accept `kotoba-faster-whisper -> ctranslate2` and select K1.
- [ ] Keep ordinary faster-whisper Candidate A/B behavior unchanged.
- [ ] Reject Kotoba `useVad=true` before `ready` until a separately reviewed Kotoba VAD candidate exists; do not load ordinary Candidate B implicitly.
- [ ] Preserve CPU/CUDA execution mapping, ready route equality, JSONL stdout, bounded stderr, progress, segment legality, cancellation, and terminal semantics.
- [ ] Add worker-level CPU/CUDA success and pre-ready negative tests.

Rollback: remove only Kotoba dispatch; protocol and ordinary routes remain unchanged.

### 4. Prove Legacy Cache And Rust Host Compatibility

- [ ] Extend the model-backed Rust test input with optional `HIKARU_ASR_CT2_ENGINE`, default ordinary and exact-validating Kotoba.
- [ ] Launch Kotoba using the exact legacy snapshot directory; copy only audio into the temporary managed workspace.
- [ ] Cover success/recovery/minimal ASS/active-slot release through the existing host.
- [ ] Cover missing-preprocessor and malformed snapshot structured failure before ready.
- [ ] Cover CUDA cancellation/reap with no completed snapshot.
- [ ] Verify Release/product code cannot read the new test-only engine selector.

Rollback: remove the optional test input and Kotoba test cases; product routing was never changed.

### 5. Add Focused Kotoba Evidence Tooling

- [ ] Add `--run-kotoba-evidence` to the existing CTranslate2 runner without changing historical evidence modes.
- [ ] Record K1 source/model windows, traces, segments, timings, RSS, model/runtime/device/modules, and exact lock identity under T08 `research/local/`.
- [ ] Add a task-local adapter that imports `scripts/asr-benchmark.py` and refuses failed/incomplete/identity-drifted evidence.
- [ ] Add one deterministic publisher for sanitized JSON, Markdown, and the parent/downstream disposition.
- [ ] Add the smallest runnable mutation/self-check covering identity drift, metric tampering, raw-path escape, and deterministic double publication.

Rollback: delete only T08 evidence modes/scripts/outputs; inference code remains testable.

### 6. Correct The Benchmark Contract

- [ ] Preserve the current old-manifest bytes under the ignored task-local correction workspace before changing `.asr-benchmark/manifest.json`.
- [ ] Replace manifest case `long-v1` with `long-v2`, binding unchanged audio/duration and corrected ASS hash/dialogue count.
- [ ] Add the conservative standalone-vocalization classifier to `scripts/asr-benchmark.py` using exactly the reviewed units and 1..6 same-unit repeats.
- [ ] Keep excluded vocalizations in CER while publishing them separately from semantic `missingSpeechRegions`.
- [ ] Add focused tests for punctuation/elongation/repetition, approved examples, `はい`, laughter, mixed lexical cues, multiple overlapping cues, and deterministic diagnostics.
- [ ] Update benchmark self-check and durable ASR quality spec.

Rollback: restore the ignored old manifest and comparator behavior; do not alter raw inference evidence.

### 7. Re-score Historical CTranslate2 Evidence

- [ ] Freeze a correction lock containing old/new manifest identities, policy/tool hashes, original task locks, exact accepted raw hashes, and source roles.
- [ ] Validate T02 ordinary/Kotoba raw files through the archived PoC adapter and old manifest snapshot, then score short/medium/long-v2 through the corrected comparator.
- [ ] Validate T06 selected Candidate A and Candidate B raw files through their archived adapters/locks, then score available rows through the corrected comparator.
- [ ] Validate T08 K1 raw files through its original lock/adapter, then score short/medium/long-v2 through the corrected comparator.
- [ ] Do not rerun completed inference. Do not run Candidate B long because selected Candidate A passes the corrected large-v3 matrix and removes the VAD/ORT product reason.
- [ ] Publish one deterministic sanitized correction matrix plus source-task supersession handoffs. Preserve archived reports unchanged.
- [ ] Require the final matrix to reproduce the reviewed preview dispositions: T02 candidates fail, T06 selected Candidate A passes, Candidate B is diagnostic-only, and T08 K1 medium passes but long-v2 retains seven semantic gaps.
- [ ] Update the active K1 evidence/report/handoff to the corrected manifest and semantic-gap policy without mutating private raw text.

Rollback: remove only corrected supersession artifacts and restore the previous active-task report; archived task evidence remains untouched.

### 8. Full Validation And Handoff

- [ ] Run protocol-only CTest.
- [ ] Run CPU CT2 CTest.
- [ ] Run CUDA development CTest and focused Kotoba model-backed evidence.
- [ ] Run focused then full Rust tests.
- [ ] Run benchmark self-check/manifest validation/shared tests.
- [ ] Run `pnpm build` to confirm no frontend/IPC drift.
- [ ] Run task validation, `git diff --check`, active/archive `git check-ignore`, tracked-file size/status review, and privacy scans.
- [ ] Update ASR/Tauri specs only for durable behavior that actually landed.
- [ ] Update the parent T08 handoff with the corrected T02/T06/T08 dispositions and downstream inputs.
- [ ] Stop before commit unless the user separately and explicitly authorizes committing.

### 9. Freeze K2 Identity And Tests

- [x] Write `research/kotoba-k2-lock.md` with the committed K1/corrected benchmark identities plus candidate `kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1`.
- [x] Add a Kotoba-only maximum applied stride field/profile value of `1000` frames while preserving K1's `1500` source frames and ordinary faster-whisper defaults.
- [x] Add pure focused vectors for parsed/no-speech/final-partial applied advances, minimum 500-frame overlap, variable shorter advances, and source-end termination.
- [x] Add half-open latest-start ownership helpers/tests: `[S[i], S[i+1])`, exact boundary belongs later, final interval ends at audio duration.
- [x] Add coordinate goldens proving following-window recovery at K1 gap #3 and #6 is retained; a midpoint-ownership mutation must fail.
- [x] Keep all seven K1 long-v2 gaps mandatory; do not add a #1/#4/#6 waiver or comparator exception.

Rollback: remove only K2 profile values/helpers/tests; committed K1 remains unchanged.

### 10. Implement Bounded Stride And Buffered Ownership

- [x] Parse one Kotoba K2 window into a temporary segment buffer before protocol emission.
- [x] Compute proposed/applied advance as `min(proposed, 1000, remaining)` for K2 parsed and no-speech paths; ordinary/K1 behavior remains isolated.
- [x] Derive next window start, actual overlap, and current half-open ownership interval.
- [x] Filter non-owner segments by token-derived start timestamp; preserve start/end/text unchanged.
- [x] Exact-deduplicate owned `(startMs, endMs, text)` tuples before callback emission; do not similarity-merge same-time different-text output.
- [x] Run existing fail-closed bounds/nondecreasing-start validation after ownership and before callback.
- [x] Publish progress at the ownership frontier / applied next start and exact duration on completion.
- [x] Add streaming, duplicate, overlap-conflict, no-speech, final-partial, cancellation, and ordinary-route isolation tests.

Rollback: restore K1's direct current-window commit and applied seek; remove K2-only trace fields.

### 11. Add K2 Evidence And Mutation Validation

- [x] Extend ignored raw evidence with K2 candidate/rule identity, window index/coordinates, parsed/proposed/applied advances, overlap, parser flags, ownership interval, progress frontier, and balanced disposition counts.
- [x] Record every parsed segment under ignored local evidence with exact tuple hash, trace hash, owner index, and `emitted|non-owner|exact-duplicate` disposition; keep private text/token/path data untracked.
- [x] Add a K2 adapter/publisher that imports the shared benchmark, validates the complete seek/ownership chain and ordinary-route isolation, and never trusts mutable metrics.
- [x] Bind the original seven-gap coordinate-set hash and report each as covered/still missing without altering the quality gate.
- [x] Add mutation tests for stride/overlap/owner/progress/count/candidate/config/runtime/corpus/private-path drift and byte-identical double publication.

Rollback: delete only K2 lock/adapter/publisher/tracked sanitized output and ignored K2 raw data.

### 12. Run Complete K2 Matrix And Handoff

- [x] Build/test protocol-only, CPU CT2, and pinned MSVC 14.44 CUDA development lanes.
- [x] Run focused and full Rust host tests, including Kotoba success/failure/cancel/recovery/active-gate behavior.
- [x] Run short-v1 as 1 cold + 3 warm, medium-v1 once, and long-v2 once under one frozen K2 CUDA identity regardless of earlier failures.
- [x] Reassess all seven K1 long-v2 gaps, including #1/#4/#6, before any non-defect decision.
- [x] Require CER `<=0.35`, GPU RTF `<=0.5`, short cold wall `<=120s`, RSS `<=6 GiB`, zero timeline errors, and zero semantic gaps for every case.
- [x] Publish sanitized JSON/Markdown twice and require byte identity.
- [x] Run benchmark/sidecar tests, full Rust suite, `pnpm test`, `pnpm build`, task validation, `git diff --check`, ignore/privacy/size scans, and changed-file formatting.
- [x] Update ASR/Tauri specs and parent handoff only for the K2 behavior/result that actually lands.
- [x] On any mandatory failure, keep native Kotoba disabled, publish `stop-revise`, and return to planning before K3 or waiver classification. (Not triggered: K2 passed every gate.)
- [x] Stop before commit unless the user separately and explicitly authorizes committing.

## Planned Product Files

```text
native-asr/src/ctranslate2_whisper.hpp
native-asr/src/ctranslate2_whisper.cpp
native-asr/tests/ctranslate2_whisper_tests.cpp
```

K2 does not require CMake, worker route dispatch, protocol, Tauri host, frontend, model download, package, installer, or benchmark-comparator behavior changes unless implementation evidence exposes a real regression in an existing contract.

## Planned Task Evidence

```text
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/kotoba-k1-lock.md
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/kotoba_benchmark_adapter.py
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/publish_kotoba_candidate.py
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/test_publish_kotoba_candidate.py
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/evidence/kotoba-candidate.json
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/kotoba-candidate-report.md
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/corrected-baseline-research.md
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/corrected-ct2-reassessment-lock.md
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/publish_corrected_ct2_reassessment.py
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/test_publish_corrected_ct2_reassessment.py
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/evidence/corrected-ct2-reassessment.json
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/corrected-ct2-reassessment-report.md
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/k2-candidate-planning-brief.md
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/k2-candidate-design-critique.md
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/kotoba-k2-lock.md
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/kotoba_k2_benchmark_adapter.py
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/publish_kotoba_k2_candidate.py
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/test_publish_kotoba_k2_candidate.py
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/evidence/kotoba-k2-candidate.json
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/kotoba-k2-candidate-report.md
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/local/k2/*  # ignored
```

## Validation Commands

```powershell
# Planning/task gate
python ./.trellis/scripts/task.py validate .trellis/tasks/08-05-native-asr-kotoba-compatibility
git check-ignore -v .trellis/tasks/08-05-native-asr-kotoba-compatibility/research/local/probe.txt

# Native builds
Push-Location native-asr
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release --output-on-failure

cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release --output-on-failure

cmake --preset windows-x64-ct2-cuda-development
cmake --build --preset windows-x64-ct2-cuda-development
ctest --preset windows-x64-ct2-cuda-development --output-on-failure
Pop-Location

# Rust host
cargo test --manifest-path src-tauri/Cargo.toml asr_worker -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml

# Shared quality truth
python scripts/asr-benchmark.py self-check
python scripts/asr-benchmark.py validate --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
python .trellis/tasks/08-05-native-asr-kotoba-compatibility/research/test_publish_corrected_ct2_reassessment.py
# K2 focused checks additionally run the profile/stride/ownership/parser/streaming tests,
# K2 publisher mutation suite, full short/medium/long-v2 CUDA evidence matrix,
# seven-gap reassessment, and byte-identical double publication.

# Cross-layer regression
pnpm test
pnpm build

git diff --check
git status --short
```

K2 model-backed commands, runtime paths, source/tool hashes, candidate parameters, and gap-coordinate-set hash are finalized in `research/kotoba-k2-lock.md` before the first K2 run.

## Start Gate

Before K2 `task.py start`:

- [ ] User reviews/approves the K2 additions to `prd.md`, `design.md`, and `implement.md`.
- [ ] `research/k2-candidate-planning-brief.md` and independent `research/k2-candidate-design-critique.md` are present.
- [ ] Candidate ID, 1000-frame cap, latest-start ownership, no-waiver boundary, full matrix, rollback, and stop rule are frozen consistently.
- [ ] `implement.jsonl` and `check.jsonl` include the K2 research and relevant ASR/Tauri specs.
- [ ] `task.py validate` and `git diff --check` pass.
- [ ] No K2 product file has changed before reactivation.

## Stop Conditions

- K2 cannot guarantee at least 500 frames of overlap without changing the model/source-window identity.
- Latest-start ownership requires fuzzy/text-derived resolution, segment clipping/stretching, synthetic timing, reference-guided selection, or retractable protocol events.
- K2 evidence still fails a mandatory gate: complete/publish the full matrix, then return to planning before K3 or any #1/#4/#6 waiver decision.
- Required model/corpus/runtime identity cannot be pinned or validated.
- The fix requires reference-derived repair, synthetic timing, Python parity, a production downloader/UI change, or formal GPU pack work.
- Legacy cache reuse would require copying/mutating user data rather than reading the exact snapshot in place.
- Ordinary faster-whisper or protocol/host behavior regresses.

## Completion Gate

The K2 iteration is complete when the frozen bounded-stride/latest-start implementation and trace invariants are verified, one complete short/medium/long-v2 CUDA matrix is deterministically published, all seven K1 gaps are reassessed without pre-waiver, archived K1/correction evidence remains immutable, and the parent receives either an accepted Kotoba algorithm input or truthful `stop-revise`. T08 Kotoba productization remains incomplete on any mandatory K2 failure.
