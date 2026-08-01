# CrispASR PoC 实施计划

> 状态：`in_progress`；T01 ground-truth handoff、manifest 校验及 immutable ABI/model/license lockability 已确认。

## Hard Dependencies

- T01 提供 `benchmark-contract.md`、authoritative short/medium/long identities/hashes/reference speech/timing 和 shared comparator。
- Optional `python-reference-report.md` 仅在存在时加入 manifests，且不构成 quality/performance gate。
- CrispASR SDK/public headers/toolchain/four GGUFs/licenses 可 immutable lock。

## Execution Checklist

### 1. Lock Inputs And ABI Facts

- [x] 写 `crispasr-input-lock.json`，锁定 official release/commit/header/runtime archive/toolchain/model provenance/hashes/sizes/licenses。
- [x] 写 `abi-contract.md`，从 pinned headers 证明 signatures/ownership/threading/callback/error/close。
- [x] 创建 task-local CMake source；SDK/models/build/raw outputs 写 ignored local。

### 2. Build Lifecycle Harness

- [x] 实现 authoritative case/audio/lock/executable/DLL/model identity、public CPU open params、loaded-module attestation、WAV validation、callbacks、transcribe/result copy/close 和 bounded JSON。
- [x] CTests 覆盖 invalid model、identity mismatch、repeat lifecycle、callback failure cleanup、copy-before-release、Qwen grouping/real negatives、complete failed evidence 和 canonical containment。
- [x] adapter 在评分前强制 selected case/lock/executable/runtime/model identities；failed evidence 仅验证不评分；记录 cooperative cancellation absence。

### 3. Establish Callback/Refresh Evidence

- [x] 每 route 记录 callback count/order/thread/progress monotonicity、preview/final getter relationship、actual reset count 和 context inactive state。
- [x] success/error transcribe exit 均由 scope guard reset 三类 callback；created result/alignment/session exact-once free/close。
- [x] 未观察到 unknown ownership/late callback/close crash；progress callback 在 long runs 仍未触发并作为 named risk。

### 4. Run Ground-Truth Matrix

- [x] 单一 final executable/DLL/lock identity 下重跑 Parakeet/Reazon/Qwen short 1 cold+3 warm，以及三 route medium/long attempts。
- [x] Parakeet/Reazon 三 case 均有 T01 metrics；Qwen short measured，medium/long 因 upstream-grouped zero-duration source segments fail closed，complete failure evidence unscored。
- [x] Parakeet 使用 pinned official auto short/long session call，并单独复制/报告 native nested word timing；不创建产品 subtitle assembly。
- [x] Reazon 改用 pinned CLI/backend detection 对应的 public `parakeet` backend，消除 false harness blocker；使用 T01 comparator，禁止 Python repair/parity gate。

### 5. Run Qwen3 Positive/Negative Matrix

- [x] 保留 raw character ranges，按 pinned upstream CJK tokenization/source-segment grouping；不扩张 duration、不调用 Python/synthetic timing。
- [x] short/leading-silence/boundary 产生 legal aligner-derived timeline；short timing gate measured fail；medium/long attempted 后因 grouped zero-duration source segments fail closed。
- [x] real missing/corrupt/unloadable/empty-transcript/malformed-segment-map/invalid-audio paths 保留 sanitized identity/request/result traces，全部 zero accepted timed output。

### 6. Publish Gate 0 Decisions

- [x] 生成 runtime/DLL/model inventory、licenses 和 source citations。
- [x] 写 `crispasr-poc-report.md`：Parakeet/Qwen `stop-revise`，Reazon `proceed-with-named-risks`，并区分 measured fail、upstream blocker 与 unscored failed evidence。
- [x] 按冻结 T01 budgets 报告 measured/pass/fail/blocked；medium/long cold-wall 明确 N/A，不以 Python diagnostics 作为 gate evidence。
- [x] handoff T08 ABI/callback、T09 Parakeet/Reazon coverage、T10 Qwen aligner evidence。

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
python .trellis/tasks/07-25-native-asr-crispasr-poc/research/poc-src/run_evidence.py
python .trellis/tasks/07-25-native-asr-crispasr-poc/research/poc-src/publish_evidence.py
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
- [x] Docs/manifests validate；CrispASR v0.8.22 public ABI、Windows x64 CPU runtime 与四个指定 GGUF 的 immutable revision/license 可锁定。

Before completion:

- [x] CTests/lifecycle matrix pass or route-specific blocker evidenced.
- [x] Three route matrices include ground-truth metrics or reproducible native failure.
- [x] Qwen aligner negatives have zero accepted timed output.
- [x] No local/private/large artifact or product code escaped scope.
- [x] Report applies the frozen T01 gates without claiming T08-T10 productization is complete.

## Stop Conditions

- Ground-truth handoff incomplete.
- Official ABI cannot establish ownership/callback safety.
- Required model cannot run on CPU or Qwen requires synthetic timing.
- Long-audio quality/resources are non-viable against ground truth.
- Runtime/model license unresolved.

Stop affected route and report evidence; do not copy Python implementation to bypass the blocker.

## Rollback

Remove task-local source and ignored SDK/model/build/results; keep locks/report. Ground truth, optional Python references, product configuration and user caches remain untouched.
