# Native Faster-Whisper GPU fallback acquisition preflight

**Disposition: `invalid-preflight-no-publication`.**

The explicitly authorized two-row acquisition stopped before model load. The frozen lock remains unchanged at SHA-256 `5fcfe845451f418a1e21fe8711ba9f367fdc2e13f8c2e02dd598683dde4e073a`.

## Re-attestation result

- Source, publisher, runner, worker, CT2/tokenizer/ORT runtime, large-v3 model, exact Silero V6, manifest/model-identity authority, prior VAD lock/publication, upstream faster-whisper source, zlib inputs/runtime, short/medium WAV+ASS, restricted PATH root, RTX 3070, driver, compute capability, CUDA toolkit and build-tool identities match the frozen values.
- The current driver/CUDA/OpenMP modules also match the previously reviewed machine identities.
- The fallback lock does not directly contain those loaded-module SHA-256 values, while the frozen publisher requires every loaded-module hash to occur in that exact lock text.

| Module | Bytes | Current SHA-256 | Directly frozen in fallback lock |
|---|---:|---|---|
| `vcomp140.dll` | 213,064 | `31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7` | no |
| `nvcuda.dll` | 4,466,920 | `ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c` | no |
| `cublas64_12.dll` | 113,716,224 | `9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99` | no |
| `cublasLt64_12.dll` | 674,667,520 | `b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7` | no |

The publisher therefore fails closed with `loaded module is not frozen`. Running either model-backed row would create evidence that cannot pass the frozen validator, so the invalid-evidence rule required stopping before inference.

## Acquisition and metrics

- `short-b5-on-vad-fallback`: not run; no metrics or fallback summary.
- `medium-b5-on-vad-fallback`: not run; no metrics or fallback summary.
- Tracked fallback diagnostic JSON/Markdown publication: not generated.
- Production/default routing, formal qualification, large-v2, and long-v2: unchanged and not run.

## Next gate

Return to planning. A new independently reviewed lock must directly bind the complete loaded-module inventory and all refreshed identities. Both rows then require fresh explicit model-backed acquisition approval; neither prior diagnostic row can be promoted.
