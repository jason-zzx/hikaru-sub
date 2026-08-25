# T06R GPU exact-VAD diagnostic lock

## Status and authorization

Frozen after the first six-cell GPU diagnostic published `no-candidate-selected` and after the user explicitly approved one second diagnostic. This lock is written before the first model load for the second diagnostic.

Only two selection-only rows are authorized. Both have `qualificationEligible=false` and can never be promoted into formal evidence:

| Cell | Case | Beam | Previous text | VAD |
|---|---|---:|---|---|
| `short-b5-vad` | short-v1 | 5 | off/immaterial for the one source window | exact faster-whisper 1.2.1 Silero V6 |
| `medium-b5-on-vad` | medium-v1 | 5 | on | exact faster-whisper 1.2.1 Silero V6 |

Timestamp-driven seek, temperature 0, existing no-speech thresholds, exact timestamp parsing/deduplication, CUDA device 0/FLOAT16 and every other ordinary value remain fixed. No other beam, history, prompt, word timestamp, overlap, VAD parameter, fallback or post-processing value is authorized.

## Prior diagnostic authority

| Input | SHA-256 |
|---|---|
| first diagnostic lock | `31de7362d7d82a32bec81341909131a085c989cabec763c40287e44964832621` |
| first diagnostic publication | `49e6add03a2630298df3b673a0ddfb3c0b0ad1ee65a822df62ef482b2fb5177f` |

The first diagnostic selected no beam/history-only pair. Its rows remain immutable and are not inputs that can be copied into this diagnostic.

## Corpus and comparison authority

| Input | SHA-256 |
|---|---|
| `.asr-benchmark/manifest.json` | `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` |
| `scripts/asr-benchmark.py` | `2e0dbee811f28e18dd1d5d29bb9ed50ab5ed028004adf1820665a128a813c45c` |
| Python legacy baseline | `c6142c40daf9c45c1d39d3612833c386fc71080866148d9b9719e428787979ef` |
| model identity manifest | `7b46e0a983b7cc71e302e898d3f90d77b3c9159be2fe538585cd038e31c0a8f0` |

Corpus identity is `hikaru-user-ja-ground-truth-v1`:

| Case | Duration ms | Samples | WAV SHA-256 | ASS SHA-256 |
|---|---:|---:|---|---|
| short-v1 | 24,102 | 385,637 | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` | `60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b` |
| medium-v1 | 498,872 | 7,981,952 | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` | `d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e` |

The local ASS remains the only text/timeline truth. Python output is comparison input only and may not create or repair candidate output.

## Selection rule

Both exact rows must independently be no worse than the matching `faster-whisper/large-v3 × case × python-legacy-cuda-v1` row for CER, substitutions, deletions, insertions, empty text, semantic-gap count and semantic-gap duration. Both must also pass GPU inference RTF `<=0.5`, short process wall `<=120000ms`, peak RSS `<=6GiB`, zero timeline errors, exact VAD restoration provenance, and all identity/path/privacy gates.

If both rows pass, select exactly beam 5/history on/exact Silero V6 as formal-candidate input. Otherwise publish `no-candidate-selected` and return to planning. In either outcome these raw rows remain diagnostic-only and require a new lock, rebuild and rerun before formal evidence.

## Model identity

Only `Systran/faster-whisper-large-v3@edaa852ec7e145841d8ffdb056a99866b5f0a478` is allowed:

| File | Bytes | SHA-256 |
|---|---:|---|
| config.json | 2,394 | `a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9` |
| model.bin | 3,087,284,237 | `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` |
| preprocessor_config.json | 340 | `7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711` |
| tokenizer.json | 2,480,617 | `6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca` |
| vocabulary.json | 1,068,114 | `c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1` |

## Exact VAD identity

The only VAD is the maintained faster-whisper 1.2.1 Silero V6 asset and algorithm already implemented in the native backend:

| Asset | Bytes | SHA-256 |
|---|---:|---|
| silero_vad_v6.onnx | 1,245,151 | `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2` |

Frozen behavior: PCM16 `/32768.0`, 512 samples plus 64 previous-context samples, recurrent h/c, at most 10,000 rows per ORT call, threshold `0.5`, negative threshold `0.35`, minimum speech `0ms`, infinite maximum speech, minimum silence `2000ms`, speech pad `400ms`, source-ordered compression and integer half-even 10ms timestamp restoration. ONNX Runtime is exactly `1.28.0` CPU execution; no fallback is allowed.

## Build and runtime identity

