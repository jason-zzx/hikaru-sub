# Native Faster-Whisper GPU quality revision design

## Summary

T06R keeps the existing CTranslate2 worker, protocol v1, timestamp parser, Tauri host, model formats, and T01 comparator. Its first task-local GPU diagnostic lane tested `beamSize` and `conditionOnPreviousText` and truthfully closed with `no-candidate-selected`; the second closed exact-Silero-V6 diagnostic also selected nothing. The source-only upstream parity audit identified `upstream-generation-fallback-parity-v1`; after two fail-closed lock corrections and fresh v3 approval, its two-row GPU diagnostic also published `no-candidate-selected`. No formal candidate exists, and production defaults/formal matrix remain unchanged.

All model-backed qualification follows `native-gpu-authoritative-v1`. The GPU candidate is the only measured route. A matching CPU route may inherit the final disposition as `qualificationSource=inherited-from-gpu`, but has no CPU CER/S/D/I/RTF/RSS fields.

No VAD other than the approved exact Silero V6 diagnostic/selected identity, reference-derived repair, new protocol field, product setting, downloader, runtime pack, or production route switch belongs to this task.

## Authority and inherited boundaries

The design consumes:

- archived T06 production worker, CT2 backend, timestamp/no-speech/seek behavior, evidence adapters, and immutable Candidate A/B history;
- archived T07 CUDA 12.8, RTX 3070 device 0/FLOAT16 execution and module-attestation seam;
- the archived `python-legacy-cuda-v1` model-level baseline;
- the archived legacy-relative re-evaluation that identifies Candidate A's per-field regressions;
- `.trellis/spec/asr/quality-guidelines.md` for full-matrix, identity, privacy, failure, and GPU-authoritative qualification contracts.

The user WAV+ASS corpus remains the only text and timeline truth. Python rows are comparison inputs only and never produce reference text, candidate text, timing, or repair decisions.

## Data flow

```text
validated .asr-benchmark corpus
  + large-v3 pinned CT2 snapshot
  + large-v2 pinned CT2 snapshot
  + pinned CUDA/CT2/tokenizer runtime
            |
            v
GPU diagnostic runner
  short: beam 1/off, beam 5/off
  medium: beam 1/off, beam 1/on, beam 5/off, beam 5/on
            |
            v
T01 metric recomputation + deterministic diagnostic publisher
            |
      selected config or no-candidate-selected
            |
            v
new candidate lock + rebuilt worker/runner
            |
            v
GPU formal acquisition
  large-v3: short 1 cold + 3 warm, medium 1, long-v2 1
  large-v2: short 1 cold + 3 warm, medium 1, long-v2 1
            |
            v
identity validation + T01 recomputation + final publisher
            |
      accepted algorithm handoff | stop-revise
            |
            +-- GPU measured disposition
            +-- CPU inherited-from-gpu metadata, no CPU measurements
```

## Diagnostic design

### Fixed inputs

The diagnostic lock freezes before any diagnostic model load:

- current validated corpus manifest and the exact short-v1/medium-v1 WAV+ASS identities matching the Python baseline;
- large-v3 repository, revision, model/tokenizer file sizes and hashes;
- CTranslate2 source/runtime, tokenizer, diagnostic runner, production worker, CUDA toolkit, GPU, driver, restricted PATH, and loaded-module identities;
- `device=cuda`, `computeType=float16`, device index `0`;
- timestamp-driven seek, temperature `0`, no VAD, existing no-speech thresholds, timestamp parsing, exact dedupe, and source-end behavior;
- the six allowed cells and the selection rule below.

The runner accepts a closed cell ID, not arbitrary beam/history values:

| Cell | Case | Beam | Previous text |
|---|---|---:|---|
| `short-b1-off` | short-v1 | 1 | off |
| `short-b5-off` | short-v1 | 5 | off |
| `medium-b1-off` | medium-v1 | 1 | off |
| `medium-b1-on` | medium-v1 | 1 | on |
| `medium-b5-off` | medium-v1 | 5 | off |
| `medium-b5-on` | medium-v1 | 5 | on |

Short does not duplicate history-on cells because the file fits one source window and has no previous-window text.

Each cell runs in a clean process and produces one ignored raw row. Diagnostic rows set `qualificationEligible=false` and bind the cell, source, model, executable, worker, DLLs, GPU, driver, modules, PATH policy, config, timing, and raw hashes.

### Selection rule

