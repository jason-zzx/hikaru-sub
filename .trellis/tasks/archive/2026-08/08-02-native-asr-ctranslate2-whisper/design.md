# Native CTranslate2 Faster-Whisper 产品化设计

## Summary

T06 将 T02 中已证明正确的底层 primitives 移入 T04 的单一 worker 工程，并替换失败的 long-form orchestration。CPU RTF diagnosis 与 beam selection 已收敛 timestamp-driven/no-history/beam 1，但 accepted long-v1 仍有 7 个 confirmed gap，因此 selected Candidate A 为 `stop-revise`。Candidate B 随后按 `candidate-b-lock.md` 实现 direct official ORT 1.28.0 CPU + ordinary faster-whisper 1.2.1 Silero V6。最后独立审查 blocker 修复后的 final lock `e687ead6...` / config `75dedb49...` 绑定 actual CPU/module paths、两项 restricted PATH root identity 与 fixed relative module layout；它通过 large-v3 short 全部门槛，但 medium 仍有 1 个 confirmed gap `>=1500ms`，因此同样为 `stop-revise` 并在 medium gate 停止；long-v1、其余模型、GPU 与 T07 均未运行，Release/default 保持 Python legacy。

T06 的闭合允许第三个明确分支 `migration-handoff-stop-revise`：当 production worker、selected CPU baseline、Candidate B reviewed evidence、Python non-gating comparison、deterministic publishers、host/protocol tests 和 downstream handoff 完成，但没有 qualification branch 被证明时，任务可以 truthful handoff 停止。该分支不代表 product qualification、CPU ceiling 或 GPU-required decision；native route 继续 disabled，T08 可独立继续 Kotoba/native CT2 工作。

## Architecture

```text
T05 NativeAsrHost::new(production worker, no scenario args, active gate)
  + ResolvedNativeLaunch::resolve(task-local locked model path, resolved cpu)
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

src-tauri/src/asr_worker.rs
  test module only: production worker + locked CT2 model/audio host compatibility
```

`main.cpp` reads one request, uses the shared T04 protocol validator, dispatches only implemented production routes, and emits stable pre-ready errors for others. The Rust addition is test-only: it instantiates the existing T05 host with empty worker args, copies the selected WAV into a temporary managed workspace, resolves the locked model path, and verifies the real worker without changing product/default routing. Do not split audio/tokenizer/prompt/window/decoder into speculative interfaces. Extract a helper only when unit vectors or T07 reuse proves a real seam.

Task evidence:

```text
.trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/
  start-gate-lock.md
  algorithm-lock.md
  candidate-b-lock.md
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

## CPU RTF Root-Cause Design

首轮 T02/T06 差异只用于提出假设；随后同一诊断 binary 对 authoritative medium-v1 首 120s 执行每 cell 一次 excluded warmup + 一次 measured pass。结果为 A fixed/no-history/beam5 RTF `0.842`、B timestamp/no-history/beam5 `0.916`、C timestamp/full-history/beam5 `1.321`、D timestamp/full-history/beam1 `0.988`。A/B 均通过 CPU RTF 门槛，排除当前证据下的固有 CT2 CPU ceiling；B→C `+44.2%` 确认 full-history prefill 为主回归因子，C→D `-25.2%` 证明 beam 5 在 full-history 配置中显著增加总成本。四格矩阵不单独证明 beam/history 交互效应；D 同时产生更高 token/overlap，不能仅凭速度成为产品候选。

在任何新 long run 前，测试 runner 使用同一二进制、模型和不超过 120s 的固定切片运行：

| Cell | Seek | History | Beam |
|---|---|---|---:|
| A | fixed 30s | off | 5 |
| B | timestamp-driven | off | 5 |
| C | timestamp-driven | full official history | 5 |
| D | timestamp-driven | full official history | 1 |

每个窗口记录 prompt/history/prefix/generated token 数、feature/generate 时间、seek/overlap、generation/fallback 次数；进程记录 resolved inter/intra threads、CPU、oneDNN/OpenMP、loaded modules 与可用 ISA。A/B no-history controls 已通过，因此不增加 `return_scores` 或 thread sweep。诊断结果仅用于因果选择，不能进入资格报告；任何 retained candidate 都必须更新 lock/config identity 并重新运行 authoritative short/medium，再决定是否进入 long。

CPU candidate selection 随后只在 authoritative short-v1 上改变 beam size，并在同一 diagnostic binary 中运行 beam 1/5。beam 1 以 CER `0.2667`、RTF `0.632`、0 timeline/gap 成为唯一质量通过且最低成本的 variant；beam 5 复现 CER `0.3583` 失败，因此没有扩展 beam 3/10。新的 selected lock 将 production defaults 冻结为 timestamp-driven、no-history、beam 1；独立审查修正 diagnostic CLI 对 production defaults 的继承并强化证据身份后，以修订 lock 重跑的 authoritative short/medium 分别达到 CER `0.2667/0.1134`、CPU RTF `0.623` warm median/`0.559`，且 RSS、timeline、gap 门槛通过。随后 long-v1 以同一 identity 完成，CER `0.2653`、CPU RTF `0.550`、RSS `3.43 GB`、timeline error 0 均通过，但 7 个 confirmed gap `>=1500ms` 使 large-v3 hard gate 失败。selected CPU candidate 因此为 `stop-revise`，不得进入 large-v2/full matrix。Candidate B 再以独立 final identity 完成 direct ORT/VAD 实现和 T01 short/medium checkpoint：short 全通过，medium 仍有 1 个 confirmed gap，因此 Candidate B 也为 `stop-revise`；按冻结 stop condition 未运行 long、large-v2 或 full matrix。

Device decision 与闭合分支不形成循环依赖：T06 先交付 production-worker seam 和 CPU diagnosis checkpoint。CPU 优化通过 RTF `<=1.0` 时，T06 走 `cpu-qualified` 并完成 CPU 全矩阵；确认 CPU ceiling 时，T06 可经独立审查走 `gpu-required-pending` 并把同一 seam 交给 T07。若 Candidate B 的 reviewed stop-revise evidence、Python non-gating comparison、deterministic publishers、host/protocol tests 和 downstream handoff 已齐，但仍没有资格分支被证明，则 T06 可经独立审查走 `migration-handoff-stop-revise`。后两种状态均保持 route disabled；第三分支不声称 GPU-required 或 product qualification，T07 仅是可选 development CUDA seam，正式七模型 CUDA 资格属于 T14 pack + T15 qualification。

## Candidate Algorithm Ladder

### Candidate A - Official Timestamp-Driven Seek

- 30-second padded model input.
- Parse timestamp tokens and advance source seek using decoded segment end evidence.
- Preserve previous text/prompt according to pinned official behavior; reset on defined temperature/no-speech/failure conditions.
- Handle consecutive timestamps, leading silence, no-speech and final partial window.
- Bound only the verified final WAV end; never manufacture missing speech.

首轮 large-v3 short/medium/long 已暴露 CER/RTF/timeout blocker。Candidate A 保持历史 `stop-revise` 身份。经 CPU RTF 诊断与 bounded short beam selection，新的 selected CPU candidate 关闭 previous-text history并使用 beam 1；独立审查修正诊断/证据缺陷后，它通过修订 identity 的 authoritative short/medium，但 authoritative long-v1 仍产生 7 个 confirmed gap `>=1500ms`。该 candidate 为 `stop-revise`；large-v2/full matrix 未启动。Candidate B 已按独立 final lock 实现和测量，short 通过但 medium 有 1 个 confirmed gap，故也在 long 前停止为 `stop-revise`。

### Candidate B - Locked Faster-Whisper 1.2.1 Silero V6

Candidate A has the required confirmed-gap failure, and `candidate-b-lock.md` now closes the planning gate:

- sole executor: Microsoft ONNX Runtime `1.28.0` official Windows x64 CPU ZIP, direct CPU session inside `CTranslate2WhisperBackend`; no executor interface, provider factory, custom ORT build, Python/sidecar call, or protocol change;
- exact asset: faster-whisper v1.2.1 `silero_vad_v6.onnx` SHA-256 `4cbf549b...`; upstream Silero tag `v6.0`/commit `fba061d...` and MIT LICENSE are attribution only because its tracked ONNX assets are not byte-identical;
- exact ordinary path defaults: PCM16 float division by `32768.0`, 512-sample frames, 64-sample previous-frame context, zero h/c `[1,1,128]`, at-most-10,000-row ORT calls with recurrent carry, threshold/hysteresis `0.5/0.35`, min speech `0ms`, infinite max speech, min silence `2000ms`, pad `400ms`;
- explicitly exclude BatchedInferencePipeline's `160ms` silence / `30s` max-speech policy and current Hikaru Python VAD settings;
- concatenate retained source intervals, decode the compressed stream with the selected Candidate A CT2 config, restore original timestamps through the frozen cumulative-silence map, and report monotonic restored source progress;
- ORT/model/schema/run/timestamp failure is fail-closed. There is no silent Candidate A fallback.

Implementation adds only the direct session and focused CTest probability/interval/restoration goldens. Replacement identity `e687ead6...` binds worker `fb5551...`, runner `421852...`, CT2 `e1204c...`, tokenizer `892142...`, ORT `18370c...`, VAD `4cbf54...`, config `75dedb...`, the Ryzen 7 5800X CPU identity, restricted PATH policy `439a41...`, canonical roots `77f471...`, module layout `a650e1...`, and the exact loaded runner/CT2/tokenizer/ORT/VCOMP module set. The authoritative short checkpoint passes CER `0.2667`, warm RTF `0.654`, cold `29.544s`, RSS `3.44 GB`, timeline/gap 0; medium passes CER `0.1055`, RTF `0.599`, RSS `3.44 GB` and timeline 0 but fails with 1 confirmed gap. The 21-case mutation matrix rejects identity, environment, correlated module-root, metric, timeout and failure drift. Candidate B is `stop-revise`; long-v1 and every other model remain `blocked-not-run`.

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

Cancellation checks occur before ORT/CT2 model load where possible, before/after each at-most-10,000-row VAD call, before/after each CT2 window and before completion. T05 remains authoritative for process-tree cancellation if one ORT or CT2 call is not cooperatively interruptible. Candidate B maps confirmed compressed seek back to original source time; compressed duration and padded model duration never become protocol progress.

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

T06 publishes CPU diagnosis plus exactly one reviewed closure branch: `cpu-qualified` with the complete CPU matrix; `gpu-required-pending` only when the same-binary evidence proves a CPU ceiling; or `migration-handoff-stop-revise` when the worker/evidence/host/downstream handoff is complete without proving either qualification branch. The third branch preserves the 7 Candidate A long gaps, 1 Candidate B medium gap, all remaining models as `blocked-not-run`, the `low-volume` limitation, Python legacy/default routing, and disabled native route. T08 remains the next independent Kotoba/native CT2 task, while T07 remains optional development CUDA only.

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

- Worker reads only task-local locked model/audio paths injected through T05 `ResolvedNativeLaunch`; T12/T16 later replace test/development injection with the production resolver.
- Raw transcripts/token traces remain below canonical ignored task-local root.
- Model files, CT2 DLLs, exe, private WAV/ASS and absolute paths are never tracked.
- stderr is bounded and excludes transcript/request bodies.

## Compatibility And Handoff

- Protocol v1 and `AsrJobSnapshot` stay unchanged; T06 consumes T05's existing host constructor/resolver and adds no second reducer or recovery path.
- T07 consumes the production-worker seam only for ignored-local development CTranslate2 CUDA execution; it does not own packaging, routing policy or release qualification.
- T08 can reuse proven ordinary CT2 primitives but owns Kotoba model-card behavior/cache.
- T12 consumes dispositions and locked file identities for model manifest/readiness.
- T13 consumes frozen dependencies to build the reproducible CPU packaging pipeline/provisional artifact. Candidate B failed its large-v3 medium gate, so ORT/VAD is not an accepted T13 package input; T18 rebuilds and attests only accepted engine identities.
- T14/T15 build and qualify formal GPU packs; they do not retroactively turn T07 diagnostics into release evidence.

## Closure Branches And Downstream Handoff

The task closes only after independent review records exactly one branch. `cpu-qualified` requires the complete CPU matrix. `gpu-required-pending` requires proof of a CPU ceiling and hands the same worker seam to T07/T14/T15 without claiming GPU qualification. `migration-handoff-stop-revise` is the truthful handoff for the current evidence-complete but unqualified state: production worker, selected Candidate A CPU baseline, reviewed Candidate B stop-revise evidence, Python non-gating comparison, deterministic publishers, T05 host/protocol compatibility and downstream handoff are complete, while large-v3/large-v2 hard gates remain unresolved.

In the third branch, Candidate A long-v1 retains 7 confirmed gaps, Candidate B medium retains 1 confirmed gap, remaining models remain `blocked-not-run`, `low-volume` remains a corpus limitation, native faster-whisper remains disabled and Release/default remains Python legacy. T07 is not activated by this branch and remains an optional ignored-local development CUDA seam only; T08 may proceed independently as the next Kotoba/native CT2 task. Candidate B ORT/VAD is excluded from T13 packaging and no branch may use Python parity, reference repair or synthetic timing as qualification.


Disable faster-whisper native route and delete only ignored Candidate B ORT/preflight/build/raw outputs. If Candidate B is not retained, omit ORT/VAD from T13 packaging. Preserve Candidate A/diagnosis/selection/selected evidence, T04 protocol, T05 host and Python legacy; no user cache migration is required.
