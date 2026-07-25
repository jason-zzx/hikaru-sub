# CrispASR PoC 实施计划

> 状态：规划完成，等待 T01 与评审；不得在此前运行 `task.py start`。

## Hard Dependencies

- T01 已完成/评审并提供 short/medium/long corpus IDs、hashes、reference speech regions、Python baselines、comparison contract。
- CrispASR SDK/public headers、toolchain 和四个 GGUF 均能锁定和验证；不使用 mutable aliases。

## Execution Checklist

### 1. Lock Inputs And ABI Facts

- [ ] 写 `research/crispasr-input-lock.json`，锁定 SDK release/commit/header API、runtime archive hash、toolchain 和四个 GGUF provenance/hash/size/license。
- [ ] 从 pinned headers 编写 `research/abi-contract.md`，逐项证明 session/result/callback/align/close signatures 与 ownership。
- [ ] 创建 task-local CMake source/output structure；SDK/models/build/raw outputs 都写 ignored `research/local/`。
- [ ] 确认每个模型 route/role 与 parent table 一致；Qwen3 request 必须拥有两个文件。

Rollback point: no product code or user cache is modified.

### 2. Build Minimum Lifecycle Harness

- [ ] 实现 locked input and WAV validation、session open、available callback registration、transcribe/result copy/close 和 bounded JSON result。
- [ ] 只增加确保 exact-once cleanup 的局部 guard；不建立 reusable C++ wrapper framework。
- [ ] 写 CTests：invalid path/model, repeated open/transcribe/read/close, callback context lifetime, copied result after release, controlled errors。
- [ ] 记录 whether ABI has cooperative cancellation; no unsafe custom interrupt.

Rollback point: discard task-local source/build if ABI proves unsuitable.

### 3. Establish Callback And Ownership Evidence

- [ ] 在每个可加载 route 上执行 lifecycle matrix。
- [ ] 记录 callback counts/order/thread labels/progress monotonicity、getter/segment correspondence and cleanup state。
- [ ] 对 unknown ownership, late callback, close crash or persistent unsafe lifecycle mark route blocked and stop further claims.

### 4. Run Parakeet And Reazon Matrix

- [ ] 使用 T01 short/medium/long cases、Parakeet Q8_0 和 Reazon Q8_0。
- [ ] 收集 raw local outputs、legal final segments、timestamps、subtitle lengths、cold/load/inference/total, RTF and memory。
- [ ] 用 T01 comparator 列出 all confirmed `>=1500ms` speech gaps。
- [ ] 禁止 porting backfill, VAD fallback, Japanese segmentation, chunk correction or progress normalization.

### 5. Run Qwen3 Alignment Matrix

- [ ] 用 Qwen3 Q4_K + aligner Q4_K 执行 normal, leading-silence, boundary/long T01 cases。
- [ ] 保存 aligner-derived word/character timestamp evidence and T01 comparison output.
- [ ] 执行 missing/corrupt/unloadable aligner, empty alignment, malformed ranges and alignment error negative cases。
- [ ] 确认 negative cases fail with zero accepted final segments; no text-only fallback allowed.

### 6. Publish Gate 0 Decisions

- [ ] 生成 runtime/DLL/model size inventory and license/attribution table。
- [ ] 写 `research/crispasr-poc-report.md`，逐 route 结论为 `proceed`, `proceed-with-named-risks`, or `stop/revise`。
- [ ] 交接 T08 的 ABI/callback facts、T09 的 Parakeet/Reazon coverage evidence、T10 的 Qwen3 alignment evidence。
- [ ] 将 parent architecture or package issues return to parent; do not productize work here.

## Planned Files

```text
.trellis/tasks/07-25-native-asr-crispasr-poc/research/poc-src/*
.trellis/tasks/07-25-native-asr-crispasr-poc/research/crispasr-input-lock.json
.trellis/tasks/07-25-native-asr-crispasr-poc/research/abi-contract.md
.trellis/tasks/07-25-native-asr-crispasr-poc/research/evidence/*
.trellis/tasks/07-25-native-asr-crispasr-poc/research/crispasr-poc-report.md
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

After input lock/header review, the required command shape is:

```powershell
cmake -S .trellis/tasks/07-25-native-asr-crispasr-poc/research/poc-src -B .trellis/tasks/07-25-native-asr-crispasr-poc/research/local/build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCRISPASR_ROOT=<verified-sdk-root>
cmake --build .trellis/tasks/07-25-native-asr-crispasr-poc/research/local/build --config Release
ctest --test-dir .trellis/tasks/07-25-native-asr-crispasr-poc/research/local/build -C Release --output-on-failure
```

Model-backed runs repeat the same stable CLI for each T01 case:

```powershell
<crispasr-poc.exe> --engine parakeet-ja --model <parakeet-q8.gguf> --audio <t01.wav> --output <local-result.json>
<crispasr-poc.exe> --engine reazonspeech --model <reazon-q8.gguf> --audio <t01.wav> --output <local-result.json>
<crispasr-poc.exe> --engine qwen3-asr --model <qwen3-q4.gguf> --aligner <aligner-q4.gguf> --audio <t01.wav> --output <local-result.json>
```

Python-oracle regression checks:

```powershell
Set-Location asr-service
python -m unittest tests.test_parakeet tests.test_reazonspeech_nemo tests.test_qwen3_asr_engine
```

## Start And Completion Gates

Before start:

- [ ] T01 final reports are added to both context manifests.
- [ ] PRD/design/implement reviewed and manifests validate.
- [ ] Every native/model input is lockable; no unresolved license or header-ownership ambiguity.

Before completion:

- [ ] CTests and lifecycle matrix pass, or a route-specific blocked result is fully evidenced.
- [ ] Three engine matrices include legal result or reproducible failure for all required cases.
- [ ] Qwen3 negative aligner cases have no accepted timed output.
- [ ] Report has independent decisions and next-owner handoffs.
- [ ] No disposable/large/private artifact escaped into tracked production files.

## Stop Conditions

- T01 handoff is missing/incomplete.
- SDK/public headers cannot establish ownership/callback behavior.
- Required route/model cannot load and transcribe on CPU.
- A lifecycle close crashes or callbacks can access released state.
- Qwen3 requires synthetic timing, or aligner errors cannot fail safely.
- Long-audio results show systemically non-viable coverage/runtime/resource behavior.
- Runtime/model license or attribution cannot be resolved.

Stop the affected route and report evidence to the parent. Do not make an ad hoc production fix.

## Rollback

Remove only task-local source/build/SDK/model/raw-output directories. Do not remove user models, modify settings, or alter production paths. Keep lock/report for parent Gate 0 review.
