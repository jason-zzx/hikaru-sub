# ReazonSpeech R2 Step 6 Rust-host validation

## Scope and result

- Candidate: `R2-vad12-pad30-overlap-top-level-v1`.
- Result: `validated` for the reviewed Step 6 host/lifecycle lanes.
- This run performed no short-v1 / medium-v1 / long-v2 benchmark acquisition and publishes no quality disposition or relative selection.
- Ignored manifest: 15,483 bytes, SHA-256 `aa28e40c65c029c2c7c651121606f9334daddf21ee839c59954455d3bb5bb33c`; the exact hash is bound in the Rust test source and this tracked report/lock.
- Every lane row below is recomputed from one Rust-emitted observed record inside a lane-specific, digest-verified log header; manifest expectations are validation contracts, not reported outcomes.
- Release/default routing and production commands remain unchanged; all input decoding and event tracing seams are test-only.

## Explicit lane matrix

| Lane | Worker role | Device | Observed status | Observed ready / duration | Observed progress | Observed error | Header SHA-256 | Log SHA-256 |
|---|---|---|---|---|---|---|---|---|
| `success` | `production-worker` | `cuda` | `completed` | yes / 24102ms | 10260, 14080, 24102 | `none` | `250e223af92ebc40a20daaa1c12143fbcdf8e01bcee7c36cb987a28d098ce9e0` | `aecd6251ed607a654aaea66e9d13b5aaca331c63fa7e56767ba25a1ca84411e6` |
| `pre-ready-negative` | `production-worker` | `cuda` | `failed` | no | none | `crispasr_vad_model_invalid` | `15400274389d26f600f49b427d7da4f8326a000744f64588a28f276500e3e013` | `772608da48982db816760e5083feed00e12c22eed6f08d188bf085006fd46dbe` |
| `post-ready-vad` | `production-worker` | `cuda` | `failed` | yes / 2000ms | none | `crispasr_vad_no_result` | `7fa03657a615ff0312dbb80526e5c47a480b29100f819d094972717752f05c88` | `3530761975e4e972c38fe16fd2afaedfd462ce634ec6ffa5a537d07685fb3d0a` |
| `post-ready-protocol` | `contract-worker` | `cpu` | `failed` | yes / 20000ms | 12060, 20000 | `invalid_segment` | `d29bac7640c5a410789df6536c834567984ecd3575e4d3c9030274d2f795f13e` | `3030237586b13ab9257cb569a978269c5b63f26430992a0b806979cd2b650556` |
| `post-ready-policy` | `contract-worker` | `cpu` | `failed` | yes / 20000ms | 12060, 20000 | `parakeet_family_invalid_input` | `93942a8ef67b6e34fb38bf71cfa66f06cba28086043bdeda6d66f7287beab735` | `dd983e0464a453ca02ddf7b1ae8f4cd23370ad3425ee55c34fca9d9e8770172e` |
| `cancellation` | `production-worker` | `cuda` | `cancelled` | yes / 498872ms | 11150 (observed prefix) | `none` | `54e66f23e732dcf67f1bddbca11026606830463837afa1291d97e8ba3953bbf5` | `2f5ad98fb267be67198354977c6cc007da5c3cd8f627c175581038e7299844cb` |

The observed success record contains the exact event order `ready -> progress* -> segmentsReplace -> completed`, one replacement, zero preview events, matching recovery segments, and a verified ASS/replacement vector. Each observed failure/cancellation record contains zero replacement/segments/recovery output. The cancellation record also reports process reap, gate release, and cancellation completion in `367ms` (within the existing two-second bound).

All six lane log paths, log hashes and header digests are distinct. The publisher rejects duplicate labels, lane swaps, command/test-filter or required-environment mutation, manifest/expectation drift, duplicated protocol-as-policy evidence, and log/header digest mismatch.

## Validation logs

| Check | Result | Ignored log bytes | Log SHA-256 |
|---|---|---:|---|
| `targeted-cargo-tests` | pass | 3,282 | `512edc056f014bd1680051cb5601895effda7d1197ac02b4d08ab35c3494e501` |
| `full-cargo-tests` | pass | 17,425 | `1b562f13e1a4475737f287b6cb4b9012238e24fe5b030e56cb4058f601f84c56` |
| `release-cargo-check` | pass | 145 | `dcc279ef28506819ca6e65b773297db6cefe998fe977f763effc3cbb53e077d3` |
| `task-validation` | pass | 279 | `e8d93033d8bee9c020dc9a4fe905f7053fa87d10d831e723a3ed4efffcab1b09` |
| `diff-check` | pass | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `ignore-check` | pass | 166 | `15a6b10f3619e6c381354149e7116fa9536a0c53545f1407f0df98b8e5c79021` |
| `privacy-scan` | pass | 28 | `7ca684cfd587eb9e14ea7b20f792eaa0e329018062ea36a5f14ef00d2fa34a99` |

## Reproduction

```bash
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_r2_step6_validation.py
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/test_publish_r2_step6.py
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/publish_r2_step6.py
```

The runner invokes every lane separately with `HIKARU_ASR_R2_STEP6_REQUIRED=1`, the exact ignored manifest path, one explicit `HIKARU_ASR_R2_STEP6_LANE`, and the exact Rust test filter. The pre-existing generic `HIKARU_ASR_CRISPASR_INPUTS` decoder remains separate for T09/T10 Parakeet/Qwen/Reazon tests. It writes the canonical lane/command/environment/scenario/manifest/expectation header before command output.

## Evidence boundary

The ignored manifest contains repository-relative paths only and locks every worker, runtime DLL, model, VAD and audio role by byte size and SHA-256. Tracked output contains no transcript text, user-absolute path, model/audio/VAD bytes, stderr, binary or build output. Missing generic optional inputs still skip ordinary developer real-worker tests; `HIKARU_ASR_R2_STEP6_REQUIRED=1` plus an explicit R2 lane is fail-closed and cannot cross-authorize the generic decoder.
