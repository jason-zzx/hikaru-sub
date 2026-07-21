use crate::hls_fetch::{download_url_to_file, fetch_key_bytes, parse_header_map, AesCbcParams};
use crate::hls_playlist::{plan_from_playlist_text, select_master_variant_url};
use crate::hls_types::{
    CancellationToken, HlsDownloadError, HlsDownloadRequest, HlsMediaPlan, HlsSupportError,
    MediaKind, SegmentDecryptInfo, SegmentDownloadConfig,
};
use futures::stream::{self, StreamExt};
use reqwest::header::HeaderMap;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use tokio::sync::Semaphore;

/// 预先取回播放列表用到的全部 AES-128 密钥（按 URL 去重缓存）。
async fn prefetch_keys(
    client: &reqwest::Client,
    plan: &HlsMediaPlan,
    headers: &HeaderMap,
) -> Result<HashMap<String, [u8; 16]>, HlsDownloadError> {
    let mut urls: HashSet<String> = HashSet::new();
    if let Some(init) = &plan.init {
        if let Some(decrypt) = &init.decrypt {
            urls.insert(decrypt.key_url.clone());
        }
    }
    for segment in &plan.segments {
        if let Some(decrypt) = &segment.decrypt {
            urls.insert(decrypt.key_url.clone());
        }
    }

    let mut cache = HashMap::with_capacity(urls.len());
    for url in urls {
        let key = fetch_key_bytes(client, &url, headers)
            .await
            .map_err(HlsDownloadError::Operation)?;
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
    pub temp_media_path: PathBuf,
    pub duration_ms: i64,
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

/// 临时 init 段文件名：`init.<原始扩展名>`。
fn init_file_name(url: &str) -> String {
    format!("init.{}", segment_extension(url))
}

pub fn segment_path(
    base_dir: &Path,
    job_id: &str,
    kind: MediaKind,
    index: usize,
    url: &str,
) -> PathBuf {
    hls_temp_root(base_dir, job_id)
        .join(media_dir_name(kind))
        .join(segment_file_name(index, url))
}

async fn fetch_playlist_text(
    client: &reqwest::Client,
    url: &str,
    headers: &reqwest::header::HeaderMap,
) -> Result<String, HlsSupportError> {
    client
        .get(url)
        .headers(headers.clone())
        .send()
        .await
        .map_err(|err| HlsSupportError::Network(err.to_string()))?
        .text()
        .await
        .map_err(|err| HlsSupportError::Network(err.to_string()))
}

async fn resolve_media_plan(
    client: &reqwest::Client,
    url: &str,
    headers: &reqwest::header::HeaderMap,
    kind: MediaKind,
) -> Result<HlsMediaPlan, HlsSupportError> {
    let mut current_url = url.to_string();
    let mut playlist_text = fetch_playlist_text(client, &current_url, headers).await?;

    if let Some(variant_url) = select_master_variant_url(&current_url, &playlist_text)? {
        current_url = variant_url;
        playlist_text = fetch_playlist_text(client, &current_url, headers).await?;
    }

    plan_from_playlist_text(&current_url, &playlist_text, kind)
}

pub fn build_hls_http_client(
    config: &SegmentDownloadConfig,
) -> Result<reqwest::Client, HlsDownloadError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(config.request_timeout_secs))
        .pool_max_idle_per_host(config.concurrency)
        .http2_adaptive_window(true)
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
    )
    .await
}

pub async fn download_hls_media_with_client(
    client: reqwest::Client,
    request: HlsDownloadRequest,
    headers: &str,
    config: SegmentDownloadConfig,
    cancel: CancellationToken,
    on_progress: impl Fn(i64, i64) + Send + Sync + 'static,
    shared_semaphore: Option<Arc<Semaphore>>,
) -> Result<HlsDownloadOutput, HlsDownloadError> {
    let header_map = parse_header_map(headers).map_err(HlsDownloadError::Operation)?;
    let plan = resolve_media_plan(&client, &request.url, &header_map, request.kind)
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
        "[hikaru][hls] 已生成分片计划 kind={:?} segments={} total_ms={} init={} init_encrypted={} encrypted_segments={} concurrency={}",
        request.kind,
        plan.segments.len(),
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
        cancel,
        on_progress,
        shared_semaphore,
    )
    .await?;

    assemble_media_file(&plan, &base_dir, &job_id, &temp_output)
        .await
        .map_err(HlsDownloadError::Operation)?;

    Ok(HlsDownloadOutput {
        temp_media_path: temp_output,
        duration_ms: plan.total_duration_ms,
    })
}

