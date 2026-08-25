# Phase 3D same-runner planning feasibility

> **No-model planning evidence.** This note does not authorize or contain ASR/VAD inference, model construction, encode/generate output, a quality row, or a candidate disposition.

## Question

Can the existing task-local C++ parity runner start and execute its no-model self-checks with the installed Python-wheel CTranslate2 4.8.0 runtime, so that Phase 3D can vary the CT2 DLL while keeping one executable/harness?

## Isolated runtime root

An ignored task-local smoke root contained:

- unchanged `hikaru-asr-ctranslate2-tests.exe`, SHA-256 `1f72c282f342abc84d69f2e663d021d06b6957a44cdef83d25c44f53e5ec0e39`;
- unchanged task-local tokenizer and ONNX Runtime DLLs required by executable imports;
- installed Python-wheel `ctranslate2.dll`, SHA-256 `60e536c0801432cde4a105aeebbca35fbf228aa3e901807b2310b02676c2f140`;
- installed wheel `cudnn64_9.dll`, SHA-256 `9edbcdff73b0af070eb160b2ce66e59feca04aa017351d8eedcc5e8e149967d2`;
- installed wheel `libiomp5md.dll`, SHA-256 `982233366b0afcda1e0f55a0b134097e35b779613f54ddb69e685e6cd06b755f`.

The restricted process PATH was the isolated root, CUDA 12.8 `bin`, then Windows System32. No model path was supplied.

## Result

Both commands passed under the same executable with the wheel CT2 DLL selected at process start:

```text
hikaru-asr-ctranslate2-tests.exe --fallback-self-check
  -> ctranslate2 whisper fallback tests passed

hikaru-asr-ctranslate2-tests.exe --self-check
  -> ctranslate2 whisper tests passed
```

This proves the current wheel DLL is ABI/load-compatible enough for the existing no-model runner surface and that a same-executable Phase 3D design is feasible.

## Limitation and required fail-closed checks

This smoke does **not** prove model construction, CUDA encode/generate compatibility, lazy loaded-module identity, output reproducibility, or subtitle quality. Phase 3D implementation must still freeze isolated roots, reject cross-root DLL loading, capture the exact post-generation module set in any later authorized acquisition, and treat model-load/generation failure as invalid parity evidence rather than silently switching to Python bindings or another runtime.
