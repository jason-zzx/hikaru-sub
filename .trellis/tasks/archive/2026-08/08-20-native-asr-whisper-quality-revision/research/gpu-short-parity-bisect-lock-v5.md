# GPU short input/runtime parity bisect lock v5

## Status and stop boundary

**Frozen Phase 3D v5 pre-model VAD lock-selection repair identity.** This lock does not authorize acquisition, Python Silero VAD inference, CTranslate2 Whisper/large-v3 construction, encode, generate, any parity cell, parser publication, parity attribution, quality/formal evidence, route/default changes, CPU inheritance, packaging, commit, push, or archive.

V5 changes only the task-local Python VAD preflight lock-selection seam and the matching task-local publisher/test identity. The tool accepts exactly the canonical task-research `gpu-short-parity-bisect-lock-v5.md`; v1-v4, unknown, cross-root, and malformed lock paths fail before faster-whisper or ONNX Runtime import. The v4 C++ runner/worker, both isolated CT2 roots, runtime-local `--vad-model` contract, backend fallback invariant, protocol, and product defaults are unchanged.

For unchanged v4 C++ no-model validation, machine field `supersedesLockSha256` remains the v3 harness-predecessor assertion already frozen by that binary. Publisher-authoritative `acquisitionSupersedesLockSha256` binds immutable v4 and prevents v4 acquisition reuse.

## Preserved predecessor evidence

| Input | Bytes | SHA-256 |
|---|---:|---|
| v1 lock | 17,975 | `470f9e0fba8cb0bc837660eae4173635bcc86212bea83324a02c0953d9c36793` |
| v2 lock | 21,007 | `481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543` |
| v3 lock | 21,741 | `62ef486a9f54d62d3f78504fc293a1917e59746d85cf09a73422edc2c384e42f` |
| v4 lock | 28,207 | `e38e23f5fc28405ffb2554324b2967c077d6eeda46b010ec51aac5bece378ff8` |
| v4 invalid record | 1,432 | `47299ae4a7d52b818dae72afa4e69f429e8ddd4e8a8a561ff5a96d0d894013c0` |
| v4 invalid report | 2,764 | `01d1279f18d8794bf814bffa8620ac1ec3efc0b975b8a4b44a7086a24d0a3de4` |

The prior 30-file immutable manifest is also bound by identity and was rechecked before this lock was written.

## Frozen machine-readable identity

