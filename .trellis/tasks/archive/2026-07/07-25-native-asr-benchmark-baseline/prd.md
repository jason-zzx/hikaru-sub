# 建立原生 ASR 基准真值

## Goal

建立一套可重复执行的日语 ASR 基准真值合同，以用户提供的 `.asr-benchmark` WAV+ASS 为唯一质量真值，冻结语料身份、参考标注、指标算法和结果 schema，为后续 CTranslate2 与 CrispASR PoC 提供唯一比较入口。

当前五个 Python 引擎的输出、时间、性能和资源数据仅作为可选诊断与历史参考，不得成为期望输出、相对 CER/RTF gate，或缺失参考标注的替代。

## Background

- 本任务是 `.trellis/tasks/07-25-native-asr-migration` 的 T01，无前置子任务，当前状态为 `in_progress`。
- 用户确认的本地权威材料位于已忽略的 `.asr-benchmark/`：`short.wav` + `short.ass` 为 24.102s/8 Dialogue，`medium.wav` + `medium.ass` 为 498.872s/165 Dialogue，`long.wav` + `long.ass` 为 4144.235s/908 Dialogue。
- 三个 WAV 均为 16 kHz、单声道、16-bit PCM；benchmark 必须在本地读取并解析 ASS 以建立 reference，但 ASS 正文和本地媒体不得写入任务文档、tracked reports 或其他提交产物。
- 当前五个引擎通过 `asr-service/engines/registry.py` 创建，并可能以 `TranscriptSegmentRefresh` 替换 preview。Parakeet、Qwen3 与 ReazonSpeech 都可能产生最终 refresh，报告只计最终片段。
- 当前 Python faster-whisper 依赖为 `faster-whisper==1.2.1`、`ctranslate2==4.8.0`；`large-v2` + `ja` + `>=600000ms` 的 V4/seed/session/语义分段特殊路径仅是诊断参考和回归案例，不是原生算法模板。

## Evidence And Implementation Authority

按以下顺序处理冲突：

1. `.asr-benchmark` 中用户提供的 WAV+ASS 及其经校验 manifest 是文本、语音区间和时间轴的唯一质量真值。
2. 原生算法优先依据官方文档、稳定 public API 与模型卡，其次采用当前维护良好的社区推荐实践。
3. 候选算法必须以同一真值合同实测选择；T01 的绝对 CER/RTF、cold wall、RSS 与时间轴预算已获用户评审并冻结。
4. 当前 Hikaru Sub Python 实现仅用于理解产品合同、发现已知问题和提供诊断/历史对照；不得生成或修补 reference ASS、文本、语音区间或时间戳。
5. React/Tauri command、`AsrJobSnapshot`、取消、恢复、路径与安全合同仍是产品兼容权威，不受算法权威变化影响。

## Requirements

### R1 - Ground-Truth Corpus Contract

- 定义版本化 corpus manifest，至少包含稳定 ID、WAV/ASS 相对键、两者 SHA-256、时长、采样格式、时长分类、覆盖标签、参考文本、参考时间片段/语音区间、来源和许可/授权状态。
- 时长分类固定为：短音频 `<30s`、中音频 `5-15m`、长音频 `>60m`。
- 权威 manifest 必须覆盖已确认的 short/medium/long 三组材料，并在本地验证 WAV 与 ASS 哈希、格式、时长和 Dialogue 数；提交文档只记录非敏感事实、稳定 ID 与哈希，不记录正文或绝对路径。
- Coverage 是每个 case 独立的正向标签，未确认或明确不存在的标签不得加入；corpus-wide coverage 自动取各 case 并集。已确认：short 仅 `clear-japanese`；medium 为 `clear-japanese`、`background-noise`、`english`、`proper-nouns`；long 为 `clear-japanese`、`long-silence`、`continuous-speech-over-30s`、`english`、`proper-nouns`、`background-noise`、`rapid-dialogue`、`numbers`、`person-names`。总体只缺 `low-volume`，必须显式报告且不得推断。
- 仓库只允许自行生成或具备明确再分发许可的小 fixture。大型、私有或授权不清晰的音频、ASS、manifest、参考文本和结果必须位于忽略目录，通过 `--corpus-root` 解析。
- 输入统一为可验证的 16 kHz 单声道 PCM WAV；本任务不增加媒体转码能力。

