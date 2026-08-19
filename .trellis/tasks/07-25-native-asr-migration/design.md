# 原生 ASR 迁移总体设计

## Summary

本设计定义原生 ASR 迁移的稳定边界和交付顺序。详细模型、体积参考、调研链接与历史协议提案继续保留在 `.trellis/tasks/07-25-native-asr-migration/research/native-asr-technical-design.md`；任务编号/门禁以父任务最新 artifacts 为准，最终 worker wire schema 以 T04 `prd.md`、`design.md` 和其产出的 `native-asr/docs/protocol-v1.md` 为准。

核心变化只有一条：用独立原生 C++ worker 替代生产版 Python FastAPI sidecar。React 的转录工作流和 Tauri command 表面保持稳定，Tauri 从 HTTP 代理升级为原生任务与进程管理者。

## Evidence And Implementation Authority

Algorithm decisions follow this order: validated user `.asr-benchmark` WAV+ASS ground truth; official documentation/stable public APIs/model cards; current well-maintained community recommendations; measured selection against the same ground truth. The identity-bound authority at `.trellis/tasks/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json` supplies the only Python subtitle-quality gate: same logical model, same case, `python-legacy-cuda-v1`, per metric. It is never expected output, an annotation source, or a relative performance/resource gate.

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

- Remain in the source tree during migration as the frozen current-production subtitle-quality baseline and developer-only fallback.
- Never supply or repair reference text/timestamps; only complete, identity-bound CUDA rows participate in same-model/same-case subtitle-quality comparison.
- Never supply a relative performance/resource threshold and never weaken timeline legality, protocol, identity, path, cancellation/recovery, privacy, license or other engineering gates.
- Never be required by the production package after cutover.
- Remain removable per engine: failure of one CrispASR route does not require reverting completed CTranslate2 work.

### Model-Level Baseline Boundary

```text
validated WAV+ASS truth
  -> shared T01 metric recomputation
  -> Python legacy row (logical model + case + python-legacy-cuda-v1)
  -> native row with verified mapped artifact/companion identity
  -> per-field subtitle-quality non-regression
  + independent structural / performance / resource / protocol / security gates
```

`large-v2` and `large-v3` are independent Whisper anchors; both complete matrices and all independent gates are required before the other five Whisper models enter release qualification. Kotoba, Parakeet, Qwen3-ASR and ReazonSpeech each use only their own mapped Python rows. A missing, failed-unverifiable, drifted or provenance-ineligible row produces `baseline-incomplete`/`unscored`, never a borrowed family result or waiver.

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

CTranslate2 productization supplies the native Whisper layers that CTranslate2 itself does not provide. Their tokenizer, feature, prompt, decoding, windowing, VAD and merge algorithms begin from official APIs/model cards and maintained community practice, then are selected by T01 ground-truth measurements. Current Python behavior is a diagnostic regression input, not a template. T06 first diagnoses CPU with a same-binary minimized matrix; once its production worker seam and CPU checkpoint exist, T07 reuses the exact worker/backend/algorithm seam for ignored-local CUDA development without creating another protocol or route identity. T07 is activated to shorten repeated quality iteration regardless of whether T06 proves a CPU ceiling; CPU ceiling affects only later product routing and qualification.

The T06 CPU checkpoint selected timestamp-driven/no-history/beam 1 through a bounded same-binary short-v1 beam 1/5 comparison. Its historical long-v1 result retained 7 confirmed gaps, but the current T08 corrected authority re-scores the same retained output against long-v2 at CER `0.1509`, zero semantic gaps and zero timeline errors; the old gap result remains superseded provenance. The sole Candidate B implemented direct official ONNX Runtime 1.28.0 CPU with ordinary faster-whisper 1.2.1 Silero V6. Its last-review replacement identity `e687ead6...` binds actual CPU/module paths, the two restricted Windows PATH roots through `77f4714a...`, and fixed relative module layout `a650e185...`; the 21-case mutation matrix rejects a correlated all-module/all-root rewrite. Candidate B is now diagnostic-only because selected Candidate A passes corrected short/medium/long-v2; ORT/VAD remains outside T13. The route and seven-model qualification matrix remain unqualified/unstarted, and production routing remains unchanged.

