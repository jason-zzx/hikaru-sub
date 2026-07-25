# 建立原生 ASR 迁移基准

## Goal

建立一套可重复执行的日语 ASR 基准合同，并记录当前五个 Python 引擎的文本、时间轴、性能和资源占用基线，为后续 CTranslate2 与 CrispASR PoC 提供唯一比较入口。

本任务只建立测量工具和基线证据，不改变生产转录路径、引擎行为、前端合同或发布资源。

## Background

- 本任务是 `.trellis/tasks/07-25-native-asr-migration` 的 T01，无前置子任务。
- 当前五个引擎通过 `asr-service/engines/registry.py` 创建，并以 `AsrSegment` / `TranscriptSegmentRefresh` 产出最终时间轴。
- T02 与 T03 必须复用本任务冻结的语料 ID、文件哈希、参考标注、指标算法和结果 schema，不能建立第二套比较口径。
- 当前 Python 输出是迁移比较基线，不代表目标原生实现必须复制其中的缺陷。尤其是 Qwen3 缺少 ForcedAligner 时的合成时间戳必须标明来源，不能作为原生时间轴通过依据。

## Requirements

### R1 - Scope And Engine Matrix

- 基准覆盖 `faster-whisper`、`kotoba-faster-whisper`、`parakeet`、`qwen3-asr` 和 `reazonspeech-nemo`。
- 至少记录 Windows x64 CPU 路径；GPU 数据可以补充，但不得替代 CPU 尝试和 CPU 失败证据。
- 基准运行通过现有 `AsrEngine` 与 registry，不新增平行引擎注册表，也不经 FastAPI/Tauri 绕一圈。
- 正确处理 `TranscriptSegmentRefresh`：最终刷新替换预览片段，报告只以最终片段列表计分。
- 不修改引擎参数、分块、VAD、backfill、模型下载或生产默认值来改善基线结果。

### R2 - Corpus Contract And Privacy

- 定义版本化 corpus manifest，至少包含：稳定 ID、音频相对键、SHA-256、时长、采样格式、时长分类、覆盖标签、参考文本、参考时间片段/语音区间、来源和许可证。
- 时长分类固定为：短音频 `<30s`、中音频 `5-15m`、长音频 `>60m`。
- 语料整体覆盖清晰日语、长静音、背景音、快速对白、连续语音超过 30 秒、低音量、数字/英文/人名/专有名词；单个文件不要求覆盖全部标签。
- 仓库只允许提交自行生成或具备明确再分发许可的小型 fixture。大型、私有或授权不清晰的音频、manifest、参考文本和结果必须位于忽略目录，通过 `--corpus-root` 解析。
- manifest 和报告不得保存机器绝对路径。任何提交的 fixture 都必须同时记录来源、许可证和文件哈希。
- 基准输入统一为可验证的 16 kHz 单声道 PCM WAV；不在本任务中增加媒体转码能力。

### R3 - Text And Timeline Metrics

- 日语 CER 归一化固定为：Unicode NFKC、统一换行、移除所有 Unicode 空白；保留标点、拉丁字母大小写和其余字符。报告同时保存原文和归一化文本的哈希/允许公开时的文本。
- CER 输出 substitutions、deletions、insertions、reference character count 和 `(S+D+I)/N`，使用同一确定性 Levenshtein 实现。
- 每次运行记录最终 segments、segment count、空文本数、`endMs <= startMs` 数、起点小于 0 数、终点超过音频时长数和非单调时间轴数。
- `>=1500ms` 漏段只能根据参考语音区间判断，不能把普通字幕间隔直接判为漏段。
- Qwen3 时间误差仅对可追溯到 ForcedAligner 的片段计入，记录 timestamp provenance、未匹配数、起始误差中位数和 P95；合成时间戳单独标记为不具备对齐资格。

### R4 - Reproducible Execution

