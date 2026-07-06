use crate::process::hidden_command;
use crate::settings::{load_settings, save_settings};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

const LOG_TAIL_LIMIT: usize = 200;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AsrSetupProfile {
    Default,
    ParakeetCpu,
    ParakeetCuda,
    Qwen3Cpu,
    Qwen3Cuda,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AsrSetupStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAsrSetupArgs {
    pub profile: AsrSetupProfile,
    #[serde(default)]
    pub recreate: bool,
    #[serde(default)]
    pub python_path: Option<String>,
    #[serde(default)]
    pub asr_service_path: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeAsrSetupEnvironmentArgs {
    #[serde(default)]
    pub python_path: Option<String>,
    #[serde(default)]
    pub asr_service_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrSetupSnapshot {
    pub id: String,
    pub status: AsrSetupStatus,
    pub profile: AsrSetupProfile,
    pub stage: String,
    pub progress: Option<f64>,
    pub log_tail: Vec<String>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrSetupEnvironment {
    pub service_template_path: Option<String>,
    pub managed_service_path: String,
    pub python_path: Option<String>,
    pub python_version: Option<String>,
    pub python_ok: bool,
    pub venv_path: String,
    pub venv_exists: bool,
    pub has_nvidia_gpu: bool,
}

#[derive(Default)]
pub struct AsrSetupState {
    jobs: Mutex<HashMap<String, Arc<StdMutex<AsrSetupJob>>>>,
}

struct AsrSetupJob {
    id: String,
    profile: AsrSetupProfile,
    status: AsrSetupStatus,
    stage: String,
    progress: Option<f64>,
    log_tail: VecDeque<String>,
    exit_code: Option<i32>,
    error: Option<String>,
    current_pid: Option<u32>,
    cancel_requested: bool,
}

impl AsrSetupState {
    pub fn shutdown(&self) {
        if let Ok(jobs) = self.jobs.try_lock() {
            for job in jobs.values() {
                if let Ok(mut guard) = job.lock() {
                    if let Some(pid) = guard.current_pid {
                        kill_process_tree(pid);
                        guard.current_pid = None;
                    }
                }
            }
        }
    }
}

impl AsrSetupJob {
    fn new(id: String, profile: AsrSetupProfile) -> Self {
        Self {
            id,
            profile,
            status: AsrSetupStatus::Pending,
            stage: "等待开始".into(),
            progress: Some(0.0),
            log_tail: VecDeque::new(),
            exit_code: None,
            error: None,
            current_pid: None,
            cancel_requested: false,
        }
    }

    fn snapshot(&self) -> AsrSetupSnapshot {
        AsrSetupSnapshot {
            id: self.id.clone(),
            status: self.status,
            profile: self.profile,
            stage: self.stage.clone(),
            progress: self.progress,
            log_tail: self.log_tail.iter().cloned().collect(),
            exit_code: self.exit_code,
            error: self.error.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PythonCommand {
    program: String,
    args: Vec<String>,
}

impl PythonCommand {
    fn display(&self) -> String {
        if self.args.is_empty() {
            self.program.clone()
        } else {
            format!("{} {}", self.program, self.args.join(" "))
        }
    }
}

fn requirements_for_profile(profile: AsrSetupProfile) -> &'static [&'static str] {
    match profile {
        AsrSetupProfile::Default => &["requirements.txt"],
        AsrSetupProfile::ParakeetCpu => &["requirements.txt", "requirements-parakeet-cpu.txt"],
        AsrSetupProfile::ParakeetCuda => &["requirements.txt", "requirements-parakeet-cuda.txt"],
        AsrSetupProfile::Qwen3Cpu => &["requirements.txt", "requirements-qwen3-cpu.txt"],
        AsrSetupProfile::Qwen3Cuda => &["requirements.txt", "requirements-qwen3-cuda.txt"],
    }
}

fn engine_for_profile(profile: AsrSetupProfile) -> &'static str {
    match profile {
        AsrSetupProfile::Default => "faster-whisper",
        AsrSetupProfile::ParakeetCpu | AsrSetupProfile::ParakeetCuda => "parakeet",
        AsrSetupProfile::Qwen3Cpu | AsrSetupProfile::Qwen3Cuda => "qwen3-asr",
    }
}

fn push_log(job: &mut AsrSetupJob, line: impl Into<String>) {
    job.log_tail.push_back(line.into());
    while job.log_tail.len() > LOG_TAIL_LIMIT {
        job.log_tail.pop_front();
    }
}

fn set_stage(job: &Arc<StdMutex<AsrSetupJob>>, stage: &str, progress: Option<f64>) {
    if let Ok(mut guard) = job.lock() {
        guard.stage = stage.to_string();
        guard.progress = progress;
        if guard.status == AsrSetupStatus::Pending {
            guard.status = AsrSetupStatus::Running;
        }
        push_log(&mut guard, format!("==> {stage}"));
    }
}

fn finish_job(job: &Arc<StdMutex<AsrSetupJob>>, status: AsrSetupStatus, error: Option<String>) {
    if let Ok(mut guard) = job.lock() {
        if guard.status == AsrSetupStatus::Cancelled {
            return;
        }
        guard.status = status;
        guard.error = error;
        guard.current_pid = None;
        if status == AsrSetupStatus::Completed {
            guard.stage = "完成".into();
            guard.progress = Some(1.0);
        }
    }
}

fn is_cancelled(job: &Arc<StdMutex<AsrSetupJob>>) -> bool {
    job.lock()
        .map(|guard| guard.cancel_requested || guard.status == AsrSetupStatus::Cancelled)
        .unwrap_or(true)
}

fn managed_service_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("asr-service"))
}

fn venv_dir(service_dir: &Path) -> PathBuf {
    service_dir.join(".venv")
}

fn venv_python_path(service_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        service_dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        service_dir.join(".venv").join("bin").join("python")
    }
}

fn should_copy_template_entry(path: &Path) -> bool {
    let ignored = [
        ".cache",
        ".venv",
        "venv",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        "tests",
        "models",
        "model-cache",
    ];
    !path.components().any(|part| {
        let text = part.as_os_str().to_string_lossy();
        ignored.contains(&text.as_ref()) || text.ends_with(".egg-info") || text.ends_with(".log")
    })
}

fn copy_template_dir(source: &Path, target: &Path) -> Result<(), String> {
    if !source.join("main.py").is_file() {
        return Err(format!("ASR 服务模板无效：{}", source.display()));
    }
    copy_dir_contents(source, target)
}

fn copy_dir_contents(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src = entry.path();
        if !should_copy_template_entry(&src) {
            continue;
        }
        let dst = target.join(entry.file_name());
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_dir() {
            copy_dir_contents(&src, &dst)?;
        } else if ty.is_file() {
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(&src, &dst).map_err(|e| {
                format!(
                    "复制 ASR 服务文件失败（{} -> {}）：{e}",
                    src.display(),
                    dst.display()
                )
            })?;
        }
    }
    Ok(())
}

fn clean_managed_service_dir(target: &Path, recreate: bool) -> Result<(), String> {
    if recreate {
        let venv = venv_dir(target);
        if venv.exists() {
            std::fs::remove_dir_all(&venv)
                .map_err(|e| format!("删除虚拟环境失败（{}）：{e}", venv.display()))?;
        }
    }
    if !target.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(target).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_name().to_string_lossy() == ".venv" {
            continue;
        }
        let path = entry.path();
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_dir() {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("清理 ASR 服务目录失败（{}）：{e}", path.display()))?;
        } else {
            std::fs::remove_file(&path)
                .map_err(|e| format!("清理 ASR 服务文件失败（{}）：{e}", path.display()))?;
        }
    }
    Ok(())
}

