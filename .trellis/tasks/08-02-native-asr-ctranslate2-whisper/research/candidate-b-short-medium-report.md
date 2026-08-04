# T06 Candidate B Large-v3 Short/Medium Report

## Decision

**stop-revise; do not run long-v1 or any other model.**

Candidate B is the locked ordinary faster-whisper 1.2.1 Silero V6 stage followed by the selected timestamp-driven/no-history/beam-1 CT2 decode. It uses direct official ORT 1.28.0 CPU execution and no fallback, repair, batched 160ms/30s policy, Silero V4, current Hikaru VAD settings, Python call, or Release route change.

| Case | Samples | CER | CPU inference RTF | Cold wall | Peak RSS | Timeline errors | Gaps >=1.5s | Segments | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| short-v1 | 1 cold + 3 warm | `0.2667` | warm median `0.654` | `29.544s` | `3.44 GB` | 0 | 0 | 5 | **pass** |
| medium-v1 | 1 measured | `0.1055` | `0.599` | informational | `3.44 GB` | 0 | 1 | 185 | **fail** |

## VAD And Restored-Timeline Evidence

- short retained `1.000` of source samples across 1 padded speech intervals; medium retained `0.951` across 10 intervals.
- ORT VAD inference was `49.771ms` for short and `937.334ms` for medium, included in Candidate B inference RTF.
- Original-source progress was monotonic and ended at verified WAV duration. Every accepted segment retained compressed timestamps, restored source timestamps, token trace identity, and WAV-end bound provenance in ignored raw evidence.
- Subtitle duration max is `5440`ms for short and `8980`ms for medium; no whole-audio giant segment was accepted.

## Frozen Identity

- Candidate B final lock SHA-256: `e687ead686df0499c70b649b63d7a85cd2882bc32deae20d1ccdbffc480a376f`
- Config SHA-256: `75dedb4923d571a3bac77e0f1c3760d940ff7538c09d240cdf0ea921f5556d30`
- Measurement executable SHA-256: `4218523d53d09eba8a09023630fe612b1590310d101e7d5d37d9f4d127f5ea22`
- Production worker SHA-256: `fb55512246b2a28b4b0c62d23618f6da84e8e3cd792be1e1bcf55c865bc52bdb`
- ONNX Runtime DLL SHA-256: `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257`
- Silero V6 model SHA-256: `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2`
- CPU identity: `AMD Ryzen 7 5800X 8-Core Processor` / `16` logical cores
- Restricted PATH policy SHA-256: `439a4172b0cb5d50232784da10208261f69eea476773a2e737b3fe2293a53043`
- Actual loaded module set: `ctranslate2.dll, hikaru-asr-ctranslate2-tests.exe, hikaru_asr_tokenizer.dll, onnxruntime.dll, vcomp140.dll`
- large-v3 model.bin SHA-256: `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1`

## Scope

No long-v1, large-v2, other model, GPU, packaging, downloader/readiness, setting, frontend, or native default-route work was run. Passing short/medium does not qualify Candidate B and does not establish that long-v1 gaps are repaired. The corpus still lacks `low-volume` coverage.
