# Productize native Qwen3 with ForcedAligner

## Goal

在 Native MVP 发布后，将 Qwen3/ForcedAligner capability 产品化为合法、audio-bounded、ForcedAligner-derived 的字幕时间轴。该任务是 post-MVP engine expansion，不阻塞、撤销或改变首版 `faster-whisper / large-v3 / CPU` 路线。

## Priority And Release Role

- Priority: P3。
- Post-MVP、non-blocking。
- 默认在 T18 和 P1 `08-26-native-asr-whisper-model-expansion` 完成后启动；只有用户再次明确调高优先级时提前。

## Authority And Dependencies

- 依赖归档 T09 的 session、callback、result/alignment ownership 和 qwen3 development seam。
- 归档 T03C/legacy-relative evidence 中 raw character ranges、medium/long timing blocker 和 `stop-revise` 结论保持不变。
- Final evidence 依赖 T12 post-MVP expansion 冻结 exact Qwen ASR + ForcedAligner pair；MVP large-v3 manifest 完成不自动满足该条件。
- Qwen 是否通过只决定后续 Qwen route，不影响已发布 large-v3 CPU MVP。

## Requirements

1. 保留 raw ForcedAligner ranges 作为 provenance，按 pinned upstream token/range/source-segment semantics 分组。
2. Accepted cue 必须非负、非逆序、正时长、audio-bounded、text-conserving；zero-duration final group fail closed，不得 synthetic expand、clip 或平均分配。
3. 同一冻结 candidate 完成 short-v1、medium-v1、long-v2；单 case 失败不截断矩阵。
4. 缺 companion、aligner 失败、leading silence、chunk boundary、tail overrun 和 malformed result 必须稳定失败且零 accepted partial output。
5. 只有 T12 post-MVP frozen ASR/aligner pair 可进入 final evidence；mapping 变化后受影响 rows 重跑。
6. Development GPU evidence 不构成正式 runtime pack、设备或质量资格。

## Acceptance Criteria

- [ ] Grouping/policy tests 独立通过，final evidence 绑定 exact ASR/ForcedAligner revisions、sizes 和 hashes。
- [ ] 三个 case 均有 identity-valid completed 或 structured-failure row，完整矩阵发布独立 disposition。
- [ ] 所有 accepted timing 均可追溯到 legal ForcedAligner grouping；synthetic/mixed/session-native/unknown timing 为 0。
- [ ] 质量、timeline、protocol、identity、path、privacy 和 license 门禁通过后，才可在后续版本启用 Qwen。
- [ ] 任一门禁失败时 Qwen 保持 visible/unavailable，无 failed-row promotion、伪时间轴或 silent Python fallback。
- [ ] 无论结果如何，已发布 large-v3 CPU MVP 路线保持不变。

## Out Of Scope

- Native MVP 首版 release gate。
- T12 MVP large-v3 模型交付、T13 CPU package、T16/T17/T18。
- Parakeet、ReazonSpeech、Whisper 或 Kotoba 质量修订。
- GPU runtime pack 实现。
