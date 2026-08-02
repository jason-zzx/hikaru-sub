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

## Final T04 Handoff Locked

T04 implementation commit: `96077103e0c3070894b70ffa9fcd888bcc93075d`; archive commit: `a9ce6e6ac798d29870238af40c7ffb27c6bb4dbb`.

Tracked contract identities:

| File | SHA-256 |
|---|---|
| `native-asr/docs/protocol-v1.md` | `f7faed6012288879e6ee85ee5c2007fa3ee56ff0a199e72162136cea33f601f7` |
| `native-asr/protocol-v1-limits.json` | `435c4eb649dc7e8939c38fc0eb778d2428bf2646a028abfe636c62f43302b464` |
| `native-asr/CMakePresets.json` | `2d3da9c3f16a5e3a099ea632d4292773a95b3df1d1a2808877bbe6e307db0d54` |
| `native-asr/third_party/nlohmann/provenance.json` | `f04ce243791555affe46a8637f60264805964e0121a651468138a220bf5ba623` |

Build/discovery contract:

```text
preset: windows-x64-release
fake executable: native-asr/build/windows-x64-protocol/bin/hikaru-asr-fake-worker.exe
test-only Rust env: HIKARU_ASR_FAKE_WORKER=<resolved executable path>
```

Canonical limits are read from JSON: request `262144`, event `8388608`, job ID `128`, path `32767`, text `16384`, model entries `8`, replacement segments `32768`, stderr diagnostic `65536` bytes/count as named by the schema.

Final terminating scenarios: `success`, `segments-replace`, `structured-error`, `malformed-json`, `unknown-event`, `version-mismatch`, `invalid-transition`, `invalid-segment`, `duration-drift`, `oversized-line`, `crash-before-ready`, `crash-after-progress`, `zero-exit-without-terminal`, `completed-then-nonzero`, `stderr-diagnostics`. Host-terminated scenarios: `hang-after-ready`, `child-process-hang`.

The finalized protocol includes pre-ready structured errors, ready-owned positive duration, legal segment-before-progress, exact duration equality, terminal/EOF classification and stable fake-worker discovery. T05 manifests already reference the final tracked protocol and limits directly; no active T04 task path remains.

## Downstream Handoff

- T06/T08 receive a stable internal native host entry point and protocol reducer.
- T11/T15 later replace legacy model/runtime commands and route selection.
- T16 changes user-visible setup/device/model behavior only after those backend contracts are stable.
