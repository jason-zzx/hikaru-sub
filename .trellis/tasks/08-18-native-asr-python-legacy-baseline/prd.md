# 建立模型级 Python legacy ASR 基线并修订 native 资格门槛

## Goal

为 native ASR migration 建立一份可复现、按**具体模型 identity × case**组织的 Python legacy 基线，并把后续 native 发布质量判定改为：native 在相同模型、相同 benchmark case 下不劣于当前生产 Python sidecar。

该任务只建立基线和资格合同，不改变生产路由，不切换 native 默认值，不修改 Python 推理行为来制造更好的参考结果。

## Background

- 父任务：`.trellis/tasks/07-25-native-asr-migration`。
- T01 已冻结 `.asr-benchmark` 的 short-v1、medium-v1、long-v2 WAV+ASS 真值、共享 comparator、结果 envelope 和隐私规则，但现有 `python-reference-report.md` 只覆盖 short，且明确是 non-gating 诊断。
- Python sidecar 当前通过 `asr-service/engines/registry.py` 运行。参考必须来自当前生产实现、当前开发 interpreter、当前依赖和当前默认/固定产品参数，不得用 Python 结果修补 reference ASS、speech regions、文本或时间戳。
- 当前产品模型 identity 至少包括：
  - Whisper 系列 `faster-whisper`: `tiny`、`base`、`small`、`medium`、`large-v2`、`large-v3`、`large-v3-turbo`；Python legacy baseline 只覆盖 `large-v2` 与 `large-v3`，二者共同构成 native Whisper 家族发布 gate；
  - `kotoba-faster-whisper`: `kotoba-tech/kotoba-whisper-v2.0-faster`，完整覆盖；
  - `parakeet`: `nvidia/parakeet-tdt_ctc-0.6b-ja`，完整覆盖；
  - `qwen3-asr`: `Qwen/Qwen3-ASR-1.7B`，以及其必需的 `Qwen/Qwen3-ForcedAligner-0.6B` companion，完整覆盖；
  - `reazonspeech-nemo`: `reazon-research/reazonspeech-nemo-v2`，完整覆盖。
- “同模型”指产品模型 identity，不是引擎家族、后端名称或文件名。Python NeMo/Hugging Face artifact 与 native GGUF/CT2 artifact 可以配对，但必须由显式映射记录证明，例如：
  - `Qwen/Qwen3-ASR-1.7B` ↔ `qwen3-asr-1.7b-q4_k.gguf`；
  - `nvidia/parakeet-tdt_ctc-0.6b-ja` ↔ `parakeet-tdt-0.6b-ja-q8_0.gguf`；
  - `reazon-research/reazonspeech-nemo-v2` ↔ `reazonspeech-nemo-v2-q8_0.gguf`；
  - `large-v2` ↔ native CTranslate2 `large-v2` snapshot。
- `large-v2` 的 Python 长音频路径包含当前实现的 V4/seed/session/语义分段行为。该行为必须作为 legacy baseline 的真实组成部分记录，但不自动成为 native 算法模板。

## Requirements

### R1 - Freeze the model identity matrix

- 建立版本化的 model identity manifest，至少绑定：logical model identity、Python engine、native engine/backend、允许的 artifact/repository、revision、文件或 snapshot hash、语言、companion model、case 集合和比较 profile。
- 每个 native candidate 只能与 manifest 中相同 logical model identity 的 Python row 配对；不同尺寸、不同 variant、不同模型 revision 或不同 companion identity 不得互比。
- 模型 artifact 变化、Python engine 参数变化、依赖/runtime 变化或 benchmark manifest 变化都会使受影响 baseline 失效，并要求重新运行。
- 当前并非可运行或缺失模型的 identity 必须记录为 `unavailable`/`not-run` 及原因；该状态不能授权 native 发布，也不能被其他模型 baseline 借用。

### R2 - Acquire the Python legacy matrix

- 使用当前 Python sidecar 完成以下模型 identity 的 `short-v1`、`medium-v1`、`long-v2`：
  - Whisper 系列只运行 `large-v2` 与 `large-v3`；
  - Kotoba、Parakeet、Qwen3-ASR 和 ReazonSpeech 的当前产品模型全部运行。
