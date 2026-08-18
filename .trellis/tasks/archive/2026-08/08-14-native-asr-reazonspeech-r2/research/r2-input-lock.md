# ReazonSpeech R2 formal input lock

## Status and boundary

Candidate identity: `R2-vad12-pad30-overlap-top-level-v1`.

This lock freezes the Step 2-7 development/evidence worker, task-local acquisition runner and sanitized publisher. Step 7 tooling is implemented and dry-validated, but no formal short/medium/long-v2 model inference, raw index or publication has been produced yet; those remain Step 8 work. This does not authorize Release/default routing, runtime/VAD packaging, Git staging or commit. Reazon native remains development-only behind `HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT`; Python legacy remains the product default.

Private absolute paths, models, audio, VAD bytes, runtime/build outputs, raw text and stderr remain below ignored `research/local/` roots. Paths below are repository-relative roles only.

## Baseline and reviewed gate

| Input | Bytes | SHA-256 |
|---|---:|---|
| T10 R1 publication | 10,349 | `ca7512e91b8b69197ff22acbcb5f5b45434c4b5c9b92c1307e479d6a50d246af` |
| T10 input lock | 5,091 | `e342111bdc2cac5e0af6bc013a718f324cdc845577d587484020734db54ad9bd` |
| R2 oracle lock | 8,170 | `1e18ceb549e3586e248347dd3e856a908862c9716ff2fa625a3479547fb90d3a` |
| R2 oracle report | 4,438 | `9fe09cfd4ff0e88ee57f69cacde417f79d90132b775c7186e95371f9bec2aca3` |

R1 remains `R1-window15s-top-level-v1`: short CER/gaps `0.2250 / 1`, medium `0.377143 / 22`, and long-v2 a valid structured zero-duration top-level failure at `[345000,360000]ms`.

The reviewed source-only R2 gate remains partial and non-dispositive: short `0.266667 / 1`, medium `0.295385 / 19`, zero timeline errors, classification `promising`.

## Authoritative corpus and comparator

| Input | Bytes | SHA-256 |
|---|---:|---|
| T01 manifest | 2,868 | `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` |
| shared comparator `scripts/asr-benchmark.py` | 101,313 | `b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822` |
| protocol-v1 limits | 262 | `435c4eb649dc7e8939c38fc0eb778d2428bf2646a028abfe636c62f43302b464` |
| short-v1 WAV | 771,728 | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` |
| medium-v1 WAV | 15,963,982 | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` |
| long-v2 WAV | 132,615,588 | `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e` |

Reference text, segments and confirmed-speech intervals are derived in memory by the shared T01 implementation. Python ASR output is not an input.

## Pinned source and runtime

