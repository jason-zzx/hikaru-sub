# 验证 CrispASR 三引擎 PoC

## Goal

在不改变生产代码、运行依赖或默认路由的前提下，验证 pinned Windows x64 CPU CrispASR public C ABI 能否运行 Parakeet JA Q8_0、ReazonSpeech Q8_0、Qwen3-ASR 1.7B Q4_K + required ForcedAligner，并直接对 T01 authoritative WAV+ASS ground truth 产出合法时间轴、质量、ABI lifecycle、长音频、性能、资源和许可证证据。

本任务只回答三条 native path 的 Gate 0 可行性，不实现 worker/protocol/downloader/字幕补偿。

## Background

- 本任务是 T03，显式依赖 T01 ground-truth contract。
- Qwen3 必须配套 ForcedAligner；缺失/失败不得生成 timed output。
- 当前 Python Parakeet 有 gap/backfill，Qwen3 有 synthetic timing fallback；这些是已知问题诊断，不是 native 模板。
- 当前 Python ReazonSpeech 在 `>=60s` 使用 45s chunks/2s overlap；这是诊断回归事实，不定义 native 算法。
- 当前 Parakeet、Qwen3、ReazonSpeech 都可能通过 `TranscriptSegmentRefresh` 最终替换 preview；refresh 是通用结果合同，不是 Parakeet-only 行为。

## Dependency And Authority Gate

- T01 提供 reviewed `benchmark-contract.md`、short/medium/long case identities、WAV+ASS hashes/reference text/speech regions/timing 和 shared comparator。
- 实现来源顺序：CrispASR official docs/pinned stable public ABI、模型卡、当前维护良好的社区推荐实践，再由 T01 ground truth 实测选择。
- Python reference 可缺失且只用于 diagnostics；不阻塞 native quality/coverage/timing comparison，也不能修补 reference。
- 当前 manifests 已保留 planning evidence，并加入 `benchmark-contract.md` 与由有效五引擎 short runs 确定性生成的 `python-reference-report.md`；后者仅是 non-gating current implementation reference，medium/long claims 仍 blocked。

## Requirements

### R1 - Pinned Disposable Native Boundary

- PoC source 仅在 `research/poc-src/`；SDK/models/build/raw output 位于 ignored local。不得改产品、Python engine 或 release inputs。
- `research/crispasr-input-lock.json` 固定 CrispASR release/commit/public ABI/runtime archive hash/toolchain，以及四个 GGUF immutable revision/name/size/hash/license/attribution。
- 固定 Parakeet Q8_0、Reazon Q8_0、Qwen3 Q4_K、Aligner Q4_K；不接受 floating aliases。
- 只使用 pinned headers 证明的 public C ABI，不解析 CLI text。

### R2 - ABI Lifecycle And Callback Evidence

- 验证 paths/input、session open、available callbacks、transcribe、final result copy 和 exact-once cleanup。
- 明确 callback context/result/string/segment ownership；borrowed data 在 owner release 前复制。
- 每引擎记录 callback count/order/thread/progress monotonicity、preview/final getter/refresh relationship、cleanup 和 cooperative cancellation capability。
- 无 cancellation API 时记录并交 T05/T08 用 process termination；undefined ownership/late callback/close crash 是 blocker。

### R3 - Ground-Truth Timeline And Long Audio

- 三引擎在 T01 short/medium/long cases 运行，保留 ignored raw upstream result，报告 legal segments、timestamp provenance、subtitle-length distribution、CER、confirmed gaps、RTF、memory 和 failures。
- 每个 segment 非空、`0 <= startMs < endMs <= durationMs`、排序；PoC 不添加 Python VAD/backfill/resegmentation/chunk fixes 来使结果通过。
- 使用 ASS-derived reference speech regions 列出所有 `>=1500ms` confirmed gaps。
- 算法/分块/VAD/merge 依据 official/model-card/community sources，按 ground truth 选择。当前 Reazon 45s/2s-overlap 与三引擎 final refresh 仅作为 diagnostics/regression evidence。

### R4 - Qwen3 Forced Alignment

- Qwen3 request/model state 同时包含 ASR+Aligner GGUF。
- normal/leading-silence/boundary/long cases 的 accepted timestamps 全部来自 aligner word/character results；记录 provenance/unmatched/start errors。
- missing/corrupt/unloadable/empty/malformed/error aligner cases 必须 controlled failure，accepted timed segments 为零。
- 禁止调用/复刻 Python synthetic timing。

### R5 - Evidence And Decision

- Evidence 包含 input lock、ABI contract、lifecycle/callback、per-engine/case JSON、Qwen negative cases、runtime inventory、licenses 和 authoritative source citations。
- 统一复用 T01 CER/gap/P95/time/RTF/resource contract，不创建第二套 scorer。
- `research/crispasr-poc-report.md` 按 route 给出 `proceed`/`proceed-with-named-risks`/`stop-revise`。
- T01 absolute budgets 已获用户评审并冻结；PoC 必须按更新后的 manifest identity 报告 measured/pass/fail/blocked，不能用 Python parity 宣称通过，也不能把 Gate 0 冒充 T08-T10 产品化完成。

## Acceptance Criteria

- [ ] T01 ground-truth contract 已评审，manifests 加入 `benchmark-contract.md`；optional Python reference 不构成 gate。
- [ ] input lock 固定 SDK/toolchain/public ABI/four models immutable provenance/hash/size/license。
- [ ] CPU Release x64 harness/CTests 覆盖 invalid input、repeat lifecycle、callback capture、copy-before-release 和 controlled errors。
- [ ] 三引擎 ownership/callback/final-refresh/cleanup 有 route-specific evidence，无 unsafe lifecycle。
- [ ] 三引擎 short/medium/long 各有 ground-truth metrics 或 reproducible native blocker；all confirmed gaps reported, not patched。
- [ ] Qwen3 只在 aligner success/provenance 时有 timeline；negative cases zero accepted timed output。
- [ ] 所有 accepted segments legal/sorted/in-bounds；private text stays ignored。
- [ ] report 记录 resources/runtime/model sizes/licenses/decisions/downstream handoff，按冻结 T01 gates 给出可审计状态且不以 Python diagnostics 作为 pass evidence。
- [ ] 不提交 models/private media/ASS text/absolute paths/SDK/build/product changes。

## Out Of Scope

- Worker protocol/Rust host/cancel/recovery/Tauri commands。
- 产品 VAD/normalization/progress/Parakeet backfill/Reazon chunking/Qwen merge/refresh strategy。
- Downloader/runtime package/UI/settings。
- Python parity 或最终 release qualification。

## Rollback

删除 task-local source 与 ignored SDK/model/build/results；保留 lock/report。任务不修改 production config、user cache 或 ground truth。

## Planning State

- T03 保持 `planning`。
- 执行前置为 T01 ground-truth handoff、manifest refresh、immutable inputs 和 ABI/license review；Python reference 成功不是前置。
