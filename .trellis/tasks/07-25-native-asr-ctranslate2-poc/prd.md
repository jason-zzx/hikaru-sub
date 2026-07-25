# 验证 CTranslate2 Whisper 与 Kotoba PoC

## Goal

在不改动 Hikaru Sub 生产路径的前提下，证明固定版本的 Windows x64 CPU CTranslate2 C++ 路径能够加载 `large-v3` 和 Kotoba v2.0，完成原生 tokenizer、log-mel、timestamp token 解码与最小分段，并产出可审核的日语时间轴和 runtime 可行性证据。

本任务的输出是 Gate 0 的可行性结论，不是最终 worker、发布 runtime 或产品化 Whisper 实现。

## Background

- 本任务是父任务 T02，显式依赖 T01 `native-asr-benchmark-baseline`。
- 当前 Python faster-whisper 基线固定了 CPU int8、beam size 5、日语和 VAD 行为；Kotoba 额外固定 15 秒分块、`condition_on_previous_text=false` 与 `preprocessor_config.json` 就绪规则。
- CTranslate2 C++ API 只提供底层 Whisper 能力。音频特征、tokenizer、prompt、timestamp token、窗口推进和最终重叠处理都不能假定已经由 API 完成。
- T04 负责 protocol v1 和 fake worker；T05 负责 Rust job host；T06/T07 才负责可发布的 Whisper/Kotoba 管线。本任务不得提前占用这些职责。

## Dependency Gate

- 启动模型实测前，T01 必须已完成并提供受评审的 corpus/result contract、至少一个可再分发短 case、一个超过 30 秒的边界 case、文件哈希、参考标注、Python faster-whisper/Kotoba 基线和比较命令。
- T01 缺少某个模型的 Python 基线时，T02 可以在保持 `planning` 的前提下完成静态资料/构建准备；不得启动模型实测或宣称该模型质量/性能可比较。
- T02 的实现前必须把 T01 的最终 `research/benchmark-contract.md` 与 `research/python-baseline-report.md` 加入 context manifests，替换仅作规划参考的 T01 证据。

## Requirements

### R1 - Isolated And Pinned PoC

- 所有实验源码位于本任务 `research/poc-src/`；构建、模型、运行日志和原始结果位于 ignored local 目录。不得创建生产 `native-asr/` 项目或修改 `src/`、`src-tauri/`、`asr-service/`、发布脚本或 package 配置。
- 在编译前生成 `research/inputs.lock.json`，锁定 Windows/CPU、MSVC、Windows SDK、CMake、Ninja、CTranslate2 commit/archive SHA-256、JSON/tokenizer/FFT 依赖的版本与许可证，以及两个模型 snapshot 的 immutable revision、所需文件、精确大小和 SHA-256。
- 不接受 `main`、`latest`、宽版本范围或模型别名作为唯一锁。模型权重与本地绝对路径不得提交。
- 使用 CTranslate2 的公开 C++ Whisper API，CPU-only Release x64 构建；CUDA 不参与 PoC。

### R2 - Model And Tokenizer Proof

- 验证 `large-v3` 与 `kotoba-tech/kotoba-whisper-v2.0-faster` 的实际模型目录和 metadata，记录 config、model、tokenizer/vocabulary 与 tokenizer special/language/timestamp token 所需文件的哈希。
- Kotoba 缺失 `preprocessor_config.json` 必须被拒绝；普通 faster-whisper 模型不得因为缺少该文件被错误拒绝。
- 对日语、标点、数字、拉丁人名与 Whisper prompt token 的小型 golden set，原生 tokenizer 的 token IDs 与 decode 行为必须和 T01 锁定的 Python oracle 一致。差异是停止/架构评审信号，不能靠输出后处理掩盖。

### R3 - Audio Feature And Timestamp Proof

- 在确定性 WAV 与 T01 short case 上比对 Python 与原生 log-mel 的采样率、mel bins、帧数、规范化/窗口/FFT/hop 约定和数值误差。
- log-mel shape 与 frame count 必须一致；数值容差须在真实模型推理前写入 evidence，发现差异时先定位约定而不是事后放宽阈值。
- 原生 timestamp parser 要用已捕获的 Python token 序列测试 paired/consecutive timestamps、leading silence、最终不完整 span 和 malformed/no-timestamp 输入。
- 每个接受的 segment 必须非空、`0 <= startMs < endMs <= durationMs`、按开始时间非递减，且时间可追溯到 Whisper timestamp token；不能用整段平均分配或其他合成时间轴。

