# Async Commands and Blocking Work

## Rule

Tauri commands that touch **disk recursion**, **CPU-heavy scans**, or **blocking subprocess waits that would stall the async worker** should be `async` and offload the heavy part with `tauri::async_runtime::spawn_blocking` (or `tokio::task::spawn_blocking` where already used).

Documented product rule (see `/AGENTS.md`): `measure_runtime_dependency_storage` and `cleanup_runtime_dependency` stay async + `spawn_blocking`. Do not run recursive `dir_size` / deletes directly on the async worker. Writable/elevation checks may still run on the async side before cleanup of managed `deps/`.

## Existing Examples

| Area | Pattern |
|------|---------|
| `dependencies.rs` | `probe_runtime_dependencies`, `measure_runtime_dependency_storage`, cleanup paths use `spawn_blocking` |
| `fonts.rs` | `discover_preview_fonts` scans fonts off the async worker |
| `ffmpeg.rs` | Heavy extract / probe work offloaded |
| `asr.rs` / `asr_setup.rs` | Sidecar / setup blocking sections offloaded |
| `download.rs`, `clip.rs`, `burn.rs` | Job internals / blocking sections use `spawn_blocking` |

## Probe vs Measure

- **Probe** (`probe_runtime_dependencies`): status, paths, versions — **no** recursive disk usage scan.
- **Measure** (`measure_runtime_dependency_storage`): explicit user action (“计算占用空间”); may recurse.

Do not fold `dir_size` back into probe for convenience.

## Anti-Patterns

- Changing font discovery or storage measure back to synchronous commands
- Recursive directory walks on the async runtime
- Assuming “async fn” alone makes blocking I/O safe without `spawn_blocking`
