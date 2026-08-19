# Productize native Qwen3 with ForcedAligner

## Goal

将 T09 已证明的 Qwen3/ForcedAligner capability 产品化为合法、audio-bounded、ForcedAligner-derived 的字幕时间轴，并在完整 short-v1/medium-v1/long-v2 矩阵上得到可审计的独立 disposition。

## Authority And Dependencies

- 开发依赖归档 T09 `native-asr-crispasr-backend` 的 session、callback、result/alignment ownership 与 `qwen3-family` development GPU seam。
- 阻塞条件来自归档 T03C 和 legacy-relative reassessment：raw character ranges 不是 accepted cues，medium/long 无合法 accepted timing，observed result 为 `stop-revise`。
- T12 `native-asr-model-manager` 可与本任务并行，但 final publication 必须消费其冻结的精确 Qwen ASR + ForcedAligner mapping。
- 字幕质量只比较匹配的 identity-bound `python-legacy-cuda-v1` row，并遵循 `.trellis/spec/asr/quality-guidelines.md`。

## Requirements

1. 保留 raw ForcedAligner ranges 作为 provenance，按精确 pinned upstream token/range/source-segment semantics 分组；session getter 或 generic engine-native timing 不可成为 accepted timing。
2. 最终 cue 必须合法、非负、非逆序、正时长、audio-bounded、text-conserving；zero-duration final group fail closed，不得 synthetic expand、clip 或平均分配时间。
3. 同一冻结 candidate 完成 short-v1、medium-v1、long-v2；单 case 质量失败不得截断矩阵。
4. 缺 companion、aligner 失败、leading silence、chunk boundary、tail overrun 和 malformed result 必须产生稳定失败且零 accepted partial output。
5. 只有 T12-frozen ASR/aligner pair 可进入最终 evidence；mapping 变化后受影响 rows 必须重新获取。
6. T09 GPU evidence 只决定开发加速，不构成正式 pack、设备或质量资格。

## Acceptance Criteria

- [ ] T12 前可完成的 grouping/policy tests 独立通过；final evidence 明确绑定 T12 冻结的 ASR/ForcedAligner revisions、sizes 和 hashes。
- [ ] short-v1/medium-v1/long-v2 均有 identity-valid completed 或完整 structured-failure row，并由完整矩阵发布一个 disposition。
- [ ] 所有 accepted timing 均可追溯到 legal ForcedAligner grouping；synthetic/mixed/session-native/unknown timing 数量为 0。
- [ ] 每个 case 的 CER、S/D/I、空文本、semantic gaps 及双方 provenance eligible 时的 start median/P95 均不劣于匹配 Python row，并通过全部绝对硬门禁，才可发布 accepted algorithm handoff。
- [ ] 任一门禁失败时 Qwen 保持 visible/unavailable，且没有 failed-row promotion、伪时间轴或 silent Python fallback。

## Forbidden Premature Claims

- 不得在 T12 mapping 冻结前发布 final `qualified`、accepted algorithm input 或 pack-ready 结论。
- 不得以 T09 capability、短音频成功、raw character ranges 或 reference-based repair 声称 subtitle readiness。
- Qwen 可作为 optional lane；其未通过不得阻塞已通过的 mandatory ordinary Faster-Whisper，但必须保持可见且不可用。

## Out Of Scope

- T12 下载器实现、T13/T14/T15 runtime/pack 工作。
- Parakeet、ReazonSpeech、Whisper、Kotoba 质量修订。
- 设置、前端、安装器或 production/default 切换。
