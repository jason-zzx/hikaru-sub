# 原生 ASR 迁移总体设计

## Summary

本设计定义原生 ASR 迁移的稳定边界和交付顺序。详细模型、协议示例、体积参考与调研链接继续以 `.trellis/tasks/07-25-native-asr-migration/research/native-asr-technical-design.md` 为依据；本文件不复制全部提案，而是明确父任务需要约束的架构合同、迁移策略和子任务接口。

核心变化只有一条：用独立原生 C++ worker 替代生产版 Python FastAPI sidecar。React 的转录工作流和 Tauri command 表面保持稳定，Tauri 从 HTTP 代理升级为原生任务与进程管理者。

## Architecture

```text
React
  TranscribeView / model UI / runtime settings
        |
        | typed Tauri invoke
        v
Tauri Rust
  AsrState / model manager / runtime manager
  - one active job
  - worker lifecycle and process-tree cancellation
  - JSONL event reduction into AsrJobSnapshot
  - model download, hash verification and atomic install
  - portable/installed paths and recovery snapshots
        |
        | one JSON request on stdin
        | JSONL events on stdout; diagnostics on stderr
        v
hikaru-asr-worker.exe
  - CTranslate2 backend: faster-whisper, Kotoba
  - CrispASR C ABI backend: Parakeet, ReazonSpeech, Qwen3 + Aligner
  - audio/VAD/chunking/timestamp normalization
```

The worker is single-request and may exit after each job. Long-lived HTTP service state, port allocation and FastAPI routing are removed from the production path.

## Ownership Boundaries

### React

- Keep engine/model selection, task polling and user-visible progress.
- Continue converting `AsrSegment` into `SubtitleCue` and generating the formal ASS document.
- Consume typed wrappers from `src/services/tauri.ts`; do not call raw product `invoke` from views.
- Present CPU runtime as built in and model weights as separately managed downloads.
- Do not learn CTranslate2/CrispASR-specific inference internals beyond engine capabilities and available devices.

### Tauri Rust

- Own `AsrState`, the single-active-job invariant and stable command surface.
- Resolve and validate local audio/model/runtime paths before spawning the worker.
- Parse protocol events and reduce them to the existing polling snapshot.
- Own cancellation, process-tree cleanup, abnormal-exit handling and app-exit cleanup.
- Persist recovery JSON and a minimal recovery ASS without taking ownership of formal subtitle styling.
- Own model manifest loading, downloads, checksum validation, atomic readiness and storage cleanup.
- Keep probe, measure and cleanup separated and preserve portable path rules.

### Native Worker

- Read only Tauri-approved local paths.
- Perform audio decode/validation, VAD, inference, chunking, alignment and result normalization.
- Use CTranslate2's C++ API for Whisper-family engines and CrispASR's public C ABI for the other engines.
- Emit only protocol JSONL on stdout; write bounded diagnostics to stderr.
- Never download models, choose mirrors, persist application settings or generate styled ASS documents.

### Python Legacy

- Remain in the source tree during migration as a baseline and developer-only diagnostic fallback.
- Never be required by the production package after cutover.
- Remain removable per engine: failure of one CrispASR route does not require reverting completed CTranslate2 work.

## Stable Contracts

### React to Tauri

Command names and `AsrJobSnapshot` remain stable through the first native release. Internals may change from HTTP sidecar proxying to worker events, but React continues to observe:

```text
pending -> running -> completed | failed | cancelled
```

`progress`, `processedMs`, `durationMs` and `segmentCount` must be monotonic or reflect an explicit final replacement. `segmentsReplace` changes accumulated result content, not task identity.

### Tauri to Worker

Protocol requests are one-line JSON with `protocolVersion=1`, job identity, fixed engine/backend route, validated model paths, validated audio path, device, language and VAD settings.

Required events:

| Event | Contract |
|---|---|
| `ready` | Confirms protocol and backend startup before inference |
| `progress` | Advances processed/duration state monotonically |
| `segment` | Appends one normalized segment |
| `segmentsReplace` | Atomically replaces accumulated segments after merge/backfill |
| `completed` | Finalizes duration and detected language |
| `error` | Supplies stable machine code plus safe user-facing message |