- Repository base commit before the task-local worktree changes: `b292dd4a848e0846fe3a54a2dcd546d3d5b07f86`.
- CrispASR `v0.8.22`, commit `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`.
- ggml submodule `bfe8ea228d8134d03641c9fcf233a9931f3730de`.
- c2pa-audio submodule `e40329b83f16f67bb5ddc7bb13ae18de0a9376fc`.
- CTranslate2 `4.8.0`, commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698` (worker linkage only; the Reazon inference route remains CrispASR).

| Input | Bytes | SHA-256 |
|---|---:|---|
| reviewed CUDA `crispasr.dll` | 11,414,528 | `824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e` |
| ReazonSpeech v2 Q8_0 | 667,147,072 | `20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2` |
| canonical `ggml-silero-v6.2.0.bin` | 885,098 | `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` |

The runtime was directly verified to export `crispasr_vad_slices` and `crispasr_vad_free`. The VAD asset is copied only into the ignored development worker directory after CMake revalidates its size/hash; no downloader, installer or runtime-pack route is added.

Open params remain ABI 2, 16 threads, CUDA `use_gpu=1`, `n_gpu_layers=-1`, backend preference `cuda`, logical backend `parakeet`, language `ja`. Development device remains CUDA device 0, `NVIDIA GeForce RTX 3070`, compute capability `8.6`, driver API `13020`; this is not formal device qualification. Restricted PATH roles remain `runtime-bin -> CUDA 12.8 bin -> System32`, with the module identities frozen by the oracle lock.

## Frozen R2 algorithm

```text
threshold=0.5
minSpeechMs=250
minSilenceMs=100
speechPadMs=30
coreMaxSliceDurationMs=12000
paddedMaxInferenceWindowMs=12060
maximumPaddedInferenceWindowSamples=192960
maximumAdjacentNativePaddingOverlapMs=60
windowOrder=strictly increasing starts and ends
nonAdjacentOverlap=false
sessionReuse=true
sourceSegmentsPerWindow=1
cueMapping=one legal top-level result -> one cue
maxCueCodePoints=96
maxCueDurationMs=15000
```

The worker calls `crispasr_vad_slices` once, then `crispasr_session_transcribe_lang` exactly once per returned window on the same session. Before every Reazon transcribe call it clears inherited `CRISPASR_PARAKEET_*`, sets `CRISPASR_PARAKEET_STREAM_THRESHOLD=13`, sets `CRISPASR_SESSION_UNIFIED_DISPATCH=0`, and rejects windows above `192960` samples. The pinned legacy inline branch therefore selects direct `parakeet_transcribe_ex`; null is a structured failure with no reactive streamed fallback.

Only adjacent overlap produced by the ABI's final `30ms` padding is accepted, bounded to `60ms`. Gaps are legal. Clamp, fixed-window fallback, caller-created overlap, ownership rewrite, dedup, stitching, gap-fill, decoder/beam search, punctuation post-processing, synthetic timing and reference/Python repair are absent.

## Source identities

| Source | Bytes | SHA-256 |
|---|---:|---|
| `native-asr/CMakeLists.txt` | 28,548 | `f17609595baee3a02fd40a2a5cd2b0d574cf3fbb03586e779f187b27db7340c5` |
| `src/crispasr_backend.hpp` | 2,859 | `26d74dfc51864495a128e6494223e21b01a74347234d85e29ea67d149f6a3ca7` |
| `src/crispasr_backend.cpp` | 36,977 | `fb26ed97c5bb749f0a97c365245c55d7d6c5e9d61bbf1a2741ea619ae86d5a69` |
| `src/parakeet_family_policy.hpp` | 768 | `6cb11b8d5147b74bdbd435816667b1d75df6683fe6512f81b57fd5a86b3f7f8f` |
| `src/parakeet_family_policy.cpp` | 9,397 | `2821024d48361a0362531c2d8764e72c2092d06067a62af5e4a7a17e8dfda35f` |
| `src/main.cpp` | 21,167 | `8dc87972957d0f371e8ca74df871701277cacb9fe88fc459dabe9245d557a4c4` |
| `tests/crispasr_backend_tests.cpp` | 21,620 | `f8467a06dc9a091c0605c2d9be940a6a58351e3da125814f6217016fb72182ad` |
| `tests/parakeet_family_policy_tests.cpp` | 9,557 | `e1ea35e70076aa8e63f58ac712453b5cb7e08dd3c1ff62c378066327bba513cf` |
| `tests/fake_crispasr_abi.cpp` | 16,489 | `00d813300359d75b4419c79067912350f1e2b949ec695215533f396f8b24e60c` |
| `tests/crispasr_worker_contract_tests.cpp` | 15,741 | `f581b50310ae47c0756a3cd4985566a938eecf5320228f818c04fccee3bba98c` |
| `tests/crispasr_development_runner.cpp` | 28,048 | `012337ef18ada72fba7470504165c0a81ebffd1fa52d4f0558150b90c0b4ffbb` |

Any source change invalidates the binary rows below and requires rebuilding/relocking before Step 7.

## Toolchain and ignored build identity

- Visual Studio 2026 Community `18.2.0` developer environment.
- MSVC compiler `19.50.35722.0`, tools directory `14.50.35717`.
- CMake `4.1.1-msvc1`.
- Ninja `1.12.1`.
- Rust/Cargo `1.96.0` (`rustc ac68faa20`, `cargo 30a34c682`) for the locked offline tokenizer build.
- Build type `Release`; generator `Ninja`; CMake compatibility override `CMAKE_POLICY_VERSION_MINIMUM=3.5` is command-line-only for the pinned CTranslate2 dependency.

Ignored `research/local/r2-worker-init.cmake` is 614 bytes, SHA-256 `11ebf503ef3cb846aee577aa6ebfae701dafabb915631ff5984460bae253440f`. It sets exactly: `CMAKE_BUILD_TYPE=Release`, `HIKARU_ASR_BUILD_CT2_WORKER=ON`, `HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=ON`, and the reviewed CrispASR runtime file/size/SHA-256 cache entries.

| Ignored build output | Bytes | SHA-256 |
|---|---:|---|
| development `hikaru-asr-worker.exe` | 623,616 | `e86c199e8a01cfead31d36f34d576fe89be52e0fd6f3d29163383ee94023c274` |
| `hikaru-asr-crispasr-development-runner.exe` | 325,120 | `5938f301ac3b7033ddb97e2e5cffb2a4869d7a9934b36135568f26c21e8537da` |
| fake-ABI contract worker | 621,568 | `02dfb3e5d33d2abee4a222307521eebc4f35918cc8b601c796d175b9747664f9` |
| production-VAD identity contract worker | 623,616 | `e86c199e8a01cfead31d36f34d576fe89be52e0fd6f3d29163383ee94023c274` |
| copied sibling VAD | 885,098 | `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` |

The canonical active T10R local root is `.trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/`. Existing T09/T10 root definitions remain present. The repository ignore rule also covers the prospective archive spelling.

## Step 6 Rust-host manifest and validation identity

> Final Step 6 boundary: the rows below bind worker identity `623,616 / e86c199e8a01...` and the separate R2-only required manifest/lane decoder. The pre-existing generic `HIKARU_ASR_CRISPASR_INPUTS` decoder remains unchanged for T09/T10 Parakeet/Qwen/Reazon tests and cannot be cross-authorized by R2 inputs.

Step 6 replaces the earlier one-scenario/self-attested Rust-host JSON with one ignored manifest whose exact bytes are source-bound by `src-tauri/src/asr_worker.rs` and validated again by the tracked runner/publisher.

| Input | Bytes | SHA-256 |
|---|---:|---|
| ignored `research/local/r2-step6-manifest.json` | 15,483 | `aa28e40c65c029c2c7c651121606f9334daddf21ee839c59954455d3bb5bb33c` |
| `src-tauri/src/asr_worker.rs` | 137,329 | `ac05576f96fbdffb74cd74c100a009e9194649e94fc42a119afd99b33925647e` |
| `research/run_r2_step6_validation.py` | 11,055 | `1082e5e287d9b8bf5287db2fd533d6f1991046efa8670d0ffcb822feb08162ac` |
| `research/publish_r2_step6.py` | 17,445 | `40c6b32130781dc35c8d786b489c7ba64b97832f9d40fe7d299e3f3c6efddf34` |
| `research/test_publish_r2_step6.py` | 3,700 | `6f1b3ccbe915aeb45e5f9673a564ce8036cd6eb289cb7f13f517fe02673c053c` |
| ignored validation index | 28,343 | `81a0987bbbb1adac7fef7975aecbee324a559e1b24e4dd9271b2530d35e4d2f7` |
| tracked `research/r2-step6-report.md` | 5,320 | `8a6d1ffa07457e5b7ecdff4ae2bf3ced3509684d676a89bdfcf78904823de72f` |

The source-bound manifest contains only safe repository-relative paths and locks every role below by byte size and SHA-256. A manifest mutation requires a reviewed Rust source/hash change; expected progress/errors cannot be promoted by editing ignored JSON alone.

| Manifest role | Bytes | SHA-256 |
|---|---:|---|
| `canonical-vad` | 885,098 | `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` |
| `contract-runtime-crispasr.dll` | 37,376 | `1885f92435b832857a21aa730001c6c69786f4e7d4db93f0c595fceb96a200a3` |
| `contract-runtime-ctranslate2.dll` | 22,417,408 | `4d469986c3d5977053707c4f3b9b63aabd0ad92a60d992f9accbdd409b576423` |
| `contract-runtime-hikaru_asr_tokenizer.dll` | 2,137,088 | `935c0982c79de1a517833ffc2527e62ea92547f0b600becfcfad7ecbc5dd1cf4` |
| `contract-runtime-onnxruntime.dll` | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| `contract-runtime-onnxruntime_providers_shared.dll` | 21,856 | `599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8` |
| `contract-vad` | 3 | `651bfad0aa5b42c5a5b8dad76f49c4a122fe1d1658fc55cfdd1ea9923fe3fd9e` |
| `contract-worker` | 621,568 | `02dfb3e5d33d2abee4a222307521eebc4f35918cc8b601c796d175b9747664f9` |
| `medium-cancel-audio` | 15,963,982 | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` |
| `policy-empty-model` | 5 | `9372c470eeadd5ecd9c3c74c2b3cb633f8e2f2fad799250a0f70d652b6b825e4` |
| `production-runtime-crispasr.dll` | 11,414,528 | `824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e` |
| `production-runtime-ctranslate2.dll` | 22,387,712 | `d64a00675e180fea28b3561ab749325df1586b618589842d481a5f0c4d71e82e` |
| `production-runtime-cublas64_12.dll` | 113,716,224 | `9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99` |
| `production-runtime-cublaslt64_12.dll` | 674,667,520 | `b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7` |
| `production-runtime-cudart64_12.dll` | 573,952 | `c2c9a9c22a9bcba90e261825968836787b331038047a26770cffb7a583c28344` |
| `production-runtime-ggml-base.dll` | 628,224 | `728a10b11f0bc29588f718b94e32984b322b587b154ef18e6f6f31d8cd2f0368` |
| `production-runtime-ggml-cpu.dll` | 889,344 | `0182b8c87b076dbdf1f7c082bebf43aaff724f4b15dd281820e5e2be939e67cd` |
| `production-runtime-ggml-cuda.dll` | 51,625,472 | `a75099a7e622282dae28451327c682bd17df147728c9c009b9f44eb3f1c99fa2` |
| `production-runtime-ggml.dll` | 67,072 | `a1cc4c81000735eb4c167926b492e07ba49d03eb6f47a70d3fe2a0b30f648478` |
| `production-runtime-hikaru_asr_tokenizer.dll` | 2,139,136 | `6a4c575ab8c3d94840d9a71005053ea40bee5632662f66214f9985fff6dc57e3` |
| `production-runtime-onnxruntime.dll` | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| `production-runtime-onnxruntime_providers_shared.dll` | 21,856 | `599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8` |
| `production-worker` | 623,616 | `e86c199e8a01cfead31d36f34d576fe89be52e0fd6f3d29163383ee94023c274` |
| `protocol-invalid-model` | 5 | `9372c470eeadd5ecd9c3c74c2b3cb633f8e2f2fad799250a0f70d652b6b825e4` |
| `reazon-q8-model` | 667,147,072 | `20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2` |
| `short-audio` | 771,728 | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` |
| `silent-20s-audio` | 640,044 | `fe04e06676e54a18bce6696508d2696394f172b365445e1f2eb969dc0a10f163` |
| `silent-2s-audio` | 64,044 | `20eaebffe1816e0ffa6f7f854f5ef4ea80d5349faaf0ce1fec1b713e7fde58fa` |

The six explicit invocations are frozen as follows:

| Lane | Worker/device | Ready duration | Progress contract | Result/error |
|---|---|---:|---|---|
| `success` | production / CUDA | 24,102ms | exact `10260, 14080, 24102` | completed |
| `pre-ready-negative` | production / CUDA | none | none | `crispasr_vad_model_invalid` |
| `post-ready-vad` | production / CUDA | 2,000ms | none | `crispasr_vad_no_result` |
| `post-ready-protocol` | fake-ABI contract / CPU | 20,000ms | exact `12060, 20000` | `invalid_segment` |
| `post-ready-policy` | fake-ABI contract / CPU | 20,000ms | exact `12060, 20000` | `parakeet_family_invalid_input` |
| `cancellation` | production / CUDA | 498,872ms | strict positive prefix beginning `11150` | cancelled |

Ordinary generic tests still skip when optional `HIKARU_ASR_CRISPASR_INPUTS` is absent. Required R2 evidence invocations instead set `HIKARU_ASR_R2_STEP6_REQUIRED=1`, `HIKARU_ASR_R2_STEP6_MANIFEST` and one explicit `HIKARU_ASR_R2_STEP6_LANE`; missing/partial R2 configuration fails rather than skipping. Regression tests prove generic Parakeet/Qwen decoding remains available and neither decoder accepts the other decoder’s bytes or environment as authorization. Each invocation now writes a digest-bound header before Cargo output with the exact lane, command/test filter, required environment, scenario, manifest hash and expected contract, then the Rust test emits one aggregate observed outcome record. The publisher independently recomputes both identities, requires distinct lane paths/hashes/header digests, derives the tracked matrix from observed records, and rejects lane swap, command/environment mutation, duplicated protocol-as-policy evidence and header/log mismatch. No formal benchmark inference is part of Step 6.

## Step 7 acquisition and publication tooling

The following machine-readable object is the single reviewed formal-tool authority. Both acquisition and publication parse it and verify every byte identity before reading staged audio/model/runtime data or ignored raw evidence.

<!-- R2_FORMAL_TOOL_IDENTITIES_BEGIN -->
{"native-asr/include/hikaru_asr/protocol.hpp":{"sha256":"3d339fa0fbc15193d6f64cc165d79945da478e2b73efe7856e93cfa7b1f6dbe5","sizeBytes":2834},"native-asr/protocol-v1-limits.json":{"sha256":"435c4eb649dc7e8939c38fc0eb778d2428bf2646a028abfe636c62f43302b464","sizeBytes":262},"native-asr/src/protocol.cpp":{"sha256":"2b80ee8c6bdbcd43e72a868887f8feb94140f9e0c13bedf68de1b47895fcca3f","sizeBytes":26277},"research/publish_reazonspeech_r2.py":{"sha256":"96936767759df2576a7058b96d9d7d64103bec08c6b777b44fdf6c00b823fb49","sizeBytes":57392},"research/run_r2_oracle.py":{"sha256":"db059bcb798f0f70ef963db68af992bf43f46b5dfc3833e4279aefe521464bef","sizeBytes":25741},"research/run_reazonspeech_r2.py":{"sha256":"c3f6439d2cc708f4ab48713249056eab7f30e392e8a6ca60b52a69292416a5b7","sizeBytes":53869},"scripts/asr-benchmark.py":{"sha256":"b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822","sizeBytes":101313}}
<!-- R2_FORMAL_TOOL_IDENTITIES_END -->

All private staging remains under ignored `research/local/formal/`. Before resolving any private path, the runner walks from the filesystem anchor through every existing lexical component of the approved root, then every existing root-to-target component, rejecting symlink/reparse/junction attributes before canonical containment and Git-ignore checks. Ordinary drive/root anchors and nonexistent final targets remain valid. The same contract covers staging, raw, stderr, indexed raw rows and interrupted temporary writes. Real Windows tests cover a junction used as the approved root, a descendant junction, and an ordinary approved directory below a junctioned ancestor; none can redirect a write outside `research/local/`. `prepare` hard-links or copies only identity-verified worker/runtime/model/VAD/audio inputs into that root. `dry-run` executes only the pinned VAD planner and does not open the ReazonSpeech model or invoke the worker. Every formal `acquire` invocation starts one fresh real worker process with the exact protocol-v1 request and restricted `runtime-bin -> CUDA 12.8 bin -> System32` PATH.

| Tracked tool | Bytes | SHA-256 |
|---|---:|---|
| `research/run_reazonspeech_r2.py` | 53,869 | `c3f6439d2cc708f4ab48713249056eab7f30e392e8a6ca60b52a69292416a5b7` |
| `research/publish_reazonspeech_r2.py` | 57,392 | `96936767759df2576a7058b96d9d7d64103bec08c6b777b44fdf6c00b823fb49` |
| `research/test_publish_reazonspeech_r2.py` | 40,541 | `7aa42635f76a5e26ff23355ab23fcceb4b41b6c67137f0f6cfa50c74aae91f2d` |

The runner records complete hashed protocol lines with arrival times, strict event order, progress endpoints, one atomic replacement or candidate-caused structured failure, independently planned VAD windows and their canonical hash, worker/module/PATH/device identities, process/inference wall time, peak working set, actual transcribe attempts/completions, attempted-through frontier and partial/full RTF scope. The first formal cold attempt was rejected before raw publication because the harness treated staged `onnxruntime_providers_shared.dll` as necessarily loaded; the corrected lock follows the existing runtime contract that this companion is identity-verified and staged but may remain unloaded, while every actually required worker/CUDA module is still mandatory and hash-bound. The superseded long-v2 failure came from converting the same ABI float endpoints separately to samples and milliseconds. The corrected worker, oracle and harness canonicalize each endpoint once to integer milliseconds, then derive samples as `ms * 16`; the real `[510970,522930]ms` / `[522870,533630]ms` pair is therefore a legal `60ms` overlap, while `61ms`, `12061ms`, non-adjacent and out-of-audio windows still fail closed. A development/evidence-only stderr trace contains no transcript text: it records child CUDA/device-environment attestation plus per-window source timing, UTF-8 byte counts and SHA-256 values before policy assembly. The publisher re-parses those ignored bytes, requires one source result per completed VAD window, matches each source result to its exact final cue/window, and proves source/final byte conservation and atomic replacement equality. Protocol accepted state remains preview-free and unchanged.

The publisher independently validates every indexed row, rejects mixed identity/roles/status/event/window/config/module/request/hash/path evidence, and recomputes T01 CER/timeline/semantic/excluded gaps, cue/window/protocol/performance gates, absolute `qualityDisposition`, R1-relative `relativeSelection`/reasons and anti-regression findings. R5 is applied exactly: completed output must satisfy all timeline/cue/protocol safety gates. `crispasr_result_invalid` is never exempted by code equality alone. The R1 authority is independently derived from its immutable ignored raw row as `zero_duration_top_level_result` at zero-based window `23` (24th window), `[345000,360000]ms`, local `14800..14800`, result-trace SHA-256 `3bfbc7e4f380eea9c5f7940def40e576dcb80caa458f093bef247eca6c76889b`, fingerprint `6c76aa3a15660de07b377754a75c9938add1a71edb58d3b1a988ab5c75935716`. The only reviewed R2 same-class exemption is zero-based window `61` (62nd window), `[763590,768570]ms`, local `2160..2160`, result-trace SHA-256 `f3179c7ab489bfcc211b4779fa15fb481354850dd08cbf2286b64c00f13c45bb`, fingerprint `35b1f992ca3619d7e985ee3e9bb33f01280bed48829766bafbe01ee1892dc93e`; any subtype/range/timing/hash/fingerprint drift blocks every relative reason. Short/medium still block only when CER regresses by more than `0.02` together with more semantic gaps. Tracked output is sanitized and deterministic; raw text, requests, paths, errors and stderr stay ignored.

This file is the acquisition-bound input lock. Final raw-index/publication/report/handoff identities are recorded in `research/final-attestation.md` after acquisition so this lock is never edited after its bytes are embedded in formal rows. Exact commands are:

```bash
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py prepare
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py dry-run --case short-v1

