# T09 CrispASR Backend Handoff

## Status

T09 implemented the development-only shared CrispASR backend and published independently validated device results for both execution families:

- `parakeet-family`: `development-gpu-ready`;
- `qwen3-family`: `development-gpu-ready`.

Neither result enables a product or Release/default route. `HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT` remains default-off and Python legacy routing remains authoritative.

## Stable backend surface

- `native-asr/src/crispasr_backend.hpp/.cpp` owns the pinned dynamic C ABI, runtime identity verification, route mapping, G1 CPU/CUDA parameters, copied result/alignment capability, callback reset, and conditional handle cleanup.
- `native-asr/src/wav_audio.hpp/.cpp` is the shared verified 16 kHz mono PCM16 WAV reader consumed by CTranslate2 and CrispASR; CT2 error codes remain translated at the existing boundary.
- `native-asr/src/main.cpp` owns protocol JSONL. Reazon/Parakeet may emit preview/final replacement/completed events. Qwen source/session timing stays provenance-only, raw ForcedAligner capability is copied, and the worker emits zero timed output plus `qwen_timeline_policy_not_implemented` until T11 supplies grouping policy.
- `src-tauri/src/asr_worker.rs` adds only `#[cfg(test)]` CrispASR inputs and reuses the existing launch/recovery/gate/process-tree cancellation logic. Configured model/aligner inputs require exact size and SHA-256 before launch.

## Safety contracts

- Exactly progress and segment callbacks are registered; token callbacks are never bound.
- Returned result handles are attached to RAII before callback exceptions can be rethrown.
- Callback reset guard is destroyed before alignment/result guards, so external callbacks are cleared while context is alive and before result/alignment/session release.
- Hard cancellation proves process-tree reclamation only; no in-process destructor claim is made for a killed worker.
- A CUDA request must pass the internal minimum loaded-module invariant before `ready`; fake tests cover CUDA rejection without the marker module.
- Model-backed rows bind exact module checkpoint stages, roots, relative paths, sizes/hashes, restricted-PATH identity, CUDA Driver API identity, stderr identity and privacy status.

## Frozen development identity

- CrispASR v0.8.22 commit `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`; recursive submodules: ggml `bfe8ea228d8134d03641c9fcf233a9931f3730de`, c2pa-audio `e40329b83f16f67bb5ddc7bb13ae18de0a9376fc`.
- CUDA `crispasr.dll`: 11,414,528 bytes, SHA-256 `824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e`.
- Worker: 561,152 bytes, SHA-256 `e1f55919b46ad545ccd7d839e00d6e2533a766505cc9d814b7b0ad64cddd02f0`.
- Runner: 251,904 bytes, SHA-256 `5f0a54781c09436bf4139db1efc113388767fbf125c11f36e06822185ce86538`.
- Frozen raw index: 4,274 bytes, SHA-256 `1a3058ae5dff92c9157961e809e75126335f5f76cd20a655ee8cf9b9cdc3c625`.
- Publication JSON: 2,400 bytes, SHA-256 `b376a5202c2e4795fe0ae1389895f5e68d5e2739334e8a80ddcda52aba6b6fec`.
- Publication Markdown: 619 bytes, SHA-256 `81b94f75dcdc0e3d3b0e417b81b8eb1ee2f7ff4fafa4480a7e158fc2401bdb1b`.

## Family results

### parakeet-family

Representative: ReazonSpeech (`reazonspeech-nemo` -> upstream `parakeet`).

| Sample | CPU warm median RTF | CUDA warm median RTF | GPU/CPU ratio |
|---|---:|---:|---:|
| short-v1 | 0.151812 | 0.018114 | 0.119318 |
| medium-v1 first 120s | 0.150618 | 0.016710 | 0.110944 |

Result: `development-gpu-ready`.

### qwen3-family

Representative: Qwen3-ASR plus required ForcedAligner. Inference time includes session transcription and raw ForcedAligner execution. Session getter timestamps are retained only as ineligible provenance; no T11 grouping is performed and every row requires zero accepted timed output with terminal `qwen_timeline_policy_not_implemented`.

| Sample | CPU warm median RTF | CUDA warm median RTF | GPU/CPU ratio |
|---|---:|---:|---:|
| short-v1 | 0.438105 | 0.092805 | 0.211832 |
| medium-v1 first 120s | 0.433218 | 0.142022 | 0.327830 |

Maximum observed raw alignment tail overrun: `29600ms`. Raw values remain unchanged diagnostic capability evidence and are never accepted timing.

Result: `development-gpu-ready`.

## Downstream ownership

- T10 consumes only `parakeet-family: development-gpu-ready` plus T03C quality dispositions: ReazonSpeech `proceed-with-named-risks`, Parakeet `stop-revise`.
- T11 consumes only `qwen3-family: development-gpu-ready`; it still owns exact source/alignment grouping, legal subtitle timeline, quality gates, and product qualification. Qwen remains `stop-revise` under T03C.
- T14/T15 own publishable runtime packs, fallback policy and production compute-device qualification. The pinned public ABI still has no resolved-device getter.

## Distribution boundary

Source clones/submodules, CUDA builds/DLLs, models, private WAVs, raw JSON, stderr and build logs remain below the ignored task-local `research/local/` root. No installer, downloader, managed runtime pack, setting, UI, model weight, private media/text, credential or production route is tracked.
