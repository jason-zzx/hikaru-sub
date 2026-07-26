use crate::dependencies::{resolve_ffmpeg_paths, ResolvedFfmpegSource};
use crate::process::hidden_command;
use crate::settings::{load_settings, AppSettings};
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};

/// FFmpeg 来源：用户设置 / 受管下载 / 系统 PATH。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FfmpegSource {
    Settings,
    Managed,
    System,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub available: bool,
    pub path: String,
    pub source: FfmpegSource,
    pub version: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractProgress {
    /// 已处理时长（毫秒）
    processed_ms: i64,
    /// 视频总时长（毫秒），未知时为 0
    duration_ms: i64,
    /// 0.0 ~ 1.0，总时长未知时为 None
    percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub duration_ms: i64,
    /// 视频帧率（r_frame_rate 优先，回退 avg_frame_rate），无法解析时为 None
    pub fps: Option<f64>,
}

/// `extract_waveform` 返回值：峰值数组 + 实际解码覆盖时长（毫秒）。
///
/// `covered_ms` 由解码出的 PCM 样本数换算（16kHz → 16 样本/ms），可能不等于容器
/// 标称时长；前端波形绘制映射必须用它而非 `<video>.duration`，否则在音频帧总时长
/// 与时间戳跨度不一致的素材（HLS 合并产物）上产生随时间线性放大的漂移。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformData {
    pub peaks: Vec<f32>,
    pub covered_ms: u64,
}

/// 按时间戳补齐音频流内的静音间隙并对齐起始时间戳。
///
/// HLS 合并产物的 AAC 流时间戳跨度可大于实际音频帧总时长（分段间静音间隙），
/// 顺序解码会把间隙“挤掉”，输出 PCM 比标称时长短（实测 4144s 素材少 36s）；
/// 波形/转录时间轴随之整体前移且越往后偏越多。`aresample=async=1` 按时间戳
/// 插入静音补齐，`first_pts=0` 锚定起点，输出与播放时间轴对齐。
const ARESAMPLE_SYNC_FILTER: &str = "aresample=async=1:first_pts=0";

/// 与 `resolve_ffmpeg` 同目录解析 ffprobe 可执行路径。
pub fn resolve_ffprobe(app: &AppHandle, settings: &AppSettings) -> String {
    resolve_ffmpeg_paths(app, settings).ffprobe
}

/// 按优先级解析 ffmpeg 可执行路径：用户设置 → 系统 PATH → 受管下载。
pub fn resolve_ffmpeg(app: &AppHandle, settings: &AppSettings) -> (String, FfmpegSource) {
    let resolved = resolve_ffmpeg_paths(app, settings);
    let source = match resolved.source {
        ResolvedFfmpegSource::Settings => FfmpegSource::Settings,
        ResolvedFfmpegSource::Managed => FfmpegSource::Managed,
        ResolvedFfmpegSource::System | ResolvedFfmpegSource::Missing => FfmpegSource::System,
    };
    (resolved.ffmpeg, source)
}

pub fn ffmpeg_status(app: &AppHandle) -> FfmpegStatus {
    let settings = load_settings(app).unwrap_or_default();
    let (path, source) = resolve_ffmpeg(app, &settings);

    let output = hidden_command(&path).arg("-version").output();
    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let version = stdout.lines().next().map(|s| s.to_string());
            FfmpegStatus {
                available: true,
                path,
                source,
                version,
            }
        }
        _ => FfmpegStatus {
            available: false,
            path,
            source,
            version: None,
        },
    }
}

#[tauri::command]
pub fn check_ffmpeg(app: AppHandle) -> FfmpegStatus {
    ffmpeg_status(&app)
}

/// 解析 `HH:MM:SS.cc` 为毫秒。
fn parse_hhmmss_ms(input: &str) -> Option<i64> {
    let s = input.trim();
    let (hms, frac) = s.split_once('.').unwrap_or((s, "0"));
    let mut parts = hms.split(':');
    let h: i64 = parts.next()?.trim().parse().ok()?;
    let m: i64 = parts.next()?.trim().parse().ok()?;
    let sec: i64 = parts.next()?.trim().parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    // ffmpeg 输出为厘秒（2 位），补足到毫秒
    let mut frac3 = String::with_capacity(3);
    frac3.push_str(frac);
    while frac3.len() < 3 {
        frac3.push('0');
    }
    let ms: i64 = frac3.get(0..3)?.parse().ok()?;
    Some(((h * 60 + m) * 60 + sec) * 1000 + ms)
}

