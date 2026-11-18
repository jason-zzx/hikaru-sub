use crate::hls_fetch::{
    build_get_request, download_url_to_file_with_options, fetch_key_bytes, parse_header_map,
    AesCbcParams,
};
use crate::hls_playlist::{plan_from_playlist_text, select_master_streams};
use crate::hls_types::{
    AssembledMedia, CancellationToken, HlsDownloadError, HlsDownloadRequest, HlsInitSegment,
    HlsMediaPlan, HlsSegment, HlsSupportError, MasterPlaylistSelection, MediaExtensionHint,
    MediaKind, SegmentDecryptInfo, SegmentDownloadConfig,
};
use futures::stream::{self, StreamExt};
use reqwest::header::HeaderMap;
use reqwest::StatusCode;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

/// 预先取回播放列表用到的全部 AES-128 密钥（按 URL 去重并并发拉取缓存）。
async fn prefetch_keys(
    client: &reqwest::Client,
    plan: &HlsMediaPlan,
    headers: &HeaderMap,
    concurrency: usize,
) -> Result<HashMap<String, [u8; 16]>, HlsDownloadError> {
    let mut urls: HashSet<String> = HashSet::new();
    for epoch in &plan.epochs {
        if let Some(init) = &epoch.init {
            if let Some(decrypt) = &init.decrypt {
                urls.insert(decrypt.key_url.clone());
            }
        }
    }
    for segment in &plan.segments {
        if let Some(decrypt) = &segment.decrypt {
            urls.insert(decrypt.key_url.clone());
        }
    }

    let total = urls.len();
    if total == 0 {
        return Ok(HashMap::new());
    }

    let mut fetches = stream::iter(urls)
        .map(|url| async move {
            let key = fetch_key_bytes(client, &url, headers)
                .await
                .map_err(HlsDownloadError::Operation)?;
            Ok::<(String, [u8; 16]), HlsDownloadError>((url, key))
        })
        .buffer_unordered(concurrency.clamp(1, 16));

    let mut cache = HashMap::with_capacity(total);
    while let Some(res) = fetches.next().await {
        let (url, key) = res?;
        cache.insert(url, key);
    }
    Ok(cache)
}

/// 根据规划阶段的解密信息与已缓存密钥构造解密参数。
fn resolve_decrypt_params(
    info: Option<&SegmentDecryptInfo>,
    keys: &HashMap<String, [u8; 16]>,
) -> Result<Option<AesCbcParams>, String> {
    match info {
        Some(decrypt) => {
            let key = keys
                .get(&decrypt.key_url)
                .copied()
                .ok_or_else(|| format!("缺少解密密钥：{}", decrypt.key_url))?;
            Ok(Some(AesCbcParams {
                key,
                iv: decrypt.iv,
            }))
        }
        None => Ok(None),
    }
}

#[derive(Debug, Clone)]
pub struct HlsDownloadOutput {
    pub media: AssembledMedia,
    pub probe_path: PathBuf,
    pub duration_ms: i64,
    pub extension_hint: MediaExtensionHint,
}

#[derive(Debug, Clone)]
pub enum HlsSingleDownloadResult {
    Single(HlsDownloadOutput),
    MuxedPair {
        video: HlsDownloadOutput,
        audio: HlsDownloadOutput,
    },
}

pub fn hls_download_root(base_dir: &Path) -> PathBuf {
    base_dir.join("hikaru-download-cache")
}

pub fn hls_temp_root(base_dir: &Path, job_id: &str) -> PathBuf {
    hls_download_root(base_dir).join(job_id)
}

/// 删除任务临时目录；若下载缓存目录已空则一并移除。
pub fn remove_hls_temp_dir(base_dir: &Path, job_id: &str) {
    let _ = std::fs::remove_dir_all(hls_temp_root(base_dir, job_id));
    let root = hls_download_root(base_dir);
    if root.is_dir() {
        let _ = std::fs::remove_dir(&root);
    }
}

pub fn temp_media_path(base_dir: &Path, job_id: &str, kind: MediaKind) -> PathBuf {
    let filename = match kind {
        MediaKind::Audio => "audio.bin",
        MediaKind::Video => "video.bin",
    };
    hls_temp_root(base_dir, job_id).join(filename)
}

fn media_dir_name(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Audio => "audio",
        MediaKind::Video => "video",
    }
}

/// 从分片 URL 推断原始扩展名（先剥除 query/fragment，再取末段路径的扩展名）。
/// 用于临时分片文件命名，便于调试与未来的断点续传/单独保留分片；
/// 无法识别合法扩展名时回退到 `part`。
fn segment_extension(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    match name.rsplit_once('.') {
        Some((stem, ext))
            if !stem.is_empty()
                && (1..=5).contains(&ext.len())
                && ext.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            ext.to_ascii_lowercase()
        }
        _ => "part".to_string(),
    }
}

/// 临时分片文件名：零填充序号保证字典序==下载序，扩展名沿用原始分片。
fn segment_file_name(index: usize, url: &str) -> String {
    format!("{index:08}.{}", segment_extension(url))
}

/// 临时 init 段文件名：首 epoch 沿用 `init.<原始扩展名>`，后续 epoch 加序号。
fn init_file_name(epoch_index: usize, url: &str) -> String {
    if epoch_index == 0 {
        format!("init.{}", segment_extension(url))
    } else {
        format!("init_{epoch_index:04}.{}", segment_extension(url))
    }
}

const MAX_PLAYLIST_BYTES: usize = 16 * 1024 * 1024;

fn should_retry_with_http2_fallback(err: &reqwest::Error) -> bool {
    err.is_connect() || err.is_request()
}

