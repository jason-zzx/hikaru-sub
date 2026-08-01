# Native CTranslate2 Faster-Whisper 产品化设计

## Summary

T06 将 T02 中已证明正确的底层 primitives 移入 T04 的单一 worker 工程，只替换失败的 long-form orchestration。算法先使用 authoritative timestamp-driven seek；只有 ground truth 仍显示 confirmed gaps 时才增加一个 pinned VAD candidate。T06 结束时提供 ordinary faster-whisper 每模型资格数据，不处理下载、packaging、GPU 或 UI。

## Architecture

```text
T05 ResolvedNativeLaunch (task-local locked model path, resolved cpu)
        |
        v
T04 WorkerRequestV1
  engine=faster-whisper backend=ctranslate2 device=cpu
        |
        v
CTranslate2WhisperBackend
  validated local model
  PCM16 WAV -> official log-mel
  tokenizer/model metadata
  timestamp-driven long-form decode
  narrow overlap dedupe / source-end bound
        |
        v
T04 progress / segment / optional segmentsReplace / completed
        |
        v
T05 host snapshot + recovery
```

## File Boundary

Prefer the smallest extension to the T04 project:

```text
native-asr/
  src/main.cpp                         # production hikaru-asr-worker entry/dispatch
  src/ctranslate2_whisper.hpp
  src/ctranslate2_whisper.cpp
  tests/ctranslate2_whisper_tests.cpp
  CMake target: hikaru-asr-worker
  Existing T04 target: hikaru-asr-fake-worker (test-only)
```

`main.cpp` reads one request, uses the shared T04 protocol validator, dispatches only implemented production routes, and emits stable pre-ready errors for others. Do not split audio/tokenizer/prompt/window/decoder into speculative interfaces. Extract a helper only when unit vectors or T07 reuse proves a real seam.

Task evidence:

```text
.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/
  algorithm-lock.md
  product-model-disposition.md
  ctranslate2-whisper-report.md
  evidence/*.json
  local/                          # ignored build/models/raw traces
```

## Proven T02 Primitives To Reuse

- PCM16 16k mono validation and rounded verified duration.
- Official Whisper mel filter/golden provenance.
- Hugging Face tokenizer JSON bridge and special/timestamp token IDs.
- CT2 CPU int8 + oneDNN load/runtime contract.
- Distinct `sourceWindowDurationMs` and padded `modelWindowDurationMs=30000`.
- Raw token trace, verified WAV-end bound and start-after-audio fail semantics.
- Canonical task-local raw-output containment and immutable binary/model/lock identity checks.

Do not promote T02 benchmark CLI/output scaffolding into the production worker.

## Candidate Algorithm Ladder

### Candidate A - Official Timestamp-Driven Seek

- 30-second padded model input.
- Parse timestamp tokens and advance source seek using decoded segment end evidence.
- Preserve previous text/prompt according to pinned official behavior; reset on defined temperature/no-speech/failure conditions.
- Handle consecutive timestamps, leading silence, no-speech and final partial window.
- Bound only the verified final WAV end; never manufacture missing speech.

Run large-v3 short/medium/long. If all gates pass, freeze A.

### Candidate B - One Pinned VAD/Chunking Strategy

Only if A has confirmed gaps:

- select one official or well-maintained pinned VAD/chunk strategy before measuring;
- keep mapping from source audio to model windows explicit;
- VAD failure may use a documented fallback only if fallback independently passes the same gates;
- no hard-hole reference repair, transcript-driven chunking or multiple hidden fallback ladders.

Run large-v3 again and freeze only measured improvement that preserves all timeline/performance contracts.

## Segment Assembly

A model generation may yield zero or more timestamped segments. Final normalization is narrow:

- reject empty/non-positive/out-of-source starts;
- keep ordered overlap where valid;
- remove only demonstrably duplicate overlap text/ranges;
- preserve Japanese punctuation;
- retain enough subtitle-sized segments to report duration/character distributions;
- use `segmentsReplace` only when final dedupe/merge changes already emitted output.

No reference-derived split or arbitrary equal-duration segmentation.

## Progress And Cancellation

`processedMs` reflects confirmed source seek, clamped to verified source duration and monotonic. The 30-second model range never inflates progress.

Cancellation checks occur before model load where possible, before/after each window and before completion. T05 remains authoritative for process-tree cancellation if CT2 generation is not interruptible inside one call.

## Model Qualification

Model IDs are fixed from current UI constants. Use one algorithm family/config policy:

| Model | Promotion role |
|---|---|
| large-v3 | mandatory default hard gate |
| large-v2 | mandatory, including long-v1 >10min hard gate |
| tiny/base/small/medium/large-v3-turbo | measured disposition; non-default failure does not block default route |

Disposition definitions:

- `qualified`: every required case passes all frozen gates.
- `stop-revise`: executable/valid evidence exists but one or more gates fail.
- `unsupported-for-native-release`: stable format/API/license support cannot be established.

T06 publishes data only. T15 stores qualification metadata; T16 displays every model and disables/explains non-runnable native routes.

## Evidence Flow

```text
locked corpus + model + algorithm + final binary
  -> task-local raw worker JSON/token traces
  -> T01 adapter/import
  -> identity validation
  -> deterministic sanitized evidence/report
```

Failed rows retain complete trace/identity and are never scored. No second CER/gap implementation.

## Security And Privacy

- Worker reads only task-local locked model/audio paths injected through T05 `ResolvedNativeLaunch`; T11/T15 later replace test/development injection with the production resolver.
- Raw transcripts/token traces remain below canonical ignored task-local root.
- Model files, CT2 DLLs, exe, private WAV/ASS and absolute paths are never tracked.
- stderr is bounded and excludes transcript/request bodies.

## Compatibility And Handoff

- Protocol v1 and `AsrJobSnapshot` stay unchanged.
- T07 can reuse proven ordinary CT2 primitives but owns Kotoba model-card behavior/cache.
- T11 consumes dispositions and locked file identities for model manifest/readiness.
- T12 consumes frozen dependencies to build the reproducible packaging pipeline/provisional artifact; T17 rebuilds and attests the final CPU artifact from accepted T06～T10 identities.
- T13/T14 add/qualify GPU without changing the CPU algorithm contract.

## Rollback

Disable faster-whisper native route. T04 protocol, T05 host and Python legacy remain usable; no user cache migration is required.
