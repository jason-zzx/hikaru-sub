# GPU short input/runtime parity bisect lock v3

## Status and stop boundary

**Frozen corrected Phase 3D pre-model identity.** This v3 lock does not authorize acquisition, VAD inference, ASR model construction, `encode`, `generate`, any parity cell, a quality candidate, baseline replacement, production/default changes, or a formal matrix. It supersedes only acquisition use of immutable v2 lock SHA-256 `481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543`; v1/v2 and their invalid-preflight evidence remain byte-identical.

Candidate `short-input-runtime-parity-bisect-v1`, all four cells, runner, worker, model, Mel tensors, CT2 roots, prompt/options/fallback/parser contracts and decision rule are unchanged. V3 changes only the Python ONNX Runtime VAD attestation: after a future separately authorized Silero V6 inference, the exact relevant module set below the frozen `onnxruntime/capi` root must be `onnxruntime_providers_shared.dll` plus `onnxruntime_pybind11_state.pyd`; the frozen sibling `onnxruntime.dll` must remain absent from the process module set. Missing, additional, identity-, root-, or loaded-status drift stops before ASR model load.

The observed set is supported by import-only smoke evidence. It does not prove the future VAD session will retain the same set; that acquisition must reproduce it exactly or fail closed. Raw Mel, token, text, parser, trace and canonical path data remain below `research/local/`.

## Frozen machine-readable identity

