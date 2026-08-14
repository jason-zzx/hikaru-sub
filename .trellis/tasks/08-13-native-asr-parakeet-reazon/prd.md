# Productize Parakeet and ReazonSpeech

## Goal

在现有 `hikaru-asr-worker`、CrispASR 公共后端、protocol v1 与 Rust host 不变的前提下，为 Parakeet JA Q8_0 与 ReazonSpeech Q8_0 建立各自可审查的原生字幕生成策略和 short-v1 / medium-v1 / long-v2 质量证据。两个引擎独立判定与回退；T10 不切换 Release/default 路由。

## Background

- 父任务：`.trellis/tasks/07-25-native-asr-migration/`，T10 依赖已完成的 T09 CrispASR backend core。
- T09 已实现共享 `CrispAsrBackend`、显式 `parakeet|reazonspeech-nemo -> parakeet` 路由、协议事件映射、资源生命周期、Rust host 与 `parakeet-family: development-gpu-ready` 开发通道。
- T09 GPU 结果仅用于加速 T10 迭代，不是正式 runtime pack、产品设备资格或 Release 路由证据；T14/T15 仍负责正式 GPU pack 与设备资格。
- 当前质量权威是 T03C long-v2 correction：
  - Parakeet：`stop-revise`，CER `0.4917 / 0.6123 / 0.5962`，三个用例均超过 `0.35`；顶层输出均为一个超长段。
  - ReazonSpeech：`proceed-with-named-risks`，CER `0.1333 / 0.2857 / 0.2944`，历史文本/性能/资源/timeline/gap 门槛通过；但顶层输出均为一个超长段，原生词时间范围约 91–94% 为零时长。
- 单纯切分 Parakeet 已有文本不会改变 CER，因此不能解决其当前硬 blocker。
- 直接把 ReazonSpeech 原生词转为协议片段会产生大量 `endMs <= startMs`；按文本比例伪造时间轴不允许。
- 现有 protocol v1、`AsrJobSnapshot`、取消、恢复、单任务和进程树收尾合同不需要修改。
- Release/default 在 T10 后仍保持 Python legacy；正式模型下载、runtime pack、设置、前端与发布切换属于 T12–T18。

## Requirements

### R1 — 复用现有架构边界

- 复用现有 `CrispAsrBackend`、protocol v1、`run_crispasr` dispatch 和 `NativeAsrHost`；不新增 worker、协议版本、通用 backend hierarchy 或生命周期实现。
- 上游 opaque handles、callbacks、result ownership 与 exact-once cleanup 继续由 T09 backend 封装。
- Parakeet 与 ReazonSpeech 继续显式映射到 CrispASR logical backend `parakeet`，不得按文件名推断 route。

### R2 — 安全的协议输出

- 不把当前 whole-file upstream preview 作为可恢复字幕输出；只有通过 T10 策略验证的合法片段才可发送 `segment` / `segmentsReplace`。
- 最终片段必须非空、按时间非递减、位于音频范围内且满足 `endMs > startMs`。
- 最终片段必须证明文本守恒；策略不得借分段修改、补写或参考匹配来修复识别文本。
- 每个最终片段硬限制为最多 `96` 个 Unicode code points、最多 `15000ms`；统计前后不得通过删除或改写识别文本规避上限。
- 最终 replacement 必须同时满足 protocol segment-count、segment-text 与 event-line 大小限制。
- 不按文本长度比例生成时间轴，不使用 Python 输出或 authoritative ASS 修补结果；若真实 native/window timing 无法在文本守恒下满足片段上限，则候选失败，不合成额外 timing。

### R3 — ReazonSpeech 最小候选

- 首个候选使用同一 pinned CrispASR session/backend 在有界的真实音频窗口上执行推理，以音频窗口和合法 native range 产生粗粒度但真实的时间轴。
- 先使用最小的无重叠窗口策略；只有实测出现边界漏字/重复时才允许增加 overlap、ownership 与 exact dedup，并冻结为新的候选 identity。
- 不直接使用零时长 native words 作为 subtitle cue；不得通过任意 duration expansion 修复。
- 最终候选必须在同一冻结 identity 下完成 short-v1 / medium-v1 / long-v2 全矩阵并直接对 T01 ground truth 评分。单项质量门槛失败仍继续后续音频；identity/input/runtime attestation 漂移、harness 损坏或 trace 不完整属于无效证据，修复后重跑受影响 case；identity 合法且具有完整 trace 的 candidate-caused structured load/compute/resource failure 可作为该 case 的有效失败行，但仍不截断后续 case。

### R4 — Parakeet 有界候选

- Parakeet 候选必须改变推理输入或官方解码策略，不能只重排已有 whole-file 文本。
- 首个最小候选使用有界真实音频窗口，并只从合法、单调、正时长 native word ranges 组装片段；零时长词只有在不伪造时间且可证明文本守恒时才能附着到相邻合法 span。
- 最终候选必须在同一冻结 identity 下完成 short-v1 / medium-v1 / long-v2 全矩阵并直接对 T01 ground truth 评分。short 的任一质量门槛失败只会使最终结论为 `stop-revise`，不得跳过 medium/long-v2；identity/input/runtime attestation 漂移、harness 损坏或 trace 不完整属于无效证据，修复后重跑受影响 case；identity 合法且具有完整 trace 的 candidate-caused structured load/compute/resource failure可作为有效失败行，但仍继续后续 case。继续下一候选仍必须先有能解释完整失败分布的新权威依据和新 identity。
- 不因质量失败切回 CPU；重复质量迭代使用 T09 已验证的 `parakeet-family` CUDA 开发通道。

