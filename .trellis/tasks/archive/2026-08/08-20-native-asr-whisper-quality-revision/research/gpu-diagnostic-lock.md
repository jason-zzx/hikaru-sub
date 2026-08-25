# T06R GPU diagnostic lock

## Status

Re-frozen before any diagnostic row under this lock. The first lock allowed only completed diagnostic samples; the first `medium-b1-on` attempt produced a complete identity-valid `timestamp_after_audio` failure and exposed that publisher contract defect. The second lock accepted a failed envelope but did not admit its exact final `parseStatus=failed` trace. The publisher and tests now require exactly one final failed trace whose `parseError` matches the envelope code. Every row acquired under either superseded lock is invalid for selection and must be rerun. This lock still authorizes only six selection rows on the existing RTX 3070 CUDA development lane. Every row is `qualificationEligible=false`; no row may be promoted into the formal large-v3/large-v2 matrix.

## Authority

| Input | SHA-256 |
|---|---|
| `.asr-benchmark/manifest.json` | `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` |
| `scripts/asr-benchmark.py` | `2e0dbee811f28e18dd1d5d29bb9ed50ab5ed028004adf1820665a128a813c45c` |
| Python legacy baseline | `c6142c40daf9c45c1d39d3612833c386fc71080866148d9b9719e428787979ef` |
| model identity manifest | `7b46e0a983b7cc71e302e898d3f90d77b3c9159be2fe538585cd038e31c0a8f0` |
| T07 CUDA module lock | `8c8dba3bec12d6b87c08c4df3ee886f0d87aff36a5dff5eb33aa96ae19004a45` |

Corpus identity is `hikaru-user-ja-ground-truth-v1`:

| Case | Duration ms | WAV SHA-256 | ASS SHA-256 |
|---|---:|---|---|
| short-v1 | 24,102 | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` | `60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b` |
| medium-v1 | 498,872 | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` | `d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e` |

## Closed matrix and selection

| Cell | Case | Beam | Previous text |
|---|---|---:|---|
| `short-b1-off` | short-v1 | 1 | off |
| `short-b5-off` | short-v1 | 5 | off |
| `medium-b1-off` | medium-v1 | 1 | off |
| `medium-b1-on` | medium-v1 | 1 | on |
| `medium-b5-off` | medium-v1 | 5 | off |
| `medium-b5-on` | medium-v1 | 5 | on |

Each cell runs once in a clean process on CUDA device 0/FLOAT16. Timestamp-driven seek, temperature 0, existing no-speech thresholds, exact dedupe, 30-second model windows, no VAD, and all other ordinary defaults are fixed.

A beam/history pair is eligible only when its matching short row and exact medium row are each no worse than the same-model/same-case `python-legacy-cuda-v1` row for CER, S/D/I, empty text, semantic-gap count, and semantic-gap duration, and both pass GPU RTF `<=0.5`, short process wall `<=120000ms`, RSS `<=6GiB`, and zero timeline errors. Select lowest medium GPU inference RTF, then lower beam, then history off. If none passes, publish `no-candidate-selected` and return to planning.

## Model identity

Only `Systran/faster-whisper-large-v3@edaa852ec7e145841d8ffdb056a99866b5f0a478` is allowed:

| File | Bytes | SHA-256 |
|---|---:|---|
| config.json | 2,394 | `a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9` |
| model.bin | 3,087,284,237 | `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` |
| preprocessor_config.json | 340 | `7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711` |
| tokenizer.json | 2,480,617 | `6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca` |
| vocabulary.json | 1,068,114 | `c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1` |

## Runtime identity

