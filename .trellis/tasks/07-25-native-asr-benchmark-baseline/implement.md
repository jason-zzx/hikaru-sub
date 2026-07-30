# ASR 基准真值实施计划

> 状态：T01 实现已完成并保持 `in_progress`，等待项目 commit/finish 流程；ground-truth 合同、per-case coverage、用户评审后冻结预算、runner 与去敏报告均已验证。五引擎完成新 manifest identity 下的 short CPU Python reference（另含 faster-whisper/base runner smoke）；medium/long Python diagnostics 继续缺失且 non-blocking，不再次运行 `task.py start`。

## Dependency

- 无前置子任务。
- T02/T03 必须复用本任务的权威语料、结果 schema 和指标实现；Python reference 可缺失且不构成质量 gate。

## Execution Checklist

### 1. Freeze Repository-Safe Ground Truth

- [x] 更新 corpus README/schema，定义 WAV+ASS identity、许可、私有 corpus root、reference 提取和 ignore 策略。
- [x] 用用户确认的 short/medium/long 材料建立本地 authoritative manifest，校验 WAV/ASS SHA-256、格式、时长与 Dialogue 数；不得将正文或绝对路径写入任务产物。
- [x] 保留最小可再分发短 fixture，仅用于无模型 parser/hash self-check，不替代权威材料。
- [x] 在任何运行前确认 `.asr-benchmark`、private manifests、raw results、models 和 temp reports 均被精确忽略。

Rollback point: only schema/docs/fixture metadata changes; user local corpus stays untouched.

### 2. Implement Shared Reference And Metrics Contract

- [x] 解析/验证 ASS reference，生成 reference text/segments/speech regions；严禁从 Python output 回填缺失 reference。
- [x] 实现 SHA-256、NFKC/whitespace normalization、S/D/I/N CER、P95、timeline validation 和 ASS-confirmed speech gap checks。
- [x] 将 `TranscriptSegmentRefresh` 实现为通用 final-list replacement，覆盖 Parakeet/Qwen3/ReazonSpeech，不写 Parakeet-only 假设。
- [x] 定义 versioned result envelope 与 deterministic sanitized Markdown renderer。
- [x] self-check 覆盖 CER/P95/invalid range/gap/refresh/report stability。

Rollback point: pure contract code only; no engine behavior changes.

### 3. Add Optional Python Reference Runner

- [x] 通过 `engines.registry.create_engine` 加载当前五引擎；完整消费 iterator 并应用 final refresh replacement。
- [x] 父进程为 cold run 启动新子进程，分别测量 import/start、load、inference、total、RTF 和 peak memory。
- [x] 记录 exact interpreter/dependency versions、model revision、cache state、explicit `HF_HOME`/cache root、device/compute/VAD/config 和 timestamp provenance。
- [x] 统一处理 `completed`/`failed`/`skipped`；缺失 Python reference 只标诊断缺口，不阻塞 native ground-truth quality。
- [x] 使用 temp output + atomic replace；tracked report 不包含正文、绝对路径或 cache path。

Rollback point: runner calls current engines without modifying them.

### 4. Validate Authoritative Matrix And Propose Budgets

