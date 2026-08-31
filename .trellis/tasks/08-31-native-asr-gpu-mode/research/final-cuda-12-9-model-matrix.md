# Final CUDA 12.9 Update 1 RTX 3070 model matrix

- Date: 2026-08-31
- Artifact: `hikaru-asr-windows-x64-cuda-v1`
- ZIP SHA-256: `9ca8511365009794a32f14e6fcaeb5aada9e088e9186125e9f3b54db74e300b4`
- GPU: NVIDIA GeForce RTX 3070, device 0, compute capability 8.6, `FLOAT16`
- Sanitized ignored-local summary: `research/local/final-model-matrix/summary.json`
- Summary SHA-256: `c89543ccbe2392cdbfdffb5ed5bc5a93dfa0be3cdbf512315211e29af61c82c3`

## Completed cases

| Case | Engine/model | Audio duration | Wall | Segments | Result |
|---|---|---:|---:|---:|---|
| tiny-short | Faster-Whisper `tiny` | 24,102 ms | 2,543 ms | 14 | passed |
| base-short | Faster-Whisper `base` | 24,102 ms | 2,300 ms | 3 | passed |
| small-short | Faster-Whisper `small` | 24,102 ms | 1,820 ms | 5 | passed |
| medium-short | Faster-Whisper `medium` | 24,102 ms | 3,803 ms | 5 | passed |
| large-v2-short | Faster-Whisper `large-v2` | 24,102 ms | 6,639 ms | 5 | passed |
| large-v3-short | Faster-Whisper `large-v3` | 24,102 ms | 15,313 ms | 4 | passed |
| large-v3-turbo-short | Faster-Whisper `large-v3-turbo` | 24,102 ms | 8,546 ms | 10 | passed |
| kotoba-short | exact Kotoba v2.0 Faster | 24,102 ms | 4,136 ms | 10 | passed |
| large-v2-long | Faster-Whisper `large-v2` | 4,144,235 ms | 339,820 ms | 750 | passed |
| kotoba-long | exact Kotoba v2.0 Faster | 4,144,235 ms | 177,195 ms | 1,342 | passed |
| large-v3-short-no-ptx-jit | Faster-Whisper `large-v3`, `CUDA_DISABLE_PTX_JIT=1` | 24,102 ms | 6,064 ms | 4 | passed |

Every row reported `ready.device="cuda"`, Japanese detection, non-empty segments, and a passed sanitized validator result. The two long rows are about 69 minutes and therefore exceed the required ten-minute gates. The no-PTX-JIT row proves the final artifact executes native `sm_86` code on the RTX 3070.

## Evidence boundary

This matrix proves all eight current model identities, both required long gates, and native `sm_86` execution against the frozen final artifact. It does not by itself prove the final-artifact Rust-host cancellation/recovery/reap/active-slot matrix; those lifecycle tests require separately recorded final-worker host evidence. Product enablement also remains closed until the exact ZIP is published at a stable immutable remote URL and the matching source row is reviewed.