The deterministic publisher recomputes all quality fields through the T01 implementation. A medium config is eligible only when:

1. its matching short beam row passes all large-v3 short relative quality fields and absolute GPU/structural gates;
2. its exact medium beam/history row passes all large-v3 medium relative quality fields and absolute GPU/structural gates;
3. both rows are identity-valid and complete.

If several configs are eligible, choose the lowest medium-v1 GPU inference RTF. Exact ties choose lower beam size, then history off.

If none is eligible, publish `no-candidate-selected`, keep production/default on Python legacy, and return to planning. Do not freeze a known-failing candidate or run the formal matrix.

Diagnostic output cannot become formal evidence. The final publisher rejects any diagnostic schema, raw hash, executable identity, or `qualificationEligible=false` row.

## Gate A outcome and approved revision

The frozen first diagnostic produced this complete distribution:

| Pair input | Short blocker | Medium blocker | Engineering |
|---|---|---|---|
| beam 1 / history off | deletions `27 > 16` | CER `0.103736 > 0.100220`, substitutions `83 > 72`, deletions `119 > 92` | pass |
| beam 1 / history on | same short row | structured `timestamp_after_audio` in the final 1512ms source window | pass before failure |
| beam 5 / history off | insertions `6 > 2` | CER `0.103297 > 0.100220`, substitutions `89 > 72`, deletions `117 > 92` | pass |
| beam 5 / history on | same short row | all CER/S/D/I pass; one 2350ms semantic confirmed-speech gap | pass |

The beam/history-only hypothesis is therefore closed. No pair may be selected or promoted.

The approved second diagnostic changes one variable on the nearest pair: enable the exact faster-whisper 1.2.1 Silero V6 VAD already implemented by archived Candidate B while keeping beam 5, history on, timestamp-driven seek, thresholds, parser, model, CUDA device 0/FLOAT16, and all other values fixed. It has only two acquisition rows because short has no history distinction:

| Proposed cell | Case | Beam | History | VAD |
|---|---|---:|---|---|
| `short-b5-vad` | short-v1 | 5 | immaterial/off in the one-window prompt | exact Silero V6 |
| `medium-b5-on-vad` | medium-v1 | 5 | on | exact Silero V6 |

This is preferred over beam 2/3/4 search because it is causally grounded: Python large-v3 uses beam 5, previous-text conditioning, and VAD, while the current near-pass differs by VAD. Archived Candidate B proves the exact VAD implementation/runtime seam and, under the current comparator, removes semantic gaps for its beam1/off short/medium rows; it does not qualify because its text metrics still regress. The proposed rows must use a new lock/schema/hash and cannot reuse either Candidate B or first-diagnostic evidence.

Selection remains all-or-nothing: both proposed rows must be no worse than their matching Python rows for CER/S/D/I/empty text/semantic gaps and pass the same GPU/structural gates. Otherwise publish a second `no-candidate-selected` and stop. No prompt seed, word timestamps, overlap ownership, arbitrary VAD parameter, fallback, post-processing, or additional beam value is pre-authorized.

### Second diagnostic outcome

The exact-VAD diagnostic also published `no-candidate-selected`:

| Cell | Result versus matching Python row | Engineering |
|---|---|---|
| `short-b5-vad` | CER/S/D pass; insertions `6 > 2`; identical quality to no-VAD beam5 because VAD retained all samples | pass |
| `medium-b5-on-vad` | gap count improves `1 -> 0`, but CER `0.126593 > 0.100220`, S `84 > 72`, D `112 > 92`, I `92 > 64` | pass |

This closes exact VAD as the next causal variable. It fixes coverage but damages text accuracy, and it cannot be combined selectively with the no-VAD output. No formal candidate exists, so the formal-candidate flow below remains dormant.

Any further work must return to planning and first audit actual native/upstream algorithm differences. It may not begin with another beam/VAD grid or pre-authorize prompt, fallback, word-timestamp, overlap or post-processing changes.

## Upstream parity research outcome

The source-only audit in `research/upstream-parity-audit.md` confirms:

- large-v3 short/medium/long-v2 Python baseline rows use the upstream direct `WhisperModel` path with beam 5, exact V6 VAD, and faster-whisper 1.2.1 defaults;
- upstream uses a closed generation fallback ladder over temperatures `0.0..1.0`, retrying on exact compression/log-probability rules and using the selected temperature for prompt reset;
- native makes exactly one temperature-0 generation call per window and therefore cannot reproduce fallback or its prompt-reset consequence;
- native also retains non-emitted timestamp slices in history, but that difference is medium-only and cannot explain the one-window short blocker;
- existing Python evidence lacks fallback-attempt telemetry, so actual trigger frequency and quality effect remain unproven.

