# ReazonSpeech R2 source-only oracle lock

## Status and boundary

Frozen diagnostic identity: `R2-vad12-pad30-overlap-top-level-v1` source-only oracle.

User-reviewed decision: preserve official/default `speechPadMs=30` and replace the superseded blanket non-overlap identity. The `12000ms` value is the unpadded VAD/rechunk core cap; direct-ABI inference windows may be at most `12060ms`, and only adjacent overlap caused by the ABI's final padding is accepted, bounded at `60ms`.

This lock authorizes only the completed task-local stdlib/`ctypes` probe. It does not authorize product worker changes, Step 2+, a formal candidate disposition, Release/default routing, model/VAD packaging, staging or commit.

Private paths, audio/model/VAD bytes, raw text, runtime binaries, module paths and stderr remain below ignored task/sibling `research/local/` roots. Tracked artifacts contain only stable identities, aggregate shape and the source-only gate result.

## Tracked tools and ignored input/output

| Input | Bytes | SHA-256 |
|---|---:|---|
| `research/run_r2_oracle.py` | 25,626 | `ec1345d286195714e4974707f59bc63f8134fbc90d11f29b80f64544bcca4c24` |
| `research/publish_r2_oracle.py` | 23,925 | `c7f22cfef3612f0283ed6f4a8693c0e23fa930a1bce24302c5a42a869a54e6ca` |
| `research/test_publish_r2_oracle.py` | 10,467 | `c6ba2fa11a7fd9c97f1a7d90c142cfb390e796a3ff05722ca48202a9a2993c58` |
| ignored `research/local/oracle-input.json` | 3,516 | `57c67b622ab019ac18a82a5076799a3ee6b603920d425859ebd3b4e53dfcafef` |
| ignored `research/local/oracle/short-v1.json` | 7,269 | `b28b98625993889d1bd4de8a841c1156acd4b62abe9e307b510744c464779b78` |
| ignored `research/local/oracle/medium-v1.json` | 44,160 | `f28d51efc545f55b3484e402765ea773bda780a407435575b24a93f8369e73dc` |

The runner exposes no algorithm knobs beyond case/output selection. It verifies the ignored config hash before model/audio access and refuses output outside the exact ignored oracle root. The publisher binds both raw hashes and recomputes metrics from T01 truth.

## Authoritative corpus and comparator

| Input | Bytes | SHA-256 |
|---|---:|---|
| T01 manifest | 2,868 | `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` |
| shared comparator | 101,313 | `b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822` |
| canonical protocol-v1 limits | 262 | `435c4eb649dc7e8939c38fc0eb778d2428bf2646a028abfe636c62f43302b464` |
| short-v1 WAV | 771,728 | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` |
| medium-v1 WAV | 15,963,982 | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` |

Reference text/segments are derived in memory by the shared T01 implementation. Python ASR output is not read.

## Pinned CrispASR source and ABI

- CrispASR `v0.8.22`, commit `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`, MIT.
- ggml submodule `bfe8ea228d8134d03641c9fcf233a9931f3730de`.
- c2pa-audio submodule `e40329b83f16f67bb5ddc7bb13ae18de0a9376fc`.
- Public session header: 51,717 bytes, SHA-256 `cdefd19f6f208ed3f77f31c1cc8df19224c1c81ed5e0e6064650a827000c68df`.
- Public combined header: 51,699 bytes, SHA-256 `38e3a7c28e4dda33bf2705a0d94b0414f00cba434927360a62cb091aecca2ce4`.
- `src/crispasr_c_api.cpp`: 447,974 bytes, SHA-256 `f0d34b18a10c54d1c6d05904eedde12cc1b8c61764f6c3f6c444cd4511bf6855`.
- `src/crispasr_vad.cpp`: 29,182 bytes, SHA-256 `f8b33e943669786c46e187bff056b46198bede5937d527093b7061a7eac90c3c`.
- `src/parakeet_orchestrate.cpp`: 13,016 bytes, SHA-256 `ac1b9b7c91b03cd02d6c619dace32f6151a97d2240bc162c67334b521040335b`.
- `examples/cli/crispasr_backend_parakeet.cpp`: 10,667 bytes, SHA-256 `0ada96582ca2d878ee3c894c0d0954122ee00315505df0fe0b79e95aaeb15780`.

Required exports were resolved directly from the pinned DLL: `crispasr_vad_slices`, `crispasr_vad_free`, session open/backend/transcribe, top-level result getters/free, session close and GPU backend selection.

