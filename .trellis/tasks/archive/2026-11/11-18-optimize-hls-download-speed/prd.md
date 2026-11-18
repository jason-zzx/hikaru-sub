# Optimize HLS video download throughput

## Goal

Eliminate the throughput, scheduling, I/O, startup, and silent-fallback bottlenecks in Hikaru Sub's m3u8/HLS downloader so concurrent downloads saturate available bandwidth (parity with multi-connection downloaders such as N_m3u8DL-RE at 50–60 MB/s on capable links rather than stalling below 10 MB/s), display concise real-time download speed in the UI, and log any FFmpeg fallback without noisy UI alerts.

## Confirmed Technical Evidence

- **Single-TCP HTTP/2 multiplexing**: `src-tauri/Cargo.toml:29` enables `"http2"` on `reqwest`, and `src-tauri/src/hls_download.rs:174-183` (`build_hls_http_client`) enables `.http2_adaptive_window(true)` without `.http1_only()` or larger initial HTTP/2 flow-control windows. Against `h2`-capable CDNs, all concurrent segment requests share one TCP connection (`pool_max_idle_per_host` applies only to HTTP/1.1). `cargo tree` confirms `system-proxy` is already active in `reqwest v0.12.28` via transitive dependency unification, though not declared explicitly in `src-tauri/Cargo.toml:29`.
- **Unbuffered per-chunk disk I/O**: `src-tauri/src/hls_fetch.rs:97-129` (`write_response_stream_to_file`) writes each network chunk via `tokio::fs::File::write_all(&chunk).await`, triggering per-chunk `spawn_blocking` round-trips and backpressure on socket reads. `src-tauri/src/hls_fetch.rs:141-145` invokes `tokio::fs::create_dir_all(parent).await` before every segment. `src-tauri/src/hls_fetch.rs:46-72` (`aes128_cbc_decrypt`) makes extra `Vec` clones.
- **Single-task scheduler & concurrency limits**: `src-tauri/src/hls_download.rs:325-369` schedules all segments on one Tokio task via `stream::iter(...).buffer_unordered(concurrency)`, and `prefetch_keys` (`hls_download.rs:16-41`) fetches keys sequentially. `src-tauri/src/hls_types.rs:106-126` sets auto concurrency to `(parallelism * 2).clamp(8, 32)`, and `src-tauri/src/download.rs:978` shares one `Semaphore(config.concurrency)` across video and audio in `Separate` mode.
- **Timeout & missing default `User-Agent`**: `build_hls_http_client` sets `.timeout(30s)` over the full segment response rather than `connect_timeout` + `read_timeout`, and omits a default `User-Agent` when none is supplied.
- **Avoidable silent FFmpeg fallbacks**: `src-tauri/src/hls_playlist.rs:155-224` rejects master playlists with external `#EXT-X-MEDIA:TYPE=AUDIO` (`UnsupportedAudioRendition`) and VOD playlists with `#EXT-X-DISCONTINUITY` (`UnsupportedDiscontinuity`), falling back silently to sequential FFmpeg (`src-tauri/src/download.rs:1095-1116`).
- **Startup & assembly latency**: `src-tauri/src/download.rs:1479-1485` blocks `start_video_download` synchronously on `probe_media(&ffprobe, ...)` before returning `job_id`. `src-tauri/src/hls_download.rs:381-421` (`assemble_media_file`) concatenates segments serially with 8 KB `tokio::io::copy` calls before running `ffmpeg -movflags +faststart`.
- **Progress payload & UI contract**: `DownloadSnapshot` (`src-tauri/src/download.rs:73-81`, `src/types/index.ts:376-384`) has no speed field. `DownloadView.tsx:400-423` displays media time and percentage only. `AGENTS.md` and `.trellis/spec/tauri/media-ffmpeg-asr.md:70` require `auto` strategy by default and forbid exposing concurrency or strategy controls in the frontend UI (`start_video_download.strategy` remains debug-only).

## Requirements

- **REQ-1 (Multi-connection HTTP/1.1 transport & headers)**:
  - Configure `build_hls_http_client` to use `.http1_only()` by default with high `pool_max_idle_per_host`, `tcp_nodelay(true)`, `tcp_keepalive`, `connect_timeout`, and per-chunk `read_timeout` (replacing full-body `.timeout(30s)`). Keep automatic fallback to an auto-ALPN/HTTP/2 client (with raised initial stream/connection windows) if playlist negotiation fails specifically due to HTTP/1.1 rejection.
  - Explicitly declare `"system-proxy"` in `src-tauri/Cargo.toml` on `reqwest`. Inject a default standard `User-Agent` only when caller headers do not specify one; never log full headers or secrets.
- **REQ-2 (Multi-worker scheduling, concurrency & buffered disk I/O)**:
  - Schedule segment downloads across multi-threaded Tokio worker tasks (`JoinSet` / `tokio::spawn`) rather than a single `buffer_unordered` future, and prefetch distinct AES keys concurrently.
  - Pre-create segment output directories once per plan instead of per segment.
  - Stream segment chunks into a memory buffer (pre-sized from `content_length` when available, spilling to a large-buffer `BufWriter` in `spawn_blocking` above a bounded memory cap) and perform AES-128 decryption + disk write in a single `spawn_blocking` operation with minimal buffer copies.
  - Raise automatic concurrency defaults (e.g. `(parallelism * 3).clamp(24, 48)` with worker clamp up to `64`) while preserving `AGENTS.md` (no UI concurrency/strategy controls).
