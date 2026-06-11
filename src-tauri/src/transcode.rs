use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

#[derive(Clone, serde::Serialize)]
struct TranscodeProgressEvent {
    percent: f32,
}

struct TranscodeJob {
    cache_path: PathBuf,
    completed: bool,
    progress: f32,
}

struct TranscodeState {
    cache_dir: PathBuf,
    jobs: Arc<Mutex<HashMap<String, TranscodeJob>>>,
}

impl TranscodeState {
    fn new(cache_dir: PathBuf) -> Self {
        fs::create_dir_all(&cache_dir).ok();
        Self {
            cache_dir,
            jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
pub async fn detect_video_codec(path: String) -> Result<String, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_name",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &path,
        ])
        .output()
        .map_err(|e| format!("执行 ffprobe 失败: {}", e))?;

    if !output.status.success() {
        return Err("ffprobe 执行失败".to_string());
    }

    let codec = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(codec)
}

#[tauri::command]
pub async fn start_transcode(
    app: AppHandle,
    video_path: String,
) -> Result<String, String> {
    let state = app.state::<TranscodeState>();
    let mut jobs = state.jobs.lock().await;

    // 检查是否已有任务（包括进行中的任务）
    if let Some(job) = jobs.get(&video_path) {
        println!("Task already exists for: {}", video_path);
        if job.completed && job.cache_path.exists() {
            return Ok(job.cache_path.to_string_lossy().to_string());
        } else if !job.completed {
            // 任务进行中，直接返回缓存路径
            println!("Task in progress, returning cache path");
            return Ok(job.cache_path.to_string_lossy().to_string());
        }
    }

    let hash = format!("{:x}", md5::compute(&video_path));
    let cache_path = state.cache_dir.join(format!("{}.mp4", hash));

    if cache_path.exists() {
        println!("Cache file exists, validating: {:?}", cache_path);

        // 检查文件大小（太小说明不完整）
        if let Ok(metadata) = fs::metadata(&cache_path) {
            if metadata.len() < 10240 {  // 至少 10KB
                println!("Cache file too small ({}), removing", metadata.len());
                let _ = fs::remove_file(&cache_path);
            } else {
                // 验证是否是完整的 h264 视频
                let check = Command::new("ffprobe")
                    .args([
                        "-v", "error",
                        "-select_streams", "v:0",
                        "-show_entries", "stream=codec_name",
                        "-of", "default=noprint_wrappers=1:nokey=1",
                        cache_path.to_str().unwrap()
                    ])
                    .output();

                if let Ok(output) = check {
                    if output.status.success() {
                        let info = String::from_utf8_lossy(&output.stdout);
                        println!("ffprobe output: {:?}", info.trim());
                        // 只验证编码格式是 h264
                        if info.trim() == "h264" {
                            println!("Using existing cache: {:?}", cache_path);
                            jobs.insert(
                                video_path.clone(),
                                TranscodeJob {
                                    cache_path: cache_path.clone(),
                                    completed: true,
                                    progress: 100.0,
                                },
                            );
                            return Ok(cache_path.to_string_lossy().to_string());
                        } else {
                            println!("Unexpected codec: {}", info.trim());
                        }
                    } else {
                        println!("ffprobe failed: {}", String::from_utf8_lossy(&output.stderr));
                    }
                } else {
                    println!("Failed to run ffprobe");
                }

                println!("Cache file invalid or corrupted, removing");
                let _ = fs::remove_file(&cache_path);
            }
        }
    }

    jobs.insert(
        video_path.clone(),
        TranscodeJob {
            cache_path: cache_path.clone(),
            completed: false,
            progress: 0.0,
        },
    );

    let output_path = cache_path.to_string_lossy().to_string();
    let input_path = video_path.clone();
    let jobs_handle = state.jobs.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        println!("Starting transcode: {} -> {}", input_path, output_path);

        // 先获取视频时长
        let duration_output = Command::new("ffprobe")
            .args([
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                &input_path
            ])
            .output();

        let total_duration: f64 = duration_output
            .ok()
            .and_then(|out| String::from_utf8_lossy(&out.stdout).trim().parse().ok())
            .unwrap_or(0.0);

        let args = vec![
            "-i", &input_path,
            "-vf", "scale=-2:480",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-g", "1",
            "-crf", "22",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            "-y",
            &output_path,
        ];

        println!("FFmpeg args: {:?}", args);

        let child = Command::new("ffmpeg")
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn();

        match child {
            Ok(mut process) => {
                if let Some(stderr) = process.stderr.take() {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines() {
                        if let Ok(line_text) = line {
                            // 解析 FFmpeg 进度：time=00:01:23.45
                            if let Some(time_pos) = line_text.find("time=") {
                                let time_str = &line_text[time_pos + 5..];
                                if let Some(end) = time_str.find(' ') {
                                    let time_token = &time_str[..end];
                                    if let Some(current) = parse_time_to_seconds(time_token) {
                                        let percent = if total_duration > 0.0 {
                                            (current / total_duration * 100.0).min(100.0) as f32
                                        } else {
                                            0.0
                                        };

                                        if let Ok(mut jobs) = jobs_handle.try_lock() {
                                            if let Some(job) = jobs.get_mut(&input_path) {
                                                job.progress = percent;
                                            }
                                        }

                                        let _ = app_handle.emit("transcode_progress", TranscodeProgressEvent { percent });
                                    }
                                }
                            }
                        }
                    }
                }

                let result = process.wait();
                match result {
                    Ok(status) if status.success() => {
                        println!("Transcode completed: {}", output_path);
                        if let Ok(mut jobs) = jobs_handle.try_lock() {
                            if let Some(job) = jobs.get_mut(&input_path) {
                                job.completed = true;
                                job.progress = 100.0;
                            }
                        }
                        let _ = app_handle.emit("transcode_progress", TranscodeProgressEvent { percent: 100.0 });
                    }
                    _ => {
                        println!("Transcode failed: {}", output_path);
                        let _ = fs::remove_file(&output_path);
                        if let Ok(mut jobs) = jobs_handle.try_lock() {
                            jobs.remove(&input_path);
                        }
                    }
                }
            }
            Err(e) => {
                println!("Failed to spawn ffmpeg: {}", e);
                if let Ok(mut jobs) = jobs_handle.try_lock() {
                    jobs.remove(&input_path);
                }
            }
        }
    });

    Ok(cache_path.to_string_lossy().to_string())
}

