# CTranslate2 PoC 实施计划

> 状态：规划完成，等待 T01 与评审；不得在此前运行 `task.py start`。

## Hard Dependencies

- T01 已归档/评审，并提供 `benchmark-contract.md`、`python-baseline-report.md`、两模型相关 case hashes/reference annotation 及比较命令。
- 模型、CTranslate2 SDK、工具链和 license 都能在 `inputs.lock.json` 中固定到不可变来源。

## Execution Checklist

### 1. Prepare A Locked, Disposable Environment

- [ ] 从 T01 复制/引用 case ID 与 schema，不复制指标实现。
- [ ] 写 `research/inputs.lock.json`，锁定 Windows host、MSVC/SDK、CMake/Ninja、CTranslate2、JSON/tokenizer/FFT 依赖、model revisions/files/sizes/hashes/licenses。
- [ ] 创建 task-local `research/poc-src/` 的 CPU-only CMake preset，所有 build/model/raw outputs 写到 ignored `research/local/`。
- [ ] 核实许可证和 CTranslate2 public C++ headers；不能确认即停止。

Rollback point: 删除 task-local local build and source；无生产文件变更。

### 2. Prove Offline Model Contracts

- [ ] 对 large-v3 和 Kotoba snapshots 验证文件存在、size/hash、metadata 与 tokenizer assets。
- [ ] 记录 model contract evidence；Kotoba preprocessor removal 要失败，ordinary large-v3 缺失该文件仍按其自身规则通过。
- [ ] 写 tokenizer golden vectors；与 T01 Python oracle 比较完整小 token arrays 和 decode。
- [ ] 写 deterministic WAV/log-mel comparison；在实际推理前固定 numerical tolerance。

Rollback point: 不加载未校验模型，不添加下载功能。

### 3. Build Minimum Native CLI

- [ ] 实现 WAV format/path validation、native log-mel、tokenizer/prompt、CTranslate2 encode/generate 和 timestamp parser。
- [ ] `--self-check` 覆盖 malformed token input、segment legality 和 known token spans。
- [ ] CTests 覆盖无模型 parser/normalization checks；stdout only emits result JSON，stderr diagnostics stay bounded.
- [ ] 记录 all copied DLLs；不静态假定 DLL distribution 可行。

Rollback point: no protocol/worker/Rust code is created.

### 4. Run Large-v3 Feasibility Matrix

- [ ] 在 T01 short 与 >30s boundary case 上运行 CPU int8/beam 5/ja。
- [ ] 收集 cold load、inference、total、RTF、memory、raw token trace reference、final segments、exit/error。
- [ ] 用 T01 comparator 产生 quality/timeline comparison；不使用 final release threshold 判定。
- [ ] 验证 clean PATH / GPU-disabled launch，保留 runtime inventory。

### 5. Run Kotoba-Specific Matrix

- [ ] 仅使用 pinned Kotoba model + `preprocessor_config.json`、CPU int8、ja。
- [ ] 记录每个 15-second window、prompt hash、no previous text condition 和 boundary observations。
- [ ] 对短/boundary cases 使用同一 T01 comparator；发现缺段/重复只记录，禁止补丁。

### 6. Publish Gate 0 Evidence

- [ ] 写 `research/ctranslate2-poc-report.md`，逐项链接 evidence、license、limits 和 per-model decision。
- [ ] 结论仅为 `proceed`、`proceed-with-named-risks` 或 `stop/revise`。
- [ ] 若停止，记录 parent 架构需复核的点，而不是在 PoC 中偷偷扩大范围。

## Planned Files

```text
.trellis/tasks/07-25-native-asr-ctranslate2-poc/research/poc-src/*
.trellis/tasks/07-25-native-asr-ctranslate2-poc/research/inputs.lock.json
.trellis/tasks/07-25-native-asr-ctranslate2-poc/research/evidence/*
.trellis/tasks/07-25-native-asr-ctranslate2-poc/research/ctranslate2-poc-report.md
```

Do not modify:

```text
native-asr/
src-tauri/
src/
asr-service/engines/
asr-service/jobs.py
scripts/
package.json
release/portable resources
```

## Validation

Final preset names are fixed with the PoC source, but the required command shape is:

```powershell
cmake --preset windows-x64-cpu-poc
cmake --build --preset windows-x64-cpu-poc-release
ctest --preset windows-x64-cpu-poc-release --output-on-failure
```

Runtime inspection:

```powershell
dumpbin /headers <poc-exe> | findstr /i machine
dumpbin /dependents <poc-exe>
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
<poc-exe> --self-check --evidence <local-evidence-dir>
```

Model-backed matrix after T01:

```powershell
<poc-exe> --engine faster-whisper --model <locked-large-v3-dir> --audio <t01-case.wav> --evidence <local-evidence-dir>
<poc-exe> --engine kotoba-faster-whisper --model <locked-kotoba-dir> --audio <t01-case.wav> --evidence <local-evidence-dir>
<poc-exe> --validate-evidence <local-evidence-dir> --t01-contract <t01-contract-dir>
```

Python-oracle regression checks:

```powershell
Set-Location asr-service
python -m unittest tests.test_faster_whisper_model_cache tests.test_faster_whisper_vad tests.test_kotoba_faster_whisper
```

## Start And Completion Gates

Before start:

- [ ] T01 complete and its final reports added to both manifests.
- [ ] PRD/design/implement reviewed.
- [ ] `task.py validate` passes for both manifests.
- [ ] No unpinned source or unresolved license blocker.

Before completion:

- [ ] Parser/tokenizer/feature/timestamp checks and CTests pass, or explicit blocked result explains which cannot.
- [ ] Both models have model-backed outcome or reproducible resource/dependency blocker.
- [ ] No PoC code escaped into production inputs.
- [ ] Gate 0 report has per-model evidence and one overall decision.

## Stop Conditions

- T01 handoff is absent or incompatible.
- CTranslate2 public API/model format cannot provide the required timeline path.
- Token IDs, feature shape, or timestamp mapping cannot be reconciled without synthetic time allocation.
- Kotoba's 15-second/no-context/preprocessor behavior cannot be enforced.
- Native CPU dependencies or licenses make distribution implausible.
- Measured isolated footprint already makes the parent 250 MB runtime ceiling clearly unattainable.

Stop and return evidence to the parent; do not move product work into this task.

## Rollback

Delete task-local PoC/build/raw data. Retain inputs lock and report. Python baselines, product configuration, user files and model caches are untouched.
