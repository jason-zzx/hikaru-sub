# Tauri Directory Structure

## Source: `src-tauri/src/`

| Module | Role |
|--------|------|
| `lib.rs` | App bootstrap, portable bootstrap, `generate_handler!`, managed state, exit cleanup |
| `main.rs` | Binary entry |
| `app_paths.rs` | Portable detection (`.portable`), config/data/cache roots, `work_cache_dir` |
| `settings.rs` | Persist / load `AppSettings` |
| `dependencies.rs` | Runtime deps probe, prepare, measure storage, cleanup |
| `ffmpeg.rs` | Resolve ffmpeg/ffprobe, extract audio, video info, waveform |
| `fonts.rs` | Preview font discovery (name tables → families) |
| `project.rs` | `prepare_video_session`, cached audio delete, `path_exists` |
| `asr.rs` / `asr_worker.rs` / `asr_models.rs` | Native ASR job commands, worker host lifecycle, and model manager |
| `ass.rs` | Load/save ASS text on disk |
| `media_server.rs` | Local HTTP Range media server for editor playback |
| `transcode.rs` | Playback compatibility probe and proxy H.264 transcode jobs |
| `download.rs` + `hls_*` | m3u8 / media download (Rust concurrent + FFmpeg fallback) |
| `clip.rs` / `burn.rs` | Video clip and hard-sub burn jobs |
| `process.rs` | Process helpers |

## Other Roots

| Path | Role |
|------|------|
| `src-tauri/capabilities/default.json` | Tauri 2 permissions for the main window |
| `src-tauri/resources/` | Bundled Native ASR CPU runtime manifests/payloads, `native-asr-models.json`, `runtime-dependency-sources.json` |
| `src-tauri/Cargo.toml` | Rust crate; version synced via `pnpm version:set` from root `package.json` |

## Placement Rules

- One concern per module; register new commands in `lib.rs` next to related ones.
- Job state (`download`, `burn`, `clip`, `transcode`, ASR) is `app.manage(...)` and initialized in `.setup`.

## Anti-Patterns

- Business path resolution via `app.path().app_config_dir()` / `app_cache_dir()` instead of `app_paths`
- Adding commands without `generate_handler!` registration
- Putting inference / Whisper calls inside Rust instead of the independent Native ASR worker
