//! ASR sidecar 进程管理与 HTTP 代理。
//!
//! Rust 负责按需拉起 Python sidecar（读取其 stdout 的就绪端口），并以 reqwest
//! 代理转录任务的创建/查询/取消，使前端无需直接处理本地 HTTP 与端口。

use crate::process::hidden_command;
use crate::settings::{load_settings, AppSettings};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

/// 正在运行的 sidecar 句柄。
pub struct Sidecar {
    base_url: String,
    child: Child,
    pid: u32,
}

impl Sidecar {
    pub fn kill(&mut self) {
        let _ = self.child.kill();
    }
}

/// 受 Tauri 托管的全局 sidecar 状态（至多一个进程）。
pub struct AsrState {
    pub sidecar: Mutex<Option<Sidecar>>,
    job_base_urls: Mutex<HashMap<String, String>>,
    job_recovery_paths: Mutex<HashMap<String, PathBuf>>,
}

impl Default for AsrState {
    fn default() -> Self {
        Self {
            sidecar: Mutex::new(None),
            job_base_urls: Mutex::new(HashMap::new()),
            job_recovery_paths: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Deserialize)]
struct ReadyLine {
    event: String,
    port: u16,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VadConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    threshold: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_speech_duration_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_silence_duration_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    speech_pad_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_segment_duration_ms: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAsrArgs {
    audio_path: String,
    engine: String,
    model: String,
    device: String,
    language: Option<String>,
    output_ass_path: Option<String>,
    #[serde(default)]
    use_vad: bool,
    #[serde(default)]
    vad_config: Option<VadConfig>,
}

/// 解析 asr-service 目录（含 main.py）：设置 → 资源目录 → 当前目录及其上级。
fn resolve_service_dir(app: &AppHandle, settings: &AppSettings) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = settings
        .asr_service_path
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        candidates.push(PathBuf::from(p));
    }
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("asr-service"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("asr-service"));
        candidates.push(cwd.join("..").join("asr-service"));
    }
    for dir in candidates {
        if dir.join("main.py").is_file() {
            return Ok(dir);
        }
    }
    Err("未找到 asr-service（main.py）。请在设置中配置「ASR 服务目录」。".into())
}

/// 候选 Python 解释器：设置优先 → 服务目录下虚拟环境 → 按平台回退到系统解释器。
fn python_candidates(settings: &AppSettings, dir: &Path) -> Vec<String> {
    let mut v = Vec::new();
    if let Some(p) = settings
        .python_path
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        v.push(p.clone());
    }
    // 本地开发常见：在 asr-service 下创建 .venv / venv 并安装依赖。
    // 优先使用其中的解释器，否则系统 python 读不到这些依赖。
    for venv in ["venv", ".venv"] {
        let py = if cfg!(windows) {
            dir.join(venv).join("Scripts").join("python.exe")
        } else {
            dir.join(venv).join("bin").join("python")
        };
        if py.is_file() {
            v.push(py.to_string_lossy().into_owned());
        }
    }
    if cfg!(windows) {
        v.push("python".into());
        v.push("py".into());
    } else {
        v.push("python3".into());
        v.push("python".into());
    }
    v
}

