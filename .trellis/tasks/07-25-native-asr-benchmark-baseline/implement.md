# ASR 基准实施计划

> 状态：规划完成，等待评审；不得在评审前运行 `task.py start`。

## Dependency

- 无前置子任务。
- 本任务完成后，T02/T03 必须复用其 corpus 和结果合同。

## Execution Checklist

### 1. Freeze Repository-Safe Corpus Policy

- [ ] 创建 `asr-service/benchmarks/README.md`，写明 schema、许可、私有 corpus root 和模型实测流程。
- [ ] 创建 `corpus.example.json` 与最小可再分发短 fixture；记录 SHA-256、来源和许可证。
- [ ] 在首次本地运行前更新精确 `.gitignore` 规则，忽略私有 corpus、模型、原始 results 和临时文件，同时只放行审核过的 example/fixture。
- [ ] 验证仓库内没有绝对路径、私有字幕、模型权重或大型媒体。

Rollback point: 此阶段只增加文档、schema 和 fixture；删除新增文件即可。

### 2. Implement Pure Contract And Metric Checks

- [ ] 在 `scripts/asr-benchmark.py` 中实现 manifest validation、SHA-256、NFKC/whitespace 归一化、S/D/I/N CER、percentile、时间轴合法性和参考语音 gap 检查。
- [ ] 实现 `TranscriptSegmentRefresh` 的最终列表归约，不复制 `JobManager` 的异步生命周期。
- [ ] 定义 versioned JSON envelope 与 deterministic Markdown renderer。
- [ ] 增加 `self-check`，使用内置小向量验证 CER、P95、invalid ranges、gap 和 report stability。
- [ ] 在 `asr-service/tests/test_asr_benchmark.py` 覆盖 good/base/bad cases。

Rollback point: 不触碰引擎；纯工具失败可独立返工。

### 3. Add Isolated Python Engine Runner

- [ ] 通过 `engines.registry.create_engine` 加载固定 engine/model/device/config。
- [ ] 父进程为 cold run 启动新子进程；分别测量 startup/import、load、inference 和 total。
- [ ] 完整消费 segments，应用 refresh replacement，写 terminal JSON。
- [ ] 记录环境、版本、模型 revision/cache 状态、参数、detected language、timestamp provenance、工作集与可选 VRAM。
- [ ] 统一处理 `completed`、`failed`、`skipped`；不可用指标写 `null` 和原因。
- [ ] 使用临时输出加原子替换，处理中断或部分结果时不生成成功标记。

Rollback point: runner 只调用现有引擎，不修改生产实现。

### 4. Capture Python Baselines

- [ ] 验证/准备 short、medium、long 本地 corpus manifest，确认 reference text/speech regions 完整。
- [ ] 对五个引擎执行 CPU baseline；短音频 1 cold + 3 warm，中/长至少 1 次。
- [ ] 可选 GPU 运行单独标记，不能替代 CPU 数据。
- [ ] 对每个失败/缺依赖引擎保存可复现命令、环境、模型状态和错误分类。
- [ ] 检查 Qwen3 timestamp provenance；合成时间戳从 timing accuracy 汇总中排除。
- [ ] 生成去敏 `research/python-baseline-report.md`，不提交本地 raw results 或私有正文。

Rollback point: 模型运行不改变产品默认值；失败只形成证据。

### 5. Publish T02/T03 Handoff

- [ ] 写 `research/benchmark-contract.md`，固定 corpus/result schema、metric semantics、comparison command 和路径约定。
- [ ] 报告五个引擎的 `completed`/`failed`/`skipped` 状态及后续阻塞影响。
- [ ] 验证从同一 JSON 重建 Markdown 得到相同语义内容。
- [ ] 复核 T02/T03 不需要重新实现 CER、gap、P95 或报告逻辑。

## Planned File Scope

Expected additions/changes:

```text
scripts/asr-benchmark.py
asr-service/benchmarks/README.md
asr-service/benchmarks/corpus.example.json
asr-service/benchmarks/fixtures/*
asr-service/tests/test_asr_benchmark.py
.gitignore
.trellis/tasks/07-25-native-asr-benchmark-baseline/research/benchmark-contract.md
.trellis/tasks/07-25-native-asr-benchmark-baseline/research/python-baseline-report.md
```

Do not modify:

```text
asr-service/engines/*
asr-service/jobs.py
src-tauri/*
src/*
release/package inputs
```

If the single CLI becomes untestable, one small pure helper module under `asr-service/benchmarks/` is allowed; no broader framework is planned.

## Validation

Dependency-free checks:

```bash
python scripts/asr-benchmark.py self-check
python scripts/asr-benchmark.py validate --manifest asr-service/benchmarks/corpus.example.json
cd asr-service
python -m unittest tests.test_asr_benchmark
python -m unittest discover tests
```

Model-backed manual shape (final flags are fixed by the implemented CLI help):

```bash
python scripts/asr-benchmark.py run --manifest <local-manifest> --corpus-root <local-root> --engine faster-whisper --device cpu --output <ignored-result.json>
python scripts/asr-benchmark.py report --results <ignored-results-dir> --output <ignored-report.md>
```

Required manual matrix: five engines, short/medium/long where dependencies and models are available. Missing runs require explicit limitation records.

## Review Gates

Before start:

- [ ] PRD/design/implement reviewed.
- [ ] `implement.jsonl` and `check.jsonl` validate.
- [ ] No open product decision remains.

Before completion:

- [ ] Pure checks and full sidecar tests pass.
- [ ] Five-engine report contains either evidence or reproducible limitation for every route.
- [ ] Privacy/license/gitignore review passes before inspecting `git status` for completion.
- [ ] T02/T03 handoff paths and schema are concrete.

## Stop Conditions

- No legally usable/reproducible reference transcript or timing annotation can be established.
- Local corpus policy would require committing private/large media or absolute user paths.
- Metric definitions cannot distinguish reference speech gaps from ordinary subtitle gaps.
- Runner must change engine behavior to obtain a result.

Escalate these to the parent task instead of weakening the benchmark.

## Rollback

Remove only the benchmark tool, tests, fixtures/schema and task reports. Do not delete user model caches or private corpus roots. No settings/project migration is involved.
