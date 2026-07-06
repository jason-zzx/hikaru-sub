# ASR Engine One-Click Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows/macOS-ready client flow that installs ASR sidecar Python dependencies from the desktop app and leaves the selected engine usable without manual shell commands.

**Architecture:** Package a clean `asr-service` template as a Tauri resource, copy it to an app-data managed directory at setup time, create or reuse `.venv` there, and run Python/pip directly from Rust as a cancellable setup job. Settings gets the full one-click setup panel; Transcribe gets a lightweight “go configure dependencies” action when the selected engine is unavailable.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Vite, pnpm, Python venv/pip, existing ASR FastAPI sidecar.

---

## Project Rule Override

Repository instructions forbid autonomous commits. Any commit steps implied by skills must be skipped. After verification, report changed files and ask the user whether to commit.

Linux remains out of scope for this plan.

## File Structure

- Create `scripts/prepare-asr-resource.mjs`: copies a clean `asr-service` template into `src-tauri/resources/asr-service`.
- Modify `package.json`: add `asr:prepare-resource` and run it from local release packaging.
- Modify `.github/workflows/release.yml`: prepare the ASR resource before Tauri packaging.
- Modify `src-tauri/tauri.conf.json`: bundle `binaries/*` and the prepared ASR resource with explicit resource targets.
- Modify `src-tauri/src/asr.rs`: expose a safe sidecar stop helper used before setup mutates the venv.
- Create `src-tauri/src/asr_setup.rs`: setup job state, profile mapping, Python discovery, managed service copy, pip execution, progress snapshots, cancellation, and environment probe commands.
- Modify `src-tauri/src/lib.rs`: register `asr_setup` state and commands, and stop setup jobs on exit.
- Modify `src/types/index.ts`: add setup types.
- Modify `src/services/tauri.ts`: add setup command wrappers.
- Add `src/services/tauriAsrSetup.test.ts`: mock Tauri `invoke` and verify wrapper command names.
- Create `src/constants/asrSetup.ts`: pure profile-resolution helpers and labels.
- Create `src/components/workflow/AsrEngineSetupPanel.tsx`: Settings UI for setup.
- Modify `src/components/workflow/SettingsView.tsx`: mount setup panel and refresh model status after setup.
- Modify `src/components/workflow/TranscribeView.tsx`: show settings navigation when engine dependencies are unavailable.
- Modify `README.md` and `asr-service/README.md`: document client setup and clarify that model weights remain separate.
- Add tests:
  - `src/constants/asrSetup.test.ts`
  - `tests/SettingsViewAsrSetup.test.ts`
  - `tests/TranscribeViewAsrSetup.test.ts`
  - Rust tests inside `src-tauri/src/asr_setup.rs`

## Task 1: Prepare ASR Service Resource For Packaging

**Files:**
- Create: `scripts/prepare-asr-resource.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Write the resource preparation script**

Create `scripts/prepare-asr-resource.mjs`:

```js
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "asr-service");
const target = join(root, "src-tauri", "resources", "asr-service");

const ignoredNames = new Set([
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "asr-debug.log",
]);

function shouldCopy(src) {
  const rel = relative(source, src);
  if (!rel) return true;
  const parts = rel.split(/[\\/]+/);
  if (parts.some((part) => ignoredNames.has(part))) return false;
  if (parts.some((part) => part.endsWith(".egg-info"))) return false;
  if (parts.includes("models") || parts.includes("model-cache")) return false;
  return true;
}

