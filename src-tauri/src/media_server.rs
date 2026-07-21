//! 本地 HTTP 媒体服务：为 Linux WebKit/GStreamer 提供可 Range 的 http:// URL。
//! `convertFileSrc` / asset 协议在 Linux 上无法正常播放音视频（Tauri #3725）。

use http::status::StatusCode;
use http_range::HttpRange;
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

const STREAM_CHUNK: usize = 64 * 1024;
const CORS_HEADERS: &str = concat!(
    "Access-Control-Allow-Origin: *\r\n",
    "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n",
    "Access-Control-Allow-Headers: Range, Content-Type\r\n",
    "Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range\r\n",
);

#[derive(Clone)]
pub struct MediaServer {
    base_url: String,
    files: Arc<Mutex<HashMap<String, PathBuf>>>,
}

impl MediaServer {
    pub async fn start() -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| format!("无法启动本地媒体服务: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("无法读取媒体服务端口: {e}"))?
            .port();
        let files = Arc::new(Mutex::new(HashMap::new()));
        let files_for_loop = files.clone();

        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        let files = files_for_loop.clone();
                        tokio::spawn(async move {
                            if let Err(err) = serve_connection(stream, files).await {
                                if !is_client_disconnect(&err) {
                                    eprintln!("[hikaru][media] 请求处理失败: {err}");
                                }
                            }
                        });
                    }
                    Err(err) => {
                        eprintln!("[hikaru][media] accept 失败: {err}");
                    }
                }
            }
        });

        let base_url = format!("http://127.0.0.1:{port}");
        eprintln!("[hikaru][media] 本地媒体服务已启动: {base_url}");
        Ok(Self { base_url, files })
    }

    pub fn register_path(&self, path: PathBuf) -> Result<String, String> {
        if !path.is_file() {
            return Err(format!("文件不存在: {}", path.display()));
        }
        let token = format!("{:x}", md5::compute(path.to_string_lossy().as_bytes()));
        let url = format!("{}/media/{token}", self.base_url);
        self.files
            .lock()
            .map_err(|_| "媒体服务状态锁失败".to_string())?
            .insert(token, path);
        Ok(url)
    }
}

#[tauri::command]
pub fn register_media_playback(
    path: String,
    server: State<'_, MediaServer>,
) -> Result<String, String> {
    println!("register_media_playback: {path}");
    server.register_path(PathBuf::from(path))
}

async fn serve_connection(
    mut stream: tokio::net::TcpStream,
    files: Arc<Mutex<HashMap<String, PathBuf>>>,
) -> Result<(), io::Error> {
    let request = match read_http_request(&mut stream).await {
        Ok(req) => req,
        Err(err) if err.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
        Err(err) => return Err(err),
    };

    send_media_response(&mut stream, &request, files).await
}

struct HttpRequest {
    method: String,
    path: String,
    range: Option<String>,
}

async fn read_http_request(stream: &mut tokio::net::TcpStream) -> Result<HttpRequest, io::Error> {
    let mut buf = vec![0_u8; 8192];
    let n = stream.read(&mut buf).await?;
    if n == 0 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "空 HTTP 请求"));
    }

    let text = String::from_utf8_lossy(&buf[..n]);
    let mut lines = text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "缺少请求行"))?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    let mut range = None;
    for line in lines {
        if let Some(value) = line
            .strip_prefix("Range:")
            .or_else(|| line.strip_prefix("range:"))
        {
            range = Some(value.trim().to_string());
            break;
        }
        if line.is_empty() {
            break;
        }
    }

    Ok(HttpRequest {
        method,
        path,
        range,
    })
}