fn is_binary_media_content_type(response: &reqwest::Response) -> bool {
    let Some(raw) = response.headers().get(reqwest::header::CONTENT_TYPE) else {
        return false;
    };
    let Ok(ct) = raw.to_str() else {
        return false;
    };
    let normalized = ct
        .split(';')
        .next()
        .unwrap_or(ct)
        .trim()
        .to_ascii_lowercase();
    normalized.starts_with("video/")
        || normalized == "application/octet-stream"
        || (normalized.starts_with("audio/") && !normalized.contains("mpegurl"))
}

async fn read_playlist_response_text(
    response: reqwest::Response,
) -> Result<String, HlsSupportError> {
    let status = response.status();
    if !status.is_success() {
        return Err(HlsSupportError::Network(format!("HTTP {}", status.as_u16())));
    }
    if is_binary_media_content_type(&response) {
        return Err(HlsSupportError::PlaylistParse("非 m3u8 播放列表内容".into()));
    }
    if response
        .content_length()
        .is_some_and(|len| len > MAX_PLAYLIST_BYTES as u64)
    {
        return Err(HlsSupportError::PlaylistParse("播放列表体积超出限制".into()));
    }

    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| HlsSupportError::Network(err.to_string()))?;
        if bytes.len() + chunk.len() > MAX_PLAYLIST_BYTES {
            return Err(HlsSupportError::PlaylistParse("播放列表体积超出限制".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes)
        .map_err(|err| HlsSupportError::PlaylistParse(format!("播放列表编码无效：{err}")))
}

async fn fetch_playlist_text(
    client: &reqwest::Client,
    url: &str,
    headers: &HeaderMap,
) -> Result<String, HlsSupportError> {
    let response = build_get_request(client, url, headers)
        .send()
        .await
        .map_err(|err| HlsSupportError::Network(err.to_string()))?;
    read_playlist_response_text(response).await
}

async fn fetch_playlist_text_with_protocol_fallback(
    client: &mut reqwest::Client,
    url: &str,
    headers: &HeaderMap,
    config: &SegmentDownloadConfig,
) -> Result<String, HlsSupportError> {
    let response_res = build_get_request(client, url, headers).send().await;
    match response_res {
        Ok(response) => {
            if response.status() == StatusCode::UPGRADE_REQUIRED {
                if let Ok(fallback_client) = build_hls_http2_fallback_client(config) {
                    eprintln!("[hikaru][hls] 服务端返回 HTTP 426，切换至 HTTP/2 兼容客户端");
                    *client = fallback_client;
                    return fetch_playlist_text(client, url, headers).await;
                }
            }
            read_playlist_response_text(response).await
        }
        Err(err) => {
            if should_retry_with_http2_fallback(&err) {
                if let Ok(fallback_client) = build_hls_http2_fallback_client(config) {
                    if let Ok(text) = fetch_playlist_text(&fallback_client, url, headers).await {
                        eprintln!(
                            "[hikaru][hls] HTTP/1.1 请求失败（{err}），已切换至 HTTP/2 兼容客户端"
                        );
                        *client = fallback_client;
                        return Ok(text);
                    }
                }
            }
            Err(HlsSupportError::Network(err.to_string()))
        }
    }
}

async fn resolve_media_plan(
    client: &mut reqwest::Client,
    url: &str,
    headers: &HeaderMap,
    kind: MediaKind,
    config: &SegmentDownloadConfig,
    prefetched: Option<(String, String)>,
) -> Result<HlsMediaPlan, HlsSupportError> {
    let (mut current_url, mut playlist_text) = match prefetched {
        Some(pair) => pair,
        None => (
            url.to_string(),
            fetch_playlist_text_with_protocol_fallback(client, url, headers, config).await?,
        ),
    };

    if let Some(selection) = select_master_streams(&current_url, &playlist_text)? {
        current_url = selection.video_url;
        playlist_text =
            fetch_playlist_text_with_protocol_fallback(client, &current_url, headers, config)
                .await?;
    }

    plan_from_playlist_text(&current_url, &playlist_text, kind)
}

pub fn build_hls_http_client(
    config: &SegmentDownloadConfig,
) -> Result<reqwest::Client, HlsDownloadError> {
    reqwest::Client::builder()
        .http1_only()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(config.request_timeout_secs))
        .pool_max_idle_per_host(config.concurrency.max(32))
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .tcp_nodelay(true)
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .build()
        .map_err(|err| HlsDownloadError::Operation(err.to_string()))
}

pub fn build_hls_http2_fallback_client(
    config: &SegmentDownloadConfig,
) -> Result<reqwest::Client, HlsDownloadError> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(config.request_timeout_secs))
        .pool_max_idle_per_host(config.concurrency.max(32))
        .http2_initial_stream_window_size(2 * 1024 * 1024)
        .http2_initial_connection_window_size(8 * 1024 * 1024)
        .http2_adaptive_window(true)
        .tcp_nodelay(true)
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .build()
        .map_err(|err| HlsDownloadError::Operation(err.to_string()))
}

