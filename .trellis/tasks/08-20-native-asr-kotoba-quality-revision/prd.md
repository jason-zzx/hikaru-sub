# Revise native Kotoba K3 quality

## Goal

在不修改 K2 历史 evidence 的前提下建立新的 Kotoba K3 candidate，继承已审查的长音频安全机制并修复相对 `python-legacy-cuda-v1` 的文本质量回退，使 Kotoba 获得独立的 accepted 或 non-qualified handoff。

## Authority And Dependencies

- 依赖归档 T07 的 development CTranslate2 CUDA seam；该 evidence 不构成 release qualification。
- 依赖归档 T08 K2 的 bounded-stride、latest-start ownership、exact-dedup、progress 和 cache compatibility 安全合同。
- 当前 authority 为 Python legacy baseline 与归档 native legacy-quality reassessment；K2 当前 disposition 为 `stop-revise`。
- 遵循 `.trellis/spec/asr/quality-guidelines.md` 的完整矩阵和 historical evidence 不改写合同。

## Requirements

1. 冻结新的 K3 candidate/algorithm/config/binary/model identity；不得用 K2 名称覆盖新结果。
2. 保留 K2 的 1500-frame source / bounded applied stride、完整 decoded-start ownership chain、boundary-to-later-window 规则、exact tuple dedup 和 monotonic ownership-frontier progress，除非新设计先独立评审为新 identity。
3. 针对 K2 完整 observed legacy-relative S/D/I/CER 回退分布设计修订，不得 reference-match、reference-based dedup、backfill、gap fill、fuzzy merge、clip/stretch 或 synthetic timing。
4. 同一冻结 K3 identity 完成 short-v1、medium-v1、long-v2；单 case 质量失败不得截断剩余矩阵。
5. 保持 Kotoba-only `preprocessor_config.json`、128-mel、source/model window 和 cache readiness 合同，不收紧 ordinary Whisper readiness。
6. 只有 qualified K3 才可进入 T14/T15；否则 Kotoba 保持 visible/unavailable。

## Acceptance Criteria

- [ ] K3 identity 与所有 raw/runner/worker/runtime/model hashes 已冻结，K2 tracked/raw evidence 无修改。
- [ ] short-v1/medium-v1/long-v2 均有 identity-valid completed 或完整 structured-failure row，最终 disposition 来自完整矩阵。
- [ ] stride、ownership、dedup、progress、text conservation、timeline 和 protocol mutation tests 证明 K2 safety contract 未被弱化。
- [ ] 每个 case 的 CER、S/D/I、空文本和 semantic gaps 均不劣于匹配 Python row，并通过全部绝对硬门禁，才可发布 accepted K3 algorithm input。
- [ ] 失败时发布 truthful `stop-revise`/unsupported disposition，不生成 reference-repaired 输出，不启用 native Kotoba route。

## Forbidden Premature Claims

- 不得将 K2 的旧 accepted-algorithm wording、T07 GPU speed 或结构门禁通过解释为当前 subtitle-quality qualification。
- 不得在三 case 完整矩阵前声称 K3、Kotoba pack、route 或 release qualified。

## Out Of Scope

- ordinary Faster-Whisper、Qwen、Parakeet、ReazonSpeech 质量工作。
- 模型下载/manifest、CPU/GPU runtime pack、设置、前端和 release cutover。
- 修改或重发布归档 T08/K2 artifacts。
