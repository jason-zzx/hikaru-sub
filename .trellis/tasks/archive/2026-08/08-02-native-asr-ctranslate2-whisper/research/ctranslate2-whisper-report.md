# T06 CTranslate2 Whisper Candidate A Report

## Decision

**`stop-revise` — do not promote the ordinary faster-whisper native route.**

The frozen timestamp-driven Candidate A is executable and protocol-compatible, but it fails mandatory large-v3 gates:

- short-v1 CER is `0.3583` (`> 0.35`);
- medium-v1 CPU inference RTF is `1.100` (`> 1.0`);
- long-v1 exceeded the controlled `7200s` harness limit, a wall-RTF lower bound of `1.737`, and was terminated before an atomic scoreable result was published.

Short and medium have zero observed confirmed speech gaps and zero timeline errors. Those passing dimensions do not override the per-case CER/performance failures. Candidate B was not activated: VAD/chunking cannot reasonably repair the already-failing short CER or CPU RTF, and adding an ONNX runtime would increase package/runtime cost without a viable promotion path.

## Frozen Identity

| Input | SHA-256 |
|---|---|
| algorithm-lock.md | `e018fdc375478f0d059b0941daa2a381492b0329a2cd8291f2449ef8fd3eaef1` |
| measurement executable | `3bf320a41bfbed3ab0687ccccd20f02691ada834596bdfa2a3ef40212595ce8d` |
| production worker | `bd103e4fc1c80e8bd6e465bc1e41030be873fa192315547a76debd71cd11cf69` |
| CTranslate2 DLL | `e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59` |
| tokenizer DLL | `892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d` |
| large-v3 model.bin | `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` |

The completed short/medium rows use this single identity. The long timeout is retained as a separate, explicitly unscored process-termination record from a pre-final build; it is not merged into the completed evidence set or used to score quality. The final build adds path/identity validation without changing the frozen Candidate A decode policy.

## Large-v3 Measurements

| Case | Samples | CER | CPU inference RTF | Cold wall | Peak RSS | Timeline errors | Gaps >=1.5s | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| short-v1 | 1 cold + 3 warm | `0.3583` | warm median `0.686` | `28.922s` | `3.43 GB` | 0 | 0 | **fail: CER** |
| medium-v1 | 1 cold | `0.0993` | `1.100` | informational | `3.43 GB` | 0 | 0 | **fail: CPU RTF** |
| long-v1 | 1 terminated attempt | unscored | wall lower bound `1.737` | `> 7200s` | unavailable | unavailable | unavailable | **failed/incomplete: timeout** |

Medium contains 8 decoded-timestamp seek windows out of 17; seek is no longer an unconditional fixed 30-second step. The short file is one final partial source window, so it correctly advances at the verified source end.

## Subtitle Segmentation

| Case | Segments | Duration median / P95 / max | Characters median / P95 / max |
|---|---:|---:|---:|
| short-v1 | 4 | 4881 / 9070 / 9760 ms | 28.5 / 38.6 / 40 |
| medium-v1 | 166 | 2090 / 6805 / 15180 ms | 10.0 / 33.2 / 85 |

The candidate does not use a whole-film segment, synthetic timing, reference repair, Python parity, or VAD.

## Product-Model Consequence

Only large-v3 was measured because it is the mandatory first algorithm gate. large-v2, tiny, base, small, medium, and large-v3-turbo are `blocked-not-run`; they are neither qualified nor classified unsupported. Running them would spend substantial CPU time on an algorithm already rejected for the default hard gate.

## Compatibility And Limitations

- `hikaru-asr-worker` emits protocol v1 ready/progress/segment/completed or structured error events; stdout remains JSONL-only.
- T05 `NativeAsrHost` real-worker success, pre-ready structured failure/recovery, and cancellation tests pass with test-only environment injection. Release/default routing remains Python legacy.
- The authoritative corpus still lacks `low-volume`; no complete acoustic coverage claim is made.
- Raw transcripts, token traces, model/build files, absolute paths, and private WAV/ASS remain ignored.
- long-v1 has no scoreable Candidate A transcript because the external timeout terminated the runner before atomic publication. The timeout record is complete for process identity/termination, but not a complete model-generation token trace.
