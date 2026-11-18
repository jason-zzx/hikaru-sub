use crate::hls_types::{
    ByteRange, HlsEpoch, HlsInitSegment, HlsMediaPlan, HlsSegment, HlsSupportError,
    MasterPlaylistSelection, MediaExtensionHint, MediaKind, SegmentDecryptInfo,
};
use m3u8_rs::{
    parse_playlist_res, AlternativeMediaType, Key, KeyMethod, MasterPlaylist, MediaPlaylist,
    Playlist, VariantStream,
};
use std::collections::HashMap;
use url::Url;

/// 解析后的当前活跃 AES-128 密钥（仅整段 CBC，方法为 AES-128 时存在）。
#[derive(Debug, Clone)]
struct ActiveKey {
    key_url: String,
    explicit_iv: Option<[u8; 16]>,
}

/// 把 `#EXT-X-KEY` 解析为活跃密钥；`METHOD=NONE` 返回 `Ok(None)` 表示关闭加密，
/// `SAMPLE-AES`/其他方法返回 `UnsupportedEncryption` 以触发兼容模式回退。
fn resolve_active_key(base: &Url, key: &Key) -> Result<Option<ActiveKey>, HlsSupportError> {
    match &key.method {
        KeyMethod::None => Ok(None),
        KeyMethod::AES128 => {
            let uri = key
                .uri
                .as_ref()
                .ok_or(HlsSupportError::UnsupportedEncryption)?;
            let key_url = base
                .join(uri)
                .map_err(|err| HlsSupportError::UrlResolve(err.to_string()))?
                .to_string();
            let explicit_iv = match key.iv.as_ref() {
                Some(raw) => Some(parse_iv_hex(raw)?),
                None => None,
            };
            Ok(Some(ActiveKey {
                key_url,
                explicit_iv,
            }))
        }
        KeyMethod::SampleAES | KeyMethod::Other(_) => Err(HlsSupportError::UnsupportedEncryption),
    }
}

/// 解析 `#EXT-X-KEY` 的 IV（形如 `0x...`），左侧补零到 16 字节。
fn parse_iv_hex(raw: &str) -> Result<[u8; 16], HlsSupportError> {
    let trimmed = raw.trim();
    let hexpart = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    if hexpart.len() > 32 {
        return Err(HlsSupportError::PlaylistParse(format!(
            "EXT-X-KEY IV 过长：{raw}"
        )));
    }
    let padded = format!("{hexpart:0>32}");
    let bytes = hex::decode(&padded)
        .map_err(|err| HlsSupportError::PlaylistParse(format!("无效的 EXT-X-KEY IV：{err}")))?;
    let mut iv = [0u8; 16];
    iv.copy_from_slice(&bytes);
    Ok(iv)
}