- **REQ-3 (Expanded VOD playlist coverage & log-only fallback)**:
  - Support Master Playlists referencing external `#EXT-X-MEDIA:TYPE=AUDIO` renditions in `DownloadMode::Single` by resolving both video variant and preferred audio rendition (`DEFAULT` -> `AUTOSELECT` -> first with URI), downloading them concurrently via the Rust segment downloader, and muxing into MP4.
  - Support VOD `#EXT-X-DISCONTINUITY` playlists by tracking discontinuity epochs (including per-`#EXT-X-MAP` encryption state), assembling epoch files, and muxing via FFmpeg `concat` demuxer. If `concat` remux fails in `Auto` mode (e.g., incompatible codec switch), log the reason and fall back to FFmpeg (`run_ffmpeg_strategy`).
  - Record fallback triggers and reasons via stderr logs (`eprintln!`) only; do not surface extra fallback alerts or banners in the UI.
- **REQ-4 (Non-blocking startup & fast assembly)**:
  - Return `job_id` from `start_video_download` immediately after lightweight synchronous input/directory validation, moving remote playlist/probe inspection into the background task and inferring output extension from the resolved plan / fast local `ffprobe` on assembled media before remuxing. Keep `probe_download_media` unchanged. Ensure `cancel_video_download` cleans temp and output artifacts safely even when cancelled before final extension resolution.
  - Rewrite `assemble_media_file` to concatenate files in one `spawn_blocking` pass using large `BufWriter`/copy buffers instead of per-chunk `tokio::io::copy`.
- **REQ-5 (Real-time download speed display)**:
  - Add additive `speedBytesPerSec?: number | null` (`speed_bytes_per_sec: Option<u64>`) to `DownloadSnapshot` (`src-tauri/src/download.rs` and `src/types/index.ts`).
  - Meter real-time received bytes across concurrent HTTP chunks (and FFmpeg `-progress` `total_size=` fallback when active) using smoothed rate calculation; clear `speedBytesPerSec` when entering local remux or terminal states.
  - Display formatted transfer speed (e.g. `52.4 MB/s`) concisely in `DownloadView.tsx` progress UI, reusing existing byte-formatting logic where appropriate and keeping the UI minimal.

## Acceptance Criteria

- [x] HTTP client defaults to HTTP/1.1 multi-connection pooling (`http1_only`), uses `connect_timeout` + `read_timeout`, injects default `User-Agent` only when absent, declares `system-proxy` in `Cargo.toml`, and falls back to HTTP/2-capable client if playlist fetch hits HTTP/1.1 protocol rejection (verified by unit tests).
- [x] Segment downloads execute across multi-task workers (`JoinSet`), pre-create directories once per plan, buffer segments before single `spawn_blocking` write/decrypt (with large-segment spill fallback), and `assemble_media_file` uses single-`spawn_blocking` buffered assembly (verified by unit/integration tests including >32 MB or multi-chunk streaming and AES-128 tests).
- [x] Auto concurrency defaults and bounds are updated with matching `hls_types.rs` unit tests; frontend exposes neither concurrency nor strategy controls.
- [x] Master playlists with `#EXT-X-MEDIA:TYPE=AUDIO` resolve video + audio URLs and complete concurrently in `Single` mode without falling back to FFmpeg (verified by `hls_playlist.rs` + `hls_download.rs` / `download.rs` tests).
- [x] VOD playlists with `#EXT-X-DISCONTINUITY` (including multiple `#EXT-X-MAP` / `#EXT-X-KEY` segments) assemble epoch files and build valid `concat` remux inputs; remux failure in `Auto` mode falls back cleanly to FFmpeg and logs only (verified by unit tests).
- [x] `start_video_download` does not run blocking network `ffprobe` before returning `job_id`, and `cancel_video_download` cleans up temp/output directories cleanly at any stage.
- [x] `DownloadSnapshot.speedBytesPerSec` updates during active network download, resets to `null` during local remux/terminal states, and renders concisely in `DownloadView.tsx` (verified by Rust tests + `DownloadView.test.tsx`).
- [ ] Full validation passes: `pnpm test` and `pnpm build` passed; `cargo check --all-targets` and all `hls_*` / `download::tests` passed; full `cargo test` hit 1 unrelated pre-existing `pwsh`/`Expand-Archive` failure in `dependencies::crispasr::delivery::tests::synthetic_http_archive_publish_offline_repair_and_hash_rejection`, and live high-bandwidth real-CDN throughput awaits user testing.

## Out Of Scope

- Exposing manual concurrency, proxy, or download strategy toggles in user-facing UI (`AGENTS.md` constraint).
- Showing FFmpeg fallback warnings/banners in UI (log-only per user decision).
- Live m3u8 playlists without `#EXT-X-ENDLIST` or `SAMPLE-AES` encrypted streams (continue falling back to FFmpeg).
- Modifying ASR model or runtime dependency downloaders (`asr_models.rs`, `dependencies.rs`).
