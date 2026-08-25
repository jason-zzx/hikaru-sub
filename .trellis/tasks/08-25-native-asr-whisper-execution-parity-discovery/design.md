# Native Whisper execution-parity discovery design

## Summary

T06D reuses the existing default-off CTranslate2 parity seam and one C++ runner. It replaces the archived hard-coded 80-mel assumptions with a model-derived contract, moves every mutable input/output into the active task's ignored `research/local/` root, and runs anchors before crossovers.

The task is discovery only. It does not create a candidate lock, quality row, production route or reusable runtime pack.

## Boundaries

### Tracked changes

- Minimal default-off native harness changes under `native-asr/`.
- Task-local stdlib Python orchestration, parser replay, publisher and tests under this task's `research/` directory.
- Sanitized result documents containing hashes/counts/disposition only.

### Ignored-local data

Canonical root:

```text
.trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research/local/
```

It owns isolated runtime roots, build output, hard-linked or copied model/audio inputs, Mel tensors, token/text traces, module paths and raw results. Symlinks and junctions are rejected. Same-volume hard links are allowed for the 3 GiB model snapshot; copy is the fallback.

### Unchanged product surfaces

- `hikaru-asr-worker` protocol and normal CLI.
- Tauri commands and `AsrJobSnapshot`.
- React UI and settings.
- Production/default Python route.
- Archived T06/T06R evidence.

## Minimal command surface

One task-local stdlib orchestrator owns the bounded state machine:

```bash
<python311> .trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research/run_whisper_execution_parity_discovery.py \
  --phase anchors|crossovers|publish \
  --local-root .trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research/local \
  --audio <task-local-short.wav> \
  --model <task-local-large-v3> \
  --python-runtime <task-local-python-wheel-runtime> \
  --native-runtime <task-local-native-no-cudnn-runtime>
```

`anchors` is the only initial model-backed command. It launches clean child processes and stops before crossover work unless both anchors reproduce. `crossovers` refuses to start without an accepted anchor summary. `publish` emits a sanitized deterministic result and never reads reference ASS text.

The C++ test runner remains compile-time gated and supplies closed subcommands for:

- model/runtime contract capture;
- model-derived native Mel export;
- one precomputed-Mel generation lane;
- native parser aggregates and loaded-module inventory.

No parity subcommand is exposed by the production worker.

## Loaded-contract discovery

For each isolated runtime root, the same executable:

1. validates the exact model, executable, runtime files, restricted PATH and GPU identity;
2. constructs the large-v3 CTranslate2 model;
3. reads `model.n_mels()` and requires an official supported shape;
4. records `n_mels=128`, model hashes, runtime role and post-construction modules;
5. reaches one generation boundary before finalizing the lazy-loaded module set.

The Python feature producer does not choose `n_mels`. It consumes the Python-runtime model-contract artifact and instantiates faster-whisper's `FeatureExtractor(feature_size=128)`. The native producer constructs the model first, then calls the existing pocketfft implementation with `backend.mel_bins()`. Both outputs must be exact float32 `128 × 3000` tensors.

A tensor is rejected before encode/generate when its byte size, shape, producer role, model-contract hash or task-local path differs.

## Runtime and lane matrix

| Lane | Runtime | Feature producer | Role |
|---|---|---|---|
| A | Python-wheel CT2 4.8.0 | faster-whisper/NumPy | required anchor |
| B | Python-wheel CT2 4.8.0 | native/pocketfft | optional crossover |
| C | native no-cuDNN CT2 4.8.0 | faster-whisper/NumPy | optional crossover |
| D | native no-cuDNN CT2 4.8.0 | native/pocketfft | required anchor |

Every lane uses the same executable, model snapshot, short-v1 waveform, prompt/suppression/options/fallback/parser configuration and CUDA device. Each lane runs in a clean process. Raw token IDs and decoded text stay ignored-local.

## Anchor gates

The orchestrator runs A and D first with two deterministic repeats.

- A must reproduce archived Python short decoded-text aggregate SHA-256 `4ae70515a50f3e7368655a021c94e5db7edaa05372a02d14c93bf77dc1837de0`; otherwise publish `baseline-runtime-unresolved` and stop.
- D must reproduce reviewed native short decoded-text aggregate SHA-256 `d5eb90a205337e242dbcfd2752f2173adbff50a5178219365b9c10894b82479c`; otherwise publish `native-harness-unresolved` and stop.
- Repeats must agree on selected token hash, selected decoded-text hash, selected temperature, fallback trigger sequence and parser aggregates.
- Identity drift, missing atomic raw output, external termination or nondeterminism is a harness/evidence failure rather than an anchor mismatch.

The first harness/evidence failure may return to planning for one reviewed correction. The correction is recorded in the same task result lineage, not a new lock version. A second harness/evidence failure publishes `invalid-evidence`.

## Crossover and attribution rule

After both anchors pass, run B and C once each; repeat only if a sampling temperature is selected or determinism validation requests the already-budgeted second observation.

Comparison first uses exact selected token hashes, then parser aggregate hashes:

1. If all lane token and parser fingerprints match: `no-divergence`.
2. If `A == B`, `C == D`, and the runtime groups differ: `runtime-divergence`.
3. If `A == C`, `B == D`, and the feature groups differ: `feature-divergence`.
4. If token hashes match for a lane but Python/native parser aggregates differ: `parser-divergence`.
5. Any other valid four-cell pattern: `feature-runtime-interaction`.

A causal attribution may recommend one later short/medium candidate targeting only that factor. Interaction does not authorize combining feature and runtime changes.

## Parser replay

Each raw lane retains the exact selected token sequence. The native parser aggregate is produced by the C++ runner from that sequence. A task-local Python replay tool applies the pinned faster-whisper 1.2.1 timestamp parsing rules to the same sequence and emits ignored-local segments plus sanitized hashes/counts.

Tracked publication contains neither tokens nor text. Parser divergence cannot relax native timeline legality; an upstream-equivalent but invalid timeline remains non-promotable.

## Evidence envelope

Each ignored raw lane binds:

- `qualificationEligible=false`, `promotionEligible=false`;
- model ID/revision/file hashes and model-contract hash;
- audio/waveform hashes and source shape;
- feature role, exact `128 × 3000` shape, byte size and hash;
- executable, CT2/runtime files, restricted PATH roots and loaded modules;
- requested/resolved CUDA device and compute type;
- prompt/options/fallback identity;
- repeat index, token/text/parser hashes and bounded counts;
- atomic completion/failure status.

The tracked publisher validates every raw identity, rejects any path outside the canonical ignored root, and writes deterministic JSON/Markdown with aggregate identities and the single disposition.

## Compatibility and rollback

All native seams remain behind the existing default-off parity build gate (renamed only if needed for clarity). Normal protocol-only, CPU CT2, CUDA development and product worker builds cannot call the discovery entry points.

Rollback deletes the active task's ignored root and reverts only parity-gated harness/task-local research changes. No product data or route requires migration.
