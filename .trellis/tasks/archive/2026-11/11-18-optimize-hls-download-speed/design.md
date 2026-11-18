# Design: Optimize HLS Video Download Throughput

## 1. Architecture & Layer Boundaries

- **Rust Backend (`src-tauri/src/`)**: Owns HTTP client pooling, m3u8 master/media playlist resolution, multi-worker concurrent segment downloading, AES-128 decryption, buffered disk I/O, discontinuity epoch assembly, FFmpeg remux/concat/fallback execution, real-time byte-rate metering, and cancellation cleanup.
- **React Frontend (`src/`)**: Owns typed `DownloadSnapshot` consumption (`src/types/index.ts`) and concise speed rendering in `src/components/workflow/DownloadView.tsx` using shared byte/speed formatting (`src/constants/runtimeDependencies.ts`). No concurrency, proxy, or strategy controls are exposed (`AGENTS.md`), and fallback diagnostics remain backend stderr logs only.

## 2. Data Flow & Component Changes

### 2.1 HTTP Transport & Protocol Fallback (`Cargo.toml`, `hls_download.rs`, `hls_fetch.rs`)

```text
resolve_media_plan(url)
  ├─ try HTTP/1.1 pooled client (.http1_only(), pool_max_idle_per_host >= concurrency,
  │    connect_timeout=15s, read_timeout=30s, tcp_nodelay=true, tcp_keepalive=30s)
  └─ on HTTP/1.1 protocol/TLS-ALPN rejection ONLY:
       log fallback & switch to auto-ALPN HTTP/2 client
       (http2_initial_stream_window_size=2MiB, http2_initial_connection_window_size=8MiB,
        http2_adaptive_window=true)
```

- Declare `"system-proxy"` explicitly alongside `"rustls-tls"`, `"stream"`, `"http2"`, `"json"` for `reqwest` in `src-tauri/Cargo.toml`.
- Default `User-Agent` (standard browser UA string) is applied via `ClientBuilder::user_agent(...)` or per-request fallback only when the caller-provided `HeaderMap` does not contain `USER_AGENT`.
- Remove `.timeout(30s)` on the full HTTP response; use `.connect_timeout(15s)` + `.read_timeout(config.request_timeout_secs)` so large/slow-starting segments actively streaming bytes are not aborted at 30s total elapsed time.

### 2.2 Multi-Worker Scheduling & Buffered Disk I/O (`hls_types.rs`, `hls_fetch.rs`, `hls_download.rs`)

- **Auto Concurrency (`hls_types.rs`)**:
  - `MIN_AUTO_CONCURRENCY = 24`, `MAX_AUTO_CONCURRENCY = 48`.
  - `auto_concurrency_for_parallelism(parallelism) = parallelism.saturating_mul(3).clamp(24, 48)`.
  - `download_plan` clamps explicit config concurrency to `2..=64` (preserving testability with small test values like `4` while permitting `48`).
- **Directory & Key Prefetch (`hls_download.rs`)**:
  - Create `media_dir` once via `tokio::fs::create_dir_all(&media_dir).await` before spawning workers; segment downloads skip `create_dir_all`. Standalone `download_url_to_file` still ensures its parent directory exists for `init` / direct unit-test callers.
  - `prefetch_keys` fetches unique key URLs concurrently (bounded via `buffer_unordered(concurrency.min(16))`) rather than sequentially.
- **Worker Pool (`hls_download.rs`)**:
  - Replace single-task `stream::iter(...).buffer_unordered(concurrency)` with a `tokio::task::JoinSet` spawning up to `concurrency` worker tasks (or bounded by `shared_semaphore`), pulling segment indices atomically via `Arc<AtomicUsize>`. Each worker acquires a permit from `shared_semaphore` (when shared across Video + Audio in `Separate` or Master-Audio `Single` mode) per segment download.
  - Any worker error cancels `CancellationToken`, aborts remaining tasks in `JoinSet`, and propagates the error immediately.