/// 启动 sidecar 并阻塞读取其就绪端口；成功后保留进程并持续排空 stdout。
fn spawn_sidecar(python: &str, dir: &Path) -> Result<Sidecar, String> {
    let debug_log_path = dir.join("asr-debug.log");
    eprintln!(
        "[asr] spawning sidecar python={python} dir={} debug_log={}",
        dir.display(),
        debug_log_path.display()
    );
    let mut child = hidden_command(python)
        .args(["main.py", "--host", "127.0.0.1", "--port", "0"])
        .current_dir(dir)
        .env("HIKARU_ASR_DEBUG_LOG", &debug_log_path)
        .env("HIKARU_ASR_DEBUG_DETAIL", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("启动 sidecar 失败（{python}）：{e}"))?;
    let pid = child.id();
    eprintln!("[asr] sidecar spawned pid={pid}");

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 sidecar 输出".to_string())?;
    let mut reader = BufReader::new(stdout);

    let mut base_url = None;
    let mut line = String::new();
    for _ in 0..20 {
        line.clear();
        let n = reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if n == 0 {
            break; // EOF：进程提前退出
        }
        if let Ok(ready) = serde_json::from_str::<ReadyLine>(line.trim()) {
            if ready.event == "ready" {
                base_url = Some(format!("http://127.0.0.1:{}", ready.port));
                break;
            }
        }
    }

    let base_url = match base_url {
        Some(url) => url,
        None => {
            let _ = child.kill();
            return Err("sidecar 未输出就绪端口（请检查 Python 依赖是否已安装）".into());
        }
    };
    eprintln!("[asr] sidecar ready pid={pid} base_url={base_url}");

    // 持续排空剩余 stdout，避免管道写满阻塞子进程
    std::thread::spawn(move || {
        let mut sink = [0u8; 1024];
        loop {
            match reader.read(&mut sink) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });

    Ok(Sidecar {
        base_url,
        child,
        pid,
    })
}

/// 确保 sidecar 在运行并返回其 base_url（必要时拉起新进程）。
async fn ensure_base_url(app: &AppHandle, state: &AsrState) -> Result<String, String> {
    let mut guard = state.sidecar.lock().await;

    if let Some(sc) = guard.as_mut() {
        match sc.child.try_wait() {
            Ok(None) => return Ok(sc.base_url.clone()), // 仍在运行
            Ok(Some(status)) => {
                eprintln!(
                    "[asr] sidecar exited pid={} base_url={} status={status}",
                    sc.pid, sc.base_url
                );
                *guard = None; // 已退出，丢弃后重启
            }
            Err(err) => {
                eprintln!(
                    "[asr] failed to inspect sidecar pid={} base_url={} error={err}",
                    sc.pid, sc.base_url
                );
                *guard = None; // 已退出，丢弃后重启
            }
        }
    }

    let settings = load_settings(app).unwrap_or_default();
    let dir = resolve_service_dir(app, &settings)?;
    let pythons = python_candidates(&settings, &dir);

    let sidecar = tauri::async_runtime::spawn_blocking(move || {
        let mut last = String::from("无可用的 Python 解释器");
        for py in pythons {
            match spawn_sidecar(&py, &dir) {
                Ok(sc) => return Ok(sc),
                Err(e) => last = e,
            }
        }
        Err(last)
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))??;

    let base = sidecar.base_url.clone();
    *guard = Some(sidecar);
    Ok(base)
}

pub async fn stop_sidecar(state: &AsrState) {
    let mut guard = state.sidecar.lock().await;
    if let Some(mut sidecar) = guard.take() {
        sidecar.kill();
    }
}

async fn remember_job_base_url(state: &AsrState, job_id: &str, base_url: &str) {
    state
        .job_base_urls
        .lock()
        .await
        .insert(job_id.to_string(), base_url.to_string());
}

async fn known_job_base_url(state: &AsrState, job_id: &str) -> Option<String> {
    state.job_base_urls.lock().await.get(job_id).cloned()
}

fn recovery_snapshot_path_for_audio(audio_path: &str, job_id: &str) -> Option<PathBuf> {
    Path::new(audio_path)
        .parent()
        .map(|parent| parent.join("asr-jobs").join(format!("{job_id}.json")))
}

async fn remember_job_recovery_path(state: &AsrState, job_id: &str, audio_path: &str) {
    if let Some(path) = recovery_snapshot_path_for_audio(audio_path, job_id) {
        state
            .job_recovery_paths
            .lock()
            .await
            .insert(job_id.to_string(), path);
    }
}

async fn known_job_recovery_path(state: &AsrState, job_id: &str) -> Option<PathBuf> {
    state.job_recovery_paths.lock().await.get(job_id).cloned()
}

fn read_recovery_snapshot(
    path: &Path,
    job_id: &str,
    include_segments: bool,
) -> Result<Option<serde_json::Value>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)
        .map_err(|e| format!("读取 ASR 恢复结果失败（{}）：{e}", path.display()))?;
    let mut value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("解析 ASR 恢复结果失败（{}）：{e}", path.display()))?;
    let recovered_id = value.get("id").and_then(|x| x.as_str());
    if recovered_id != Some(job_id) {
        return Ok(None);
    }
    if !include_segments {
        if let Some(obj) = value.as_object_mut() {
            obj.remove("segments");
        }
    }
    Ok(Some(value))
}

