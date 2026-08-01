# T05 Planning Evidence

## Current Rust/Product Facts

- `src-tauri/src/asr.rs` currently owns Python sidecar lifecycle, HTTP job proxy, model HTTP proxy and recovery reads.
- `src-tauri/src/lib.rs` currently reaches into `AsrState.sidecar` on exit; native work needs a public/idempotent shutdown boundary.
- `src-tauri/src/asr_setup.rs` has a private Windows `taskkill /T /F` helper. The root-cause minimal change is one shared process-tree helper in `process.rs`, not a second implementation.
- Existing Rust dependencies already provide serde/serde_json and async/process primitives; no new JSON/UUID/job framework is required.
- `src/types/index.ts` and `src/services/tauri.ts` freeze command names, arguments and `AsrJobSnapshot` fields. `TranscribeView` relies on `includeSegments=false` and the missing-job message.
- `asr-service/jobs.py` is a current compatibility reference for progress monotonicity, append/refresh and terminal persistence, not the new host implementation authority.

## Boundary Decisions

- T05 migrates only job hosting. Model list/status/download remain legacy until T11/T15.
- Production default remains legacy; tests/debug inject the fake worker without a new persisted setting.
- One active gate sits above native/legacy routing to prevent simultaneous high-memory jobs; legacy start/poll/cancel/recovery/connection-error release rules are explicit.
- The monitor owns `Child`; shared state records PID and terminal flags so cancel does not fight for child ownership.
- All terminal sources use one compare-and-set; `completed` participates only after valid EOF and exit 0.
- Internal `ResolvedNativeLaunch` bridges raw product IDs/auto to protocol role paths/resolved device without making T05 own the final resolver.
- T04 `protocol-v1-limits.json` is embedded directly; no handwritten Rust limits.
- Cancel commits first, then kills the process tree; late worker output cannot win.
- Recovery writes use host-approved paths only and preserve partial segments on every failure class.
- No new frontend test/file is mandatory when wrappers/types remain unchanged; `pnpm build` plus Rust serialization/command tests are the minimal compatibility check.

## T04 Handoff Required Before Start

- Exact request/event DTO shape and JSON key casing.
- Numeric line/text/path/segment limits.
- Fake scenario names, arguments and expected exit codes.
- Reproducible fake executable path/build command.
- Lifecycle/exit matrix.

The manifests must be refreshed to T04's archived final paths before `task.py start`.

## Downstream Handoff

- T06/T08 receive a stable internal native host entry point and protocol reducer.
- T11/T15 later replace legacy model/runtime commands and route selection.
- T16 changes user-visible setup/device/model behavior only after those backend contracts are stable.
