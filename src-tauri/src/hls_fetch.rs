use crate::hls_types::{ByteRange, CancellationToken};
use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, RANGE, USER_AGENT};
use reqwest::StatusCode;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;

pub const DEFAULT_HLS_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DEFAULT_SEGMENT_MEMORY_BUFFER_LIMIT: usize = 32 * 1024 * 1024;
const SPILL_WRITER_CAPACITY: usize = 512 * 1024;

pub fn build_get_request(
    client: &reqwest::Client,
    url: &str,
    headers: &HeaderMap,
) -> reqwest::RequestBuilder {
    let mut request = client.get(url).headers(headers.clone());
    if !headers.contains_key(USER_AGENT) {
        request = request.header(USER_AGENT, HeaderValue::from_static(DEFAULT_HLS_USER_AGENT));
    }
    request
}

/// AES-128-CBC 整段解密参数（密钥已取回、IV 已在规划阶段确定）。
#[derive(Debug, Clone, Copy)]
pub struct AesCbcParams {
    pub key: [u8; 16],
    pub iv: [u8; 16],
}

/// 取回 AES-128 密钥（应为 16 字节）。
pub async fn fetch_key_bytes(
    client: &reqwest::Client,
    key_url: &str,
    headers: &HeaderMap,
) -> Result<[u8; 16], String> {
    let response = build_get_request(client, key_url, headers)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "获取解密密钥失败：HTTP {}",
            response.status().as_u16()
        ));
    }
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    if bytes.len() != 16 {
        return Err(format!(
            "解密密钥长度应为 16 字节，实际 {} 字节",
            bytes.len()
        ));
    }
    let mut key = [0u8; 16];
    key.copy_from_slice(&bytes);
    Ok(key)
}

/// 原地 AES-128-CBC 解密；优先按 PKCS7 去填充，失败再保留原文以兼容个别不规范流。
fn aes128_cbc_decrypt(mut data: Vec<u8>, params: &AesCbcParams) -> Result<Vec<u8>, String> {
    use aes::Aes128;
    use cbc::cipher::block_padding::{NoPadding, Pkcs7, RawPadding};
    use cbc::cipher::{BlockDecryptMut, KeyIvInit};
    type Aes128CbcDec = cbc::Decryptor<Aes128>;

    if data.is_empty() {
        return Ok(Vec::new());
    }
    if data.len() % 16 != 0 {
        return Err(format!("加密分片长度 {} 不是 16 的倍数", data.len()));
    }

    Aes128CbcDec::new(&params.key.into(), &params.iv.into())
        .decrypt_padded_mut::<NoPadding>(&mut data)
        .map_err(|err| format!("AES-128 解密失败：{err}"))?;

    let last_block_start = data.len() - 16;
    if let Ok(unpadded) = Pkcs7::raw_unpad(&data[last_block_start..]) {
        let trim = 16 - unpadded.len();
        data.truncate(data.len() - trim);
    }
    Ok(data)
}

pub fn parse_header_map(headers: &str) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for raw in headers.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| format!("请求头格式无效（需包含冒号）：{line}"))?;
        map.insert(
            HeaderName::from_bytes(name.trim().as_bytes()).map_err(|err| err.to_string())?,
            HeaderValue::from_str(value.trim()).map_err(|err| err.to_string())?,
        );
    }
    Ok(map)
}

pub fn range_header_value(range: ByteRange) -> String {
    let end = range.offset + range.length.saturating_sub(1);
    format!("bytes={}-{}", range.offset, end)
}