python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case short-v1 --run-kind cold --repeat-index 0
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case short-v1 --run-kind warm --repeat-index 1
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case short-v1 --run-kind warm --repeat-index 2
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case short-v1 --run-kind warm --repeat-index 3
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case medium-v1 --run-kind measured --repeat-index 0
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case long-v2 --run-kind measured --repeat-index 0

python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/publish_reazonspeech_r2.py --build-index --raw-index .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/r2-raw-index.json --evidence-output .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/evidence/reazonspeech-r2.json --report-output .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/reazonspeech-r2-report.md --handoff-output .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/reazonspeech-r2-handoff.md
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/test_publish_reazonspeech_r2.py
```

After acquisition, run the publisher command twice and compare the raw index plus all three tracked outputs byte-for-byte before accepting the publication. Record those final identities only in `research/final-attestation.md`; any worker, runner, publisher, input-lock, model/runtime/VAD, manifest/comparator or source change invalidates the affected rows.

## Sampling and decisions reserved for later steps

Formal sampling remains short-v1 `1 cold + 3 warm fresh processes`, medium-v1 `1 fresh`, long-v2 `1 fresh`, all under this one identity even after an earlier quality failure.

Absolute qualification remains CER `<=0.35`, accelerated RTF `<=0.5`, short cold wall `<=120s`, CrispASR RSS `<=12 GiB`, zero invalid/timeline/protocol/cue failures and zero semantic gaps `>=1500ms`.

Relative selection remains independent: long-v2 completion, any completed-case CER improvement `>=0.02`, medium gaps `22 -> <=17`, or short gaps `1 -> 0`, without a new failure or a simultaneous `>0.02` CER regression plus more gaps on short/medium.

No formal matrix row or candidate disposition is published by this lock.