if (!existsSync(join(source, "main.py"))) {
  throw new Error(`missing asr-service template: ${source}`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

cpSync(source, target, {
  recursive: true,
  filter(src) {
    if (!shouldCopy(src)) return false;
    const stats = statSync(src);
    return stats.isDirectory() || stats.isFile();
  },
});

console.log(`prepared ASR resource: ${target}`);
```

- [ ] **Step 2: Add package scripts**

Edit only the `scripts` object in `package.json` so these entries exist:

```json
"asr:prepare-resource": "node scripts/prepare-asr-resource.mjs",
"release:local": "pnpm ffmpeg:fetch && pnpm asr:prepare-resource && tauri build"
```

Keep `asr:setup` as the existing developer command:

```json
"asr:setup": "bash scripts/setup-asr.sh"
```

- [ ] **Step 3: Update Tauri bundled resources**

Change `src-tauri/tauri.conf.json` from the resource array to an object map:

```json
"resources": {
  "binaries/*": "binaries/",
  "resources/asr-service/": "asr-service/"
}
```

This keeps FFmpeg at `resource_dir()/binaries/...` and places the ASR template at the Tauri resource path `asr-service`. Runtime code should resolve the template with Tauri's resource base directory API, not by assuming the current working directory.

- [ ] **Step 4: Update release workflow**

In `.github/workflows/release.yml`, add this step after `Fetch FFmpeg` and before tests/builds:

```yaml
      - name: Prepare ASR resource
        run: pnpm asr:prepare-resource
```

- [ ] **Step 5: Verify resource preparation**

Run:

```bash
pnpm asr:prepare-resource
```

Expected: command exits `0`, prints `prepared ASR resource`, and `src-tauri/resources/asr-service/main.py` exists.

- [ ] **Step 6: Verify resource exclusions**

Run:

```bash
node -e "const fs=require('fs'); for (const p of ['src-tauri/resources/asr-service/.venv','src-tauri/resources/asr-service/venv','src-tauri/resources/asr-service/asr-debug.log']) { if (fs.existsSync(p)) throw new Error('copied ignored path '+p); } console.log('resource exclusions ok')"
```

Expected: `resource exclusions ok`.

## Task 2: Add Rust Setup Types And Pure Helpers

**Files:**
- Create: `src-tauri/src/asr_setup.rs`

- [ ] **Step 1: Add the module skeleton with serializable types**

Create `src-tauri/src/asr_setup.rs` with public command-facing types and pure helpers:

```rust
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::{Arc, Mutex as StdMutex};
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
    current_child: Option<Child>,
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
            current_child: None,
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

fn requirements_for_profile(profile: AsrSetupProfile) -> &'static [&'static str] {
    match profile {
        AsrSetupProfile::Default => &["requirements.txt"],
        AsrSetupProfile::ParakeetCpu => &["requirements.txt", "requirements-parakeet-cpu.txt"],
        AsrSetupProfile::ParakeetCuda => &["requirements.txt", "requirements-parakeet-cuda.txt"],
        AsrSetupProfile::Qwen3Cpu => &["requirements.txt", "requirements-qwen3-cpu.txt"],
        AsrSetupProfile::Qwen3Cuda => &["requirements.txt", "requirements-qwen3-cuda.txt"],
    }
}

fn push_log(job: &mut AsrSetupJob, line: impl Into<String>) {
    job.log_tail.push_back(line.into());
    while job.log_tail.len() > LOG_TAIL_LIMIT {
        job.log_tail.pop_front();
    }
}
```

- [ ] **Step 2: Add pure unit tests for profile mapping and log trimming**

At the bottom of `asr_setup.rs`, add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_maps_to_expected_requirements() {
        assert_eq!(requirements_for_profile(AsrSetupProfile::Default), ["requirements.txt"]);
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
    fn log_tail_is_bounded() {
        let mut job = AsrSetupJob::new("job-1".into(), AsrSetupProfile::Default);
        for i in 0..250 {
            push_log(&mut job, format!("line {i}"));
        }
        assert_eq!(job.log_tail.len(), LOG_TAIL_LIMIT);
        assert_eq!(job.log_tail.front().map(String::as_str), Some("line 50"));
        assert_eq!(job.log_tail.back().map(String::as_str), Some("line 249"));
    }
}
```

- [ ] **Step 3: Run focused Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_setup
```

Expected initially after module registration in a later task: the tests compile and pass. If this task is run before `mod asr_setup;`, expect no tests to run; continue after Task 4 and rerun.

## Task 3: Implement Managed Service Copy, Python Discovery, And Pip Execution

**Files:**
- Modify: `src-tauri/src/asr_setup.rs`

- [ ] **Step 1: Add path helpers**

Add helpers below `push_log`:

```rust
fn managed_service_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("asr-service"))
}