### R2 - Metrics And Gates

- 日语 CER 归一化固定为 Unicode NFKC、统一换行、移除所有 Unicode 空白；保留标点、拉丁字母大小写和其余字符。
- CER 输出 substitutions、deletions、insertions、reference character count 和 `(S+D+I)/N`，使用同一确定性 Levenshtein 实现。
- 每次运行记录最终 segments、segment count、空文本、`endMs <= startMs`、负起点、越界终点和非单调时间轴计数。
- `>=1500ms` 漏段只能根据 ASS 派生并人工确认的参考语音区间判断；不得把普通字幕间隔或 Python 输出当作参考语音。
- Qwen3 时间误差只计 ForcedAligner provenance，记录未匹配数、起始误差中位数和 P95；合成时间戳不具备对齐资格。
- 保留硬门槛：0 invalid/out-of-bounds timeline、0 个 `>=1500ms` confirmed speech gap、Qwen3 start median `<=150ms` 且 P95 `<=500ms`。
- 用户评审后冻结的绝对预算为：每个 engine/case 独立 CER `<=0.35`；纯 CPU inference RTF `<=1.0`；CUDA/Vulkan 等 GPU 加速路径 inference RTF `<=0.5`；short cold process wall `<=120s`；CTranslate2 peak RSS `<=6 GiB`；CrispASR peak RSS `<=12 GiB`。不定义 VRAM gate，且不得用 Python parity 宣称质量/性能通过。

### R3 - Optional Python Reference

- 参考运行覆盖 `faster-whisper`、`kotoba-faster-whisper`、`parakeet`、`qwen3-asr` 和 `reazonspeech-nemo`，通过现有 registry 运行，不新增平行注册表。
- 正确归约所有引擎的 `TranscriptSegmentRefresh`：最终刷新原子替换 preview，报告只计最终片段列表。
- 不修改当前引擎参数、分块、VAD、backfill、模型下载或生产默认值来改善参考结果。
- Python 缺依赖、缺模型或运行失败时记录 `failed`/`skipped` 与复现信息；这只减少诊断参考，不阻塞原生实现对 ground truth 的质量判断。
- Python reference 必须使用与 Hikaru Sub 开发环境一致的 interpreter 和依赖；`HF_HOME`/缓存根作为显式运行参数和元数据记录，不是质量真值。
- 严禁从 Python 结果生成、推断、修补或回填 reference ASS/text/timestamps/speech regions。

### R4 - Reproducible Execution

- 每次结果记录 git revision/dirty、OS/架构、CPU/逻辑核/内存、可用 GPU/driver、Python/runtime 包版本、引擎/模型/device/compute/VAD 参数，以及 manifest 和音频/ASS 哈希。
- 模型下载与首次缓存填充不计入推理；缓存状态、缓存参数和模型 revision 必须记录。
- 冷启动在新进程中拆分 import/start、model load、inference 和 total wall；RTF 同时记录 inference-only 与 total。
- 短音频至少 1 cold + 3 warm 并报告 warm median；中/长至少 1 次并明确样本数。
- 记录峰值 RSS/working set、可用 VRAM 和采样方法；不可用时写 `null` 与原因，不能写 0。
- `completed`、`failed`、`skipped` 使用同一版本化 envelope；报告和命令不得包含绝对路径、私有字幕正文或密钥。

### R5 - Artifacts And Handoff

- 版本化 JSON 是事实来源；Markdown 必须由 JSON 确定性生成。
- 普通 CI 只运行 manifest、指标、refresh 归约和报告生成的无模型自检。
- 模型实测结果写入忽略目录；提交 `research/benchmark-contract.md`。可选 Python 诊断报告最终命名为 `research/python-reference-report.md`，只能在正确环境真实运行后由 JSON 生成。
- T02/T03 必须消费同一 ground-truth manifest/schema、metric implementation、比较命令和结果路径；不得复制 CER/P95/gap 算法。
- 未生成 `python-reference-report.md` 不阻塞 ground-truth 合同交接或 native quality comparison。

