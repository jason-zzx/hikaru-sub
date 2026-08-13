# T09 Planning Decisions

## Frozen parent boundary

T09 owns one shared CrispASR backend core inside the existing isolated `hikaru-asr-worker` plus ignored-local development GPU evidence. T10 owns Parakeet/ReazonSpeech subtitle policy and qualification. T11 owns Qwen3-ASR/ForcedAligner grouping, legal timeline generation, and qualification. T14/T15 own formal runtime packs and production-grade device qualification. T16/T17/T18 own backend/runtime/UI cutover. Release/default remains Python legacy throughout T09.

## Pinned upstream identity

- CrispASR version: `v0.8.22`
- Commit: `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`
- Public session header SHA-256: `cdefd19f6f208ed3f77f31c1cc8df19224c1c81ed5e0e6064650a827000c68df`
- T03 CPU runtime DLL SHA-256: `aa5d08f8cfe459727764bbe724b0780a75bd4167043c9cf63fd0fb43c2a559de`
- Current corrected quality authority: parent `research/t03c-crispasr-long-v2-handoff.md`; archived T03 long-v1 rows remain historical only.

The official Windows archive omitted `include/crispasr_session.h`, so T09 dynamically resolves the exact pinned public export subset and privately declares the pinned open-params layout with size/alignment/offset assertions. Missing or drifted exports fail before `ready`.

## Approved decisions

### D1 — External development GPU attestation

The user approved publishing ignored-local T09 GPU results without adding a resolved-device ABI. The pinned public API exposes `crispasr_set_gpu_backend()` only as a preference and provides no resolved compute-device getter. Therefore T09 uses a fail-closed external envelope:

- one pinned GPU-enabled CrispASR source/DLL identity;
- fresh processes for CPU and GPU rows;
- CPU-forced open params versus forced CUDA preference + GPU open params;
- checkpointed loaded-module inventory after session open/transcription/Qwen alignment plus CUDA device/driver identity;
- paired `1 cold + 3 warm` measurements on short-v1 and the locked medium first-120-second sample;
- coordinated mutation rejection for CPU/GPU params, module roles/hashes/roots, device identity, binaries, models, inputs, samples, and result fields;
- speed evidence and module presence are both necessary; neither alone proves acceleration.

This is development evidence only. T14/T15 must add or pin a resolved-device ABI later if formal pack qualification cannot otherwise be made fail-closed.

### D2 — Strict Qwen policy seam

The user approved keeping Qwen grouping policy out of T09. T09 validates model+aligner roles, opens the Qwen session, copies ASR results, calls the required ForcedAligner, copies raw alignment entries, and proves ownership/cleanup. It never accepts session-native Qwen timing and never creates synthetic timing.

Until T11 provides pinned grouping/timeline policy, a real Qwen worker request emits zero accepted timed output and terminates after backend/alignment work with stable error `qwen_timeline_policy_not_implemented`. This error is after `ready`; missing model/aligner/ABI/device failures remain pre-`ready`.

### D3 — Family-scoped development device results

The user approved independent GPU decisions for the two actual CrispASR execution families:

- `parakeet-family`: representative route is ReazonSpeech using upstream backend string `parakeet`;
- `qwen3-family`: representative route is Qwen3-ASR plus required ForcedAligner using upstream backend string `qwen3`.

Each family independently runs CPU/GPU short-v1 and first-120-second matrices and must publish exactly one of `development-gpu-ready`, `development-gpu-no-speedup`, or `development-gpu-unavailable` before T09 can complete. A tracked stdlib orchestrator runs before the native runner with reviewed `prepare-runtime` and `prepare-worker` phases separated by identity-freeze gates; either phase can emit paired indexed family envelopes for a validated non-timeout shared configure/build failure. After successful preparation, complete family discovery/session-load/aligner-load/device failure may publish unavailable. Missing inputs, timeouts, or invalid/incomplete/drifted evidence publishes no result and blocks completion. T10 consumes only `parakeet-family`; T11 consumes only `qwen3-family`.

Qwen performance timing includes session transcription plus ForcedAligner execution. The post-backend policy error does not invalidate a structurally complete performance row; no grouped/accepted timeline or subtitle quality field participates in the speed decision.

## Non-negotiable lifecycle facts

- The pinned ABI has no cooperative cancel/abort function.
- Normal success, structured failure, invalid result, and early initialization paths release every successfully acquired resource exactly once and leave unacquired-resource release counts at zero. T09 registers exactly progress and segment callbacks—never token callbacks—and resets each successfully registered setter before callback context destruction; the DLL unloads last.
- In-flight cancellation remains T05 Rust process-tree termination. OS process reclamation is the guarantee; T09 must not claim `crispasr_session_close` or destructors executed after hard termination.
- Callback strings and result/aligner strings are borrowed; copy synchronously before callback return or result free.
- Progress callbacks may be silent. Segment/final/completed host behavior must not depend on them.

## Explicit route mapping

| Hikaru route | Upstream session backend | Roles |
|---|---|---|
| `parakeet` | `parakeet` | `model` |
| `reazonspeech-nemo` | `parakeet` | `model` |
| `qwen3-asr` | `qwen3` | `model` + `aligner` |

The validated protocol route is authoritative. Do not infer a backend from GGUF filenames. Require `crispasr_session_backend()` to equal the expected logical backend before `ready`.

## Minimal implementation direction

- Add one concrete `CrispAsrBackend` module; do not add a generic backend hierarchy or protocol revision.
- Keep the DLL handle, function table, opaque upstream types, open-params layout, device invariant, callbacks, and ownership guards private to the implementation; verify the exact permitted runtime DLL hash before loading and expose no partial public attestation object.
- Preserve nested word ownership under copied source segments; derive Qwen policy from the validated engine instead of duplicating a policy flag in results.
- `main.cpp` retains centralized protocol emission and dispatches `Backend::CrispAsr` to a narrow `run_crispasr` branch.
- Keep CTranslate2 behavior unchanged. The T09 worker build may continue to require the existing CT2 worker option rather than refactoring target topology.
- Build a tiny fake CrispASR ABI DLL for deterministic no-model lifecycle/mapping tests; use ignored-local real models only for host smoke and development-device evidence.
- Extract the existing nontrivial verified WAV parser into one neutral native module shared by CT2 and CrispASR, preserving CT2 error behavior with golden tests.
- Formal CPU/GPU rows use one byte-identical CUDA-enabled worker/runner/runtime; the T03 CPU DLL is historical ABI reference only.
- Freeze a sanitized raw acquisition index before aggregation so coordinated raw+publisher-hash rewrites fail.
- Do not add production routing, downloader, runtime probing, settings, frontend, installer, or portable-package changes.
