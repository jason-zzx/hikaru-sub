# 原生 ASR 迁移实施总计划

> 状态：父任务保持 `planning`；Gate 0/1 已关闭。归档 legacy-relative 重评是当前前瞻性质量 authority：large-v3 Candidate A、Kotoba K2、Parakeet P1、ReazonSpeech R2 与 Qwen T03C 的 observed disposition 均为 `stop-revise`，其中后三者在 T12 mapping 冻结前 identity-aware 为 `baseline-incomplete`。当前没有 subtitle-quality qualified native candidate；native routes 仍未切换，ORT/VAD 不进入 T13，Release/default 保持 Python legacy。下一阶段先恢复 mandatory ordinary Faster-Whisper 质量并并行冻结模型 identity，再进入 accepted-lane pack、设置、前端和 T18 cutover。

## Execution Policy

- 后续 native 发布资格必须先消费 `.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json`：字幕质量只按同 `logicalModelIdentity × case × python-legacy-cuda-v1` 逐项非回退；结构/证据安全、性能资源、协议、取消恢复、路径、隐私和许可证继续使用既有绝对硬门禁。历史归档 evidence 不改写，仅由父任务和新 handoff 前瞻性 reinterpret。
- 最新历史 evidence 重评 authority 为 `.trellis/tasks/archive/2026-08/08-19-native-asr-legacy-quality-reevaluation/research/evidence/native-asr-legacy-quality-reevaluation.json`：large-v3 Candidate A 与 Kotoba K2 在逐指标 legacy-relative gate 下均为 `stop-revise`；Parakeet P1、ReazonSpeech R2 与 Qwen T03C 的 observed metrics 也为 `stop-revise`，且因 T12 mapping pending，identity-aware subtitle disposition 保持 `baseline-incomplete`。large-v2、T11、T12、T14/T15/T18 边界和全部 production routes 不变。
- 本父任务保存总需求、总体设计、任务地图和跨任务门禁，通常不执行 `task.py start`。
- 子任务按 gate 增量创建，不一次性激活未来任务，也不使用固定 child 数量作为完成合同；创建近期任务时使用 `--parent <parent-dir> --no-start`。
- 每个子任务在启动前必须完成自己的 `prd.md`、`design.md`、`implement.md` 和上下文清单。
- 任务树不表达依赖。下表的 `Depends on` 必须复制到对应子任务规划。
- 一个子任务只有在自己的验收和相关质量检查通过后才能归档。
- 本仓库未经用户单独明确授权不得提交。归档使用 `task.py archive <task> --no-commit`。

## Phase And Gate Overview

```text
Gate 0: feasibility
  T01 -> T02 + T03

Gate 1: native task foundation
  T02 + T03 -> T04 -> T05

Gate 2: archived engine evidence + quality recovery
  T05 -> T06 -> T07; archived T06/T07 + legacy reassessment -> T06R
  T07 -> archived T08; archived T08 + legacy reassessment -> T08R
  T06 -> T09 -> archived T10/T10R
  T09 -> T11 development; T12 frozen Qwen + ForcedAligner mapping -> T11 final publication
  T02 + T03 + archived identity manifest -> T12

Gate 3: provisional package, accepted-lane packs and UI
  T04 + T06 -> T13 provisional packaging pipeline
  T12 + T13 + at least one accepted T06R/T08R/T11 lane -> T14
  T14 candidate-built packs + exact accepted lane identities -> T15
  T12 + T13 + T15 -> T16
  T12 + T16 + stable qualification metadata -> T17

Gate 4: release cutover
  all required infrastructure + ordinary Faster-Whisper qualified + explicit visible-lane dispositions -> T18
```

Allowed parallel groups:

- T02 and T03 after T01.
- T06 after T05. T07 starts after T06 exposes the production-worker seam and completes the CPU root-cause checkpoint; it does not depend on proving a CPU ceiling and does not wait for a GPU-required decision.
- T06R starts from archived T06/T07 plus the Python baseline and legacy-relative reassessment. It creates a new candidate identity; T07's `development-gpu-ready` result accelerates iteration but is not T15 qualification.
- T08R starts from archived T07/T08 safety evidence plus the same baseline/reassessment. K3 inherits bounded stride, ownership and exact-dedup contracts without changing K2 history or using reference-based repair.
- T12 may start immediately from proven model formats and the archived identity manifest. It freezes CT2, GGUF, license/file-role and Qwen companion identities without changing any quality disposition.
- T11 may develop from T09 while T12 runs, but final evidence cannot publish until the exact T12-frozen Qwen + ForcedAligner pair is consumed.
- T13 waits only for the T04/T06 worker seam and may run provisionally in parallel; T18 owns the final worker/runtime rebuild and attestation.
- T14/T15 wait for T12/T13 and at least one accepted final T06R/T08R/T11 lane. Parakeet P1 and ReazonSpeech R2 are omitted-current-candidate by default; no P2/R3 is implied.
- T16 then T17 remain staged on T12/T13/T15 and stable qualification metadata. T07/T09 development GPU artifacts never substitute for formal pack evidence.

## Task Map

### Phase 0 - Ground Truth And Feasibility

#### T01 - Establish Native ASR Benchmark Ground Truth

Suggested slug: `native-asr-benchmark-baseline`

Deliverables:

- Freeze the user-provided `.asr-benchmark` short/medium/long WAV+ASS identities, reference semantics, privacy rules and metric schema as the only quality truth.
- Record the confirmed 24.102s/8, 498.872s/165 and 4144.235s/908 Dialogue metadata without copying local subtitle text or media.
- Implement shared absolute CER, confirmed-speech-gap, timeline, Qwen alignment, timing, performance and resource scoring.
- Publish the user-reviewed frozen absolute budgets: CER `<=0.35` per engine/case; CPU RTF `<=1.0`; GPU-accelerated RTF `<=0.5`; short cold wall `<=120s`; CTranslate2 RSS `<=6 GiB`; CrispASR RSS `<=12 GiB`; no VRAM gate.
- Capture current Python engine results only as optional diagnostic/current-implementation references; publish `python-reference-report.md` only after valid runs.

Depends on: none.

Exit criteria:

- Ground-truth manifest/reference/metrics and deterministic comparison are reviewed and reusable by T02/T03.
- Hard gates retain 0 invalid timeline, 0 confirmed gap `>=1.5s`, and Qwen median/P95 limits.
- Python limitations are documented but do not block native quality comparison.
- No private media, ASS text, credentials, absolute paths or model weights enter source control.