fn venv_python_path(service_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        service_dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        service_dir.join(".venv").join("bin").join("python")
    }
}

fn venv_dir(service_dir: &Path) -> PathBuf {
    service_dir.join(".venv")
}
```

- [ ] **Step 2: Add clean-copy helpers**

Add recursive copy helpers that skip venv/cache/log files:

```rust
fn should_copy_template_entry(path: &Path) -> bool {
    let ignored = [".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"];
    !path.components().any(|part| {
        let text = part.as_os_str().to_string_lossy();
        ignored.contains(&text.as_ref()) || text.ends_with(".egg-info") || text == "asr-debug.log"
    })
}

fn copy_template_dir(source: &Path, target: &Path) -> Result<(), String> {
    if !source.join("main.py").is_file() {
        return Err(format!("ASR 服务模板无效：{}", source.display()));
    }
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
            copy_template_dir(&src, &dst)?;
        } else if ty.is_file() {
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(&src, &dst).map_err(|e| {
                format!("复制 ASR 服务文件失败（{} -> {}）：{e}", src.display(), dst.display())
            })?;
        }
    }
    Ok(())
}
```

- [ ] **Step 3: Add Python command candidates**

Represent Windows `py -3` as a program plus args:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
struct PythonCommand {
    program: String,
    args: Vec<String>,
}

fn python_candidates(explicit: Option<&str>) -> Vec<PythonCommand> {
    let mut candidates = Vec::new();
    if let Some(path) = explicit.filter(|s| !s.trim().is_empty()) {
        candidates.push(PythonCommand { program: path.to_string(), args: vec![] });
    }
    if cfg!(windows) {
        candidates.push(PythonCommand { program: "python".into(), args: vec![] });
        candidates.push(PythonCommand { program: "py".into(), args: vec!["-3".into()] });
    } else {
        candidates.push(PythonCommand { program: "python3".into(), args: vec![] });
        candidates.push(PythonCommand { program: "python".into(), args: vec![] });
    }
    candidates
}
```

- [ ] **Step 4: Add process execution with logs**

Add a helper that runs one command, captures stdout/stderr, updates stage/progress, and stores the current child for cancellation. Use direct child processes only.

Implementation details:

- `Command::new(&program).args(&base_args).args(&step_args)`.
- `stdout(Stdio::piped())`, `stderr(Stdio::piped())`, `stdin(Stdio::null())`.
- Spawn reader threads for stdout and stderr; each line calls `push_log`.
- Store `child` in `job.current_child` before waiting.
- Clear `current_child` after wait.
- If status is non-zero, set `exit_code` and return a Chinese error containing the stage.
- Do not hold the job mutex while waiting for the child process. Lock only to update `current_child`, stage/progress, and log lines; otherwise stdout/stderr reader threads can be starved and pip output can fill a pipe.

- [ ] **Step 5: Add setup runner**

Implement `run_setup_job(app, job, args)`:

```text
stage 0.05: 准备 ASR 服务目录
stage 0.10: 检查 Python
stage 0.20: 创建虚拟环境
stage 0.35: 升级 pip
stage 0.60: 安装 faster-whisper 依赖
stage 0.85: 安装可选引擎依赖
stage 0.92: 验证引擎依赖
stage 0.97: 保存设置
stage 1.00: 完成
```

Behavior:

- Resolve packaged template from the Tauri resource path `asr-service`. Prefer `app.path().resolve("asr-service", BaseDirectory::Resource)` or an equivalent Tauri path API over manually concatenating `resource_dir()`.
- In development fallback to `current_dir()/asr-service`.
- Copy template to `managed_service_dir(app)`.
- If `args.asr_service_path` is set, use it as a source template only when it has `main.py`; still install into the managed directory.
- If `args.recreate`, delete `.venv` before creating it.
- Validate Python 3.10+ with:

