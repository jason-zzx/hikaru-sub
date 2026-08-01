# 原生 ASR 迁移总体设计

## Summary

本设计定义原生 ASR 迁移的稳定边界和交付顺序。详细模型、体积参考、调研链接与历史协议提案继续保留在 `.trellis/tasks/07-25-native-asr-migration/research/native-asr-technical-design.md`；任务编号/门禁以父任务最新 artifacts 为准，最终 worker wire schema 以 T04 `prd.md`、`design.md` 和其产出的 `native-asr/docs/protocol-v1.md` 为准。

核心变化只有一条：用独立原生 C++ worker 替代生产版 Python FastAPI sidecar。React 的转录工作流和 Tauri command 表面保持稳定，Tauri 从 HTTP 代理升级为原生任务与进程管理者。

## Evidence And Implementation Authority

Algorithm decisions follow this order: validated user `.asr-benchmark` WAV+ASS ground truth; official documentation/stable public APIs/model cards; current well-maintained community recommendations; measured selection against the same ground truth. Current Python code/output is diagnostic and historical reference only, not expected output or a relative quality/performance gate.

This algorithm hierarchy does not weaken product compatibility. React/Tauri commands, `AsrJobSnapshot`, cancellation, recovery, paths, cleanup and security remain mandatory contracts.

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

- Remain in the source tree during migration as a current-implementation diagnostic and developer-only fallback.
- Never supply or repair reference text/timestamps, and never be required for native quality comparison.
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
| `faster-whisper` | CTranslate2 | Support product model IDs and legal timestamps; algorithm/config selected from official/community guidance against ground truth |
| `kotoba-faster-whisper` | CTranslate2 | Follow pinned model-card requirements; retain Kotoba-only preprocessor readiness |
| `parakeet` | CrispASR | Q8_0 default; evaluate official upstream long-audio behavior against confirmed speech regions |
| `reazonspeech-nemo` | CrispASR | Q8_0 default; evaluate official RNNT timestamps/chunking against ground truth |
| `qwen3-asr` | CrispASR | Q4_K text model plus required Q4_K ForcedAligner; no synthetic timestamps |

CTranslate2 productization supplies the native Whisper layers that CTranslate2 itself does not provide. Their tokenizer, feature, prompt, decoding, windowing, VAD and merge algorithms begin from official APIs/model cards and maintained community practice, then are selected by T01 ground-truth measurements. Current Python behavior is a diagnostic regression input, not a template.

The current `faster-whisper==1.2.1` / `ctranslate2==4.8.0` `large-v2` + `ja` + `>=600000ms` V4/seed/session/semantic path must be included in T06 product-model validation, but T06 may replace it with an authoritative, better-performing algorithm.

CrispASR productization likewise starts with documented upstream behavior. Python gap detection, chunking, Japanese segmentation, backfill and refresh patterns are copied only when ground-truth evidence and authoritative implementation guidance justify them, never to achieve Python parity.

## VAD Design

The CPU runtime may reuse CrispASR's public VAD capability for CTranslate2 jobs when supported by official/stable APIs and ground-truth evaluation. `useVad=true` remains a product input contract, but the native algorithm need not copy Python VAD internals or fallback policy. Any fallback must remain observable, legal on the timeline, and pass the same authoritative corpus gates.

A small shared VAD companion model may be downloaded under `deps/models/shared/vad`. It remains separate from engine weights and follows the same manifest/hash rules.

## Model And Runtime Layout

