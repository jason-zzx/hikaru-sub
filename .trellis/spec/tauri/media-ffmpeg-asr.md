# Media, FFmpeg, and ASR

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

## Native ASR Job Host (Development-only)

### Scope / Trigger

Use the Rust host in `asr_worker.rs` when a reviewed native worker must be exercised through the existing product job contract. Until production cutover is explicitly approved, Release/default routing and model list/status/download remain on the Python sidecar; native routing is available only through test construction or debug-only `HIKARU_ASR_FAKE_WORKER` injection.

### Signatures

```rust
#[tauri::command]
async fn start_asr(state: State<'_, AsrState>, app: AppHandle, args: StartAsrArgs)
    -> Result<serde_json::Value, String>;

#[tauri::command]
async fn get_asr_progress(
    state: State<'_, AsrState>,
    app: AppHandle,
    job_id: String,
    include_segments: Option<bool>,
) -> Result<serde_json::Value, String>;

#[tauri::command]
async fn cancel_asr(state: State<'_, AsrState>, job_id: String) -> Result<(), String>;

struct ResolvedNativeLaunch {
    // resolved engine/backend, role/path models, device, audio/output/recovery paths
}
```

### Contracts

- Preserve command names, camelCase `StartAsrArgs`, missing-job text containing `转录任务不存在`, and `AsrJobSnapshot` fields. `includeSegments=false` omits `segments`.
- Legacy and native routes share one active-job gate. Start failure releases an unactivated reservation; terminal poll/recovery, successful cancel, and shutdown release an active legacy slot; ordinary connection failure does not.
- Worker `completed` is only a candidate until stdout reaches EOF and the process exits 0. The terminal snapshot must not become queryable until terminal recovery JSON and any minimal fallback ASS are persisted, or React's authoritative ASS write can race with the fallback.
- Every terminal source uses first-terminal-wins. A later cancel/shutdown may still terminate and reap an outstanding PID, but must not overwrite the committed status/error.
- Release the active slot before publishing `reaped`/returning cancel, so a caller cannot observe cleanup completion while a replacement start is still rejected.
- Bound both `segment` append accumulation and `segmentsReplace` with canonical `maxReplacementSegments`. Embed `native-asr/protocol-v1-limits.json`; do not maintain a handwritten Rust limits copy.
- Recovery/stderr artifact job IDs must use the host-safe generated character set, not merely the protocol's byte/control-character rules; otherwise separators can escape managed directories.
- `HIKARU_ASR_FAKE_WORKER` and `HIKARU_ASR_FAKE_SCENARIO` are debug/test-only. `#[cfg(not(debug_assertions))]` must leave Release on legacy routing.

### Validation & Error Matrix

| Condition | Result |
|---|---|
| Second legacy/native start while one is active | Reject before spawning a second process |
| Malformed/unknown/version-mismatched/oversized event | Controlled failed snapshot; preserve last valid segments |
| Nonzero exit without structured worker error | `[worker_abnormal_exit] ...` |
| Exit 0 without terminal event | Stable protocol-incomplete failure |
| `completed` followed by nonzero exit | Failure, not completed |
| Cancel after a terminal snapshot but before reap | Keep first terminal status; terminate/reap remaining process tree |
| Unsafe artifact job ID or path outside approved workspace/cache root | Reject before launch/write |

### Good/Base/Bad Cases

- Good: valid fake-worker success → pending/running, bounded progress/segments, exit 0, recovery writes, then completed becomes visible and the active slot is free.
- Base: no debug override or Release build → unchanged Python legacy route and model APIs.
- Bad: publish completed before fallback ASS persistence, release the slot after notifying reap, or return early from terminal cancel while a PID remains.

### Tests Required

- Reducer: ready ordering, duration/progress monotonicity, bounded append/replace, replacement atomicity, and first-terminal-wins.
- Fake worker: success/replace/structured error/malformed/version/unknown/oversize/incomplete/crash/completed-nonzero/stderr scenarios.
- Lifecycle: shared active slot, legacy release/retain branches, cancel/shutdown process-tree cleanup within two seconds, terminal-but-unreaped cleanup, and no orphan parent/child process.
- Persistence/security: partial recovery after failure/cancel/crash, minimal ASS only after non-empty completion, safe artifact job IDs, canonical path containment, and stderr byte/retention bounds.
- Compatibility: Release cargo check with malicious debug env values, full Rust tests, and `pnpm build` without frontend contract changes.

### Wrong vs Correct

```text
Wrong:   completed visible → React writes formal ASS → Rust fallback overwrites it
Correct: persist recovery/fallback under the terminal lock → publish completed

Wrong:   terminal already committed → cancel returns while PID still runs
Correct: preserve first terminal snapshot → terminate/reap PID → release slot → return
```

## ASR Sidecar Process

- Tauri starts/manages the Python FastAPI sidecar (`asr.rs`) and continues to proxy production/default inference plus model download until an explicit native cutover task changes that boundary.
- ASR setup (venv/deps) is separate (`asr_setup.rs`).
- App exit calls idempotent `AsrState.shutdown()` so native workers and the legacy sidecar share cleanup policy; `lib.rs` must not reach into process fields.
- Diagnostics: host may set `HIKARU_ASR_DEBUG_LOG` → sidecar writes JSONL (often under managed `deps/asr-service/asr-debug.log`). Prefer `model_download_*` events when model download fails.
- Rust owns orchestration only. Python or the independent native worker owns inference; do not run model inference inside the Tauri process.

## ASS Files on Disk

`ass.rs` loads/saves text. Semantic parse/serialize is frontend `src/lib/ass/`. Transcription may write ASS via the sidecar `ass_writer` when `outputAssPath` is set; editor still owns bilingual merge modes on save.

## Anti-Patterns

- Decoding timeline-mapped audio without `aresample=async=1:first_pts=0`, or mapping waveform by container duration instead of `covered_ms`
- Bundling FFmpeg/Python/models into the release payload again
- ASR inference inside Rust
- Exposing download concurrency knobs in the UI
- Burn-page libass preview feature creep (preview belongs to editor)
