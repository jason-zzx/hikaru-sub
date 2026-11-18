# Implementation Plan: Optimize HLS Video Download Throughput

## Ordered Checklist

1. **Dependencies & Config (`src-tauri/Cargo.toml`, `src-tauri/src/hls_types.rs`)**
   - Add `"system-proxy"` explicitly to `reqwest` features in `src-tauri/Cargo.toml`.
   - Update `hls_types.rs`:
     - Raise `MIN_AUTO_CONCURRENCY` / `MAX_AUTO_CONCURRENCY` (e.g. `24..=48`) and `auto_concurrency_for_parallelism` formula, updating unit tests.
     - Add `MasterPlaylistSelection`, `HlsEpoch`, `epoch_index` on `HlsSegment`, `AssembledMedia`, and `HlsDownloadError::RemuxFallback(String)` (eligible for `Auto` fallback).
     - Verify `cargo test --manifest-path src-tauri/Cargo.toml hls_types::tests`.

2. **Playlist Planning (`src-tauri/src/hls_playlist.rs`)**
   - Implement `select_master_streams` supporting `#EXT-X-MEDIA:TYPE=AUDIO` renditions (`DEFAULT` > `AUTOSELECT` > first with `URI`).
   - Replace `UnsupportedDiscontinuity` rejection with discontinuity epoch tracking (`epochs: Vec<HlsEpoch>`), tracking per-`#EXT-X-MAP` encryption in playlist line order.
   - Add/update unit tests for external audio selection, multi-discontinuity epochs, and multi-MAP/KEY ordering.
   - Verify `cargo test --manifest-path src-tauri/Cargo.toml hls_playlist::tests`.

3. **Buffered Segment Fetch & Decryption (`src-tauri/src/hls_fetch.rs`)**
   - Accept optional `downloaded_bytes: Option<Arc<AtomicU64>>` and `ensure_parent_dir: bool` (or helper) so batch downloads avoid per-segment `create_dir_all`.
   - Inject default `User-Agent` only when `HeaderMap` lacks `user-agent`.
   - Stream response chunks while incrementing `downloaded_bytes` per chunk, buffering <= 32 MiB in memory and spilling > 32 MiB via `BufWriter` in `spawn_blocking`.
   - Run AES-128 decryption (in-place when `Pkcs7` applies) + `std::fs::write` inside a single `spawn_blocking` call.
   - Add tests for byte counting, large/multi-chunk buffered write, AES-128 in-place decryption, and cancellation.
   - Verify `cargo test --manifest-path src-tauri/Cargo.toml hls_fetch::tests`.

4. **HTTP/1.1 Multi-Connection Client, Worker Pool & Fast Assembly (`src-tauri/src/hls_download.rs`)**
   - Configure `build_hls_http_client` with `.http1_only()`, `pool_max_idle_per_host`, `connect_timeout`, `read_timeout`, `tcp_nodelay(true)`, `tcp_keepalive`; add tuned HTTP/2 fallback on protocol rejection during `resolve_media_plan`.
   - Return `ResolvedHlsPlan` supporting optional paired external audio URL (`Single` mode master playlist).
   - Prefetch keys concurrently; pre-create `media_dir` once; schedule segments using `JoinSet` multi-task workers (`concurrency.clamp(2, 64)`) + `AtomicUsize` work index + optional `shared_semaphore`.
   - Rewrite `assemble_media_file` into single `spawn_blocking` with 4 MiB `BufWriter` + 1 MiB buffer supporting single-file and multi-epoch `concat.txt` output.
   - Update/add tests for concurrent download, external audio master resolution, discontinuity epoch assembly, and `concat.txt` generation.
   - Verify `cargo test --manifest-path src-tauri/Cargo.toml hls_download::tests`.

5. **Download Orchestration, Non-Blocking Start & Speed Metering (`src-tauri/src/download.rs`)**
   - Add `speed_bytes_per_sec: Option<u64>` to `DownloadSnapshot` and implement `SpeedMeter` + `downloaded_bytes` / `speed_active` tracking on `DownloadJobInner` (including FFmpeg `total_size=` parsing for fallback mode).
   - Remove synchronous network `ffprobe` from `start_video_download`; move stream extension detection into background task (using plan hints + fast local `ffprobe` on assembled media before remux, or inside FFmpeg fallback).
   - Update `run_segment_strategy` to handle `Single` mode with resolved external audio concurrently, handle `AssembledMedia::ConcatList` in remux args (with conditional `-bsf:a aac_adtstoasc`), and fall back cleanly with stderr logs on multi-epoch remux failure.
   - Update `cancel_video_download` to always clean `save_dir` temp directory even before `output_path` is finalized.
   - Update/add Rust tests for non-blocking start/cancel, `AssembledMedia` remux args, `total_size=` parsing, and `SpeedMeter`.
   - Verify `cargo test --manifest-path src-tauri/Cargo.toml download::tests`.

6. **Frontend Types, Speed Formatter & UI (`src/types/index.ts`, `src/constants/runtimeDependencies.ts`, `src/components/workflow/DownloadView.tsx`, `src/components/workflow/DownloadView.test.tsx`)**
   - Add `speedBytesPerSec?: number | null` to `DownloadSnapshot` in `src/types/index.ts`.
   - Add shared `formatTransferSpeed` helper reusing `formatDependencyBytes`.
   - Render concise download speed in `DownloadView.tsx` during active network download without adding fallback alerts or concurrency/strategy UI.
   - Add unit/component tests in `DownloadView.test.tsx` (and speed formatter test in `runtimeDependencies.test.ts`).

7. **Full Cross-Layer Verification**
   - Run `cargo test --manifest-path src-tauri/Cargo.toml`
   - Run `pnpm test`
   - Run `pnpm build`

## Risky Files & Rollback Points

- `src-tauri/src/hls_download.rs` / `hls_fetch.rs` / `hls_playlist.rs`: core downloader changes; unit-tested with `httpmock` and `tempfile`.
- `src-tauri/src/download.rs`: job lifecycle, cancellation, and FFmpeg fallback boundary; keep `probe_download_media` and `Auto` FFmpeg fallback intact as safety net.
- `src/types/index.ts` & `src/components/workflow/DownloadView.tsx`: additive UI/type surface only.