async fn write_response_stream_buffered(
    response: reqwest::Response,
    output_path: &Path,
    expected_len: Option<u64>,
    cancel: &CancellationToken,
    decrypt: Option<AesCbcParams>,
    downloaded_bytes: Option<&Arc<AtomicU64>>,
    memory_limit: usize,
) -> Result<u64, String> {
    let initial_cap = expected_len
        .or_else(|| response.content_length())
        .map(|len| (len as usize).min(memory_limit))
        .unwrap_or(0);
    let mut buffer = Vec::with_capacity(initial_cap);
    let mut spill: Option<tokio::io::BufWriter<tokio::fs::File>> = None;
    let mut received = 0_u64;
    let mut stream = response.bytes_stream();

    let stream_res: Result<(), String> = async {
        while let Some(chunk_res) = stream.next().await {
            if cancel.is_cancelled() {
                return Err("下载已取消".into());
            }
            let chunk = chunk_res.map_err(|err| err.to_string())?;
            let chunk_len = chunk.len() as u64;
            received += chunk_len;
            if let Some(counter) = downloaded_bytes {
                counter.fetch_add(chunk_len, Ordering::Relaxed);
            }

            if let Some(writer) = spill.as_mut() {
                writer
                    .write_all(&chunk)
                    .await
                    .map_err(|err| err.to_string())?;
            } else if decrypt.is_none() && buffer.len() + chunk.len() > memory_limit {
                let file = tokio::fs::File::create(output_path)
                    .await
                    .map_err(|err| err.to_string())?;
                let mut writer = tokio::io::BufWriter::with_capacity(SPILL_WRITER_CAPACITY, file);
                if !buffer.is_empty() {
                    writer
                        .write_all(&buffer)
                        .await
                        .map_err(|err| err.to_string())?;
                    buffer = Vec::new();
                }
                writer
                    .write_all(&chunk)
                    .await
                    .map_err(|err| err.to_string())?;
                spill = Some(writer);
            } else {
                buffer.extend_from_slice(&chunk);
            }
        }

        if cancel.is_cancelled() {
            return Err("下载已取消".into());
        }
        if let Some(expected) = expected_len {
            if received != expected {
                return Err(format!("期望 {expected} 字节，实际 {received} 字节"));
            }
        }
        if let Some(writer) = spill.as_mut() {
            writer.flush().await.map_err(|err| err.to_string())?;
            writer.shutdown().await.map_err(|err| err.to_string())?;
        }
        Ok(())
    }
    .await;

    if let Some(writer) = spill {
        let std_file = writer.into_inner().into_std().await;
        drop(std_file);
        if let Err(err) = stream_res {
            let _ = tokio::fs::remove_file(output_path).await;
            return Err(err);
        }
        return Ok(received);
    }
    stream_res?;

    let path = output_path.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<u64, String> {
        let payload = match decrypt {
            Some(params) => aes128_cbc_decrypt(buffer, &params)?,
            None => buffer,
        };
        std::fs::write(&path, &payload).map_err(|err| err.to_string())?;
        Ok(payload.len() as u64)
    })
    .await
    .map_err(|err| format!("写入分片任务异常退出：{err}"))?
}

