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
- 字幕质量判断只以用户提供的 WAV+ASS 真值和已批准门槛为准；Python legacy 输出仅作非门禁历史诊断。模型/分发资源仍遵守产品完整性校验，不以临时 runner、日志或结果哈希决定 K3 可用性。

## Requirements

1. 明确 K3 模型、算法和配置及其产品资源完整性边界，不覆盖 K2；本地脚本或构建字节变化不要求重建证据身份链。
2. 保留 K2 的 bounded stride、ownership、exact tuple dedup 和 monotonic progress，除非新 identity 经过独立评审。
3. 不得 reference-match、reference-based dedup、backfill、gap fill、fuzzy merge、clip/stretch 或 synthetic timing。
4. 同一 K3 模型/算法/配置完成 short-v1、medium-v1、long-v2；单 case 失败不截断矩阵。
5. 保持 Kotoba-only preprocessor、128-mel、window 和 cache readiness 合同，不改变 ordinary Whisper MVP。
6. 只有 qualified K3 才能在后续版本启用；失败时保持 visible/unavailable。

## Acceptance Criteria

- [ ] K3 模型及分发资源通过现有完整性校验；记录实际算法/配置/设备与直接运行结果，K2 归档证据无修改。不冻结临时 raw/runner/worker/log 哈希。
- [ ] 三个 case 均有可核对的 completed 或 structured-failure 结果，最终 disposition 来自完整矩阵。
- [ ] stride、ownership、dedup、progress、text conservation、timeline 和 protocol tests 通过。
- [ ] 每个 case 的质量和独立工程门禁满足该 post-MVP task 的冻结标准后，才可发布 Kotoba accepted handoff。
- [ ] 失败时发布 truthful non-qualified disposition，无 reference repair、伪时间轴或 silent Python fallback。
- [ ] 无论结果如何，已发布 large-v3 CPU MVP 路线保持不变。

## Out Of Scope

- Native MVP 首版 release gate。
- ordinary Faster-Whisper、Qwen、Parakeet、ReazonSpeech。
- T12 MVP large-v3 模型交付、T13 CPU package、设置、前端和 T18 cutover。
- 修改归档 T08/K2 artifacts。
