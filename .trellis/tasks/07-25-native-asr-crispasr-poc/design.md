# CrispASR PoC 技术设计

## Summary

T03 通过一个 task-local C++ harness 调用 pinned CrispASR public C ABI，验证三个固定模型组合的 session/result/callback 生命周期、原生时间戳和资源行为。它不承担 worker protocol、下载、ASS、用户路径或产品状态。

PoC 设计为一条可丢弃的最小路径：先验证 immutable inputs 和 C header contract，再验证 lifecycle，最后运行模型矩阵。任何模型特定补偿都留到 T08-T10，避免 PoC 通过后把难以维护的行为锁进架构。

## Architecture

```text
T01 corpus + references + Python baseline
  -> verified CrispASR SDK/header + GGUF hashes
  -> task-local C ABI harness
  -> session open / callbacks / transcribe / result copy / close
  -> raw local output + T01 comparison
  -> per-engine evidence and Gate 0 decisions
```

建议目录：

```text
.trellis/tasks/07-25-native-asr-crispasr-poc/
  research/
    poc-src/                       # tracked disposable source
    crispasr-input-lock.json
    abi-contract.md
    evidence/                      # small tracked schema/summary data
    local/                         # ignored SDK, models, builds, raw results
```

生产 `native-asr/`、`src-tauri/`、`src/` 和 `asr-service/` 均不在此任务边界内。

## C ABI Boundary

所用函数集合必须由 lock 中的 public headers 逐项确认，预期只覆盖：

- explicit session open/configuration；
- transcribe/result getter；
- progress/segment callback registration（若该 pinned ABI 提供）；
- Qwen3 alignment call/result；
- result/session close。

实现采用最小 RAII/cleanup guard，仅为保证每条错误路径恰好关闭一次资源，不建立通用 wrapper/factory。callback context 在 session 和异步 callback 完全停止前持续存在；从 getter/callback 获得的 strings/segments 在对应 owner release 前复制。

`abi-contract.md` 必须记录每个 API 的 header signature、ownership、threading/callback contract、null/error convention 和本 harness 的映射。不能从 header 或 upstream authoritative source 得出的语义视为 blocker。

## CLI Boundary

```text
--engine parakeet-ja|reazonspeech|qwen3-asr
--model <verified-local-gguf>
--aligner <verified-local-gguf>    # qwen3 required
--audio <16k-mono-pcm-wav>
--output <local-result.json>
--self-check | --lifecycle-test
```

CLI 不接受 URL、下载参数、用户配置或 shell string。stdout 只输出一份 bounded result JSON；stderr 输出有限诊断。私有 transcript 保持在 ignored raw result，tracked summary 使用 hash/metrics。

## Lifecycle Contract

1. 验证 input lock、path、format、model role。
2. 创建 callback context，注册每个 ABI 实际提供的 callback。
3. 打开 session，运行 transcript/alignment，收集 callbacks。
4. 在 release 前复制 final result 与可用 timestamps。
5. 关闭 result/session，标记 callback context 失效。
6. 写 success/error result；所有错误分支执行相同 cleanup policy。

测试至少覆盖 invalid path、invalid model role、repeated lifecycle、callback observation、result copy-before-release 和 failure cleanup。没有 official cooperative cancellation API 时，harness 只记录 absence，不尝试自定义 unsafe interrupt。

## Engine Contracts

### Parakeet JA

使用 Q8_0。保存原生 output 和 timestamp source，使用 T01 speech regions 检测 confirmed gaps。PoC 不移植当前 Python 的 activity scan/backfill/final refresh；系统性 gap 是可行性结论的一部分。

### ReazonSpeech

使用 Q8_0。测量 whole-audio 与 callback 形态，输出 subtitle-length distribution。若没有 incremental callbacks，报告为后续 host/progress design input；安全 lifecycle 和最终合法结果仍是必要条件。

### Qwen3-ASR

Q4_K ASR 与 Q4_K aligner 是一个不可拆分的 request。harness 在文本 inference 后调用 pinned aligner API；只有 copied aligner timestamps 才能转换为 final segments。任何缺失/失败/empty/malformed alignment 返回 controlled failure with no final timeline。

## Evidence Contract

每条 run 继承 T01 metrics envelope，并增加：

- `engineRoute`、SDK/header version/commit、model role/hashes；
- callback count/order/thread label/progress trace；
- session/result cleanup states；
- timestamp provenance；
- Qwen alignment status/negative-case code；
- executable/DLL inventory 与 license table。

T01 的 comparator 仍是 CER/gap/time-error 的唯一来源。T03 可以适配 raw native result 到其 input schema，但不得复制 metric logic。

## Error Handling

- input hash/size mismatch: refuse before ABI call.
- open/transcribe/getter/align errors: stable error code, nonzero exit, cleanup.
- invalid native timestamp: reject result, no synthetic replacement.
- missing Qwen aligner: `aligner_required` failure, zero accepted segments.
- exception/unknown C error: capture bounded code/message, preserve local raw output if safe, never include sensitive path/body in tracked logs.

## Compatibility And Trade-offs

- 一个 task-local harness 比生产 worker 更小，也不会预先固定 protocol or packaging decisions。
- 只包一层 cleanup guard，避免在 PoC 阶段造 C ABI abstraction hierarchy。
- Per-engine decisions保持独立：Parakeet 风险不阻塞 Reazon/Qwen feasibility evidence，反之亦然。
- 进程终止和 JSONL progress 属于 T05/T08；这里记录 ABI 实际能力，为后续设计提供事实。

## Rollback

删除 `research/poc-src` 与 ignored `research/local`。已锁定 metadata、ABI contract 和去敏报告留在 task record。生产 runtime、user models、settings 和 app data 都未被触碰。
