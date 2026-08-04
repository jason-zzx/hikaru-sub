# T06 CPU RTF Root-Cause Diagnostic

## Scope

This is a same-binary diagnostic on the deterministic first 120 seconds of authoritative `medium-v1`. It is **not qualification evidence** and contains no transcript, token IDs, media, or absolute paths. Every cell loads one backend, runs one bounded warmup pass that is explicitly excluded, then records a second measured pass. The prior Candidate A report remains a historical provisional baseline; any retained candidate requires a new lock and authoritative reruns.

## Runtime Identity

- Ignored raw evidence SHA-256: `91389cf995b80ca03cd5f9f17603b256677ea4f456cadbe84e22ca3780ef04da`
- Diagnostic publisher SHA-256: `d17d9a32a1cba668f2a5cf8469580e74db9a7e86c43c8b8009a038b7b5f17f64`
- Diagnostic slice SHA-256: `d7b8c62d1358eee4f7ca40596ec424e91cde6992654add5c0219cdeed3907b42` (verified local PCM is exactly the source WAV's first 120 seconds)
- Source WAV SHA-256: `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458`
- Model: `Systran/faster-whisper-large-v3` revision `edaa852ec7e145841d8ffdb056a99866b5f0a478`; `model.bin` SHA-256 `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1`
- Measurement executable SHA-256: `d1b4cf2294430f136eb1228257e30983b2d58ec00290d8cc3f42db0500580146`
- CTranslate2 DLL SHA-256: `e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59`
- Tokenizer DLL SHA-256: `892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d`
- CPU: `AMD Ryzen 7 5800X 8-Core Processor`; logical cores `16`
- Resolved threads: intra `16`, inter `1`
- CTranslate2 `4.8.0`, oneDNN `3.1.1` `static`, OpenMP `COMP`
- Loaded relevant modules: VCOMP140.DLL, ctranslate2.dll, hikaru-asr-ctranslate2-tests.exe
- Available ISA: `{"avx":true,"avx2":true,"avx512f":false,"fma":true,"sse2":true}`

Bounded oneDNN attestation:

- No bounded oneDNN info line was captured.

## Excluded Warmups

| Cell | Warmup wall ms | Warmup inference ms | Warmup generate ms | Windows | Excluded from comparisons |
|---|---:|---:|---:|---:|---|
| A | `99250.9` | `99240.7` | `98889.0` | 4 | yes |
| B | `110317.2` | `110307.9` | `109934.0` | 5 | yes |
| C | `157284.0` | `157274.6` | `156914.5` | 5 | yes |
| D | `119593.0` | `119584.2` | `119160.6` | 5 | yes |

## Four-Cell Measured Matrix

| Cell | Seek | History | Beam | Inference RTF | Generate ms | Windows | Generated tokens | Prefix-forward tokens | Overlap ms |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| A | fixed-30s | off | 5 | `0.842` | `100664.5` | 4 | 477 | 8 | 0 |
| B | timestamp-driven | off | 5 | `0.916` | `109555.9` | 5 | 553 | 10 | 7040 |
| C | timestamp-driven | full-official | 5 | `1.321` | `158125.5` | 5 | 562 | 847 | 1640 |
| D | timestamp-driven | full-official | 1 | `0.988` | `118133.7` | 5 | 778 | 847 | 22400 |

A/B/C first-window inputs, prompt/history counts, generated token count, and generated trace are equal; shared trace SHA-256: `daec76dc85bd0ff3778b5eff69bfd7943f2512389bfbfa080cc49da230f90e51`.

## Causal Comparison

- A→B seek-only RTF change: `+8.8%`.
- B→C full-history RTF change: `+44.2%`.
- C→D beam-5-to-1 RTF change: `-25.2%`.

**Decision:** The no-history controls remain below the frozen CPU RTF ceiling, so this matrix does not support an inherent CTranslate2/large-v3 CPU ceiling on this machine. Full previous-text history is a confirmed dominant regression factor. Beam size 5 materially increases total cost in the full-history configuration.

D is not a product or qualification candidate merely because its RTF is below `1.0`: it generated 778 tokens versus C's 562 and reprocessed 22400 ms versus C's 1640 ms. Its changed output/seek behavior requires authoritative quality reruns before selection.

## Controls And Limitations

- The fixed execution order was A→B→C→D. Each cell had its own excluded warmup, and warmup/measured generated-token totals matched, but there is only one measured pass per cell. Thermal/order variance is therefore a residual diagnostic limitation, not qualification evidence.
- oneDNN `3.1.1` is a build-time pinned static library, so no oneDNN DLL can appear in the loaded-module inventory. No bounded oneDNN verbose info line was captured; CPUID records machine capability, not the ISA or primitive implementation actually dispatched by oneDNN.
- The causal result is still accepted for this checkpoint because all cells ran in one process with one executable and the same required DLL/model/slice identities. It does not establish a portable CPU ceiling or a product-quality result.
- This diagnostic executable is a separate post-Candidate-A identity. It does not rewrite `algorithm-lock.md`, re-identify the historical Candidate A short/medium evidence, or merge the earlier long timeout. Any selected candidate requires a new lock and fresh authoritative runs.

## Next Decision

- Do not run long-v1 or the seven-model matrix from this diagnostic identity.
- If A/B pass and history/beam is confirmed, select the smallest authoritative CPU candidate, create a new lock, and rerun the minimum authoritative short/medium cases before any long run.
- Only if the no-history controls remain above RTF `1.0` after required one-variable follow-ups may T06 publish a reviewed CPU ceiling and `gpu-required-pending` handoff to T07/T14/T15.
