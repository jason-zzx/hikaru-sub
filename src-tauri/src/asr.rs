//! ASR sidecar 进程管理与 HTTP 代理。
//!
//! Rust 负责按需拉起 Python sidecar（读取其 stdout 的就绪端口），并以 reqwest
//! 代理转录任务的创建/查询/取消，使前端无需直接处理本地 HTTP 与端口。

use crate::settings::{load_settings, AppSettings};
use serde::Deserialize;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

/// 正在运行的 sidecar 句柄。
pub struct Sidecar {
    base_url: String,
    child: Child,
}

impl Sidecar {
    pub fn kill(&mut self) {
        let _ = self.child.kill();
    }
}

/// 受 Tauri 托管的全局 sidecar 状态（至多一个进程）。
#[derive(Default)]
pub struct AsrState(pub Mutex<Option<Sidecar>>);

#[derive(Deserialize)]
struct ReadyLine {
    event: String,
    port: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAsrArgs {
    audio_path: String,
    engine: String,
    model: String,
    device: String,
    language: Option<String>,
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

/// 候选 Python 解释器：设置优先，再按平台回退。
fn python_candidates(settings: &AppSettings) -> Vec<String> {
    let mut v = Vec::new();
    if let Some(p) = settings
        .python_path
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        v.push(p.clone());
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
    let mut child = Command::new(python)
        .args(["main.py", "--host", "127.0.0.1", "--port", "0"])
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("启动 sidecar 失败（{python}）：{e}"))?;

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

    Ok(Sidecar { base_url, child })
}

/// 确保 sidecar 在运行并返回其 base_url（必要时拉起新进程）。
async fn ensure_base_url(app: &AppHandle, state: &AsrState) -> Result<String, String> {
    let mut guard = state.0.lock().await;

    if let Some(sc) = guard.as_mut() {
        match sc.child.try_wait() {
            Ok(None) => return Ok(sc.base_url.clone()), // 仍在运行
            _ => {
                *guard = None; // 已退出，丢弃后重启
            }
        }
    }

    let settings = load_settings(app).unwrap_or_default();
    let dir = resolve_service_dir(app, &settings)?;
    let pythons = python_candidates(&settings);

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
    v.get("jobId")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "sidecar 响应缺少 jobId".to_string())
}

#[tauri::command]
pub async fn get_asr_progress(
    app: AppHandle,
    state: State<'_, AsrState>,
    job_id: String,
    include_segments: Option<bool>,
) -> Result<serde_json::Value, String> {
    let base = ensure_base_url(&app, &state).await?;
    let client = reqwest::Client::new();
    let seg = include_segments.unwrap_or(true);
    let resp = client
        .get(format!("{base}/jobs/{job_id}"))
        .query(&[("segments", if seg { "true" } else { "false" })])
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    if resp.status().as_u16() == 404 {
        return Err("转录任务不存在".into());
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
    let base = ensure_base_url(&app, &state).await?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base}/jobs/{job_id}/cancel"))
        .send()
        .await
        .map_err(|e| format!("无法连接 sidecar：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("取消失败：HTTP {}", resp.status().as_u16()));
    }
    Ok(())
}