#[cfg(test)]
pub async fn download_url_to_file(
    client: reqwest::Client,
    url: &str,
    headers: HeaderMap,
    byte_range: Option<ByteRange>,
    output_path: &Path,
    retries: usize,
    cancel: CancellationToken,
    decrypt: Option<AesCbcParams>,
) -> Result<u64, String> {
    download_url_to_file_with_options(
        client,
        url,
        headers,
        byte_range,
        output_path,
        retries,
        cancel,
        decrypt,
        true,
        None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn download_url_to_file_with_options(
    client: reqwest::Client,
    url: &str,
    headers: HeaderMap,
    byte_range: Option<ByteRange>,
    output_path: &Path,
    retries: usize,
    cancel: CancellationToken,
    decrypt: Option<AesCbcParams>,
    ensure_parent_dir: bool,
    downloaded_bytes: Option<Arc<AtomicU64>>,
) -> Result<u64, String> {
    if ensure_parent_dir {
        if let Some(parent) = output_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|err| err.to_string())?;
        }
    }

    let mut attempt = 0_usize;
    loop {
        if cancel.is_cancelled() {
            return Err("下载已取消".into());
        }

        let mut request = build_get_request(&client, url, &headers);
        if let Some(range) = byte_range {
            request = request.header(RANGE, range_header_value(range));
        }

        let result = async {
            let response = request.send().await.map_err(|err| err.to_string())?;
            let status = response.status();
            let expected_len = match byte_range {
                Some(_) if status != StatusCode::PARTIAL_CONTENT => {
                    return Err(format!(
                        "期望 HTTP 206 Partial Content，实际 HTTP {}",
                        status.as_u16()
                    ));
                }
                Some(range) => Some(range.length),
                None if !status.is_success() => return Err(format!("HTTP {}", status.as_u16())),
                None => None,
            };

            write_response_stream_buffered(
                response,
                output_path,
                expected_len,
                &cancel,
                decrypt,
                downloaded_bytes.as_ref(),
                DEFAULT_SEGMENT_MEMORY_BUFFER_LIMIT,
            )
            .await
        }
        .await;

        match result {
            Ok(bytes) => return Ok(bytes),
            Err(_err) if attempt < retries => {
                attempt += 1;
                let delay_ms = (250_u64 * 2_u64.pow(attempt as u32)).min(5000);
                let mut remaining = delay_ms;
                while remaining > 0 {
                    if cancel.is_cancelled() {
                        return Err("下载已取消".into());
                    }
                    let step = remaining.min(100);
                    tokio::time::sleep(std::time::Duration::from_millis(step)).await;
                    remaining -= step;
                }
            }
            Err(err) => {
                if attempt >= retries {
                    return Err(format!("分片下载失败：重试 {retries} 次后仍失败（{err}）"));
                }
                return Err(format!("分片下载失败：{err}"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use tempfile::tempdir;

    #[test]
    fn parses_multiline_headers() {
        let headers =
            parse_header_map("Referer: https://example.com/watch\nUser-Agent: Hikaru\nCookie: a=b")
                .unwrap();

        assert_eq!(headers.get("referer").unwrap(), "https://example.com/watch");
        assert_eq!(headers.get("user-agent").unwrap(), "Hikaru");
        assert_eq!(headers.get("cookie").unwrap(), "a=b");
    }

    #[test]
    fn formats_range_header() {
        assert_eq!(
            range_header_value(ByteRange {
                offset: 720,
                length: 1000,
            }),
            "bytes=720-1719"
        );
        assert_eq!(
            range_header_value(ByteRange {
                offset: 1720,
                length: 1100,
            }),
            "bytes=1720-2819"
        );
    }

    #[tokio::test]
    async fn downloads_url_to_file_with_custom_headers() {
        let server = httpmock::MockServer::start_async().await;
        let media = server
            .mock_async(|when, then| {
                when.method("GET").path("/seg.ts").header("cookie", "a=b");
                then.status(200).body("segment-bytes");
            })
            .await;
        let dir = tempdir().unwrap();
        let out = dir.path().join("seg.ts");
        let headers = parse_header_map("Cookie: a=b").unwrap();
        let cancel = CancellationToken::new(Arc::new(AtomicBool::new(false)));

        let bytes = download_url_to_file(
            reqwest::Client::new(),
            &format!("{}/seg.ts", server.base_url()),
            headers,
            None,
            &out,
            0,
            cancel,
            None,
        )
        .await
        .unwrap();

        media.assert_async().await;
        assert_eq!(bytes, "segment-bytes".len() as u64);
        assert_eq!(std::fs::read(&out).unwrap(), b"segment-bytes");
    }

    #[tokio::test]
    async fn sends_range_header_for_byte_range() {
        let server = httpmock::MockServer::start_async().await;
        let media = server
            .mock_async(|when, then| {
                when.method("GET")
                    .path("/media.mp4")
                    .header("range", "bytes=10-14");
                then.status(206).body("abcde");
            })
            .await;
        let dir = tempdir().unwrap();
        let out = dir.path().join("range.bin");
        let cancel = CancellationToken::new(Arc::new(AtomicBool::new(false)));

        let bytes = download_url_to_file(
            reqwest::Client::new(),
            &format!("{}/media.mp4", server.base_url()),
            HeaderMap::new(),
            Some(ByteRange {
                offset: 10,
                length: 5,
            }),
            &out,
            0,
            cancel,
            None,
        )
        .await
        .unwrap();

        media.assert_async().await;
        assert_eq!(bytes, 5);
        assert_eq!(std::fs::read(&out).unwrap(), b"abcde");
    }

    #[tokio::test]
    async fn decrypts_aes128_cbc_segment() {
        use aes::Aes128;
        use cbc::cipher::block_padding::Pkcs7;
        use cbc::cipher::{BlockEncryptMut, KeyIvInit};
        type Aes128CbcEnc = cbc::Encryptor<Aes128>;

        let key = [0x11u8; 16];
        let iv = [0x22u8; 16];
        let plaintext = b"hello-aes-128-cbc-hls-segment!!".to_vec();
        let ciphertext =
            Aes128CbcEnc::new(&key.into(), &iv.into()).encrypt_padded_vec_mut::<Pkcs7>(&plaintext);
        assert_eq!(ciphertext.len() % 16, 0);

        let server = httpmock::MockServer::start_async().await;
        let media = server
            .mock_async(|when, then| {
                when.method("GET").path("/seg.enc");
                then.status(200).body(ciphertext.clone());
            })
            .await;
        let dir = tempdir().unwrap();
        let out = dir.path().join("seg.bin");
        let cancel = CancellationToken::new(Arc::new(AtomicBool::new(false)));

        let written = download_url_to_file(
            reqwest::Client::new(),
            &format!("{}/seg.enc", server.base_url()),
            HeaderMap::new(),
            None,
            &out,
            0,
            cancel,
            Some(AesCbcParams { key, iv }),
        )
        .await
        .unwrap();

        media.assert_async().await;
        assert_eq!(written, plaintext.len() as u64);
        assert_eq!(std::fs::read(&out).unwrap(), plaintext);
    }

    #[tokio::test]
    async fn rejects_full_file_response_for_byte_range_request() {
        let server = httpmock::MockServer::start_async().await;
        server
            .mock_async(|when, then| {
                when.method("GET")
                    .path("/media.mp4")
                    .header("range", "bytes=10-14");
                then.status(200).body("abcde");
            })
            .await;
        let dir = tempdir().unwrap();
        let out = dir.path().join("range.bin");
        let cancel = CancellationToken::new(Arc::new(AtomicBool::new(false)));

        let err = download_url_to_file(
            reqwest::Client::new(),
            &format!("{}/media.mp4", server.base_url()),
            HeaderMap::new(),
            Some(ByteRange {
                offset: 10,
                length: 5,
            }),
            &out,
            0,
            cancel,
            None,
        )
        .await
        .unwrap_err();

        assert!(err.contains("206"));
    }

    #[tokio::test]
    async fn rejects_incorrect_byte_length_for_byte_range_request() {
        let server = httpmock::MockServer::start_async().await;
        server
            .mock_async(|when, then| {
                when.method("GET")
                    .path("/media.mp4")
                    .header("range", "bytes=10-14");
                then.status(206).body("ab");
            })
            .await;
        let dir = tempdir().unwrap();
        let out = dir.path().join("range.bin");
        let cancel = CancellationToken::new(Arc::new(AtomicBool::new(false)));

        let err = download_url_to_file(
            reqwest::Client::new(),
            &format!("{}/media.mp4", server.base_url()),
            HeaderMap::new(),
            Some(ByteRange {
                offset: 10,
                length: 5,
            }),
            &out,
            0,
            cancel,
            None,
        )
        .await
        .unwrap_err();

        assert!(err.contains("期望 5 字节"));
    }

    #[tokio::test]
    async fn streams_clear_segment_to_file() {
        let server = httpmock::MockServer::start_async().await;
        let body = vec![b'x'; 128 * 1024];
        let media = server
            .mock_async(move |when, then| {
                when.method("GET").path("/large.ts");
                then.status(200).body(body.clone());
            })
            .await;
        let dir = tempdir().unwrap();
        let out = dir.path().join("large.ts");
        let cancel = CancellationToken::new(Arc::new(AtomicBool::new(false)));

        let written = download_url_to_file(
            reqwest::Client::new(),
            &format!("{}/large.ts", server.base_url()),
            HeaderMap::new(),
            None,
            &out,
            0,
            cancel,
            None,
        )
        .await
        .unwrap();

        media.assert_async().await;
        assert_eq!(written, 128 * 1024);
        assert_eq!(std::fs::metadata(out).unwrap().len(), 128 * 1024);
    }

    #[tokio::test]
    async fn aborts_streaming_download_when_cancelled() {
        let server = httpmock::MockServer::start_async().await;
        let body = vec![b'x'; 256 * 1024];
        server
            .mock_async(move |when, then| {
                when.method("GET").path("/slow.ts");
                then.status(200).body(body);
            })
            .await;
        let dir = tempdir().unwrap();
        let out = dir.path().join("slow.ts");
        let cancelled = Arc::new(AtomicBool::new(true));
        let cancel = CancellationToken::new(cancelled);

        let err = download_url_to_file(
            reqwest::Client::new(),
            &format!("{}/slow.ts", server.base_url()),
            HeaderMap::new(),
            None,
            &out,
            0,
            cancel,
            None,
        )
        .await
        .unwrap_err();

        assert!(err.contains("下载已取消"));
    }

    #[tokio::test]
    async fn injects_default_user_agent_only_when_absent() {
        let server = httpmock::MockServer::start_async().await;
        let default_mock = server
            .mock_async(|when, then| {
                when.method("GET")
                    .path("/default.ts")
                    .header("user-agent", DEFAULT_HLS_USER_AGENT);
                then.status(200).body("ok-default");
            })
            .await;
        let custom_mock = server
            .mock_async(|when, then| {
                when.method("GET")
                    .path("/custom.ts")
                    .header("user-agent", "CustomAgent/1.0");
                then.status(200).body("ok-custom");
            })
            .await;
        let dir = tempdir().unwrap();
        let cancel = CancellationToken::new(Arc::new(AtomicBool::new(false)));

        download_url_to_file(
            reqwest::Client::new(),
            &format!("{}/default.ts", server.base_url()),
            HeaderMap::new(),
            None,
            &dir.path().join("default.ts"),
            0,
            cancel.clone(),
            None,
        )
        .await
        .unwrap();

        let headers = parse_header_map("User-Agent: CustomAgent/1.0").unwrap();
        download_url_to_file(
            reqwest::Client::new(),
            &format!("{}/custom.ts", server.base_url()),
            headers,
            None,
            &dir.path().join("custom.ts"),
            0,
            cancel,
            None,
        )
        .await
        .unwrap();

        default_mock.assert_async().await;
        custom_mock.assert_async().await;
    }

    #[tokio::test]
    async fn tracks_downloaded_bytes_and_spills_above_memory_limit() {
        let server = httpmock::MockServer::start_async().await;
        let body = vec![b'z'; 96 * 1024];
        server
            .mock_async({
                let body = body.clone();
                move |when, then| {
                    when.method("GET").path("/spill.ts");
                    then.status(200).body(body.clone());
                }
            })
            .await;
        let dir = tempdir().unwrap();
        let out = dir.path().join("spill.ts");
        let cancel = CancellationToken::new(Arc::new(AtomicBool::new(false)));
        let counter = Arc::new(AtomicU64::new(0));

        let response = reqwest::Client::new()
            .get(format!("{}/spill.ts", server.base_url()))
            .send()
            .await
            .unwrap();
        let written = write_response_stream_buffered(
            response,
            &out,
            None,
            &cancel,
            None,
            Some(&counter),
            4 * 1024,
        )
        .await
        .unwrap();

        assert_eq!(written, body.len() as u64);
        assert_eq!(counter.load(Ordering::Relaxed), body.len() as u64);
        assert_eq!(std::fs::read(&out).unwrap(), body);
    }

    #[test]
    fn aes128_cbc_decrypt_falls_back_to_nopadding_when_unpadded() {
        use aes::Aes128;
        use cbc::cipher::block_padding::NoPadding;
        use cbc::cipher::{BlockEncryptMut, KeyIvInit};
        type Aes128CbcEnc = cbc::Encryptor<Aes128>;

        let key = [0x33u8; 16];
        let iv = [0x44u8; 16];
        let plaintext = b"0123456789abcdef0123456789abcdef".to_vec();
        let ciphertext =
            Aes128CbcEnc::new(&key.into(), &iv.into()).encrypt_padded_vec_mut::<NoPadding>(&plaintext);
        let decrypted = aes128_cbc_decrypt(ciphertext, &AesCbcParams { key, iv }).unwrap();
        assert_eq!(decrypted, plaintext);
    }
}