The current `faster-whisper==1.2.1` / `ctranslate2==4.8.0` `large-v2` + `ja` + `>=600000ms` V4/seed/session/semantic path remains a mandatory regression case. Any future qualification uses authoritative long-v2; archived large-v2 long-v1 observations remain explicitly historical. T15 owns the corresponding full CUDA validation if a reviewed device branch requires it.

### T06 Closure Branch And Development GPU Handoff

T06 has three mutually exclusive reviewed closure branches. `cpu-qualified` requires the complete CPU matrix and hard gates. `gpu-required-pending` requires same-binary proof of a CPU ceiling and hands the product device decision to T14/T15 without claiming GPU qualification. T07 is a shared post-checkpoint development lane for every branch, not part of the branch decision itself. `migration-handoff-stop-revise` is allowed when the production worker, Candidate A selected CPU baseline, Candidate B reviewed stop-revise evidence, Python non-gating comparison, deterministic publishers, T05 host/protocol tests and downstream handoff are complete while no qualification branch is proven.

The third branch was a truthful migration handoff, not a product qualification or GPU-required decision. Its long-v1 gap facts are retained only as superseded history; current T08 long-v2 correction passes selected Candidate A and makes Candidate B diagnostic-only while preserving the unqualified seven-model matrix, `low-volume` corpus limitation, disabled native faster-whisper, and Release/default Python legacy. T07 recorded `development-gpu-ready` on the declared RTX 3070, and T08 later accepted Kotoba K2 as an algorithm input. Subtitle quality does not select CPU versus GPU; formal route/package qualification remains downstream. ORT/VAD remains excluded from T13 packaging.


For migration risk only, T06 also reran the existing Python `large-v3` CPU reference on the historical T01 corpus. Python short/medium/long produced CER `0.358/0.099/0.295`, timeline errors `1/1/0`, and confirmed gaps `0/1/1`; the sanitized report is non-gating historical diagnostics. Candidate A remains the native CPU baseline, while its former long seven-gap blocker is superseded by the current long-v2 correction.

CrispASR productization likewise starts with documented upstream behavior. T03C is the current corrected evidence authority: Parakeet remains `stop-revise` at corrected long-v2 CER `0.5962`; ReazonSpeech remains `proceed-with-named-risks` at `0.2944` with zero semantic gaps/timeline errors but one oversized segment and mostly zero-duration words; Qwen short retains its timing failure while medium/long-v2 remain validated unscored blockers. Python gap detection, chunking, Japanese segmentation, backfill and refresh patterns are copied only when ground-truth evidence and authoritative implementation guidance justify them, never to achieve Python parity. T09 established the shared backend seam and published `parakeet-family: development-gpu-ready` (short/locked-120s ratios `0.119318/0.110944`) plus `qwen3-family: development-gpu-ready` (`0.211832/0.327830`) under the strict zero-output ForcedAligner capability matrix. The pinned ABI has no resolved-device getter, so T09 uses the user-approved external module/device/performance/mutation envelope and does not claim production-grade attestation. T09 also preserves a strict Qwen seam: validated raw ASR/ForcedAligner capability is copied successfully, but the ranges remain ineligible timing; T11 owns grouping, audio-bounded legal timeline policy, tail-overrun diagnosis, and independent product qualification. Final CPU and publishable GPU evidence remains separately gated.

## VAD Design

For ordinary faster-whisper, T06's only authorized VAD candidate is the direct official ONNX Runtime 1.28.0 CPU session plus the exact faster-whisper 1.2.1 `silero_vad_v6.onnx` asset locked in T06's `research/candidate-b-lock.md`. It is fail-closed with no CrispASR/Python/Candidate-A fallback, executor abstraction, or protocol change. The existing `useVad` input remains part of protocol v1; qualification uses the frozen Candidate B configuration rather than request-specific VAD tuning.

ORT/VAD was a conditional T13 CPU-runtime input only if Candidate B passed the new-identity large-v3 short/medium/long gate. Candidate B failed the medium gap gate, so it is not an accepted T13 package input; it remains outside T12 model download/readiness.

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

