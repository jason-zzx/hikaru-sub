# Native ASR Legacy Quality Re-evaluation Design

## Summary

本任务建立一个只读、离线的历史 evidence 重新评估流水线。它不运行 native inference，不改变候选身份，也不改写归档 artifacts。流水线读取五个最新候选的现有 tracked identity/publication 与 ignored raw/adapted evidence，通过共享 T01 comparator 重算字幕质量，再与 `python-legacy-cuda-v1` 同模型同 case rows 逐项比较，最后发布确定性、去敏的 JSON/Markdown handoff。

## Boundaries

```text
archived tracked publications + archived ignored raw evidence
                  |
                  | validate path / hash / candidate identity
                  v
      task-local historical evidence adapters
                  |
                  | normalized completed or failed case rows
                  v
        shared T01 metric recomputation
                  |
                  | same logical model + case
                  v
      python-legacy-cuda-v1 comparison authority
                  |
                  v
 tracked deterministic JSON -> generated Markdown -> parent handoff
```

本任务不包含：模型运行、模型下载、runtime pack、产品路由、Qwen timeline 修复、T12 manifest 产品化或任何前端/Tauri 改动。

## Source Authorities

### Python authority

- `.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json`
- `.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/model-identity-manifest.json`
- `scripts/asr-legacy-baseline.py`
- `scripts/asr-benchmark.py`

### Native candidate authorities

- large-v3 Candidate A：T06 selected CPU evidence，long-v2 解释以 T08 corrected CT2 handoff 为准。
- Kotoba K2：T08 K2 publication 与 ignored K2 adapted/raw evidence。
- Parakeet P1：T10 publication、raw index 与 ignored Parakeet rows。
- ReazonSpeech R2：T10R publication、raw index 与 ignored formal rows。
- Qwen T03C：T03C corrected publication 与 archived T03 ignored Qwen rows。

归档 tracked 文件只读；ignored evidence 只作为本机原始输入，不复制到当前任务 tracked 输出。

## Candidate Lock

新增 task-local `research/native-evidence-lock.json`，对每个候选记录：

- logical model identity；
- candidate ID 和旧 disposition；
- authoritative tracked publication/handoff 路径与 SHA-256；
- 每个 case 的 ignored source 路径与 SHA-256；
- expected completed/validated-failed/unaccepted status；
- model/companion、worker、runtime、device 和关键 input-lock identities；
- adapter kind；
- 当前 mapping readiness。

Publisher 在读取字幕/segment 前先验证整个 lock。路径必须是仓库相对路径，并位于列明的 archived task-local ignored roots。缺失、hash drift、candidate drift 或跨任务替换均 fail closed。

## Adapter Strategy

旧任务的 raw schemas 不完全一致，因此使用最少的显式适配代码，不引入通用插件框架：

- `large-v3-candidate-a`：读取 T06 native benchmark envelopes；short/medium 直接使用冻结 samples，long 使用同一 retained native output 并绑定 T08 long-v2 correction authority后对当前 long-v2 reference 重算。
- `kotoba-k2`：读取 T08 `research/local/k2/adapted/{case}.json`，验证对应 raw/publication hashes。
- `parakeet-p1`：读取 T10 per-sample raw；completed rows 使用 `finalSegments`，long 保留 identity-valid structured failure。
- `reazonspeech-r2`：读取 T10R formal raw；completed rows 使用 `finalSegments`，long 保留已审查的 zero-duration failure fingerprint。
- `qwen-t03c`：读取 archived T03 rows；short 仅接受现有合法 ForcedAligner-derived output，medium/long 保留零 accepted timed output 与 `segment-legality-failed`。

适配结果使用 task-local 内存对象，不生成包含字幕正文的 tracked canonical files。若需要调试中间 envelope，只能写到当前 task 的 ignored `research/local/`。

## Metric Recalculation

Completed row 的 final segments 必须交给 `scripts/asr-benchmark.py` 的共享 reference parser/metric implementation：

1. 验证 current benchmark manifest、WAV hash、ASS hash、duration 和 case ID。
2. 从本地 ASS 在内存中派生 reference text/segments/speech intervals。
3. 调用共享 metric reduction，重算 CER、S/D/I、empty text、semantic gaps 和 timing diagnostics。
4. 不信任旧 publication 中可编辑的聚合 metric fields；旧 fields 只用于 mutation/cross-check。

不得把 Python 输出用于 reference，也不得把 failed row 修补为 completed row。

## Relative Comparison

比较 key 固定为：

```text
logicalModelIdentity × caseId × python-legacy-cuda-v1
```

