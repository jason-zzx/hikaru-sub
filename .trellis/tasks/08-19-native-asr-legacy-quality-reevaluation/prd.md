# Re-evaluate native ASR quality against Python legacy baseline

## Goal

使用已冻结的 `python-legacy-cuda-v1` 模型级基线，重新评估此前已按旧绝对质量门槛得出通过或未通过结论的最新 native 模型候选，发布逐模型、逐 case、逐指标的可审计新结论，同时保持历史 evidence、候选算法、生产路由和独立结构/性能/安全门禁不变。

## Background

- 父任务：`.trellis/tasks/07-25-native-asr-migration`。
- 前置任务 `08-18-native-asr-python-legacy-baseline` 已冻结 6 个逻辑模型的 short-v1、medium-v1、long-v2 Python CUDA baseline，并将字幕质量标准改为同 `logicalModelIdentity × case × python-legacy-cuda-v1` 不劣于 Python legacy。
- 旧任务使用 CER `<=0.35`、semantic gaps 为 0 和 Qwen 绝对时间误差等旧字幕质量门槛；其历史报告与结论不得改写。
- 本任务只重新解释已有 native evidence。完整 evidence inventory 位于 `research/evidence-inventory.md`。

## Candidate Scope

每个逻辑模型只重新评估其当前最新、已冻结且曾获得旧质量结论的候选：

| Logical model | Frozen native candidate | Previous result |
|---|---|---|
| `faster-whisper/large-v3` | T06 Candidate A `selected-cpu-beam1-no-history` | corrected short/medium/long-v2 passed old gates |
| `kotoba-faster-whisper/kotoba-whisper-v2.0-faster` | T08 K2 `kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1` | `accepted-kotoba-algorithm-input` |
| `parakeet/parakeet-tdt_ctc-0.6b-ja` | T10 P1 `P1-window15s-native-word-v1` | `stop-revise` |
| `reazonspeech-nemo/reazonspeech-nemo-v2` | T10R R2 `R2-vad12-pad30-overlap-top-level-v1` | `better-than-r1 + stop-revise` |
| `qwen3-asr/qwen3-asr-1.7b` + required ForcedAligner | T03C corrected Qwen PoC candidate | `stop-revise` |

不纳入没有旧完整模型结论的 `faster-whisper/large-v2`、`tiny`、`base`、`small`、`medium`、`large-v3-turbo`，也不重复评估已被最新候选取代的 T02 fixed-window、Candidate B、Kotoba K1、Reazon R1 等历史候选。

## Requirements

### R1 - Use the frozen comparison authority

- 唯一 Python authority 是归档前置任务中的 `research/python-legacy-baseline.json`、`model-identity-manifest.json` 和 comparison profile `python-legacy-cuda-v1`。
- 每个 native row 只能与相同 logical model、相同 case、相同 profile 的 Python row 配对。
- family-only、跨模型、跨 case、缺失 row、不同 companion 或 identity drift 必须拒绝，不能借用其他结果。

### R2 - Preserve native candidate identity

- 每个模型使用 Candidate Scope 中指定的冻结候选，不改变算法、模型、device、runtime、worker、分块、VAD、beam、时间轴策略或 companion。
- 本任务严格只重评现有冻结 evidence，不重新运行 native inference；用户已于 2026-08-19 确认该范围。
- 历史归档 artifacts 保持不可变；新任务只读取并验证其 tracked/ignored evidence。
- 任何缺少完整现有 evidence 的 case 必须明确标记为 `unscored`、`baseline-incomplete` 或 candidate failure，不得补写、平均、推断或合成结果。

### R3 - Recompute and compare subtitle quality

对每个已完成且 identity-valid 的 native case，通过共享 T01 comparator 重新计算并逐项发布：

- CER；
- substitutions / deletions / insertions；
- empty-text count；
- semantic confirmed-speech-gap count 和 duration；
- Qwen ForcedAligner median/P95，仅在 Python 与 native 两侧 provenance 都 eligible 时比较。

每项都必须包含 Python value、native value、delta、方向、provenance 和 disposition。不得使用 case/model 平均值掩盖任一回退。

### R4 - Keep incomplete and failed rows truthful

- Identity-valid structured native failure仍是该候选的重要结果，但不得获得伪造 CER、gap 或 timing。
- Parakeet P1 long-v2、Reazon R2 long-v2、Qwen medium/long-v2 等失败或零接受输出必须保留其原始 failure boundary。
- 模型的最终报告必须区分：
  - subtitle-quality relative comparison；
  - native evidence completeness；
  - independent structural/non-quality result；
  - release eligibility（本任务不决定）。