Build: MSVC `19.44.35221.0`, CMake `4.1.1-msvc1`, Ninja, CTranslate2 `4.8.0` commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`, CUDA toolkit `12.8.93`, `sm86`, dynamic CUDA loading, no cuDNN. The task-local preset reuses the exact reviewed T07 CT2 CUDA shared/import library and rebuilds only Hikaru sources.

| Runtime file | Bytes | SHA-256 |
|---|---:|---|
| hikaru-asr-worker.exe | 490,496 | `aec9e98c8a0df14ee1da2aaadd568e1f97fd047ae44ea55bc190698997d83872` |
| hikaru-asr-ctranslate2-tests.exe | 872,448 | `e17379f1992633a353c6122367a5bcaf4fbf7ba5c666a349e240aae44e516b49` |
| ctranslate2.dll | 36,974,592 | `e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2` |
| hikaru_asr_tokenizer.dll | 2,139,136 | `88d48a223b07df65a99ec87e0fbe600a4f5630b30fba488c66ed2c8761268aef` |
| onnxruntime.dll | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| onnxruntime_providers_shared.dll | 21,856 | `599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8` |

Restricted PATH roles are exactly task-local runtime bin, CUDA 12.8 bin, and Windows System32. Root identity SHA-256 is `8866553cc6616ec76f152177b69c5161e0aa5dec0c13519eb65b654afa3c66f6`.

GPU identity: NVIDIA GeForce RTX 3070, device 0, compute capability 8.6, driver 596.49, driver API 13020, driver module 32.0.15.9649.

Expected loaded-module identities include:

| Module | Root role | Bytes | SHA-256 |
|---|---|---:|---|
| hikaru-asr-ctranslate2-tests.exe | task-local-runtime-bin | 872,448 | `e17379f1992633a353c6122367a5bcaf4fbf7ba5c666a349e240aae44e516b49` |
| ctranslate2.dll | task-local-runtime-bin | 36,974,592 | `e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2` |
| hikaru_asr_tokenizer.dll | task-local-runtime-bin | 2,139,136 | `88d48a223b07df65a99ec87e0fbe600a4f5630b30fba488c66ed2c8761268aef` |
| onnxruntime.dll | task-local-runtime-bin | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| vcomp140.dll | windows-system32 | 213,064 | `31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7` |
| nvcuda.dll | windows-system32 | 4,466,920 | `ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c` |
| cublas64_12.dll | cuda-toolkit-12.8-bin | 113,716,224 | `9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99` |
| cublasLt64_12.dll | cuda-toolkit-12.8-bin | 674,667,520 | `b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7` |

Unexpected cuDNN, missing ORT, path-root drift, module/hash drift, or device/config drift invalidates the row.

## Source and publisher identity

| File | SHA-256 |
|---|---|
| native-asr/CMakeLists.txt | `b56aa58d4570554b41bd2bcaf5407c4a32d90511f415b64332d1c456b958b040` |
| native-asr/CMakePresets.json | `e2ba57d93e5d52700b92720be02faada1867a59a5b91c9d58f823190191787ee` |
| native-asr/src/ctranslate2_whisper.hpp | `caa9755800cbf04bfe331cd051479e2035b463f170deb0f4fc4f6771f9d450e6` |
| native-asr/src/ctranslate2_whisper.cpp | `f00ca962c2d540c7fc5714bd0005eb7cbf0744ec887ffe079795f7b70bf7d17a` |
| native-asr/src/main.cpp | `c0440ec5ae31dc6be836b2d40b8941a5f17dab6206bfea8100b734e674832e42` |
| native-asr/tests/ctranslate2_whisper_tests.cpp | `fd1349c24436fc4aa341b379a50474e1d6cc3297f0fd0007327aacb3e2520917` |
| native-asr/tokenizer-ffi/Cargo.lock | `6fbcf8227058918337c2b827243d08e13f7aafa72aa7531d25bd6462b4ce79b7` |
| native-asr/tokenizer-ffi/src/lib.rs | `3bba3b26765cb8277c302db5e72353fc673d1133fd0d78a59c46792803aaebcc` |
| research/publish_whisper_gpu_quality.py | `ce195b68bb0f501aa7f37e51ec816c75f15ec6d163ec16b2e3a505a2e4dfe7ae` |
| research/test_publish_whisper_gpu_quality.py | `56b69f4b5d8f001d38b3bc750cee7c66f26c868dd7aaa19bda3be340dcc11010` |

Any change to these files, the runner/worker/runtime, corpus, model, VAD asset, CUDA/PATH/module identity, or publisher requires a rebuild and new lock before another second-diagnostic model load.

## Failure, privacy and publication policy

Each cell runs once in a clean process. An identity-valid candidate-caused structured failure with one complete matching final failed trace is a valid non-selected diagnostic row. Identity drift, incomplete trace, external termination, publisher failure, or non-atomic output is invalid and must be repaired and rerun.

Raw segments, tokens, traces, module paths, audio, ASS, binaries, models and VAD data remain below the ignored task-local `research/local/` root. Tracked output contains only identities, hashes, aggregate metrics, sanitized VAD counts and disposition. The publisher independently recomputes CER/timeline/gaps and compressed-to-source restoration; it rejects first-diagnostic/formal kinds, promotion, unknown fields, private paths and copied mutable metrics.
