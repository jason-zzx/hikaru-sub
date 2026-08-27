# Paths and Runtime Dependencies

## Path Ownership: `app_paths.rs`

| Mode | Marker | Config/data | Work cache | WebView2 |
|------|--------|-------------|------------|----------|
| Portable | `<exe>/.portable` file | `<exe>/data` | `<exe>/cache` | `<exe>/webview` (`WEBVIEW2_USER_DATA_FOLDER`) |
| Installed / `tauri dev` | no marker | system AppData via Tauri path APIs | `app_cache_dir()/cache` | default |

Rules encoded in code:

- Call `bootstrap_portable_paths()` before WebView creation (`lib.rs`). Failure → fatal dialog + exit; **do not** lock `is_portable()` true on failed bootstrap.
- Business code uses `app_config_dir` / `app_data_dir` / `work_cache_dir` from `app_paths`, not raw `app.path().app_*` for those roots.
- No migration from old AppData layouts.
- Do not rewrite `APPDATA` / `LOCALAPPDATA` to work around `tauri-plugin-persisted-scope` (tiny scope files in system AppData on portable are accepted).

Work cache children of interest: `workspace/`, `transcode/`, `preview/`, `clip-frames/` (and similar). App-cache measure/cleanup targets these under `work_cache_dir`, preserving caches tied to the current working video. Legacy same-named dirs directly under `com.hikaru.sub\` root are **out of scope**.

## Managed Dependencies Layout

Release packages do **not** bundle FFmpeg, Python, ASR pip deps, or model weights — only a clean ASR service template.

Typical install-dir layout (see `/AGENTS.md`):

- `deps/ffmpeg/current` — managed FFmpeg
- `deps/python311/current` — managed Python 3.11
- `deps/asr-service/.venv` — managed ASR venv
- `deps/models/huggingface` — legacy Python/Hugging Face cache (`HF_HOME`); Native ASR may reuse only an exact pinned CT2 snapshot after full validation
- `deps/models/ctranslate2/<engine>/<model>/<revision>` — immutable direct Native ASR CT2 installs
- `deps/downloads/native-asr-models/<engine>/<model>/<revision>` — Native ASR `.part`, staging, and repair data
- `deps/downloads` — other temporary archives

Native model manifest segments must reject traversal, Windows reserved device names, trailing-dot/space aliases, and ASCII case collisions before joining paths. Direct required files reject symlinks/reparse points; legacy HF symlinks are allowed only when the snapshot and canonical file target stay below the canonical managed Hugging Face root.

Download sources: `src-tauri/resources/runtime-dependency-sources.json`. UI chooses official vs China mirror (default official). Legacy `auto`/`custom` migrate silently to official. China mirror injects `HF_ENDPOINT=https://hf-mirror.com` for the sidecar.

## Probe / Prepare / Cleanup UX Contract

Settings entry: **probe only**. Storage sizes: user-triggered measure. Cleanup buttons: only when measured size > 0 and the target is managed.

## Anti-Patterns

- Reintroducing `%APPDATA%` / `%LOCALAPPDATA%\com.hikaru.sub` as large managed dependency roots
- Treating a model-name-only directory, framework cache, wrong revision, or escaped HF symlink as a ready Native model
- Streaming model bytes directly into the final immutable revision directory instead of verified download staging
- Using `app.path().app_cache_dir()` directly as the workspace root (missing the `cache/` child on installed builds)
- Recursive size in probe
- Portable bootstrap that sets `is_portable` before directories succeed
