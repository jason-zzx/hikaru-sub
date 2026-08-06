# T08 Kotoba Productization Implementation Plan

## Dependencies

- Parent T08 requirements in `.trellis/tasks/07-25-native-asr-migration/`.
- Archived T01 benchmark contract and shared comparator.
- Archived T02 Kotoba model/input lock and six-case report.
- Archived T06 production worker/backend/host handoff.
- Archived T07 `development-gpu-ready` CUDA lane and module identity.
- Local private T01 corpus and pinned Kotoba snapshot are available only under ignored roots.

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

## Planned Product Files

```text
.gitignore
scripts/asr-benchmark.py
asr-service/tests/test_asr_benchmark.py
native-asr/src/ctranslate2_whisper.hpp
native-asr/src/ctranslate2_whisper.cpp
native-asr/src/main.cpp
native-asr/tests/ctranslate2_whisper_tests.cpp
src-tauri/src/asr_worker.rs                # test module only
.asr-benchmark/manifest.json               # private ignored current benchmark
```

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
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/local/*  # ignored
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
# Run corrected publisher twice and compare JSON/Markdown bytes.

# Cross-layer regression
pnpm build

git diff --check
git status --short
```

Model-backed commands and local paths are finalized in `research/kotoba-k1-lock.md` before the first run.

## Start Gate

Before `task.py start`:

- [ ] User reviews/approves the corrected `prd.md`, `design.md`, and `implement.md`.
- [ ] `research/kotoba-productization-inputs.md` and `research/corrected-baseline-research.md` are present.
- [ ] `implement.jsonl` and `check.jsonl` contain real curated entries.
- [ ] `task.py validate` passes.
- [ ] Existing reviewed K1 implementation/evidence remains preserved; no correction-iteration product file is changed before reactivation.

## Stop Conditions

- K1 fails a mandatory semantic gate: complete and publish the remaining K1 authoritative cases under the same identity, then return to planning before another candidate.
- Required model/corpus/runtime identity cannot be pinned or validated.
- The fix requires reference-derived repair, synthetic timing, Python parity, a production downloader/UI change, or formal GPU pack work.
- Legacy cache reuse would require copying/mutating user data rather than reading the exact snapshot in place.
- Ordinary faster-whisper or protocol/host behavior regresses.

## Completion Gate

The correction iteration is complete when the long-v2 manifest and conservative vocalization policy are validated, completed T02/T06/T08 raw evidence has deterministic corrected dispositions, archived history remains unchanged, T06 selected Candidate A is handed off as corrected large-v3 pass, T08 K1 is truthfully retained as long-v2 `stop-revise`, all required validation passes, and no private/local artifact is tracked. T08 Kotoba productization itself remains incomplete until a reviewed Kotoba candidate passes short/medium/long-v2.