Unknown additive fields are ignored within protocol v1. Unknown events, malformed JSON or version mismatch fail the job in a controlled way and preserve the last valid snapshot. A nonzero process exit without an `error` event is converted to a host-generated `worker_abnormal_exit` error.

### Segment Contract

The shared result remains:

```text
AsrSegment { startMs, endMs, text }
```

Normalization is deliberately narrow:

- clamp to audio duration;
- remove empty text and invalid ranges;
- sort by time;
- remove exact duplicates and clear chunk-overlap duplicates;
- preserve Japanese punctuation without introducing spaces.

The worker does not create `SubtitleCue`, bilingual structure or ASS styles.

## Engine Design

| Engine ID | Backend | Product-specific rule |
|---|---|---|
| `faster-whisper` | CTranslate2 | Preserve beam size 5, CPU int8, timestamps, VAD mapping and language detection |
| `kotoba-faster-whisper` | CTranslate2 | 15-second chunks, no previous-text conditioning, Kotoba-only preprocessor readiness |
| `parakeet` | CrispASR | Q8_0 default; validate long-audio TDT coverage before porting Python backfill |
| `reazonspeech-nemo` | CrispASR | Q8_0 default; validate RNNT timestamps and subtitle segment length |
| `qwen3-asr` | CrispASR | Q4_K text model plus required Q4_K ForcedAligner; no synthetic timestamps |

CTranslate2 productization includes the faster-whisper layer that CTranslate2 itself does not provide: log-mel extraction, tokenizer loading, prompts, timestamp-token parsing, window advancement, no-speech handling, VAD time restoration and overlap merge. The migration freezes current decode parameters before attempting optimization.

CrispASR productization first uses upstream long-audio behavior. Existing Python gap detection, Japanese segmentation or backfill is ported only when a repeatable corpus failure proves it necessary.

## VAD Design

The CPU runtime may reuse CrispASR's public VAD capability for CTranslate2 jobs, avoiding Python Silero/ONNX packaging. `useVad=true` applies the current session-scoped UI configuration. VAD loading or detection failure falls back to fixed-window processing and emits a nonfatal diagnostic; it must not abort transcription.

A small shared VAD companion model may be downloaded under `deps/models/shared/vad`. It remains separate from engine weights and follows the same manifest/hash rules.

## Model And Runtime Layout

```text
<install>/deps/
├─ asr-runtime/
│  ├─ vulkan/current/       # future follow-up
│  └─ cuda/current/         # future follow-up
├─ models/
│  ├─ ctranslate2/
│  ├─ crispasr/
│  └─ shared/vad/
└─ downloads/

application resources/native-asr/windows-x64/cpu/
├─ hikaru-asr-worker.exe
├─ required runtime DLLs
├─ runtime-manifest.json
└─ licenses/
```

The CPU runtime is an application resource replaced with application upgrades. It is probed but cannot be independently cleaned. Future GPU packs override CPU only after load/capability checks; any failure falls back to the built-in CPU runtime with one nonfatal UI notice.

The model manifest is application-owned trusted metadata. Download responses and bytes remain untrusted. Each file is written to a managed `.part`, validated by exact size and SHA-256, and atomically moved. A multi-file model receives its readiness marker only after every required role is valid.

Old `deps/models/huggingface` snapshots are read-only compatibility candidates for CTranslate2. New downloads do not extend that layout. Incompatible Python framework weights remain visible to storage measurement until the user explicitly cleans them.

## Process And Recovery Lifecycle

```text
start_asr
  -> reject if another job is active
  -> resolve runtime/model/audio
  -> create pending snapshot and recovery path
  -> spawn worker with structured argv/environment
  -> send protocol request
  -> consume events into snapshot and periodic recovery JSON
  -> completed: persist final recovery output and expose segments
     failed/cancelled/crashed: preserve last valid recovery JSON
  -> reap process and clear active slot
```