### R4 - Model-Backed Feasibility

- `large-v3` 使用 CPU int8、beam size 5、日语，在 T01 short 和 boundary cases 上运行；记录 model load、inference、RTF、峰值内存、raw token trace 引用、最终 segments、环境和错误。
- Kotoba 使用固定模型、CPU int8、日语、15 秒窗口和无前文条件；记录每个窗口起止、prompt hash、preprocessor 使用情况、边界重复/缺段与最终合法 timeline。
- PoC 必须在移除 Python 路径/禁用 GPU 可见性的清洁运行环境中证明只依赖已列出的原生 runtime DLL。该证明只覆盖记录的测试机，不声明 T12 的安装包兼容性。
- 报告必须将文本/时间轴与 T01 基线进行比较，但不在本任务宣称已满足 T06/T07 的最终 CER、RTF、长音频或缓存兼容门槛。

### R5 - Evidence And Decision

- 生成 machine-readable evidence：inputs lock、model contract、tokenizer/mel/timestamp golden results、build/runtime inventory、per-case runs 与 Kotoba obligations。
- 生成 `research/ctranslate2-poc-report.md`，每项显示 pass/fail/blocked、证据路径、许可证状态、资源测量和一个明确结论：`proceed`、`proceed-with-named-risks` 或 `stop/revise`。
- 若任一模型无法以合法时间轴运行、tokenizer/timestamp 行为无法解释、许可证/二进制分发存在未解决阻塞，必须作出 `stop/revise` 或具名阻塞结论并反馈父任务。

## Acceptance Criteria

- [ ] T01 已交付并评审两模型可用的 corpus/baseline/compare contract；任务 context 已更新为最终 T01 交付物。
- [ ] `inputs.lock.json` 固定 toolchain、CTranslate2、依赖和两模型的 immutable inputs、哈希和许可证；无浮动唯一来源。
- [ ] Release x64 CPU PoC 可在记录的 Windows 主机编译，CTests 覆盖 request-free parsing/feature/timestamp/segment self-checks。
- [ ] 两个模型 metadata 通过实际文件检查；Kotoba-only `preprocessor_config.json` negative case 与普通模型 positive case 均有证据。
- [ ] 两个模型的 tokenizer golden set 与 Python oracle 一致；log-mel shape/frame contract 一致，数值差异得到预先记录容差或明确阻塞结论。
- [ ] timestamp golden tests 和 model-backed runs 都只产生合法、非空、token-derived segments；malformed token 输入受控失败。
- [ ] large-v3 与 Kotoba 都在 T01 指定 case 上产生非空日语 timeline，或给出可复现的失败/资源/许可证阻塞证据。
- [ ] Kotoba 输出证明 15 秒窗口、日语 prompt、无前文条件和 `preprocessor_config.json` 使用；任何边界缺陷未被产品化修补。
- [ ] runtime inventory 记录 x64/DLL 依赖、文件大小、清洁启动结果和 Python/CUDA 依赖缺失情况。
- [ ] `ctranslate2-poc-report.md` 给出可审计的 Gate 0 结论，不混入 T04-T12 的实现或质量声明。
- [ ] 不提交模型、私有音频、local build、绝对路径、生产代码或发布资源改动。

## Out Of Scope

- Worker JSONL protocol、stdin/stdout 事件、进程取消、Rust host、恢复快照和 Tauri command。
- 生产 Whisper 30 秒窗口、VAD 映射、no-speech/fallback、overlap merge、language detection 或最终质量调优。
- Kotoba 旧 Hugging Face cache 复用、long-audio 修正与正式 readiness 实现。
- 模型 manifest/downloader、mirror、managed `deps/`、安装/portable runtime、UI 或设置迁移。
- 证明最终 setup/portable size 或所有 Windows/CPU 兼容性。

## Rollback

删除 task-local PoC source 与 local build/model/result directories；保留 inputs lock 和报告作为架构证据。任务不修改生产默认值、用户缓存、设置或项目数据，因此不需要迁移/回滚代码。

## Planning State

- 任务需求已收敛；唯一执行前置是 T01 的真实交付物。
- 任务保持 `planning`，必须在 T01 完成、artifacts/manifests 更新并经评审后才可 `task.py start`。
