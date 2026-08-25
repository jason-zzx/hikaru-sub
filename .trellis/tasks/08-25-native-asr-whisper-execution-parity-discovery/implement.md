# T06D implementation plan

## Stop rules

- Do not run a model-backed command until this planning set is reviewed and `task.py start` activates T06D.
- Discovery output is never candidate or qualification evidence.
- Run A/D anchors before B/C crossovers.
- Stop immediately on an unresolved anchor.
- Permit at most one reviewed harness correction; a second harness/identity failure closes `invalid-evidence`.
- Do not create a quality candidate, six-row matrix, route change or CPU inheritance record in this task.

## 1. Prepare the default-off discovery harness

- [ ] Retarget the parity-only CMake preset/build root from archived T06R to the active T06D ignored root.
- [ ] Keep one measurement executable usable with both isolated CT2 runtime roots.
- [ ] Replace hard-coded 80-mel parity guards with exact `backend.mel_bins()` validation; support only official 80/128 shapes and require large-v3 to report 128.
- [ ] Rename task-path helpers/error labels where needed so T06D cannot write into archived T06R roots.
- [ ] Add a closed model-contract command that constructs the exact model and records `n_mels`, model/runtime identity and post-model module inventory without exposing a production-worker route.
- [ ] Make native Mel export derive its shape from the constructed backend.
- [ ] Make precomputed-Mel generation validate the model-contract hash, `128 × 3000` byte size and canonical task-local containment before encode/generate.
- [ ] Keep the production worker/protocol behavior unchanged.

Pre-model validation:

```bash
cmake --preset windows-x64-ct2-cuda-whisper-parity-discovery
cmake --build --preset windows-x64-ct2-cuda-whisper-parity-discovery --parallel 1
ctest --preset windows-x64-ct2-cuda-whisper-parity-discovery --output-on-failure
```

Stop for correction if the parity build gate leaks into a normal preset or any closed CLI/path/shape mutation passes.

## 2. Add task-local orchestration and evidence checks

- [ ] Add a stdlib Python orchestrator with closed `anchors`, `crossovers` and `publish` phases.
- [ ] Add task-local input preparation that rejects symlinks/junctions and uses hard links or copies under `research/local/`.
- [ ] Add the Python/NumPy feature producer; it must consume a model-contract artifact and cannot accept an arbitrary/default Mel count.
- [ ] Reuse/adapt the archived parser-oracle logic only for exact-token replay; do not edit archived scripts.
- [ ] Add deterministic publisher validation for lane roles, model/audio/runtime/feature hashes, loaded modules, repeat indices, privacy flags and promotion rejection.
- [ ] Add focused stdlib tests covering:
  - 80-mel rejection for large-v3;
  - model-contract mismatch and cross-root/reparse rejection;
  - A/D-first enforcement and B/C refusal before anchor acceptance;
  - anchor mismatch dispositions;
  - runtime/feature/parser/interaction/no-divergence decision vectors;
  - one-correction budget;
  - raw token/text/path privacy and deterministic publication.

Validation:

```bash
python -m unittest discover \
  .trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research \
  -p "test_*.py"
python -m py_compile \
  .trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research/*.py
```

## 3. Prepare isolated ignored-local inputs

- [ ] Materialize the exact short-v1 WAV and large-v3 snapshot below `research/local/inputs/`; verify the frozen hashes and shapes.
- [ ] Materialize two isolated runtime roots below `research/local/runtime/`:
  - Python-wheel CT2 4.8.0 runtime family.
  - Native no-cuDNN CT2 4.8.0 runtime family.
- [ ] Copy the same measurement executable/tokenizer/required support files into both roots.
- [ ] Freeze restricted PATH root roles and reject additional/missing runtime files.
- [ ] Run no-model closed-CLI/runtime self-checks only; these do not count as discovery results.

## 4. Run model-backed contract discovery and anchors

After task activation, run:

```bash
<python311> .trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research/run_whisper_execution_parity_discovery.py \
  --phase anchors \
  --local-root .trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research/local \
  --audio <task-local-short.wav> \
  --model <task-local-large-v3> \
  --python-runtime <task-local-python-wheel-runtime> \
  --native-runtime <task-local-native-no-cudnn-runtime>
```

- [ ] Construct the exact model in each runtime and require `n_mels=128` before feature generation.
- [ ] Produce exact Python and native `128 × 3000` Mel tensors from the discovered contract.
- [ ] Run A and D in clean processes with two deterministic repeats.
- [ ] Capture post-generation module inventories and exact ignored raw hashes.
- [ ] Replay each selected token sequence through both parsers.
- [ ] Apply anchor gates:
  - A mismatch → `baseline-runtime-unresolved`, publish and stop.
  - D mismatch → `native-harness-unresolved`, publish and stop.
  - harness/identity failure → consume the single correction budget only after review; second failure → `invalid-evidence`.

No B/C process may start when an anchor gate fails.

## 5. Run optional crossovers and publish

Only after accepted anchors:

```bash
<python311> .trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research/run_whisper_execution_parity_discovery.py \
  --phase crossovers \
  --local-root .trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research/local \
  --audio <task-local-short.wav> \
  --model <task-local-large-v3> \
  --python-runtime <task-local-python-wheel-runtime> \
  --native-runtime <task-local-native-no-cudnn-runtime>

<python311> .trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research/run_whisper_execution_parity_discovery.py \
  --phase publish \
  --local-root .trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research/local
```

- [ ] Run B and C in clean processes.
- [ ] Validate exact selected token and parser fingerprints.
- [ ] Publish exactly one disposition: `feature-divergence`, `runtime-divergence`, `parser-divergence`, `feature-runtime-interaction`, `no-divergence`, `baseline-runtime-unresolved`, `native-harness-unresolved` or `invalid-evidence`.
- [ ] If attribution succeeds, document at most one separately planned short/medium candidate; do not create or acquire it here.
- [ ] Scan tracked output for text, token arrays, absolute paths, model bytes, audio bytes and credentials.

## 6. Full validation and review

```bash
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release --parallel 1
ctest --preset windows-x64-release --output-on-failure

cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release --parallel 1
ctest --preset windows-x64-ct2-release --output-on-failure

cmake --preset windows-x64-ct2-cuda-whisper-parity-discovery
cmake --build --preset windows-x64-ct2-cuda-whisper-parity-discovery --parallel 1
ctest --preset windows-x64-ct2-cuda-whisper-parity-discovery --output-on-failure

python -m unittest discover \
  .trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research \
  -p "test_*.py"
python scripts/asr-benchmark.py self-check
git diff --check
git status --short
```

Run `cargo test --manifest-path src-tauri/Cargo.toml` and `pnpm build` only if implementation unexpectedly touches Rust/Tauri or frontend/product contracts; otherwise record them as not required because those surfaces are unchanged.

Review gates:

- [ ] Implement review confirms default-off isolation, exact model-derived shape, anchor-first execution, privacy and no promotion path.
- [ ] Check review confirms deterministic evidence, mutation rejection, one-correction enforcement and truthful disposition.
- [ ] Parent roadmap/spec is updated only if the final result changes future sequencing or establishes a reusable contract.

## Rollback

Delete `research/local/` and revert only the active task's research scripts plus parity-gated native harness/preset changes. Archived evidence and production/default routing remain untouched.