```text
-c "import sys; print('.'.join(map(str, sys.version_info[:3]))); raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
```

- Run venv and pip commands from `requirements_for_profile(args.profile)`.
- Verify the selected profile by running the managed venv Python from the managed service directory:

```text
-c "from engines.registry import list_engines; import json; print(json.dumps(list_engines()))"
```

Parse the JSON and fail the job if the required engine name is not present with `available: true`. Profile-to-engine mapping is `default -> faster-whisper`, `parakeet-* -> parakeet`, and `qwen3-* -> qwen3-asr`.
- On success, call `load_settings()`, update only `asrServicePath` and `pythonPath`, and then call `save_settings()`. Do not overwrite the saved ASR engine/model/device or translation settings.

- [ ] **Step 6: Add cancellation helper**

In `cancel_asr_setup`, if `current_child` exists:

- Windows: call `taskkill /PID <pid> /T /F`, then `child.kill()` best effort.
- macOS: call `child.kill()` best effort.
- Mark status `Cancelled`, progress `None`, stage `已取消`, and error `用户已取消 ASR 引擎配置`.

## Task 4: Register Rust Commands And Sidecar Lifecycle

**Files:**
- Modify: `src-tauri/src/asr.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/asr_setup.rs`

- [ ] **Step 1: Expose a sidecar stop helper**

Add to `src-tauri/src/asr.rs`:

```rust
pub async fn stop_sidecar(state: &AsrState) {
    let mut guard = state.sidecar.lock().await;
    if let Some(mut sidecar) = guard.take() {
        sidecar.kill();
    }
}
```

- [ ] **Step 2: Add Tauri commands in `asr_setup.rs`**

Implement:

```rust
#[tauri::command]
pub async fn probe_asr_setup_environment(app: AppHandle) -> Result<AsrSetupEnvironment, String>

#[tauri::command]
pub async fn start_asr_setup(
    app: AppHandle,
    setup_state: State<'_, AsrSetupState>,
    asr_state: State<'_, crate::asr::AsrState>,
    args: StartAsrSetupArgs,
) -> Result<String, String>

#[tauri::command]
pub async fn get_asr_setup_progress(
    setup_state: State<'_, AsrSetupState>,
    job_id: String,
) -> Result<AsrSetupSnapshot, String>

#[tauri::command]
pub async fn cancel_asr_setup(
    setup_state: State<'_, AsrSetupState>,
    job_id: String,
) -> Result<(), String>
```

`start_asr_setup` must call `crate::asr::stop_sidecar(&asr_state).await` before spawning the setup worker.

- [ ] **Step 3: Register module, state, and commands**

In `src-tauri/src/lib.rs`:

```rust
mod asr_setup;
```

Add managed state:

```rust
.manage(asr_setup::AsrSetupState::default())
```

Register commands:

```rust
asr_setup::probe_asr_setup_environment,
asr_setup::start_asr_setup,
asr_setup::get_asr_setup_progress,
asr_setup::cancel_asr_setup,
```

On exit, stop setup jobs:

```rust
if let Some(state) = app_handle.try_state::<asr_setup::AsrSetupState>() {
    state.shutdown();
}
```

Add `shutdown()` to `AsrSetupState` that cancels running children best effort.

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_setup
```

Expected: all `asr_setup` tests pass.

## Task 5: Add Frontend Setup Types, Services, And Profile Helpers

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/tauri.ts`
- Create: `src/services/tauriAsrSetup.test.ts`
- Create: `src/constants/asrSetup.ts`
- Create: `src/constants/asrSetup.test.ts`

- [ ] **Step 1: Add types**

Append to `src/types/index.ts`:

