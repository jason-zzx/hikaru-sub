# Tauri Command Guidelines

## Wiring Chain (Mandatory)

Every new or changed product command must complete this chain:

1. **Implement** in the appropriate `src-tauri/src/*.rs` module
2. **Register** in `lib.rs` `tauri::generate_handler![...]`
3. **Wrap** in `src/services/tauri.ts` with types in `src/types/`
4. **Capabilities**: update `src-tauri/capabilities/` if the command needs new FS, shell, dialog, or opener permissions

Skipping the frontend wrapper leaves a dead backend surface. Skipping capabilities produces runtime permission errors.

## Command Style

- Prefer `Result<T, String>` (or project-equivalent) error surfaces that serialize cleanly to the UI.
- Keep argument structs aligned with frontend camelCase JSON where serde attributes already establish that contract.
- Long jobs return a `jobId` quickly; progress via `get_*_progress` poll commands (ASR, download, burn, clip, setup, runtime prepare).

Registered command families today (see `lib.rs`): settings, runtime dependencies, ffmpeg, fonts, project session, ASR + ASR setup, ASS text I/O, media playback, transcode, download, burn, clip/frame extract, GitHub latest-release probe (`fetch_latest_github_release`).

## State and Lifecycle

- `AsrState`, `AsrSetupState`, `RuntimeDependencyState`, plus download/burn/clip/transcode state are managed on the app handle.
- On `ExitRequested`, kill ASR sidecar and shut down burn/clip (and related) workers — do not leave orphan processes.

## Anti-Patterns

- Frontend-only or Rust-only half of a command
- Expanding shell/FS permissions “just in case” without a concrete need
- Blocking the async runtime with recursive disk walks inside the async command body (see [Async and Blocking](./async-and-blocking.md))
- Logging API keys, full auth headers, or translation request bodies