- `tiny`、`base`、`small`、`medium`、`large-v3-turbo` 不采集独立 Python baseline；它们是否可进入 native 发布由 Whisper 家族 gate 决定。
- short 使用既定 `1 cold + 3 warm`；medium/long 至少一次完整尝试，并记录 cold/warm、inference、total wall、RTF、RSS 和实际完成覆盖。
- 结果必须经现有 T01 benchmark runner/refresh reduction/comparator 生成；禁止复制 CER、timeline、gap 或 Qwen timing 算法。
- 记录每一行的 engine/model/device/compute/VAD/long-mode 参数、Python interpreter、包版本、模型/companion identity、cache state、git revision、manifest/hash 和资源采样方法。
- 采集通道为 CUDA（2026-08-18 用户指示由 CPU 改为 GPU）：runner 使用 `--device cuda`，compute/dtype 按当前生产引擎的 cuda 解析结果（CT2 系 float16、长音频 int8_float16、NeMo 系 float32 + model.cuda()、Qwen3 bfloat16/cuda:0），GPU identity 以每行 nvidia-smi attestation 记录。该 profile 是 native 字幕质量比较的唯一 Python 参照，native CPU 与 native CUDA rows 都与它配对；性能/资源仍走绝对门槛，不做相对 GPU/CPU 比较。
- Python baseline 运行不得因为 native 预期而改变 chunking、VAD、backfill、beam、history、seed、模型或默认参数。若需要显式配置才能使当前产品路径可复现，配置本身必须记录并固定。
- Qwen3 只有在 ForcedAligner provenance 合法时才记录时间误差；synthetic、mixed、unknown 或 engine-native 时间戳不可作为 baseline timing truth。

### R3 - Define native qualification

- 字幕质量指标改为按同一 `logicalModelIdentity × case × comparisonProfile` 与 Python legacy baseline 比较，native 不得劣于 Python legacy：
  - CER、substitution/deletion/insertion 和空文本；
  - confirmed semantic speech gaps `>=1500ms`；
  - Qwen3 ForcedAligner start median/P95（仅在两侧 provenance 都 eligible 时比较）。
- `invalid/out-of-bounds timeline`、负起点、逆序/零时长、非法 UTF-8、text conservation、subtitle segment/protocol legality 和完整矩阵覆盖属于结构/证据硬门禁，不因 Python baseline 的状态而放宽，也不作为相对比较的豁免项。
- “不劣于”只适用于上述字幕质量指标，必须逐项、逐模型、逐 case 判断；不得用平均数掩盖某个 case 或某个 metric 的回退。报告必须发布 baseline value、native value、delta、比较方向、provenance 和 disposition。
- RTF、short cold process wall、peak RSS、GPU 加速比例、模型加载耗时、协议吞吐和其他非字幕质量指标，继续沿用此前任务规划与 T01 冻结的绝对门槛、样本数、设备/profile 规则和证据完整性要求；不因 Python baseline 更差而放宽，也不改为相对 Python parity gate。
- Whisper 家族发布 gate 只有在 `large-v2` 和 `large-v3` 两个模型都完成规定的 short-v1/medium-v1/long-v2 矩阵、各自字幕质量不劣于 Python legacy、并通过既有非质量绝对门槛与独立安全/证据硬门禁后才通过；不能用一个模型的结果替代另一个模型。
- Whisper 家族的 `tiny`、`base`、`small`、`medium`、`large-v3-turbo` 不需要独立 Python parity gate。Whisper 家族 gate 通过后，这些 native 模型允许进入发布资格流程；它们仍必须满足此前的非质量绝对门槛和 identity、协议、路径、取消/恢复、隐私、许可证证据，不能以模型缺失或运行时错误伪装成可发布。
- Kotoba、Parakeet、Qwen3-ASR 和 ReazonSpeech 按各自具体模型 identity 执行完整的同模型同 case Python legacy 字幕质量比较；一个模型通过或失败不替代另一个模型。
- Python baseline 比较不豁免结构性安全合同：路径 containment、身份/hash 绑定、禁止伪造/合成时间戳、原子输出、进程取消/恢复、协议 JSONL、隐私和许可证仍是独立硬门禁。
- 在 baseline 不完整、invalid、缺少必要 provenance 或 identity drift 时，native 结果只能是 `baseline-incomplete`/`unscored`，不得宣称通过。
- 对 Python 的合法 structured failure，native 只有在同 case 产生 identity-valid、合法且可审计的完成结果时，才可记录为相对改善；不能把缺失或环境故障的 Python row 当成质量下限。

### R4 - Publish one authoritative handoff

- 版本化 JSON 是事实来源；Markdown 由 JSON 确定性生成。
- 新 handoff 必须包含模型 identity matrix、Python run identity、short/medium/long rows、baseline limitations、native comparison schema、metric direction、status ordering、invalidity rules 和迁移/回滚说明。
- raw transcript、音频、ASS 正文、模型权重、绝对路径、完整 stderr、私有 cache 内容和密钥只能写入 task-local ignored root；tracked handoff 只保留去敏身份、hash、聚合指标、状态和限制。
- 旧的 T01 `python-reference-report.md` 及各归档任务的 Python 结果保持历史不可变；新 handoff 通过 supersession 指针成为后续 native 资格比较的唯一 Python authority。

