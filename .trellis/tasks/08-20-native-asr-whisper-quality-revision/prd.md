# Revise native Faster-Whisper quality

## Goal

建立新的 ordinary Faster-Whisper native candidate，恢复首个 native release 的 mandatory route，并让 `large-v3` 与 `large-v2` 两个独立 anchor 都通过同模型 `python-legacy-cuda-v1` 字幕质量非回退矩阵和既有绝对硬门禁。

## Authority And Dependencies

- 依赖归档 T06 `native-asr-ctranslate2-whisper` 的 production worker、诊断和 evidence seam；不得修改其 Candidate A/B artifacts。
- 依赖归档 T07 `native-asr-ctranslate2-cuda-development` 的 development GPU seam；该 seam 不是正式设备或 pack qualification。
- 字幕质量 authority 为 `.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json`。
- 当前 native disposition authority 为归档 `08-19-native-asr-legacy-quality-reevaluation`；large-v3 Candidate A 为 `stop-revise`。
- 遵循 `.trellis/spec/asr/quality-guidelines.md` 的完整矩阵、identity、reference 和绝对门禁合同。

## Requirements

1. 冻结新的 candidate/algorithm/config/binary/model identity，不复用 Candidate A/B 名义发布新结论。
2. 对归档重评中 large-v3 的每项 S/D/I/CER 回退给出可审计根因和对应修订，不得从 Python transcript 或 ASS reference 生成、补写或修复候选输出。
3. `large-v3` 与 `large-v2` 分别完成 short-v1、medium-v1、long-v2；单 case 质量失败不得截断剩余矩阵。
4. 每个 anchor 只与自己的同模型同 case Python row 比较，并独立通过 timeline、UTF-8、text conservation、protocol、RTF、wall、RSS、identity、path、取消/恢复、隐私和许可证门禁。
5. T07 可用于加速开发迭代，但正式 GPU pack、设备路由和 accelerated qualification 仍由 T14/T15 负责。
6. 两个 anchor 未全部通过前，不解锁其他 ordinary Whisper 模型，也不改变 production/default Python legacy route。

## Acceptance Criteria

- [ ] 新 candidate identity 与全部输入/运行时/binary/model hashes 已冻结并通过 mutation/identity validation。
- [ ] `large-v3` 和 `large-v2` 各有完整的 short-v1/medium-v1/long-v2 identity-valid rows，共六个 case disposition；无外部终止或损坏 row 被当作完成证据。
- [ ] 每个 case 的 CER、S/D/I、空文本和 semantic confirmed-speech gaps 均不劣于匹配的 `python-legacy-cuda-v1` row。
- [ ] 两个 anchor 均通过所有独立绝对硬门禁；任一失败时发布完整 `stop-revise`，不声称 ordinary Faster-Whisper qualified。
- [ ] 历史 T06/T07 artifacts 和结论无修改，T07 evidence 明确保持 development-only。
- [ ] 生成可供 T14/T15 消费的 accepted final algorithm handoff，或 truthful non-qualified handoff；不得输出中间状态冒充 release input。

## Forbidden Premature Claims

- 不得在双 anchor 全部通过前声称 ordinary Faster-Whisper、其他 Whisper 模型、CPU route、GPU route 或 native release qualified。
- 不得把 development GPU speed evidence、旧 absolute gate、Candidate A retained output 或 Candidate B diagnostics 当作当前 release qualification。

## Out Of Scope

- T12 模型下载/manifest、T13 runtime packaging、T14/T15 pack/device qualification。
- Kotoba K3、Qwen、Parakeet、ReazonSpeech 质量工作。
- 设置、前端、安装器、production route 切换或 Python legacy 移除。
