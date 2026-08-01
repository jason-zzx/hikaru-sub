# Native CTranslate2 Faster-Whisper 产品化实施计划

> 状态：`planning`。Hard-blocked on completed T04 protocol and T05 host. T06 is CPU-only; GPU is T13/T14.

## Dependencies

- Archived T01 benchmark contract, authoritative manifest identity and shared comparator.
- Archived T02 `inputs.lock.json`, source, raw-evidence contract and final report.
- T04 final protocol library, canonical limits and fake-worker executable contract; T06 itself creates the production worker entry point.
- T05 final native host, cancellation and recovery lifecycle.
- Official/maintained long-form candidate revisions and all seven current model identities must be lockable.

Before start, refresh context manifests to final archived T04/T05 handoffs.

## Execution Checklist

### 1. Lock Inputs And Candidate Sources

- [ ] Record T01 corpus/manifest identity and frozen gates.
- [ ] Record T02 CT2/oneDNN/toolchain primitives to promote and PoC algorithm pieces explicitly rejected.
- [ ] Pin official OpenAI Whisper/CT2 long-form behavior and at most one maintained VAD candidate before measurements.
- [ ] Lock all seven model revisions/files/licenses and qualification semantics.

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
- [ ] If confirmed gaps remain, run only the pre-pinned Candidate B VAD/chunk strategy; retain it only if it measurably fixes gaps without regressing other gates.
- [ ] Freeze one algorithm/config identity before the full model matrix.

### 5. Full Product-Model Matrix

- [ ] large-v3 short/medium/long hard gate.
- [ ] large-v2 short/medium/long hard gate, explicitly including authoritative >10min long-v1 regression.
- [ ] tiny/base/small/medium/large-v3-turbo short/medium/long measured disposition.
- [ ] Every short result has 1 cold + 3 warm; medium/long sample counts explicit.
- [ ] Report CER/RTF/cold/RSS/timeline/gaps and subtitle length distribution independently per model/case.

### 6. Host/Protocol Compatibility

- [ ] Real backend runs through T05 internal `ResolvedNativeLaunch` using task-local locked model paths/resolved CPU, then T04 request/events, without new product IPC or protocol fields.
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
```

Task evidence:

```text
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
cmake --preset <windows-x64-cpu-development>
cmake --build --preset <windows-x64-cpu-release>
ctest --preset <windows-x64-cpu-release> --output-on-failure

python scripts/asr-benchmark.py self-check
python scripts/asr-benchmark.py validate --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
cargo test --manifest-path src-tauri/Cargo.toml native_asr
python ./.trellis/scripts/task.py validate .trellis/tasks/08-02-native-asr-ctranslate2-whisper
git diff --check
```

Model-backed runner/publisher commands must be fixed in `algorithm-lock.md` before final measurements.

## Review Gates

Before start:

- [ ] T04/T05 completed/archived; manifests point to final handoffs.
- [ ] User-reviewed model policy is reflected: large-v3/large-v2 hard, all models visible later.
- [ ] Candidate revisions, model identities, local ignored root and license provenance lockable.

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