/// 从 ffmpeg stderr 行中提取 `Duration:` 时长。
fn parse_duration_line(line: &str) -> Option<i64> {
    let idx = line.find("Duration:")?;
    let rest = &line[idx + "Duration:".len()..];
    let token = rest.split(',').next()?.trim();
    if token.starts_with("N/A") {
        return None;
    }
    parse_hhmmss_ms(token)
}

/// 从 ffmpeg 进度行中提取 `time=` 已处理时长。
fn parse_time_token(line: &str) -> Option<i64> {
    let idx = line.find("time=")?;
    let rest = &line[idx + "time=".len()..];
    let token = rest.split_whitespace().next()?;
    if token.starts_with("N/A") {
        return None;
    }
    parse_hhmmss_ms(token)
}

/// 提取音轨为 16kHz 单声道 PCM WAV（兼容 Whisper 系模型），过程中推送进度事件。
///
/// 进度事件名：`audio_extract_progress`，载荷见 `ExtractProgress`。
#[tauri::command]
pub async fn extract_audio(
    app: AppHandle,
    video_path: String,
    audio_path: String,
) -> Result<String, String> {
    let video = PathBuf::from(&video_path);
    if !video.is_file() {
        return Err(format!("视频文件不存在: {video_path}"));
    }
    if let Some(parent) = PathBuf::from(&audio_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let settings = load_settings(&app).unwrap_or_default();
    let (ffmpeg, _source) = resolve_ffmpeg(&app, &settings);
    let audio_out = audio_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        run_extract(&app, &ffmpeg, &video_path, &audio_path)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))??;

    Ok(audio_out)
}

/// ASR 音轨提取的 ffmpeg 参数（16kHz 单声道 PCM WAV）。
///
/// `-af` 为输出选项，须位于输入之后；除新增时间戳补齐 filter 外，
/// 采样率/声道等参数与历史行为一致。
fn audio_decode_args<'a>(video_path: &'a str, audio_path: &'a str) -> [&'a str; 14] {
    [
        "-hide_banner",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-af",
        ARESAMPLE_SYNC_FILTER,
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        audio_path,
    ]
}

fn run_extract(
    app: &AppHandle,
    ffmpeg: &str,
    video_path: &str,
    audio_path: &str,
) -> Result<(), String> {
    let mut child = hidden_command(ffmpeg)
        .args(audio_decode_args(video_path, audio_path))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 FFmpeg（{ffmpeg}）：{e}"))?;

    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 FFmpeg 输出".to_string())?;

    let mut duration_ms: i64 = 0;
    let mut tail = String::new();
    let mut buf = [0u8; 4096];
    let mut line: Vec<u8> = Vec::new();

    // ffmpeg 进度以 \r 刷新、信息以 \n 换行，需同时按两者切分
    loop {
        let n = stderr.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        for &byte in &buf[..n] {
            if byte == b'\n' || byte == b'\r' {
                if !line.is_empty() {
                    let text = String::from_utf8_lossy(&line).into_owned();
                    handle_stderr_line(app, &text, &mut duration_ms, &mut tail);
                    line.clear();
                }
            } else {
                line.push(byte);
            }
        }
    }
    if !line.is_empty() {
        let text = String::from_utf8_lossy(&line).into_owned();
        handle_stderr_line(app, &text, &mut duration_ms, &mut tail);
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("FFmpeg 提取音轨失败：{}", tail.trim()));
    }

    // 收尾：推送 100%
    let _ = app.emit(
        "audio_extract_progress",
        ExtractProgress {
            processed_ms: duration_ms,
            duration_ms,
            percent: Some(1.0),
        },
    );
    Ok(())
}

/// 解析 ffprobe 的 "30000/1001" 形式帧率；无效（0/0、N/A、非正数）返回 None。
fn parse_rational_fps(value: &str) -> Option<f64> {
    let v = value.trim();
    if v.is_empty() || v == "N/A" {
        return None;
    }
    if let Some((num, den)) = v.split_once('/') {
        let num: f64 = num.parse().ok()?;
        let den: f64 = den.parse().ok()?;
        if den == 0.0 || num <= 0.0 {
            return None;
        }
        return Some(num / den);
    }
    v.parse::<f64>().ok().filter(|f| *f > 0.0)
}

