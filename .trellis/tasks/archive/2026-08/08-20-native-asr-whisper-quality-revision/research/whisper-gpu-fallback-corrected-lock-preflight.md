# Native Faster-Whisper corrected fallback lock preflight

**Status: `ready-for-renewed-acquisition-decision`; qualification ineligible.**

Corrected lock: `research/gpu-fallback-diagnostic-lock-v2.md`, SHA-256 `823630f08ab15ed7dadf4f80f0e5a320c89e3e2171cd55b8ac86cc6463235b82`.

## Supersession and no-model boundary

- The superseded `gpu-fallback-diagnostic-lock.md` remains byte-for-byte unchanged at SHA-256 `5fcfe845451f418a1e21fe8711ba9f367fdc2e13f8c2e02dd598683dde4e073a`.
- The corrected lock binds the invalid-preflight JSON SHA-256 `29b8767342bb9f1ac57c630285c1481b58877c57b92c775e38f9dfb9d4b6a212` and Markdown SHA-256 `27054915dc39d7e2e58535e0a62dfb6fbaf55aac47caf5bd0f66017f539b2f6f`.
- That invalid preflight has `modelLoaded=false` and `acquisitionRows=[]`. Neither fallback cell ran; no quality, performance, resource, fallback-trigger or selected-temperature metrics exist.
- This correction freezes identity only. It is not acquisition authorization and does not create model evidence or a diagnostic disposition.

## Complete expected loaded-module inventory

| Module | Bytes | SHA-256 | Root role |
|---|---:|---|---|
| `hikaru-asr-ctranslate2-tests.exe` | 978,944 | `1f72c282f342abc84d69f2e663d021d06b6957a44cdef83d25c44f53e5ec0e39` | `task-local-runtime-bin` |
| `ctranslate2.dll` | 36,974,592 | `e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2` | `task-local-runtime-bin` |
| `hikaru_asr_tokenizer.dll` | 2,137,088 | `d0ac979b132073ba76220f47e5b77538bf03ec1dcaea01fb5d9d928762939cad` | `task-local-runtime-bin` |
| `onnxruntime.dll` | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` | `task-local-runtime-bin` |
| `vcomp140.dll` | 213,064 | `31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7` | `windows-system32` |
| `nvcuda.dll` | 4,466,920 | `ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c` | `windows-system32` |
| `cublas64_12.dll` | 113,716,224 | `9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99` | `cuda-toolkit-12.8-bin` |
| `cublasLt64_12.dll` | 674,667,520 | `b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7` | `cuda-toolkit-12.8-bin` |

The four system/CUDA rows exactly match `whisper-gpu-fallback-acquisition-preflight.json`; current files, sizes, hashes and restricted-PATH root roles were independently checked against the corrected lock.

## Re-attestation

- 51 frozen source, tool, runtime, model, corpus, VAD, zlib and authority files matched their expected SHA-256 values.
- RTX 3070, driver `596.49`, compute capability `8.6`, CUDA toolkit `12.8.93`, MSVC `19.50.35722`, CMake `4.1.1-msvc1` and Ninja `1.12.1` remain current.
- No identity drift required a rebuild. Production source and the publisher were not changed.
- Focused publisher tests passed `14/14`, including direct current-module checks and superseded-lock preservation.

## Renewed gate

Independent review must accept this corrected identity. After that, both closed cells still require fresh explicit model-backed acquisition approval. No ASR model may be loaded under the superseded lock.