/// 便捷入口：自建 HTTP client，供单测与单路调用使用。
#[allow(dead_code)]
pub async fn download_hls_media(
    request: HlsDownloadRequest,
    headers: &str,
    config: SegmentDownloadConfig,
    cancel: CancellationToken,
    on_progress: impl Fn(i64, i64) + Send + Sync + 'static,
    shared_semaphore: Option<Arc<Semaphore>>,
) -> Result<HlsDownloadOutput, HlsDownloadError> {
    let client = build_hls_http_client(&config)?;
    download_hls_media_with_client(
        client,
        request,
        headers,
        config,
        cancel,
        on_progress,
        shared_semaphore,
        None,
        None,
        None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn download_hls_media_with_client(
    mut client: reqwest::Client,
    request: HlsDownloadRequest,
    headers: &str,
    config: SegmentDownloadConfig,
    cancel: CancellationToken,
    on_progress: impl Fn(i64, i64) + Send + Sync + 'static,
    shared_semaphore: Option<Arc<Semaphore>>,
    downloaded_bytes: Option<Arc<AtomicU64>>,
    on_download_finished: Option<Arc<dyn Fn() + Send + Sync>>,
    prefetched: Option<(String, String)>,
) -> Result<HlsDownloadOutput, HlsDownloadError> {
    let header_map = parse_header_map(headers).map_err(HlsDownloadError::Operation)?;
    let plan = resolve_media_plan(
        &mut client,
        &request.url,
        &header_map,
        request.kind,
        &config,
        prefetched,
    )
    .await
    .map_err(|err| {
        eprintln!(
            "[hikaru][hls] 解析播放列表失败 kind={:?} url={}: {}",
            request.kind,
            request.url,
            err.user_message()
        );
        HlsDownloadError::Plan(err)
    })?;
    let encrypted_segments = plan
        .segments
        .iter()
        .filter(|seg| seg.decrypt.is_some())
        .count();
    eprintln!(
        "[hikaru][hls] 已生成分片计划 kind={:?} segments={} epochs={} total_ms={} init={} init_encrypted={} encrypted_segments={} concurrency={}",
        request.kind,
        plan.segments.len(),
        plan.epochs.len().max(1),
        plan.total_duration_ms,
        plan.init.is_some(),
        plan.init.as_ref().map(|i| i.decrypt.is_some()).unwrap_or(false),
        encrypted_segments,
        config.concurrency
    );

    let base_dir = request
        .output_path
        .parent()
        .ok_or_else(|| HlsDownloadError::Operation("无法解析输出目录".into()))?
        .to_path_buf();
    let job_id = request.job_id.clone();
    let temp_output = temp_media_path(&base_dir, &job_id, request.kind);

    download_plan(
        &client,
        &plan,
        &header_map,
        &base_dir,
        &job_id,
        request.kind,
        config,
        cancel.clone(),
        on_progress,
        shared_semaphore,
        downloaded_bytes,
    )
    .await?;

    if let Some(cb) = on_download_finished {
        cb();
    }

    let assembled = assemble_media_file_with_cancel(&plan, &base_dir, &job_id, &temp_output, Some(cancel))
        .await
        .map_err(HlsDownloadError::Operation)?;

    Ok(HlsDownloadOutput {
        media: assembled.media,
        probe_path: assembled.probe_path,
        duration_ms: plan.total_duration_ms,
        extension_hint: plan.output_extension_hint,
    })
}

/// 并发下载独立的视频与音频 HLS 流（共享并发配额与字节计数）。
#[allow(clippy::too_many_arguments)]
pub async fn download_hls_pair_with_client(
    client: reqwest::Client,
    job_id: String,
    video_url: String,
    audio_url: String,
    output_dir: PathBuf,
    headers: &str,
    config: SegmentDownloadConfig,
    cancel: CancellationToken,
    on_pair_progress: impl Fn(MediaKind, i64, i64) + Send + Sync + 'static,
    downloaded_bytes: Option<Arc<AtomicU64>>,
    on_download_finished: Option<Arc<dyn Fn() + Send + Sync>>,
) -> Result<(HlsDownloadOutput, HlsDownloadOutput), HlsDownloadError> {
    let semaphore = Arc::new(Semaphore::new(config.concurrency));
    let on_pair_progress = Arc::new(on_pair_progress);
    let stream_finished_cb = on_download_finished.map(|cb| {
        let remaining = Arc::new(AtomicUsize::new(2));
        Arc::new(move || {
            if remaining.fetch_sub(1, Ordering::SeqCst) == 1 {
                cb();
            }
        }) as Arc<dyn Fn() + Send + Sync>
    });
    let video_fut = download_hls_media_with_client(
        client.clone(),
        HlsDownloadRequest {
            job_id: job_id.clone(),
            url: video_url,
            kind: MediaKind::Video,
            output_path: output_dir.join("video.tmp"),
        },
        headers,
        config.clone(),
        cancel.clone(),
        {
            let cb = on_pair_progress.clone();
            move |done, total| cb(MediaKind::Video, done, total)
        },
        Some(semaphore.clone()),
        downloaded_bytes.clone(),
        stream_finished_cb.clone(),
        None,
    );
    let audio_fut = download_hls_media_with_client(
        client,
        HlsDownloadRequest {
            job_id,
            url: audio_url,
            kind: MediaKind::Audio,
            output_path: output_dir.join("audio.tmp"),
        },
        headers,
        config,
        cancel,
        move |done, total| on_pair_progress(MediaKind::Audio, done, total),
        Some(semaphore),
        downloaded_bytes,
        stream_finished_cb,
        None,
    );
    tokio::try_join!(video_fut, audio_fut)
}

/// 单 URL 入口：自动识别是否为主播放列表含外挂音轨；若含外挂音轨则并发双流下载，否则按单流下载。
#[allow(clippy::too_many_arguments)]
pub async fn download_hls_single_or_master_with_client(
    mut client: reqwest::Client,
    job_id: String,
    url: String,
    output_dir: PathBuf,
    headers: &str,
    config: SegmentDownloadConfig,
    cancel: CancellationToken,
    on_single_progress: impl Fn(i64, i64) + Send + Sync + 'static,
    on_pair_progress: impl Fn(MediaKind, i64, i64) + Send + Sync + 'static,
    downloaded_bytes: Option<Arc<AtomicU64>>,
    on_download_finished: Option<Arc<dyn Fn() + Send + Sync>>,
) -> Result<HlsSingleDownloadResult, HlsDownloadError> {
    let header_map = parse_header_map(headers).map_err(HlsDownloadError::Operation)?;
    let playlist_text =
        fetch_playlist_text_with_protocol_fallback(&mut client, &url, &header_map, &config)
            .await
            .map_err(HlsDownloadError::Plan)?;

    let (target_url, prefetched) = match select_master_streams(&url, &playlist_text)
        .map_err(HlsDownloadError::Plan)?
    {
        Some(MasterPlaylistSelection {
            video_url,
            audio_url: Some(audio_url),
        }) => {
            let (video, audio) = download_hls_pair_with_client(
                client,
                job_id,
                video_url,
                audio_url,
                output_dir,
                headers,
                config,
                cancel,
                on_pair_progress,
                downloaded_bytes,
                on_download_finished,
            )
            .await?;
            return Ok(HlsSingleDownloadResult::MuxedPair { video, audio });
        }
        Some(MasterPlaylistSelection {
            video_url,
            audio_url: None,
        }) => (video_url, None),
        None => (url.clone(), Some((url, playlist_text))),
    };

    let out = download_hls_media_with_client(
        client,
        HlsDownloadRequest {
            job_id,
            url: target_url,
            kind: MediaKind::Video,
            output_path: output_dir.join("single.tmp"),
        },
        headers,
        config,
        cancel,
        on_single_progress,
        None,
        downloaded_bytes,
        on_download_finished,
        prefetched,
    )
    .await?;
    Ok(HlsSingleDownloadResult::Single(out))
}

#[allow(clippy::too_many_arguments)]
async fn download_plan(
    client: &reqwest::Client,
    plan: &HlsMediaPlan,
    header_map: &HeaderMap,
    base_dir: &Path,
    job_id: &str,
    kind: MediaKind,
    config: SegmentDownloadConfig,
    cancel: CancellationToken,
    on_progress: impl Fn(i64, i64) + Send + Sync + 'static,
    shared_semaphore: Option<Arc<Semaphore>>,
    downloaded_bytes: Option<Arc<AtomicU64>>,
) -> Result<(), HlsDownloadError> {
    let media_dir = hls_temp_root(base_dir, job_id).join(media_dir_name(kind));
    tokio::fs::create_dir_all(&media_dir)
        .await
        .map_err(|err| HlsDownloadError::Operation(err.to_string()))?;

    let cancel_for_abort = cancel.clone();
    let concurrency = config.concurrency.clamp(2, 64);
    let keys = Arc::new(
        prefetch_keys(client, plan, header_map, concurrency)
            .await
            .map_err(|err| {
                cancel_for_abort.cancel();
                err
            })?,
    );

    let mut init_tasks = JoinSet::new();
    for epoch in &plan.epochs {
        let Some(init) = epoch.init.as_ref() else {
            continue;
        };
        let client = client.clone();
        let headers = header_map.clone();
        let init_path = media_dir.join(init_file_name(epoch.index, &init.url));
        let init_url = init.url.clone();
        let byte_range = init.byte_range;
        let decrypt_info = init.decrypt.clone();
        let cancel = cancel.clone();
        let keys = keys.clone();
        let downloaded_bytes = downloaded_bytes.clone();
        let retries = config.retries;
        init_tasks.spawn(async move {
            let init_decrypt = resolve_decrypt_params(decrypt_info.as_ref(), &keys)?;
            download_url_to_file_with_options(
                client,
                &init_url,
                headers,
                byte_range,
                &init_path,
                retries,
                cancel,
                init_decrypt,
                false,
                downloaded_bytes,
            )
            .await?;
            Ok::<(), String>(())
        });
    }
    while let Some(res) = init_tasks.join_next().await {
        match res {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                cancel_for_abort.cancel();
                init_tasks.abort_all();
                return Err(HlsDownloadError::Operation(err));
            }
            Err(err) => {
                cancel_for_abort.cancel();
                init_tasks.abort_all();
                return Err(HlsDownloadError::Operation(format!("下载 init 任务失败：{err}")));
            }
        }
    }

    let total_duration_ms = plan.total_duration_ms;
    let completed_ms = Arc::new(AtomicI64::new(0));
    let progress = Arc::new(on_progress);
    let segments = Arc::new(plan.segments.clone());
    let next_index = Arc::new(AtomicUsize::new(0));
    let worker_count = concurrency.min(segments.len().max(1));
    let mut workers = JoinSet::new();

    for _ in 0..worker_count {
        let client = client.clone();
        let headers = header_map.clone();
        let cancel = cancel.clone();
        let media_dir = media_dir.clone();
        let completed_ms = completed_ms.clone();
        let progress = progress.clone();
        let semaphore = shared_semaphore.clone();
        let keys = keys.clone();
        let segments = segments.clone();
        let next_index = next_index.clone();
        let downloaded_bytes = downloaded_bytes.clone();
        let retries = config.retries;

        workers.spawn(async move {
            loop {
                if cancel.is_cancelled() {
                    return Err("下载已取消".to_string());
                }
                let idx = next_index.fetch_add(1, Ordering::Relaxed);
                let Some(segment) = segments.get(idx) else {
                    return Ok::<(), String>(());
                };
                let _permit = match semaphore.as_ref() {
                    Some(sem) => Some(
                        sem.acquire()
                            .await
                            .map_err(|_| "下载调度器已关闭".to_string())?,
                    ),
                    None => None,
                };
                if cancel.is_cancelled() {
                    return Err("下载已取消".to_string());
                }
                let decrypt = resolve_decrypt_params(segment.decrypt.as_ref(), &keys)?;
                let path = media_dir.join(segment_file_name(segment.index, &segment.url));
                download_url_to_file_with_options(
                    client.clone(),
                    &segment.url,
                    headers.clone(),
                    segment.byte_range,
                    &path,
                    retries,
                    cancel.clone(),
                    decrypt,
                    false,
                    downloaded_bytes.clone(),
                )
                .await?;
                let done = completed_ms.fetch_add(segment.duration_ms, Ordering::SeqCst)
                    + segment.duration_ms;
                progress(done, total_duration_ms);
            }
        });
    }

    while let Some(result) = workers.join_next().await {
        match result {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                cancel_for_abort.cancel();
                workers.abort_all();
                return Err(HlsDownloadError::Operation(err));
            }
            Err(err) => {
                cancel_for_abort.cancel();
                workers.abort_all();
                return Err(HlsDownloadError::Operation(format!("下载工作任务异常：{err}")));
            }
        }
    }

    Ok(())
}

