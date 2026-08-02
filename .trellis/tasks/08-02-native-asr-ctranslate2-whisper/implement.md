# Native CTranslate2 Faster-Whisper 产品化实施计划

> 状态：`planning`。T04 protocol 与 T05 Rust host 已完成、提交并归档；final handoff 已可消费。T06 仍为 CPU-only，GPU 属于 T13/T14。

## Dependencies

- Archived T01 benchmark contract, authoritative manifest identity and shared comparator.
- Archived T02 `inputs.lock.json`, source, raw-evidence contract and final report.
- T04 implementation `96077103e0c3070894b70ffa9fcd888bcc93075d`: final protocol library, canonical limits, `windows-x64-release` preset and fake-worker contract; T06 creates the production worker entry point.
- T05 implementation `74d1a4e`: generic `NativeAsrHost::new(executable, worker_args, active_gate)`, `ResolvedNativeLaunch::resolve(...)`, active gate, reducer, cancellation and recovery lifecycle; archive `a18509a`.
- `research/start-gate-lock.md` locks official/community Candidate A, one conditional Silero V6 Candidate B asset, all seven current model revisions/model-weight hashes/licenses and the ignored local boundary.

Context manifests are refreshed to final tracked T04 protocol/limits, T05 durable Tauri spec and archived T05 planning evidence. No active T04/T05 task path remains.

## Execution Checklist

### 1. Finalize Runtime Input Lock

- [x] Record T01 corpus/manifest identity and frozen gates in `start-gate-lock.md`.
- [x] Record T02 CT2/oneDNN/toolchain primitives to promote and PoC algorithm pieces explicitly rejected.
- [x] Pin official OpenAI/faster-whisper Candidate A sources and exactly one conditional Silero V6 Candidate B source/model asset.
- [x] Lock all seven repository revisions, model-weight SHA-256 values, metadata identities, MIT licenses and qualification semantics; Tiny is remote-only but pinned/public/ungated.
- [x] Add active/archive task-local `research/local/` ignore boundary.
- [ ] Before first model load, acquire the required pinned snapshot(s), compute every local required-file SHA-256, freeze selected algorithm config/reproduction commands, and write `algorithm-lock.md`.

### 2. Create Production Worker And Promote Proven Primitives

- [ ] Add production `hikaru-asr-worker` CMake target and `src/main.cpp` using T04 protocol parse/validate/event serialization; keep fake worker test-only.
- [ ] Dispatch ordinary faster-whisper to the CT2 backend and return stable pre-ready errors for unimplemented routes.
- [ ] Integrate WAV validation, official mel, tokenizer/special token metadata and CT2 CPU int8 model load into the production worker.
- [ ] Preserve source-vs-30s-model timestamp windows, raw token ranges and explicit WAV-end bounding.
- [ ] Add CTest vectors for leading silence, final partial windows, consecutive timestamps, invalid token ranges and start-after-audio failure.
- [ ] Do not move T02 evidence-only CLI/scorer into production code.

### 3. Implement Candidate A Timestamp-Driven Long Form

- [ ] Advance seek from decoded timestamp evidence rather than fixed non-overlap steps.
- [ ] Implement pinned prompt/history reset, no-speech and invalid-generation semantics.
- [ ] Keep overlap dedupe narrow and auditable; no text/time generation.
- [ ] Emit monotonic source progress and protocol-compliant segments/errors.
- [ ] Add cancellation checks around windows and suppress completed after cancel/error.

### 4. Large-v3 Decision Gate

- [ ] Reproduce T02 result as a named failing baseline under the shared comparator.
- [ ] Run Candidate A on short (1 cold + 3 warm), medium and long.
- [ ] If all gates pass, freeze A and skip VAD work.
- [ ] If confirmed gaps remain, return to planning to lock Candidate B's native ONNX executor/license/size, then run only the pre-pinned Silero V6 strategy; retain it only if it measurably fixes gaps without regressing other gates.
- [ ] Freeze one algorithm/config identity before the full model matrix.

### 5. Full Product-Model Matrix

