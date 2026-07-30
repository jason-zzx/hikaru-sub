# CrispASR PoC 实施计划

> 状态：`planning`，等待 T01 ground-truth handoff 与评审；不得提前运行 `task.py start`。

## Hard Dependencies

- T01 提供 `benchmark-contract.md`、authoritative short/medium/long identities/hashes/reference speech/timing 和 shared comparator。
- Optional `python-reference-report.md` 仅在存在时加入 manifests，且不构成 quality/performance gate。
- CrispASR SDK/public headers/toolchain/four GGUFs/licenses 可 immutable lock。

## Execution Checklist

### 1. Lock Inputs And ABI Facts

- [ ] 写 `crispasr-input-lock.json`，锁定 official release/commit/header/runtime archive/toolchain/model provenance/hashes/sizes/licenses。
- [ ] 写 `abi-contract.md`，从 pinned headers 证明 signatures/ownership/threading/callback/error/close。
- [ ] 创建 task-local CMake source；SDK/models/build/raw outputs 写 ignored local。

### 2. Build Lifecycle Harness

- [ ] 实现 input/WAV validation、session open、available callbacks、transcribe/result copy/close 和 bounded JSON。
- [ ] CTests 覆盖 invalid path/model、repeat lifecycle、callback lifetime、copy-before-release、controlled failures。
- [ ] 记录 cooperative cancellation availability，不发明 unsafe interrupt。

### 3. Establish Callback/Refresh Evidence

- [ ] 每 route 记录 callback count/order/thread/progress monotonicity、preview/final getter/refresh relationship 和 cleanup。
- [ ] 不假定 refresh 仅属于 Parakeet；当前 Parakeet/Qwen3/Reazon behavior 都作为 diagnostics。
- [ ] unknown ownership/late callback/close crash 立即标 blocker。

### 4. Run Ground-Truth Matrix

- [ ] Parakeet/Reazon/Qwen3 在 T01 short/medium/long cases 运行。
- [ ] 收集 legal final segments、provenance、subtitle lengths、CER、confirmed gaps、load/inference/total、RTF、memory。
- [ ] 使用 T01 comparator；禁止 Python reference repair/relative gate。
- [ ] Reazon current 45s/2s-overlap 只作为 regression observation；native candidate 来源为 official/model-card/community guidance。

### 5. Run Qwen3 Negative Matrix

- [ ] normal/leading-silence/boundary/long 使用 Qwen3+Aligner。
- [ ] 保存 aligner-derived evidence 与 T01 time metrics。
- [ ] missing/corrupt/unloadable/empty/malformed/error aligner cases controlled fail，accepted timeline 为零。

### 6. Publish Gate 0 Decisions

- [ ] 生成 runtime/DLL/model inventory、licenses 和 source citations。
- [ ] 写 `crispasr-poc-report.md`，逐 route 给出 evidence/resources 与 `proceed`/`proceed-with-named-risks`/`stop-revise`。
- [ ] 按已冻结 T01 budgets 和更新后的 manifest identity 报告 measured/pass/fail/blocked；不以 Python diagnostics 作为 gate evidence。
- [ ] handoff T08 ABI/callback、T09 Parakeet/Reazon coverage、T10 Qwen aligner evidence。

## Planned Files

```text
.trellis/tasks/07-25-native-asr-crispasr-poc/research/poc-src/*
.trellis/tasks/07-25-native-asr-crispasr-poc/research/crispasr-input-lock.json
.trellis/tasks/07-25-native-asr-crispasr-poc/research/abi-contract.md
.trellis/tasks/07-25-native-asr-crispasr-poc/research/evidence/*
.trellis/tasks/07-25-native-asr-crispasr-poc/research/crispasr-poc-report.md
```

Do not modify product/sidecar/release files.

## Validation

```powershell
cmake -S .trellis/tasks/07-25-native-asr-crispasr-poc/research/poc-src -B .trellis/tasks/07-25-native-asr-crispasr-poc/research/local/build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCRISPASR_ROOT=<verified-sdk-root>
cmake --build .trellis/tasks/07-25-native-asr-crispasr-poc/research/local/build --config Release
ctest --test-dir .trellis/tasks/07-25-native-asr-crispasr-poc/research/local/build -C Release --output-on-failure
```

Current Python implementation tests may run as diagnostics only:

```powershell
Set-Location asr-service
python -m unittest tests.test_parakeet tests.test_reazonspeech_nemo tests.test_qwen3_asr_engine
```

## Start And Completion Gates

Before start:

- [x] `benchmark-contract.md` added to both manifests; planning evidence retained.
- [x] `python-reference-report.md` was deterministically generated from valid five-engine short runs and added to both manifests with a non-gating diagnostic reason; medium/long claims remain blocked.
- [ ] Docs/manifests validate; inputs/licenses/ownership are lockable.

Before completion:

- [ ] CTests/lifecycle matrix pass or route-specific blocker evidenced.
- [ ] Three route matrices include ground-truth metrics or reproducible native failure.
- [ ] Qwen aligner negatives have zero accepted timed output.
- [ ] No local/private/large artifact or product code escaped scope.
- [ ] Report applies the frozen T01 gates without claiming T08-T10 productization is complete.

## Stop Conditions

- Ground-truth handoff incomplete.
- Official ABI cannot establish ownership/callback safety.
- Required model cannot run on CPU or Qwen requires synthetic timing.
- Long-audio quality/resources are non-viable against ground truth.
- Runtime/model license unresolved.

Stop affected route and report evidence; do not copy Python implementation to bypass the blocker.

## Rollback

Remove task-local source and ignored SDK/model/build/results; keep locks/report. Ground truth, optional Python references, product configuration and user caches remain untouched.
