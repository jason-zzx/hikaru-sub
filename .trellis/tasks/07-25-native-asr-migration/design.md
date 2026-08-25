# 原生 ASR 迁移总体设计

## Summary

本设计定义原生 ASR 迁移的稳定边界和交付顺序。详细模型、体积参考、调研链接与历史协议提案继续保留在 `.trellis/tasks/07-25-native-asr-migration/research/native-asr-technical-design.md`；任务编号/门禁以父任务最新 artifacts 为准，最终 worker wire schema 以 T04 `prd.md`、`design.md` 和其产出的 `native-asr/docs/protocol-v1.md` 为准。

核心变化只有一条：用独立原生 C++ worker 替代生产版 Python FastAPI sidecar。React 的转录工作流和 Tauri command 表面保持稳定，Tauri 从 HTTP 代理升级为原生任务与进程管理者。

## Evidence And Implementation Authority

Algorithm decisions follow this order: validated user `.asr-benchmark` WAV+ASS ground truth; official documentation/stable public APIs/model cards; current well-maintained community recommendations; measured selection against the same ground truth. The identity-bound authority at `.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json` supplies the only Python subtitle-quality gate: same logical model, same case, `python-legacy-cuda-v1`, per metric. Future native qualification uses only `native-gpu-authoritative-v1` GPU rows; a matching CPU route inherits the GPU disposition as `inherited-from-gpu` without CPU model-backed measurements. The archived `.trellis/tasks/archive/2026-08/08-19-native-asr-legacy-quality-reevaluation/research/evidence/native-asr-legacy-quality-reevaluation.json` remains the current forward native disposition authority until a new GPU candidate supersedes it. Historical artifacts are not rewritten, and Python is never expected output, an annotation source, or a relative performance/resource gate.

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

The latest frozen native candidates are not accepted final quality inputs: large-v3 Candidate A and Kotoba K2 are `stop-revise`; Parakeet P1, ReazonSpeech R2 and Qwen T03C have observed `stop-revise` results and remain identity-aware `baseline-incomplete` until T12 freezes the required mappings. T06R has also closed with a truthful `stop-revise / non-qualified` handoff after selecting no beam/history, exact-VAD or upstream-fallback candidate; its later 80-mel parity investigation was invalid for the exact 128-mel large-v3 model and produced no attribution. Production/default therefore stays Python legacy. The first native release is subset-first only after mandatory ordinary Faster-Whisper qualifies; other unqualified models remain visible but unavailable and never silently fall back to Python.

```text
archived quality authority
  -> archived non-qualified T06R -> T06D bounded discovery -> separately planned ordinary candidate ─┐
  -> T08R Kotoba K3 revision ────────────────────────────────────────────────────────────────────────┤
  -> T12 model/companion identity -> T11 ───────────────────────────────────────────────────────────┤ -> accepted selected lanes
  -> T13 provisional CPU package ────────────────────────────────────────────────────────────────────┘
       -> T14 packs -> T15 qualification -> T16 -> T17 -> T18 final rebuild/cutover
```

Parakeet P1 and ReazonSpeech R2 are `visible-unavailable / omitted-current-candidate`; P2/R3 are deferred, not implicit prerequisites.

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

T06's Candidate A/B results remain immutable historical engineering provenance. Candidate A's worker, decode, timing and identity evidence seeded T06R, and Candidate B remains diagnostic-only with ORT/VAD outside T13; neither is an accepted final quality input. T06R closed non-qualified: three model-backed diagnostic scopes selected no candidate, and the later feature/runtime parity attempt used 80-mel inputs against a 128-mel large-v3 model, so it stopped before generation and produced no attribution. T06D now provides one bounded discovery lane: learn exact model-loaded contracts first, reproduce Python/native anchors, then optionally isolate one causal factor. It cannot qualify a route or create another lock-repair chain. Any future ordinary Faster-Whisper candidate is a separate task under `native-gpu-authoritative-v1`. T07 supplies the development GPU seam; T14/T15 own final GPU pack qualification. A matching CPU route inherits only a future qualified GPU disposition and carries no independent CPU model measurements.

