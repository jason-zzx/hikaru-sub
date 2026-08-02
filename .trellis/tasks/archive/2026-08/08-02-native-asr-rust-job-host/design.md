# Tauri Native ASR Job Host 设计

## Summary

T05 在 Rust 中增加一个 native worker host，但保留现有 `asr.rs` command 表面与 Python legacy。Host 通过构造参数/测试配置消费 T04 fake worker，用一个 active slot、一个 event reducer 和 first-terminal-wins 状态机完成无模型生命周期验证。

## Architecture

```text
Existing Tauri commands
  start_asr / get_asr_progress / cancel_asr
            |
            v
AsrState route + global active slot
       |                         |
       | legacy                  | native debug/test
       v                         v
Python sidecar             NativeAsrHost
                           spawn/write/read/reduce
                                  |
                                  v
                         T04 fake worker
```

真实 backend 路由由 T06/T08 后续接入同一个 host。

## Module Boundary

```text
src-tauri/src/asr.rs
  stable commands
  legacy sidecar/model proxy
  route selection + shared active gate

src-tauri/src/asr_worker.rs        # new
  NativeAsrHost
  NativeAsrJob state
  T04 event DTO/parser/reducer
  process monitor
  recovery + minimal ASS
  focused tests

src-tauri/src/process.rs
  hidden command helpers
  shared terminate_process_tree

src-tauri/src/asr_setup.rs
  reuse shared process helper

src-tauri/src/lib.rs
  module registration
  AsrState.shutdown() on exit
```

不要为单一 host 建 trait/factory。测试直接注入 executable、request builder 和受管临时根。

## State Model

```text
ResolvedNativeLaunch
  engine/backend
  model role/path entries
  resolved device
  audio/output/recovery paths

NativeAsrHost
  jobs: jobId -> NativeAsrJob
  activeJobId: optional jobId

NativeAsrJob
  snapshot
  pid
  recoveryPath
  outputAssPath
  cancelRequested
  terminalCommitted
  pendingWorkerTerminal
  stderrLogPath
```

Monitor thread/task 持有 `Child` 并负责 stdout、stderr join、wait/reap。共享 state 只记录 PID/状态；cancel/shutdown 通过 PID 调用 process-tree helper，避免多个锁竞争 `Child` ownership。

## Start Flow

```text
validate product args/paths
  -> resolve/inject ResolvedNativeLaunch (never raw auto/model ID)
  -> reserve shared active slot
  -> create pending snapshot and recovery path
  -> spawn worker with piped stdin/stdout/stderr
  -> write one T04 request line; close stdin
  -> store job/PID
  -> return job id quickly
  -> background monitor consumes events and exit
```

如果 spawn/write 失败，提交 failed、保存 recovery、reap 已创建进程并释放 slot。

## Event Reducer

- `ready`：pending -> running；重复/非首条 fail。
- `progress`：保持 T04 duration/processed bounds 和 monotonicity。
- `segment`：完整验证后 append，更新 count 并原子保存 recovery。
- `segmentsReplace`：先验证临时 vector，再一次替换；旧 snapshot 在失败时保持。
- `completed`：保存 pending success，不立即暴露 completed。
- `error`：保存 structured failure intent。
- EOF + process exit：按 T04 matrix 提交唯一终态。

All terminal sources call one compare-and-set under the job lock. `completed` remains only a pending candidate until EOF + exit 0; cancel/structured error/protocol failure/process failure each attempt the same commit once. The first successful commit wins. Later sources only clean up/reap and never change snapshot. There is no second priority table.

Worker code is retained internally; the stable frontend `error` string is formatted as `[code] message` without changing `AsrJobSnapshot`.

## Recovery

Recovery JSON serializes the same camelCase snapshot shape. `includeSegments` only affects command response, not durable recovery.

```text
valid append/replace -> atomic recovery write
terminal             -> atomic recovery write
completed+segments   -> minimal ASS write
```

复用项目现有 atomic text write 和最小 ASS helper/格式；若当前 helper 不可复用，只提取最小共享函数，不创建新的 ASS domain module。

## Cancellation And Shutdown

```text
cancel
  -> lock and commit cancel intent
  -> capture PID
  -> terminate_process_tree(PID)
  -> wait/reap <= 2s test budget
  -> terminal recovery
  -> release active slot
```

Fake worker child-hang scenario verifies `/T` semantics. App exit calls `AsrState.shutdown()`; shutdown is idempotent and covers both native worker and legacy sidecar.

## Legacy Routing

No new persisted setting. Minimal development shape:

- product/release default remains current legacy route;
- tests instantiate `NativeAsrHost` with fake path and injected `ResolvedNativeLaunch` using temporary absolute paths/fixed CPU;
- optional debug-only executable override may route selected jobs through native host;
- `#[cfg(not(debug_assertions))]` ignores/rejects the override.

The shared active slot reserves before legacy HTTP start. Start failure releases immediately; the first terminal poll, successful cancel, or terminal recovery releases; ordinary connection errors keep the slot until explicit cancel/shutdown. Tests cover every branch so legacy cannot leak or prematurely release the slot.

T06 injects locked task-local model paths for model tests. T11/T14/T15 later implement production model/device resolution and model/runtime commands.

## Async And Process I/O

Blocking stdout iteration, process wait, taskkill and recovery filesystem work must not block the async command worker. Reuse existing background thread/`spawn_blocking` patterns; command handlers return job IDs/snapshots promptly.

stderr is drained concurrently to avoid deadlock, truncated to a fixed byte limit and written only below `work_cache_dir`. UI receives stable error codes/messages, not raw logs.

## Security

- Canonicalize executable/audio/output/recovery paths at the host boundary.
- Worker receives structured JSON and argv; no shell-composed user input.
- Embed T04 `protocol-v1-limits.json` as the canonical limits source and test equality with the fake worker before applying bounds to JSON/string/segment retention.
- Never derive host write paths from worker events.
- Do not log request bodies or segment text.
- Release builds cannot honor arbitrary worker override paths.

## Compatibility

- No `AsrJobSnapshot` field changes.
- No command name or frontend wrapper changes.
- Existing model APIs remain legacy.
- Existing final React ASS generation remains authoritative.
- Native terminal snapshots remain queryable long enough for the current completion poll; durable recovery covers later loss.

## Rollback

Disable/remove native debug routing and host module; shared process helper can remain if it exactly preserves existing setup behavior. Legacy commands continue unchanged.
