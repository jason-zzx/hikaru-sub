use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadStrategy {
    Auto,
    Segments,
    Ffmpeg,
}

impl Default for DownloadStrategy {
    fn default() -> Self {
        Self::Auto
    }
}

impl DownloadStrategy {
    pub fn parse(input: Option<&str>) -> Self {
        match input.unwrap_or("auto") {
            "segments" => Self::Segments,
            "ffmpeg" => Self::Ffmpeg,
            _ => Self::Auto,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaExtensionHint {
    Mp4,
    M4a,
    Ts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    pub offset: u64,
    pub length: u64,
}

/// AES-128-CBC 解密信息（每个分片独立 IV，规划阶段确定）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentDecryptInfo {
    /// 已解析为绝对地址的密钥 URL。
    pub key_url: String,
    /// 16 字节初始化向量。
    pub iv: [u8; 16],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MasterPlaylistSelection {
    pub video_url: String,
    pub audio_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HlsInitSegment {
    pub url: String,
    pub byte_range: Option<ByteRange>,
    pub decrypt: Option<SegmentDecryptInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HlsEpoch {
    pub index: usize,
    pub init: Option<HlsInitSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HlsSegment {
    pub index: usize,
    pub epoch_index: usize,
    pub url: String,
    pub duration_ms: i64,
    pub byte_range: Option<ByteRange>,
    pub decrypt: Option<SegmentDecryptInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HlsMediaPlan {
    pub kind: MediaKind,
    pub init: Option<HlsInitSegment>,
    pub epochs: Vec<HlsEpoch>,
    pub segments: Vec<HlsSegment>,
    pub total_duration_ms: i64,
    pub output_extension_hint: MediaExtensionHint,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssembledMedia {
    SingleFile(PathBuf),
    ConcatList(PathBuf),
}

#[derive(Debug, Clone)]
pub struct HlsDownloadRequest {
    pub job_id: String,
    pub url: String,
    pub kind: MediaKind,
    pub output_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct SegmentDownloadConfig {
    pub concurrency: usize,
    pub retries: usize,
    pub request_timeout_secs: u64,
}

impl Default for SegmentDownloadConfig {
    fn default() -> Self {
        Self {
            concurrency: MIN_AUTO_CONCURRENCY,
            retries: 3,
            request_timeout_secs: 30,
        }
    }
}

const MIN_AUTO_CONCURRENCY: usize = 24;
const MAX_AUTO_CONCURRENCY: usize = 48;

pub fn auto_concurrency_for_parallelism(parallelism: usize) -> usize {
    parallelism
        .saturating_mul(3)
        .clamp(MIN_AUTO_CONCURRENCY, MAX_AUTO_CONCURRENCY)
}

impl SegmentDownloadConfig {
    pub fn automatic() -> Self {
        let parallelism = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(MIN_AUTO_CONCURRENCY);

        Self {
            concurrency: auto_concurrency_for_parallelism(parallelism),
            retries: 3,
            request_timeout_secs: 30,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_concurrency_clamps_low_parallelism_to_minimum() {
        assert_eq!(auto_concurrency_for_parallelism(1), 24);
        assert_eq!(auto_concurrency_for_parallelism(4), 24);
        assert_eq!(auto_concurrency_for_parallelism(8), 24);
    }

    #[test]
    fn auto_concurrency_scales_for_typical_machines() {
        assert_eq!(auto_concurrency_for_parallelism(10), 30);
        assert_eq!(auto_concurrency_for_parallelism(12), 36);
    }

    #[test]
    fn auto_concurrency_clamps_high_parallelism_to_maximum() {
        assert_eq!(auto_concurrency_for_parallelism(16), 48);
        assert_eq!(auto_concurrency_for_parallelism(64), 48);
    }

    #[test]
    fn automatic_config_uses_auto_concurrency_and_existing_retry_defaults() {
        let config = SegmentDownloadConfig::automatic();
        assert!((24..=48).contains(&config.concurrency));
        assert_eq!(config.retries, 3);
        assert_eq!(config.request_timeout_secs, 30);
    }
}

#[derive(Clone)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new(cancelled: Arc<AtomicBool>) -> Self {
        Self { cancelled }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn cancel(&self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HlsSupportError {
    LivePlaylist,
    UnsupportedEncryption,
    UnsupportedByteRange(String),
    PlaylistParse(String),
    UrlResolve(String),
    EmptyPlaylist,
    Network(String),
}

impl HlsSupportError {
    pub fn user_message(&self) -> String {
        match self {
            HlsSupportError::LivePlaylist => "不支持直播 m3u8，请使用兼容模式".into(),
            HlsSupportError::UnsupportedEncryption => {
                "检测到加密分片，当前快速模式暂不支持，请使用兼容模式".into()
            }
            HlsSupportError::UnsupportedByteRange(detail) => {
                format!("无法解析 byte-range 分片：{detail}，请使用兼容模式")
            }
            HlsSupportError::PlaylistParse(err) => format!("m3u8 解析失败：{err}"),
            HlsSupportError::UrlResolve(err) => format!("m3u8 URL 解析失败：{err}"),
            HlsSupportError::EmptyPlaylist => "m3u8 中没有可下载分片".into(),
            HlsSupportError::Network(err) => format!("m3u8 获取失败：{err}"),
        }
    }

    pub fn is_fallback_eligible(&self) -> bool {
        matches!(
            self,
            HlsSupportError::LivePlaylist
                | HlsSupportError::UnsupportedEncryption
                | HlsSupportError::UnsupportedByteRange(_)
                | HlsSupportError::EmptyPlaylist
                | HlsSupportError::PlaylistParse(_)
                | HlsSupportError::UrlResolve(_)
                | HlsSupportError::Network(_)
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HlsDownloadError {
    Plan(HlsSupportError),
    Operation(String),
    RemuxFallback(String),
}

impl HlsDownloadError {
    pub fn message(&self) -> String {
        match self {
            HlsDownloadError::Plan(err) => err.user_message(),
            HlsDownloadError::Operation(msg) | HlsDownloadError::RemuxFallback(msg) => msg.clone(),
        }
    }

    pub fn is_auto_fallback_eligible(&self) -> bool {
        matches!(self, HlsDownloadError::Plan(err) if err.is_fallback_eligible())
            || matches!(self, HlsDownloadError::RemuxFallback(_))
    }
}
