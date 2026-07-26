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

## Audio Decode Timeline Contract (waveform / ASR)

### Scope / Trigger

HLS-merged media (m3u8 downloads) can carry AAC streams whose timestamp span exceeds the decoded frame total — silent inter-segment gaps. Verified on real material: 4144.256s nominal vs 4108.224s decoded, **zero decode warnings**. Plain sequential decode squeezes the gaps out, so anything mapped onto the playback timeline (waveform buckets, ASR timestamps) drifts late linearly (~36s at the tail of a 69-min file).

### Signatures

```rust
#[tauri::command]
async fn extract_waveform(video_path: String, samples: usize) -> Result<WaveformData, String>

#[serde(rename_all = "camelCase")]
struct WaveformData { peaks: Vec<f32>, covered_ms: u64 } // peaks 0..1, quantized to 0.001
```

`covered_ms` = decoded PCM sample count / 16 (16 kHz mono).

### Contracts

- Every ffmpeg audio decode whose output maps onto the playback timeline (waveform, ASR `audio.wav`) **must** include `-af aresample=async=1:first_pts=0` — const `ARESAMPLE_SYNC_FILTER`, referenced by `waveform_decode_args` / `audio_decode_args` in `ffmpeg.rs`. The filter inserts silence at timestamp gaps and anchors the first sample to t=0.
- Frontend draws the waveform with `peaks.length / coveredMs`, **never** `<video>.duration` (container duration is not the decoded coverage).
- Bucketing uses even boundaries `[i*len/samples, (i+1)*len/samples)` — a fixed `len/samples` chunk size drops the tail remainder and reintroduces drift at high sample counts.

### Validation & Error Matrix

- Audio shorter than bucket count → sparse samples land in their time-correct buckets, rest 0.0
- `covered_ms == 0` → frontend skips drawing (no division by zero)

### Good/Base/Bad Cases

- Good: HLS-merged mp4 → PCM length equals the container audio span; waveform aligned at the tail.
- Base: clean local file → filter is a no-op, output identical to plain decode.
- Bad (regression): dropping the filter or mapping by `video.duration` → linear drift on gap-carrying media; renaming `coveredMs` breaks the camelCase IPC contract silently.

### Tests Required

- Rust: `waveform_decode_args` / `audio_decode_args` contain `ARESAMPLE_SYNC_FILTER`; `downsample_waveform_peaks` pulse-localization test (impulse at 90% lands in bucket ≈ 0.9·samples, no cumulative drift) and tail-retention test on non-divisible lengths.
- Frontend: Timeline mapping test with `coveredMs != durationMs` asserting pixel position follows `coveredMs`.

### Wrong vs Correct

```text
Wrong:   ffmpeg -i in -vn -f s16le -ar 16000 -ac 1 -   → spread peaks across video.duration
Correct: … -vn -af aresample=async=1:first_pts=0 …     → return covered_ms, map by it
```

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

- Decoding timeline-mapped audio without `aresample=async=1:first_pts=0`, or mapping waveform by container duration instead of `covered_ms`
- Bundling FFmpeg/Python/models into the release payload again
- ASR inference inside Rust
- Exposing download concurrency knobs in the UI
- Burn-page libass preview feature creep (preview belongs to editor)