async fn send_media_response(
    stream: &mut tokio::net::TcpStream,
    request: &HttpRequest,
    files: Arc<Mutex<HashMap<String, PathBuf>>>,
) -> Result<(), io::Error> {
    if request.method == "OPTIONS" {
        return write_simple_response(stream, StatusCode::NO_CONTENT, "text/plain", b"").await;
    }

    if request.method != "GET" && request.method != "HEAD" {
        return write_simple_response(
            stream,
            StatusCode::METHOD_NOT_ALLOWED,
            "text/plain",
            b"Method Not Allowed",
        )
        .await;
    }

    let token = match request.path.strip_prefix("/media/") {
        Some(token) => token,
        None => {
            return write_simple_response(
                stream,
                StatusCode::NOT_FOUND,
                "text/plain",
                b"Not Found",
            )
            .await;
        }
    };

    let path = {
        let files = files
            .lock()
            .map_err(|_| io::Error::other("媒体服务状态锁失败"))?;
        files.get(token).cloned()
    };

    let Some(path) = path else {
        return write_simple_response(stream, StatusCode::NOT_FOUND, "text/plain", b"Not Found")
            .await;
    };

    let metadata = tokio::fs::metadata(&path).await?;
    let file_len = metadata.len();
    let mime = guess_mime(&path);

    let byte_range = match request.range.as_deref() {
        Some(header) => match resolve_byte_range(header, file_len) {
            Ok(range) => range,
            Err(_) => {
                return write_headers_only(
                    stream,
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    mime,
                    0,
                    None,
                    file_len,
                )
                .await;
            }
        },
        None => ByteRange {
            start: 0,
            end: file_len.saturating_sub(1),
        },
    };

    if byte_range.start >= file_len || byte_range.end < byte_range.start {
        return write_headers_only(
            stream,
            StatusCode::RANGE_NOT_SATISFIABLE,
            mime,
            0,
            None,
            file_len,
        )
        .await;
    }

    let status = if request.range.is_some() {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let body_len = byte_range.end + 1 - byte_range.start;

    write_headers_only(stream, status, mime, body_len, Some(byte_range), file_len).await?;

    if request.method == "HEAD" {
        return Ok(());
    }

    let mut file = File::open(&path).await?;
    file.seek(std::io::SeekFrom::Start(byte_range.start))
        .await?;

    let mut remaining = body_len;
    let mut buf = vec![0_u8; STREAM_CHUNK];
    while remaining > 0 {
        let to_read = remaining.min(STREAM_CHUNK as u64) as usize;
        let n = file.read(&mut buf[..to_read]).await?;
        if n == 0 {
            break;
        }
        match stream.write_all(&buf[..n]).await {
            Ok(()) => {}
            Err(err) if is_client_disconnect(&err) => return Ok(()),
            Err(err) => return Err(err),
        }
        remaining -= n as u64;
    }

    if let Err(err) = stream.flush().await {
        if !is_client_disconnect(&err) {
            return Err(err);
        }
    }

    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end: u64,
}

fn resolve_byte_range(header: &str, file_len: u64) -> Result<ByteRange, ()> {
    let ranges = HttpRange::parse(header, file_len).map_err(|_| ())?;
    let range = ranges.first().ok_or(())?;
    let end = range.start + range.length - 1;
    Ok(ByteRange {
        start: range.start,
        end,
    })
}

async fn write_simple_response(
    stream: &mut tokio::net::TcpStream,
    status: StatusCode,
    mime: &str,
    body: &[u8],
) -> Result<(), io::Error> {
    let mut headers = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        status,
        mime,
        body.len()
    );
    append_cors_headers(&mut headers);
    headers.push_str("\r\n");
    write_all_or_disconnect(stream, headers.as_bytes()).await?;
    write_all_or_disconnect(stream, body).await?;
    stream.flush().await.map(|_| ())
}

async fn write_headers_only(
    stream: &mut tokio::net::TcpStream,
    status: StatusCode,
    mime: &str,
    body_len: u64,
    byte_range: Option<ByteRange>,
    file_len: u64,
) -> Result<(), io::Error> {
    let mut headers = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\nConnection: close\r\n",
        status, mime, body_len
    );
    append_cors_headers(&mut headers);
    if let Some(range) = byte_range {
        headers.push_str(&format!(
            "Content-Range: bytes {}-{}/{}\r\n",
            range.start, range.end, file_len
        ));
    }
    headers.push_str("\r\n");
    write_all_or_disconnect(stream, headers.as_bytes()).await
}

fn append_cors_headers(headers: &mut String) {
    headers.push_str(CORS_HEADERS);
}

async fn write_all_or_disconnect(
    stream: &mut tokio::net::TcpStream,
    bytes: &[u8],
) -> Result<(), io::Error> {
    match stream.write_all(bytes).await {
        Ok(()) => Ok(()),
        Err(err) if is_client_disconnect(&err) => Ok(()),
        Err(err) => Err(err),
    }
}

fn is_client_disconnect(err: &io::Error) -> bool {
    matches!(
        err.kind(),
        io::ErrorKind::ConnectionReset
            | io::ErrorKind::ConnectionAborted
            | io::ErrorKind::BrokenPipe
            | io::ErrorKind::UnexpectedEof
    )
}

fn guess_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("mp4") | Some("m4v") | Some("mov") => "video/mp4",
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("ttc") | Some("otc") => "font/collection",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::{append_cors_headers, is_client_disconnect, resolve_byte_range, ByteRange};
    use std::io;

    #[test]
    fn open_ended_range_covers_tail() {
        let range = resolve_byte_range("bytes=1000-", 5000).unwrap();
        assert_eq!(
            range,
            ByteRange {
                start: 1000,
                end: 4999
            }
        );
    }

    #[test]
    fn suffix_range_reads_tail() {
        let range = resolve_byte_range("bytes=-500", 5000).unwrap();
        assert_eq!(
            range,
            ByteRange {
                start: 4500,
                end: 4999
            }
        );
    }

    #[test]
    fn explicit_range_is_honored() {
        let range = resolve_byte_range("bytes=0-1023", 5000).unwrap();
        assert_eq!(
            range,
            ByteRange {
                start: 0,
                end: 1023
            }
        );
    }

    #[test]
    fn connection_aborted_is_treated_as_client_disconnect() {
        let err = io::Error::new(io::ErrorKind::ConnectionAborted, "client closed");
        assert!(is_client_disconnect(&err));
    }

    #[test]
    fn cors_headers_allow_worker_font_fetches() {
        let mut headers = String::new();
        append_cors_headers(&mut headers);

        assert!(headers.contains("Access-Control-Allow-Origin: *\r\n"));
        assert!(headers.contains("Access-Control-Allow-Headers: Range, Content-Type\r\n"));
    }
}