### R5 — 独立引擎判定

- Parakeet 和 ReazonSpeech 使用独立质量结论、启用资格和 rollback 标记；一个引擎失败不得撤销另一个引擎的有效结果。
- 若 ReazonSpeech 达标而 Parakeet 的已评审最小候选仍为 `stop-revise`，T10 允许以两个独立结论完成并归档；这不赋予 Parakeet 发布资格，也不降低其门槛。
- 任何 `qualified` 结论都必须满足每 case CER `<=0.35`、合法 timeline、零 semantic confirmed-speech gap `>=1.5s`，以及适用的性能/资源门槛。
- T10 不得把开发 CUDA 证据描述为正式 GPU route qualification。

### R6 — VAD 与算法边界

- `useVad=true` 继续 fail closed 为 `crispasr_vad_not_implemented`，除非后续单独评审的新候选证明 VAD 直接解决已观察 blocker。
- 当前 Python Parakeet backfill 与 ReazonSpeech 45s/2s-overlap 仅作诊断参考，不是 native 必须复制的算法。
- Qwen/ForcedAligner policy 不属于 T10。

### R7 — 证据与隐私

- 冻结 T10 source/runtime/worker/model/device/manifest/comparator/candidate config identity；算法、配置、binary 或 runtime 改变时重跑受影响结果。
- 使用共享 T01 benchmark comparator，禁止复制 CER/gap/timeline 计算。
- raw text、音频、模型、绝对路径、stderr 与运行时产物仅位于 task-local ignored `research/local/`；tracked publication 只包含 hashes、aggregate metrics、分布与结论。
- publisher 必须从冻结 raw bytes 重算结果、通过 mutation tests，并可生成 byte-identical JSON/Markdown。

### R8 — 兼容与发布边界

- 保持 CTranslate2、Qwen、React/Tauri command、`AsrJobSnapshot`、取消、恢复与 active-job gate 行为不变。
- T10 后所有 CrispASR Release/default route 仍保持禁用；Python legacy 仍是默认。
- 不修改模型 downloader、runtime settings、前端、installer、portable package 或正式 GPU packs。

## Acceptance Criteria

- [ ] 一个小而纯的 Parakeet-family 输出策略具有 deterministic tests，覆盖合法多段、Reazon 大量零时长词、Parakeet 混合合法/零时长词、越界/逆序、空文本、零窗口/零 source/final segment、文本守恒失败与 96/15000 cue cap；独立 worker/Emitter contract tests 覆盖 protocol segment-count、text-byte 与 replacement-size 超限。
- [ ] raw whole-file preview 不进入恢复状态；worker 只发送策略认可的最终片段，并保持 protocol v1 事件合法。
- [ ] ReazonSpeech 最终候选在同一冻结 identity 下完成 short-v1 / medium-v1 / long-v2；质量失败或具有完整 trace 的 candidate-caused structured failure 均不截断后续 case，无效证据必须修复重跑，完整矩阵后获得独立 `qualified` 或 `stop-revise` 结论。
- [ ] Parakeet 最终候选在同一冻结 identity 下完成 short-v1 / medium-v1 / long-v2；任何单项质量门槛失败仍继续其余音频，完整矩阵后发布独立 `qualified` 或 `stop-revise` 结论；Parakeet 的独立失败不阻止已达标 ReazonSpeech 的 T10 结论和任务归档。
- [ ] 每个 `qualified` 结论表示“accepted T10 engine-algorithm input”：满足冻结的 CER、timeline、semantic-gap、性能和资源门槛，且最终片段满足已冻结的字幕尺寸策略与 protocol limits；该结论不授权 Release/default 或正式 GPU route，T14/T15/T18 仍须独立通过。
- [ ] fake ABI、native CTest、真实 Rust host、取消/reap、恢复、active gate、CT2/Qwen/default-off regressions 全部通过。
- [ ] 模型证据使用当前 long-v2 manifest 与共享 T01 comparator；tracked publisher 通过 identity/privacy/mutation/determinism 检查。
- [ ] 没有 Release/default 路由、protocol、产品 Tauri command、前端、downloader、runtime pack、installer 或 portable 改动。

## Out of Scope

- Qwen3-ASR / ForcedAligner grouping 与 timing qualification。
- 正式 CUDA/Vulkan runtime packs、设备 fallback、下载、设置与 UI。
- 模型 manifest/downloader、CPU runtime packaging 或 release cutover。
- Python parity、参考文本修补、synthetic timing、任意用户自定义分段配置。
- 在 T10 中升级 CrispASR pin；如 pinned v0.8.22 无法满足门槛，先发布 `stop-revise`，升级另立评审任务。