- 一个 case 无法比较时，其他 completed cases 仍发布逐项比较，但不得因此宣称整个模型通过。

### R5 - Respect pending native model mappings

- 当前 identity manifest 对 Parakeet、ReazonSpeech、Qwen GGUF/companion 仍标记 `pending-t12-native-model-manifest`。
- 本任务可以发布由旧 evidence 支持的观察值和 provisional per-metric deltas，但不得绕过 manifest 将这些模型标为最终 subtitle-quality qualified。
- 除非后续经独立任务冻结 T12 mapping，否则其最终 identity-aware disposition 保持 `baseline-incomplete`；本任务不接管模型下载器或模型 manifest 产品化。

### R6 - Preserve independent absolute gates

- 新 baseline 只替换字幕质量判定方式。
- timeline legality、UTF-8、text conservation、subtitle/protocol legality、完整 evidence、性能/RSS、identity、process、path、privacy、license、取消和恢复仍按既有绝对门槛独立报告。
- Python 的性能、资源或结构缺陷不能为 native 提供豁免。

### R7 - Publish deterministic sanitized handoff

- 版本化 JSON 是事实来源，Markdown 必须由 JSON 确定性生成。
- 报告至少包含候选 inventory、15 个 expected model/case slots 的状态、逐指标比较、旧结论、新结论、变化原因、identity/mapping limitations 和 downstream handoff。
- tracked 输出不得包含字幕正文、raw segments、音频、模型权重、绝对路径、完整 stderr 或私有 cache 内容。
- ignored raw evidence 必须通过 SHA-256 和原任务 identity 绑定；缺失或变化时 fail closed。

### R8 - Keep downstream boundaries explicit

- 不改变生产路由、worker、Tauri、React、installer、runtime pack 或模型下载行为。
- 结果只更新本任务 handoff 和父任务的前瞻性状态说明；不改写归档任务。
- T11 仍拥有 Qwen 产品级 grouping/timeline policy，T12 仍拥有正式 native model manifest，T14/T15/T18 仍拥有 pack、设备和发布资格。

## Acceptance Criteria

- [x] 五个 scoped logical models 和各自唯一冻结候选均有明确、identity-bound 的输入清单；superseded/未运行模型未被混入。
- [x] short-v1、medium-v1、long-v2 共 15 个 expected slots 均被记录为 completed comparison、validated failure、unscored 或 baseline-incomplete，不存在静默缺失。
- [x] 每个 completed native row 的 CER、S/D/I、empty text、semantic-gap count/duration 均由共享 T01 comparator 重算，并逐项与匹配 Python row 比较。
- [x] Qwen timing 仅在双方 ForcedAligner provenance eligible 时比较；medium/long 零接受输出和 Python long mixed provenance 不产生伪造 timing 结论。
- [x] Parakeet P1、Reazon R2 和 Qwen 的结构性/失败事实不会因相对字幕质量指标更好而被升级为 release-qualified。
- [x] Parakeet、ReazonSpeech、Qwen 的 pending T12 mapping 明确导致最终 identity-aware disposition 为 `baseline-incomplete`，除非正式 mapping authority 已在本任务执行前由独立任务冻结。
- [x] Large-v3 Candidate A 与 Kotoba K2 的完整现有矩阵得到可复核的新 relative-quality disposition，但结果不被表述为整个 Whisper family 或 production release 已通过。
- [x] JSON 重复生成 byte-identical；Markdown 由 JSON 确定生成；mutation tests 拒绝 baseline、model/case/profile、candidate、artifact/companion、raw hash 和 metric drift。
- [x] privacy/path/ignore 检查通过，tracked artifacts 不含私有字幕、路径、媒体、模型或日志正文。
- [x] 父任务前瞻性 handoff 准确反映新结论，归档任务内容保持不变。

## Out of Scope

- 开发新 ASR 算法或修复旧候选质量。
- 产品化 Qwen grouping/ForcedAligner timeline（T11）。
- 冻结正式模型下载 manifest、URL、revision 和 readiness（T12）。
- 新建或资格化 CPU/GPU runtime packs（T13～T15）。
- 设置、前端、安装包或 production route 切换（T16～T18）。
- 重写历史旧门槛报告或把 Python 输出用作 WAV+ASS reference。

## Decision Recorded

- 本任务严格只重评现有冻结 evidence，不重新运行 native inference。
- 已有 failed/incomplete rows 保持 `unscored`、`baseline-incomplete` 或 candidate failure；不通过补跑、参数变化、模型变化或算法修订将其补齐。