/// 解析 ffprobe `-of default=noprint_wrappers=1` 的 key=value 输出。
fn parse_video_info_output(stdout: &str) -> Result<VideoInfo, String> {
    let mut width: Option<u32> = None;
    let mut height: Option<u32> = None;
    let mut duration_ms: i64 = 0;
    let mut r_fps: Option<f64> = None;
    let mut avg_fps: Option<f64> = None;

    for line in stdout.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        match key {
            "width" => width = value.parse().ok(),
            "height" => height = value.parse().ok(),
            "duration" => {
                duration_ms = value
                    .parse::<f64>()
                    .ok()
                    .map(|d| (d * 1000.0) as i64)
                    .unwrap_or(0)
            }
            "r_frame_rate" => r_fps = parse_rational_fps(value),
            "avg_frame_rate" => avg_fps = parse_rational_fps(value),
            _ => {}
        }
    }

    let width = width.ok_or("无法解析宽度")?;
    let height = height.ok_or("无法解析高度")?;
    Ok(VideoInfo {
        width,
        height,
        duration_ms,
        fps: r_fps.or(avg_fps),
    })
}

/// 使用 ffprobe 获取视频信息（分辨率、时长、帧率）
#[tauri::command]
pub async fn get_video_info(app: AppHandle, video_path: String) -> Result<VideoInfo, String> {
    let video = PathBuf::from(&video_path);
    if !video.is_file() {
        return Err(format!("视频文件不存在: {video_path}"));
    }

    let settings = load_settings(&app).unwrap_or_default();
    let ffprobe = resolve_ffprobe(&app, &settings);

    let output = hidden_command(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration,r_frame_rate,avg_frame_rate",
            "-of",
            "default=noprint_wrappers=1",
            &video_path,
        ])
        .output()
        .map_err(|e| format!("执行 ffprobe 失败: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe 失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    parse_video_info_output(&String::from_utf8_lossy(&output.stdout))
}

/// 提取音频波形数据（峰值数组 + 实际覆盖时长），用于 Timeline 渲染
#[tauri::command]
pub async fn extract_waveform(
    app: AppHandle,
    video_path: String,
    samples: usize,
) -> Result<WaveformData, String> {
    let settings = load_settings(&app).unwrap_or_default();
    let (ffmpeg, _) = resolve_ffmpeg(&app, &settings);

    tauri::async_runtime::spawn_blocking(move || {
        run_extract_waveform(&ffmpeg, &video_path, samples)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 波形提取的 ffmpeg 解码参数（裸 s16le PCM 到 stdout）。
///
/// `-af` 为输出选项，须位于输入之后；除新增时间戳补齐 filter 外，
/// 采样率/声道等参数与历史行为一致。
fn waveform_decode_args(video_path: &str) -> [&str; 14] {
    [
        "-i",
        video_path,
        "-vn",
        "-af",
        ARESAMPLE_SYNC_FILTER,
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-",
    ]
}

fn run_extract_waveform(
    ffmpeg: &str,
    video_path: &str,
    samples: usize,
) -> Result<WaveformData, String> {
    // FFmpeg 提取 16bit PCM，单声道，16kHz
    let mut child = hidden_command(ffmpeg)
        .args(waveform_decode_args(video_path))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("无法启动 FFmpeg: {e}"))?;

    let mut stdout = child.stdout.take().ok_or("无法读取输出")?;
    let mut pcm_data = Vec::new();
    stdout
        .read_to_end(&mut pcm_data)
        .map_err(|e| format!("读取失败: {e}"))?;

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("FFmpeg 提取音频失败".to_string());
    }

    // 转换为 i16 样本
    let mut audio_samples = Vec::with_capacity(pcm_data.len() / 2);
    for chunk in pcm_data.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
        audio_samples.push(sample);
    }

    Ok(WaveformData {
        peaks: downsample_waveform_peaks(&audio_samples, samples),
        // 16kHz → 16 样本/ms
        covered_ms: (audio_samples.len() / 16) as u64,
    })
}

/// 下采样计算归一化峰值；圆整到 3 位小数以压缩 JSON 载荷（720k 桶量级）
///
/// 均匀边界分桶：桶 i 覆盖 `[i*len/samples, (i+1)*len/samples)`，覆盖全部样本。
/// 不能用整除截尾的固定 chunk_size：那会丢弃尾部 `len % samples` 个样本，
/// 前端把波形均摊到完整时长后产生随时间线性放大的漂移（24 分钟素材尾部可漂 ~9 秒）。
/// usize 为 64 位时乘法不会溢出（len ≤ ~2 亿样本，samples ≤ 720_000，乘积 < 2^63）。
fn downsample_waveform_peaks(audio_samples: &[i16], samples: usize) -> Vec<f32> {
    let len = audio_samples.len();
    let mut peaks = Vec::with_capacity(samples);

    for i in 0..samples {
        let start = i * len / samples;
        let end = (i + 1) * len / samples;
        // 空桶（len < samples 时出现）补 0
        if start >= end {
            peaks.push(0.0);
            continue;
        }

        let chunk = &audio_samples[start..end];
        let max = chunk.iter().map(|&s| s.abs_diff(0)).max().unwrap_or(0);
        let normalized = max as f32 / 32768.0; // 归一化到 0-1
        peaks.push((normalized * 1000.0).round() / 1000.0);
    }

    peaks
}

fn handle_stderr_line(app: &AppHandle, text: &str, duration_ms: &mut i64, tail: &mut String) {
    if *duration_ms == 0 {
        if let Some(d) = parse_duration_line(text) {
            *duration_ms = d;
        }
    }
    if let Some(processed) = parse_time_token(text) {
        let percent =
            (*duration_ms > 0).then(|| (processed as f64 / *duration_ms as f64).clamp(0.0, 1.0));
        let _ = app.emit(
            "audio_extract_progress",
            ExtractProgress {
                processed_ms: processed,
                duration_ms: *duration_ms,
                percent,
            },
        );
    }
    // 保留最近一行非空输出，失败时作为错误信息
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        *tail = trimmed.to_string();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_video_info_normal() {
        let out = "width=1920\nheight=1080\nr_frame_rate=30000/1001\navg_frame_rate=30000/1001\nduration=1445.361000\n";
        let info = parse_video_info_output(out).unwrap();
        assert_eq!(info.width, 1920);
        assert_eq!(info.height, 1080);
        assert_eq!(info.duration_ms, 1445361);
        let fps = info.fps.unwrap();
        assert!((fps - 29.97).abs() < 0.01);
    }

    #[test]
    fn parse_video_info_r_frame_rate_invalid_falls_back_to_avg() {
        let out = "width=1280\nheight=720\nr_frame_rate=0/0\navg_frame_rate=25/1\nduration=10.0\n";
        let info = parse_video_info_output(out).unwrap();
        assert_eq!(info.fps, Some(25.0));
    }

    #[test]
    fn parse_video_info_missing_fps_and_duration() {
        let out = "width=640\nheight=480\nr_frame_rate=N/A\navg_frame_rate=0/0\n";
        let info = parse_video_info_output(out).unwrap();
        assert_eq!(info.fps, None);
        assert_eq!(info.duration_ms, 0);
    }

    #[test]
    fn parse_video_info_missing_dimensions_errors() {
        assert!(parse_video_info_output("duration=1.0\n").is_err());
    }

    /// 断言 args 中 `-af aresample=async=1:first_pts=0` 存在、成对、且位于输入之后
    /// （输出选项归属）。
    fn assert_aresample_sync(args: &[&str], input: &str) {
        let af = args
            .iter()
            .position(|&a| a == "-af")
            .expect("解码参数必须包含 -af");
        assert_eq!(
            args[af + 1],
            ARESAMPLE_SYNC_FILTER,
            "-af 后必须紧跟时间戳补齐 filter"
        );
        let input_pos = args
            .iter()
            .position(|&a| a == input)
            .expect("解码参数必须包含输入路径");
        assert!(af > input_pos, "-af 是输出选项，必须位于输入之后");
        // 既有采样率/声道参数不变
        let ar = args.iter().position(|&a| a == "-ar").unwrap();
        assert_eq!(args[ar + 1], "16000");
        let ac = args.iter().position(|&a| a == "-ac").unwrap();
        assert_eq!(args[ac + 1], "1");
    }

    #[test]
    fn waveform_decode_args_fill_timestamp_gaps() {
        let args = waveform_decode_args("in.mp4");
        assert_aresample_sync(&args, "in.mp4");
        assert_eq!(*args.last().unwrap(), "-", "波形解码输出到 stdout");
    }

    #[test]
    fn audio_decode_args_fill_timestamp_gaps() {
        let args = audio_decode_args("in.mp4", "out.wav");
        assert_aresample_sync(&args, "in.mp4");
        assert_eq!(*args.last().unwrap(), "out.wav");
    }

    #[test]
    fn downsample_peaks_rounds_to_three_decimals() {
        // 12345 / 32768 = 0.376739... → 0.377
        let audio = vec![12345i16; 4];
        let peaks = downsample_waveform_peaks(&audio, 2);
        assert_eq!(peaks, vec![0.377, 0.377]);
    }

    #[test]
    fn downsample_peaks_uses_abs_max_per_bucket() {
        // 桶 1 峰值来自负样本；i16::MIN 绝对值 32768 → 恰好 1.0
        let audio = vec![100, -16384, i16::MIN, 200];
        let peaks = downsample_waveform_peaks(&audio, 2);
        assert_eq!(peaks, vec![0.5, 1.0]);
    }

    #[test]
    fn downsample_peaks_distributes_short_audio_into_matching_buckets() {
        // 音频短于请求桶数：均匀边界分桶把少量样本落到对应位置的桶，空桶补 0。
        // （旧实现 chunk_size 整除为 0 时输出全零，属丢样本缺陷；此处语义随修复更新）
        // 3 样本 / 8 桶：样本 0/1/2 分别落在桶 2/5/7；1000/32768 ≈ 0.031
        let peaks = downsample_waveform_peaks(&[1000i16; 3], 8);
        assert_eq!(peaks, vec![0.0, 0.0, 0.031, 0.0, 0.0, 0.031, 0.0, 0.031]);

        let peaks = downsample_waveform_peaks(&[], 4);
        assert_eq!(peaks, vec![0.0; 4]);
    }

    #[test]
    fn downsample_peaks_covers_all_requested_buckets() {
        let mut audio = vec![0i16; 100];
        audio[95] = 3277; // ≈ 0.1，落在最后一个桶
        let peaks = downsample_waveform_peaks(&audio, 10);
        assert_eq!(peaks.len(), 10);
        assert!(peaks[..9].iter().all(|&p| p == 0.0));
        assert_eq!(peaks[9], 0.1);
    }

    #[test]
    fn downsample_peaks_keeps_tail_samples_when_length_is_not_divisible() {
        // 防漂移回归：len=1003 不被 samples=10 整除。旧实现 chunk_size=100 只覆盖
        // 到样本 999，尾样本 1002 被丢弃；均匀边界分桶最后一桶覆盖 [902, 1003)。
        let mut audio = vec![0i16; 1003];
        audio[1002] = i16::MAX;
        let peaks = downsample_waveform_peaks(&audio, 10);
        assert_eq!(peaks.len(), 10);
        assert_eq!(peaks[9], 1.0, "尾样本峰值必须出现在最后一桶");
        assert!(peaks[..9].iter().all(|&p| p == 0.0));
    }

    #[test]
    fn downsample_peaks_localizes_pulse_without_cumulative_drift() {
        // 防漂移回归：长度不整除时，90% 位置的脉冲必须落在 index ≈ samples*0.9 的桶。
        // len=100_997、samples=1000：旧实现 chunk_size=100 会把样本 90_897 放进
        // 桶 908（漂移 +8 桶）；均匀边界分桶应落在桶 900（±1）。
        let mut audio = vec![0i16; 100_997];
        audio[90_897] = i16::MAX;
        let peaks = downsample_waveform_peaks(&audio, 1000);
        assert_eq!(peaks.len(), 1000);
        let hit = peaks
            .iter()
            .position(|&p| p > 0.0)
            .expect("脉冲峰值必须存在");
        assert!(
            (899..=901).contains(&hit),
            "脉冲应落在桶 900±1，实际 {hit}"
        );
        assert_eq!(peaks.iter().filter(|&&p| p > 0.0).count(), 1);
    }
}