The CPU runtime is an application resource replaced with application upgrades. It is probed but cannot be independently cleaned. T07 provides an ignored-local development CTranslate2 CUDA lane before T08, and T09 provides independent ignored-local CrispASR `parakeet-family` / `qwen3-family` lanes before T10/T11; neither is a managed or publishable pack. Each downstream task consumes only its matching family result. T14 produces optional CUDA/Vulkan packs and T15 qualifies device routing. A GPU pack overrides CPU only after identity, load and capability checks. Engines with a qualified CPU route fall back with one nonfatal notice; ordinary faster-whisper proven GPU-required instead becomes unavailable with an explanation when no qualified GPU exists. A failed pack is omitted from the release manifest and does not block unrelated CPU routes.

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

1. Establish authoritative ground-truth measurements and the identity-bound Python legacy CUDA baseline, then run/reinterpret native qualification without changing defaults or historical PoC evidence.
2. Introduce protocol and Rust host behind development-only native selection.
3. Productize ordinary CTranslate2 through the T06 CPU root-cause checkpoint, then run T07 development CUDA before T08 regardless of the CPU-ceiling outcome.
4. Productize Kotoba with GPU-first development iteration when the T07 lane is available.
5. Build the T09 CrispASR core together with family-scoped development GPU evidence, then promote T10/T11 independently using only their matching GPU result when available.
6. Build and qualify formal CUDA/Vulkan packs from accepted final engine identities; T07/T09 development diagnostics never substitute for T14/T15 evidence.
7. Switch model/runtime UI and production packaging after required routes are ready and GPU qualification outcomes are explicit.
8. Retain `python-legacy` for one stable source release cycle; do not bundle its runtime.

Rollback is per engine and per runtime pack. A failed native route can return to Python legacy in development while unaffected native routes remain testable. The release package removes Python only after the full integration gate passes. A failed GPU pack is removed from the release manifest; qualified CPU engines fall back to CPU, while a proven GPU-required ordinary faster-whisper route is unavailable/explained rather than silently running an unqualified CPU or Python path.

## Test Strategy

- Fake-worker tests exercise the complete Rust lifecycle without model downloads.
- CTest covers protocol validation, normalization and backend adapters.
- Model-backed suites run manually or in dedicated cached CI; ordinary CI remains dependency-free.
- Rust tests cover routing, model readiness, download integrity, process lifecycle, paths and cleanup boundaries.
- GPU qualification runs on an explicit hardware/driver matrix and records actual loaded modules, pack identity, accelerated RTF and CPU fallback; no VRAM gate is invented.
- Frontend tests cover stable defaults, migrated settings, device availability, visible qualification status for every existing model and removal of Python setup UI.
- The final model-backed matrix recomputes all metrics from T01 ground truth. Subtitle-quality fields are compared per model/case against `python-legacy-cuda-v1`; timeline/UTF-8/text/protocol legality, complete coverage, performance/resources, identity, path, cancellation/recovery, privacy and license remain independent absolute gates.

## Design Decisions

- **D1:** Independent worker over in-process FFI, prioritizing crash isolation and reliable cancellation.
- **D2:** CTranslate2 remains the Whisper backend; CrispASR Whisper is not an automatic fallback.
- **D3:** Rust owns orchestration and downloads; the worker is inference-only.
- **D4:** CPU runtime is bundled as the general baseline, models are not; a specific ordinary faster-whisper route may become GPU-required only after T06 proves a CPU ceiling and T15 qualifies CUDA.
- **D5:** T07 is the early CTranslate2 development CUDA lane and T09 owns separate CrispASR `parakeet-family` / `qwen3-family` development results; all exist to accelerate quality iteration. T07 primary identity uses CUDA 12.8 with `WITH_CUDNN=OFF`; it recorded `development-gpu-ready` with GPU/CPU warmed-median ratios `0.1090` and `0.1313` on short-v1 and the locked 120s sample. Each CrispASR family applies the same paired rule independently through an external attestation envelope because the pinned ABI cannot report resolved device. Development device selection depends only on validated availability and repeatable speedup, never subtitle quality. T14/T15 remain separate normal-numbered supply-chain and qualification deliverables, and no development-lane diagnostic artifact is publishable.
- **D6:** Preserve product IPC before optimizing internal APIs.
- **D7:** Prefer official/model-card/stable API and maintained community algorithms; add compensation only when ground-truth evidence requires it.
- **D8:** No Qwen3 result without ForcedAligner timestamps.