async fn download_plan(
    client: &reqwest::Client,
    plan: &HlsMediaPlan,
    header_map: &reqwest::header::HeaderMap,
    base_dir: &Path,
    job_id: &str,
    kind: MediaKind,
    config: SegmentDownloadConfig,
    cancel: CancellationToken,
    on_progress: impl Fn(i64, i64) + Send + Sync + 'static,
    shared_semaphore: Option<Arc<Semaphore>>,
) -> Result<(), HlsDownloadError> {
    let cancel_for_abort = cancel.clone();
    let keys = Arc::new(
        prefetch_keys(client, plan, header_map)
            .await
            .map_err(|err| {
                cancel_for_abort.cancel();
                err
            })?,
    );

    if let Some(init) = &plan.init {
        let init_path = hls_temp_root(base_dir, job_id)
            .join(media_dir_name(kind))
            .join(init_file_name(&init.url));
        let init_decrypt = resolve_decrypt_params(init.decrypt.as_ref(), &keys)
            .map_err(HlsDownloadError::Operation)?;
        download_url_to_file(
            client.clone(),
            &init.url,
            header_map.clone(),
            init.byte_range,
            &init_path,
            config.retries,
            cancel.clone(),
            init_decrypt,
        )
        .await
        .map_err(|err| {
            cancel_for_abort.cancel();
            HlsDownloadError::Operation(err)
        })?;
    }

    let total_duration_ms = plan.total_duration_ms;
    let completed_ms = Arc::new(AtomicI64::new(0));
    let progress = Arc::new(on_progress);
    let concurrency = config.concurrency.clamp(2, 32);
    let semaphore = shared_semaphore.unwrap_or_else(|| Arc::new(Semaphore::new(concurrency)));

    let mut downloads = stream::iter(plan.segments.clone())
        .map(|segment| {
            let client = client.clone();
            let headers = header_map.clone();
            let cancel = cancel.clone();
            let base_dir = base_dir.to_path_buf();
            let job_id = job_id.to_string();
            let completed_ms = completed_ms.clone();
            let progress = progress.clone();
            let semaphore = semaphore.clone();
            let keys = keys.clone();
            async move {
                if cancel.is_cancelled() {
                    return Err("下载已取消".to_string());
                }
                let _permit = semaphore
                    .acquire()
                    .await
                    .map_err(|_| "下载调度器已关闭".to_string())?;
                if cancel.is_cancelled() {
                    return Err("下载已取消".to_string());
                }
                let decrypt = resolve_decrypt_params(segment.decrypt.as_ref(), &keys)?;
                let path = segment_path(&base_dir, &job_id, kind, segment.index, &segment.url);
                download_url_to_file(
                    client,
                    &segment.url,
                    headers,
                    segment.byte_range,
                    &path,
                    config.retries,
                    cancel,
                    decrypt,
                )
                .await?;
                let done = completed_ms.fetch_add(segment.duration_ms, Ordering::SeqCst)
                    + segment.duration_ms;
                progress(done, total_duration_ms);
                Ok(())
            }
        })
        .buffer_unordered(concurrency);

    while let Some(result) = downloads.next().await {
        if let Err(err) = result {
            cancel_for_abort.cancel();
            return Err(HlsDownloadError::Operation(err));
        }
    }

    Ok(())
}

async fn append_file(output: &mut tokio::fs::File, input_path: PathBuf) -> Result<(), String> {
    let mut input = tokio::fs::File::open(input_path)
        .await
        .map_err(|err| err.to_string())?;
    tokio::io::copy(&mut input, output)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub async fn assemble_media_file(
    plan: &HlsMediaPlan,
    base_dir: &Path,
    job_id: &str,
    output_path: &Path,
) -> Result<(), String> {
    if let Some(parent) = output_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| err.to_string())?;
    }

    let media_dir = hls_temp_root(base_dir, job_id).join(media_dir_name(plan.kind));
    let mut output = tokio::fs::File::create(output_path)
        .await
        .map_err(|err| err.to_string())?;

    if let Some(init) = &plan.init {
        append_file(&mut output, media_dir.join(init_file_name(&init.url))).await?;
    }

    for segment in &plan.segments {
        append_file(
            &mut output,
            media_dir.join(segment_file_name(segment.index, &segment.url)),
        )
        .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hls_types::MediaExtensionHint;
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
            std::fs::read_to_string(result.temp_media_path).unwrap(),
            "seg0;seg1;seg2;seg3;"
        );
        assert!(completed.load(Ordering::SeqCst) >= 4);
    }

    #[tokio::test]
    async fn assemble_media_file_writes_init_before_segments() {
        let dir = tempdir().unwrap();
        let plan = HlsMediaPlan {
            kind: MediaKind::Video,
            init: Some(crate::hls_types::HlsInitSegment {
                url: "https://example.com/init.mp4".into(),
                byte_range: None,
                decrypt: None,
            }),
            segments: vec![
                crate::hls_types::HlsSegment {
                    index: 0,
                    url: "https://example.com/0.m4s".into(),
                    duration_ms: 1000,
                    byte_range: None,
                    decrypt: None,
                },
                crate::hls_types::HlsSegment {
                    index: 1,
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
        assert_eq!(init_file_name("https://x/init01.cmfa?s=1"), "init.cmfa");
    }

    #[tokio::test]
    async fn assemble_media_file_streams_large_segments_in_order() {
        let dir = tempdir().unwrap();
        let plan = HlsMediaPlan {
            kind: MediaKind::Video,
            init: Some(crate::hls_types::HlsInitSegment {
                url: "https://example.com/init.mp4".into(),
                byte_range: None,
                decrypt: None,
            }),
            segments: vec![
                crate::hls_types::HlsSegment {
                    index: 0,
                    url: "https://example.com/0.m4s".into(),
                    duration_ms: 1000,
                    byte_range: None,
                    decrypt: None,
                },
                crate::hls_types::HlsSegment {
                    index: 1,
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
}