The current `faster-whisper==1.2.1` / `ctranslate2==4.8.0` `large-v2` + `ja` + `>=600000ms` V4/seed/session/semantic path remains a mandatory regression case. Any future qualification uses authoritative long-v2; archived large-v2 long-v1 observations remain explicitly historical. T15 owns the corresponding full CUDA validation if a reviewed device branch requires it.

### T06 Closure Branch And Development GPU Handoff

T06 has three mutually exclusive reviewed closure branches. `cpu-qualified` requires the complete CPU matrix and hard gates. `gpu-required-pending` requires same-binary proof of a CPU ceiling and hands the product device decision to T14/T15 without claiming GPU qualification. T07 is a shared post-checkpoint development lane for every branch, not part of the branch decision itself. `migration-handoff-stop-revise` is allowed when the production worker, Candidate A selected CPU baseline, Candidate B reviewed stop-revise evidence, Python non-gating comparison, deterministic publishers, T05 host/protocol tests and downstream handoff are complete while no qualification branch is proven.

The third T06 branch was a truthful historical migration handoff, not a product qualification or GPU-required decision. Candidate A's old absolute/retained-output result and Kotoba K2's old algorithm-input result remain historical only; the legacy-relative authority supersedes both as `stop-revise`. T08R creates K3 while inheriting K2's reviewed bounded-stride, latest-start ownership and exact-dedup safety contracts; it may not reference-match, backfill or rewrite K2 evidence. Future subtitle quality is GPU-authoritative, and matching CPU routes inherit rather than rerun the model matrix. ORT/VAD remains excluded from T13 packaging.

For migration risk only, T06's Python CPU diagnostics remain non-gating historical evidence. T06R compares only against the identity-bound `python-legacy-cuda-v1` rows and does not use Python output to create or repair reference annotations.

CrispASR productization likewise starts with documented upstream behavior. Under the current archived legacy-relative authority, Parakeet P1, ReazonSpeech R2 and Qwen T03C all have observed `stop-revise` results; pending T12 mapping leaves their identity-aware status `baseline-incomplete` but is not the only blocker. T09's development GPU evidence remains reusable engineering input only. T11 owns Qwen grouping and legal ForcedAligner-derived timing, may develop from T09, and cannot publish final evidence until T12 freezes the exact Qwen + ForcedAligner pair. Parakeet/Reazon are omitted from the first pack lane unless a later separately reviewed candidate qualifies.

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

The CPU runtime is an application resource replaced with application upgrades. It is probed but cannot be independently cleaned. T07/T09 provide ignored-local development acceleration only. T12 freezes CT2, GGUF and companion delivery identities. T13 builds only a provisional reproducible packaging pipeline and smoke artifact; no T13 executable/hash is a release identity. T14/T15 may start only after T12/T13 and at least one selected T06R/T08R/T11 lane has accepted final algorithm input, and they package/qualify only those accepted lanes. T18 rebuilds and attests the final immutable worker/runtime from accepted engine identities. A failed or omitted lane remains visible/unavailable and does not block unrelated qualified routes.

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
- T13 produces a provisional Windows CPU packaging artifact and pipeline; T18 rebuilds and attests the final CPU runtime from accepted engine inputs. T14 produces separately versioned CUDA/Vulkan candidates only for accepted selected lanes, each with manifest, component versions, licenses and SHA-256.
- The main installer consumes only the T18-verified final CPU artifact; GPU packs are downloaded and installed under managed `deps/asr-runtime/` only when their own T15 qualification result is publishable.
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

1. Preserve archived evidence, apply the identity-bound Python legacy comparison, and treat all five latest native candidates as non-qualified current inputs.
2. Close T06R as non-qualified, run T06D bounded execution-parity discovery, and create at most one later ordinary Faster-Whisper quality candidate only after model-valid causal attribution. T12 model/companion identity freezing, T08R and T11 proceed within their explicit boundaries and use the same GPU-only qualification policy.
3. Let T13 derisk only the provisional CPU packaging pipeline; it does not freeze the release worker.
4. Start T14/T15 only after T12/T13 and at least one selected post-T06D ordinary Faster-Whisper, T08R or T11 lane has accepted final algorithm input; omit Parakeet/Reazon current candidates by default.
5. Stage T16 runtime/settings, then T17 frontend UX, using stable qualification metadata and visible/unavailable states.
6. Let T18 publish a qualified subset only when ordinary Faster-Whisper is included, rebuild/attest final runtime identities, and preserve every failed model as visible/unavailable without silent Python fallback.
7. Retain `python-legacy` as production/default until T18 passes and as source-level rollback evidence for one stable release cycle.