```ts
export type AsrSetupProfile =
  | "default"
  | "parakeet-cpu"
  | "parakeet-cuda"
  | "qwen3-cpu"
  | "qwen3-cuda";

export type AsrSetupStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface StartAsrSetupArgs {
  profile: AsrSetupProfile;
  recreate?: boolean;
  pythonPath?: string | null;
  asrServicePath?: string | null;
}

export interface AsrSetupSnapshot {
  id: string;
  status: AsrSetupStatus;
  profile: AsrSetupProfile;
  stage: string;
  progress: number | null;
  logTail: string[];
  exitCode?: number | null;
  error: string | null;
}

export interface AsrSetupEnvironment {
  serviceTemplatePath?: string | null;
  managedServicePath: string;
  pythonPath?: string | null;
  pythonVersion?: string | null;
  pythonOk: boolean;
  venvPath: string;
  venvExists: boolean;
  hasNvidiaGpu: boolean;
}
```

- [ ] **Step 2: Add Tauri wrappers**

Import the new types in `src/services/tauri.ts` and add:

```ts
export async function probeAsrSetupEnvironment(): Promise<AsrSetupEnvironment> {
  return invoke<AsrSetupEnvironment>("probe_asr_setup_environment");
}

export async function startAsrSetup(args: StartAsrSetupArgs): Promise<string> {
  return invoke<string>("start_asr_setup", { args });
}

export async function getAsrSetupProgress(
  jobId: string,
): Promise<AsrSetupSnapshot> {
  return invoke<AsrSetupSnapshot>("get_asr_setup_progress", { jobId });
}

export async function cancelAsrSetup(jobId: string): Promise<void> {
  await invoke("cancel_asr_setup", { jobId });
}
```

- [ ] **Step 3: Add profile helper**

Create `src/constants/asrSetup.ts`:

```ts
import type { AsrSetupEnvironment, AsrSetupProfile } from "../types";

export function resolveAsrSetupProfile(
  engine: string,
  device: string,
  env?: Pick<AsrSetupEnvironment, "hasNvidiaGpu"> | null,
): AsrSetupProfile {
  if (engine === "parakeet") {
    if (device === "cuda") return "parakeet-cuda";
    if (device === "cpu") return "parakeet-cpu";
    return env?.hasNvidiaGpu ? "parakeet-cuda" : "parakeet-cpu";
  }
  if (engine === "qwen3-asr") {
    if (device === "cuda") return "qwen3-cuda";
    if (device === "cpu") return "qwen3-cpu";
    return env?.hasNvidiaGpu ? "qwen3-cuda" : "qwen3-cpu";
  }
  return "default";
}

export const ASR_SETUP_PROFILE_LABEL: Record<AsrSetupProfile, string> = {
  default: "faster-whisper 默认依赖",
  "parakeet-cpu": "Parakeet CPU 依赖",
  "parakeet-cuda": "Parakeet CUDA 依赖",
  "qwen3-cpu": "Qwen3-ASR CPU 依赖",
  "qwen3-cuda": "Qwen3-ASR CUDA 依赖",
};
```

- [ ] **Step 4: Add service wrapper tests**

Create `src/services/tauriAsrSetup.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const { invoke } = await import("@tauri-apps/api/core");
const {
  probeAsrSetupEnvironment,
  startAsrSetup,
  getAsrSetupProgress,
  cancelAsrSetup,
} = await import("./tauri");

describe("ASR setup Tauri wrappers", () => {
  it("calls the expected command names", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      managedServicePath: "managed",
      pythonOk: true,
      venvPath: "managed/.venv",
      venvExists: false,
      hasNvidiaGpu: false,
    });
    await probeAsrSetupEnvironment();
    expect(invoke).toHaveBeenLastCalledWith("probe_asr_setup_environment");

    vi.mocked(invoke).mockResolvedValueOnce("job-1");
    await startAsrSetup({ profile: "default", recreate: true });
    expect(invoke).toHaveBeenLastCalledWith("start_asr_setup", {
      args: { profile: "default", recreate: true },
    });

    vi.mocked(invoke).mockResolvedValueOnce({
      id: "job-1",
      status: "running",
      profile: "default",
      stage: "安装依赖",
      progress: 0.5,
      logTail: [],
      error: null,
    });
    await getAsrSetupProgress("job-1");
    expect(invoke).toHaveBeenLastCalledWith("get_asr_setup_progress", {
      jobId: "job-1",
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await cancelAsrSetup("job-1");
    expect(invoke).toHaveBeenLastCalledWith("cancel_asr_setup", {
      jobId: "job-1",
    });
  });
});
```