- [x] 校验 short 24.102s/8 Dialogue、medium 498.872s/165 Dialogue、long 4144.235s/908 Dialogue，且 WAV 均为 16kHz mono 16-bit PCM。
- [x] 对 ground truth 执行 reference validation、coverage audit 和 metric self-comparison；任何缺失 annotation 明确阻塞对应指标，不能由 Python 补齐。
- [x] 按用户确认补录每个 case 的正向 coverage 标签：short 仅 `clear-japanese`；medium 为 `clear-japanese/background-noise/english/proper-nouns`；long 为 `clear-japanese/long-silence/continuous-speech-over-30s/english/proper-nouns/background-noise/rapid-dialogue/numbers/person-names`。总体并集只缺 `low-volume`，不由 Python 输出推断。
- [x] 用户评审并冻结绝对预算：CER `<=0.35` per engine/case；CPU inference RTF `<=1.0`；GPU-accelerated inference RTF `<=0.5`；short cold process wall `<=120s`；CTranslate2 RSS `<=6 GiB`；CrispASR RSS `<=12 GiB`；不定义 VRAM gate。medium/long native measurements 仍需逐 case 验证。
- [x] 保留硬 gate：0 invalid/out-of-bounds、0 confirmed speech gap `>=1500ms`、Qwen3 median `<=150ms`/P95 `<=500ms`。
- [x] coverage 变更产生新 manifest identity 后，使用与 Hikaru Sub 一致的开发 interpreter/`HF_HOME` 原子重建五引擎 short CPU Python reference；medium/long 未运行并明确阻塞对应诊断 claims，不形成 native quality blocker。
- [x] 由新 manifest identity 下六份有效 short JSON（五引擎主模型 + faster-whisper/base smoke）确定性生成去敏 `research/python-reference-report.md`；报告呈现 short tags、corpus-wide 仅缺 `low-volume`，并明确 Python current diagnostics only。

Rollback point: measurements only; no production defaults change.

### 5. Publish T02/T03 Handoff

- [x] 更新 `research/benchmark-contract.md`，固定 ground-truth authority、schema、metric semantics、comparison commands、result paths 和 privacy boundary。
- [x] 明确官方文档/稳定 API/模型卡/维护良好社区实践优先于 Python implementation details，候选算法以 ground truth 实测选择。
- [x] 明确 T02/T03 可在无 Python reference 时完成 native quality comparison；reference report 只用于诊断。
- [x] 验证同一 JSON 重建 Markdown 语义一致，T02/T03 无需重写 CER/gap/P95/report logic。

## Planned File Scope

```text
scripts/asr-benchmark.py
asr-service/benchmarks/README.md
asr-service/benchmarks/corpus.example.json
asr-service/benchmarks/fixtures/*
asr-service/tests/test_asr_benchmark.py
.gitignore
.trellis/tasks/07-25-native-asr-benchmark-baseline/research/benchmark-contract.md
.trellis/tasks/07-25-native-asr-benchmark-baseline/research/python-reference-report.md  # generated after valid runs
```

Do not modify production engines/jobs, Tauri, React, settings or release inputs.

## Validation

```bash
python scripts/asr-benchmark.py self-check
python scripts/asr-benchmark.py validate --manifest asr-service/benchmarks/corpus.example.json
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
cd asr-service
python -m unittest discover tests
```

Local authoritative shape:

```bash
python scripts/asr-benchmark.py validate --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark
asr-service/.venv/Scripts/python.exe scripts/asr-benchmark.py run --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark --expected-interpreter asr-service/.venv/Scripts/python.exe --hf-home src-tauri/target/debug/deps/models/huggingface --case <case-id> --engine <engine> --model <model-id> --device cpu --output .asr-benchmark/results/<result>.json
python scripts/asr-benchmark.py report --results .asr-benchmark/results --output .asr-benchmark/python-reference-report.md
```

Commands must be invoked with the Hikaru Sub development interpreter and explicit cache environment. Tracked reports sanitize local paths.

## Review Gates

Before completion:

- [x] Ground-truth manifest, ASS-derived references and metric implementation pass review.
- [x] Absolute CER/RTF/cold wall/RSS and timeline budgets received user review and are labeled frozen; no VRAM gate was invented.
- [x] Five Python routes have valid short-case diagnostic references; medium/long absence is explicit and is not a native quality blocker.
- [x] Privacy/license/gitignore review finds no local media, ASS body, absolute path or model artifact in Git.
- [x] T02/T03 handoff paths/schema/authority order are concrete.

## Stop Conditions

- User-provided WAV+ASS cannot establish legally usable/reproducible reference text and timing.
- Local corpus policy would require committing private media, ASS text or absolute paths.
- Metrics cannot distinguish reference speech gaps from ordinary subtitle gaps.
- Any process attempts to repair reference data from Python output.

Return these to the parent rather than weakening ground-truth authority.

## Rollback

Remove only benchmark tooling/tests/schema/docs generated by this task. Do not delete user corpus, model caches or private results, and do not alter product configuration.