### Proposed Phase 3C boundary

The sole code-supported next candidate is `upstream-generation-fallback-parity-v1`, layered on the failed second-diagnostic identity so the only causal change is exact upstream fallback behavior. It retains beam 5, history on, exact V6 VAD, timestamp-driven seek, parser, model, GPU and every other input.

Before any model load, the approved Phase 3C will:

1. implement one reusable fallback decision/helper path with the exact upstream attempts, thresholds, silence override and all-failed selection;
2. compare it against the installed 1.2.1 Python implementation using fake-generation vectors for every branch;
3. prove exact per-attempt CT2 options, at most six calls, selected-temperature prompt reset and deterministic aggregate trace identity;
4. prepare—but not execute—a new closed two-row short/medium diagnostic lock;
5. receive independent review and stop for another user acquisition decision.

Phase 3C may not combine the history-eligibility fix, arbitrary temperature/beam/VAD tuning, word timestamps, overlap, suppression, output repair or post-processing. If oracle parity cannot be proven, the candidate closes without inference. If parity passes but a later authorized diagnostic never triggers fallback, it intentionally reproduces the second diagnostic failure and closes the hypothesis.

### Authorized acquisition preflight outcome

The user authorized exactly `short-b5-on-vad-fallback` and `medium-b5-on-vad-fallback` under lock SHA-256 `5fcfe845451f418a1e21fe8711ba9f367fdc2e13f8c2e02dd598683dde4e073a`. Pre-model re-attestation matched the frozen source, publisher, runner/worker/runtime, large-v3 model, Silero V6, corpus, restricted PATH root, RTX 3070, driver and CUDA identities. It also exposed a fail-closed identity gap: the current fallback lock does not directly list the reviewed `vcomp140.dll`, `nvcuda.dll`, `cublas64_12.dll` and `cublasLt64_12.dll` hashes, while `_validate_modules` requires every loaded-module hash to occur in the exact current lock text.

This is invalid evidence, not a candidate quality failure. No model was loaded, neither row ran, the publisher produced no fallback diagnostic disposition, and the frozen lock was not edited.

A separate v2 identity, `research/gpu-fallback-diagnostic-lock-v2.md` / `823630f08ab15ed7dadf4f80f0e5a320c89e3e2171cd55b8ac86cc6463235b82`, directly listed the complete expected loaded-module inventory. Gate C3 review then found that the publisher still validated only a required subset, so a fallback row could omit `vcomp140.dll` or add another frozen module while passing. V2 is therefore a reviewed blocked identity, not an acquisition input.

Gate C3 repaired only the fallback evidence boundary: `research/gpu-fallback-diagnostic-lock-v3.md` / `b95bdcc1e2a33ab30c2064fef70d466cd92842fedaaaed07350a1c111bcdcf29` binds the exact eight-module name/size/SHA-256/root-role/raw-version set, and the publisher rejects missing, additional, identity-, version-, or root-drifted modules. Publisher tests pass `15/15`; the superseded locks and invalid/v2 preflight artifacts remain byte-identical. Current source/runtime/model/corpus/VAD/zlib/GPU/PATH identities otherwise matched, so no rebuild occurred. Gate C3 reached `clean-to-request-renewed-acquisition`, and the user then granted fresh explicit approval for both rows.

### V3 fallback diagnostic outcome

Pre-model re-attestation matched 55 frozen files, the exact eight-module inventory, restricted PATH, RTX 3070/driver, CUDA 12.8.93, MSVC and CMake identities. Both rows completed under the unchanged v3 lock. An earlier medium attempt was externally terminated before atomic output and was discarded as invalid process evidence; only its clean-process rerun is published.

| Cell | Fallback behavior | Result versus matching Python row | Engineering |
|---|---|---|---|
| `short-b5-on-vad-fallback` | 1 generation call, 0 fallback calls, selected temperature `0.0` | CER/S/D/gaps pass; insertions `6 > 2` fail | RTF `0.116202`, RSS `3232940032`, timeline pass |
| `medium-b5-on-vad-fallback` | 17 windows, 29 generation calls, 12 fallback calls; selected `0.0×13, 0.2×1, 0.4×1, 0.8×1, 1.0×1` | CER `0.138901 > 0.100220`, S `84 > 72`, D `167 > 92`, I `65 > 64`, gaps `2/3930ms > 0` | RTF `0.195917`, RSS `3232133120`, timeline pass |