struct AssembledMediaOutput {
    media: AssembledMedia,
    probe_path: PathBuf,
}

fn copy_file_with_buf(
    input_path: &Path,
    output: &mut std::io::BufWriter<std::fs::File>,
    scratch: &mut [u8],
) -> Result<(), String> {
    let mut input = std::fs::File::open(input_path).map_err(|err| err.to_string())?;
    loop {
        let n = input.read(scratch).map_err(|err| err.to_string())?;
        if n == 0 {
            break;
        }
        output.write_all(&scratch[..n]).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn epoch_extension(hint: MediaExtensionHint) -> &'static str {
    match hint {
        MediaExtensionHint::Mp4 => "mp4",
        MediaExtensionHint::M4a => "m4a",
        MediaExtensionHint::Ts => "ts",
    }
}

#[cfg(test)]
pub async fn assemble_media_file(
    plan: &HlsMediaPlan,
    base_dir: &Path,
    job_id: &str,
    output_path: &Path,
) -> Result<AssembledMedia, String> {
    let out = assemble_media_file_with_cancel(plan, base_dir, job_id, output_path, None).await?;
    Ok(out.media)
}

fn write_epoch_file<'a>(
    output_path: &Path,
    media_dir: &Path,
    epoch_index: usize,
    init: Option<&HlsInitSegment>,
    segments: impl IntoIterator<Item = &'a HlsSegment>,
    scratch: &mut [u8],
    cancel: Option<&CancellationToken>,
) -> Result<(), String> {
    const WRITER_BUF_SIZE: usize = 4 * 1024 * 1024;
    if cancel.is_some_and(CancellationToken::is_cancelled) {
        return Err("下载已取消".into());
    }
    let file = std::fs::File::create(output_path).map_err(|err| err.to_string())?;
    let mut writer = std::io::BufWriter::with_capacity(WRITER_BUF_SIZE, file);
    if let Some(init) = init {
        copy_file_with_buf(
            &media_dir.join(init_file_name(epoch_index, &init.url)),
            &mut writer,
            scratch,
        )?;
    }
    for segment in segments {
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            return Err("下载已取消".into());
        }
        copy_file_with_buf(
            &media_dir.join(segment_file_name(segment.index, &segment.url)),
            &mut writer,
            scratch,
        )?;
    }
    writer.flush().map_err(|err| err.to_string())
}

