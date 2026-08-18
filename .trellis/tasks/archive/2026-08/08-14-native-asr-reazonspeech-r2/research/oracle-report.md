# ReazonSpeech R2 source-only oracle report

Classification: **`promising`**

This is a source-only diagnostic, not a reviewed worker candidate. It does not publish `qualified`, `stop-revise`, `better-than-r1`, or any release disposition.

## Frozen diagnostic identity

- Candidate shape: `R2-vad12-pad30-overlap-top-level-v1`.
- User-reviewed relaxation: preserve official/default `speechPadMs=30`; distinguish the `12000ms` unpadded VAD/rechunk core cap from the direct-ABI padded inference cap.
- Input config SHA-256: `57c67b622ab019ac18a82a5076799a3ee6b603920d425859ebd3b4e53dfcafef`.
- Manifest SHA-256: `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`; shared comparator SHA-256: `b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822`; protocol-v1 limits SHA-256: `435c4eb649dc7e8939c38fc0eb778d2428bf2646a028abfe636c62f43302b464`.
- Locked raw SHA-256: short-v1 `b28b98625993889d1bd4de8a841c1156acd4b62abe9e307b510744c464779b78`; medium-v1 `f28d51efc545f55b3484e402765ea773bda780a407435575b24a93f8369e73dc`.
- CrispASR: `v0.8.22` / `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`; ggml `bfe8ea228d8134d03641c9fcf233a9931f3730de`; c2pa-audio `e40329b83f16f67bb5ddc7bb13ae18de0a9376fc`.
- Runtime/model/VAD SHA-256: `824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e` / `20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2` / `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`.
- CUDA device: `NVIDIA GeForce RTX 3070`, compute capability `8.6`, driver API `13020`.
- Restricted PATH roles: `runtime-bin -> CUDA 12.8 bin -> System32`; loaded required module identities were revalidated.
- VAD: threshold `0.5`, minimum speech `250ms`, minimum silence `100ms`, speech pad `30ms`, unpadded core cap `12000ms`.
- Direct-ABI windows: positive and audio-bounded; starts and ends strictly increase; padded duration is at most `12060ms`; adjacent overlap is accepted only up to the ABI-native `60ms`; non-adjacent overlap is rejected.
- ABI order: one `crispasr_vad_slices`, then exactly one `crispasr_session_transcribe_lang(..., "ja")` per returned window on one loaded CUDA session.
- Exact single-pass identity: clear inherited `CRISPASR_PARAKEET_*`, set `CRISPASR_PARAKEET_STREAM_THRESHOLD=13`, set `CRISPASR_SESSION_UNIFIED_DISPATCH=0`, and reject windows above `192960` samples. The pinned legacy inline branch calls direct `parakeet_transcribe_ex`; a null result returns failure without reactive streamed fallback.
- Final cues preserve one top-level result per window and byte-exact text; starts are nondecreasing; cue timing may inherit only the bounded native overlap and must pass `96` code-point / `15000ms` / protocol-v1 / T01 timeline limits.
- Explicitly absent: CLI dispatcher, `transcribe_vad`, clamp, ownership rewrite, dedup, stitching, gap-fill, decoder search, punctuation post-processing, Python/reference repair.

## Aggregate comparison with R1

| Case | CER | Δ CER | Semantic gaps | Δ gaps | Excluded gaps | Timeline errors | Windows / calls / cues | Max window | Max overlap | Overlapped boundaries |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `short-v1` | 0.266667 | +0.041667 | 1 | +0 | 0 | 0 | 3 / 3 / 3 | 10260ms | 60ms | 1 |
| `medium-v1` | 0.295385 | -0.081758 | 19 | -3 | 1 | 0 | 53 / 53 / 53 | 11870ms | 60ms | 25 |

## Gate decision

- Oracle classification: `promising`.
- The source-only direction has at least one R1-relative CER or semantic-gap improvement signal and is structurally valid for both cases. Return to user review before any Step 2/product implementation.
- Stop after this oracle gate. Release/default remains Python legacy and the Reazon native route remains disabled.

## Residual risks

- Native padding overlap means adjacent inference calls hear up to `60ms` of the same audio. This oracle deliberately performs no ownership rewrite or dedup, so repeated/omitted boundary text remains a quality risk visible in CER/gap metrics.
- The direct C ABI pads after rechunking, unlike the maintained CLI's pad-before-rechunk order; the identity is explicit but not byte-equivalent to CLI slicing.
- The oracle does not exercise worker callbacks, protocol emission, atomic replacement, Rust recovery/cancellation, RSS/RTF publication, or long-v2 completion.
- Silero VAD execution is CPU-side inside the pinned runtime while the opened ReazonSpeech session uses the declared CUDA development device.
