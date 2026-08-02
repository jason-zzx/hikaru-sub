# T04 Planning Evidence

## Confirmed Repository Contracts

- `src/types/index.ts` defines the stable `AsrSegment` and `AsrJobSnapshot` frontend contract; T04 does not modify it.
- `asr-service/jobs.py` provides current diagnostic behavior for monotonic progress, append segments and complete-list refresh. These map to worker `progress`, `segment` and `segmentsReplace`, but Python remains implementation reference rather than protocol authority.
- `src-tauri/src/asr_setup.rs` already uses Windows `taskkill /T /F`; T04 therefore needs a child-process fake scenario so T05 can prove tree cleanup rather than only top-level PID termination.
- Current `src-tauri/src/asr.rs` reads sidecar stdout only for startup and proxies jobs over HTTP. T04 must not modify this path.
- Both archived native PoCs use C++17, nlohmann/json and self-check/CTest patterns without a heavyweight test framework.

## PoC Handoffs

### T02 CTranslate2

- Source-window and 30-second model timestamp-window bounds are distinct.
- Legal output cannot be repaired with synthetic timestamps; verified WAV-end bounding requires provenance in model-backed tasks.
- Backend viability does not imply product algorithm quality.

### T03 CrispASR

- Public callback/result/session ownership and exact-once cleanup were demonstrated.
- Progress callbacks may remain silent; host progress cannot assume backend callback frequency.
- Pinned v0.8.22 exposes no reliable cooperative cancellation API; process termination is the generic cancellation contract.
- Qwen requires explicit model+aligner roles and must fail before timed output when the aligner is absent/invalid.

## Planning Decisions

- One protocol library and one fake executable; no parallel fake protocol or backend factory.
- Every JSONL event includes `protocolVersion` for independent line validation.
- Successful ready carries verified `durationMs`; this permits legal segment-before-progress even when backend progress callbacks are silent, and all later duration values must match.
- Request/version/route/path/audio validation may return one structured error before ready; runtime errors remain after ready.
- Device is resolved by host and limited to `cpu|cuda|vulkan`; `auto` stays above the worker boundary.
- `modelPaths` uses explicit role/path entries so Qwen companion order is not implicit.
- Generic validation rejects invalid segments rather than silently normalizing model bugs.
- Unknown additive fields are tolerated in v1; unknown events/routes/devices are not.
- Scenario selection is CLI-only test configuration, never a production request field.
- `protocol-v1-limits.json` is the canonical C++/Rust limits source; handwritten mirrors are prohibited.
- nlohmann/json 3.11.3 is vendored with license/hash so ordinary builds are offline.

## Downstream Handoff

T05 consumes:

- exact request/event schema and numeric limits;
- fake scenario names and exit codes;
- deterministic fake executable discovery/build command;
- lifecycle and exit matrix.

T06/T08 consume the same protocol library and add backend code without changing protocol v1.