## Runtime, model, VAD and device

| Input | Bytes | SHA-256 | License/boundary |
|---|---:|---|---|
| reviewed CUDA `crispasr.dll` | 11,414,528 | `824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e` | pinned CrispASR build |
| ReazonSpeech v2 Q8_0 | 667,147,072 | `20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2` | Apache-2.0 |
| canonical Silero v6.2.0 GGML | 885,098 | `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` | source copy byte-matched canonical asset |

Open params are ABI 2, 16 threads, `use_gpu=1`, `n_gpu_layers=-1`, GPU backend preference `cuda`, logical backend `parakeet`, language `ja`.

Development device is CUDA device 0, `NVIDIA GeForce RTX 3070`, compute capability `8.6`, driver API version `13020`. This is development evidence, not formal device qualification.

Restricted PATH roles are exactly `runtime-bin -> CUDA 12.8 bin -> System32`. Required loaded modules and their file identities are revalidated in every raw row: `crispasr.dll`, `ggml-base.dll`, `ggml-cpu.dll`, `ggml-cuda.dll`, `ggml.dll`, `cublas64_12.dll`, `cublasLt64_12.dll`, `cudart64_12.dll` and System32 `nvcuda.dll`.

## Frozen algorithm and window policy

```text
candidateId=R2-vad12-pad30-overlap-top-level-v1
threshold=0.5
minSpeechMs=250
minSilenceMs=100
speechPadMs=30
coreMaxSliceDurationMs=12000
paddedMaxInferenceWindowMs=12060
maximumPaddedInferenceWindowSamples=192960
maximumAdjacentPaddingOverlapMs=60
windowOrder=strictly increasing starts and ends
nonAdjacentOverlap=false
sessionReuse=true
sourceSegmentsPerWindow=1
callOrder=crispasr_vad_slices -> one crispasr_session_transcribe_lang per returned window
```

The pinned ABI performs VAD/post-merge/rechunk with zero internal pad, then expands each returned span independently by `30ms`. The runner therefore validates the returned padded windows directly: positive duration, audio bounds, strict start/end monotonicity, at most `12060ms`, adjacent overlap at most `60ms`, and no non-adjacent overlap. It never clamps or rewrites a window.

## Frozen exact single-pass strategy

Once before loading the DLL, the runner clears every inherited `CRISPASR_PARAKEET_*` value, sets `CRISPASR_PARAKEET_STREAM_THRESHOLD=13` and sets `CRISPASR_SESSION_UNIFIED_DISPATCH=0`. Before every transcribe call, it revalidates those exact environment values and rejects `sample_count > 192960`.

The `13s` threshold (`208000` samples) is safely above the padded maximum. With unified dispatch disabled, the pinned legacy inline branch selects direct `parakeet_transcribe_ex` for every legal oracle window. A null result returns failure; that branch has no reactive streamed fallback.

No CLI dispatcher, `transcribe_vad`, caller-created overlap, clamp, ownership rewrite, dedup, stitching, gap-fill, decoder/beam search, punctuation splitting/post-processing, Python output or reference repair is permitted.

## Source-only gate result

| Case | CER | Δ CER vs R1 | Semantic gaps | Δ gaps | Excluded gaps | Timeline errors | Windows / calls / cues | Max window | Max overlap | Overlapped boundaries | Max cue chars / duration |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| short-v1 | `0.266667` | `+0.041667` | `1` | `0` | `0` | `0` | `3 / 3 / 3` | `10260ms` | `60ms` | `1` | `42 / 8320ms` |
| medium-v1 | `0.295385` | `-0.081758` | `19` | `-3` | `1` | `0` | `53 / 53 / 53` | `11870ms` | `60ms` | `25` | `75 / 11600ms` |

Classification: `promising`.

The signal comes from medium-v1: CER improves by `0.081758` absolute and semantic gaps decrease by `3`. Short-v1 regresses by `0.041667` CER and does not improve its one semantic gap, so this is not a release or formal relative-selection result. Both cases are structurally valid, text-conserving, within cue/protocol limits and have zero shared-T01 timeline errors.

The publisher and focused tests mutation-bind candidate/config/raw identities; `12000/12060/60` window semantics; strict ordering; strategy environment and no-fallback identity; one-call/one-result/one-cue shape; byte text conservation; UTF-8, `96/15000` and protocol-v1 limits; raw hashes; and classification safety.

Stop after this oracle gate. No product code, Step 2+, staging or commit is authorized by this result.