<!-- SHORT-PARITY-IDENTITY:BEGIN -->
{
  "acquisitionSupersedesLockSha256": "e38e23f5fc28405ffb2554324b2967c077d6eeda46b010ec51aac5bece378ff8",
  "anchors": {
    "nativeParserTextSha256": "d5eb90a205337e242dbcfd2752f2173adbff50a5178219365b9c10894b82479c",
    "pythonParserTextSha256": "4ae70515a50f3e7368655a021c94e5db7edaa05372a02d14c93bf77dc1837de0"
  },
  "audio": {
    "durationMs": 24102,
    "sampleCount": 385637,
    "vadExpectedInterval": [
      0,
      385637
    ],
    "wavSha256": "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211",
    "waveformSha256": "2cbf22e7635a41cf751401525e4358c19f2d452ae99c0ced78f65b6e9327e1c2"
  },
  "build": {
    "cmake": "4.1.1-msvc1",
    "computeType": "float16",
    "cudaToolkit": "12.8.93",
    "device": "cuda:0",
    "msvc": "19.44.35221.0"
  },
  "candidateId": "short-input-runtime-parity-bisect-v1",
  "cells": [
    "python-runtime-python-mel",
    "python-runtime-native-mel",
    "native-runtime-python-mel",
    "native-runtime-native-mel"
  ],
  "config": {
    "beamSize": 5,
    "compressionRatioThreshold": 2.4,
    "conditionOnPreviousText": true,
    "fallbackTemperatures": [
      0.0,
      0.2,
      0.4,
      0.6,
      0.8,
      1.0
    ],
    "generationFallback": "faster-whisper-v1.2.1-exact",
    "language": "ja",
    "lengthPenalty": 1.0,
    "logProbThreshold": -1.0,
    "maxInitialTimestampIndex": 50,
    "maxLength": 448,
    "modelWindowDurationMs": 30000,
    "noRepeatNgramSize": 0,
    "noSpeechThreshold": 0.6,
    "patience": 1.0,
    "promptResetOnTemperature": 0.5,
    "repetitionPenalty": 1.0,
    "sampleRate": 16000,
    "samplingBestOf": 5,
    "samplingTopK": 0,
    "temperature": 0.0,
    "timestampDrivenSeek": true,
    "timestampResolutionMs": 20,
    "vad": false,
    "zlibVersion": "1.3.1"
  },
  "contracts": {
    "decisionDispositions": [
      "runtime-divergence",
      "feature-divergence",
      "feature-runtime-interaction",
      "parser-divergence",
      "no-divergence",
      "baseline-runtime-unresolved",
      "invalid-evidence"
    ],
    "noModelStopBoundary": {
      "asrModelConstruction": false,
      "encode": false,
      "generate": false,
      "parityCells": 0,
      "parserPublication": false,
      "vadInference": false
    },
    "privacy": "aggregate-identities-only-no-text-tokens-absolute-paths-or-model-bytes",
    "promotionEligible": false,
    "qualificationEligible": false
  },
  "decodeIdentity": {
    "beginSuppressedTokenIds": [
      220,
      50257
    ],
    "beginSuppressedTokenIdsSha256": "5361010e57b1f08ec8360f097ea3063cf72e41f048203f694631e36bdd569a98",
    "fallback": "faster-whisper-1.2.1-exact",
    "parser": "native-timestamp-parser-v1",
    "promptSha256": "908b1562c473b2889d6ac86c6e011ec4c681f6e78c971f0d8e73424057a42ba0",
    "promptTokenIds": [
      50258,
      50266,
      50360
    ],
    "suppressedTokenCount": 88,
    "suppressedTokenIdsSha256": "f726fbe0a6dca45caa2028ac3584464684710a51040e1d1da176271c22184a6c"
  },
  "invalidPreflight": {
    "ignoredRecordSha256": "5c287a6b7b252284466379873bb4e2a237fda1dc0a1babc551583757ff3fc118",
    "trackedReportSha256": "86b7cfcde55d46848ec4003feadfff9b61c7e72e5cbca8eb0bd6658fe137b78d"
  },
  "invalidV3": {
    "ignoredRecordSha256": "808dd23c1f69e395bd759aad183e04e6b32e8c354a54f151b64c001e22882132",
    "trackedReportSha256": "1571773487cfe39fbf33daa149e030b29c257b3dca2760c0056604a46f79509d"
  },
  "invalidV4": {
    "ignoredRecordSha256": "47299ae4a7d52b818dae72afa4e69f429e8ddd4e8a8a561ff5a96d0d894013c0",
    "trackedReportSha256": "01d1279f18d8794bf814bffa8620ac1ec3efc0b975b8a4b44a7086a24d0a3de4"
  },
  "mel": {
    "differentValueCount": 89425,
    "dtype": "float32-le",
    "maximumAbsoluteDifference": 7.510185241699219e-06,
    "meanAbsoluteDifference": 6.203453040143359e-08,
    "nativeSha256": "c2fc425ae691a4b1f9acd92580061ad97df82e01165747d761653f87634b9e08",
    "pythonSha256": "51209b71c3450718055dfad8a3d5923283dd95d702d606b0bdf56aac53218aa9",
    "shape": [
      80,
      3000
    ],
    "sizeBytes": 960000
  },
  "model": {
    "files": [
      {
        "name": "config.json",
        "sha256": "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9",
        "sizeBytes": 2394
      },
      {
        "name": "model.bin",
        "sha256": "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1",
        "sizeBytes": 3087284237
      },
      {
        "name": "preprocessor_config.json",
        "sha256": "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711",
        "sizeBytes": 340
      },
      {
        "name": "tokenizer.json",
        "sha256": "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca",
        "sizeBytes": 2480617
      },
      {
        "name": "vocabulary.json",
        "sha256": "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1",
        "sizeBytes": 1068114
      }
    ],
    "id": "Systran/faster-whisper-large-v3",
    "revision": "edaa852ec7e145841d8ffdb056a99866b5f0a478"
  },
  "preModelSmoke": {
    "native-no-cudnn": {
      "modelLoaded": false,
      "runtimeFileCount": 7,
      "sha256": "4537074dee333f44e1383f1a44187e6ada0baffc6a1f584cfa31f175cd80f9c3",
      "sizeBytes": 4543,
      "status": "completed"
    },
    "python-wheel": {
      "modelLoaded": false,
      "runtimeFileCount": 9,
      "sha256": "0df1d87751e8d27f23f2a7962f98456349f33b359fda1e6eeb7432be16407a97",
      "sizeBytes": 4989,
      "status": "completed"
    }
  },
  "predecessorLocks": {
    "v1": "470f9e0fba8cb0bc837660eae4173635bcc86212bea83324a02c0953d9c36793",
    "v2": "481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543",
    "v3": "62ef486a9f54d62d3f78504fc293a1917e59746d85cf09a73422edc2c384e42f",
    "v4": "e38e23f5fc28405ffb2554324b2967c077d6eeda46b010ec51aac5bece378ff8"
  },
  "predecessorManifest": {
    "entryCount": 30,
    "sha256": "a622ed5d269f61d59821481e69dbd6c34d3354ea6a09807c709f15a07420b22c",
    "sizeBytes": 5348
  },
  "preservedV3": {
    "completedVadPreflightSha256": "f7201eef4c0e912eb181291038f66942d218ef7fb5e14ff86a0783f62a447246",
    "ortImportSmokeSha256": "3e3bbbff2aa438a662fb2a2380d6efe688072aebf7dc43a4f07a7d8ca25623e4",
    "preModelReattestationSha256": "ad48d75a8a85d4cdf6090cde10b4280653362d91b9876d4b754fb6e9478b38e8"
  },
  "preservedV4": {
    "noModelPreflightSha256": {
      "native-runtime-native-mel": "03942aad9960e4945979a1c77128d07d8a43b295c3b17e02ec38573bcf44b7c7",
      "native-runtime-python-mel": "c9eb1e3656ee6b662e82f71ed2da7c36118fecb167e82823d11290e8f9e74fc7",
      "python-runtime-native-mel": "9363ba44922fcefce3a537f4121a3831da14bab80f0fb3f8606da79bdc281cda",
      "python-runtime-python-mel": "e8b888fbaad6e3350867110a5b0d06f6844279cce11d05d0225952513c4a15a2"
    },
    "preModelReattestationSha256": "385353870ebba5d20c894daf595e80f735ff95d0e629992a7dc52c2fde46b5ef"
  },
  "runtimes": {
    "native-no-cudnn": {
      "computeType": "float16",
      "ctranslate2": {
        "sha256": "e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2",
        "sizeBytes": 36974592
      },
      "ctranslate2Version": "4.8.0",
      "deviceIndex": 0,
      "gpu": {
        "computeCapability": "8.6",
        "cudaDriverApiVersion": 13020,
        "deviceIndex": 0,
        "driverModuleVersion": "32.0.15.9649",
        "driverVersion": "596.49",
        "float16Supported": true,
        "name": "NVIDIA GeForce RTX 3070",
        "visibleDeviceCount": 1
      },
      "loadedModules": [
        {
          "name": "ctranslate2.dll",
          "rootRole": "task-local-runtime-bin",
          "sha256": "e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2",
          "sizeBytes": 36974592,
          "version": ""
        },
        {
          "name": "hikaru-asr-ctranslate2-tests.exe",
          "rootRole": "task-local-runtime-bin",
          "sha256": "d49c5708dc337dfbe0cf2862b4723bfa1852d4d97ac61d7cfed5583b0615fc7c",
          "sizeBytes": 1117184,
          "version": ""
        },
        {
          "name": "hikaru_asr_tokenizer.dll",
          "rootRole": "task-local-runtime-bin",
          "sha256": "6a340321f038f93152e917b5edcc97d8f67bf08dd2497a57eacf4833726c0400",
          "sizeBytes": 2139136,
          "version": ""
        },
        {
          "name": "onnxruntime.dll",
          "rootRole": "task-local-runtime-bin",
          "sha256": "18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257",
          "sizeBytes": 15809848,
          "version": "1.28.0.724"
        },
        {
          "name": "vcomp140.dll",
          "rootRole": "windows-system32",
          "sha256": "31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7",
          "sizeBytes": 213064,
          "version": "14.50.35719.0"
        },
        {
          "name": "nvcuda.dll",
          "rootRole": "windows-system32",
          "sha256": "ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c",
          "sizeBytes": 4466920,
          "version": "32.0.15.9649"
        },
        {
          "name": "cublas64_12.dll",
          "rootRole": "cuda-toolkit-12.8-bin",
          "sha256": "9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99",
          "sizeBytes": 113716224,
          "version": "6.14.11.1284"
        },
        {
          "name": "cublasLt64_12.dll",
          "rootRole": "cuda-toolkit-12.8-bin",
          "sha256": "b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7",
          "sizeBytes": 674667520,
          "version": "6.14.11.1284"
        }
      ],
      "measurementExecutable": {
        "sha256": "d49c5708dc337dfbe0cf2862b4723bfa1852d4d97ac61d7cfed5583b0615fc7c",
        "sizeBytes": 1117184
      },
      "pathRootIdentitySha256": "24eaa123fe2c1bd9cb0fec0bfa4715ab5ad8aa8d37b17a0cf0b0ef834c94945c",
      "productionWorker": {
        "sha256": "d6649b54e0b7409e6e1acd6122fb29837504868af91902e29487ed238a6fc1b1",
        "sizeBytes": 552960
      },
      "requestedDevice": "cuda",
      "resolvedDevice": "cuda",
      "runtimeFiles": [
        {
          "name": "ctranslate2.dll",
          "sha256": "e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2",
          "sizeBytes": 36974592
        },
        {
          "name": "hikaru-asr-ctranslate2-tests.exe",
          "sha256": "d49c5708dc337dfbe0cf2862b4723bfa1852d4d97ac61d7cfed5583b0615fc7c",
          "sizeBytes": 1117184
        },
        {
          "name": "hikaru-asr-worker.exe",
          "sha256": "d6649b54e0b7409e6e1acd6122fb29837504868af91902e29487ed238a6fc1b1",
          "sizeBytes": 552960
        },
        {
          "name": "hikaru_asr_tokenizer.dll",
          "sha256": "6a340321f038f93152e917b5edcc97d8f67bf08dd2497a57eacf4833726c0400",
          "sizeBytes": 2139136
        },
        {
          "name": "onnxruntime.dll",
          "sha256": "18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257",
          "sizeBytes": 15809848
        },
        {
          "name": "onnxruntime_providers_shared.dll",
          "sha256": "599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8",
          "sizeBytes": 21856
        },
        {
          "name": "silero_vad_v6.onnx",
          "sha256": "4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2",
          "sizeBytes": 1245151
        }
      ]
    },
    "python-wheel": {
      "computeType": "float16",
      "ctranslate2": {
        "sha256": "60e536c0801432cde4a105aeebbca35fbf228aa3e901807b2310b02676c2f140",
        "sizeBytes": 59292672
      },
      "ctranslate2Version": "4.8.0",
      "deviceIndex": 0,
      "gpu": {
        "computeCapability": "8.6",
        "cudaDriverApiVersion": 13020,
        "deviceIndex": 0,
        "driverModuleVersion": "32.0.15.9649",
        "driverVersion": "596.49",
        "float16Supported": true,
        "name": "NVIDIA GeForce RTX 3070",
        "visibleDeviceCount": 1
      },
      "loadedModules": [
        {
          "name": "ctranslate2.dll",
          "rootRole": "task-local-runtime-bin",
          "sha256": "60e536c0801432cde4a105aeebbca35fbf228aa3e901807b2310b02676c2f140",
          "sizeBytes": 59292672,
          "version": ""
        },
        {
          "name": "hikaru-asr-ctranslate2-tests.exe",
          "rootRole": "task-local-runtime-bin",
          "sha256": "d49c5708dc337dfbe0cf2862b4723bfa1852d4d97ac61d7cfed5583b0615fc7c",
          "sizeBytes": 1117184,
          "version": ""
        },
        {
          "name": "hikaru_asr_tokenizer.dll",
          "rootRole": "task-local-runtime-bin",
          "sha256": "6a340321f038f93152e917b5edcc97d8f67bf08dd2497a57eacf4833726c0400",
          "sizeBytes": 2139136,
          "version": ""
        },
        {
          "name": "libiomp5md.dll",
          "rootRole": "task-local-runtime-bin",
          "sha256": "982233366b0afcda1e0f55a0b134097e35b779613f54ddb69e685e6cd06b755f",
          "sizeBytes": 1614192,
          "version": "5.0.2025.910"
        },
        {
          "name": "onnxruntime.dll",
          "rootRole": "task-local-runtime-bin",
          "sha256": "18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257",
          "sizeBytes": 15809848,
          "version": "1.28.0.724"
        },
        {
          "name": "cudnn64_9.dll",
          "rootRole": "task-local-runtime-bin",
          "sha256": "9edbcdff73b0af070eb160b2ce66e59feca04aa017351d8eedcc5e8e149967d2",
          "sizeBytes": 266288,
          "version": "9.10.2.21"
        },
        {
          "name": "nvcuda.dll",
          "rootRole": "windows-system32",
          "sha256": "ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c",
          "sizeBytes": 4466920,
          "version": "32.0.15.9649"
        },
        {
          "name": "cublas64_12.dll",
          "rootRole": "cuda-toolkit-12.8-bin",
          "sha256": "9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99",
          "sizeBytes": 113716224,
          "version": "6.14.11.1284"
        },
        {
          "name": "cublasLt64_12.dll",
          "rootRole": "cuda-toolkit-12.8-bin",
          "sha256": "b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7",
          "sizeBytes": 674667520,
          "version": "6.14.11.1284"
        }
      ],
      "measurementExecutable": {
        "sha256": "d49c5708dc337dfbe0cf2862b4723bfa1852d4d97ac61d7cfed5583b0615fc7c",
        "sizeBytes": 1117184
      },
      "pathRootIdentitySha256": "baefc9bc2a105050c052376b0e0b535658f3fcd6338aa1f9ac9b84e4d7160490",
      "productionWorker": {
        "sha256": "d6649b54e0b7409e6e1acd6122fb29837504868af91902e29487ed238a6fc1b1",
        "sizeBytes": 552960
      },
      "requestedDevice": "cuda",
      "resolvedDevice": "cuda",
      "runtimeFiles": [
        {
          "name": "ctranslate2.dll",
          "sha256": "60e536c0801432cde4a105aeebbca35fbf228aa3e901807b2310b02676c2f140",
          "sizeBytes": 59292672
        },
        {
          "name": "cudnn64_9.dll",
          "sha256": "9edbcdff73b0af070eb160b2ce66e59feca04aa017351d8eedcc5e8e149967d2",
          "sizeBytes": 266288
        },
        {
          "name": "hikaru-asr-ctranslate2-tests.exe",
          "sha256": "d49c5708dc337dfbe0cf2862b4723bfa1852d4d97ac61d7cfed5583b0615fc7c",
          "sizeBytes": 1117184
        },
        {
          "name": "hikaru-asr-worker.exe",
          "sha256": "d6649b54e0b7409e6e1acd6122fb29837504868af91902e29487ed238a6fc1b1",
          "sizeBytes": 552960
        },
        {
          "name": "hikaru_asr_tokenizer.dll",
          "sha256": "6a340321f038f93152e917b5edcc97d8f67bf08dd2497a57eacf4833726c0400",
          "sizeBytes": 2139136
        },
        {
          "name": "libiomp5md.dll",
          "sha256": "982233366b0afcda1e0f55a0b134097e35b779613f54ddb69e685e6cd06b755f",
          "sizeBytes": 1614192
        },
        {
          "name": "onnxruntime.dll",
          "sha256": "18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257",
          "sizeBytes": 15809848
        },
        {
          "name": "onnxruntime_providers_shared.dll",
          "sha256": "599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8",
          "sizeBytes": 21856
        },
        {
          "name": "silero_vad_v6.onnx",
          "sha256": "4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2",
          "sizeBytes": 1245151
        }
      ]
    }
  },
  "sources": {
    ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research/generate_whisper_short_parity_inputs.py": {
      "sha256": "c7cbb3188f7504d82a679cda18fb9e63377b53c2baa7883051b235ebcf3fc9d8",
      "sizeBytes": 5201
    },
    ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research/publish_whisper_gpu_quality.py": {
      "sha256": "ece07ee742992e4315fed0635c7c56feaa1fb6e5142e912173739f647901f30c",
      "sizeBytes": 68715
    },
    ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research/publish_whisper_short_parity_bisect.py": {
      "sha256": "48df92790067f07ff34015f35b5d48a61fe9a17915f06a3370923623aa4fe2f4",
      "sizeBytes": 37011
    },
    ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research/test_publish_whisper_short_parity_bisect.py": {
      "sha256": "6dc4e28c2c33dd89e82cc30a8d4e36221c83cb3a79171b0111d9056437a6a5fc",
      "sizeBytes": 31901
    },
    ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research/test_whisper_short_parity_oracles.py": {
      "sha256": "5e33d8801fdbbb683c8607b899fe63196864256dccd60fd28d5f307d5f457eb3",
      "sizeBytes": 6056
    },
    ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research/test_whisper_short_vad_preflight_lock.py": {
      "sha256": "e4d642f16f22fe3eb0a46231f5b529eb3f7c11b2342857104f239f2008b8ec6b",
      "sizeBytes": 3825
    },
    ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research/whisper_short_parser_oracle.py": {
      "sha256": "beed74badbfdc51cb5976650b6af5dc6394e8cb924c1842a1a3218d897e2e569",
      "sizeBytes": 11101
    },
    ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research/whisper_short_vad_preflight.py": {
      "sha256": "c841445714148cf9be7c62d0b522d9ae68864470dd73425544cadc5702fa981f",
      "sizeBytes": 11489
    },
    "native-asr/CMakeLists.txt": {
      "sha256": "d10e80604f487e6c9021bd8e14a933f927e67072a5d95900bfd00fb528953476",
      "sizeBytes": 34585
    },
    "native-asr/CMakePresets.json": {
      "sha256": "81aff320e18a808fbf1924d8a30f5758aeeb588ad73b233081e6ab32d6ad4765",
      "sizeBytes": 4511
    },
    "native-asr/src/ctranslate2_whisper.cpp": {
      "sha256": "8c8c591398bdac2e43494f055b10b15802ab9805db8ec85878edcff2e26e3d0b",
      "sizeBytes": 92782
    },
    "native-asr/src/ctranslate2_whisper.hpp": {
      "sha256": "49f743c36040d2a0c69a4d4364453836cd2d5dd14780edd6441bb9ea05b6f766",
      "sizeBytes": 12521
    },
    "native-asr/tests/ctranslate2_whisper_tests.cpp": {
      "sha256": "5020c49a7c6ef8eec18e4760675792698241d4a5e232ba9f4f9e1965ed4cd526",
      "sizeBytes": 176485
    }
  },
  "supersedesLockSha256": "62ef486a9f54d62d3f78504fc293a1917e59746d85cf09a73422edc2c384e42f",
  "tools": {
    "parserOracle": {
      "sha256": "beed74badbfdc51cb5976650b6af5dc6394e8cb924c1842a1a3218d897e2e569",
      "sizeBytes": 11101
    },
    "publisher": {
      "sha256": "48df92790067f07ff34015f35b5d48a61fe9a17915f06a3370923623aa4fe2f4",
      "sizeBytes": 37011
    },
    "pythonExecutable": {
      "sha256": "de13d8017f63cb63b0b5bfd2f25e69245c9196433a224856ca1abde1e24d0cb7",
      "sizeBytes": 262144
    },
    "qualityPublisher": {
      "sha256": "ece07ee742992e4315fed0635c7c56feaa1fb6e5142e912173739f647901f30c",
      "sizeBytes": 68715
    },
    "tokenizersExtension": {
      "sha256": "7acb83f5b89136597e0d14b788d82917bf2870df94575bf77e12731c4e49c4df",
      "sizeBytes": 7395328
    },
    "tokenizersInit": {
      "sha256": "510d5e23458612433da9f1fe430b5009fb88ba90508ee4340d2397b32c319080",
      "sizeBytes": 2739
    },
    "vadPreflightLockTests": {
      "sha256": "e4d642f16f22fe3eb0a46231f5b529eb3f7c11b2342857104f239f2008b8ec6b",
      "sizeBytes": 3825
    },
    "vadPreflightTool": {
      "sha256": "c841445714148cf9be7c62d0b522d9ae68864470dd73425544cadc5702fa981f",
      "sizeBytes": 11489
    }
  },
  "v5LockSelection": {
    "acceptedName": "gpu-short-parity-bisect-lock-v5.md",
    "acceptedRootRole": "task-research-root",
    "canonicalExactPathRequired": true,
    "rejectedPredecessorNames": [
      "gpu-short-parity-bisect-lock.md",
      "gpu-short-parity-bisect-lock-v2.md",
      "gpu-short-parity-bisect-lock-v3.md",
      "gpu-short-parity-bisect-lock-v4.md"
    ]
  },
  "v5NoModelEvidence": {
    "asrModelLoaded": false,
    "modelLoaded": false,
    "preflightSha256": {
      "native-runtime-native-mel": "03942aad9960e4945979a1c77128d07d8a43b295c3b17e02ec38573bcf44b7c7",
      "native-runtime-python-mel": "c9eb1e3656ee6b662e82f71ed2da7c36118fecb167e82823d11290e8f9e74fc7",
      "python-runtime-native-mel": "9363ba44922fcefce3a537f4121a3831da14bab80f0fb3f8606da79bdc281cda",
      "python-runtime-python-mel": "e8b888fbaad6e3350867110a5b0d06f6844279cce11d05d0225952513c4a15a2"
    },
    "runtimeSmokeSha256": {
      "native-no-cudnn": "4537074dee333f44e1383f1a44187e6ada0baffc6a1f584cfa31f175cd80f9c3",
      "python-wheel": "0df1d87751e8d27f23f2a7962f98456349f33b359fda1e6eeb7432be16407a97"
    },
    "vadModelLoaded": false
  },
  "vadModel": {
    "name": "silero_vad_v6.onnx",
    "rootRole": "task-local-runtime-bin",
    "sha256": "4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2",
    "sizeBytes": 1245151
  },
  "vadPreflight": {
    "algorithm": "faster-whisper-1.2.1-silero-v6-exact",
    "files": [
      {
        "name": "faster_whisper/assets/silero_vad_v6.onnx",
        "sha256": "4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2",
        "sizeBytes": 1245151
      },
      {
        "name": "faster_whisper/audio.py",
        "sha256": "60a1d8638f718cbf6d245aed3e5a5aa61c1f822a0b0fe9b48a7c928d47c23909",
        "sizeBytes": 3506
      },
      {
        "name": "faster_whisper/vad.py",
        "sha256": "37a9c774aefdd3162d936b896c8dcf5571b2ed938d65bffecfd631770049a18d",
        "sizeBytes": 12543
      },
      {
        "name": "onnxruntime/__init__.py",
        "sha256": "68a550ceb214e04edd388d154ace91a89c52e084ffd3751086bcaa215c94e990",
        "sizeBytes": 17731
      },
      {
        "name": "onnxruntime/capi/onnxruntime.dll",
        "sha256": "b7dfcb4dea88f8488812c99e2c9016b9a30a374c83b888d39664df3238bcb48b",
        "sizeBytes": 16783712
      },
      {
        "name": "onnxruntime/capi/onnxruntime_providers_shared.dll",
        "sha256": "669fa0fbb5536e709ead9af53d60aca97f2b03a1d9063acaa842a8a816f1a7b9",
        "sizeBytes": 21816
      },
      {
        "name": "onnxruntime/capi/onnxruntime_pybind11_state.pyd",
        "sha256": "28a78fe15545c56fbbdf598286d18438cd015fe37660e39e4498190613ef7fc6",
        "sizeBytes": 17420088
      },
      {
        "name": "python.exe",
        "sha256": "de13d8017f63cb63b0b5bfd2f25e69245c9196433a224856ca1abde1e24d0cb7",
        "sizeBytes": 262144
      }
    ],
    "loadedModules": [
      {
        "name": "onnxruntime_providers_shared.dll",
        "rootRole": "python-site-packages-onnxruntime-capi",
        "sha256": "669fa0fbb5536e709ead9af53d60aca97f2b03a1d9063acaa842a8a816f1a7b9",
        "sizeBytes": 21816
      },
      {
        "name": "onnxruntime_pybind11_state.pyd",
        "rootRole": "python-site-packages-onnxruntime-capi",
        "sha256": "28a78fe15545c56fbbdf598286d18438cd015fe37660e39e4498190613ef7fc6",
        "sizeBytes": 17420088
      }
    ],
    "notLoadedModules": [
      {
        "name": "onnxruntime.dll",
        "rootRole": "python-site-packages-onnxruntime-capi",
        "sha256": "b7dfcb4dea88f8488812c99e2c9016b9a30a374c83b888d39664df3238bcb48b",
        "sizeBytes": 16783712
      }
    ],
    "onnxRuntimeVersion": "1.26.0",
    "options": {
      "contextSizeSamples": 64,
      "maxSpeechDurationS": "infinity",
      "minSilenceDurationMs": 2000,
      "minSpeechDurationMs": 0,
      "negThreshold": null,
      "providers": [
        "CPUExecutionProvider"
      ],
      "speechPadMs": 400,
      "threshold": 0.5,
      "windowSizeSamples": 512
    }
  }
}
<!-- SHORT-PARITY-IDENTITY:END -->

