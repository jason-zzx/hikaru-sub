# ASR 基准技术设计

## Summary

本任务用一个标准库优先的 Python CLI 建立语料验证、Python 引擎执行、指标计算和报告生成。它直接复用当前 `AsrEngine`/registry，并把模型运行与纯指标自检分开，使普通 CI 不依赖任何模型。

JSON 结果是唯一事实来源。大型/私有语料和原始结果保持本地，仓库只保存 schema、可再分发小 fixture、确定性测试和去敏报告。

## Boundaries

### Benchmark CLI

建议最小结构：

```text
scripts/asr-benchmark.py
asr-service/benchmarks/README.md
asr-service/benchmarks/corpus.example.json
asr-service/benchmarks/fixtures/
asr-service/benchmarks/results/        # ignored
asr-service/tests/test_asr_benchmark.py
```

优先保持单个 CLI 文件；只有纯函数难以测试时才拆出 `asr-service/benchmarks/*.py`。不引入 benchmark framework、FastAPI client、第二套 registry 或仅为 CER 增加第三方依赖。

### Existing ASR Code

- `engines.registry.create_engine` 是唯一引擎创建入口。
- `AsrEngine.load()` 与 `transcribe()` 是测量边界。
- runner 完整消费 iterator；遇到 `TranscriptSegmentRefresh` 时原子替换累计片段。
- 现有引擎文件、jobs、schemas 和 server 保持只读行为基线。

## Data Flow

```text
corpus manifest + --corpus-root
  -> validate paths/hash/format/license metadata
  -> spawn fresh benchmark child process
  -> create_engine + load + transcribe + consume final segments
  -> collect timing/resource/environment data
  -> write schema-versioned run JSON
  -> compare reference vs hypothesis
  -> generate deterministic Markdown report
```

纯自检只执行 manifest/metric/report 函数，不导入可选模型依赖。

## Corpus Contract

每个 case 至少包含：

```json
{
  "id": "stable-case-id",
  "audio": "fixtures/example.wav",
  "sha256": "...",
  "durationMs": 12000,
  "sampleRate": 16000,
  "channels": 1,
  "durationClass": "short",
  "tags": ["clear", "named-entities"],
  "referenceText": "...",
  "referenceSegments": [
    {"startMs": 0, "endMs": 1000, "text": "...", "speech": true}
  ],
  "source": "...",
  "license": "..."
}
```

`audio` 是相对 corpus root 的键，不是绝对路径。对于私有语料，整个 manifest 也可位于 ignored root；提交的 example 只展示 schema，不引用真实用户文件。

参考时间轴的最小单位是人工确认的语音区间/片段。漏段判定使用这些区间与候选 segments 的覆盖关系。Qwen3 时间误差按有稳定顺序和文本标注的参考片段匹配；未匹配项单独报告，不能用最近邻掩盖缺段。

## Result Contract

### Run Metadata

- schema version、run ID、时间、git revision/dirty；
- corpus manifest hash、case ID、audio hash；
- OS、CPU、RAM、可选 GPU/driver；
- Python/engine/runtime/model revision；
- device、compute type、language、VAD 和引擎专属参数；
- cold/warm 标记与重复序号。

### Measurements

- startup/import、load、inference、total wall milliseconds；
- inference RTF 与 total RTF；
- peak working set/RSS、可选 VRAM、测量方法；
- detected language、timestamp provenance；
- final segments 与 raw/normalized hypothesis；
- CER 计数、时间轴错误、参考语音漏段和可用时的时间误差。

`completed`、`failed`、`skipped` 使用同一个 result envelope。不可用指标使用 `null` 加 `unavailableReason`。

## Text Normalization

评分函数执行：

1. Unicode NFKC；
2. 统一换行；
3. 删除全部 Unicode whitespace；
4. 保留标点、字母大小写及其他字符。

Levenshtein 返回 S/D/I/N，不只返回比例。空参考文本不是合法 CER case，manifest validation 应拒绝或将 case 标为仅时间轴用途。

## Timing And Resource Measurement

- cold run 每次由父 CLI 启动新 Python 子进程；模型已缓存，下载不计时。
- `loadMs` 包围 `engine.load()`；`inferenceMs` 包围 `transcribe()` 加 iterator 完整消费；`totalMs` 包含二者及 runner 固定开销。
- 短音频使用 1 cold + 3 warm 样本；中/长至少一个明确标记的样本。
- Windows RAM 使用一个明确记录语义的进程峰值方法。VRAM 可使用已存在的系统工具；工具缺失时记录不可用，不新增重依赖。
- 子进程输出结构化结果；stderr 仅作为诊断摘要，不持久化完整字幕或敏感路径。

## Determinism And Privacy

- JSON 键顺序、数字格式和 report 排序固定，便于 diff。
- 公开 fixture 的文本可以进入提交报告；私有语料报告只保留 case ID、hash、聚合指标和限制，不保留正文。
- `.gitignore` 在第一次模型运行前覆盖本地 corpus、results、模型和临时报告目录。
- JSON/report 写入使用临时文件后替换，避免长运行中断留下被误认为完成的结果。

## Compatibility And Handoff

T02/T03 只依赖以下稳定输出：

- corpus manifest schema 与 case IDs/hashes；
- normalization/metric definitions；
- versioned run JSON schema；
- comparison/report command；
- Python baseline report 和每个引擎的限制状态。

后续原生 harness 可以直接产生同一 run JSON，或由薄适配器转换；不得复制 CER/percentile/gap 计算。

## Trade-offs

- 使用标准库动态规划 CER，避免新依赖；语料规模是字幕文本，O(n*m) 在单 case 上可接受。如长文本内存成为实测问题，再改为双行 DP，不提前引入库。
- 不把 >60 分钟 fixture 提交到仓库，牺牲一键 CI 全量运行，换取许可、体积和隐私安全。
- 基线记录现有缺陷但不修复，避免在迁移前移动比较目标。

## Rollback

删除基准 CLI、测试、schema/README 和任务报告即可。任务不改引擎、用户设置、缓存布局或生产路径；本地 ignored corpus/results 可由操作者自行保留或删除。