fn python_candidates(explicit: Option<&str>) -> Vec<PythonCommand> {
    let mut candidates = Vec::new();
    if let Some(path) = explicit.filter(|s| !s.trim().is_empty()) {
        candidates.push(PythonCommand {
            program: path.to_string(),
            args: vec![],
        });
    }
    if cfg!(windows) {
        candidates.push(PythonCommand {
            program: "python".into(),
            args: vec![],
        });
        candidates.push(PythonCommand {
            program: "py".into(),
            args: vec!["-3".into()],
        });
    } else {
        candidates.push(PythonCommand {
            program: "python3".into(),
            args: vec![],
        });
        candidates.push(PythonCommand {
            program: "python".into(),
            args: vec![],
        });
    }
    candidates
}

fn command_output(
    program: &str,
    base_args: &[String],
    args: &[&str],
    cwd: Option<&Path>,
) -> Result<std::process::Output, String> {
    let mut command = hidden_command(program);
    command.args(base_args).args(args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    command.output().map_err(|e| {
        let mut all_args = base_args.to_vec();
        all_args.extend(args.iter().map(|arg| arg.to_string()));
        format!("执行命令失败（{} {}）：{e}", program, all_args.join(" "))
    })
}

fn python_version(command: &PythonCommand) -> Result<String, String> {
    let output = command_output(
        &command.program,
        &command.args,
        &[
            "-c",
            "import sys; print('.'.join(map(str, sys.version_info[:3]))); raise SystemExit(0 if sys.version_info >= (3, 10) else 1)",
        ],
        None,
    )?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        Err(if stdout.is_empty() {
            format!("Python 版本低于 3.10 或不可用：{}", command.display())
        } else {
            format!("Python 版本低于 3.10：{stdout}")
        })
    }
}