Validation:

```text
Existing Python sidecar tests
Ground-truth harness self-checks
Local authoritative manifest validation
Optional Python reference report
```

Rollback point: no production path changes.

#### T02 - Prove CTranslate2 Whisper And Kotoba PoC

Suggested slug: `native-asr-ctranslate2-poc`

Deliverables:

- Minimal pinned CMake build using CTranslate2 C++ Whisper API.
- Run large-v3 and Kotoba v2.0 on T01 authoritative cases; T02 remains a general CT2 feasibility scope.
- Choose tokenizer/mel/timestamp/decode direction from official APIs/model cards and maintained community practice, then measure against ground truth.
- Record current Python outputs only as optional diagnostics; their absence or parity does not decide feasibility.
- Measure CPU runtime footprint, RTF and memory without changing application defaults.

Depends on: T01 ground-truth contract and metric handoff; optional Python reference is not required.

Exit criteria:

- Both engines produce legal Japanese segment timelines and ground-truth measurements.
- Kotoba model-card/readiness obligations are understood without treating current Python chunking as the native template.
- PoC reports measured/pass/fail/blocked against the frozen T01 gates, without treating Python diagnostics as expected output or claiming later productization gates are complete.
- No unresolved licensing or binary-distribution blocker.

Rollback point: discard PoC without touching production ASR.

Verified T02 Gate 0 result:

- Pinned CTranslate2 4.8.0 + oneDNN 3.1.1 Windows x64 CPU runtime is viable for both large-v3 and Kotoba without Python/CUDA; all six short/medium/long runs have legal token-derived timelines and stay within CPU RTF/RSS budgets.
- Current minimal fixed-window algorithm is `stop-revise`: large-v3 short misses CER (`0.3583 > 0.35`), and both routes fail medium/long confirmed-speech-gap gates. Only Kotoba short passes every gate.
- T06 may continue with CTranslate2 as backend candidate, but must revise long-form seek/VAD/segmentation/decode behavior and remeasure against T01 before productization.

#### T03 - Prove CrispASR Three-Engine PoC

Suggested slug: `native-asr-crispasr-poc`

Deliverables:

- Pin CrispASR and exercise its public C ABI.
- Run Parakeet JA Q8_0, ReazonSpeech Q8_0 and Qwen3-ASR Q4_K with ForcedAligner Q4_K on T01 authoritative cases.
- Record segment/progress/final-refresh behavior, long-audio limits, runtime footprint and model licenses; current Parakeet, Qwen3 and ReazonSpeech refresh behavior is diagnostic only.
- Select chunking/VAD/segmentation from official/model-card/maintained community guidance and ground-truth results, not Python parity.

Depends on: T01 ground-truth contract and metric handoff; optional Python reference is not required.

Exit criteria:

- All three engines produce legal Japanese timelines and direct ground-truth measurements or explicit native blockers.
- Qwen3 timing comes from the aligner, not synthetic averaging.
- Known long-audio coverage gaps and required compensation are ground-truth and authoritative-source backed.
- Each route reports measured/pass/fail/blocked against the frozen T01 gates without claiming later productization work is complete.

Rollback point: discard PoC without affecting CT2 work or production ASR.

Verified T03 Gate 0 result:

- CrispASR v0.8.22 public CPU C ABI, callback/reset/cleanup lifecycle and all three model routes are executable under one immutable Windows x64 binary/runtime identity.
- Historical T03C long-v2 correction recorded Reazon `proceed-with-named-risks`: corrected CER `0.1333/0.2857/0.2944` and original text/performance/timeline/gap gates passed, but top-level output remained one oversized segment and native words were mostly zero-duration. The later legacy-relative authority supersedes this as a current release disposition.
- Parakeet remains `stop-revise` after corrected CER `0.4917/0.6123/0.5962`; top-level output remains one giant segment despite useful native word getters.
- Qwen remains `stop-revise`: corrected short CER `0.2083` passes but ForcedAligner start timing fails severely; medium/long-v2 remain validated unscored `segment-legality-failed` blockers. Synthetic timing remains prohibited.

**Gate 0:** Closed for backend/runtime feasibility. T04/T05 proceeded because CT2 and CrispASR can execute safely in isolated native processes. Archived route quality blockers now feed T06R/T08R/T11 or explicit omitted dispositions and still prevent production promotion; a future finding of fundamental ABI, license or package non-viability reopens Gate 0.

### Phase 1 - Worker Protocol And Rust Task Foundation

#### T04 - Build Worker Protocol And Fake Worker

Suggested slug: `native-asr-worker-protocol`

Deliverables:

- Create the focused `native-asr/` project and protocol v1 request/event types.
- Implement request validation, stdout JSONL discipline and stderr diagnostics.
- Provide deterministic fake-worker scenarios for success, progress, segment replacement, structured error, malformed output, crash and cancellation.
- Add CTest protocol and normalization coverage without model downloads.

Depends on: T02, T03.

Exit criteria:

- Protocol behavior is versioned and tested independently of real models.
- Fake worker can drive every host lifecycle branch needed by T05.

Rollback point: protocol has no production command wiring yet.

#### T05 - Replace HTTP Proxy With Native Rust Job Host

Suggested slug: `native-asr-rust-job-host`

Deliverables:

- Implement single-active-job state and worker process lifecycle in Rust.
- Preserve existing Tauri command names and `AsrJobSnapshot` shape.
- Parse/reduce JSONL events, write recovery snapshots, terminate the process tree on cancel/exit and classify abnormal exits.
- Keep a development-only Python legacy path for comparison.
- Cover all lifecycle branches with the fake worker.

Depends on: T04.

Exit criteria:

- Success/progress/replace/error/cancel/crash tests pass without models.
- Cancellation exits within two seconds in tests.
- React contracts require no product-flow rewrite.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

Rollback point: keep production default on Python legacy until engine gates pass.

**Gate 1:** Do not productize model backends until host lifecycle and recovery behavior are deterministic under fake-worker tests.

### Phase 2 - CTranslate2 Productization

#### T06 - Productize CTranslate2 Faster-Whisper

Suggested slug: `native-asr-ctranslate2-whisper`

Deliverables:

