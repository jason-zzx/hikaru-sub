# CrispASR PoC 技术设计

## Summary

T03 通过 task-local C++ harness 调用 pinned CrispASR public C ABI，验证 Parakeet/Reazon/Qwen3+Aligner lifecycle、callbacks、native timestamps 和 resources。算法先服从 official docs/stable ABI/model cards，再参考维护良好社区实践，最终直接由 T01 ground truth 测量选择。Python 只作为 optional diagnostics。

## Architecture

```text
T01 ground truth + shared metrics
  -> pinned CrispASR SDK/header + GGUF identities
  -> task-local C ABI harness
  -> session/callback/transcribe/result-copy/close
  -> native raw result -> T01 comparison
  -> per-route Gate 0 evidence
  -> optional Python diagnostic comparison
```

源码位于 `research/poc-src/`；SDK/models/build/raw results 位于 ignored `research/local/`。不创建 production worker/protocol。

## Authority Boundary

- WAV+ASS reference defines text/speech/timing truth.
- Pinned official ABI headers define lifecycle/ownership/API truth.
- Model cards and maintained community recommendations provide candidate algorithm/configs.
- Ground-truth measurements select candidates and expose gaps.
- Current Python chunking/backfill/synthetic timing/refresh are current-implementation risks and regression observations only.

Python output cannot repair reference or create a relative gate. T01 absolute budgets are user-reviewed and frozen: CER `<=0.35` per engine/case, CPU inference RTF `<=1.0`, accelerated GPU inference RTF `<=0.5`, short cold wall `<=120s`, and CrispASR RSS `<=12 GiB`; no VRAM gate. T03 reports measured/pass/fail/blocked against the updated manifest identity without claiming T08-T10 productization is complete.

## C ABI And CLI

Required API subset is proved from pinned headers: explicit session config/open, callback registration where available, transcribe/result getters, Qwen alignment and close. Minimal local cleanup guards ensure exact-once release; no wrapper hierarchy.

```text
--engine parakeet-ja|reazonspeech|qwen3-asr
--model <verified-gguf>
--aligner <verified-gguf>  # qwen required
--audio <authoritative-wav>
--output <ignored-result.json>
--self-check | --lifecycle-test
```

No URL/download/user config. stdout is bounded JSON, stderr bounded diagnostics, tracked summaries contain hashes/metrics only.

## Lifecycle Contract

1. Validate input lock/path/WAV/model role.
2. Create callback context and register supported callbacks.
3. Open session, transcribe/align, collect preview/final observations.
4. Copy final data before owner release.
5. Close result/session and invalidate context.
6. Write structured success/error with cleanup state.

No official cooperative cancellation means recorded absence, not unsafe custom interruption.

## Engine Contracts

### Parakeet

Use Q8_0 and score native timestamps/coverage against T01 speech regions. Current Python gap/backfill/final refresh is diagnostic only. No compensation in PoC.

### ReazonSpeech

Use Q8_0 and score short/medium/long native behavior. Current Python `>=60s` 45s chunk/2s overlap is a regression reference, not the CrispASR algorithm requirement. Observe callbacks, final getter and possible replacement semantics.

### Qwen3

Q4_K ASR + Q4_K Aligner is indivisible. Only copied aligner timestamps become final segments. Missing/failed/empty/malformed alignment returns controlled failure and zero accepted timeline. Current Python synthetic fallback is prohibited.

Parakeet, Qwen3 and ReazonSpeech may all final-refresh in current Python; protocol evidence records preview-to-final relationships generically rather than assuming Parakeet-only refresh.

## Evidence Contract

Evidence inherits T01 schema and adds SDK/header/model hashes, source citations, callback trace/thread/progress, cleanup states, timestamp provenance, Qwen negative-case code, runtime inventory and licenses. Raw result maps to T01 comparator; no duplicated CER/P95/gap/report logic.

## Failure Semantics

- identity/hash mismatch: reject before ABI;
- open/transcribe/getter/align error: stable code + cleanup;
- invalid/native or synthetic timestamp: reject result;
- missing Qwen aligner: `aligner_required`, zero accepted segments;
- unsafe ownership/late callback/close crash: route blocker;
- poor quality/resources: preserve measured result and report named risk without Python-parity patch.

## Rollback

Delete task-local source and ignored local SDK/model/build/results. Retain lock/ABI contract/report as Gate 0 evidence; product/user data remain untouched.