The deterministic publication selected `no-candidate-selected`. Fallback causality is now observed rather than hypothetical: it is inactive in the mandatory one-window short blocker and active but harmful in medium. This closes `upstream-generation-fallback-parity-v1` without a formal candidate. Production/default remains Python legacy, and the formal design below stays dormant pending a separately planned candidate identity.

## Phase 3D short input/runtime parity bisect

### Purpose and authorization boundary

`short-input-runtime-parity-bisect-v1` is a stage-localization probe, not a quality candidate. It addresses the last unresolved mandatory short question by crossing the two verified pre-generation differences:

- faster-whisper/NumPy versus native/pocketfft Mel bytes;
- Python-wheel versus native no-cuDNN CTranslate2 `4.8.0` runtime identity.

The user approved pre-model planning and implementation only. Phase 3D may build runners, generate Mel inputs, execute no-model ABI/runtime smoke, validate fake rows, prepare a lock and receive independent review. It may not construct large-v3, execute `encode`/`generate`, reacquire Python quality, change a production default or enter the formal matrix.

### Same-harness matrix

The preferred implementation uses one task-local C++ parity runner executable copied into two isolated runtime roots. Windows loader order selects the CT2 DLL before process start, while executable, tokenizer, source, prompt/options, model path and evidence schema remain identical.

| Cell | Mel producer | Runtime root |
|---|---|---|
| `python-runtime-python-mel` | pinned faster-whisper 1.2.1 NumPy tensor | frozen Python-wheel CT2 4.8.0 root |
| `python-runtime-native-mel` | native `official_log_mel_for_test` tensor | frozen Python-wheel CT2 4.8.0 root |
| `native-runtime-python-mel` | pinned faster-whisper 1.2.1 NumPy tensor | frozen native no-cuDNN CT2 4.8.0 root |
| `native-runtime-native-mel` | native `official_log_mel_for_test` tensor | frozen native no-cuDNN CT2 4.8.0 root |

The runner accepts only those four cell IDs and an exact precomputed `80 × 3000` float32 Mel file below the task-local ignored root. Arbitrary runtime paths, feature files, models, cases, devices, beams, prompts, suppress sets, temperatures or parsers are rejected.

Planning feasibility is already demonstrated by `research/phase3d-planning-feasibility.md`: the unchanged current C++ tests executable passed both `--fallback-self-check` and `--self-check` with the wheel CT2/cuDNN/OpenMP files in an isolated root and no model supplied. The final rebuilt parity runner must repeat this smoke. If it fails, Phase 3D stops and returns to design; it must not silently substitute a Python binding runner, because that would add a harness variable to the `2 × 2` matrix.

### Frozen inputs and no-model artifacts

Before any future model load, Phase 3D freezes:

- short WAV/corpus and decoded float32 waveform SHA-256 `2cbf22e7635a41cf751401525e4358c19f2d452ae99c0ced78f65b6e9327e1c2`;
- a later-acquisition preflight rule requiring exact Python V6 VAD to return one `[0,385637)` interval and the same post-VAD waveform hash;
- Python Mel SHA-256 `51209b71c3450718055dfad8a3d5923283dd95d702d606b0bdf56aac53218aa9`;
- native Mel SHA-256 `c2fc425ae691a4b1f9acd92580061ad97df82e01165747d761653f87634b9e08`;
- shape/dtype, max/mean absolute Mel difference and producer source hashes;
- exact prompt `[50258,50266,50360]`, 88 suppress IDs, begin-suppress IDs, beam/fallback/options identity and model snapshot;
- parity runner/tokenizer plus each CT2 root's files, loader policy, GPU/toolchain and expected exact loaded-module set;
- archived Python short hypothesis hash `4ae70515a50f3e7368655a021c94e5db7edaa05372a02d14c93bf77dc1837de0` and reviewed native v3 short text aggregate `d5eb90a205337e242dbcfd2752f2173adbff50a5178219365b9c10894b82479c` as reproducibility anchors only, never reference text.

Generated Mel bytes, token IDs, decoded text, parser segments, module paths and model traces stay ignored-local.

### Probe contract

A future model-backed row records:

- cell, Mel/runtime/root/lock/model/GPU identities;
- exact loaded modules after completed generation;
- first temperature-0 token count/hash, score-derived average log probability, no-speech probability and decoded-text aggregate hash before fallback selection;
- each fallback attempt's temperature/options/trigger categories and aggregate hash, plus selected attempt/output hash;
- a canonical `generationFingerprint` over first-attempt token hash, ordered fallback decision vector, selected attempt index/temperature and selected token hash; factor attribution compares this fingerprint, never CER or parser text;
- native parser result and an offline faster-whisper 1.2.1 parser result over the exact same token sequence, publishing only count/text/timeline aggregate hashes;
- timings/resources for diagnosis only;
- `qualificationEligible=false` and explicit rejection by every quality/final publisher.

Each cell runs in a clean process. Two identical repeats are preferred; at minimum, any cell selecting temperature above zero must repeat and match its frozen aggregate interpretation. Discovery or invalid rows cannot be promoted into the matrix.

### Deterministic decision rule

Let A/B/C/D follow the table order above.

1. A's **Python-parser** text aggregate must reproduce archived Python short hypothesis hash `4ae70515...`; otherwise publish `baseline-runtime-unresolved` and stop attribution.
2. D's **native-parser** text aggregate must reproduce reviewed native v3 short aggregate `d5eb90a2...`; otherwise the probe is invalid.
3. All A/B/C/D equality below means exact equality of `generationFingerprint`, not subtitle text, CER or segment timing.
4. `A == B`, `C == D`, and Python-runtime fingerprints differing from native-runtime fingerprints selects `runtime-divergence` for later candidate planning.
5. `A == C`, `B == D`, and Python-Mel fingerprints differing from native-Mel fingerprints selects `feature-divergence`.
6. Neither independent separation publishes `feature-runtime-interaction`; it does not authorize combining both changes.
7. Equal selected raw token hashes with different Python/native parser aggregates selects `parser-divergence`, subject to the absolute zero-timeline-error gate. Parser divergence cannot override a prior generation-factor attribution when raw tokens differ.
8. Identity/module drift, nondeterminism, VAD mismatch, missing first-attempt trace, non-reproduction, external termination or publisher inconsistency is invalid/unscored evidence.

Tracked publication may report only `runtime-divergence`, `feature-divergence`, `feature-runtime-interaction`, `parser-divergence`, `no-divergence`, `baseline-runtime-unresolved`, or `invalid-evidence`. It never reports `qualified`, `accepted`, CER or a production recommendation.

### Pre-model implementation and review gate

Phase 3D implementation is limited to:

- default-off CMake/preset wiring for the task-local parity runner;
- one no-model native Mel exporter and precomputed-Mel validation seam;
- task-local Python Mel/parser oracle scripts pinned to installed faster-whisper 1.2.1;
- isolated Python-wheel/native CT2 runtime roots and no-model same-runner ABI/load smoke;
- a deterministic publisher that reuses the reviewed fallback validator and reruns the pinned parser oracle under the frozen Python 3.11.15/tokenizers runtime, plus fake-row identity/mutation/privacy/determinism tests;
- `gpu-short-parity-bisect-lock.md`, reproduction commands and sanitized pre-model evidence.

Independent review must verify exact set equality for both runtime module inventories, no cross-root DLL loading, exact cell/Mel mapping, closed prompt/options/fallback/parser identities, baseline/native anchor roles, ignored containment and promotion rejection. A clean review permits only requesting four-cell acquisition approval; it does not authorize model load.

### Phase 3D pre-model outcome

Gate D is clean under `gpu-short-parity-bisect-lock.md` SHA-256 `470f9e0fba8cb0bc837660eae4173635bcc86212bea83324a02c0953d9c36793`. The identical rebuilt runner passed both isolated runtime smokes; all four closed preflights completed with `modelLoaded=false`; model/Mel/runtime/module/tool/tokenizers/zlib identities, fallback fingerprints, independent Python/native parser replay, privacy and promotion rejection passed focused checks. Independent review concluded `clean-to-request-acquisition` with no remaining blocker.

No model-backed parity cell has run. Fresh authorization was granted for the four cells under the original lock, but the final preflight found that the lock/publisher did not directly freeze or consume the required Python Silero V6 preflight identity. The acquisition stopped before VAD or ASR model load and produced no row. Lock `470f9e0f...` remains immutable.