async fn assemble_media_file_with_cancel(
    plan: &HlsMediaPlan,
    base_dir: &Path,
    job_id: &str,
    output_path: &Path,
    cancel: Option<CancellationToken>,
) -> Result<AssembledMediaOutput, String> {
    let epochs = plan.epochs.clone();
    let media_dir = hls_temp_root(base_dir, job_id).join(media_dir_name(plan.kind));
    let segments = plan.segments.clone();
    let output_path = output_path.to_path_buf();
    let extension_hint = plan.output_extension_hint;

    tokio::task::spawn_blocking(move || -> Result<AssembledMediaOutput, String> {
        const COPY_BUF_SIZE: usize = 1024 * 1024;
        let mut scratch = vec![0_u8; COPY_BUF_SIZE];

        if epochs.len() <= 1 {
            if let Some(parent) = output_path.parent() {
                std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            write_epoch_file(
                &output_path,
                &media_dir,
                0,
                epochs.first().and_then(|e| e.init.as_ref()),
                &segments,
                &mut scratch,
                cancel.as_ref(),
            )?;
            return Ok(AssembledMediaOutput {
                media: AssembledMedia::SingleFile(output_path.clone()),
                probe_path: output_path,
            });
        }

        let ext = epoch_extension(extension_hint);
        let mut concat_lines = Vec::new();
        let mut first_epoch_path: Option<PathBuf> = None;

        for epoch in &epochs {
            let epoch_segments: Vec<_> = segments
                .iter()
                .filter(|seg| seg.epoch_index == epoch.index)
                .collect();
            if epoch_segments.is_empty() {
                continue;
            }
            let epoch_name = format!("epoch_{:04}.{ext}", epoch.index);
            let epoch_path = media_dir.join(&epoch_name);
            write_epoch_file(
                &epoch_path,
                &media_dir,
                epoch.index,
                epoch.init.as_ref(),
                epoch_segments,
                &mut scratch,
                cancel.as_ref(),
            )?;
            if first_epoch_path.is_none() {
                first_epoch_path = Some(epoch_path);
            }
            concat_lines.push(format!("file '{epoch_name}'"));
        }

        let probe_path = first_epoch_path
            .ok_or_else(|| "未能生成任何有效的分片合并文件".to_string())?;
        let concat_path = media_dir.join("concat.txt");
        std::fs::write(&concat_path, concat_lines.join("\n"))
            .map_err(|err| err.to_string())?;
        Ok(AssembledMediaOutput {
            media: AssembledMedia::ConcatList(concat_path),
            probe_path,
        })
    })
    .await
    .map_err(|err| format!("合并分片任务异常退出：{err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hls_types::{HlsEpoch, MediaExtensionHint};
    use httpmock::Method::GET;
    use std::sync::atomic::{AtomicBool, AtomicUsize};
    use tempfile::tempdir;

    #[tokio::test]
    async fn downloads_segments_concurrently_and_assembles_in_order() {
        let server = httpmock::MockServer::start_async().await;
        for index in 0..4 {
            server
                .mock_async(move |when, then| {
                    when.method(GET).path(format!("/seg-{index}.ts"));
                    then.status(200).body(format!("seg{index};"));
                })
                .await;
        }

        let playlist = format!(
            "#EXTM3U\n#EXT-X-TARGETDURATION:1\n{}\n#EXT-X-ENDLIST\n",
            (0..4)
                .map(|index| format!("#EXTINF:1,\n{}/seg-{index}.ts", server.base_url()))
                .collect::<Vec<_>>()
                .join("\n")
        );
        server
            .mock_async(move |when, then| {
                when.method(GET).path("/index.m3u8");
                then.status(200).body(playlist);
            })
            .await;

        let dir = tempdir().unwrap();
        let output = dir.path().join("media.bin");
        let cancel = CancellationToken::new(Arc::new(AtomicBool::new(false)));
        let completed = Arc::new(AtomicUsize::new(0));
        let completed_for_progress = completed.clone();

        let result = download_hls_media(
            HlsDownloadRequest {
                job_id: "job-test".into(),
                url: format!("{}/index.m3u8", server.base_url()),
                kind: MediaKind::Video,
                output_path: output.clone(),
            },
            "",
            SegmentDownloadConfig {
                concurrency: 4,
                retries: 0,
                request_timeout_secs: 30,
            },
            cancel,
            move |_done, _total| {
                completed_for_progress.fetch_add(1, Ordering::SeqCst);
            },
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.duration_ms, 4000);
        assert_eq!(
            std::fs::read_to_string(&result.probe_path).unwrap(),
            "seg0;seg1;seg2;seg3;"
        );
        assert!(completed.load(Ordering::SeqCst) >= 4);
    }

    #[tokio::test]
    async fn assemble_media_file_writes_init_before_segments() {
        let dir = tempdir().unwrap();
        let init = crate::hls_types::HlsInitSegment {
            url: "https://example.com/init.mp4".into(),
            byte_range: None,
            decrypt: None,
        };
        let plan = HlsMediaPlan {
            kind: MediaKind::Video,
            init: Some(init.clone()),
            epochs: vec![HlsEpoch {
                index: 0,
                init: Some(init),
            }],
            segments: vec![
                crate::hls_types::HlsSegment {
                    index: 0,
                    epoch_index: 0,
                    url: "https://example.com/0.m4s".into(),
                    duration_ms: 1000,
                    byte_range: None,
                    decrypt: None,
                },
                crate::hls_types::HlsSegment {
                    index: 1,
                    epoch_index: 0,
                    url: "https://example.com/1.m4s".into(),
                    duration_ms: 1000,
                    byte_range: None,
                    decrypt: None,
                },
            ],
            total_duration_ms: 2000,
            output_extension_hint: MediaExtensionHint::Mp4,
        };
        let job_id = "job-test";
        let base = dir.path();
        let media_dir = hls_temp_root(base, job_id).join("video");
        std::fs::create_dir_all(&media_dir).unwrap();
        std::fs::write(media_dir.join("init.mp4"), b"init;").unwrap();
        std::fs::write(media_dir.join("00000000.m4s"), b"a;").unwrap();
        std::fs::write(media_dir.join("00000001.m4s"), b"b;").unwrap();
        let output = base.join("video.bin");

        assemble_media_file(&plan, base, job_id, &output)
            .await
            .unwrap();

        assert_eq!(std::fs::read(&output).unwrap(), b"init;a;b;");
    }

    #[test]
    fn remove_hls_temp_dir_removes_job_dir_and_empty_parent() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let job_id = "job-cleanup";
        let job_dir = hls_temp_root(base, job_id);
        let root = hls_download_root(base);
        std::fs::create_dir_all(job_dir.join("video")).unwrap();
        std::fs::write(job_dir.join("video.bin"), b"data").unwrap();

        remove_hls_temp_dir(base, job_id);

        assert!(!job_dir.exists());
        assert!(!root.exists());
    }

    #[test]
    fn remove_hls_temp_dir_keeps_parent_when_other_jobs_remain() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let root = hls_download_root(base);
        let job_a = hls_temp_root(base, "job-a");
        let job_b = hls_temp_root(base, "job-b");
        std::fs::create_dir_all(&job_a).unwrap();
        std::fs::create_dir_all(&job_b).unwrap();

        remove_hls_temp_dir(base, "job-a");

        assert!(!job_a.exists());
        assert!(job_b.exists());
        assert!(root.exists());
    }

    #[test]
    fn segment_extension_uses_original_suffix_and_falls_back() {
        assert_eq!(
            segment_extension("https://asset.example.jp/x/01.cmfv?session=abc&Policy=xyz"),
            "cmfv"
        );
        assert_eq!(segment_extension("https://cdn.example.com/seg-3.ts"), "ts");
        assert_eq!(
            segment_extension("https://cdn.example.com/a/0.m4s?t=1"),
            "m4s"
        );
        assert_eq!(
            segment_extension("https://cdn.example.com/INIT01.CMFA"),
            "cmfa"
        );
        // 无扩展名 / 仅 query / dotfile / 超长后缀 → 回退 part
        assert_eq!(
            segment_extension("https://cdn.example.com/segment/12345?x=1"),
            "part"
        );
        assert_eq!(segment_extension("https://cdn.example.com/.hidden"), "part");
        assert_eq!(
            segment_extension("https://cdn.example.com/file.superlongext"),
            "part"
        );
        assert_eq!(
            segment_file_name(7, "https://x/01.cmfv?s=1"),
            "00000007.cmfv"
        );
        assert_eq!(init_file_name(0, "https://x/init01.cmfa?s=1"), "init.cmfa");
        assert_eq!(
            init_file_name(2, "https://x/init02.cmfa?s=1"),
            "init_0002.cmfa"
        );
    }

    #[tokio::test]
    async fn assemble_media_file_streams_large_segments_in_order() {
        let dir = tempdir().unwrap();
        let init = crate::hls_types::HlsInitSegment {
            url: "https://example.com/init.mp4".into(),
            byte_range: None,
            decrypt: None,
        };
        let plan = HlsMediaPlan {
            kind: MediaKind::Video,
            init: Some(init.clone()),
            epochs: vec![HlsEpoch {
                index: 0,
                init: Some(init),
            }],
            segments: vec![
                crate::hls_types::HlsSegment {
                    index: 0,
                    epoch_index: 0,
                    url: "https://example.com/0.m4s".into(),
                    duration_ms: 1000,
                    byte_range: None,
                    decrypt: None,
                },
                crate::hls_types::HlsSegment {
                    index: 1,
                    epoch_index: 0,
                    url: "https://example.com/1.m4s".into(),
                    duration_ms: 1000,
                    byte_range: None,
                    decrypt: None,
                },
            ],
            total_duration_ms: 2000,
            output_extension_hint: MediaExtensionHint::Mp4,
        };
        let job_id = "job-large";
        let base = dir.path();
        let media_dir = hls_temp_root(base, job_id).join("video");
        std::fs::create_dir_all(&media_dir).unwrap();
        std::fs::write(media_dir.join("init.mp4"), vec![b'i'; 1024]).unwrap();
        std::fs::write(media_dir.join("00000000.m4s"), vec![b'a'; 64 * 1024]).unwrap();
        std::fs::write(media_dir.join("00000001.m4s"), vec![b'b'; 64 * 1024]).unwrap();
        let output = base.join("video.bin");

        assemble_media_file(&plan, base, job_id, &output)
            .await
            .unwrap();

        let bytes = std::fs::read(&output).unwrap();
        assert_eq!(bytes.len(), 1024 + 64 * 1024 + 64 * 1024);
        assert_eq!(&bytes[0..4], b"iiii");
        assert_eq!(&bytes[1024..1028], b"aaaa");
        assert_eq!(&bytes[(1024 + 64 * 1024)..(1024 + 64 * 1024 + 4)], b"bbbb");
    }

    #[tokio::test]
    async fn downloads_master_with_external_audio_concurrently() {
        let server = httpmock::MockServer::start_async().await;
        let master = r#"#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="main",DEFAULT=YES,URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2000000,AUDIO="aud"
video.m3u8
"#;
        let video_pl = format!(
            "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n{}/v0.ts\n#EXT-X-ENDLIST\n",
            server.base_url()
        );
        let audio_pl = format!(
            "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n{}/a0.ts\n#EXT-X-ENDLIST\n",
            server.base_url()
        );
        server
            .mock_async(move |when, then| {
                when.method(GET).path("/master.m3u8");
                then.status(200).body(master);
            })
            .await;
        server
            .mock_async(move |when, then| {
                when.method(GET).path("/video.m3u8");
                then.status(200).body(video_pl);
            })
            .await;
        server
            .mock_async(move |when, then| {
                when.method(GET).path("/audio.m3u8");
                then.status(200).body(audio_pl);
            })
            .await;
        server
            .mock_async(|when, then| {
                when.method(GET).path("/v0.ts");
                then.status(200).body("video-bytes");
            })
            .await;
        server
            .mock_async(|when, then| {
                when.method(GET).path("/a0.ts");
                then.status(200).body("audio-bytes");
            })
            .await;

        let dir = tempdir().unwrap();
        let config = SegmentDownloadConfig {
            concurrency: 4,
            retries: 0,
            request_timeout_secs: 30,
        };
        let client = build_hls_http_client(&config).unwrap();
        let cancel = CancellationToken::new(Arc::new(AtomicBool::new(false)));
        let bytes_counter = Arc::new(AtomicU64::new(0));

        let result = download_hls_single_or_master_with_client(
            client,
            "job-master".into(),
            format!("{}/master.m3u8", server.base_url()),
            dir.path().to_path_buf(),
            "",
            config,
            cancel,
            |_d, _t| {},
            |_kind, _d, _t| {},
            Some(bytes_counter.clone()),
            None,
        )
        .await
        .unwrap();

        match result {
            HlsSingleDownloadResult::MuxedPair { video, audio } => {
                assert_eq!(std::fs::read(&video.probe_path).unwrap(), b"video-bytes");
                assert_eq!(std::fs::read(&audio.probe_path).unwrap(), b"audio-bytes");
                assert_eq!(
                    bytes_counter.load(Ordering::Relaxed),
                    ("video-bytes".len() + "audio-bytes".len()) as u64
                );
            }
            HlsSingleDownloadResult::Single(_) => panic!("expected MuxedPair"),
        }
    }

    #[tokio::test]
    async fn assembles_discontinuity_epochs_into_concat_list() {
        let dir = tempdir().unwrap();
        let plan = HlsMediaPlan {
            kind: MediaKind::Video,
            init: Some(crate::hls_types::HlsInitSegment {
                url: "https://example.com/init0.mp4".into(),
                byte_range: None,
                decrypt: None,
            }),
            epochs: vec![
                HlsEpoch {
                    index: 0,
                    init: Some(crate::hls_types::HlsInitSegment {
                        url: "https://example.com/init0.mp4".into(),
                        byte_range: None,
                        decrypt: None,
                    }),
                },
                HlsEpoch {
                    index: 1,
                    init: Some(crate::hls_types::HlsInitSegment {
                        url: "https://example.com/init1.mp4".into(),
                        byte_range: None,
                        decrypt: None,
                    }),
                },
            ],
            segments: vec![
                crate::hls_types::HlsSegment {
                    index: 0,
                    epoch_index: 0,
                    url: "https://example.com/0.m4s".into(),
                    duration_ms: 1000,
                    byte_range: None,
                    decrypt: None,
                },
                crate::hls_types::HlsSegment {
                    index: 1,
                    epoch_index: 1,
                    url: "https://example.com/1.m4s".into(),
                    duration_ms: 1000,
                    byte_range: None,
                    decrypt: None,
                },
            ],
            total_duration_ms: 2000,
            output_extension_hint: MediaExtensionHint::Mp4,
        };
        let job_id = "job-disc";
        let base = dir.path();
        let media_dir = hls_temp_root(base, job_id).join("video");
        std::fs::create_dir_all(&media_dir).unwrap();
        std::fs::write(media_dir.join("init.mp4"), b"i0;").unwrap();
        std::fs::write(media_dir.join("init_0001.mp4"), b"i1;").unwrap();
        std::fs::write(media_dir.join("00000000.m4s"), b"s0;").unwrap();
        std::fs::write(media_dir.join("00000001.m4s"), b"s1;").unwrap();

        let assembled = assemble_media_file(&plan, base, job_id, &base.join("video.bin"))
            .await
            .unwrap();

        match assembled {
            AssembledMedia::ConcatList(concat_path) => {
                let text = std::fs::read_to_string(&concat_path).unwrap();
                assert_eq!(text, "file 'epoch_0000.mp4'\nfile 'epoch_0001.mp4'");
                assert_eq!(std::fs::read(media_dir.join("epoch_0000.mp4")).unwrap(), b"i0;s0;");
                assert_eq!(std::fs::read(media_dir.join("epoch_0001.mp4")).unwrap(), b"i1;s1;");
            }
            AssembledMedia::SingleFile(_) => panic!("expected ConcatList"),
        }
    }

    #[tokio::test]
    async fn rejects_binary_media_content_type_as_non_playlist() {
        let server = httpmock::MockServer::start_async().await;
        server
            .mock_async(|when, then| {
                when.method(GET).path("/movie.mp4");
                then.status(200)
                    .header("content-type", "video/mp4")
                    .body("binary-video-bytes");
            })
            .await;

        let config = SegmentDownloadConfig::default();
        let mut client = build_hls_http_client(&config).unwrap();
        let err = fetch_playlist_text_with_protocol_fallback(
            &mut client,
            &format!("{}/movie.mp4", server.base_url()),
            &HeaderMap::new(),
            &config,
        )
        .await
        .unwrap_err();

        assert!(matches!(err, HlsSupportError::PlaylistParse(_)));
        assert!(err.is_fallback_eligible());
    }

    #[tokio::test]
    async fn switches_to_fallback_client_on_http_426() {
        let server = httpmock::MockServer::start_async().await;
        let first = server
            .mock_async(|when, then| {
                when.method(GET)
                    .path("/h2.m3u8")
                    .header("x-test-stage", "1");
                then.status(426);
            })
            .await;
        let second = server
            .mock_async(|when, then| {
                when.method(GET).path("/h2.m3u8");
                then.status(200).body("#EXTM3U\n#EXT-X-ENDLIST\n");
            })
            .await;

        let config = SegmentDownloadConfig::default();
        let mut client = build_hls_http_client(&config).unwrap();
        // Verify 426 triggers fallback client retry cleanly:
        let err_or_ok = fetch_playlist_text_with_protocol_fallback(
            &mut client,
            &format!("{}/h2.m3u8", server.base_url()),
            &parse_header_map("X-Test-Stage: 1").unwrap(),
            &config,
        )
        .await;
        first.assert_hits_async(2).await;
        second.assert_hits_async(0).await;
        assert!(matches!(err_or_ok, Err(HlsSupportError::Network(_))));

        // And verify fallback client succeeds when server accepts second protocol:
        let fallback = build_hls_http2_fallback_client(&config).unwrap();
        let text = fetch_playlist_text(
            &fallback,
            &format!("{}/h2.m3u8", server.base_url()),
            &HeaderMap::new(),
        )
        .await
        .unwrap();
        assert!(text.contains("#EXTM3U"));
        second.assert_async().await;
    }

    #[tokio::test]
    async fn returns_non_fallback_operation_error_when_key_fetch_returns_403() {
        let server = httpmock::MockServer::start_async().await;
        let playlist = format!(
            "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-KEY:METHOD=AES-128,URI=\"{}/enc.key\"\n#EXTINF:2,\n{}/seg-0.ts\n#EXT-X-ENDLIST\n",
            server.base_url(),
            server.base_url()
        );
        server
            .mock_async(move |when, then| {
                when.method(GET).path("/index.m3u8");
                then.status(200).body(playlist);
            })
            .await;
        server
            .mock_async(|when, then| {
                when.method(GET).path("/enc.key");
                then.status(403);
            })
            .await;

        let dir = tempdir().unwrap();
        let cancel = CancellationToken::new(Arc::new(AtomicBool::new(false)));
        let err = download_hls_media(
            HlsDownloadRequest {
                job_id: "job-403".into(),
                url: format!("{}/index.m3u8", server.base_url()),
                kind: MediaKind::Video,
                output_path: dir.path().join("out.tmp"),
            },
            "",
            SegmentDownloadConfig {
                concurrency: 4,
                retries: 0,
                request_timeout_secs: 30,
            },
            cancel,
            |_d, _t| {},
            None,
        )
        .await
        .unwrap_err();

        assert!(err.message().contains("获取解密密钥失败：HTTP 403"));
        assert!(!err.is_auto_fallback_eligible());
    }
}
