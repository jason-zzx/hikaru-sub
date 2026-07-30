# 验证 CTranslate2 Whisper 与 Kotoba PoC

## Goal

在不改动 Hikaru Sub 生产路径的前提下，证明 pinned Windows x64 CPU CTranslate2 C++ 路径能够加载 `large-v3` 和 Kotoba v2.0，按权威来源完成最小 tokenizer/log-mel/timestamp/segment 链路，并直接对 T01 ground truth 产出可审核的质量、时间轴、性能与资源可行性证据。

本任务是 Gate 0 PoC，不是最终 worker、发布 runtime 或产品化 Whisper 实现。

## Background

- 本任务是 T02，显式依赖 T01 ground-truth contract。
- 当前 Hikaru Sub 使用 `faster-whisper==1.2.1`、`ctranslate2==4.8.0`。Python CPU int8/beam/VAD 与 Kotoba 15 秒/no-context 行为仅是 current-implementation diagnostics。
- 当前 `large-v2` + `ja` + `>=600000ms` 有 V4/seed/session/语义分段特殊路径；它是 T06 必须覆盖的产品回归案例，不是原生算法模板。T02 仍聚焦 large-v3 + Kotoba 的通用 CT2 可行性。
- CTranslate2 C++ API 只提供底层 Whisper 能力；特征、tokenizer、prompt、timestamp、窗口和 merge 必须由 PoC 证明。
- T04/T05/T06/T07 分别拥有 protocol、Rust host 与产品化管线；本任务不得提前占用。

## Dependency And Authority Gate

- T01 必须提供受评审的 `benchmark-contract.md`、权威 short/medium/long case identities、WAV+ASS hashes/reference annotations、共享指标和比较命令。
- 实现来源顺序：官方 CTranslate2/Whisper 文档和稳定 API、pinned 模型卡、当前维护良好的社区推荐实践，再由 T01 ground truth 实测选择。
- Python faster-whisper/Kotoba reference 可缺失且只用于诊断；不阻塞 native run 或 ground-truth comparison。
- 当前 manifests 已保留 planning evidence，并加入 `benchmark-contract.md` 与由有效五引擎 short runs 确定性生成的 `python-reference-report.md`；后者仅是 non-gating current implementation reference，medium/long claims 仍 blocked。

## Requirements

### R1 - Isolated And Pinned PoC

- 所有实验源码位于任务 `research/poc-src/`；build/model/raw outputs 位于 ignored local 目录。不得创建生产 `native-asr/` 或修改产品、sidecar、发布脚本。
- `research/inputs.lock.json` 固定 Windows/CPU toolchain、CTranslate2 commit/archive hash、JSON/tokenizer/FFT 依赖，以及两个 model snapshot immutable revision/files/sizes/hashes/licenses。
- 不接受 `main`、`latest`、宽版本或 alias 作为唯一锁；不提交模型或绝对路径。
- 只使用 public C++ Whisper API，CPU-only Release x64；CUDA 不参与 PoC。

### R2 - Model, Tokenizer And Feature Proof

- 验证 large-v3 与 Kotoba 实际 metadata/assets；Kotoba 缺 `preprocessor_config.json` 必须失败，普通 Whisper 不扩大该要求。
- tokenizer golden set 符合 pinned tokenizer assets、官方 contract 和维护良好的实现向量。Python token output 可作诊断；差异需解释，但 Python parity 不是停止 gate。
- 确定性 WAV 与 T01 cases 的 log-mel shape/frame/numerical tolerance 依据 pinned Whisper preprocessing contract 固定；Python feature 可并列诊断，不是唯一 oracle。
- timestamp parser 使用官方 token contract、维护良好的 golden vectors 和真实 traces 覆盖 paired/consecutive、leading silence、incomplete/malformed/no-timestamp。
- 每个 segment 必须非空、`0 <= startMs < endMs <= durationMs`、有序且可追溯到 Whisper timestamp tokens；禁止合成时间轴。

### R3 - Model-Backed Ground-Truth Feasibility

- large-v3/Kotoba 的 device/compute/decode/window 候选必须记录 authoritative source；在 T01 authoritative cases 上运行并记录 load/inference/total、RTF、peak memory、token trace reference、segments、environment/error。
- Kotoba 记录窗口、prompt hash、context policy、preprocessor 使用和边界观察；不得为通过 PoC 复制 Python 分块/VAD/backfill。
- 在 clean PATH/GPU-disabled 环境证明只依赖列出的 native DLL；该结论只覆盖测试机。
- 文本/时间轴直接与 T01 reference 比较；性能/资源记录绝对值。Python reference 可并列但不是 expected output、relative gate 或 annotation substitute。
- T01 绝对预算已获用户评审并冻结；PoC 必须按更新后的 manifest identity 报告 `measured`/`pass`/`fail`/`blocked`，但不得把 Gate 0 结果冒充 T06/T07 产品化完成，也不得使用 Python parity。

### R4 - Evidence And Decision

- 生成 inputs lock、model contract、tokenizer/mel/timestamp goldens、build/runtime inventory、per-case runs 与 Kotoba obligations。
- `research/ctranslate2-poc-report.md` 对每项给出 pass/fail/blocked、evidence、license、resources 和 `proceed`/`proceed-with-named-risks`/`stop-revise`。
- 合法时间轴、authority contract、license 或 binary distribution 出现 blocker 时反馈父任务，不扩大 PoC 范围。

## Acceptance Criteria

- [ ] T01 ground-truth contract 已评审，context 已加入 `benchmark-contract.md`；optional reference report 不构成 gate。
- [ ] `inputs.lock.json` 固定 toolchain/CTranslate2/dependencies/models immutable provenance、hash 和 license。
- [ ] CPU Release x64 PoC 可构建，CTests 覆盖 parser/feature/timestamp/segment self-checks。
- [ ] Kotoba-only preprocessor negative case 与 ordinary Whisper positive case 有证据。
- [ ] tokenizer/log-mel/timestamp goldens 符合 authoritative contracts；Python 差异只作为诊断记录。
- [ ] model runs 只产生合法、非空、token-derived segments；malformed input controlled failure。
- [ ] large-v3 与 Kotoba 在 T01 cases 上产出 ground-truth absolute measurements，或给出可复现 native blocker。
- [ ] Kotoba 报告记录配置及其 authoritative source，边界问题未被 Python-parity patch 掩盖。
- [ ] runtime inventory 记录 x64/DLL/hash/size/clean launch，且无 Python/CUDA runtime dependency。
- [ ] Gate 0 报告不混入 T04-T12 产品实现，按冻结 T01 gate 给出可审计状态且不把 Python diagnostics 当作 pass evidence。
- [ ] 不提交 model/private audio/ASS text/build/absolute path/production code。

## Out Of Scope

- Worker protocol、Rust host、cancel/recovery/Tauri command。
- 产品化全模型/large-v2 long-audio、VAD、fallback、merge、cache compatibility 和最终质量调优。
- Downloader/runtime package/UI/settings。
- 证明最终安装体积或全 Windows 兼容性。

## Rollback

删除 task-local PoC source 与 ignored build/model/results；保留 inputs lock/report。任务不修改生产配置、用户缓存或 ground-truth material。

## Planning State

- T02 保持 `planning`。
- 唯一执行前置是 T01 ground-truth handoff、manifest refresh、immutable inputs 与评审；Python reference 成功不是前置。