## Acceptance Criteria

- [x] corpus manifest/schema/README 明确定义三类时长、WAV+ASS 哈希、参考标注、来源/许可、私有 root 与 ignore 策略。
- [x] 已确认 short/medium/long 材料的非敏感格式、时长和 Dialogue 数被记录；实际 manifest validation 在本地读取并解析 ASS，且正文不进入任务文档或其他 tracked artifacts。
- [x] 至少一个可再分发短 fixture 可运行无模型 manifest/hash 自检；它不替代 `.asr-benchmark` 权威材料。
- [x] CER、Levenshtein、P95、时间轴、confirmed speech gap 和多引擎 `TranscriptSegmentRefresh` 归约有确定性测试。
- [x] runner 通过现有 registry 记录环境、冻结的当前实现参数、冷/热时间、RTF 与资源方法；这些记录标记为 Python reference。
- [x] Python 五引擎均有有效 short-case reference；medium/long 缺失明确记为诊断缺口，不作为 native quality blocker。
- [x] Qwen3 明确区分 ForcedAligner 与 synthetic/mixed/unknown/generic engine-native provenance，后者不计时间精度；不同字幕分段通过归一化字符流匹配。
- [x] 基于 ground truth 形成并经用户评审冻结绝对预算：CER `<=0.35` per engine/case；CPU RTF `<=1.0`；GPU-accelerated RTF `<=0.5`；short cold wall `<=120s`；CTranslate2 RSS `<=6 GiB`；CrispASR RSS `<=12 GiB`；无 VRAM gate。
- [x] 同一 JSON 重复生成去敏 Markdown 无语义差异。
- [x] `python -m unittest discover tests`、benchmark self-check 和 manifest validation 通过。
- [x] 仓库无私有/大型媒体、ASS 正文、绝对机器路径、模型权重、密钥或未许可 transcript。
- [x] `research/benchmark-contract.md` 给出 T02/T03 稳定 ground-truth handoff；`python-reference-report.md` 由有效 short runs 确定性生成，并明确仅为可选诊断参考。

## Out Of Scope

- 实现原生 C++ worker、CTranslate2 或 CrispASR 推理。
- 修改 Python 引擎以改善准确率、分块、补段、进度或性能。
- 改动 Tauri command、React UI、设置、运行依赖或发布包。
- 在 CI 下载模型或运行长时间模型基准。
- 将用户本地 WAV/ASS、ASS 正文、私有 reference 或媒体内容写入任务文档、tracked reports 或其他公开/提交产物。

## Dependencies And Gate

- 前置任务：无。
- T02/T03 的模型实测依赖本任务 ground-truth contract、材料身份和 metric implementation；不依赖 Python reference 成功。
- Python reference 缺失只降低诊断能力。只要权威材料有效，PoC 可直接对 ground truth 报告质量、时间轴、性能与资源测量。

## Planning State

- 需求依据已由用户更新，T01 当前为 `in_progress`。
- benchmark 实现已按 ground-truth authority 修正并在本地校验三组 WAV+ASS；用户补充确认 `long-v1` 包含 `person-names`，corpus-wide 并集现在只缺 `low-volume`，新 manifest SHA-256 为 `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277`。
- manifest coverage 变更后，已用正确开发 interpreter/cache 原子重新生成五引擎 short CPU references，并额外保留 `faster-whisper/base` runner smoke；六份结果均为 1 cold + 3 warm，且仍只代表 current diagnostics。
- 去敏 `python-reference-report.md` 已从新 manifest identity 下的六份 short JSON 确定性生成并接入 T01/T02/T03 manifests；绝对 CER/RTF/cold wall/RSS 与时间轴预算已获用户评审并冻结。
- medium/long Python diagnostics 继续缺失且 non-blocking。T01 实现工作完成，任务保持 `in_progress`，等待项目 commit/finish 流程。