<!-- SHORT-PARITY-IDENTITY:BEGIN -->
{
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
          "sha256": "307379a2085ee422f5814fdbb82f334a7f90d7600086dd5285e61f183230ec6c",
          "sizeBytes": 1084416,
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
        "sha256": "307379a2085ee422f5814fdbb82f334a7f90d7600086dd5285e61f183230ec6c",
        "sizeBytes": 1084416
      },
      "pathRootIdentitySha256": "24eaa123fe2c1bd9cb0fec0bfa4715ab5ad8aa8d37b17a0cf0b0ef834c94945c",
      "productionWorker": {
        "sha256": "68dd27ef2e6ada4be264ccf5591d1f4aacb091d3a6b847734a4d48d8578a13a7",
        "sizeBytes": 546304
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
          "sha256": "307379a2085ee422f5814fdbb82f334a7f90d7600086dd5285e61f183230ec6c",
          "sizeBytes": 1084416
        },
        {
          "name": "hikaru-asr-worker.exe",
          "sha256": "68dd27ef2e6ada4be264ccf5591d1f4aacb091d3a6b847734a4d48d8578a13a7",
          "sizeBytes": 546304
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
          "sha256": "307379a2085ee422f5814fdbb82f334a7f90d7600086dd5285e61f183230ec6c",
          "sizeBytes": 1084416,
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
        "sha256": "307379a2085ee422f5814fdbb82f334a7f90d7600086dd5285e61f183230ec6c",
        "sizeBytes": 1084416
      },
      "pathRootIdentitySha256": "baefc9bc2a105050c052376b0e0b535658f3fcd6338aa1f9ac9b84e4d7160490",
      "productionWorker": {
        "sha256": "68dd27ef2e6ada4be264ccf5591d1f4aacb091d3a6b847734a4d48d8578a13a7",
        "sizeBytes": 546304
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
          "sha256": "307379a2085ee422f5814fdbb82f334a7f90d7600086dd5285e61f183230ec6c",
          "sizeBytes": 1084416
        },
        {
          "name": "hikaru-asr-worker.exe",
          "sha256": "68dd27ef2e6ada4be264ccf5591d1f4aacb091d3a6b847734a4d48d8578a13a7",
          "sizeBytes": 546304
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
        }
      ]
    }
  },
  "supersedesLockSha256": "481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543",
  "tools": {
    "parserOracle": {
      "sha256": "beed74badbfdc51cb5976650b6af5dc6394e8cb924c1842a1a3218d897e2e569",
      "sizeBytes": 11101
    },
    "publisher": {
      "sha256": "371cbf62d5465c21b4a3e603de18e64fb0cff89992381f0c62696cc98e8cbb8e",
      "sizeBytes": 32269
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
    "vadPreflightTool": {
      "sha256": "21a1e0a2b9911e0fed0200f9b8bbfd4582710ef53c40d237416760c82c62843d",
      "sizeBytes": 11331
    }
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

## Pre-model file identities

| Input | Bytes | SHA-256 |
|---|---:|---|
| `native-asr/CMakeLists.txt` | 34,585 | `d10e80604f487e6c9021bd8e14a933f927e67072a5d95900bfd00fb528953476` |
| `native-asr/CMakePresets.json` | 4,511 | `81aff320e18a808fbf1924d8a30f5758aeeb588ad73b233081e6ab32d6ad4765` |
| `native-asr/src/ctranslate2_whisper.hpp` | 12,521 | `49f743c36040d2a0c69a4d4364453836cd2d5dd14780edd6441bb9ea05b6f766` |
| `native-asr/src/ctranslate2_whisper.cpp` | 92,782 | `8c8c591398bdac2e43494f055b10b15802ab9805db8ec85878edcff2e26e3d0b` |
| `native-asr/tests/ctranslate2_whisper_tests.cpp` | 172,964 | `dac1e4bcc8da89a9cc20afc415fe931bb68a398f04644cb020525a547b11cc6f` |
| parity runner | 1,084,416 | `307379a2085ee422f5814fdbb82f334a7f90d7600086dd5285e61f183230ec6c` |
| parity worker | 546,304 | `68dd27ef2e6ada4be264ccf5591d1f4aacb091d3a6b847734a4d48d8578a13a7` |
| parity tokenizer DLL | 2,139,136 | `6a340321f038f93152e917b5edcc97d8f67bf08dd2497a57eacf4833726c0400` |
| `generate_whisper_short_parity_inputs.py` | 5,201 | `c7cbb3188f7504d82a679cda18fb9e63377b53c2baa7883051b235ebcf3fc9d8` |
| `whisper_short_parser_oracle.py` | 11,101 | `beed74badbfdc51cb5976650b6af5dc6394e8cb924c1842a1a3218d897e2e569` |
| `whisper_short_vad_preflight.py` | 11,331 | `21a1e0a2b9911e0fed0200f9b8bbfd4582710ef53c40d237416760c82c62843d` |
| `publish_whisper_short_parity_bisect.py` | 32,269 | `371cbf62d5465c21b4a3e603de18e64fb0cff89992381f0c62696cc98e8cbb8e` |
| `publish_whisper_gpu_quality.py` | 68,715 | `ece07ee742992e4315fed0635c7c56feaa1fb6e5142e912173739f647901f30c` |
| `test_publish_whisper_short_parity_bisect.py` | 26,438 | `e6e97d732fed8f1d0be36872f2b176a2a41b6d132ff862443593ea31a37cd423` |
| `test_whisper_short_parity_oracles.py` | 6,056 | `5e33d8801fdbbb683c8607b899fe63196864256dccd60fd28d5f307d5f457eb3` |

The parity build used MSVC `19.44.35221.0`, CMake `4.1.1-msvc1`, CUDA Toolkit `12.8.93`, device `0`, FP16, RTX 3070 compute capability `8.6`, driver `596.49`, and the three-root restricted PATH policy. The Python producer is CPython `3.11.15`, faster-whisper `1.2.1`; `audio.py` SHA-256 is `60a1d8638f718cbf6d245aed3e5a5aa61c1f822a0b0fe9b48a7c928d47c23909` and `feature_extractor.py` SHA-256 is `e403966dbc592a53695eea2aea24fa60bab50ef6755e0076b311f907be7a397c`.

## Future acquisition command boundary

Only after fresh explicit approval under this exact v3 lock may each exact cell run in a clean process with `--run-whisper-short-parity`, exact `--repeats 2`, the matching frozen Mel, the matching isolated runtime root, large-v3 snapshot, this unchanged lock and the unchanged parity worker. Any missing/additional/hash/size/version/root module difference, Python VAD mismatch, loader-root drift, model failure, nondeterminism, external termination or parser-oracle inconsistency is invalid evidence. No row may be promoted into any quality publisher or formal matrix.