fn parse_time_to_seconds(time_str: &str) -> Option<f64> {
    // 解析 HH:MM:SS.ms 格式
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

#[tauri::command]
pub async fn check_transcode_progress(
    app: AppHandle,
    video_path: String,
) -> Result<TranscodeProgress, String> {
    let state = app.state::<TranscodeState>();
    let jobs = state.jobs.lock().await;

    if let Some(job) = jobs.get(&video_path) {
        if job.completed && job.cache_path.exists() {
            println!("Transcode completed, ready to play");
            return Ok(TranscodeProgress {
                ready: true,
                cache_path: job.cache_path.to_string_lossy().to_string(),
            });
        }

        if job.cache_path.exists() {
            if let Ok(metadata) = fs::metadata(&job.cache_path) {
                let size = metadata.len();
                println!(
                    "Transcode in progress - size: {} bytes, completed: {}",
                    size, job.completed
                );
            }
        }
    }

    Ok(TranscodeProgress {
        ready: false,
        cache_path: String::new(),
    })
}

#[derive(serde::Serialize)]
pub struct TranscodeProgress {
    ready: bool,
    cache_path: String,
}

#[tauri::command]
pub async fn stop_transcode(app: AppHandle, video_path: String) -> Result<(), String> {
    let state = app.state::<TranscodeState>();
    let mut jobs = state.jobs.lock().await;
    jobs.remove(&video_path);
    Ok(())
}

pub fn init_transcode_state(app: &mut tauri::App) {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| PathBuf::from(".cache"))
        .join("transcode");

    app.manage(TranscodeState::new(cache_dir));
}