```text
<install>/deps/
├─ asr-runtime/
│  ├─ vulkan/current/       # optional qualified pack
│  └─ cuda/current/         # optional qualified pack
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

The CPU runtime is an application resource replaced with application upgrades. It is probed but cannot be independently cleaned. T13 produces optional CUDA/Vulkan packs and T14 qualifies device routing. A GPU pack overrides CPU only after identity, load and capability checks; any failure falls back to the built-in CPU runtime with one nonfatal UI notice. A failed pack is omitted from the release manifest and does not block CPU cutover.

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
- Keep every current model visible in the UI. Qualification metadata controls whether a model is selectable for the native release and explains `qualified` / `stop-revise` / `unsupported-for-native-release`; an unavailable model is never silently routed to Python.
- Keep official/China mirror selection. The worker never receives remote URLs or credentials.
- Preserve command registration -> typed Tauri wrapper -> UI wiring for every changed command.

Existing specs that state "inference stays in Python" are current-state documentation, not target architecture. They are updated only in the child task where the production boundary actually changes, followed by a final consistency pass in the release task.

## Build And Supply Chain

- Add a focused `native-asr/` CMake project.
- Pin CTranslate2, CrispASR, compiler and build-tool versions.
- Produce a Windows CPU runtime artifact plus separately versioned CUDA/Vulkan pack artifacts, each with manifest, component versions, licenses and SHA-256.
- The main installer consumes only the verified CPU artifact; GPU packs are downloaded and installed under managed `deps/asr-runtime/` only when their own qualification result is publishable.
- `pnpm release:local` consumes verified artifacts; end-user machines never run CMake.
- Compile only required ASR capabilities and use release/LTO/strip where supported, without weakening structured progress, timestamps or crash isolation.
- Model revisions, runtime library commits, device capability evidence and pack identities are explicit inputs to release review.

## Security And Privacy

- Treat audio paths, model paths, filenames, URLs and worker output as untrusted at their respective boundaries.
- Canonicalize and constrain managed writes/cleanup under approved application/dependency roots.
- Use structured process arguments and JSON; never interpolate user paths into a shell command.
- Bound protocol line/event sizes and segment counts to prevent a compromised worker from exhausting the host.
- Keep stderr diagnostics under a managed log with bounded retention; redact secrets and avoid logging subtitle/request bodies.
- Verify every downloaded artifact before marking it ready or loading it.

## Rollout And Rollback

The migration is capability-gated rather than a single irreversible switch:

1. Establish authoritative ground-truth measurements and optional Python diagnostics, then run native PoCs without changing defaults.
2. Introduce protocol and Rust host behind development-only native selection.
3. Promote CTranslate2 engines after their independent CPU quality gate.
4. Promote each CrispASR engine independently after its CPU gate.
5. Build and qualify optional CUDA/Vulkan packs against the already-qualified engine pipelines; omit failed packs without delaying CPU release.
6. Switch model/runtime UI and production packaging after required CPU paths are ready and GPU qualification outcomes are explicit.
7. Retain `python-legacy` for one stable source release cycle; do not bundle its runtime.

Rollback is per engine and per runtime pack. A failed native route can return to Python legacy in development while unaffected native routes remain testable. The release package removes Python only after the full integration gate passes. A failed GPU pack is removed from the release manifest and falls back to CPU; it cannot delay an otherwise qualified CPU cutover.

## Test Strategy

- Fake-worker tests exercise the complete Rust lifecycle without model downloads.
- CTest covers protocol validation, normalization and backend adapters.
- Model-backed suites run manually or in dedicated cached CI; ordinary CI remains dependency-free.
- Rust tests cover routing, model readiness, download integrity, process lifecycle, paths and cleanup boundaries.
- GPU qualification runs on an explicit hardware/driver matrix and records actual loaded modules, pack identity, accelerated RTF and CPU fallback; no VRAM gate is invented.
- Frontend tests cover stable defaults, migrated settings, device availability, visible qualification status for every existing model and removal of Python setup UI.
- The final model-backed matrix scores short, medium and long Japanese audio directly against T01 ground truth for CER, confirmed speech gaps, timeline, Qwen alignment, performance and resources. Python results are supplemental diagnostics only.

## Design Decisions

- **D1:** Independent worker over in-process FFI, prioritizing crash isolation and reliable cancellation.
- **D2:** CTranslate2 remains the Whisper backend; CrispASR Whisper is not an automatic fallback.
- **D3:** Rust owns orchestration and downloads; the worker is inference-only.
- **D4:** CPU runtime is bundled, models are not.
- **D5:** GPU packs are normal-numbered child deliverables in this parent, but qualification and publication are independent per pack; CPU remains the release baseline.
- **D6:** Preserve product IPC before optimizing internal APIs.
- **D7:** Prefer official/model-card/stable API and maintained community algorithms; add compensation only when ground-truth evidence requires it.
- **D8:** No Qwen3 result without ForcedAligner timestamps.