- **Chunk Counting & Buffered Write (`hls_fetch.rs`)**:
  - Pass an optional `Arc<AtomicU64>` (`downloaded_bytes`) into `download_url_to_file` / segment fetcher; on every chunk received from `response.bytes_stream()`, execute `downloaded_bytes.fetch_add(chunk.len() as u64, Ordering::Relaxed)`.
  - Buffer segments up to `MEMORY_BUFFER_THRESHOLD = 32 * 1024 * 1024` (32 MiB) in `Vec<u8>` (pre-allocating `content_length` up to threshold).
    - **Normal segments (<= 32 MiB)**: offloaded to a single `tokio::task::spawn_blocking` closure that performs AES-128-CBC decryption (in-place when `Pkcs7` padding succeeds, avoiding duplicate `Vec` allocations) and writes the file with `std::fs::write`.
    - **Oversized segments (> 32 MiB)**: once buffer crosses threshold (or `content_length > 32 MiB`), lazily open `std::io::BufWriter::with_capacity(512 * 1024, std::fs::File::create(...))` on a blocking thread (or write the buffered prefix + stream subsequent chunks in 512 KiB batches via `spawn_blocking`), preventing unbounded memory growth on huge single-file byte-range playlists. (If encrypted and >32 MiB, fall back to full buffer only as required by CBC padding verification).

### 2.3 Playlist Coverage & Epoch Assembly (`hls_playlist.rs`, `hls_types.rs`, `hls_download.rs`)

- **Master Playlist External Audio (`hls_playlist.rs`)**:
  - Introduce `MasterPlaylistSelection { pub video_url: String, pub audio_url: Option<String> }` and `select_master_streams(base_url, playlist_text) -> Result<Option<MasterPlaylistSelection>, HlsSupportError>`.
  - When the highest-bandwidth non-I-frame variant specifies `audio: Some(group_id)` and `master.alternatives` has `AlternativeMediaType::Audio` entries matching `group_id` with `uri.is_some()`, select the rendition by priority: `default == true`, else `autoselect == true`, else first matching entry with `uri.is_some()`. Resolve its URL into `audio_url`.
  - Keep `select_master_variant_url` removed or refactored cleanly onto `select_master_streams` (only used internally in `hls_download.rs` + unit tests).
  - In `DownloadMode::Single`, if `MasterPlaylistSelection` includes `audio_url: Some(a_url)`, download both video and audio streams concurrently sharing the same `reqwest::Client` and `Semaphore(config.concurrency)`, then mux via `build_merge_args`!
  - In `DownloadMode::Separate`, resolve only `video_url` from the video master playlist (ignoring external audio rendition since user supplied explicit `audio_url`).
- **VOD `#EXT-X-DISCONTINUITY` Support (`hls_playlist.rs`, `hls_download.rs`)**:
  - Replace hard failure `UnsupportedDiscontinuity` with `epoch_index: usize` on `HlsSegment` and `epochs: Vec<HlsEpoch>` (`pub struct HlsEpoch { pub index: usize, pub init: Option<HlsInitSegment> }`) on `HlsMediaPlan`.
  - Track `#EXT-X-MAP` and `#EXT-X-KEY` state cleanly across playlist lines so every epoch's `init` carries accurate per-MAP `init_encrypted` state (`KEY` before `MAP` -> encrypted when explicit IV exists; `MAP` before `KEY` -> clear).
  - Download all segments across all epochs in one concurrent `download_plan` pass (naming files `{epoch:04}_{index:08}.{ext}` or `{index:08}.{ext}` and `init_{epoch:04}.{ext}`).
  - `assemble_media_file` executes inside a single `tokio::task::spawn_blocking` using a 1 MiB copy buffer and 4 MiB `std::io::BufWriter`:
    - If `epochs.len() <= 1`: writes single `video.bin` / `audio.bin` (`AssembledMedia::SingleFile(PathBuf)`).
    - If `epochs.len() > 1`: writes `epoch_0000.{ext}`, `epoch_0001.{ext}`, ... + `concat.txt` inside `hls_temp_root` (`AssembledMedia::ConcatList(PathBuf)`).
- **FFmpeg Remux & Fallback (`download.rs`, `hls_types.rs`)**:
  - Update `build_single_remux_args` and `build_merge_args` to accept `AssembledMedia` (`-i <path>` vs `-f concat -safe 0 -i <concat.txt>`) and pass `-bsf:a aac_adtstoasc` only when audio is TS/ADTS (`MediaExtensionHint::Ts`), avoiding spurious warnings on fMP4.
  - Add `HlsDownloadError::RemuxFallback(String)` (eligible for `Auto` fallback) when a multi-epoch `concat` remux fails (e.g., mismatched resolution/codec across discontinuity). On fallback, log `[hikaru][download] ...` via `eprintln!` and invoke `run_ffmpeg_strategy`.

### 2.4 Non-Blocking Start, Local Probe & Speed Metering (`download.rs`, `src/types/index.ts`, `DownloadView.tsx`)