fn try_recover_job_snapshot(
    recovery_path: Option<&Path>,
    job_id: &str,
    include_segments: bool,
) -> Result<Option<serde_json::Value>, String> {
    let Some(path) = recovery_path else {
        return Ok(None);
    };
    let snapshot = read_recovery_snapshot(path, job_id, include_segments)?;
    if snapshot.is_some() {
        eprintln!(
            "[asr] recovered job snapshot job_id={job_id} recovery_path={}",
            path.display()
        );
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn list_asr_engines(
    app: AppHandle,
    state: State<'_, AsrState>,
) -> Result<serde_json::Value, String> {
    let base = ensure_base_url(&app, &state).await?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{base}/engines"))
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_asr(
    app: AppHandle,
    state: State<'_, AsrState>,
    args: StartAsrArgs,
) -> Result<String, String> {
    let base = ensure_base_url(&app, &state).await?;
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "audioPath": args.audio_path,
        "engine": args.engine,
        "model": args.model,
        "device": args.device,
        "language": args.language,
        "outputAssPath": args.output_ass_path,
        "useVad": args.use_vad,
        "vadConfig": args.vad_config,
    });
    let resp = client
        .post(format!("{base}/transcribe"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("转录请求失败：HTTP {}", resp.status().as_u16()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let job_id = v
        .get("jobId")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "sidecar 响应缺少 jobId".to_string())?;
    remember_job_base_url(&state, &job_id, &base).await;
    remember_job_recovery_path(&state, &job_id, &args.audio_path).await;
    eprintln!("[asr] start_asr job_id={job_id} base_url={base}");
    Ok(job_id)
}

#[tauri::command]
pub async fn get_asr_progress(
    app: AppHandle,
    state: State<'_, AsrState>,
    job_id: String,
    include_segments: Option<bool>,
) -> Result<serde_json::Value, String> {
    let base = match known_job_base_url(&state, &job_id).await {
        Some(url) => url,
        None => ensure_base_url(&app, &state).await?,
    };
    let client = reqwest::Client::new();
    let seg = include_segments.unwrap_or(true);
    let recovery_path = known_job_recovery_path(&state, &job_id).await;
    let resp = match client
        .get(format!("{base}/jobs/{job_id}"))
        .query(&[("segments", if seg { "true" } else { "false" })])
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            if let Some(snapshot) =
                try_recover_job_snapshot(recovery_path.as_deref(), &job_id, seg)?
            {
                return Ok(snapshot);
            }
            return Err(format!(
                "无法连接 sidecar（jobId={job_id}, sidecar={base}）：{e}"
            ));
        }
    };
    if resp.status().as_u16() == 404 {
        if let Some(snapshot) = try_recover_job_snapshot(recovery_path.as_deref(), &job_id, seg)? {
            return Ok(snapshot);
        }
        return Err(format!("转录任务不存在（jobId={job_id}, sidecar={base}）"));
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_asr_model(
    app: AppHandle,
    state: State<'_, AsrState>,
    engine: String,
    model: String,
) -> Result<serde_json::Value, String> {
    let base = ensure_base_url(&app, &state).await?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{base}/models/status"))
        .query(&[("engine", engine.as_str()), ("model", model.as_str())])
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_asr_model(
    app: AppHandle,
    state: State<'_, AsrState>,
    engine: String,
    model: String,
) -> Result<String, String> {
    let base = ensure_base_url(&app, &state).await?;
    let client = reqwest::Client::new();
    let body = serde_json::json!({ "engine": engine, "model": model });
    let resp = client
        .post(format!("{base}/models/download"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载请求失败：HTTP {}", resp.status().as_u16()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    v.get("jobId")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "sidecar 响应缺少 jobId".to_string())
}

#[tauri::command]
pub async fn get_model_download_progress(
    app: AppHandle,
    state: State<'_, AsrState>,
    job_id: String,
) -> Result<serde_json::Value, String> {
    let base = ensure_base_url(&app, &state).await?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{base}/models/download/{job_id}"))
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    if resp.status().as_u16() == 404 {
        return Err("下载任务不存在".into());
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_asr(
    app: AppHandle,
    state: State<'_, AsrState>,
    job_id: String,
) -> Result<(), String> {
    let base = match known_job_base_url(&state, &job_id).await {
        Some(url) => url,
        None => ensure_base_url(&app, &state).await?,
    };
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base}/jobs/{job_id}/cancel"))
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar（jobId={job_id}, sidecar={base}）：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("取消失败：HTTP {}", resp.status().as_u16()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("hikaru_sub_{name}_{unique}"))
    }

    #[test]
    fn recovery_snapshot_path_is_derived_from_audio_parent() {
        let path =
            recovery_snapshot_path_for_audio(r"C:\video\.hikaru\audio.wav", "abc123").unwrap();

        assert!(path.ends_with(Path::new(".hikaru").join("asr-jobs").join("abc123.json")));
    }

    #[test]
    fn read_recovery_snapshot_strips_segments_when_not_requested() {
        let dir = temp_dir("asr_recovery");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("job.json");
        fs::write(
            &path,
            r#"{
              "id": "job-1",
              "status": "completed",
              "progress": 1.0,
              "durationMs": 1200,
              "processedMs": 1200,
              "segmentCount": 1,
              "detectedLanguage": "ja",
              "error": null,
              "segments": [{"startMs": 0, "endMs": 1200, "text": "こんにちは"}]
            }"#,
        )
        .unwrap();

        let without_segments = read_recovery_snapshot(&path, "job-1", false)
            .unwrap()
            .unwrap();
        assert!(without_segments.get("segments").is_none());
        assert_eq!(without_segments["status"], "completed");

        let with_segments = read_recovery_snapshot(&path, "job-1", true)
            .unwrap()
            .unwrap();
        assert_eq!(with_segments["segments"].as_array().unwrap().len(), 1);

        fs::remove_dir_all(&dir).unwrap();
    }
}
