# Media, FFmpeg, and ASR Sidecar

## FFmpeg Resolve Order

`ffmpeg::resolve_ffmpeg` / `resolve_ffprobe`:

1. User settings path  
2. System `PATH`  
3. Managed install under `deps/ffmpeg/current`

Frontend caches status via `checkFfmpeg` / invalidation events; backend remains source of truth for resolution.

## Media Playback

- Editor playback: `register_media_playback` → local HTTP server (`media_server.rs`) with Range/seek support.
- Unsupported codecs (HEVC/VP9/AV1, etc.): FFmpeg proxy to 480p H.264 under work cache `transcode/*.mp4`.
- Do not restore Tauri `asset://` as the primary editor video path.

## Download / Clip / Burn

| Feature | Module | Notes |
|---------|--------|-------|
| m3u8 / video download | `download.rs` + `hls_*` | Default strategy `auto`: Rust concurrent segments, FFmpeg fallback. Frontend does not expose concurrency/strategy (debug-only arg may exist). |
| Clip | `clip.rs` | Soft/hard cut; progress polling; optional replace working video is a **frontend** session decision |
| Burn | `burn.rs` | Hard-sub export via FFmpeg/libass; burn page has no subtitle preview |

## ASR Sidecar Process

- Tauri starts/manages the Python FastAPI sidecar (`asr.rs`), proxies job start/progress/cancel and model download.
- ASR setup (venv/deps) is separate (`asr_setup.rs`).
- On app exit, kill the sidecar process.
- Diagnostics: host may set `HIKARU_ASR_DEBUG_LOG` → sidecar writes JSONL (often under managed `deps/asr-service/asr-debug.log`). Prefer `model_download_*` events when model download fails.
- Inference stays in Python; Rust must not reimplement engines.

## ASS Files on Disk

`ass.rs` loads/saves text. Semantic parse/serialize is frontend `src/lib/ass/`. Transcription may write ASS via the sidecar `ass_writer` when `outputAssPath` is set; editor still owns bilingual merge modes on save.

## Anti-Patterns

- Bundling FFmpeg/Python/models into the release payload again
- ASR inference inside Rust
- Exposing download concurrency knobs in the UI
- Burn-page libass preview feature creep (preview belongs to editor)