- **Non-blocking `start_video_download`**:
  - Perform only synchronous validation (`stem`, `Separate` audio URL presence, `parse_headers`, `save_dir` resolution/create) -> insert `DownloadJobInner` (`save_dir`, `stem`, `output_path: None`, `speed_bytes_per_sec: None`) -> spawn background task -> return `job_id`.
  - Inside `run_segment_strategy`:
    - `Separate` mode or `Single` mode with resolved external audio always produces `"mp4"`.
    - `Single` mode without external audio determines `"mp4"` vs `"m4a"` from `HlsMediaPlan.output_extension_hint` (`MediaExtensionHint::M4a` -> `"m4a"`, or for `Ts`/`Mp4` single-file/first-epoch path, run fast local `probe_media_file(&ffprobe, &local_path)` in ~15 ms to check `has_video`, defaulting to `"mp4"` if indeterminate).
    - Compute `unique_output_path(&save_dir, &stem, &ext)` right before remux, store into `DownloadJobInner.output_path`, and run `ffmpeg` remux.
    - If `DownloadStrategy::Ffmpeg` or `Auto` fallback triggers, resolve probe + `output_path` inside the blocking FFmpeg worker before spawning FFmpeg.
    - `cancel_video_download` cleans `remove_hls_temp_dir(&save_dir, &job_id_for_hls)` directly using `save_dir` (always known!) plus `output_path` and `temp_download_paths` if `output_path` is `Some`.
- **Speed Metering (`download.rs`)**:
  - `DownloadSnapshot` gains:
    ```rust
    pub speed_bytes_per_sec: Option<u64>,
    ```
    (`speedBytesPerSec?: number | null` in `src/types/index.ts`).
  - `DownloadJobInner` owns `downloaded_bytes: Arc<AtomicU64>`, `speed_active: Arc<AtomicBool>`, and `speed_meter: SpeedMeter { last_sample_at: Option<Instant>, last_bytes: u64, ema_bps: Option<f64> }`.
  - While `speed_active == true` (active network download in Rust segments or FFmpeg fallback parsing `total_size=`), `get_video_download_progress` samples `(Instant::now(), downloaded_bytes.load(Relaxed))`: if `dt >= 0.25s`, updates `ema_bps` (`0.45 * inst + 0.55 * prev`, or `inst` on first sample) and returns `speed_bytes_per_sec = Some(bps.round() as u64)`. When `speed_active == false` (local remux/concat or terminal status), returns `speed_bytes_per_sec = None`.
- **Frontend UI (`src/constants/runtimeDependencies.ts`, `src/components/workflow/DownloadView.tsx`)**:
  - Reuse `formatDependencyBytes` to add `formatTransferSpeed(bytesPerSec: number): string` -> `${formatDependencyBytes(bytesPerSec)}/s` (shared helper, zero duplicated unit tables).
  - In `DownloadView.tsx`, render `formatTransferSpeed(snapshot.speedBytesPerSec)` concisely alongside percentage / elapsed text when `snapshot?.speedBytesPerSec` is a positive number. Do not render fallback alerts or concurrency/strategy settings.

## 3. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Rare CDN rejects HTTP/1.1 or requires HTTP/2 ALPN | Automatic fallback in `resolve_media_plan` to tuned HTTP/2 client on HTTP/1.1 connection/protocol error |
| High concurrency triggers CDN 429 or high memory usage | Cap auto concurrency at `48`, keep retry exponential backoff, and spill segments >32 MiB to buffered disk writer |
| Discontinuity epoch switch changes video codec/resolution | Split by epoch + FFmpeg `concat`; if `-c copy` remux fails on multi-epoch stream in `Auto` mode, log and fall back to `run_ffmpeg_strategy` |
| Cancel triggered before `output_path` is resolved | Store `save_dir` on `DownloadJobInner` upfront so `cancel_video_download` always cleans `hikaru-download-cache/<job_id>` |
| Stale speed shown during local FFmpeg remux or completion | Clear `speed_active` flag to `false` before `assemble_media_file` / remux and on terminal states |

## 4. Compatibility

- `DownloadSnapshot` addition (`speedBytesPerSec`) is strictly additive.
- `probe_download_media` command signature and behavior remain unchanged.
- `StartVideoDownloadArgs.strategy` remains preserved for debugging; frontend UI continues omitting concurrency/strategy controls per `AGENTS.md`.