`cancel_asr` marks cancellation before attempting graceful stop, then terminates the process tree within the two-second product budget. App exit uses the same cleanup primitive. Completion and cancellation must be idempotent so competing stdout, exit and user-cancel signals cannot finalize the job twice.

Recovery files stay under the current audio workspace:

```text
<workspace>/asr-jobs/<jobId>.json
```

No recovery or model path may be derived directly from untrusted worker output.

## Settings And Compatibility

- Keep `asrEngine`, `asrModel`, `asrDevice` and `runtimeSourceMode`.
- Ignore legacy `pythonPath` and `asrServicePath` on load and stop serializing them after migration.
- Preserve known engine/model IDs; map unknown models to the selected engine's default.
- Keep official/China mirror selection. The worker never receives remote URLs or credentials.
- Preserve command registration -> typed Tauri wrapper -> UI wiring for every changed command.

Existing specs that state "inference stays in Python" are current-state documentation, not target architecture. They are updated only in the child task where the production boundary actually changes, followed by a final consistency pass in the release task.

## Build And Supply Chain

- Add a focused `native-asr/` CMake project.
- Pin CTranslate2, CrispASR, compiler and build-tool versions.
- Produce a Windows CPU runtime artifact with manifest, component versions, licenses and SHA-256.
- `pnpm release:local` consumes a verified artifact; end-user machines never run CMake.
- Compile only required ASR capabilities and use release/LTO/strip where supported, without weakening structured progress, timestamps or crash isolation.
- Model revisions and runtime library commits are explicit inputs to release review.

## Security And Privacy

- Treat audio paths, model paths, filenames, URLs and worker output as untrusted at their respective boundaries.
- Canonicalize and constrain managed writes/cleanup under approved application/dependency roots.
- Use structured process arguments and JSON; never interpolate user paths into a shell command.
- Bound protocol line/event sizes and segment counts to prevent a compromised worker from exhausting the host.
- Keep stderr diagnostics under a managed log with bounded retention; redact secrets and avoid logging subtitle/request bodies.
- Verify every downloaded artifact before marking it ready or loading it.

## Rollout And Rollback

The migration is capability-gated rather than a single irreversible switch:

1. Establish Python baselines and native PoCs without changing defaults.
2. Introduce protocol and Rust host behind development-only native selection.
3. Promote CTranslate2 engines after their independent quality gate.
4. Promote each CrispASR engine independently after its gate.
5. Switch model/runtime UI and production packaging only after all required CPU paths are ready.
6. Retain `python-legacy` for one stable source release cycle; do not bundle its runtime.

Rollback is per engine. A failed native route can return to Python legacy in development while unaffected native routes remain testable. The release package removes Python only after the full integration gate passes. GPU work is a separate follow-up and cannot delay CPU cutover.

## Test Strategy

- Fake-worker tests exercise the complete Rust lifecycle without model downloads.
- CTest covers protocol validation, normalization and backend adapters.
- Model-backed suites run manually or in dedicated cached CI; ordinary CI remains dependency-free.
- Rust tests cover routing, model readiness, download integrity, process lifecycle, paths and cleanup boundaries.
- Frontend tests cover stable defaults, migrated settings, device availability and removal of Python setup UI.
- The final matrix combines short, medium and long Japanese audio with quality, timing, memory, performance, cancel and crash criteria from the PRD.

## Design Decisions

- **D1:** Independent worker over in-process FFI, prioritizing crash isolation and reliable cancellation.
- **D2:** CTranslate2 remains the Whisper backend; CrispASR Whisper is not an automatic fallback.
- **D3:** Rust owns orchestration and downloads; the worker is inference-only.
- **D4:** CPU runtime is bundled, models are not.
- **D5:** GPU packs are a separate project.
- **D6:** Preserve product IPC before optimizing internal APIs.
- **D7:** Port Python compensation logic only when corpus evidence requires it.
- **D8:** No Qwen3 result without ForcedAligner timestamps.
