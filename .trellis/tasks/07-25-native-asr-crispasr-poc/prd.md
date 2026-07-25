# 验证 CrispASR 三引擎 PoC

## Goal

在不改变 Hikaru Sub 生产代码、运行依赖或默认路由的前提下，验证固定版本的 Windows x64 CPU CrispASR 公共 C ABI 能否运行 Parakeet JA Q8_0、ReazonSpeech Q8_0，以及 Qwen3-ASR 1.7B Q4_K 加必需 ForcedAligner 0.6B Q4_K，并产出合法日语时间轴、ABI 生命周期、长音频覆盖、资源和许可证的可审计证据。

本任务只回答三条原生路径是否具备继续产品化的基础；不实现最终 worker、协议、下载器或字幕补偿。

## Background

- 本任务是父任务 T03，显式依赖 T01 `native-asr-benchmark-baseline`。
- 父任务固定路由：Parakeet、ReazonSpeech 与 Qwen3 都使用 CrispASR；Qwen3 必须配套 ForcedAligner，缺失或失败时不得生成伪造时间轴。
- 现有 Python Parakeet 包含长音频 gap/backfill 和最终 `TranscriptSegmentRefresh`；这些是风险证据，不是应在 PoC 中直接迁移的代码。
- 现有 Python ReazonSpeech 是 whole-audio 路径；CrispASR callback/progress 是否逐引擎可用必须实测，不得假定相同。
- 现有 Python Qwen3 在 aligner 不可用时可走文本平均分段回退；该行为是 native target 明确禁止的反例。

## Dependency Gate

- 启动模型实测前，T01 必须已完成并提供受评审的 corpus/result contract、short/medium/long case IDs、文件哈希、参考文本/语音区间、Python baseline 和比较命令。
- T01 相关引擎基线缺失时，T03 可以完成 SDK/header/input research；不得宣称该引擎质量、长音频覆盖或时间精度可比较。
- T03 激活前，两个 context manifests 必须用 T01 最终 `benchmark-contract.md` 与 `python-baseline-report.md` 替换/补充当前 planning evidence。

## Requirements

### R1 - Pinned, Disposable Native Boundary

- PoC source 仅位于本任务 `research/poc-src/`；SDK、模型、build、raw run output 位于 ignored local 目录。不得新建生产 `native-asr/`、改动 Rust/Tauri/React/Python 引擎、发布脚本或资源。
- 在编译前生成 `research/crispasr-input-lock.json`，锁定 CrispASR release/commit、public header/API version、runtime archive URL/SHA-256、Windows toolchain，及四个 GGUF 的 immutable revision、文件名、精确 size/SHA-256、许可证/attribution 来源。
- 固定模型为 Parakeet JA Q8_0、ReazonSpeech Q8_0、Qwen3 1.7B Q4_K 和 Qwen3 ForcedAligner 0.6B Q4_K。不接受 floating branch、`latest`、近似 size 或未校验模型。
- harness 只使用经 pinned headers 确认的 CrispASR public C ABI；任何 API 名称/ownership 假设必须从该版本 header 证明，不依赖 CLI 文本输出。

### R2 - ABI Lifecycle And Callback Evidence

- harness 必须验证本地 audio/model paths、打开 session、注册可用的 progress/segment callbacks、运行、读取 final result 并在所有分支关闭资源。
- callback context、result pointer 和 text/segment data 的 lifetime 必须明确；任何 borrowed result 在释放 result/session 前复制。重复 open/transcribe/read/close、invalid paths 和 failure paths 必须受控，不可崩溃。
- 对每个引擎记录 callback count/order/thread identity、reported progress、monotonicity、segment callback 与最终 getter 的关系、session/result cleanup outcome，以及 public ABI 是否公开 cooperative cancellation。
- 本任务不虚构未提供的 cancellation API；若没有可用回调取消，记录为 T08/T05 通过进程终止解决的设计输入。callback after context release、close-time crash 或无法确定 ownership 是停止条件。

### R3 - Legal Timelines And Long-Audio Evidence