Corrected v2 lock SHA-256 `481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543` binds the exact VAD source/asset/ONNX Runtime disk set, CPU provider, loaded sibling DLL root and one sanitized actual-result artifact before parity publication. Four no-model preflights and focused tests passed; independent Gate D2 review found no blocker and concluded `clean-to-request-renewed-acquisition`.

The user granted fresh exact-v2 authorization. Disk/tool/model/Mel identities matched, and Silero V6 executed, but the preflight failed closed after inference because Python ORT did not load the frozen sibling `onnxruntime.dll`. A no-model PE audit confirms `onnxruntime_pybind11_state.pyd` does not directly import that DLL. The VAD artifact was never atomically written, the ASR model was not loaded, and no cell/parser/publication exists. V2 is therefore immutable invalid evidence.

V3 lock SHA-256 `62ef486a9f54d62d3f78504fc293a1917e59746d85cf09a73422edc2c384e42f` changes only that VAD execution identity. A CPython/ORT import-only smoke observed the exact frozen capi-root set `{onnxruntime_providers_shared.dll, onnxruntime_pybind11_state.pyd}` and absence of `onnxruntime.dll`, without constructing `InferenceSession` or loading a model. The producer enumerates all process modules before selecting ORT basenames, fails if any module path cannot be resolved, and rejects a relevant module from any other root before exact-set comparison. Publisher and mutation tests bind missing/additional/root/hash/status drift before any parity row can be consumed. Independent Gate D3 reached `clean-to-request-fresh-v3-acquisition`, and the user then granted fresh exact-v3 authorization.

The authorized v3 pre-model and VAD gates passed: immutable identities matched, Silero retained `[0,385637)`, the waveform hash matched, and the exact loaded/not-loaded ORT split reproduced after inference. Acquisition then stopped at the first cell before CTranslate2 Whisper model construction. The frozen runner invokes the fallback-enabled backend with no VAD model path, while the backend's reviewed fallback invariant requires that path and emits `Fallback parity requires beam5/history-on/exact-VAD identity` before creating the model. Therefore v3 yields invalid harness evidence: no ASR model load, encode/generate, atomic row, parser or publication, and the remaining cells stay unrun. Repairing this constructor contract changes runner/source identity and requires a new lock, review and authorization rather than an in-place v3 retry.

V4 lock SHA-256 `e38e23f5fc28405ffb2554324b2967c077d6eeda46b010ec51aac5bece378ff8` implements only that task-local harness repair. Both parity modes require `--vad-model`; the path must canonically identify the exact frozen Silero V6 asset beside the active isolated runner before backend construction. The production fallback invariant and product routes remain unchanged. Same-runner native/Python-wheel runtime smokes, four closed no-model preflights, exact VAD path/identity negatives, publisher/oracle tests and predecessor immutability checks passed. Independent Gate D4 concluded `clean-to-request-fresh-v4-acquisition`; no VAD inference, ASR model construction, parity row or attribution publication ran, and a fresh explicit v4 authorization remained mandatory.

The user granted fresh exact-v4 authorization. Re-attestation and all four no-model preflights passed under unchanged v4 identity, but the new Python VAD preflight stopped before faster-whisper/ORT import. The frozen tool still compares `--input-lock` exclusively to `gpu-short-parity-bisect-lock-v3.md`; exact v4 therefore raises `VAD preflight input path identity drifted`. This is invalid harness evidence, not a VAD or parity result. No v4 VAD artifact, CTranslate2 model construction, encode/generate row, parser replay or attribution publication exists, and v4 cannot be repaired or retried in place.

V5 lock SHA-256 `6a2ee4ee58cde783be473e907a4fe56aa72c7afcdba7b567644d2dfce74ac8fb` changes only the task-local Python lock-selection and publisher identity needed to consume a future exact-v5 VAD artifact. The canonical exact-v5 path is accepted; v1-v4, unknown, cross-root, malformed and wrong-audio inputs reject before faster-whisper/ORT import. Native C++, both isolated CT2 runtimes, `--vad-model` validation, production fallback behavior and product/default routes remain byte-identical to v4. Same-runner runtime smokes, four closed no-model preflights, mutation/privacy/promotion tests and predecessor immutability passed. Independent Gate D5 concluded `clean-to-request-fresh-v5-acquisition`.