每个 relative metric 输出：

```json
{
  "metric": "insertions",
  "direction": "lower-or-equal",
  "baseline": 10,
  "native": 12,
  "delta": 2,
  "disposition": "stop-revise"
}
```

Qwen timing 只有双方 `forced-aligner` provenance 且 eligible 时比较。否则单项为 `unscored`，并保留双方 provenance/reason。

## Disposition Model

为避免把“字幕质量比较”“证据完整性”“独立结构门禁”和“发布资格”混为一谈，每个模型分别发布：

- `subtitleQualityDisposition`：`qualified | stop-revise | baseline-incomplete | unscored`；
- `nativeEvidenceDisposition`：`complete | validated-failure | incomplete | invalid`；
- `independentGateDisposition`：沿用旧候选的合法结构/非质量结论，失败继续为 `stop-revise`；
- `releaseEligibility`：固定为 `not-decided-by-this-task`。

规则：

1. 任一 completed case 的任一 relative metric 回退，subtitle quality 为 `stop-revise`。
2. Native structured failure/unaccepted row 不产生伪 metric；模型不能被标为完整质量通过。
3. Baseline row 完整但 native row失败时，原因是 native evidence/candidate failure，不伪称 Python baseline 缺失。
4. Parakeet/Reazon/Qwen 的 manifest mapping 仍 pending T12 时，即使 observed completed metrics 全部不回退，最终 identity-aware subtitle disposition 仍为 `baseline-incomplete`；同时保留 `observedMetricDisposition` 供查看实际差值。
5. large-v3 通过只代表该 anchor；`whisperFamilyDisposition` 保持 blocked，不能代替 large-v2。
6. 独立结构/性能/安全 gate 失败永远阻止整体候选升级。

## Output Schema

### JSON source of truth

`research/evidence/native-asr-legacy-quality-reevaluation.json` 至少包含：

- schema/kind/version；
- baseline/manifest/publisher/lock hashes；
- candidate inventory；
- 15 个 expected slots；
- per-case relative metrics 或 validated failure；
- old disposition、new observed disposition、identity-aware disposition；
- independent gate and release boundaries；
- limitations 和 downstream handoff。

### Generated Markdown

`research/native-asr-legacy-quality-reevaluation.md` 由 JSON 确定生成，展示：

- 模型级摘要；
- 每 case 的 Python/native/delta；
- old → new disposition；
- failed/unscored/mapping-pending 原因；
- 明确说明“不等于 production qualification”。

另写简短的 `research/native-asr-legacy-quality-handoff.md` 供父任务引用。

## Implementation Location

优先新增 task-local stdlib-only 工具：

- `research/publish_native_legacy_quality.py`
- `research/test_publish_native_legacy_quality.py`
- `research/native-evidence-lock.json`

工具通过 `importlib` 复用 `scripts/asr-benchmark.py` 与 `scripts/asr-legacy-baseline.py`，不复制 CER/gap/timing 算法。除非实现时发现共享 comparator 存在无法绕开的合同缺陷，否则不修改生产代码或通用脚本。

## Determinism And Privacy

- JSON 使用稳定 key/order 与原子写入；生成时间来自冻结输入而非当前时钟，或完全省略非确定时间。
- 同一输入连续生成两次，JSON 和 Markdown 必须 byte-identical。
- tracked 文件只含 IDs、hashes、aggregate metrics、statuses 和 limitations。
- 测试扫描绝对 Windows/Unix 路径、reference/native 字幕正文、媒体扩展、模型 bytes、stderr 内容和私有 cache 字样。

## Validation Strategy

- Synthetic unit tests覆盖每个 adapter kind、completed/failure rows、metric regression、pending mapping、Qwen timing provenance 和 deterministic render。
- Mutation tests覆盖 baseline/hash/profile/model/case/candidate/artifact/companion/raw status/failure fingerprint drift。
- 实际 publisher运行两次并比较 bytes。
- 运行既有 benchmark self-check 和 legacy baseline tests，确认共享合同未回退。
- 不运行 native model inference；任何命令若启动 worker/model即视为范围违规。

## Parent And Downstream Updates

实现完成后仅更新父任务的前瞻性 planning/handoff：

- 记录五个模型的新 legacy-relative 结论；
- 保留 large-v2/T11/T12/T14/T15/T18 的剩余边界；
- 不改写 T06/T08/T10/T10R/T03C 归档报告。

## Rollback

删除当前任务新增 publisher/tests/lock/evidence，并恢复父任务的前瞻性引用即可。无 production route、模型、设置、缓存或用户数据迁移需要回滚。