- [ ] large-v3 short/medium/long hard gate.
- [ ] large-v2 short/medium/long hard gate, explicitly including authoritative >10min long-v1 regression.
- [ ] tiny/base/small/medium/large-v3-turbo short/medium/long measured disposition.
- [ ] Every short result has 1 cold + 3 warm; medium/long sample counts explicit.
- [ ] Report CER/RTF/cold/RSS/timeline/gaps and subtitle length distribution independently per model/case.

### 6. Host/Protocol Compatibility

- [ ] Real backend runs through T05 `NativeAsrHost::new(worker, vec![], gate)` and `ResolvedNativeLaunch::resolve(...)` using task-local locked model paths/resolved CPU, then T04 request/events, without new product IPC or protocol fields.
- [ ] Add a test-only real-worker host case in `src-tauri/src/asr_worker.rs`; it consumes `HIKARU_ASR_PRODUCTION_WORKER`, `HIKARU_ASR_CT2_MODEL_PATH`, and `HIKARU_ASR_CT2_AUDIO_PATH`, copies audio into a temporary managed workspace, and never changes Release/default routing.
- [ ] success/progress/replace/error/cancel/recovery tests pass with model-backed route.
- [ ] Completed is impossible after user/process cancellation.
- [ ] Non-cooperative single-call cancellation remains bounded by T05 process termination.

### 7. Publish Qualification Evidence

- [ ] Enforce one final executable/DLL/lock/algorithm identity for final matrix.
- [ ] Validate model/corpus/case identities before scoring; failed evidence unscored but complete.
- [ ] Generate deterministic `product-model-disposition.md`, JSON evidence and report twice with byte-identical output.
- [ ] Keep all raw transcript/token/model/build data ignored and scan tracked output for private text/paths.

### 8. Downstream Handoff

- [ ] T07 receives reusable CT2 primitives but no implied Kotoba algorithm.
- [ ] T11/T15 receive per-model qualification metadata while preserving all model IDs.
- [ ] T12 receives frozen dependency identities for its packaging pipeline/provisional artifact; T17 receives accepted T06 source/config identity for final CPU rebuild/attestation.
- [ ] T13/T14 receive CPU baseline/config for acceleration comparison.
- [ ] T16 requirement remains: display all models, disable/explain non-qualified native routes, never silently use Python.

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
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/start-gate-lock.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/algorithm-lock.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/product-model-disposition.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/ctranslate2-whisper-report.md
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/evidence/*
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/*   # ignored
```

No T11/T12/T13/T14/T15/T16 files are modified.

## Validation

Exact presets come from T04/T12-compatible project setup:

```powershell
Push-Location native-asr
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release
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

Model-backed runner/publisher commands must be fixed in `algorithm-lock.md` before final measurements.

## Review Gates

Before start:

- [x] T04/T05 completed/archived; manifests point to final protocol/limits/spec/research handoffs.
- [x] User-reviewed model policy is reflected: large-v3/large-v2 hard, all models visible later.
- [x] Candidate revisions, model identities/weight hashes, local ignored root and license provenance are lockable in `research/start-gate-lock.md`; Candidate B native executor remains an explicit on-demand planning gate.

Before completion:

- [ ] large-v3 and large-v2 hard gates pass; otherwise T06 remains in progress/stop-revise and route is not promoted.
- [ ] All other models have reproducible dispositions; no result hidden by averaging.
- [ ] Full worker CTest, T01 focused tests and T05 host regression pass.
- [ ] Independent check reviews algorithm authority, overfit risk, identity, privacy and downstream metadata.

## Stop Conditions

- Authoritative timestamp-driven and one pinned VAD candidate cannot remove required gaps within frozen gates.
- large-v3 or large-v2 hard gates fail after reviewed candidate set.
- Model/license/runtime identity cannot be pinned.
- Fix requires reference-derived repair, Python parity, synthetic timing or changes owned by T07/T11～T16.

Preserve evidence and report `stop-revise`; do not quietly qualify the route.

## Rollback

Disable ordinary faster-whisper native route and delete task-local ignored build/raw outputs. Keep T04/T05 infrastructure and Python legacy; do not modify user models or projects.
