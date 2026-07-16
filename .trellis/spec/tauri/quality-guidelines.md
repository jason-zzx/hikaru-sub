# Tauri Quality Guidelines

## Verification

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Use filtered tests while iterating; run broader suites after path, dependency, FFmpeg, ASR process, download/clip/burn, or media-server changes.

If the machine lacks FFmpeg, Python 3.11, GPU, models, or network, say so in the hand-off — do not claim those paths were verified.

## Safety and Logging

- Treat paths, URLs, playlists, headers, and filenames as untrusted; normalize and bound writes (temp dirs, burn outputs, downloads, asset scope).
- Prefer structured argv for FFmpeg/Python/pip — do not shell-concatenate user strings.
- Diagnostic logs: stages, error codes, timings, necessary paths — **not** secrets, full auth headers, or translation bodies.

## Consistency Checks

- [ ] Command registered in `lib.rs`
- [ ] Frontend wrapper + types added when the command is product-facing
- [ ] Capabilities updated if permissions changed
- [ ] Heavy disk/CPU work uses `spawn_blocking`
- [ ] Paths go through `app_paths` / `work_cache_dir`
- [ ] Probe still does not recurse for sizes

## Anti-Patterns

- Secrets in tests, fixtures, or log snapshots
- Silent portable bootstrap failure
- “Fixing” portable scope by mutating user profile env vars