- [ ] **Step 5: Add helper tests**

Create `src/constants/asrSetup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAsrSetupProfile } from "./asrSetup";

describe("resolveAsrSetupProfile", () => {
  it("uses default dependencies for faster-whisper", () => {
    expect(resolveAsrSetupProfile("faster-whisper", "cuda", { hasNvidiaGpu: true })).toBe("default");
  });

  it("maps explicit CPU/CUDA devices for Parakeet", () => {
    expect(resolveAsrSetupProfile("parakeet", "cpu", { hasNvidiaGpu: true })).toBe("parakeet-cpu");
    expect(resolveAsrSetupProfile("parakeet", "cuda", { hasNvidiaGpu: false })).toBe("parakeet-cuda");
  });

  it("uses GPU probe for auto device", () => {
    expect(resolveAsrSetupProfile("qwen3-asr", "auto", { hasNvidiaGpu: true })).toBe("qwen3-cuda");
    expect(resolveAsrSetupProfile("qwen3-asr", "auto", { hasNvidiaGpu: false })).toBe("qwen3-cpu");
  });
});
```

- [ ] **Step 5: Run focused frontend test**

Run:

```bash
pnpm test -- src/constants/asrSetup.test.ts src/services/tauriAsrSetup.test.ts
```

Expected: tests pass.

## Task 6: Build The Settings Setup Panel

**Files:**
- Create: `src/components/workflow/AsrEngineSetupPanel.tsx`
- Modify: `src/components/workflow/SettingsView.tsx`

- [ ] **Step 1: Create `AsrEngineSetupPanel`**

The component props:

```ts
interface AsrEngineSetupPanelProps {
  engine: string;
  device: string;
  pythonPath?: string;
  asrServicePath?: string;
  disabled?: boolean;
  onBeforeStart?: () => Promise<void>;
  onRunningChange?: (running: boolean) => void;
  onComplete?: () => void;
}
```

Use:

- `probeAsrSetupEnvironment`
- `startAsrSetup`
- `getAsrSetupProgress`
- `cancelAsrSetup`
- `resolveAsrSetupProfile`
- `ASR_SETUP_PROFILE_LABEL`

Polling interval: `800ms`.

Before starting the job, call `onBeforeStart` so the Settings page can persist the currently selected engine/model/device. If it rejects, show `保存当前设置失败：...` and do not start setup. Call `onRunningChange(true)` when a job starts and `onRunningChange(false)` when it reaches a terminal state.

UI text:

- Button idle: `配置当前引擎依赖`
- Button running: `配置中…`
- Cancel: `取消配置`
- Checkbox: `重建虚拟环境`
- Details summary: `查看安装日志`
- Missing Python: `未检测到 Python 3.10+，请先在上方配置 Python 路径。`
- Completed: `引擎依赖配置完成`

Progress bar should use `snapshot.progress`, treating `null` as indeterminate.

- [ ] **Step 2: Mount panel in Settings**

In `SettingsView.tsx`, import `AsrEngineSetupPanel` and add local state:

```ts
const [asrSetupRefreshKey, setAsrSetupRefreshKey] = useState(0);
const [asrSetupRunning, setAsrSetupRunning] = useState(false);
```

Mount it inside `日语转录（ASR）默认` after the device field and before `ModelManager`:

```tsx
<AsrEngineSetupPanel
  engine={settings.asrEngine}
  device={settings.asrDevice}
  pythonPath={settings.pythonPath}
  asrServicePath={settings.asrServicePath}
  disabled={saving}
  onBeforeStart={async () => {
    await setSettings(settings);
    setDirty(false);
  }}
  onRunningChange={setAsrSetupRunning}
  onComplete={() => setAsrSetupRefreshKey((value) => value + 1)}
/>
```

Disable the Settings save button while setup is running:

```tsx
disabled={saving || !dirty || asrSetupRunning}
```

Force model manager to refresh after setup:

```tsx
<ModelManager
  key={`${settings.asrEngine}:${settings.asrModel}:${asrSetupRefreshKey}`}
  engine={settings.asrEngine}
  model={settings.asrModel}
/>
```

- [ ] **Step 3: Add Settings source guard test**

Create `tests/SettingsViewAsrSetup.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const settingsSource = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/SettingsView.tsx", import.meta.url)),
  "utf8",
);
const panelSource = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/AsrEngineSetupPanel.tsx", import.meta.url)),
  "utf8",
);

describe("SettingsView ASR setup", () => {
  it("mounts the ASR setup panel near ASR defaults", () => {
    expect(settingsSource).toContain("AsrEngineSetupPanel");
    expect(settingsSource).toContain("日语转录（ASR）默认");
  });

  it("uses Chinese setup labels and no emoji UI", () => {
    expect(panelSource).toContain("配置当前引擎依赖");
    expect(panelSource).toContain("查看安装日志");
    expect(panelSource).toContain("重建虚拟环境");
    expect(panelSource).not.toMatch(/[🚀✅❌⚠️]/u);
  });
});
```

- [ ] **Step 4: Run focused frontend tests**

Run:

```bash
pnpm test -- tests/SettingsViewAsrSetup.test.ts src/constants/asrSetup.test.ts
```

Expected: tests pass.

## Task 7: Add Transcribe Page Dependency Guidance

**Files:**
- Modify: `src/components/workflow/TranscribeView.tsx`
- Create: `tests/TranscribeViewAsrSetup.test.ts`

- [ ] **Step 1: Track unavailable selected engine**

Add a derived boolean near `percent`:

```ts
const selectedEngineUnavailable =
  engines?.find((item) => item.name === engine)?.available === false;
```

- [ ] **Step 2: Add settings navigation action**

Under the existing engine status row in Step 2, render:

```tsx
{selectedEngineUnavailable && !transcribing && (
  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
    <span className="text-warning">
      当前引擎依赖未安装。请先在设置中配置引擎依赖。
    </span>
    <button
      type="button"
      onClick={() => setStep("settings")}
      className="rounded-md border border-warning/50 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20"
    >
      前往设置
    </button>
  </div>
)}
```

- [ ] **Step 3: Disable start when engine is unavailable**

Change the `开始转录` button disabled condition from:

```tsx
disabled={!audioReady}
```

to:

```tsx
disabled={!audioReady || selectedEngineUnavailable}
```

- [ ] **Step 4: Add source guard test**

Create `tests/TranscribeViewAsrSetup.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/TranscribeView.tsx", import.meta.url)),
  "utf8",
);

describe("TranscribeView ASR setup guidance", () => {
  it("guides users to Settings when engine dependencies are missing", () => {
    expect(source).toContain("selectedEngineUnavailable");
    expect(source).toContain("当前引擎依赖未安装");
    expect(source).toContain('setStep("settings")');
    expect(source).toContain("!audioReady || selectedEngineUnavailable");
  });
});
```

- [ ] **Step 5: Run focused frontend test**

Run:

```bash
pnpm test -- tests/TranscribeViewAsrSetup.test.ts
```

Expected: test passes.

## Task 8: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `asr-service/README.md`

- [ ] **Step 1: Update README ASR setup section**

In `README.md` under `### ASR sidecar 依赖`, add a paragraph before the shell-command table:

```markdown
打包后的 Windows/macOS 客户端可在「设置 → 日语转录（ASR）默认」中点击「配置当前引擎依赖」，自动复制随应用提供的 ASR 服务模板、创建本机虚拟环境并安装所选引擎依赖。模型权重仍在同一区域的「模型状态」中单独检测与下载。
```

- [ ] **Step 2: Update sidecar README install section**

In `asr-service/README.md` under `## 安装`, add:

```markdown
打包客户端优先使用应用内的一键配置流程；下面的脚本仍用于开发环境和手动排障。客户端一键配置不会安装模型权重，模型下载由桌面端「模型状态」组件单独管理。
```

- [ ] **Step 3: Verify docs mention client setup and model separation**

Run:

```bash
rg -n "配置当前引擎依赖|模型权重|一键配置" README.md asr-service/README.md
```

Expected: all terms appear.

## Task 9: Full Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run frontend tests**

Run:

```bash
pnpm test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run frontend build**

Run:

```bash
pnpm build
```

Expected: TypeScript and Vite build exit successfully. Existing Vite warnings are acceptable if exit code is `0`.

- [ ] **Step 3: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all Rust tests pass.

- [ ] **Step 4: Verify ASR resource script**

Run:

```bash
pnpm asr:prepare-resource
```

Expected: exits `0` and `src-tauri/resources/asr-service/main.py` exists.

- [ ] **Step 5: Verify release script wiring**

Run:

```bash
node -e "const s=require('./package.json').scripts; if (!s['release:local'].includes('pnpm asr:prepare-resource')) throw new Error('release:local does not prepare ASR resource'); console.log(s['release:local'])"
```

Expected: output includes `pnpm asr:prepare-resource`.

- [ ] **Step 6: Build a local desktop bundle on the current Windows/macOS release machine**

Run:

```bash
pnpm release:local
```

Expected: the command exits `0` and current-platform bundles are created under `src-tauri/target/release/bundle/`. This is the verification that `src-tauri/resources/asr-service` is accepted by Tauri resource packaging. If this cannot run because of signing, toolchain, or network prerequisites, record the exact reason and do not claim packaged ASR resources are verified.

- [ ] **Step 7: Optional local runtime smoke test**

Run only when Python 3.10+ is available and network access for pip is acceptable:

```bash
pnpm tauri dev
```

Manual smoke:

1. Open Settings.
2. Confirm the setup panel does not report `ASR 服务模板无效` or `未找到 ASR 服务模板`; this proves `probe_asr_setup_environment` can resolve the packaged `asr-service/main.py` through the Tauri resource path.
3. Select `faster-whisper`.
4. Click `配置当前引擎依赖`.
5. Confirm setup reaches completed state.
6. Confirm model status no longer reports engine unavailable.
7. Run `list_asr_engines` indirectly by visiting Transcribe and confirm `sidecar 就绪`.

If pip/network fails, record the exact error and do not mask it.

- [ ] **Step 8: Review diff**

Run:

```bash
git diff -- package.json .github/workflows/release.yml src-tauri/tauri.conf.json src-tauri/src/asr.rs src-tauri/src/asr_setup.rs src-tauri/src/lib.rs src/types/index.ts src/services/tauri.ts src/constants/asrSetup.ts src/constants/asrSetup.test.ts src/components/workflow/AsrEngineSetupPanel.tsx src/components/workflow/SettingsView.tsx src/components/workflow/TranscribeView.tsx tests/SettingsViewAsrSetup.test.ts tests/TranscribeViewAsrSetup.test.ts README.md asr-service/README.md scripts/prepare-asr-resource.mjs
```

Expected: diff only contains ASR setup, ASR resource packaging, release resource preparation, docs, and tests.

- [ ] **Step 9: Ask before committing**

Do not run `git add`, `git commit`, `git push`, or create tags unless the user explicitly asks.

Report:

- Files changed.
- Verification commands and results.
- Whether optional runtime smoke was run.
- Any residual risk, especially pip/network/CUDA environment behavior.