Build: MSVC `19.44.35221.0`, CMake `4.1.1-msvc1`, Ninja, CTranslate2 `4.8.0` commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`, CUDA toolkit `12.8.93`, `sm86`, dynamic CUDA loading, no cuDNN. The T06R preset reuses the exact T07 CT2 CUDA shared library/import library and rebuilds only the Hikaru backend, worker, tokenizer and runner.

| File | Bytes | SHA-256 |
|---|---:|---|
| hikaru-asr-worker.exe | 490,496 | `aec9e98c8a0df14ee1da2aaadd568e1f97fd047ae44ea55bc190698997d83872` |
| hikaru-asr-ctranslate2-tests.exe | 829,440 | `d6d2c1d89afff3e4b7d3743d4b08138138ab0cc3a43f074c7ac9042a42165072` |
| ctranslate2.dll | 36,974,592 | `e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2` |
| ctranslate2.lib | 49,653,378 | `06075ad38a230ae3c1b2411a8733d441b8231b0bc79f49f33e05617f21ffe54e` |
| hikaru_asr_tokenizer.dll | 2,139,136 | `88d48a223b07df65a99ec87e0fbe600a4f5630b30fba488c66ed2c8761268aef` |
| onnxruntime.dll | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| onnxruntime_providers_shared.dll | 21,856 | `599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8` |

Restricted PATH roles are exactly task-local runtime bin, CUDA 12.8 bin, and Windows System32. Root identity SHA-256 is `8866553cc6616ec76f152177b69c5161e0aa5dec0c13519eb65b654afa3c66f6`.

GPU identity: NVIDIA GeForce RTX 3070, device 0, compute capability 8.6, driver 596.49, driver API 13020, driver module 32.0.15.9649.

Expected loaded modules include:

| Module | Root role | Bytes | SHA-256 |
|---|---|---:|---|
| hikaru-asr-ctranslate2-tests.exe | task-local-runtime-bin | 829,440 | `d6d2c1d89afff3e4b7d3743d4b08138138ab0cc3a43f074c7ac9042a42165072` |
| ctranslate2.dll | task-local-runtime-bin | 36,974,592 | `e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2` |
| hikaru_asr_tokenizer.dll | task-local-runtime-bin | 2,139,136 | `88d48a223b07df65a99ec87e0fbe600a4f5630b30fba488c66ed2c8761268aef` |
| onnxruntime.dll | task-local-runtime-bin | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| vcomp140.dll | windows-system32 | 213,064 | `31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7` |
| nvcuda.dll | windows-system32 | 4,466,920 | `ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c` |
| cublas64_12.dll | cuda-toolkit-12.8-bin | 113,716,224 | `9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99` |
| cublasLt64_12.dll | cuda-toolkit-12.8-bin | 674,667,520 | `b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7` |

Unexpected cuDNN, path-root drift, device/config drift, or module-set/hash drift invalidates the row.

## Source and publisher identity

| File | SHA-256 |
|---|---|
| native-asr/CMakeLists.txt | `b56aa58d4570554b41bd2bcaf5407c4a32d90511f415b64332d1c456b958b040` |
| native-asr/CMakePresets.json | `e2ba57d93e5d52700b92720be02faada1867a59a5b91c9d58f823190191787ee` |
| native-asr/src/ctranslate2_whisper.hpp | `caa9755800cbf04bfe331cd051479e2035b463f170deb0f4fc4f6771f9d450e6` |
| native-asr/src/ctranslate2_whisper.cpp | `f00ca962c2d540c7fc5714bd0005eb7cbf0744ec887ffe079795f7b70bf7d17a` |
| native-asr/src/main.cpp | `c0440ec5ae31dc6be836b2d40b8941a5f17dab6206bfea8100b734e674832e42` |
| native-asr/tests/ctranslate2_whisper_tests.cpp | `dd21ffe978eea3d91ad944e7565356febc94cd2f27e05d93d60e02289c153563` |
| native-asr/tokenizer-ffi/Cargo.lock | `6fbcf8227058918337c2b827243d08e13f7aafa72aa7531d25bd6462b4ce79b7` |
| native-asr/tokenizer-ffi/src/lib.rs | `3bba3b26765cb8277c302db5e72353fc673d1133fd0d78a59c46792803aaebcc` |
| research/publish_whisper_gpu_quality.py | `755a62ff883955c9f6843da236beff35aa0b0ec7b358e3f8071a3d36c7a3d409` |
| research/test_publish_whisper_gpu_quality.py | `1ec535c7fcb56e3718e59b5d98a8b1bfb21d77f2ac4c93047756723735554233` |

Any change requires a rebuild and new lock before another diagnostic model load.

## Privacy and failure policy

Raw segments, token traces, module paths, binaries, models, audio and ASS remain below the ignored T06R `research/local/` root. Tracked output contains only hashes, aggregate metrics, sanitized identities and disposition. A quality failure remains a valid diagnostic row; identity drift, incomplete trace, external termination, or publisher failure is invalid and must be rerun.
