# CTranslate2 PoC 技术设计

## Summary

T02 使用 task-local 单次运行 C++ CLI 验证 CTranslate2 Whisper 最小上层链路。算法从官方 CTranslate2/Whisper 文档、稳定 API、模型卡和维护良好社区实践选择候选，并直接对 T01 authoritative WAV+ASS ground truth 测量。Python 只提供可选 current-implementation diagnostics。

## Architecture

```text
T01 ground truth + shared metrics + locked authoritative inputs
  -> task-local CMake Release x64 CPU CLI
  -> WAV validation -> log-mel -> tokenizer/prompt
  -> CTranslate2 encode/generate
  -> token-derived timestamps -> legal segments
  -> T01 comparison + JSON evidence + report
  -> optional Python diagnostic comparison
```

源码位于 `research/poc-src/`；models/build/raw results 位于 ignored `research/local/`。不创建生产 `native-asr/` 或 protocol v1。

## Authority And Proof Layers

1. Validate T01 case/WAV/ASS identity and shared result schema.
2. Lock official API/model-card/toolchain/model/dependency inputs and licenses.
3. Validate tokenizer/mel/timestamp contracts using official assets and maintained golden vectors.
4. Run large-v3/Kotoba candidates and score against T01 reference.
5. Record Python output only as optional diagnostics; never use it to repair reference or decide a parity gate.

T01 absolute budgets are user-reviewed and frozen: CER `<=0.35` per engine/case, CPU inference RTF `<=1.0`, accelerated GPU inference RTF `<=0.5`, short cold wall `<=120s`, and CTranslate2 RSS `<=6 GiB`; no VRAM gate. The PoC reports measured/pass/fail/blocked against the updated manifest identity without treating Python diagnostics as gate evidence or claiming T06/T07 productization is complete.

## CLI Boundary

```text
--model <locked-model-dir>
--audio <authoritative-16k-mono-pcm-wav>
--engine faster-whisper|kotoba-faster-whisper
--evidence <ignored-dir>
--self-check | --validate-evidence
```

No URL/download/user-setting input. Paths are structured arguments, stdout is bounded JSON, stderr is bounded diagnostics, and tracked summaries contain no private transcript or absolute path.

## Model And Algorithm Contracts

- Model metadata/assets come from actual immutable snapshots.
- Kotoba-only `preprocessor_config.json` validation remains isolated from ordinary Whisper.
- Tokenizer/prompt/mel/window/decode configs cite official/model-card/community sources.
- Current Python 15s/no-context/beam/VAD details are diagnostic observations, not native obligations.
- T02 stays on large-v3 + Kotoba general CT2 feasibility. T06 later validates all product models, including large-v2 Japanese `>=600000ms` regression behavior.

## Evidence Envelope

Evidence inherits the T01 schema and adds input-lock/toolchain/model hashes, authority citations, runtime inventory, token/feature trace hashes, candidate config, legal segments, measurements and privacy classification.

Private case tracked output uses hashes/metrics only. Native raw result maps losslessly to T01 comparator input; T02 does not copy CER/P95/gap/report logic.

## Failure Semantics

- hash/model-role mismatch: reject before load;
- tokenizer/feature/timestamp authoritative-contract mismatch: `blocked` or controlled failure;
- CTranslate2 load/generate error: stable error result;
- empty/invalid/out-of-range/synthetic timeline: failure;
- poor measured quality/performance: preserve result and report named risk, without Python-parity patching.

## Compatibility And Rollback

PoC does not implement product commands, snapshots, cancel/recovery/path policies. Those contracts remain owned by later tasks. Delete `research/poc-src` and ignored local data to roll back; retain locks/reports as Gate 0 evidence.