## V5 changed task-local identities

| Input | Bytes | SHA-256 |
|---|---:|---|
| `.trellis/tasks/08-20-native-asr-whisper-quality-revision/research/whisper_short_vad_preflight.py` | 11,489 | `c841445714148cf9be7c62d0b522d9ae68864470dd73425544cadc5702fa981f` |
| `.trellis/tasks/08-20-native-asr-whisper-quality-revision/research/publish_whisper_short_parity_bisect.py` | 37,011 | `48df92790067f07ff34015f35b5d48a61fe9a17915f06a3370923623aa4fe2f4` |
| `.trellis/tasks/08-20-native-asr-whisper-quality-revision/research/test_publish_whisper_short_parity_bisect.py` | 31,901 | `6dc4e28c2c33dd89e82cc30a8d4e36221c83cb3a79171b0111d9056437a6a5fc` |
| `.trellis/tasks/08-20-native-asr-whisper-quality-revision/research/test_whisper_short_vad_preflight_lock.py` | 3,825 | `e4d642f16f22fe3eb0a46231f5b529eb3f7c11b2342857104f239f2008b8ec6b` |

## No-model evidence boundary

The unchanged same-runner runtime smokes and all four closed C++ preflights are bound to the hashes above. Every successful preflight must state `vadModelLoaded=false`, `asrModelLoaded=false`, and `modelLoaded=false`. The Python VAD command must not run during implementation or review; exact-v5 acceptance is tested only through the post-lock pre-import boundary.

A clean independent review permits only requesting fresh exact-v5 authorization. No earlier authorization carries forward.