Fresh exact-v5 authorization completed the immutable re-attestation and actual Python Silero V6 gate. The first cell then constructed the frozen large-v3 CTranslate2 model but stopped before encode/generate because the probe's frozen `80 × 3000` Mel shape does not match the model's actual `128` Mel bins. This is a pre-generation harness-identity failure, not a factor attribution or model-quality result. No atomic row, parser artifact or parity publication exists; the other three cells remain unrun. V5 is immutable invalid evidence and cannot be retried or shape-adjusted in place. Any later parity design must first derive and freeze the feature shape from the exact loaded model contract rather than a model-independent default.

## Task closure

T06R closes as `stop-revise / non-qualified`. The formal candidate design below was never activated: no candidate was selected, no six-row matrix ran and no CPU inheritance metadata exists. `research/whisper-quality-non-qualified-handoff.md` is the final parent-facing result. Any further investigation belongs to the separate planning task `08-25-native-asr-whisper-execution-parity-discovery`, which must separate bounded discovery from acquisition and qualification, use exact 128-mel large-v3 features, reproduce A/D anchors first and permit at most one harness correction.

## Dormant formal candidate design (not executed)

### Candidate freeze

After selection:

1. apply only the separately reviewed and selected post-bisect candidate identity to ordinary Faster-Whisper defaults;
2. leave Kotoba configs and Candidate B code unchanged;
3. rebuild the T06R worker and runner in a task-local CUDA build root;
4. freeze a new candidate lock containing source/config, worker/runner/DLL, CUDA/GPU/driver/module/PATH, corpus, large-v3, and large-v2 identities;
5. mutation-test the lock and publisher before formal acquisition.

The candidate uses one algorithm/config/runtime identity across both anchors while binding each anchor's own model revision and file hashes. Any source, config, worker, runner, DLL, GPU module, model, corpus, or lock drift invalidates only the affected rows and requires a clean rerun.

### Formal matrix

Formal acquisition uses only CUDA device 0/FLOAT16:

| Model | short-v1 | medium-v1 | long-v2 |
|---|---:|---:|---:|
| large-v3 | 1 cold + 3 warm | 1 | 1 |
| large-v2 | 1 cold + 3 warm | 1 | 1 |

The quality sample for short is the frozen cold result; the three warm runs supply the warmed inference median. Medium and long-v2 each use one complete attempt. A quality-gate failure does not stop later cases.

An identity-valid candidate-caused structured failure with a complete trace counts as an attempted row and forces `stop-revise`. External termination, incomplete atomic output, harness corruption, or identity drift is invalid evidence and must be repaired and rerun.

The accepted disposition requires every GPU row to satisfy:

- same-model/same-case Python non-regression for CER, substitutions, deletions, insertions, empty text, semantic-gap count, and semantic-gap duration;
- accelerated inference RTF `<=0.5`, short cold wall `<=120s`, and CTranslate2 peak process RSS `<=6 GiB`;
- timeline, UTF-8, text-conservation, subtitle/protocol, complete-matrix, identity, process, path, privacy, license, cancellation, and recovery gates.

Both anchors must pass. One anchor cannot authorize the other or unlock the remaining Whisper models.

### CPU inheritance

The final evidence has one measured GPU disposition. CPU metadata may be emitted only when both GPU anchors qualify and must contain:

```json
{
  "qualificationSource": "inherited-from-gpu",
  "sourceProfile": "native-gpu-authoritative-v1",
  "sourceCandidateId": "<exact GPU candidate id>",
  "logicalModelIdentity": "<matching model>",
  "algorithmConfigSha256": "<same config hash>"
}
```

CPU CER/S/D/I/RTF/wall/RSS fields are absent. No GPU value is copied or relabeled. A failed, missing, drifted, or superseded GPU candidate leaves CPU non-qualified.

CPU compilation, protocol, packaging, path, and non-model smoke remain owned by their existing tasks and are not model qualification evidence.

## Code boundaries

Expected production/test changes are limited to existing native ASR files:

```text
native-asr/CMakePresets.json
  add a T06R CUDA preset with a task-local build root

native-asr/CMakeLists.txt
  provide the canonical T06R local root to the existing CT2 test runner

native-asr/src/ctranslate2_whisper.hpp
  selected ordinary config defaults only, after diagnostic selection

native-asr/tests/ctranslate2_whisper_tests.cpp
  add closed diagnostic/formal GPU evidence modes
  reuse CTranslate2WhisperBackend, config_json, segment/trace serialization,
  CUDA execution attestation, module inventory, and model/runtime identity helpers

.gitignore
  ignore active/archive T06R research/local artifacts
```

