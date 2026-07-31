# CTranslate2 PoC 实施计划

> 状态：`in_progress`；实现、六格模型实测、独立 review 与 spec update 已完成。CTranslate2 runtime 可行，但当前最小 long-form 算法未通过全部 ground-truth gates。

## Hard Dependencies

- T01 提供 `benchmark-contract.md`、authoritative short/medium/long case identities/hashes/reference annotations 和比较命令。
- Optional `python-reference-report.md` 只在存在时加入 manifests，且不构成 quality/performance gate。
- Toolchain/CTranslate2/dependencies/models/licenses 可锁定到 immutable sources。

## Execution Checklist

### 1. Lock Disposable Environment

- [x] 引用 T01 case identity/schema，不复制 metrics。
- [x] 写 `research/inputs.lock.json`，锁定 official API/model-card references、Windows toolchain、CTranslate2、JSON/tokenizer/FFT dependencies 与 model revisions/files/hashes/licenses。
- [x] 建 task-local CPU CMake preset；build/model/raw outputs 写 ignored `research/local/`。

### 2. Prove Authoritative Model/Algorithm Contracts

- [x] 验证 large-v3/Kotoba snapshot metadata/assets 与 Kotoba-only preprocessor rule。
- [x] tokenizer/prompt golden vectors 依据 pinned assets、official contract 和 maintained community vectors；Python output 仅附作 diagnostics。
- [x] deterministic WAV/log-mel contract 与 numerical tolerance 在 model run 前固定。
- [x] timestamp vectors 覆盖 valid/malformed/no-timestamp，禁止 synthetic timing。

### 3. Build Minimum Native CLI

- [x] 实现 WAV validation、log-mel、tokenizer/prompt、CTranslate2 encode/generate 与 timestamp parser。
- [x] CTests/self-check 覆盖 format/parser/feature/timeline legality；stdout JSON/stderr diagnostics bounded。
- [x] 记录 exe/DLL inventory/hash/size/clean-PATH launch。

### 4. Run Ground-Truth Matrix

- [x] large-v3 与 Kotoba 已在 T01 short/medium/long 六格运行，记录 config authority、load/inference/total、RTF、memory、trace hashes 和 final segments；short 为 1 cold + 3 warm，其余各 1 次。
- [x] 使用 T01 comparator 计算绝对 CER/gaps/timeline/timing；large-v3 short CER 失败，两条 route 的 medium/long confirmed-gap 失败，未使用 Python result 生成 reference 或 relative gate。
- [x] Kotoba 记录 window/context/prompt/preprocessor 及来源；short 全通过，medium/long 边界与覆盖问题按实报告。
- [x] 按已冻结 T01 budgets 和更新后的 manifest identity 报告 measured/pass/fail；不以 Python diagnostics 作为 gate evidence。

### 5. Publish Gate 0 Evidence

- [x] 写 `research/ctranslate2-poc-report.md`，逐 route 给出 evidence/license/resources 和 `proceed`/`proceed-with-named-risks`/`stop-revise`。
- [x] 明确 T02 只证明 large-v3+Kotoba 通用 CT2；T06 负责包括 large-v2 long-audio 在内的产品模型验证。

## Planned Files

```text
.trellis/tasks/07-25-native-asr-ctranslate2-poc/research/poc-src/*
.trellis/tasks/07-25-native-asr-ctranslate2-poc/research/inputs.lock.json
.trellis/tasks/07-25-native-asr-ctranslate2-poc/research/evidence/*
.trellis/tasks/07-25-native-asr-ctranslate2-poc/research/ctranslate2-poc-report.md
```

Do not modify product/sidecar/release files.

## Validation

```powershell
cmake --preset windows-x64-cpu-poc
cmake --build --preset windows-x64-cpu-poc-release
ctest --preset windows-x64-cpu-poc-release --output-on-failure
<poc-exe> --self-check --evidence <ignored-evidence-dir>
<poc-exe> --validate-evidence <ignored-evidence-dir> --t01-contract <t01-contract-dir>
```

Current Python implementation tests may run as diagnostics only:

```powershell
Set-Location asr-service
python -m unittest tests.test_faster_whisper_model_cache tests.test_faster_whisper_vad tests.test_kotoba_faster_whisper
```

## Start And Completion Gates

Before start:

- [x] `benchmark-contract.md` added to both manifests; planning evidence retained.
- [x] `python-reference-report.md` was deterministically generated from valid five-engine short runs and added to both manifests with a non-gating diagnostic reason; medium/long claims remain blocked.
- [x] Inputs/licenses lockable and task docs/manifests validate。

Before completion:

- [x] Goldens/CTests pass or explicit authoritative-contract blocker is evidenced.
- [x] Both routes have complete short/medium/long ground-truth measurements；runtime feasibility proven，current algorithm failures recorded as absolute CER/confirmed-gap failures。
- [x] No private/large/local artifact or product code escaped task scope.
- [x] Report applies the frozen T01 gates without claiming T06/T07 productization is complete.

## Stop Conditions

- Ground-truth handoff absent/incompatible.
- Official/stable API/model contract cannot support legal token-derived timelines.
- Immutable inputs/licenses unavailable.
- Native CPU footprint clearly exceeds parent ceiling.

Return evidence to the parent; do not copy Python implementation details to bypass a blocker.

## Rollback

Delete task-local source/build/raw data; retain locks/report. Ground truth, optional Python references, product configuration and user caches remain untouched.