- Parakeet 和 ReazonSpeech 在 T01 short/medium/long cases 上运行，保留 raw upstream result 供本地检查，报告最终 legal segments、native timestamp source、subtitle length distribution、RTF、memory 与任何失败。
- 每个接受的 segment 必须非空、`0 <= startMs < endMs <= durationMs`、按时间排序；不在 PoC 中加入 VAD fallback、Japanese resegmentation、gap backfill 或 `segmentsReplace` 修正来使结果通过。
- 使用 T01 reference speech regions 列出所有 `>=1500ms` confirmed speech gaps。Parakeet 的 short-audio 成功不能替代 medium/long 覆盖结论。
- ReazonSpeech 缺少增量 callback 是可报告的发现；无法安全完成/读取/关闭或在长音频稳定运行则是阻塞。

### R4 - Qwen3 Forced Alignment

- Qwen3 的模型状态和运行请求必须同时包含 ASR GGUF 与 ForcedAligner GGUF。
- 在 normal、leading-silence 与 long/boundary T01 cases 上，最终 segments 的每个时间戳都必须来自 aligner word/character result，记录 timestamp provenance 和匹配误差。
- 对 missing/corrupt/unloadable aligner、empty alignment、malformed ranges 和 aligner error 提供 negative cases。所有此类情况必须失败，且不输出接受的 timed segments。
- 不得调用或复刻 Python `build_segments_from_text` 等均分/合成时间逻辑。Qwen3 文本成功不等于 PoC 成功。

### R5 - Evidence, Resources And Licenses

- machine-readable evidence 至少包含 input lock、ABI/header contract、lifecycle/callback result、per-engine/per-case run JSON、Qwen negative-case results、runtime inventory 和 license table。
- 统一复用 T01 计算 RTF、peak memory、CER、gap 和时间误差的合同；T03 不创建第二套评分实现。
- 记录 cold/load/inference/total 时间、runtime executable/DLL sizes、模型 sizes、CPU/RAM/可用 VRAM 与测量方法。不可用指标写 `null` 和原因。
- `research/crispasr-poc-report.md` 对三条路线独立给出 `proceed`、`proceed-with-named-risks` 或 `stop/revise`，并把需要后续 T08/T09/T10 处理的风险明确移交。

## Acceptance Criteria

- [ ] T01 已交付三类 case 的正式 corpus/baseline/compare contract，且 T03 manifests 已更新为最终交付物。
- [ ] `crispasr-input-lock.json` 固定 SDK/toolchain/public ABI 与四个模型的 immutable provenance、hash、size 和许可证；无浮动唯一来源。
- [ ] CMake Release x64 harness 使用 pinned public C ABI 构建，CTests 覆盖 invalid input、重复 lifecycle、callback capture、result copying 和 controlled error paths。
- [ ] 三个引擎分别记录 session/result ownership、callback/progress 行为及 cleanup outcome；无 callback-lifetime/close crash/未定义 ownership 问题。
- [ ] Parakeet 和 ReazonSpeech 在 T01 short/medium/long matrix 上各有合法 native result 或可复现的资源/API/模型阻塞记录；所有 confirmed `>=1500ms` speech gaps 被列出而非修补。
- [ ] Qwen3 只在 ASR 加 aligner 成功且时间戳可追溯时产生最终 timeline；所有 aligner negative cases 失败且没有合成 timed output。
- [ ] 所有被接受的 segments 均非空、合法、排序且不越界；raw output/diagnostic evidence 可追溯但私有正文不进入提交产物。
- [ ] report 记录资源、runtime/model sizes、license/attribution、per-engine decision 与对后续子任务的明确交接。
- [ ] 不提交模型、私有/大型媒体、绝对路径、SDK/build tree、生产运行时、UI/设置/下载器/发布改动。

## Out Of Scope

- `hikaru-asr-worker.exe`、JSONL protocol、Rust job host、process-tree cancellation、recovery snapshots 或 Tauri commands。
- 生产 VAD、audio normalization、result normalization、progress normalization、Parakeet backfill、Reazon chunking、Qwen overlap merge 或字幕分段策略。
- 模型 manifest/downloader、镜像、旧 cache、managed `deps/`、runtime package、installer/portable、UI/设置迁移。
- 将 CrispASR CLI 解析输出当作 C ABI 接口，或宣称当前 PoC 达到最终 CER/RTF/size/release 门槛。

## Rollback

删除 task-local PoC source 与 local SDK/model/build/result files；保留 lock/report 作为 Gate 0 证据。任务不会改动生产默认值、用户 cache、设置或项目数据。

## Planning State

- 需求已收敛；执行唯一硬前提是 T01 的完成交接与 inputs lock。
- 任务保持 `planning`，在 T01 和 artifacts/manifests 评审完成前不得启动。