No new production abstraction is needed. `main.cpp`, protocol v1, Tauri commands, React types, and ASR settings remain unchanged unless the selected defaults require an explicit existing-config call site update.

Task-local tracked research files contain only locks, stdlib publishers/tests, sanitized evidence, reports, commands, and handoff metadata. Raw audio, ASS text, transcripts, token traces, binaries, models, module paths, and build trees remain below:

```text
.trellis/tasks/08-20-native-asr-whisper-quality-revision/research/local/
```

## Evidence and publication

Two deterministic publishers are owned by T06R:

- diagnostic publisher: validates the first six closed cells and the separately locked two-row exact-VAD diagnostic, recomputes T01 metrics, applies each frozen all-or-nothing selection rule, and emits selected config or `no-candidate-selected`;
- final publisher: validates the candidate lock and six formal rows, recomputes all metrics, compares to the matching Python baseline, emits GPU disposition and optional CPU inheritance metadata.

Both publishers:

- use Python standard library plus the existing T01 benchmark module;
- write byte-identical output on repeated invocation;
- reject unknown fields, wrong run roles/repeats, cross-model rows, wrong GPU/device/compute type, module/PATH drift, config drift, diagnostic promotion, missing complete failure traces, and paths outside the canonical ignored root;
- publish no transcript, token IDs, ASS text, absolute paths, model bytes, or raw event bodies.

## Compatibility

- Worker protocol v1, `AsrJobSnapshot`, active-job gating, recovery, cancellation, and process-tree semantics do not change.
- The selected algorithm remains ordinary `faster-whisper -> ctranslate2`; Kotoba and CrispASR routes are untouched.
- Production/default remains Python legacy through T18.
- T14/T15 must rebuild and rerun the selected algorithm under the final GPU pack identity. T06R development evidence is an algorithm handoff, not a release pack hash.
- T12 model delivery, T13 CPU packaging, settings, UI, installer, and Python removal remain out of scope.

## Validation strategy

Planning fixes exact commands in `implement.md`. The design requires:

- protocol-only, CPU CT2 compile/CTest, and T06R CUDA compile/CTest remain green; CPU CTest is non-model coverage only;
- focused diagnostic/final runner self-checks and publisher unit/mutation/determinism tests;
- benchmark self-check and ASR benchmark unit tests;
- CUDA real-worker host success, structured pre-ready failure, cancellation/reap, recovery, and active-gate checks through the existing Rust test seam;
- full Rust tests and frontend build regression;
- privacy scans, ignored-root checks, `git diff --check`, task context validation, and no staged files.

## Failure and rollback

- No diagnostic config passes: publish `no-candidate-selected`, make no production-default change, and return to planning.
- Selected candidate fails any formal row: complete the six-row matrix, publish `stop-revise`, keep all native Faster-Whisper routes disabled, and do not create CPU inheritance metadata.
- Invalid evidence: repair the harness/identity issue and rerun only affected rows; do not convert it into a candidate failure.
- Code regression: restore the pre-T06R ordinary defaults and remove only T06R runner/preset changes.
- Local cleanup: delete only the ignored T06R `research/local/` root. Archived T06/T07 evidence and Python legacy remain untouched.

## Design decisions

- **D1:** GPU is the sole model qualification device; CPU inherits exact GPU disposition without measurements.
- **D2:** The first closed beam/history diagnostic, second exact-VAD diagnostic and v3 upstream-fallback diagnostic are complete and selected nothing. `upstream-generation-fallback-parity-v1` did not trigger on short and regressed medium despite triggering there, so that single-causal scope is closed. Prompt seeds, word timestamps, overlap, suppress-token changes, post-processing, arbitrary VAD parameters, beam 2/3/4, and the medium-only history fix remain unauthorized.
- **D3:** Use six closed diagnostic cells and one deterministic selection rule; arbitrary CLI tuning is forbidden.
- **D4:** Diagnostic evidence never becomes formal evidence; selection requires a new lock, rebuild, and rerun.
- **D5:** Keep T06R evidence/build outputs task-local so archived T06/T07 identities remain immutable.
- **D6:** T14/T15 own final GPU pack qualification; T06R owns only the selected algorithm and development GPU evidence.
- **D7:** Phase 3D localizes short divergence with one same-executable `Mel × CT2 runtime` matrix before another quality candidate. It is pre-model and promotion-ineligible until a separately approved acquisition, and it cannot combine feature/runtime fixes or substitute fresh Python output for the frozen quality authority.