### R5 - Revise downstream task descriptions

- 更新父任务 `prd.md`、`design.md`、`implement.md` 的证据层级、Gate 2/3/4 和 T06/T08/T10/T10R/T11/T14/T15/T18 资格描述，使它们引用本任务的 model-level Python baseline。
- 更新 `.trellis/spec/asr/quality-guidelines.md`：Python legacy 不再是“永不建立 relative gate”的规则；它只在有完整、identity-bound、可复现 baseline 时作为同模型同 case 的相对产品质量门槛，同时保留安全/证据硬门禁。
- 已归档任务不改写历史结论；必要时只在父任务或新 handoff 中记录 superseded/reinterpreted 关系。
- 后续任务不能再使用引擎家族 baseline、不同模型 baseline、Python 缺失 row 或单一平均分授权 native release。

## Acceptance Criteria

- [x] model identity manifest 覆盖当前产品模型清单，明确 Whisper 家族 gate 模型与非 gate 模型，并为 Python artifact 与 native artifact 提供显式同模型映射；Qwen companion identity 单独绑定。
- [x] `large-v2`、`large-v3`、Kotoba、Parakeet、Qwen3-ASR 和 ReazonSpeech 的可运行模型 identity 均有 short-v1、medium-v1、long-v2 Python legacy rows，由当前 sidecar 和 T01 runner 真实生成；不可运行 identity 有明确去敏状态和原因；其他 Whisper 模型明确标记为 `family-gated-no-baseline`。
- [x] 每个 row 绑定 interpreter、依赖、模型/companion revision/hash、参数、设备/profile、corpus identity 和结果 hash；不同 identity 的 mutation 被拒绝。
- [x] 去敏 baseline report 能逐模型、逐 case 展示 CER、gaps、timeline、Qwen timing、coverage、RTF、cold wall 和 RSS，并标注 metric 方向与 limitations。
- [x] native comparison contract 明确字幕质量逐项“不劣于”规则、既有非质量绝对门槛不变、状态/失败处理、baseline-incomplete 行为和禁止平均掩盖回退的规则。
- [x] 安全、协议、时间戳 provenance、取消、恢复、路径、隐私和许可证硬门禁仍独立存在，不因 Python baseline 降级。
- [x] 父任务、ASR quality spec 和未执行的相关后续任务均引用新 handoff；历史归档任务未被改写。
- [x] 同一 JSON 重复生成的 tracked Markdown byte-identical，privacy/path/ignore 检查通过。
- [x] 相关 benchmark self-check、Python sidecar tests、manifest validation 和 publication mutation tests 通过；真实模型缺失/失败项在最终报告中明确列出。

## Out of Scope

- 修改 Python engine 以改善 baseline 数值。
- 修改 native worker、Tauri、React、下载器、runtime pack 或发布路由。
- 将 Python 输出写入 ground-truth ASS/text/speech regions。
- 用家族平均值、跨模型比较、绝对门槛平均化或人工 waiver 代替模型级同 case 比较。
- 改写已归档任务的历史 evidence、报告或结论。
- 在本任务中启动 `task.py start` 或执行生产切换；实现前必须先完成用户对 planning artifacts 的评审。

## Decision Recorded

- `不劣于 Python legacy` 只适用于字幕质量指标：CER、编辑距离构成、空文本、confirmed semantic speech gaps 和 Qwen ForcedAligner 时间质量。
- 非质量/结构硬门禁继续沿用此前任务规划：非法或越界时间轴、负起点、逆序/零时长、非法 UTF-8、text conservation、subtitle/protocol legality、完整矩阵覆盖、RTF、cold wall、RSS、GPU 加速判定、模型加载/进程行为、协议、取消、恢复、路径、安全、隐私和许可证。Python legacy 结果不能为这些问题提供豁免。
- 不建立 Python CPU/CUDA 与 native CPU/CUDA 的相对性能门槛；Python 性能结果可以记录为诊断信息，但不能放宽或替代既有绝对性能/资源门槛。
- Python legacy 基线采集通道为 CUDA（`python-legacy-cuda-v1`，2026-08-18 用户决定，取代冻结前的 CPU 方案）；其字幕质量结果同时作为 native CPU 与 native CUDA rows 的相对比较参照。