/// 未提供显式 IV 时，按 HLS 规范用分片媒体序号的 128-bit 大端表示作为 IV。
fn sequence_iv(sequence: u64) -> [u8; 16] {
    let mut iv = [0u8; 16];
    iv[8..16].copy_from_slice(&sequence.to_be_bytes());
    iv
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UrlByteRangeState {
    Fresh,
    Continuing(u64),
    Broken,
}

fn select_external_audio_url(
    base: &Url,
    variant: &VariantStream,
    master: &MasterPlaylist,
) -> Result<Option<String>, HlsSupportError> {
    let Some(audio_group) = variant.audio.as_ref() else {
        return Ok(None);
    };
    let group_entries: Vec<_> = master
        .alternatives
        .iter()
        .filter(|alt| alt.media_type == AlternativeMediaType::Audio && alt.group_id == *audio_group)
        .collect();
    if group_entries.is_empty() {
        return Ok(None);
    }

    // If a DEFAULT rendition explicitly has no URI, audio is muxed into the variant stream.
    let uri = if let Some(default_alt) = group_entries.iter().copied().find(|alt| alt.default) {
        default_alt.uri.as_deref()
    } else {
        group_entries
            .iter()
            .copied()
            .find(|alt| alt.autoselect && alt.uri.is_some())
            .or_else(|| group_entries.into_iter().find(|alt| alt.uri.is_some()))
            .and_then(|alt| alt.uri.as_deref())
    };
    uri.map(|u| base.join(u).map(|resolved| resolved.to_string()))
        .transpose()
        .map_err(|err| HlsSupportError::UrlResolve(err.to_string()))
}

fn resolve_init_byte_range(raw: &m3u8_rs::ByteRange) -> ByteRange {
    ByteRange {
        offset: raw.offset.unwrap_or(0),
        length: raw.length,
    }
}

fn resolve_segment_byte_range(
    url: &str,
    raw: &m3u8_rs::ByteRange,
    states: &mut HashMap<String, UrlByteRangeState>,
) -> Result<ByteRange, HlsSupportError> {
    let offset = match raw.offset {
        Some(explicit) => explicit,
        None => match states.get(url).copied().unwrap_or(UrlByteRangeState::Fresh) {
            UrlByteRangeState::Continuing(next) => next,
            UrlByteRangeState::Fresh => {
                return Err(HlsSupportError::UnsupportedByteRange(format!(
                    "URI {url} 的首个 byte-range 缺少显式 offset"
                )));
            }
            UrlByteRangeState::Broken => {
                return Err(HlsSupportError::UnsupportedByteRange(format!(
                    "URI {url} 在出现整段资源后无法继续推导 byte-range 偏移"
                )));
            }
        },
    };
    let resolved = ByteRange {
        offset,
        length: raw.length,
    };
    states.insert(
        url.to_string(),
        UrlByteRangeState::Continuing(offset.saturating_add(raw.length)),
    );
    Ok(resolved)
}

fn map_to_init(base: &Url, map: &m3u8_rs::Map) -> Result<HlsInitSegment, HlsSupportError> {
    let url = base
        .join(&map.uri)
        .map_err(|err| HlsSupportError::UrlResolve(err.to_string()))?
        .to_string();
    Ok(HlsInitSegment {
        url,
        byte_range: map.byte_range.as_ref().map(resolve_init_byte_range),
        decrypt: None,
    })
}

/// 若为主播放列表，返回最高带宽变体 URL 与可选的外挂音频轨 URL；否则返回 `None`。
pub fn select_master_streams(
    base_url: &str,
    playlist_text: &str,
) -> Result<Option<MasterPlaylistSelection>, HlsSupportError> {
    let base = Url::parse(base_url).map_err(|err| HlsSupportError::UrlResolve(err.to_string()))?;
    let parsed = parse_playlist_res(playlist_text.as_bytes())
        .map_err(|err| HlsSupportError::PlaylistParse(format!("{err:?}")))?;

    match parsed {
        Playlist::MasterPlaylist(master) => {
            let variant = master
                .variants
                .iter()
                .filter(|variant| !variant.is_i_frame)
                .max_by_key(|variant| variant.bandwidth)
                .ok_or(HlsSupportError::EmptyPlaylist)?;
            let audio_url = select_external_audio_url(&base, variant, &master)?;
            let video_url = base
                .join(&variant.uri)
                .map_err(|err| HlsSupportError::UrlResolve(err.to_string()))?
                .to_string();
            Ok(Some(MasterPlaylistSelection {
                video_url,
                audio_url,
            }))
        }
        Playlist::MediaPlaylist(_) => Ok(None),
    }
}

/// 按原文逐行记录每个 `#EXT-X-MAP:` 声明的 init 段是否处于 `METHOD=AES-128` 加密状态。
/// m3u8-rs 会丢失 KEY/MAP 的相对顺序，因此按原文顺序扫描（CMAF「MAP 在前、KEY 在后」即明文）。
fn map_encryption_flags(playlist_text: &str) -> Vec<bool> {
    let mut encrypting = false;
    let mut flags = Vec::new();
    for raw in playlist_text.lines() {
        let line = raw.trim_start();
        if let Some(rest) = line.strip_prefix("#EXT-X-KEY:") {
            encrypting = rest.contains("METHOD=AES-128");
        } else if line.starts_with("#EXT-X-MAP:") {
            flags.push(encrypting);
        }
    }
    flags
}

pub fn plan_from_playlist_text(
    base_url: &str,
    playlist_text: &str,
    kind: MediaKind,
) -> Result<HlsMediaPlan, HlsSupportError> {
    let base = Url::parse(base_url).map_err(|err| HlsSupportError::UrlResolve(err.to_string()))?;
    let parsed = parse_playlist_res(playlist_text.as_bytes())
        .map_err(|err| HlsSupportError::PlaylistParse(format!("{err:?}")))?;
    let map_encrypted_flags = map_encryption_flags(playlist_text);

    match parsed {
        Playlist::MediaPlaylist(media) => {
            plan_from_media_playlist(&base, media, kind, &map_encrypted_flags)
        }
        Playlist::MasterPlaylist(_) => Err(HlsSupportError::PlaylistParse(
            "master playlist must be resolved before planning".into(),
        )),
    }
}

fn plan_from_media_playlist(
    base: &Url,
    media: MediaPlaylist,
    kind: MediaKind,
    map_encrypted_flags: &[bool],
) -> Result<HlsMediaPlan, HlsSupportError> {
    if !media.end_list {
        return Err(HlsSupportError::LivePlaylist);
    }
    if media.segments.is_empty() {
        return Err(HlsSupportError::EmptyPlaylist);
    }

    let mut segments = Vec::with_capacity(media.segments.len());
    let mut epochs: Vec<HlsEpoch> = Vec::new();
    let mut current_epoch_has_segments = false;
    let mut total_duration_ms = 0_i64;
    let mut byte_range_states: HashMap<String, UrlByteRangeState> = HashMap::new();
    // m3u8-rs 仅把 #EXT-X-KEY / #EXT-X-MAP 关联到其后第一个分片，随后重置；
    // 这里手动让活跃密钥和 init 段向后传播，并在 discontinuity 或新 MAP 时切分 epoch。
    let mut active_key: Option<ActiveKey> = None;
    let mut current_init: Option<HlsInitSegment> = None;
    let mut map_cursor = 0_usize;

    for (index, segment) in media.segments.iter().enumerate() {
        // m3u8-rs 6.0.0 rejects `#EXT-X-KEY:METHOD=NONE` without IV into `unknown_tags`.
        let has_key_none = segment.unknown_tags.iter().any(|tag| {
            tag.tag == "X-KEY"
                && tag
                    .rest
                    .as_deref()
                    .is_some_and(|rest| rest.contains("METHOD=NONE"))
        });
        if let Some(key) = segment.key.as_ref() {
            active_key = resolve_active_key(base, key)?;
        } else if has_key_none {
            active_key = None;
        }

        let mut new_map_seen = false;
        if let Some(map) = segment.map.as_ref() {
            let mut init_segment = map_to_init(base, map)?;
            let init_encrypted = map_encrypted_flags.get(map_cursor).copied().unwrap_or(false);
            map_cursor += 1;
            // 仅当 KEY 出现在该 MAP 之前（init_encrypted）才解密 init；
            // CMAF 常见「MAP 在前、KEY 在后」时 init 为明文，切勿解密以免损坏。
            // 规范同时要求加密的 init 必须带显式 IV。
            if init_encrypted {
                if let Some(ak) = active_key.as_ref() {
                    if let Some(iv) = ak.explicit_iv {
                        init_segment.decrypt = Some(SegmentDecryptInfo {
                            key_url: ak.key_url.clone(),
                            iv,
                        });
                    }
                }
            }
            current_init = Some(init_segment);
            new_map_seen = true;
        }

        if epochs.is_empty()
            || segment.discontinuity
            || (new_map_seen && current_epoch_has_segments)
        {
            let epoch_index = epochs.len();
            epochs.push(HlsEpoch {
                index: epoch_index,
                init: current_init.clone(),
            });
        }

        let epoch_index = epochs.len() - 1;
        let url = base
            .join(&segment.uri)
            .map_err(|err| HlsSupportError::UrlResolve(err.to_string()))?
            .to_string();
        let duration_ms = (segment.duration * 1000.0).round() as i64;
        total_duration_ms += duration_ms;

        let byte_range = if let Some(raw) = segment.byte_range.as_ref() {
            Some(resolve_segment_byte_range(
                &url,
                raw,
                &mut byte_range_states,
            )?)
        } else {
            byte_range_states.insert(url.clone(), UrlByteRangeState::Broken);
            None
        };

        let decrypt = active_key.as_ref().map(|ak| {
            let sequence = media.media_sequence + index as u64;
            let iv = ak.explicit_iv.unwrap_or_else(|| sequence_iv(sequence));
            SegmentDecryptInfo {
                key_url: ak.key_url.clone(),
                iv,
            }
        });

        segments.push(HlsSegment {
            index,
            epoch_index,
            url,
            duration_ms,
            byte_range,
            decrypt,
        });
        current_epoch_has_segments = true;
    }

    let init = epochs.first().and_then(|e| e.init.clone());
    let output_extension_hint = if init.is_some()
        || epochs.iter().any(|e| e.init.is_some())
        || segments
            .iter()
            .any(|segment| segment.url.contains(".mp4") || segment.url.contains(".m4s"))
    {
        MediaExtensionHint::Mp4
    } else if kind == MediaKind::Audio {
        MediaExtensionHint::M4a
    } else {
        MediaExtensionHint::Ts
    };

    Ok(HlsMediaPlan {
        kind,
        init,
        epochs,
        segments,
        total_duration_ms,
        output_extension_hint,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hls_types::ByteRange;

    #[test]
    fn plans_vod_media_playlist_with_relative_segments() {
        let playlist = r#"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXTINF:4.000,
seg-000.ts
#EXTINF:3.500,
../seg-001.ts?token=a
#EXT-X-ENDLIST
"#;

        let plan = plan_from_playlist_text(
            "https://cdn.example.com/path/index.m3u8",
            playlist,
            MediaKind::Video,
        )
        .expect("playlist should be supported");

        assert_eq!(plan.kind, MediaKind::Video);
        assert_eq!(plan.total_duration_ms, 7500);
        assert_eq!(plan.output_extension_hint, MediaExtensionHint::Ts);
        assert_eq!(plan.segments.len(), 2);
        assert_eq!(
            plan.segments[0].url,
            "https://cdn.example.com/path/seg-000.ts"
        );
        assert_eq!(
            plan.segments[1].url,
            "https://cdn.example.com/seg-001.ts?token=a"
        );
    }

    #[test]
    fn plans_fmp4_init_map_and_byte_ranges() {
        let playlist = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"
#EXTINF:2.000,
#EXT-X-BYTERANGE:1000@720
media.mp4
#EXTINF:2.000,
#EXT-X-BYTERANGE:1100
media.mp4
#EXT-X-ENDLIST
"#;

        let plan = plan_from_playlist_text(
            "https://cdn.example.com/a/stream.m3u8",
            playlist,
            MediaKind::Audio,
        )
        .expect("fMP4 playlist should be supported");

        assert_eq!(plan.output_extension_hint, MediaExtensionHint::Mp4);
        assert_eq!(
            plan.init.as_ref().unwrap().url,
            "https://cdn.example.com/a/init.mp4"
        );
        assert_eq!(
            plan.init.as_ref().unwrap().byte_range,
            Some(ByteRange {
                offset: 0,
                length: 720,
            })
        );
        assert_eq!(
            plan.segments[0].byte_range,
            Some(ByteRange {
                offset: 720,
                length: 1000,
            })
        );
        assert_eq!(
            plan.segments[1].byte_range,
            Some(ByteRange {
                offset: 1720,
                length: 1100,
            })
        );
    }

    #[test]
    fn rejects_first_implicit_byte_range_without_explicit_offset() {
        let playlist = r#"#EXTM3U
#EXT-X-VERSION:7
#EXTINF:2.000,
#EXT-X-BYTERANGE:1100
media.mp4
#EXT-X-ENDLIST
"#;

        let err = plan_from_playlist_text(
            "https://cdn.example.com/a/stream.m3u8",
            playlist,
            MediaKind::Audio,
        )
        .unwrap_err();

        assert!(matches!(err, HlsSupportError::UnsupportedByteRange(_)));
    }

    #[test]
    fn rejects_implicit_byte_range_after_full_segment_on_same_uri() {
        let playlist = r#"#EXTM3U
#EXT-X-VERSION:7
#EXTINF:2.000,
media.mp4
#EXTINF:2.000,
#EXT-X-BYTERANGE:1100
media.mp4
#EXT-X-ENDLIST
"#;

        let err = plan_from_playlist_text(
            "https://cdn.example.com/a/stream.m3u8",
            playlist,
            MediaKind::Audio,
        )
        .unwrap_err();

        assert!(matches!(err, HlsSupportError::UnsupportedByteRange(_)));
    }

    #[test]
    fn rejects_live_playlist_without_endlist() {
        let playlist = r#"#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4,
seg-000.ts
"#;

        let err = plan_from_playlist_text(
            "https://cdn.example.com/live.m3u8",
            playlist,
            MediaKind::Video,
        )
        .unwrap_err();

        assert_eq!(err, HlsSupportError::LivePlaylist);
    }

    #[test]
    fn plans_aes128_playlist_with_carry_forward_key_and_sequence_iv() {
        // 单个 EXT-X-KEY（无显式 IV）应对全部分片生效，IV 取媒体序号。
        let playlist = r#"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-KEY:METHOD=AES-128,URI="enc.key"
#EXTINF:4,
seg-000.ts
#EXTINF:4,
seg-001.ts
#EXT-X-ENDLIST
"#;

        let plan = plan_from_playlist_text(
            "https://cdn.example.com/enc/index.m3u8",
            playlist,
            MediaKind::Video,
        )
        .expect("AES-128 playlist should now be supported");

        assert_eq!(plan.segments.len(), 2);
        let key_url = "https://cdn.example.com/enc/enc.key";
        let d0 = plan.segments[0].decrypt.as_ref().expect("seg0 encrypted");
        assert_eq!(d0.key_url, key_url);
        assert_eq!(d0.iv, sequence_iv(0));
        // 第二个分片没有自身 EXT-X-KEY，密钥应向后传播。
        let d1 = plan.segments[1].decrypt.as_ref().expect("seg1 encrypted");
        assert_eq!(d1.key_url, key_url);
        assert_eq!(d1.iv, sequence_iv(1));
    }

    #[test]
    fn plans_aes128_playlist_with_explicit_iv() {
        let playlist = r#"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x000102030405060708090A0B0C0D0E0F
#EXTINF:4,
seg-000.ts
#EXTINF:4,
seg-001.ts
#EXT-X-ENDLIST
"#;

        let plan = plan_from_playlist_text(
            "https://cdn.example.com/enc/index.m3u8",
            playlist,
            MediaKind::Video,
        )
        .expect("AES-128 playlist with explicit IV should be supported");

        let expected_iv = [
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D,
            0x0E, 0x0F,
        ];
        assert_eq!(plan.segments[0].decrypt.as_ref().unwrap().iv, expected_iv);
        // 显式 IV 对所有分片相同。
        assert_eq!(plan.segments[1].decrypt.as_ref().unwrap().iv, expected_iv);
    }

    #[test]
    fn decrypts_encrypted_fmp4_init_only_with_explicit_iv() {
        let playlist = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x00000000000000000000000000000001
#EXT-X-MAP:URI="init.mp4"
#EXTINF:2.000,
seg-000.m4s
#EXT-X-ENDLIST
"#;

        let plan = plan_from_playlist_text(
            "https://cdn.example.com/enc/index.m3u8",
            playlist,
            MediaKind::Video,
        )
        .expect("encrypted fMP4 with explicit IV should be supported");

        let init = plan.init.as_ref().expect("init present");
        let init_decrypt = init.decrypt.as_ref().expect("init should be decrypted");
        assert_eq!(init_decrypt.key_url, "https://cdn.example.com/enc/enc.key");
    }

    #[test]
    fn keeps_init_clear_when_key_has_no_explicit_iv() {
        let playlist = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-KEY:METHOD=AES-128,URI="enc.key"
#EXT-X-MAP:URI="init.mp4"
#EXTINF:2.000,
seg-000.m4s
#EXT-X-ENDLIST
"#;

        let plan = plan_from_playlist_text(
            "https://cdn.example.com/enc/index.m3u8",
            playlist,
            MediaKind::Video,
        )
        .expect("playlist should be supported");

        // 无显式 IV：按规范 init 不应被解密，避免损坏明文 init。
        assert!(plan.init.as_ref().unwrap().decrypt.is_none());
        // 媒体分片仍按序号 IV 解密。
        assert!(plan.segments[0].decrypt.is_some());
    }

    #[test]
    fn keeps_init_clear_when_key_appears_after_map() {
        // Niconico domand 模式：MAP 在前、KEY 在后（且带显式 IV）。
        // 规范上 KEY 不适用于此 MAP，init 应保持明文；媒体分片仍解密。
        let playlist = r#"#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:1
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="init01.cmfv"
#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0xABCBA327E5A7081CCA09878BFE1F120A
#EXTINF:6.006,
01.cmfv
#EXTINF:6.006,
02.cmfv
#EXT-X-ENDLIST
"#;

        let plan = plan_from_playlist_text(
            "https://cdn.example.com/enc/index.m3u8",
            playlist,
            MediaKind::Video,
        )
        .expect("domand-style playlist should be supported");

        assert!(
            plan.init.as_ref().unwrap().decrypt.is_none(),
            "init 在 KEY 位于 MAP 之后时应保持明文"
        );
        let expected_iv = [
            0xAB, 0xCB, 0xA3, 0x27, 0xE5, 0xA7, 0x08, 0x1C, 0xCA, 0x09, 0x87, 0x8B, 0xFE, 0x1F,
            0x12, 0x0A,
        ];
        let d0 = plan.segments[0].decrypt.as_ref().expect("seg0 encrypted");
        assert_eq!(d0.iv, expected_iv);
        assert_eq!(d0.key_url, "https://cdn.example.com/enc/enc.key");
        assert_eq!(plan.segments[1].decrypt.as_ref().unwrap().iv, expected_iv);
    }

    #[test]
    fn rejects_sample_aes_playlist() {
        let playlist = r#"#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"
#EXTINF:4,
seg-000.ts
#EXT-X-ENDLIST
"#;

        let err = plan_from_playlist_text(
            "https://cdn.example.com/enc.m3u8",
            playlist,
            MediaKind::Video,
        )
        .unwrap_err();

        assert_eq!(err, HlsSupportError::UnsupportedEncryption);
    }

    #[test]
    fn selects_highest_bandwidth_variant_from_master() {
        let playlist = r#"#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
high/index.m3u8
"#;

        let selection = select_master_streams("https://cdn.example.com/master.m3u8", playlist)
            .unwrap()
            .unwrap();

        assert_eq!(
            selection.video_url,
            "https://cdn.example.com/high/index.m3u8"
        );
        assert_eq!(selection.audio_url, None);
    }

    #[test]
    fn selects_external_audio_rendition_from_master() {
        let playlist = r#"#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="alt",AUTOSELECT=YES,URI="audio/alt.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="main",DEFAULT=YES,URI="audio/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,AUDIO="audio"
video/index.m3u8
"#;

        let selection = select_master_streams("https://cdn.example.com/master.m3u8", playlist)
            .unwrap()
            .unwrap();

        assert_eq!(
            selection.video_url,
            "https://cdn.example.com/video/index.m3u8"
        );
        assert_eq!(
            selection.audio_url.as_deref(),
            Some("https://cdn.example.com/audio/index.m3u8")
        );
    }

    #[test]
    fn plans_vod_discontinuity_epochs_with_multiple_maps_and_keys() {
        let playlist = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA-SEQUENCE:10
#EXT-X-MAP:URI="init0.mp4"
#EXT-X-KEY:METHOD=AES-128,URI="k0.key"
#EXTINF:4.000,
seg-0.m4s
#EXT-X-DISCONTINUITY
#EXT-X-KEY:METHOD=NONE
#EXT-X-MAP:URI="init1.mp4"
#EXTINF:3.000,
seg-1.m4s
#EXT-X-DISCONTINUITY
#EXT-X-KEY:METHOD=AES-128,URI="k2.key",IV=0x00000000000000000000000000000002
#EXT-X-MAP:URI="init2.mp4"
#EXTINF:2.000,
seg-2.m4s
#EXT-X-ENDLIST
"#;

        let plan = plan_from_playlist_text(
            "https://cdn.example.com/vod/index.m3u8",
            playlist,
            MediaKind::Video,
        )
        .expect("VOD discontinuity playlist should be supported");

        assert_eq!(plan.epochs.len(), 3);
        assert_eq!(
            plan.epochs[0].init.as_ref().unwrap().url,
            "https://cdn.example.com/vod/init0.mp4"
        );
        assert!(plan.epochs[0].init.as_ref().unwrap().decrypt.is_none());
        assert_eq!(
            plan.epochs[1].init.as_ref().unwrap().url,
            "https://cdn.example.com/vod/init1.mp4"
        );
        assert!(plan.epochs[1].init.as_ref().unwrap().decrypt.is_none());
        assert_eq!(
            plan.epochs[2].init.as_ref().unwrap().url,
            "https://cdn.example.com/vod/init2.mp4"
        );
        assert!(plan.epochs[2].init.as_ref().unwrap().decrypt.is_some());

        assert_eq!(plan.segments.len(), 3);
        assert_eq!(plan.segments[0].epoch_index, 0);
        assert_eq!(plan.segments[0].decrypt.as_ref().unwrap().iv, sequence_iv(10));
        assert_eq!(plan.segments[1].epoch_index, 1);
        assert!(plan.segments[1].decrypt.is_none());
        assert_eq!(plan.segments[2].epoch_index, 2);
        assert!(plan.segments[2].decrypt.is_some());
    }
}