fn find_python(explicit: Option<&str>) -> Option<(PythonCommand, String)> {
    python_candidates(explicit)
        .into_iter()
        .find_map(|candidate| {
            python_version(&candidate)
                .ok()
                .map(|version| (candidate, version))
        })
}

fn has_nvidia_gpu() -> bool {
    hidden_command("nvidia-smi")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn is_cuda_profile(profile: AsrSetupProfile) -> bool {
    matches!(
        profile,
        AsrSetupProfile::ParakeetCuda | AsrSetupProfile::Qwen3Cuda
    )
}

fn paths_equivalent(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn configured_template_dir(configured: Option<&str>, managed: Option<&Path>) -> Option<PathBuf> {
    let path = configured?.trim();
    if path.is_empty() {
        return None;
    }
    let dir = PathBuf::from(path);
    if !dir.join("main.py").is_file() {
        return None;
    }
    if managed.is_some_and(|managed| paths_equivalent(&dir, managed)) {
        return None;
    }
    Some(dir)
}

fn resolve_template_dir(
    app: &AppHandle,
    configured: Option<&str>,
    managed: Option<&Path>,
) -> Result<PathBuf, String> {
    if let Some(dir) = configured_template_dir(configured, managed) {
        return Ok(dir);
    }
    if let Ok(dir) = app.path().resolve("asr-service", BaseDirectory::Resource) {
        if dir.join("main.py").is_file() {
            return Ok(dir);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for dir in [cwd.join("asr-service"), cwd.join("..").join("asr-service")] {
            if dir.join("main.py").is_file() {
                return Ok(dir);
            }
        }
    }
    Err("未找到 ASR 服务模板（asr-service/main.py）".into())
}

fn setup_job_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("asr-setup-{millis}")
}

fn kill_process_tree(pid: u32) {
    if cfg!(windows) {
        let _ = hidden_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    } else {
        let group = format!("-{pid}");
        let group_status = hidden_command("kill")
            .args(["-TERM", &group])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if !group_status.map(|status| status.success()).unwrap_or(false) {
            let _ = hidden_command("kill")
                .args(["-TERM", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

fn run_logged_command(
    job: &Arc<StdMutex<AsrSetupJob>>,
    stage: &str,
    progress: Option<f64>,
    program: &Path,
    args: &[String],
    cwd: &Path,
) -> Result<(), String> {
    if is_cancelled(job) {
        return Err("用户已取消 ASR 引擎配置".into());
    }
    set_stage(job, stage, progress);

    let mut command = hidden_command(program);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|e| format!("{stage}失败：{e}"))?;

    let pid = child.id();
    if let Ok(mut guard) = job.lock() {
        guard.current_pid = Some(pid);
        push_log(
            &mut guard,
            format!(
                "$ {} {}",
                program.display(),
                args.iter()
                    .map(|arg| {
                        if arg.contains(' ') {
                            format!("\"{arg}\"")
                        } else {
                            arg.clone()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
            ),
        );
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut readers = Vec::new();
    if let Some(pipe) = stdout {
        readers.push(spawn_log_reader(Arc::clone(job), pipe));
    }
    if let Some(pipe) = stderr {
        readers.push(spawn_log_reader(Arc::clone(job), pipe));
    }

    let status = child.wait().map_err(|e| format!("{stage}失败：{e}"))?;
    for reader in readers {
        let _ = reader.join();
    }

    if let Ok(mut guard) = job.lock() {
        guard.current_pid = None;
        guard.exit_code = status.code();
    }

    if is_cancelled(job) {
        return Err("用户已取消 ASR 引擎配置".into());
    }
    if !status.success() {
        return Err(format!(
            "{stage}失败：退出码 {}",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "未知".into())
        ));
    }
    Ok(())
}

fn spawn_log_reader<R: Read + Send + 'static>(
    job: Arc<StdMutex<AsrSetupJob>>,
    pipe: R,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let reader = BufReader::new(pipe);
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(mut guard) = job.lock() {
                push_log(&mut guard, line);
            }
        }
    })
}

fn run_python_command(
    job: &Arc<StdMutex<AsrSetupJob>>,
    stage: &str,
    progress: Option<f64>,
    python: &PythonCommand,
    args: &[&str],
    cwd: &Path,
) -> Result<(), String> {
    let mut full_args = python.args.clone();
    full_args.extend(args.iter().map(|arg| arg.to_string()));
    run_logged_command(
        job,
        stage,
        progress,
        Path::new(&python.program),
        &full_args,
        cwd,
    )
}

fn run_venv_python_command(
    job: &Arc<StdMutex<AsrSetupJob>>,
    stage: &str,
    progress: Option<f64>,
    service_dir: &Path,
    args: &[&str],
) -> Result<(), String> {
    let python = venv_python_path(service_dir);
    let args = args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
    run_logged_command(job, stage, progress, &python, &args, service_dir)
}

fn verify_engine_available(service_dir: &Path, profile: AsrSetupProfile) -> Result<(), String> {
    let python = venv_python_path(service_dir);
    let output = hidden_command(&python)
        .arg("-c")
        .arg("from engines.registry import list_engines; import json; print('HIKARU_ENGINES_JSON=' + json.dumps(list_engines()))")
        .current_dir(service_dir)
        .output()
        .map_err(|e| format!("验证引擎依赖失败：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(format!("验证引擎依赖失败：{}", stderr.trim()));
    }
    let line = stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix("HIKARU_ENGINES_JSON="))
        .ok_or_else(|| "验证引擎依赖失败：未返回引擎列表".to_string())?;
    let engines: Vec<serde_json::Value> =
        serde_json::from_str(line).map_err(|e| format!("解析引擎列表失败：{e}"))?;
    let required = engine_for_profile(profile);
    let ok = engines.iter().any(|engine| {
        engine.get("name").and_then(|value| value.as_str()) == Some(required)
            && engine
                .get("available")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
    });
    if ok {
        Ok(())
    } else {
        Err(format!("引擎依赖安装后仍不可用：{required}"))
    }
}

fn run_setup_job(
    app: AppHandle,
    job: Arc<StdMutex<AsrSetupJob>>,
    args: StartAsrSetupArgs,
) -> Result<(), String> {
    if is_cuda_profile(args.profile) && !has_nvidia_gpu() {
        return Err("未检测到 NVIDIA GPU，不能安装 CUDA 版 ASR 依赖".into());
    }

    set_stage(&job, "准备 ASR 服务目录", Some(0.05));
    let managed = managed_service_dir(&app)?;
    let source = resolve_template_dir(&app, args.asr_service_path.as_deref(), Some(&managed))?;
    clean_managed_service_dir(&managed, args.recreate)?;
    copy_template_dir(&source, &managed)?;

    set_stage(&job, "检查 Python", Some(0.10));
    let (python, version) = find_python(args.python_path.as_deref())
        .ok_or_else(|| "未检测到 Python 3.10+，请先在设置中配置 Python 路径。".to_string())?;
    if let Ok(mut guard) = job.lock() {
        push_log(
            &mut guard,
            format!("使用 Python {version} ({})", python.display()),
        );
    }

    if !venv_python_path(&managed).is_file() {
        run_python_command(
            &job,
            "创建虚拟环境",
            Some(0.20),
            &python,
            &["-m", "venv", ".venv"],
            &managed,
        )?;
    } else {
        set_stage(&job, "复用虚拟环境", Some(0.20));
    }

    run_venv_python_command(
        &job,
        "升级 pip",
        Some(0.35),
        &managed,
        &["-m", "pip", "install", "--upgrade", "pip"],
    )?;

    let requirements = requirements_for_profile(args.profile);
    for (index, requirement) in requirements.iter().enumerate() {
        let progress = if index == 0 { 0.60 } else { 0.85 };
        let stage = if index == 0 {
            "安装 faster-whisper 依赖".to_string()
        } else {
            format!("安装可选引擎依赖（{requirement}）")
        };
        run_venv_python_command(
            &job,
            &stage,
            Some(progress),
            &managed,
            &["-m", "pip", "install", "-r", requirement],
        )?;
    }

    set_stage(&job, "验证引擎依赖", Some(0.92));
    verify_engine_available(&managed, args.profile)?;

    set_stage(&job, "保存设置", Some(0.97));
    let mut settings = load_settings(&app).unwrap_or_default();
    settings.asr_service_path = Some(managed.to_string_lossy().into_owned());
    settings.python_path = Some(venv_python_path(&managed).to_string_lossy().into_owned());
    save_settings(&app, &settings)?;

    Ok(())
}

#[tauri::command]
pub async fn probe_asr_setup_environment(
    app: AppHandle,
    args: ProbeAsrSetupEnvironmentArgs,
) -> Result<AsrSetupEnvironment, String> {
    let managed = managed_service_dir(&app)?;
    let template =
        resolve_template_dir(&app, args.asr_service_path.as_deref(), Some(&managed)).ok();
    let python = find_python(args.python_path.as_deref());
    let venv = venv_dir(&managed);
    Ok(AsrSetupEnvironment {
        service_template_path: template.map(|path| path.to_string_lossy().into_owned()),
        managed_service_path: managed.to_string_lossy().into_owned(),
        python_path: python.as_ref().map(|(cmd, _)| cmd.display()),
        python_version: python.as_ref().map(|(_, version)| version.clone()),
        python_ok: python.is_some(),
        venv_path: venv.to_string_lossy().into_owned(),
        venv_exists: venv.is_dir(),
        has_nvidia_gpu: has_nvidia_gpu(),
    })
}

#[tauri::command]
pub async fn start_asr_setup(
    app: AppHandle,
    setup_state: State<'_, AsrSetupState>,
    asr_state: State<'_, crate::asr::AsrState>,
    args: StartAsrSetupArgs,
) -> Result<String, String> {
    crate::asr::stop_sidecar(&asr_state).await;

    let id = setup_job_id();
    let job = Arc::new(StdMutex::new(AsrSetupJob::new(id.clone(), args.profile)));
    setup_state
        .jobs
        .lock()
        .await
        .insert(id.clone(), Arc::clone(&job));

    tauri::async_runtime::spawn_blocking(move || {
        let result = run_setup_job(app, Arc::clone(&job), args);
        match result {
            Ok(()) => finish_job(&job, AsrSetupStatus::Completed, None),
            Err(error) => {
                if is_cancelled(&job) {
                    finish_job(&job, AsrSetupStatus::Cancelled, Some(error));
                } else {
                    finish_job(&job, AsrSetupStatus::Failed, Some(error));
                }
            }
        }
    });

    Ok(id)
}

#[tauri::command]
pub async fn get_asr_setup_progress(
    setup_state: State<'_, AsrSetupState>,
    job_id: String,
) -> Result<AsrSetupSnapshot, String> {
    let jobs = setup_state.jobs.lock().await;
    let job = jobs
        .get(&job_id)
        .ok_or_else(|| "ASR 配置任务不存在".to_string())?;
    let guard = job
        .lock()
        .map_err(|_| "ASR 配置任务状态已损坏".to_string())?;
    Ok(guard.snapshot())
}

#[tauri::command]
pub async fn cancel_asr_setup(
    setup_state: State<'_, AsrSetupState>,
    job_id: String,
) -> Result<(), String> {
    let jobs = setup_state.jobs.lock().await;
    let job = jobs
        .get(&job_id)
        .ok_or_else(|| "ASR 配置任务不存在".to_string())?;
    let mut guard = job
        .lock()
        .map_err(|_| "ASR 配置任务状态已损坏".to_string())?;
    guard.cancel_requested = true;
    guard.status = AsrSetupStatus::Cancelled;
    guard.progress = None;
    guard.stage = "已取消".into();
    guard.error = Some("用户已取消 ASR 引擎配置".into());
    if let Some(pid) = guard.current_pid.take() {
        kill_process_tree(pid);
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
    fn profile_maps_to_expected_requirements() {
        assert_eq!(
            requirements_for_profile(AsrSetupProfile::Default),
            ["requirements.txt"]
        );
        assert_eq!(
            requirements_for_profile(AsrSetupProfile::ParakeetCpu),
            ["requirements.txt", "requirements-parakeet-cpu.txt"]
        );
        assert_eq!(
            requirements_for_profile(AsrSetupProfile::Qwen3Cuda),
            ["requirements.txt", "requirements-qwen3-cuda.txt"]
        );
    }

    #[test]
    fn profile_maps_to_engine_name() {
        assert_eq!(
            engine_for_profile(AsrSetupProfile::Default),
            "faster-whisper"
        );
        assert_eq!(
            engine_for_profile(AsrSetupProfile::ParakeetCuda),
            "parakeet"
        );
        assert_eq!(engine_for_profile(AsrSetupProfile::Qwen3Cpu), "qwen3-asr");
    }

    #[test]
    fn log_tail_is_bounded() {
        let mut job = AsrSetupJob::new("job-1".into(), AsrSetupProfile::Default);
        for i in 0..250 {
            push_log(&mut job, format!("line {i}"));
        }
        assert_eq!(job.log_tail.len(), LOG_TAIL_LIMIT);
        assert_eq!(job.log_tail.front().map(String::as_str), Some("line 50"));
        assert_eq!(job.log_tail.back().map(String::as_str), Some("line 249"));
    }

    #[test]
    fn copy_template_skips_runtime_artifacts() {
        let source = temp_dir("asr_template_source");
        let target = temp_dir("asr_template_target");
        fs::create_dir_all(source.join(".venv")).unwrap();
        fs::create_dir_all(source.join("__pycache__")).unwrap();
        fs::create_dir_all(source.join("tests")).unwrap();
        fs::create_dir_all(source.join("model-cache")).unwrap();
        fs::create_dir_all(source.join("engines")).unwrap();
        fs::write(source.join("main.py"), "").unwrap();
        fs::write(source.join("requirements.txt"), "").unwrap();
        fs::write(source.join("asr-debug.log"), "").unwrap();
        fs::write(source.join("debug-output.log"), "").unwrap();
        fs::write(source.join(".venv").join("python"), "").unwrap();
        fs::write(source.join("model-cache").join("large.bin"), "").unwrap();
        fs::write(source.join("engines").join("registry.py"), "").unwrap();

        copy_template_dir(&source, &target).unwrap();

        assert!(target.join("main.py").is_file());
        assert!(target.join("requirements.txt").is_file());
        assert!(target.join("engines").join("registry.py").is_file());
        assert!(!target.join(".venv").exists());
        assert!(!target.join("__pycache__").exists());
        assert!(!target.join("tests").exists());
        assert!(!target.join("asr-debug.log").exists());
        assert!(!target.join("debug-output.log").exists());
        assert!(!target.join("model-cache").exists());

        let _ = fs::remove_dir_all(source);
        let _ = fs::remove_dir_all(target);
    }

    #[test]
    fn clean_managed_service_preserves_venv_unless_recreate() {
        let dir = temp_dir("asr_managed_clean");
        fs::create_dir_all(dir.join(".venv")).unwrap();
        fs::write(dir.join("old.py"), "").unwrap();

        clean_managed_service_dir(&dir, false).unwrap();
        assert!(dir.join(".venv").is_dir());
        assert!(!dir.join("old.py").exists());

        clean_managed_service_dir(&dir, true).unwrap();
        assert!(!dir.join(".venv").exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn configured_template_dir_ignores_managed_service_dir() {
        let managed = temp_dir("asr_managed_template");
        let custom = temp_dir("asr_custom_template");
        fs::create_dir_all(&managed).unwrap();
        fs::create_dir_all(&custom).unwrap();
        fs::write(managed.join("main.py"), "").unwrap();
        fs::write(custom.join("main.py"), "").unwrap();

        assert_eq!(
            configured_template_dir(managed.to_str(), Some(&managed)),
            None
        );
        assert_eq!(
            configured_template_dir(custom.to_str(), Some(&managed)),
            Some(custom.clone())
        );

        let _ = fs::remove_dir_all(managed);
        let _ = fs::remove_dir_all(custom);
    }

    #[test]
    fn python_candidates_put_explicit_path_first() {
        let candidates = python_candidates(Some("custom-python"));
        assert_eq!(
            candidates.first().map(|cmd| cmd.program.as_str()),
            Some("custom-python")
        );
    }
}
