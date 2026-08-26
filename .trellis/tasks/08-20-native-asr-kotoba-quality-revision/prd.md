# Revise native Kotoba K3 quality

## Goal

在 Native MVP 发布后，建立新的 Kotoba K3 candidate，继承 K2 已审查的长音频安全机制并改善字幕质量。该任务是 post-MVP engine expansion，不阻塞、撤销或改变首版 `faster-whisper / large-v3 / CPU` 路线。

## Priority And Release Role

- Priority: P3。
- Post-MVP、non-blocking。
- 默认在 T18 和 P1 `08-26-native-asr-whisper-model-expansion` 完成后启动；只有用户再次明确调高优先级时提前。

## Authority And Dependencies

- 依赖归档 T07 development CTranslate2 CUDA seam 和归档 T08 K2 的 bounded-stride、latest-start ownership、exact-dedup、progress、cache compatibility 合同。
- K2 历史 disposition 保持 `stop-revise`，不得改写。
- 未来模型交付依赖 T12 的 post-MVP Kotoba manifest/readiness expansion。
- 字幕质量比较继续遵循用户 benchmark 和 identity-bound Python legacy evidence；这些门禁只决定 Kotoba 是否可独立启用，不影响已发布 MVP。

## Requirements

1. 冻结新的 K3 candidate/algorithm/config/binary/model identity，不覆盖 K2。
2. 保留 K2 的 bounded stride、ownership、exact tuple dedup 和 monotonic progress，除非新 identity 经过独立评审。
3. 不得 reference-match、reference-based dedup、backfill、gap fill、fuzzy merge、clip/stretch 或 synthetic timing。
4. 同一冻结 K3 identity 完成 short-v1、medium-v1、long-v2；单 case 失败不截断矩阵。
5. 保持 Kotoba-only preprocessor、128-mel、window 和 cache readiness 合同，不改变 ordinary Whisper MVP。
6. 只有 qualified K3 才能在后续版本启用；失败时保持 visible/unavailable。

## Acceptance Criteria

- [ ] K3 identity 与 raw/runner/worker/runtime/model hashes 冻结，K2 evidence 无修改。
- [ ] 三个 case 均有 identity-valid completed 或 structured-failure row，最终 disposition 来自完整矩阵。
- [ ] stride、ownership、dedup、progress、text conservation、timeline 和 protocol tests 通过。
- [ ] 每个 case 的质量和独立工程门禁满足该 post-MVP task 的冻结标准后，才可发布 Kotoba accepted handoff。
- [ ] 失败时发布 truthful non-qualified disposition，无 reference repair、伪时间轴或 silent Python fallback。
- [ ] 无论结果如何，已发布 large-v3 CPU MVP 路线保持不变。

## Out Of Scope

- Native MVP 首版 release gate。
- ordinary Faster-Whisper、Qwen、Parakeet、ReazonSpeech。
- T12 MVP large-v3 模型交付、T13 CPU package、设置、前端和 T18 cutover。
- 修改归档 T08/K2 artifacts。
