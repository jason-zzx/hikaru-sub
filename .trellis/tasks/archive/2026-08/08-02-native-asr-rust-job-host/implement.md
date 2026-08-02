# Tauri Native ASR Job Host 实施计划

> 状态：`planning`。T04 已完成、提交并归档；final protocol/limits/fake-worker handoff 已锁定。完成本次规划刷新并由用户确认后可启动 T05。

## Dependencies

- T04 code commit `96077103e0c3070894b70ffa9fcd888bcc93075d` and archive commit `a9ce6e6ac798d29870238af40c7ffb27c6bb4dbb`.
- Final `native-asr/docs/protocol-v1.md`, `native-asr/protocol-v1-limits.json`, `windows-x64-release` preset and fake executable discovery at `native-asr/build/windows-x64-protocol/bin/hikaru-asr-fake-worker.exe`.
- Parent stable command/snapshot/cancel/recovery/path contracts.
- Current `asr.rs`, `asr_setup.rs`, `process.rs`, `lib.rs`, TypeScript wrappers/types and workspace path helpers.

Context manifests already consume the final tracked protocol document and canonical limits directly; no stale active-task T04 path remains.

## Execution Checklist

### 1. Lock T04 Handoff

- [ ] Record exact protocol structs/pre-ready errors/ready duration/scenarios and fake-worker build/path contract.
- [ ] Embed canonical T04 `protocol-v1-limits.json`; add Rust/C++ equality and camelCase event/request compatibility tests.
- [ ] Do not redefine or loosen protocol bounds.

### 2. Extract Shared Process-Tree Termination

- [ ] Move the existing Windows `/PID /T /F` behavior from `asr_setup.rs` into `process.rs` without changing setup behavior.
- [ ] Add an idempotent helper usable by cancel and app shutdown.
- [ ] Verify fake child process is also terminated; do not rely only on `Child::kill()`.

### 3. Implement Native Host Core

- [ ] Add `asr_worker.rs` with active slot, job store, injected executable/config, internal `ResolvedNativeLaunch` and background monitor.
- [ ] Test harness resolves `HIKARU_ASR_FAKE_WORKER` only for tests/debug injection; release product routing cannot honor this arbitrary path.
- [ ] Build protocol requests only from resolved role/path/device/audio/output inputs; tests inject temp absolute paths/fixed CPU, while production resolver stays out of scope.
- [ ] Spawn with structured args and piped stdio, send one request line, close stdin and return job id promptly.
- [ ] Drain bounded stderr concurrently and wait/reap exact once.
- [ ] Use no new crate unless an existing dependency cannot satisfy a reviewed requirement.

### 4. Implement Reducer And Terminal Arbitration

- [ ] ready/progress/segment/replace/completed/error handling per T04.
- [ ] Validate complete replacements before mutation; preserve old segments on failure.
- [ ] Hold completed until exit 0 and EOF; classify pre-ready/runtime structured, incomplete/abnormal/late-event cases.
- [ ] Implement one terminal compare-and-set across cancel/error/protocol/exit/completion races; remove any separate priority rule.
- [ ] Retain machine code internally and format existing snapshot error as `[code] message`.
- [ ] Keep includeSegments response behavior and missing-job error compatibility.

### 5. Implement Recovery And Minimal ASS

- [ ] Resolve/canonicalize workspace recovery and output ASS paths before worker launch.
- [ ] Reuse atomic write helper for partial and terminal snapshot persistence.
- [ ] Preserve partial segments for failed/cancelled/crashed jobs.
- [ ] Write minimal ASS only for completed non-empty output; leave formal ASS to React.

### 6. Integrate AsrState Without Product Cutover

- [ ] Add native host and one global active gate above legacy/native route selection.
- [ ] Implement legacy slot release on HTTP start failure, terminal poll, successful cancel and terminal recovery; keep occupied on ordinary connection errors until cancel/shutdown.
- [ ] Keep production/default and model commands on legacy.
- [ ] Enable fake/native only through test construction or reviewed debug-only override unavailable in release.
- [ ] Preserve current command signatures and frontend wrappers/types.

### 7. Unify Exit Cleanup

- [ ] Add idempotent `AsrState.shutdown()` covering native and legacy processes.
- [ ] Change `lib.rs` exit handling to call the method instead of touching internal sidecar fields.
- [ ] Verify shutdown/cancel races cannot release or finalize twice.

### 8. Test Full Fake Matrix

- [ ] Reducer unit tests for ordering, monotonicity, bounds, append/replace atomicity and terminal races.
- [ ] Fake integration tests for success/error/malformed/version/unknown/oversize/incomplete/crash/completed-nonzero/stderr/hang/child-process.
- [ ] Single-active native/native and native/legacy tests, including every legacy reserve/release/retain branch.
- [ ] Recovery JSON and minimal ASS good/base/bad cases.
- [ ] Cancel and shutdown process-tree exit within 2 seconds.

## Planned Files

```text
src-tauri/src/asr_worker.rs                 # new
src-tauri/src/asr.rs
src-tauri/src/asr_setup.rs
src-tauri/src/process.rs
src-tauri/src/lib.rs
```

Avoid changing `src/types/index.ts`, `src/services/tauri.ts`, `TranscribeView.tsx`, `asr-service/` or capabilities unless validation proves a direct compatibility defect; return to planning before expanding scope.

## Validation

```powershell
Push-Location native-asr
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release
Pop-Location

$env:HIKARU_ASR_FAKE_WORKER = (Resolve-Path "native-asr/build/windows-x64-protocol/bin/hikaru-asr-fake-worker.exe").Path
cargo test --manifest-path src-tauri/Cargo.toml asr_worker
cargo test --manifest-path src-tauri/Cargo.toml
Remove-Item Env:HIKARU_ASR_FAKE_WORKER

pnpm build
python ./.trellis/scripts/task.py validate .trellis/tasks/08-02-native-asr-rust-job-host
git diff --check
```

Process cleanup validation must explicitly confirm no fake parent/child PID remains after cancel and shutdown.

## Review Gates

Before start:

- [x] T04 completed/archived and manifests consume the final protocol document/limits.
- [ ] User reviews this final handoff refresh; native route remains development-only.
- [x] Current command/snapshot/path contracts reconfirmed against code and planning evidence.

Before completion:

- [ ] Full fake matrix and full Rust tests pass without Python/models/network/GPU.
- [ ] Independent check reviews terminal races, canonical writes, stderr bounds and process-tree cleanup.
- [ ] `pnpm build` proves frontend contract compatibility.
- [ ] Production default/model commands still use legacy.

## Stop Conditions

- T04 protocol/limits remain unstable or fake executable cannot be consumed reproducibly.
- Native and legacy cannot share one active gate without breaking current command contract.
- Process-tree or recovery containment cannot be proven on Windows.
- A proposed fix requires real backend/model/settings/UI work; return it to T06/T08/T11/T15/T16.

## Rollback

Disable debug/test native route and remove native host wiring; keep legacy state and commands intact. Do not delete user recovery/model/cache data.