- Create the production `hikaru-asr-worker` CMake executable/entry point on top of T04's protocol library; fake worker remains a separate test-only target.
- Implement product-model WAV/features/tokenizer/prompt/window/timestamp/no-speech/alignment behavior from official CTranslate2/Whisper sources and maintained recommendations.
- Enumerate all current ordinary faster-whisper models (`tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, `large-v3-turbo`). The T06 CPU branch measures the complete matrix; a reviewed `gpu-required-pending` branch keeps provisional dispositions and assigns the complete CUDA matrix to T15; a reviewed `migration-handoff-stop-revise` branch may hand off complete worker/evidence/host/protocol/downstream materials while preserving provisional dispositions and `blocked-not-run` models. `large-v3` and `large-v2` Japanese audio over 10 minutes remain hard route gates in either qualification branch, including the current V4/seed/session regression cases.
- Treat current Python parameters and private fork as diagnostics, not required native algorithms.
- Before closing a CPU performance failure, run the same-binary minimized RTF matrix and record per-window prompt/history/prefix/generated tokens, feature/generate timing, seek/overlap, fallback count, threads and oneDNN/OpenMP/module/ISA evidence.
- Normalize overlap into stable segments, emit monotonic progress, and publish model-backed absolute quality/performance/resource results.

Depends on: T02, T04, T05.

Exit criteria:

- CPU branch: `large-v3` and required `large-v2` long-audio cases meet T01 CPU CER/RTF/resource gates, and every other model receives a measured disposition.
- GPU-required branch: the same-binary matrix proves a CPU ceiling, independent review accepts the device decision, and T06 publishes a `gpu-required-pending` handoff to T14/T15. T07 remains the shared post-checkpoint development lane and may already be complete; ordinary faster-whisper stays disabled until T15 qualifies the full CUDA matrix.
- Migration-handoff branch: when the production worker, selected CPU baseline, reviewed Candidate B stop-revise evidence, Python non-gating comparison, deterministic publishers, host/protocol tests and downstream handoff are complete without proving qualification, T06 may complete as `migration-handoff-stop-revise`; this is not a product qualification or GPU-required decision, and the completed seam hands off first to T07 development CUDA before T08.
- CPU `stop-revise` is final only after the root-cause matrix; it never makes ordinary faster-whisper optional or qualifies a GPU route.
- Any future ordinary Whisper quality qualification requires both `large-v2` and `large-v3` short/medium/long-v2 anchors to be independently no worse than their own Python legacy rows; only then may the other five Whisper models use the family unlock. No anchor borrows the other's metrics.
- Invalid/overflow/negative/reversed timeline, UTF-8/text/protocol legality, complete coverage and existing CPU RTF/cold wall/RSS/identity/process/path/security gates remain absolute for every qualified model.
- Large-v2 long-audio remains a mandatory regression case: T06 owns it on the CPU branch, while T15 owns it on the GPU-required branch.

Rollback point: retain Python faster-whisper as development default.

T06 checkpoint is immutable historical provenance: it established the production worker seam, root-cause diagnostics, Candidate A/B evidence and T07 development handoff, but did not qualify ordinary Faster-Whisper. The archived legacy-relative reassessment now classifies the latest large-v3 Candidate A as `stop-revise`; Candidate B remains diagnostic-only, ORT/VAD stays outside T13, the route remains disabled, and T06R owns the next candidate rather than rewriting T06.

#### T07 - Integrate Development CTranslate2 CUDA Execution

Suggested slug: `native-asr-ctranslate2-cuda-development`

This is an early development lane, not a managed runtime pack or release qualification task.

Deliverables:

- Build the pinned CTranslate2 source with the declared Windows CUDA 12.8 toolkit below an ignored task-local root. The primary development identity follows the upstream 4.8.0 Windows CMake shape with `WITH_CUDA=ON` and `WITH_CUDNN=OFF`; cuDNN 9.10.2 is reviewed but not downloaded/installed unless a separately reviewed root-cause revision requires a new build identity. Do not alter the main installer, portable ZIP or trusted runtime manifests.
- Reuse the same `hikaru-asr-worker`, protocol v1, CTranslate2 backend and selected algorithm; add only resolved `device=cuda` execution required by the existing route matrix.
- Record actual GPU model/driver, loaded CUDA/CT2 modules and requested/resolved device rather than trusting a device string; the primary no-cuDNN identity rejects unexpected `cudnn*.dll` modules.
- Run paired CPU/GPU diagnostics on short-v1 and the locked medium-v1 first-120s slice. Each sample/device uses `1 cold + 3 warm`; both GPU warmed median RTF values must be at most `80%` of the paired CPU median to retain GPU for T08. Report the release target `RTF <=0.5` separately.
- Preserve T05 process isolation, cancellation and stdout/stderr contracts.

Depends on: T04/T05 plus the T06 production-worker seam and completed CPU root-cause checkpoint; it does not require T06 task completion.

Exit criteria:

- The ignored-local CUDA build loads on the declared machine and produces legal protocol output through the existing host.
- Actual GPU execution and loaded modules are attested; CPU execution mislabeled as CUDA fails closed.
- Diagnostic evidence is explicitly non-publishable and does not claim downloader, fallback, pack reproducibility or release qualification.
- Publish exactly one development result: `development-gpu-ready` when actual CUDA execution is attested and both sample GPU warmed medians are at most `80%` of CPU; `development-gpu-unavailable` only from a validated configure/build/load/device failure envelope; or `development-gpu-no-speedup` when valid CUDA execution completes but either sample misses the `20%` speedup. Invalid/incomplete evidence publishes no result. CER, confirmed gaps, segmentation and timeline quality do not affect this result.
- Proving a CPU ceiling is not an activation condition. `RTF <=0.5` remains a T15 publishable-pack gate rather than a hard requirement for retaining a development GPU path that is already faster than CPU; all formal seven-model qualification/publication remains T15 work.

Rollback point: delete only ignored development CUDA outputs and keep the CPU worker/protocol unchanged.

Verified T07 result:

- `development-gpu-ready` on RTX 3070 device 0/FLOAT16, CUDA 12.8.93, CTranslate2 4.8.0, `WITH_CUDNN=OFF`.
- short-v1 CPU/GPU warmed median RTF `0.577901/0.062971` (`0.1090` ratio).
- locked medium-v1 first-120s CPU/GPU warmed median RTF `0.591635/0.077707` (`0.1313` ratio).
- CUDA-only module set: `nvcuda.dll`, `cublas64_12.dll`, `cublasLt64_12.dll`; no cuDNN. Development evidence is non-publishable and quality-independent.

#### T06R - Revise Ordinary Faster-Whisper Quality

Suggested slug: `native-asr-whisper-quality-revision`

Deliverables:

- Create a new reviewed candidate identity; do not edit Candidate A/B artifacts or dispositions.
- Explain and address every observed large-v3 legacy-relative S/D/I/CER regression without reference-derived text/timing repair.
- Complete large-v3 and large-v2 short-v1 / medium-v1 / long-v2 matrices under frozen identities, continuing after individual quality failures.
- Reuse T07 only as a development GPU seam; leave formal device/pack qualification to T14/T15.

Depends on: archived T06 and T07, the identity-bound Python legacy baseline, and the archived native legacy-quality reassessment.

Exit criteria:

- Both anchors independently meet their same-model/same-case Python non-regression matrix and all absolute structural, performance/resource, identity, path, protocol, cancellation/recovery, privacy and license gates.
- Ordinary Faster-Whisper remains disabled and blocks T18 if either anchor is not qualified; other Whisper models are not unlocked early.
- Publication uses a new candidate identity and preserves all T06 evidence unchanged.

Rollback point: discard only the new T06R candidate/evidence and keep T06/T07 plus Python legacy/default unchanged.

#### T08 - Productize Kotoba And Legacy CT2 Cache Compatibility

Suggested slug: `native-asr-kotoba-compatibility`

Deliverables:

- Implement Kotoba behavior from its pinned model card/stable APIs and T01 ground-truth results; current Python 15-second/no-context behavior remains diagnostic reference.
- Keep `preprocessor_config.json` readiness Kotoba-only.
- Resolve valid old Hugging Face CTranslate2 snapshots without copying them.
- Verify overlap and long-audio behavior directly against ground truth.

Depends on: T06 and a reviewed T07 result of `development-gpu-ready`, `development-gpu-unavailable` or `development-gpu-no-speedup`. T07 is a development-order and performance decision, not a Kotoba subtitle-quality or release-qualification result.

Exit criteria:

- Kotoba quality iteration uses the T07 CUDA lane whenever its result is `development-gpu-ready`; CER, confirmed gaps, segmentation or timeline failures stay on GPU. CPU is retained only for required regression/fallback evidence, or when T07 records GPU unavailable/no speedup.
- Kotoba subtitle quality is independently no worse than `kotoba-tech/kotoba-whisper-v2.0-faster` under `python-legacy-cuda-v1` for every required case/metric; timeline/protocol legality and performance/resource/identity/security evidence retain their existing absolute gates.
- Ordinary faster-whisper readiness is not tightened accidentally.
- Old valid CT2 caches are reusable and malformed caches fail safely.

Rollback point: disable only Kotoba native routing.

Historical T08 handoff: K2's bounded-stride, latest-start ownership and exact-dedup mechanics remain reviewed safety provenance, but the archived legacy-relative reassessment classifies K2 as `stop-revise`; it is not an accepted T14/T15 input.

#### T08R - Revise Kotoba K3 Quality

Suggested slug: `native-asr-kotoba-quality-revision`

Deliverables:

- Create a new K3 identity while inheriting K2's reviewed bounded-stride/ownership/exact-dedup contracts.
- Address the complete observed legacy-relative text regression distribution without changing K2 evidence.
- Complete short-v1 / medium-v1 / long-v2 under one frozen K3 identity, continuing after individual quality failures.
- Forbid reference matching, fuzzy/reference-based dedup, backfill, gap fill or synthetic timing used to obtain a pass.

Depends on: archived T07 and T08, the identity-bound Python legacy baseline, and the archived native legacy-quality reassessment.

Exit criteria:

- K3 is independently no worse than its same-model Python rows for every required quality field and passes all absolute engineering gates.
- Only a qualified K3 may become an accepted T14/T15 lane; otherwise Kotoba remains visible/unavailable.
- K2 history and its raw/tracked evidence remain unchanged.

Rollback point: discard only K3 candidate/evidence and retain K2 as immutable disabled historical provenance.

### Phase 3 - CrispASR Productization

#### T09 - Build CrispASR Backend Core

Suggested slug: `native-asr-crispasr-backend`

Deliverables:

- Wrap the pinned public session/result/progress/segment/alignment C ABI subset.
- Map callbacks to protocol events with safe ownership; preserve T05 hard process-tree cancellation because pinned v0.8.22 exposes no cooperative cancel ABI, and do not claim session destructors run after termination.
- Share audio/result normalization selected from stable CrispASR APIs and ground-truth evidence, without Python-parity product hacks. No CrispASR VAD candidate is selected in T09, so `useVad=true` fails closed instead of being ignored or pre-implementing T10/T11 policy.
- Preserve the strict Qwen seam: prove session and ForcedAligner capability/ownership, but emit zero accepted timed output and `qwen_timeline_policy_not_implemented` until T11 owns grouping/timeline policy.
- Establish ignored-local CUDA development execution and publish independent `parakeet-family` / `qwen3-family` results from the user-approved external module/device/performance/mutation envelope; do not claim a public ABI-resolved device.
- Record ABI/library commit in task-local development locks and handoff; T14/T15 retain production runtime-manifest ownership.
- Current T09 implementation handoff is `.trellis/tasks/08-07-native-asr-crispasr-backend/research/crispasr-backend-handoff.md`. It publishes `parakeet-family: development-gpu-ready` (short/locked-120s GPU-to-CPU warmed-median ratios `0.119318/0.110944`) and `qwen3-family: development-gpu-ready` (`0.211832/0.327830`) under one frozen runtime/runner/raw-index identity. T10/T11 consume only their matching family result; neither result is a publishable pack or quality qualification.

Depends on: T03, T05, T06 production-worker seam.

Exit criteria:

- Backend opens/closes sessions safely and maps deterministic fake/native results to JSONL.
- For both `parakeet-family` and `qwen3-family`, independently publish `development-gpu-ready`, `development-gpu-unavailable` or `development-gpu-no-speedup` using the same paired warmed CPU/GPU performance rule as T07. Subtitle quality does not affect either result; the path is not a managed pack or release qualification artifact.
- ABI errors, invalid models and cancellation do not crash the host application.

Rollback point: keep all CrispASR engine routes disabled.

#### T10 - Productize Parakeet And ReazonSpeech

Suggested slug: `native-asr-parakeet-reazon`

Deliverables:

- Route Parakeet JA Q8_0 and ReazonSpeech Q8_0 through the shared backend.
- Validate native timestamps, subtitle segment size and the complete short-v1 / medium-v1 / long-v2 matrix against T01 truth for both engines; a single quality-gate failure does not truncate the remaining cases.
- Use T09's `parakeet-family` development GPU path for repeated model-backed quality iteration whenever that family result is `development-gpu-ready`; CER, gap and segmentation failures stay on GPU. Reserve CPU runs for required regression/fallback evidence, final candidate gates, or a matching unavailable/no-speedup result.
- Start from official/model-card/maintained community guidance; add only compensation demonstrated necessary by ground-truth failures.
- Support final `segmentsReplace` when the selected pipeline performs a final correction; do not assume refresh is Parakeet-only. Current Reazon `>=60s` 45s/2s-overlap behavior is a diagnostic regression case, not a required native algorithm.

Depends on: T09.

Exit criteria:

- ReazonSpeech and Parakeet each receive an independent, identity-bound `qualified` or `stop-revise` disposition from their reviewed candidate gate. T10 may complete after both frozen full matrices publish truthful independent dispositions, including `stop-revise` for both; a failed engine remains disabled and supplies no accepted downstream algorithm input.
- Every engine marked `qualified` is independently no worse than its own model-level Python legacy rows for CER/S-D-I, empty text and semantic gaps; it also passes unchanged absolute RTF/resource, timeline/UTF-8/text/protocol legality, identity, process, path, privacy, cancellation/recovery and license gates. A `stop-revise` engine remains disabled and is not promoted downstream.
- No Q4 Parakeet repeated-loop default is introduced.

Rollback point: engines switch independently; one failure does not disable the other.

T10 implementation handoff: `.trellis/tasks/08-13-native-asr-parakeet-reazon/research/t10-handoff.md`. Frozen R1/P1 both publish `stop-revise`: Reazon short/medium fail semantic-gap/CER gates and long-v2 has a complete `crispasr_result_invalid` trace; Parakeet short passes, medium fails CER/gaps, and long-v2 fails closed on text conservation. Neither supplies an accepted T14/T15 algorithm input, and Release/default remains Python legacy.

#### T10R - Optimize ReazonSpeech R2 Quality

Suggested slug: `native-asr-reazonspeech-r2`

Deliverables:

- Replace R1's arbitrary fixed 15-second inference boundaries with the smallest reviewed official/community-backed candidate; primary direction is pinned CrispASR Silero-VAD speech slices capped at 12 seconds and cut at energy minima.
- Keep Q8_0, the current pinned CrispASR runtime, CUDA development lane, protocol v1, atomic final replacement, T01 comparator and `96 code points / 15000ms` cue limits unchanged for the primary candidate.
- Complete short-v1 / medium-v1 / long-v2 under one frozen R2 identity, even when an earlier quality gate fails.
- Publish both the existing absolute quality disposition and a separate R1-relative selection result. A candidate that is materially better than R1 may be retained for further development without being qualified or enabled.
- Activate a gap-fill, F16, official subword decoder or other secondary candidate only after the primary matrix identifies the remaining causal blocker and a new identity is reviewed.

Depends on: T09 and completed T10 R1 evidence.

Exit criteria:

- R2 has a complete identity-valid matrix and independent `qualified | stop-revise` disposition.
- R2 additionally publishes `better-than-r1 | no-material-improvement` using explicit CER/gap/completion non-regression rules from the child task.
- `better-than-r1 + stop-revise` remains disabled and supplies no accepted T14/T15 algorithm input; it is only the preferred basis for a later revision. Any later release qualification compares the new frozen Reazon identity against the same-model Python legacy rows, not against R1 alone.
- No Parakeet, Qwen, release route, downloader, settings, frontend, installer or runtime-pack work is mixed into T10R.

Rollback point: restore R1/T09's disabled Reazon route and discard only the R2 candidate/evidence; keep T10 history immutable.

T10R implementation handoff: `.trellis/tasks/08-14-native-asr-reazonspeech-r2/research/reazonspeech-r2-handoff.md`. The same frozen candidate publishes `stop-revise + better-than-r1` after final-check fixes restored the generic T09/T10 CrispASR decoder, separated the R2-only Step 6 required decoder, and replaced broad error-code equality with an identity-bound failure fingerprint. Short-v1 CER/gaps remain `0.266667 / 1`, medium-v1 `0.295385 / 19`, and long-v2 completes 61 calls before its 62nd attempt—zero-based window `61`, `[763590,768570]ms`—returns the reviewed `zero_duration_top_level_result` fingerprint `35b1f992ca3619d7e985ee3e9bb33f01280bed48829766bafbe01ee1892dc93e`. Medium CER improves by `0.081758` absolute with no PRD-R5 anti-regression finding. Reazon remains disabled, supplies no accepted T14/T15 algorithm input, and no gap-fill/F16/decoder/ownership candidate is activated without a new user-reviewed plan.

#### T11 - Productize Qwen3 With ForcedAligner

Suggested slug: `native-asr-qwen3-aligner`

Deliverables:

- Treat the exact T12-frozen Qwen3 1.7B Q4_K and ForcedAligner 0.6B Q4_K mapping as one model product; development may precede T12, but final evidence may not.
- Select chunking/alignment/segmentation from official/model-card/maintained community guidance and ground-truth results; Python synthetic or refresh behavior is diagnostic only.
- Complete the same frozen Qwen3 candidate across short-v1 / medium-v1 / long-v2 even when an earlier case fails a quality gate; publish the disposition only from the full matrix.
- Use T09's `qwen3-family` development GPU path for repeated Qwen3/ForcedAligner quality iteration whenever that family result is `development-gpu-ready`; CER, gap and alignment failures stay on GPU. Reserve CPU runs for required regression/fallback evidence, final candidate gates, or a matching unavailable/no-speedup result.
- Fail when alignment is missing/invalid; never synthesize timestamps.
- Aggregate progress and allow a final `segmentsReplace` when required by the chosen pipeline.

Depends on: T09 for development capability; T12 for final Qwen + ForcedAligner artifact/companion authority.

Exit criteria:

- Qwen3 CER/S-D-I, empty text and semantic gaps are independently no worse than the same-model Python legacy row for every case; RTF/resource and all engineering gates remain absolute.
- Start-time median/P95 are compared only when both Python and native rows have eligible ForcedAligner provenance; mixed/synthetic/unknown timing yields `unscored`/`baseline-incomplete`, never qualification.
- Missing companion, alignment failure, leading silence and chunk-boundary cases are tested; timeline remains legal and the ASR/aligner native artifact pair exactly matches T12's frozen mapping.
- No final `qualified` or accepted algorithm handoff is published before T12 completes.

Rollback point: disable only Qwen3 native routing.

**Gate 2:** Each engine is promoted independently only after its quality report passes. Failed CrispASR routes do not block already-qualified CT2 routes during development.

### Phase 4 - Models, Runtime And Settings Backend

#### T12 - Build Native Model Manifest And Downloader

Suggested slug: `native-asr-model-manager`

Deliverables:

- Add versioned `asr-model-sources.json` with fixed revision, URL, size, SHA-256, license and file roles for CT2 and GGUF artifacts, including the exact Qwen ASR + ForcedAligner companion pair.
- Implement official/China source resolution, safe `.part` resume, verification, atomic moves and multi-file readiness markers.
- Coalesce duplicate model downloads and preserve verified companion files after partial failure.
- Measure all of `deps/models`, including legacy cache, without marking incompatible weights ready.

Depends on: T02, T03.

Exit criteria:

- Routing/readiness/hash/atomic-install/legacy-cache/portable-path tests pass.
- Cleanup cannot escape managed `deps/`.
- No floating `main` is the sole release lock; every Qwen final evidence row can bind the exact frozen ASR/aligner pair.
- Mapping completion does not promote an observed `stop-revise` candidate or repair missing/illegal timing.

Rollback point: retain existing model downloader while native engines remain development-only.

#### T13 - Produce Reproducible CPU Runtime Package

Suggested slug: `native-asr-cpu-runtime-package`

Deliverables:

- Pin CTranslate2, CrispASR, compiler, CMake, Ninja and native dependencies.
- Build the reproducible CPU runtime packaging pipeline and a provisional integration artifact with worker/DLL/manifest/license/SHA-256 shape; do not claim its executable identity is final before accepted engine identities land.
- Add verified artifact preparation hooks for `pnpm release:local` and portable packaging without switching production inputs.
- Compile only required ASR capabilities and measure provisional setup/portable/unpacked size.
- Define the T18 final rebuild/attestation input contract so accepted engine source/device identities produce the immutable release artifacts.

Depends on: T04, T06.

Exit criteria:

- End-user packaging never invokes CMake.
- The packaging pipeline is reproducible and a provisional protocol/backend smoke artifact works in installed and portable layouts with zero bundled model weights.
- Provisional size measurement demonstrates the CPU budget is plausible; T18 must rebuild and re-attest the final worker after all accepted engine code lands.
- No provisional hash or executable is represented as the final release identity.

Rollback point: do not alter production packaging until artifact verification and size gates pass.

#### T14 - Build Optional GPU Runtime Packs

Suggested slug: `native-asr-gpu-runtime-packs`

Deliverables:

- Produce separately versioned Windows x64 CUDA and Vulkan runtime packs from the pinned native worker/backends without placing either pack in the main installer or portable ZIP.
- Keep CT2 CUDA and CrispASR CUDA/Vulkan dependencies isolated under `deps/asr-runtime/{cuda,vulkan}/current` with exact manifest, DLL, compiler, driver-floor, size, SHA-256, license and attribution identities.
- Reuse protocol v1 resolved device values (`cpu`, `cuda`, `vulkan`); do not introduce a second worker protocol or backend-specific host executable.
- Add deterministic pack preparation/verification suitable for managed download; end-user machines never compile native dependencies.

Depends on: completed T12 and T13, plus at least one accepted final algorithm input from T06R, T08R or T11. T07/T09 development GPU evidence may inform builds but is not qualification. Parakeet P1 and ReazonSpeech R2 are `omitted-current-candidate` unless a later separately reviewed candidate qualifies; no P2/R3 is implied.

Exit criteria:

- CUDA and Vulkan are each attempted and independently recorded as `candidate-built` or `stop-revise` with immutable build/load/license evidence; one failed candidate does not prevent T14 completion.
- Every `candidate-built` pack is reproducible, hash-verified, contains no models, and can load its intended backend on a declared target machine.
- CUDA/Vulkan DLL discovery cannot shadow unrelated system/application binaries or escape the managed pack root.
- Main setup/portable artifacts remain CPU-only and within their existing size budgets.
- Missing, invalid or `stop-revise` pack identity fails closed before worker launch.

Rollback point: remove the affected optional pack artifact/manifest; the bundled CPU runtime remains unchanged.

#### T15 - Qualify GPU Routing And Acceleration

Suggested slug: `native-asr-gpu-qualification`

Deliverables:

- Rebuild each T14 `candidate-built` pack from final accepted engine source/config/device identities, freeze executable/DLL/manifest hashes, and use only that exact identity for qualification.
- Implement capability probing and resolved routing for the rebuilt candidate packs. Engines with a qualified CPU route may fall back to CPU; ordinary faster-whisper proven GPU-required is unavailable/explained when qualified CUDA is absent.
- Record T14 `stop-revise`/unbuilt candidates as omitted without attempting to route them.
- Validate actual loaded modules and device execution rather than trusting a requested device string.
- Run the applicable complete T01 short-v1 / medium-v1 / long-v2 matrix for every selected engine/model candidate on explicit hardware/driver identities; compare subtitle quality per metric against the same-model/same-case `python-legacy-cuda-v1` row, require accelerated inference RTF `<=0.5` and all structural/security gates absolutely, and continue later cases after any single quality-gate failure.
- If a reviewed device branch activates T15, it owns the complete seven-model ordinary faster-whisper CUDA dispositions: `large-v3` and `large-v2` short/medium/long-v2 remain hard gates; archived long-v1 observations are historical only. The other five models receive measured `qualified`, `stop-revise` or `unsupported-for-native-release` results.
- Verify pack-load/runtime failure produces one nonfatal notice: engines with a qualified CPU route retry that bundled CPU path without losing job/recovery semantics, while ordinary faster-whisper proven GPU-required becomes unavailable without launching its unqualified CPU route.
- Publish an independent `qualified`, `stop-revise` or `omitted-no-candidate` decision for CUDA and Vulkan; no non-qualified pack blocks CPU cutover.

Depends on: T12, T13, T14 candidate-built packs, and the exact accepted T06R/T08R/T11 lane identities included by T14. Omitted or non-qualified lanes are recorded without routing attempts. Ordinary Faster-Whisper remains mandatory for release even if another optional lane qualifies first.

Exit criteria:

- Every publishable pack is rebuilt from final accepted engine sources, is no worse than the matching model-level Python quality baseline on every applicable case/metric, and meets timeline/UTF-8/text/protocol legality, accelerated RTF, fallback, immutable identity, path/security/privacy and license gates independently.
- No VRAM gate is invented; measured VRAM may be reported as diagnostic metadata.
- CPU results remain unchanged in kind; CPU fallback passes where the engine has a qualified CPU route, and GPU-required route unavailability passes lifecycle/UI contract tests.
- Unsupported hardware/driver combinations are explicit and never presented as accelerated.

Rollback point: mark only the failing pack `stop-revise` and remove it from the release manifest; keep CPU and other qualified packs available.

#### T16 - Migrate Runtime Dependency And Settings Backend

Suggested slug: `native-asr-runtime-settings-backend`

Deliverables:

- Replace production Python/venv dependency kinds with built-in CPU runtime, qualified optional GPU packs, models, downloads and app cache.
- Integrate only the exact T15-qualified GPU pack hashes into the trusted runtime-source manifest and existing managed downloader: `.part`/resume where supported, exact size/SHA-256 verification, atomic activation under `deps/asr-runtime/{cuda,vulkan}/current`, and rollback that preserves the prior valid pack.
- Keep CPU runtime built-in/non-cleanable; keep GPU packs managed/downloadable/cleanable; preserve probe vs measure and async `spawn_blocking` cleanup.
- Migrate settings by ignoring legacy Python paths and mapping known engine/model/device values; unavailable GPU selections resolve to a qualified CPU route when one exists, otherwise the route is unavailable with one clear notice.
- Expose per-model native qualification metadata without removing any current model identity.
- Update command/types/wrappers as one cross-layer contract where required.

Depends on: T12, T13 and T15; T05 remains inherited host foundation, not a substitute for these completion gates.

Exit criteria:

- Installed/portable path, legacy settings, pack source/download/resume/hash/atomic update/rollback, probe, measure and cleanup tests pass.
- Production dependency probe no longer searches for Python 3.11 or venv and does not recursively measure storage.
- Cleanup remains bounded under managed `deps/`; built-in CPU cannot be deleted.
- Failed/uninstalled GPU packs and unqualified models cannot be selected as runnable native routes.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

Rollback point: preserve old settings fields as ignored input until migration is proven; avoid destructive settings rewrites.

### Phase 5 - Frontend Migration

#### T17 - Migrate ASR Runtime And Model UX

Suggested slug: `native-asr-frontend-migration`

Deliverables:

- Replace Python setup panel with native CPU/GPU runtime and model status/actions.
- Show CPU as built in and qualified GPU packs as optional; expose runnable devices only when the engine, pack and qualification metadata agree.
- Continue displaying every current model. Show native qualification state and disable or explain unavailable native routes instead of hiding models or silently falling back to Python.
- Preserve current transcribe polling/document guards and model-download progress flow.
- Remove production copy referencing Python, venv, pip and service directories.
- Cover old settings/default fallback and companion download aggregation.

Depends on: T12, T16 and stable T15 qualification metadata. T06R/T08R/T11 accepted or omitted dispositions drive availability; Parakeet P1 and ReazonSpeech R2 remain visible but unavailable unless a later candidate qualifies.

Exit criteria:

- Existing transcription and ASS generation behavior remains intact.
- Every current model remains visible with accurate runnable/unsupported state.
- Device/model UI tests and `pnpm build` pass.
- No raw invoke or duplicate runtime state is introduced.

Validation:

```bash
pnpm test
pnpm build
```

Rollback point: UI can continue exposing the legacy setup path until backend contracts are stable; do not ship a mixed UI/runtime contract.

**Gate 3:** Do not enter release cutover until T12 identity delivery, T13 provisional packaging, T15 accepted-lane qualification, T16 settings backend and T17 visible/unavailable UX work together on installed and portable layouts. Ordinary Faster-Whisper must be qualified; optional failed lanes are explicitly omitted/visible-unavailable rather than hidden or silently routed to Python. Any shared contract mismatch returns to its owning T12～T17 child.

### Phase 6 - Integration And Release Cutover

#### T18 - Qualify And Cut Over Native ASR Release

Suggested slug: `native-asr-release-cutover`

This task is a release gate, not a place to finish missing engine or GPU implementation.

Deliverables:

- Run the complete authoritative matrix for every selected publishable lane; no single quality-gate failure truncates the remaining cases. Publication includes per-model/per-case Python baseline/native/delta/direction/provenance/disposition plus independent absolute structural, performance/resource and engineering results. The released subset must include qualified ordinary Faster-Whisper; optional lanes may be omitted only with explicit disposition.
- Verify cancel, crash, recovery, qualified CPU fallback or GPU-required unavailability, offline cached-model use, installed and portable behavior.
- Switch production packaging/default routes only for qualified engines and packs; keep every failed model visible/unavailable with no silent Python fallback, then stop bundling Python sidecar/runtime/venv.
- Freeze a complete source/dependency/compiler/algorithm-config input lock, rebuild and attest the final immutable CPU runtime from accepted engine identities, and re-verify every publishable GPU artifact matches the exact T15-qualified hash; then verify setup/portable/runtime sizes, third-party licenses and zero bundled model weights while CUDA/Vulkan remain external packs.
- Remove or stop packaging obsolete production setup resources while retaining source-level legacy baseline for one stable release cycle.
- Update README/notices and, only after architecture lands, update `AGENTS.md` and `.trellis/spec/{asr,tauri,frontend}`.
- Run final cross-child contract review against the parent PRD.

Depends on: all required infrastructure children, T12/T13/T14/T15/T16/T17, qualified mandatory T06R, and final dispositions for T08R/T11 plus every visible Parakeet/Reazon/device lane. T18 consumes only accepted engine identities; omitted-current-candidate and unsupported lanes remain disabled and visible.

Exit criteria:

- Every parent acceptance criterion is evidenced or explicitly blocks release.
- Ordinary Faster-Whisper is included and both large-v3/large-v2 anchors are qualified; the optional subset is non-empty only in addition to that mandatory route.
- All required test commands and worker CTest pass.
- No unresolved P0/P1 quality, data-loss, path-security or license issue on the CPU baseline or any publishable GPU pack.
- Failed engines return to their owning child and remain visible/unavailable; failed GPU packs are omitted according to T15 rather than patched ad hoc here.

Final validation:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
# Native worker CMake configure/build + CTest commands are fixed by T04/T13/T14.
```

Rollback point: restore the previous production package inputs and per-engine/pack route without rewriting user projects or deleting caches. Never require a destructive settings/model migration for rollback.

**Gate 4:** Archive the parent only after T18 passes, all required children are independently accepted/archived, and every optional/deferred lane has an explicit `qualified`, `omitted-current-candidate` or `unsupported-for-native-release` disposition.

## Cross-Task Review Checklist

- [ ] Command/state/type names remain aligned across worker, Rust and TypeScript.
- [ ] Parent engine-route table matches model manifest and UI metadata.
- [ ] Every engine has model-backed metrics recomputed against T01 ground truth and legal timestamps; subtitle quality uses only the same-model/same-case `python-legacy-cuda-v1` row, while missing/cross-model rows and Python performance never authorize release.
- [ ] Qwen3 readiness and execution always include the ForcedAligner.
- [ ] Portable/installed roots and cleanup boundaries are covered.
- [ ] Probe performs no recursive storage scan.
- [ ] Runtime/model downloads are pinned, hashed and atomically installed.
- [ ] CPU package and optional GPU packs contain runtime only, no model weights; GPU packs are not bundled in the main installer.
- [ ] GPU routing proves actual loaded acceleration, preserves qualified CPU fallback, enforces GPU-required route unavailability, and omits failed packs without blocking unrelated CPU release routes.
- [ ] Every current model remains visible in T17 with qualification-driven availability; no unsupported model silently falls back to Python.
- [ ] T06R and T08R use new identities without rewriting T06/T08 evidence; T11 final evidence binds T12's exact Qwen/ForcedAligner pair.
- [ ] T13 artifacts remain provisional; T14/T15 contain only accepted selected lanes; T18 owns the final rebuild/attestation.
- [ ] Ordinary Faster-Whisper is mandatory, while Parakeet P1/ReazonSpeech R2 and any other failed optional lane have explicit visible/unavailable dispositions.
- [ ] Python legacy remains production/default until T18 and development-only during the agreed post-cutover rollback window.
- [ ] Current-state specs are updated only when their owning architecture change lands.
- [ ] No child was treated as complete with failing or unavailable mandatory checks.

## Parent Review Gate

Stage 0 child-task creation:

- [x] User reviewed and approved the parent `prd.md`, `design.md` and task map.
- [x] T01-T03 were the first creation batch and remain immutable archived provenance; T08 corrected CT2 and T03C corrected CrispASR remain historical long-v2 backend evidence, while the archived legacy-relative reassessment is the current forward quality authority.
- [x] T02 proved the CTranslate2 backend/runtime viable while recording the current fixed-window algorithm as `stop-revise`.
- [x] T03 proved the CrispASR ABI/runtime viable and historically recorded Reazon `proceed-with-named-risks` plus Parakeet/Qwen `stop-revise`; Gate 0 backend/runtime feasibility is closed, and the later legacy-relative authority controls current release disposition.
- [x] User approved moving development GPU integration earlier: normal-numbered T07 provides CTranslate2 CUDA development immediately after the T06 CPU checkpoint and before T08 regardless of CPU-ceiling outcome; T09 provides family-scoped CrispASR development GPU results before T10/T11. The user also approved T09's external device attestation and strict Qwen policy seam. Formal packs/qualification remain T14/T15, and development GPU evidence never substitutes for release evidence.
- [x] User approved T06 hard gates for `large-v3` and `large-v2` long audio; ordinary faster-whisper remains mandatory and all models remain visible in T17 even when native qualification fails.
- [x] User approved the legacy-relative roadmap reprioritization: no latest native candidate is currently subtitle-quality qualified; ordinary Faster-Whisper remains mandatory; optional failed models remain visible/unavailable; production/default remains Python legacy.
- [x] The next planning batch is T06R, T12, T11, T08R and T13. T14～T18 remain map entries created incrementally after their gates; Parakeet P2 and ReazonSpeech R3 are deferred pending a separate user-reviewed investment decision.
- [x] T11 final publication requires T12's exact Qwen + ForcedAligner mapping; T13 is provisional-only; T14/T15 consume accepted T06R/T08R/T11 lanes; T18 owns final immutable runtime rebuild/attestation.
- [x] T07 completed the ignored-local CTranslate2 CUDA lane and independently froze `development-gpu-ready`; archived T08 uses that development seam, while T14/T15 remain the only pack/release qualification owners.
- [x] T04-T06 were created as the next planning batch and linked to this parent.
- [x] T04 completed protocol/limits/fake-worker implementation, independent check, commit and archive.
- [x] T05 completed generic Rust host/active gate/reducer/recovery/process-tree lifecycle, independent check, commit and archive; Gate 1 is closed.
- [x] T06 manifests consume final T04 protocol/limits, T05 durable Tauri host spec and archived host evidence; its scope includes only focused Rust test-module additions for real-worker compatibility.
- [x] T06 `start-gate-lock.md` records Candidate A, one conditional Candidate B asset, seven immutable model revisions/weight hashes/MIT licenses, Tiny remote-only status and the ignored active/archive local root.
- [x] T06 start-gate planning update is reviewed; the user authorized committing it and starting T06 immediately afterwards.
- [x] T06 Candidate A implementation and independent check completed a truthful provisional baseline: short CER and medium/long CPU performance block promotion; Candidate B was not activated; six remaining models are `blocked-not-run`.
- [x] T06 same-binary warmed CPU RTF diagnostic gate is implemented and measured; A/B pass while C fails, so no inherent CPU ceiling or GPU-required handoff is claimed.
- [x] T06 bounded short beam selection chose beam 1/no-history and froze a separate selected identity. Its historical long-v1 7-gap result is superseded; T08 retained-output correction passes long-v2 at CER `0.1509` with zero semantic gaps/timeline errors. Full ordinary model qualification remains follow-up work.
- [x] T06 Candidate B planning lock selects only official ORT 1.28.0 Windows x64 CPU and ordinary faster-whisper 1.2.1 Silero V6, records exact asset/attribution/package identities, and passes an ignored-local direct CPU/no-custom-op smoke.
- [x] T06 Candidate B direct session/focused CTest/final path-bound identity and historical T01 short/medium publication are complete. Its old medium gap is an excluded vocalization under current policy; Candidate B is diagnostic-only, long remains unnecessary, and ORT/VAD is not a T13 package input.
- [x] T06 reran the same-corpus Python `large-v3` CPU diagnostics with the development interpreter and application HF_HOME. The sanitized report records short CER `0.358`/warm inference RTF `0.886`/1 timeline error, medium CER `0.099`/1 timeline error/1 gap, and long CER `0.295`/0 timeline errors/1 gap; these remain non-gating diagnostics and do not replace absolute native gates.