- 每次结果记录 git commit/dirty 状态、OS/架构、CPU、逻辑核数、总内存、可用时的 GPU/驱动、Python 与相关推理包版本、引擎/模型/设备/compute type/VAD 参数，以及 corpus manifest 和音频哈希。
- 模型下载与首次缓存填充不计入推理；缓存状态和模型 revision 必须记录。
- 冷启动在新进程中测量并拆分 import/start、model load、inference 和 total wall time。RTF 同时记录 inference-only 与 total 两种口径。
- 短音频至少运行一次冷启动和三次热运行并报告热运行中位数；中/长音频至少运行一次，明确标记样本数，不伪造统计稳定性。
- 记录峰值进程工作集/RSS、可用时的 VRAM 和采样方法。无法测量时写 `null` 与原因，不能写 0。
- 单个引擎失败或环境缺依赖时生成 `failed`/`skipped` 记录，包含稳定错误分类、精确命令、依赖/模型状态和复现说明。

### R5 - Artifacts And Handoff

- 版本化 JSON 是事实来源；Markdown 报告必须由 JSON 生成，不允许手工维护另一套数值。
- 普通 CI 只运行 manifest、指标、刷新归约和报告生成的无模型自检，不下载模型或大型语料。
- 模型支持的实测结果写入忽略目录；任务中提交去敏的 `research/benchmark-contract.md` 与 `research/python-baseline-report.md`，仅引用稳定 corpus ID、哈希、指标和限制。
- T01 交付必须明确 T02/T03 可消费的 manifest/schema、比较命令、结果路径约定和已知缺口。
- 日志和提交产物不得包含密钥、用户文件路径、私有字幕正文、模型权重或授权不清晰媒体。

## Acceptance Criteria

- [ ] corpus manifest schema 和 README 明确定义短/中/长分类、参考标注、来源/许可证、私有语料解析和忽略策略。
- [ ] 至少一个可再分发的短日语 fixture 可运行无模型 manifest/hash 自检；中/长媒体不要求进入仓库。
- [ ] CER 归一化、Levenshtein 计数、P95、时间轴合法性、语音漏段判断和 `TranscriptSegmentRefresh` 归约均有确定性测试。
- [ ] runner 通过现有 registry 运行引擎，在新进程中记录冻结参数、环境、冷/热时间、RTF 和资源测量方法。
- [ ] 五个 Python 引擎分别有至少一份基线记录；若本机依赖或模型无法满足，必须有可复现的 `failed`/`skipped` 限制记录。缺失的相关基线继续阻塞 T02/T03 对应引擎的比较结论。
- [ ] 所有已完成运行均无未报告的无效/越界片段，且原始最终 segments 可供后续比较。
- [ ] Qwen3 报告明确区分 ForcedAligner 与合成时间戳，后者不计入时间精度基线。
- [ ] 版本化 JSON 可确定性生成去敏 Markdown 汇总；相同输入重复生成不产生语义差异。
- [ ] `python -m unittest discover tests`、基准 self-check 和 manifest validation 通过。
- [ ] 仓库中不存在私有/大型音频、机器绝对路径、模型权重、密钥或未明确许可的转录正文。
- [ ] `research/benchmark-contract.md` 和 `research/python-baseline-report.md` 给出 T02/T03 的稳定交接合同及每个引擎的完成/阻塞状态。

## Out Of Scope

- 实现任何原生 C++ worker、CTranslate2 或 CrispASR 推理。
- 修改现有 Python 引擎以提高准确率、补段、进度或性能。
- 改动 Tauri command、React UI、设置、运行依赖或发布包。
- 在普通 CI 下载模型或运行数小时的模型基准。
- 建立公共大型日语数据集镜像或提交受限媒体。

## Dependencies And Gate

- 前置任务：无。
- T02/T03 只能在本任务完成并评审后进入模型实测；它们必须消费本任务的同一合同。
- 若某个引擎只有限制记录而没有可比较基线，则对应 PoC 可以继续做 ABI/可运行性探索，但不能宣称质量或性能比较通过。

## Planning State

- 需求已收敛，无待用户决策的阻塞问题。
- 任务保持 `planning`，等待本 PRD、`design.md`、`implement.md` 与 context manifests 评审后再单独启动。