Rollback is per revision lane and runtime pack. T06R/T08R can be discarded without altering T06/T08 history; T11 cannot publish against an unfrozen companion mapping; T13 provisional artifacts are replaceable. Failed lanes stay disabled and visible, while qualified lanes remain testable. The release package removes Python only after the full integration gate passes.

## Test Strategy

- Fake-worker tests exercise the complete Rust lifecycle without model downloads.
- CTest covers protocol validation, normalization and backend adapters.
- Model-backed suites run manually or in dedicated cached CI; ordinary CI remains dependency-free.
- Rust tests cover routing, model readiness, download integrity, process lifecycle, paths and cleanup boundaries.
- GPU qualification runs on an explicit hardware/driver matrix and records actual loaded modules, pack identity and accelerated RTF; matching CPU routes inherit `inherited-from-gpu` without CPU model-backed rows. No VRAM gate is invented, and CPU metric fields remain absent.
- CPU compilation, protocol, packaging, path and non-model smoke remain independently tested; GPU qualification inheritance does not waive these software and supply-chain checks.
- Frontend tests cover stable defaults, migrated settings, device availability, visible qualification status for every existing model and removal of Python setup UI.
- The final model-backed matrix recomputes all metrics from T01 ground truth. Subtitle-quality fields are compared per model/case against `python-legacy-cuda-v1`; timeline/UTF-8/text/protocol legality, complete coverage, performance/resources, identity, path, cancellation/recovery, privacy and license remain independent absolute gates.
- Planning gates assert archived T06R non-qualified provenance, T06D discovery/acquisition/qualification separation, T08R's new identity, T11's T12-frozen Qwen/ForcedAligner pair, T13 provisional-only status, T14/T15 accepted-lane filtering, ordinary Faster-Whisper mandatory inclusion, and explicit disposition for every visible optional/deferred lane.

## Design Decisions

- **D1:** Independent worker over in-process FFI, prioritizing crash isolation and reliable cancellation.
- **D2:** CTranslate2 remains the Whisper backend; CrispASR Whisper is not an automatic fallback.
- **D3:** Rust owns orchestration and downloads; the worker is inference-only.
- **D4:** CPU runtime remains bundled as the general delivery baseline, models are not. Model qualification is GPU-authoritative: a matching CPU route inherits the final GPU disposition as `inherited-from-gpu` and is not model-benchmarked independently; no CPU measurements are synthesized.
- **D5:** T07 is the early CTranslate2 development CUDA lane and T09 owns separate CrispASR `parakeet-family` / `qwen3-family` development results; all exist to accelerate quality iteration. T07 primary identity uses CUDA 12.8 with `WITH_CUDNN=OFF`; it recorded `development-gpu-ready` with GPU/CPU warmed-median ratios `0.1090` and `0.1313` on short-v1 and the locked 120s sample. Each CrispASR family applies the same paired rule independently through an external attestation envelope because the pinned ABI cannot report resolved device. Development device selection depends only on validated availability and repeatable speedup, never subtitle quality. T14/T15 remain separate normal-numbered supply-chain and qualification deliverables, and no development-lane diagnostic artifact is publishable.
- **D6:** Preserve product IPC before optimizing internal APIs.
- **D7:** Prefer official/model-card/stable API and maintained community algorithms; add compensation only when ground-truth evidence requires it.
- **D8:** No Qwen3 result without ForcedAligner timestamps.
- **D9:** Release governance is ordinary Faster-Whisper mandatory plus a qualified optional subset. Unqualified models remain visible/unavailable; fixed child counts, hidden models and silent Python fallback are not completion mechanisms.
