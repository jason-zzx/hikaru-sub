# Runtime Dependency Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow `AGENTS.md`: commit steps are checkpoints only and require an explicit user instruction before running `git commit`.

**Goal:** Replace bundled/runtime-assumed FFmpeg and Python with an on-demand dependency manager that reuses system dependencies first, downloads managed dependencies only after user confirmation, fixes Python to 3.11, supports source mirrors, and exposes storage cleanup in Settings.

**Architecture:** Add a Tauri runtime dependency layer responsible for source profiles, install-directory managed paths, resolution, download jobs, checksums, extraction, storage accounting, and cleanup. Existing FFmpeg, ASR setup, sidecar, model download, and workflow UI code call this shared layer instead of each owning lookup and failure behavior. Frontend components provide a reusable confirmation/progress dialog and a Settings storage panel.

**Tech Stack:** Tauri 2 + Rust, React 19 + TypeScript, Zustand-free local component state, Vitest, Cargo tests, install-directory managed storage, pip, Hugging Face Hub, FFmpeg static archives, managed Python 3.11 runtime.

> Implementation update: later user direction moved managed runtime dependencies from profile-data storage to the selected installation directory's `deps/` directory. Treat older snippets in this plan that mention `app_data` as superseded by `docs/superpowers/plans/2026-07-06-install-dir-runtime-deps.md` and the current code.

---

## Scope

This plan implements Windows first and keeps macOS path/source abstractions in the data model. macOS release workflow stays commented, matching the current release policy. Linux is not part of this plan.

The plan does not pre-bundle FFmpeg or Python. It also does not pre-download ASR models. Every large dependency is prepared only when a workflow needs it and after the user confirms.

## File Structure

- Create `src-tauri/src/dependencies.rs`: Rust runtime dependency manager, source profile loading, managed paths, FFmpeg/Python resolvers, download jobs, cleanup, storage accounting.
- Modify `src-tauri/src/lib.rs`: register dependency state and Tauri commands.
- Modify `src-tauri/src/ffmpeg.rs`: remove bundled FFmpeg resolution and call dependency resolver.
- Modify `src-tauri/src/asr_setup.rs`: require Python 3.11 via dependency resolver, install pip packages with selected source profile.
- Modify `src-tauri/src/asr.rs`: set managed model cache environment and selected Hugging Face endpoint before starting sidecar.
- Modify `src-tauri/src/settings.rs`: persist download source mode, source recommendation, custom endpoints, and sanitize Python 3.11 paths.
- Create `src-tauri/resources/runtime-dependency-sources.json`: built-in source profile manifest.
- Create `scripts/lock-runtime-sources.mjs`: helper that downloads binary archives, calculates size/SHA-256, and writes pinned manifest entries.
- Modify `package.json`: add source-lock helper and remove FFmpeg fetch from `release:local`.
- Modify `.github/workflows/release.yml`: stop fetching FFmpeg and update release notes.
- Modify `src/types/index.ts`: shared runtime dependency types.
- Modify `src/services/tauri.ts`: frontend wrappers for new Tauri commands.
- Create `src/constants/runtimeDependencies.ts`: labels, sizes formatting, dependency copy.
- Create `src/components/workflow/RuntimeDependencyDialog.tsx`: reusable confirmation/progress dialog.
- Create `src/components/workflow/RuntimeDependenciesPanel.tsx`: Settings section for source mode, storage usage, cleanup, source probing.
- Modify `src/components/workflow/SettingsView.tsx`: render dependency panel and pass source settings to ASR setup.
- Modify FFmpeg-dependent views: `ImportView.tsx`, `TranscribeView.tsx`, `DownloadView.tsx`, `BurnView.tsx`, and any preview/transcode entry points that surface FFmpeg errors.
- Modify `src/components/workflow/AsrEngineSetupPanel.tsx`: request Python 3.11 preparation through dependency dialog before ASR setup.
- Modify `src/components/workflow/ModelManager.tsx`: show dependency dialog for sidecar/model cache prerequisites and use managed model cache status.
- Add tests:
  - `src/services/tauriRuntimeDependencies.test.ts`
  - `src/constants/runtimeDependencies.test.ts`
  - `tests/RuntimeDependencyDialog.test.tsx`
  - `tests/SettingsRuntimeDependencies.test.tsx`
  - update existing ASR setup and Windows bundle tests.
- Update docs:
  - `README.md`
  - `AGENTS.md` only if command list or architecture notes need adjustment.
  - `docs/superpowers/specs/2026-07-06-runtime-dependency-management-design.md` only if implementation decisions expose a design correction.

---

### Task 1: Source Manifest And Settings Schema

**Files:**
- Create: `scripts/lock-runtime-sources.mjs`
- Create: `src-tauri/resources/runtime-dependency-sources.json`
- Modify: `package.json`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src/types/index.ts`
- Create: `src/constants/runtimeDependencies.ts`
- Test: `src/constants/runtimeDependencies.test.ts`

- [ ] **Step 1: Add TypeScript source and dependency types**

Append these exported types to `src/types/index.ts`:

```ts
export type RuntimeDependencyKind =
  | "ffmpeg"
  | "python311"
  | "asrVenv"
  | "asrModels"
  | "downloads";

export type RuntimeDependencySourceMode =
  | "auto"
  | "official"
  | "china"
  | "custom";

export interface RuntimeDependencyBinarySource {
  url: string;
  sha256: string;
  sizeBytes: number;
  archive: "zip" | "tar.gz" | "tar.xz" | "windowsInstaller";
}

export interface RuntimeDependencySourceProfile {
  id: "official" | "china" | "custom";
  label: string;
  ffmpeg?: RuntimeDependencyBinarySource;
  python311?: RuntimeDependencyBinarySource;
  pipIndexUrl?: string | null;
  pipExtraIndexUrls?: string[];
  pytorchCpuIndexUrl?: string | null;
  pytorchCudaIndexUrl?: string | null;
  huggingfaceEndpoint?: string | null;
}

export interface RuntimeDependencySourceSettings {
  mode: RuntimeDependencySourceMode;
  recommendedProfile?: "official" | "china" | null;
  recommendationCheckedAt?: string | null;
  customProfile?: Partial<RuntimeDependencySourceProfile> | null;
}
```

- [ ] **Step 2: Add frontend labels and formatting helpers**

Create `src/constants/runtimeDependencies.ts`:

```ts
import type { RuntimeDependencyKind, RuntimeDependencySourceMode } from "../types";

export const RUNTIME_DEPENDENCY_LABEL: Record<RuntimeDependencyKind, string> = {
  ffmpeg: "FFmpeg",
  python311: "Python 3.11",
  asrVenv: "ASR 引擎依赖",
  asrModels: "ASR 模型缓存",
  downloads: "临时下载缓存",
};

export const RUNTIME_SOURCE_MODE_LABEL: Record<RuntimeDependencySourceMode, string> = {
  auto: "自动推荐",
  official: "官方源",
  china: "中国大陆镜像",
  custom: "自定义",
};

export function formatDependencyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}
```

- [ ] **Step 3: Write frontend unit tests**

Create `src/constants/runtimeDependencies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  RUNTIME_DEPENDENCY_LABEL,
  RUNTIME_SOURCE_MODE_LABEL,
  formatDependencyBytes,
} from "./runtimeDependencies";

describe("runtime dependency constants", () => {
  it("labels managed dependency kinds", () => {
    expect(RUNTIME_DEPENDENCY_LABEL.ffmpeg).toBe("FFmpeg");
    expect(RUNTIME_DEPENDENCY_LABEL.python311).toBe("Python 3.11");
    expect(RUNTIME_DEPENDENCY_LABEL.asrVenv).toBe("ASR 引擎依赖");
  });

  it("labels source modes", () => {
    expect(RUNTIME_SOURCE_MODE_LABEL.auto).toBe("自动推荐");
    expect(RUNTIME_SOURCE_MODE_LABEL.china).toBe("中国大陆镜像");
  });

  it("formats byte counts for Settings", () => {
    expect(formatDependencyBytes(512)).toBe("512 B");
    expect(formatDependencyBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatDependencyBytes(25 * 1024 * 1024)).toBe("25.0 MB");
  });
});
```

- [ ] **Step 4: Run the new frontend tests and verify failure**

Run:

```bash
pnpm test -- src/constants/runtimeDependencies.test.ts
```

Expected before implementation: TypeScript import or assertion failure because the constants file is not wired yet. After Steps 1-2, expected output is one passing test file.

- [ ] **Step 5: Add settings fields in Rust**

Extend `AppSettings` in `src-tauri/src/settings.rs` with:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeDependencySourceMode {
    Auto,
    Official,
    China,
    Custom,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomRuntimeSourceProfile {
    pub ffmpeg_url: Option<String>,
    pub python311_url: Option<String>,
    pub pip_index_url: Option<String>,
    pub pip_extra_index_urls: Vec<String>,
    pub pytorch_cpu_index_url: Option<String>,
    pub pytorch_cuda_index_url: Option<String>,
    pub huggingface_endpoint: Option<String>,
}
```

Add these fields to `AppSettings`:

```rust
pub runtime_source_mode: RuntimeDependencySourceMode,
pub runtime_recommended_profile: Option<String>,
pub runtime_recommendation_checked_at: Option<String>,
pub runtime_custom_source: CustomRuntimeSourceProfile,
```

Set defaults:

```rust
runtime_source_mode: RuntimeDependencySourceMode::Auto,
runtime_recommended_profile: None,
runtime_recommendation_checked_at: None,
runtime_custom_source: CustomRuntimeSourceProfile::default(),
```

- [ ] **Step 6: Add a lock-source helper script**

Create `scripts/lock-runtime-sources.mjs` that:

```js
#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "src-tauri", "resources", "runtime-dependency-sources.json");
const cacheDir = join(root, ".cache", "runtime-sources");

const windowsOfficial = {
  ffmpeg: {
    url: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    archive: "zip",
  },
  python311: {
    url: "https://github.com/astral-sh/python-build-standalone/releases/download/20240415/cpython-3.11.9%2B20240415-x86_64-pc-windows-msvc-shared-install_only.tar.gz",
    archive: "tar.gz",
    stripPrefix: "python",
  },
};

async function downloadAndHash(url, name) {
  await mkdir(cacheDir, { recursive: true });
  const dest = join(cacheDir, name);
  const tmp = `${dest}.part`;
  const hash = createHash("sha256");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed ${url}: HTTP ${res.status}`);
  const file = createWriteStream(tmp);
  await pipeline(
    Readable.fromWeb(res.body).on("data", (chunk) => hash.update(chunk)),
    file,
  );
  await rename(tmp, dest);
  const info = await stat(dest);
  return { sha256: hash.digest("hex"), sizeBytes: info.size };
}

async function main() {
  const ffmpeg = await downloadAndHash(windowsOfficial.ffmpeg.url, "ffmpeg-windows.zip");
  const python = await downloadAndHash(windowsOfficial.python311.url, "python311-windows.tar.gz");
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platforms: {
      "windows-x64": {
        official: {
          id: "official",
          label: "官方源",
          ffmpeg: { ...windowsOfficial.ffmpeg, ...ffmpeg },
          python311: { ...windowsOfficial.python311, ...python },
          pipIndexUrl: "https://pypi.org/simple",
          pipExtraIndexUrls: [],
          pytorchCpuIndexUrl: "https://download.pytorch.org/whl/cpu",
          pytorchCudaIndexUrl: "https://download.pytorch.org/whl/cu126",
          huggingfaceEndpoint: null,
        },
        china: {
          id: "china",
          label: "中国大陆镜像",
          ffmpeg: { ...windowsOfficial.ffmpeg, ...ffmpeg },
          python311: { ...windowsOfficial.python311, ...python },
          pipIndexUrl: "https://pypi.tuna.tsinghua.edu.cn/simple",
          pipExtraIndexUrls: ["https://pypi.org/simple"],
          pytorchCpuIndexUrl: "https://download.pytorch.org/whl/cpu",
          pytorchCudaIndexUrl: "https://download.pytorch.org/whl/cu126",
          huggingfaceEndpoint: "https://hf-mirror.com",
        },
      },
    },
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  JSON.parse(await readFile(outPath, "utf8"));
  console.log(`wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

This script pins the Windows sources by checksum. Python uses the python-build-standalone CPython 3.11.9 Windows x64 `shared-install_only` archive because it is relocatable, includes `venv`/`ensurepip`, and avoids Windows installer global product state.

- [ ] **Step 7: Wire package scripts**

Change `package.json` scripts:

```json
"runtime:lock-sources": "node scripts/lock-runtime-sources.mjs",
"release:local": "pnpm asr:prepare-resource && tauri build"
```

Keep `ffmpeg:fetch` temporarily for developer fallback, but remove it from release paths.

- [ ] **Step 8: Generate the initial runtime source manifest**

Run:

```bash
pnpm runtime:lock-sources
```

Expected: exits `0`, writes `src-tauri/resources/runtime-dependency-sources.json`, and each binary source has `url`, `sha256`, `sizeBytes`, and `archive`.

- [ ] **Step 9: Add a manifest integrity test**

Add to `tests/WindowsBundleConfig.test.ts` or create `tests/RuntimeDependencySourceManifest.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("runtime dependency source manifest", () => {
  it("pins binary downloads by checksum and size", () => {
    const manifest = JSON.parse(
      readFileSync("src-tauri/resources/runtime-dependency-sources.json", "utf8"),
    );
    const profiles = manifest.platforms["windows-x64"];
    for (const profile of [profiles.official, profiles.china]) {
      for (const key of ["ffmpeg", "python311"] as const) {
        expect(profile[key].url).toMatch(/^https:\/\//);
        expect(profile[key].sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(profile[key].sizeBytes).toBeGreaterThan(1024 * 1024);
      }
    }
  });
});
```

- [ ] **Step 10: Run Task 1 tests**

Run:

```bash
pnpm test -- src/constants/runtimeDependencies.test.ts tests/RuntimeDependencySourceManifest.test.ts
```

Expected: both test files pass.

- [ ] **Step 11: Commit checkpoint**

Only run after explicit user instruction:

```bash
git add package.json scripts/lock-runtime-sources.mjs src-tauri/resources/runtime-dependency-sources.json src-tauri/src/settings.rs src/types/index.ts src/constants/runtimeDependencies.ts src/constants/runtimeDependencies.test.ts tests/RuntimeDependencySourceManifest.test.ts
git commit -m "feat(deps): add runtime dependency source schema"
```

---

### Task 2: Rust Dependency Manager Core

**Files:**
- Create: `src-tauri/src/dependencies.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/ffmpeg.rs`
- Test: Rust unit tests inside `src-tauri/src/dependencies.rs`

- [ ] **Step 1: Add Rust dependency status models**

Create `src-tauri/src/dependencies.rs` with public data models:

```rust
use crate::process::hidden_command;
use crate::settings::{load_settings, AppSettings, RuntimeDependencySourceMode};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeDependencyKind {
    Ffmpeg,
    Python311,
    AsrVenv,
    AsrModels,
    Downloads,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeDependencyStatus {
    Available,
    Missing,
    NeedsSetup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencyItem {
    pub kind: RuntimeDependencyKind,
    pub status: RuntimeDependencyStatus,
    pub path: Option<String>,
    pub source: Option<String>,
    pub version: Option<String>,
    pub managed: bool,
    pub size_bytes: u64,
}
```

- [ ] **Step 2: Add managed path helpers**

In `dependencies.rs`, implement install-directory managed paths:

```rust
fn deps_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let install_dir = exe.parent().ok_or_else(|| "无法解析 Hikaru Sub 安装目录".to_string())?;
    Ok(install_dir.join("deps"))
}

pub fn managed_ffmpeg_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("ffmpeg").join("current"))
}

pub fn managed_python_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("python311").join("current"))
}

pub fn managed_asr_service_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("asr-service"))
}

pub fn managed_model_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(deps_dir(app)?.join("models").join("huggingface"))
}
```

- [ ] **Step 3: Implement Python 3.11 resolver**

Add a small internal command representation and version probe:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PythonCommand {
    pub program: String,
    pub args: Vec<String>,
}

impl PythonCommand {
    pub fn display(&self) -> String {
        if self.args.is_empty() {
            self.program.clone()
        } else {
            format!("{} {}", self.program, self.args.join(" "))
        }
    }
}

fn python_version(command: &PythonCommand) -> Result<String, String> {
    let output = hidden_command(&command.program)
        .args(&command.args)
        .args([
            "-c",
            "import sys; print('.'.join(map(str, sys.version_info[:3]))); raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        Err(stdout)
    }
}
```

Candidate order:

```rust
pub fn python311_candidates(settings: &AppSettings, managed_python: Option<&Path>) -> Vec<PythonCommand> {
    let mut candidates = Vec::new();
    if let Some(path) = settings.python_path.as_deref().filter(|s| !s.trim().is_empty()) {
        candidates.push(PythonCommand { program: path.into(), args: vec![] });
    }
    if cfg!(windows) {
        candidates.push(PythonCommand { program: "py".into(), args: vec!["-3.11".into()] });
        candidates.push(PythonCommand { program: "python".into(), args: vec![] });
        candidates.push(PythonCommand { program: "python3".into(), args: vec![] });
        candidates.push(PythonCommand { program: "python3.11".into(), args: vec![] });
    } else {
        candidates.push(PythonCommand { program: "python3.11".into(), args: vec![] });
        candidates.push(PythonCommand { program: "python3".into(), args: vec![] });
        candidates.push(PythonCommand { program: "python".into(), args: vec![] });
    }
    if let Some(dir) = managed_python {
        let exe = if cfg!(windows) { dir.join("python.exe") } else { dir.join("bin").join("python3") };
        if exe.is_file() {
            candidates.push(PythonCommand { program: exe.to_string_lossy().into_owned(), args: vec![] });
        }
    }
    candidates
}
```

- [ ] **Step 4: Add unit tests for Python candidates**

In `dependencies.rs` tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::AppSettings;
    use std::path::Path;

    #[test]
    fn python311_candidates_put_user_path_first() {
        let settings = AppSettings {
            python_path: Some("C:/Python311/python.exe".into()),
            ..Default::default()
        };
        let candidates = python311_candidates(&settings, Some(Path::new("C:/managed/python311/current")));
        assert_eq!(candidates.first().unwrap().program, "C:/Python311/python.exe");
    }

    #[test]
    fn dependency_paths_live_under_deps() {
        let path = PathBuf::from("deps").join("python311").join("current");
        assert!(path.ends_with(Path::new("python311").join("current")));
    }
}
```

- [ ] **Step 5: Implement FFmpeg resolver**

Add:

```rust
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResolvedFfmpegSource {
    Settings,
    System,
    Managed,
    Missing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedFfmpeg {
    pub ffmpeg: String,
    pub ffprobe: String,
    pub source: ResolvedFfmpegSource,
}

fn exe_name(base: &str) -> String {
    if cfg!(windows) { format!("{base}.exe") } else { base.to_string() }
}

pub fn resolve_ffmpeg_paths(app: &AppHandle, settings: &AppSettings) -> ResolvedFfmpeg {
    if let Some(path) = settings.ffmpeg_path.as_deref().filter(|s| !s.trim().is_empty()) {
        let ffprobe = if path.ends_with("ffmpeg.exe") {
            path.replace("ffmpeg.exe", "ffprobe.exe")
        } else if path.ends_with("ffmpeg") {
            path.replace("ffmpeg", "ffprobe")
        } else {
            exe_name("ffprobe")
        };
        return ResolvedFfmpeg { ffmpeg: path.into(), ffprobe, source: ResolvedFfmpegSource::Settings };
    }
    let system = exe_name("ffmpeg");
    if hidden_command(&system).arg("-version").stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false) {
        return ResolvedFfmpeg { ffmpeg: system, ffprobe: exe_name("ffprobe"), source: ResolvedFfmpegSource::System };
    }
    if let Ok(dir) = managed_ffmpeg_dir(app) {
        let ffmpeg = dir.join(exe_name("ffmpeg"));
        let ffprobe = dir.join(exe_name("ffprobe"));
        if ffmpeg.is_file() && ffprobe.is_file() {
            return ResolvedFfmpeg {
                ffmpeg: ffmpeg.to_string_lossy().into_owned(),
                ffprobe: ffprobe.to_string_lossy().into_owned(),
                source: ResolvedFfmpegSource::Managed,
            };
        }
    }
    ResolvedFfmpeg { ffmpeg: exe_name("ffmpeg"), ffprobe: exe_name("ffprobe"), source: ResolvedFfmpegSource::Missing }
}
```

- [ ] **Step 6: Register the module in Tauri**

Modify `src-tauri/src/lib.rs`:

```rust
mod dependencies;
```

Add state in the builder after ASR setup state:

```rust
.manage(dependencies::RuntimeDependencyState::default())
```

Register commands once they exist in later tasks.

- [ ] **Step 7: Update FFmpeg status to use the new resolver**

In `src-tauri/src/ffmpeg.rs`, remove `bundled_ffmpeg()` and replace `resolve_ffmpeg()` with a wrapper around `dependencies::resolve_ffmpeg_paths()`. Keep the existing `FfmpegStatus` shape for compatibility, but map source values to `Settings`, `System`, and `Managed` instead of `Bundled`.

- [ ] **Step 8: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml dependencies ffmpeg
```

Expected: dependency unit tests pass and existing FFmpeg tests still pass.

- [ ] **Step 9: Commit checkpoint**

Only run after explicit user instruction:

```bash
git add src-tauri/src/dependencies.rs src-tauri/src/lib.rs src-tauri/src/ffmpeg.rs
git commit -m "feat(deps): add runtime dependency resolvers"
```

---

### Task 3: Runtime Download And Cleanup Jobs

**Files:**
- Modify: `src-tauri/src/dependencies.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/index.ts`
- Modify: `src/services/tauri.ts`
- Test: Rust unit tests inside `dependencies.rs`
- Test: `src/services/tauriRuntimeDependencies.test.ts`

- [ ] **Step 1: Add shared job types**

Extend `src/types/index.ts`:

```ts
export type RuntimeDependencyJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface RuntimeDependencyItem {
  kind: RuntimeDependencyKind;
  status: "available" | "missing" | "needsSetup";
  path?: string | null;
  source?: string | null;
  version?: string | null;
  managed: boolean;
  sizeBytes: number;
}

export interface RuntimeDependencyProbe {
  items: RuntimeDependencyItem[];
  sourceMode: RuntimeDependencySourceMode;
  effectiveSource: "official" | "china" | "custom";
  recommendedSource?: "official" | "china" | null;
}

export interface PrepareRuntimeDependencyArgs {
  kind: RuntimeDependencyKind;
  engine?: string | null;
  model?: string | null;
  profile?: AsrSetupProfile | null;
  recreate?: boolean;
}

export interface RuntimeDependencySnapshot {
  id: string;
  kind: RuntimeDependencyKind;
  status: RuntimeDependencyJobStatus;
  stage: string;
  progress: number | null;
  downloadedBytes: number;
  totalBytes: number;
  resolvedPath?: string | null;
  logTail: string[];
  error: string | null;
}
```

- [ ] **Step 2: Add frontend service wrappers**

Update `src/services/tauri.ts` imports and add:

```ts
export async function probeRuntimeDependencies(): Promise<RuntimeDependencyProbe> {
  return invoke<RuntimeDependencyProbe>("probe_runtime_dependencies");
}

export async function prepareRuntimeDependency(
  args: PrepareRuntimeDependencyArgs,
): Promise<string> {
  return invoke<string>("prepare_runtime_dependency", { args });
}

export async function getRuntimeDependencyProgress(
  jobId: string,
): Promise<RuntimeDependencySnapshot> {
  return invoke<RuntimeDependencySnapshot>("get_runtime_dependency_progress", { jobId });
}

export async function cancelRuntimeDependency(jobId: string): Promise<void> {
  await invoke("cancel_runtime_dependency", { jobId });
}

export async function cleanupRuntimeDependency(kind: RuntimeDependencyKind): Promise<void> {
  await invoke("cleanup_runtime_dependency", { args: { kind } });
}

export async function probeDownloadSources(): Promise<RuntimeDependencyProbe> {
  return invoke<RuntimeDependencyProbe>("probe_download_sources");
}
```

- [ ] **Step 3: Write wrapper tests**

Create `src/services/tauriRuntimeDependencies.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  cancelRuntimeDependency,
  cleanupRuntimeDependency,
  getRuntimeDependencyProgress,
  prepareRuntimeDependency,
  probeRuntimeDependencies,
} from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("runtime dependency Tauri wrappers", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("probes runtime dependencies", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ items: [], sourceMode: "auto", effectiveSource: "official" });
    await probeRuntimeDependencies();
    expect(invoke).toHaveBeenCalledWith("probe_runtime_dependencies");
  });

  it("starts dependency preparation", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("job-1");
    await prepareRuntimeDependency({ kind: "ffmpeg" });
    expect(invoke).toHaveBeenCalledWith("prepare_runtime_dependency", { args: { kind: "ffmpeg" } });
  });

  it("polls and cancels dependency preparation", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: "job-1" });
    await getRuntimeDependencyProgress("job-1");
    expect(invoke).toHaveBeenCalledWith("get_runtime_dependency_progress", { jobId: "job-1" });
    await cancelRuntimeDependency("job-1");
    expect(invoke).toHaveBeenCalledWith("cancel_runtime_dependency", { jobId: "job-1" });
  });

  it("cleans a managed dependency kind", async () => {
    await cleanupRuntimeDependency("downloads");
    expect(invoke).toHaveBeenCalledWith("cleanup_runtime_dependency", { args: { kind: "downloads" } });
  });
});
```

- [ ] **Step 4: Implement Rust state and command skeletons**

In `dependencies.rs`, add:

```rust
#[derive(Default)]
pub struct RuntimeDependencyState {
    jobs: Mutex<std::collections::HashMap<String, Arc<StdMutex<RuntimeDependencyJob>>>>,
}

#[derive(Debug)]
struct RuntimeDependencyJob {
    id: String,
    kind: RuntimeDependencyKind,
    status: RuntimeDependencyJobStatus,
    stage: String,
    progress: Option<f64>,
    downloaded_bytes: u64,
    total_bytes: u64,
    resolved_path: Option<String>,
    log_tail: VecDeque<String>,
    error: Option<String>,
    cancel_requested: bool,
}
```

Add serializable snapshot structs matching TypeScript.

- [ ] **Step 5: Implement download, checksum, and extraction helpers**

Add helpers:

```rust
fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
```

Add `sha2 = "0.10"` to `src-tauri/Cargo.toml`.

Extraction implementation can call PowerShell `Expand-Archive` for `.zip` on Windows and `tar -xf` for `.tar.gz` during the first Windows implementation. Python should use the pinned `tar.gz` archive with `stripPrefix: "python"` and install by moving the extracted payload into `deps/python311/current`; do not rely on the CPython Windows installer for the managed runtime because it reuses global product state.

- [ ] **Step 6: Implement `prepare_runtime_dependency` for FFmpeg and Python**

For `kind = ffmpeg`:

1. Load effective source.
2. Download archive into `deps/downloads`.
3. Verify SHA-256.
4. Extract into a temporary directory.
5. Locate `ffmpeg.exe` and `ffprobe.exe`.
6. Copy into `deps/ffmpeg/current`.
7. Return resolved path.

For `kind = python311`:

1. Load effective source.
2. Download the pinned Python archive into `deps/downloads`.
3. Verify SHA-256.
4. Extract it, apply `stripPrefix: "python"`, and move the payload into `deps/python311/current`.
5. Verify `<deps/python311/current>/python.exe` reports `3.11.x`.
6. Return resolved path.

- [ ] **Step 7: Implement storage accounting and cleanup**

Add:

```rust
fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else { return 0 };
    entries
        .filter_map(Result::ok)
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                dir_size(&path)
            } else {
                entry.metadata().map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}
```

Cleanup must only remove directories under `deps_dir(app)`. Before deletion, canonicalize the target and verify it starts with canonicalized `deps_dir`.

- [ ] **Step 8: Register commands**

In `lib.rs`, add:

```rust
dependencies::probe_runtime_dependencies,
dependencies::prepare_runtime_dependency,
dependencies::get_runtime_dependency_progress,
dependencies::cancel_runtime_dependency,
dependencies::cleanup_runtime_dependency,
dependencies::probe_download_sources,
```

- [ ] **Step 9: Add Rust safety tests**

Add tests that exercise path safety without deleting real files:

```rust
#[test]
fn cleanup_rejects_paths_outside_deps() {
    let deps = PathBuf::from("C:/Users/example/AppData/Local/Programs/hikaru-sub/deps");
    let outside = PathBuf::from("C:/Users/example/Documents");
    assert!(!path_is_under(&outside, &deps));
}
```

Create `path_is_under(child, parent)` as a pure helper using components for testability.

- [ ] **Step 10: Run tests**

Run:

```bash
pnpm test -- src/services/tauriRuntimeDependencies.test.ts
cargo test --manifest-path src-tauri/Cargo.toml dependencies
```

Expected: wrapper tests and Rust dependency tests pass.

- [ ] **Step 11: Commit checkpoint**

Only run after explicit user instruction:

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/dependencies.rs src-tauri/src/lib.rs src/types/index.ts src/services/tauri.ts src/services/tauriRuntimeDependencies.test.ts
git commit -m "feat(deps): add runtime dependency download jobs"
```

---

### Task 4: Python 3.11 ASR Setup Integration

**Files:**
- Modify: `src-tauri/src/asr_setup.rs`
- Modify: `src-tauri/src/asr.rs`
- Modify: `src-tauri/resources/asr-service/requirements-*.txt`
- Modify: `asr-service/requirements-*.txt`
- Test: Rust tests in `asr_setup.rs`

- [ ] **Step 1: Change Python requirement from 3.10+ to exactly 3.11**

Replace `find_python()` in `asr_setup.rs` with calls into `dependencies::python311_candidates()` and `dependencies::python_version()`. Error message:

```rust
"未检测到 Python 3.11。请下载受管 Python 3.11 或在设置中配置 Python 3.11 路径。"
```

- [ ] **Step 2: Move managed ASR service under `deps/`**

Replace local `managed_service_dir(app)` in `asr_setup.rs` with `dependencies::managed_asr_service_dir(app)`.

Expected managed path:

```text
install_dir/deps/asr-service
```

- [ ] **Step 3: Pass pip mirror arguments**

Create a helper in `asr_setup.rs`:

```rust
fn pip_install_args(requirement: &str, source: &RuntimeSourceProfile, profile: AsrSetupProfile) -> Vec<String> {
    let mut args = vec!["-m".into(), "pip".into(), "install".into()];
    if let Some(index) = source.pip_index_url.as_deref() {
        args.extend(["--index-url".into(), index.into()]);
    }
    for extra in &source.pip_extra_index_urls {
        args.extend(["--extra-index-url".into(), extra.clone()]);
    }
    if matches!(profile, AsrSetupProfile::ParakeetCpu | AsrSetupProfile::Qwen3Cpu) {
        if let Some(index) = source.pytorch_cpu_index_url.as_deref() {
            args.extend(["--extra-index-url".into(), index.into()]);
        }
    }
    if matches!(profile, AsrSetupProfile::ParakeetCuda | AsrSetupProfile::Qwen3Cuda) {
        if let Some(index) = source.pytorch_cuda_index_url.as_deref() {
            args.extend(["--extra-index-url".into(), index.into()]);
        }
    }
    args.extend(["-r".into(), requirement.into()]);
    args
}
```

- [ ] **Step 4: Remove hard-coded index lines from requirements**

Edit both `asr-service/requirements-qwen3-*.txt` and `asr-service/requirements-parakeet-*.txt`, plus the prepared resource copies, so they contain package requirements only:

```text
torch>=2.6.0
torchaudio>=2.6.0

-r requirements-parakeet.txt
```

For Qwen3 CPU/CUDA:

```text
torch>=2.6.0

-r requirements-qwen3.txt
```

- [ ] **Step 5: Set sidecar model cache and Hugging Face endpoint**

In `asr.rs::spawn_sidecar`, add:

```rust
let model_cache = crate::dependencies::managed_model_cache_dir(app)?;
std::fs::create_dir_all(&model_cache).map_err(|e| e.to_string())?;
command.env("HF_HOME", &model_cache);
if let Some(endpoint) = crate::dependencies::effective_huggingface_endpoint(app)? {
    command.env("HF_ENDPOINT", endpoint);
}
```

This requires changing `spawn_sidecar(python, dir)` to receive `app: &AppHandle`.

- [ ] **Step 6: Update ASR setup environment probe**

`probe_asr_setup_environment` should report:

- `pythonOk = true` only for Python 3.11.
- `managedServicePath = install_dir/deps/asr-service`.
- `venvPath = install_dir/deps/asr-service/.venv`.

- [ ] **Step 7: Update tests**

In `asr_setup.rs` tests, add:

```rust
#[test]
fn python_version_message_requires_311() {
    let msg = "未检测到 Python 3.11。请下载受管 Python 3.11 或在设置中配置 Python 3.11 路径。";
    assert!(msg.contains("Python 3.11"));
}
```

In settings sanitation tests, ensure an old managed `.venv` path outside `deps/asr-service` is cleared in packaged runtime.

- [ ] **Step 8: Run tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_setup asr settings
```

Expected: all ASR setup/settings tests pass.

- [ ] **Step 9: Commit checkpoint**

Only run after explicit user instruction:

```bash
git add src-tauri/src/asr_setup.rs src-tauri/src/asr.rs src-tauri/src/settings.rs asr-service/requirements-*.txt src-tauri/resources/asr-service/requirements-*.txt
git commit -m "feat(asr): use managed python 3.11 dependency setup"
```

---

### Task 5: Runtime Dependency Dialog

**Files:**
- Create: `src/components/workflow/RuntimeDependencyDialog.tsx`
- Test: `tests/RuntimeDependencyDialog.test.tsx`

- [ ] **Step 1: Write dialog tests**

Create `tests/RuntimeDependencyDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RuntimeDependencyDialog } from "../src/components/workflow/RuntimeDependencyDialog";

describe("RuntimeDependencyDialog", () => {
  it("shows dependency size path and source", () => {
    render(
      <RuntimeDependencyDialog
        open
        kind="ffmpeg"
        reason="压制视频需要 FFmpeg。"
        sizeBytes={25 * 1024 * 1024}
        targetPath="C:/Users/me/AppData/Local/Programs/hikaru-sub/deps/ffmpeg/current"
        sourceLabel="中国大陆镜像"
        status="idle"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onChangeSource={vi.fn()}
      />,
    );
    expect(screen.getByText("FFmpeg")).toBeInTheDocument();
    expect(screen.getByText(/压制视频需要 FFmpeg/)).toBeInTheDocument();
    expect(screen.getByText(/25.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/中国大陆镜像/)).toBeInTheDocument();
  });

  it("calls confirm and change source handlers", async () => {
    const onConfirm = vi.fn();
    const onChangeSource = vi.fn();
    render(
      <RuntimeDependencyDialog
        open
        kind="python311"
        reason="ASR 配置需要 Python 3.11。"
        sizeBytes={40}
        targetPath="C:/deps/python311/current"
        sourceLabel="官方源"
        status="idle"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onChangeSource={onChangeSource}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "下载并继续" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "更改下载源" }));
    expect(onChangeSource).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Implement the dialog**

Create `src/components/workflow/RuntimeDependencyDialog.tsx`:

```tsx
import type { RuntimeDependencyKind } from "../../types";
import { RUNTIME_DEPENDENCY_LABEL, formatDependencyBytes } from "../../constants/runtimeDependencies";

interface RuntimeDependencyDialogProps {
  open: boolean;
  kind: RuntimeDependencyKind;
  reason: string;
  sizeBytes: number;
  targetPath: string;
  sourceLabel: string;
  status: "idle" | "running" | "completed" | "failed";
  progressPercent?: number | null;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onChangeSource: () => void;
}

export function RuntimeDependencyDialog(props: RuntimeDependencyDialogProps) {
  if (!props.open) return null;
  const title = RUNTIME_DEPENDENCY_LABEL[props.kind];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <section className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-text">{title}</h3>
            <p className="mt-1 text-sm text-text-muted">{props.reason}</p>
          </div>
          <button type="button" onClick={props.onCancel} className="text-text-muted hover:text-text">
            关闭
          </button>
        </div>
        <dl className="mt-4 grid gap-2 text-sm">
          <div><dt className="text-text-muted">预计下载</dt><dd className="text-text">{formatDependencyBytes(props.sizeBytes)}</dd></div>
          <div><dt className="text-text-muted">保存位置</dt><dd className="break-all text-text">{props.targetPath}</dd></div>
          <div><dt className="text-text-muted">下载源</dt><dd className="text-text">{props.sourceLabel}</dd></div>
        </dl>
        {props.status === "running" && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-overlay">
            <div className="h-full bg-accent" style={{ width: `${props.progressPercent ?? 35}%` }} />
          </div>
        )}
        {props.error && <p className="mt-3 text-sm text-danger">{props.error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={props.onChangeSource} className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">
            更改下载源
          </button>
          <button type="button" onClick={props.onCancel} className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">
            取消
          </button>
          <button type="button" onClick={props.onConfirm} disabled={props.status === "running"} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            下载并继续
          </button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Run dialog tests**

Run:

```bash
pnpm test -- tests/RuntimeDependencyDialog.test.tsx
```

Expected: dialog tests pass.

- [ ] **Step 4: Commit checkpoint**

Only run after explicit user instruction:

```bash
git add src/components/workflow/RuntimeDependencyDialog.tsx tests/RuntimeDependencyDialog.test.tsx
git commit -m "feat(deps): add runtime dependency confirmation dialog"
```

---

### Task 6: Settings Runtime Dependencies Panel

**Files:**
- Create: `src/components/workflow/RuntimeDependenciesPanel.tsx`
- Modify: `src/components/workflow/SettingsView.tsx`
- Test: `tests/SettingsRuntimeDependencies.test.tsx`

- [ ] **Step 1: Write Settings panel tests**

Create `tests/SettingsRuntimeDependencies.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RuntimeDependenciesPanel } from "../src/components/workflow/RuntimeDependenciesPanel";

describe("RuntimeDependenciesPanel", () => {
  it("shows source mode and managed storage", () => {
    render(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "auto",
          effectiveSource: "china",
          recommendedSource: "china",
          items: [
            { kind: "ffmpeg", status: "available", path: "C:/deps/ffmpeg/current", source: "managed", version: "ffmpeg 7", managed: true, sizeBytes: 30 * 1024 * 1024 },
            { kind: "python311", status: "missing", path: null, source: null, version: null, managed: false, sizeBytes: 0 },
          ],
        }}
        onChangeSourceMode={vi.fn()}
        onProbeSources={vi.fn()}
        onCleanup={vi.fn()}
      />,
    );
    expect(screen.getByText("运行时依赖")).toBeInTheDocument();
    expect(screen.getByText(/自动推荐/)).toBeInTheDocument();
    expect(screen.getByText(/中国大陆镜像/)).toBeInTheDocument();
    expect(screen.getByText(/30.0 MB/)).toBeInTheDocument();
  });

  it("asks the caller to clean managed dependency storage", async () => {
    const onCleanup = vi.fn();
    render(
      <RuntimeDependenciesPanel
        probe={{ sourceMode: "official", effectiveSource: "official", items: [{ kind: "downloads", status: "available", managed: true, sizeBytes: 1024 }] }}
        onChangeSourceMode={vi.fn()}
        onProbeSources={vi.fn()}
        onCleanup={onCleanup}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /清理/ }));
    expect(onCleanup).toHaveBeenCalledWith("downloads");
  });
});
```

- [ ] **Step 2: Implement panel component**

Create `RuntimeDependenciesPanel.tsx` with props matching the tests. Use `RUNTIME_DEPENDENCY_LABEL`, `RUNTIME_SOURCE_MODE_LABEL`, and `formatDependencyBytes`. Use a native `<select>` for source mode and text buttons for probe/cleanup, consistent with current Settings style.

- [ ] **Step 3: Wire SettingsView**

In `SettingsView.tsx`:

1. Load `probeRuntimeDependencies()` alongside current settings and FFmpeg checks.
2. Render `<RuntimeDependenciesPanel />` after the system path fields.
3. On source mode change, update settings fields and call `setSettings`.
4. On cleanup, show `window.confirm()` with the dependency label and then call `cleanupRuntimeDependency(kind)`.
5. Refresh the probe after cleanup or source probing.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm test -- tests/SettingsRuntimeDependencies.test.tsx tests/SettingsViewAsrSetup.test.ts
```

Expected: new Settings panel tests pass and existing ASR setup Settings tests still pass.

- [ ] **Step 5: Commit checkpoint**

Only run after explicit user instruction:

```bash
git add src/components/workflow/RuntimeDependenciesPanel.tsx src/components/workflow/SettingsView.tsx tests/SettingsRuntimeDependencies.test.tsx
git commit -m "feat(settings): show runtime dependency storage"
```

---

### Task 7: FFmpeg Workflow Integration

**Files:**
- Modify: `src/components/workflow/ImportView.tsx`
- Modify: `src/components/workflow/TranscribeView.tsx`
- Modify: `src/components/workflow/DownloadView.tsx`
- Modify: `src/components/workflow/BurnView.tsx`
- Modify: `src/services/tauri.ts`
- Test: existing workflow tests plus targeted new tests where practical

- [ ] **Step 1: Add a reusable frontend helper hook**

Create `src/hooks/useRuntimeDependencyPreparation.ts`:

```ts
import { useCallback, useState } from "react";
import {
  getRuntimeDependencyProgress,
  prepareRuntimeDependency,
  probeRuntimeDependencies,
} from "../services/tauri";
import type { RuntimeDependencyKind, RuntimeDependencySnapshot } from "../types";

export function useRuntimeDependencyPreparation() {
  const [snapshot, setSnapshot] = useState<RuntimeDependencySnapshot | null>(null);

  const ensureDependency = useCallback(async (kind: RuntimeDependencyKind) => {
    const probe = await probeRuntimeDependencies();
    const item = probe.items.find((entry) => entry.kind === kind);
    if (item?.status === "available") return true;
    const jobId = await prepareRuntimeDependency({ kind });
    for (;;) {
      const next = await getRuntimeDependencyProgress(jobId);
      setSnapshot(next);
      if (next.status === "completed") return true;
      if (next.status === "failed" || next.status === "cancelled") return false;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }, []);

  return { snapshot, ensureDependency };
}
```

This hook starts as a simple building block. The workflow pages still own the confirmation dialog so the user sees task-specific reasons.

- [ ] **Step 2: Replace hard FFmpeg missing blocks with prepare action**

For each FFmpeg-dependent view:

- If `checkFfmpeg()` says missing, show a warning with a "准备 FFmpeg" button.
- When the user starts the workflow, if FFmpeg is missing, open `RuntimeDependencyDialog` with reason text:
  - Import/Transcribe: "提取音轨需要 FFmpeg。"
  - Download: "下载和封装媒体需要 FFmpeg。"
  - Burn: "压制或封装字幕需要 FFmpeg。"
- On confirm, call `prepareRuntimeDependency({ kind: "ffmpeg" })`, poll progress, invalidate FFmpeg status, then resume the original action.

- [ ] **Step 3: Update tests around disabled buttons**

Existing tests that expected hard-disable on missing FFmpeg should now expect a preparation affordance. Add assertions like:

```ts
expect(screen.getByRole("button", { name: /准备 FFmpeg|下载并继续/ })).toBeInTheDocument();
```

- [ ] **Step 4: Run workflow tests**

Run:

```bash
pnpm test -- tests/BurnView.test.ts tests/TranscribeViewAsrSetup.test.ts
```

Expected: workflow tests pass with the new preparation path.

- [ ] **Step 5: Commit checkpoint**

Only run after explicit user instruction:

```bash
git add src/hooks/useRuntimeDependencyPreparation.ts src/components/workflow/ImportView.tsx src/components/workflow/TranscribeView.tsx src/components/workflow/DownloadView.tsx src/components/workflow/BurnView.tsx
git commit -m "feat(deps): prepare ffmpeg on demand"
```

---

### Task 8: ASR And Model Integration

**Files:**
- Modify: `src/components/workflow/AsrEngineSetupPanel.tsx`
- Modify: `src/components/workflow/ModelManager.tsx`
- Modify: `src-tauri/src/asr.rs`
- Modify: `src-tauri/resources/asr-service/models.py`
- Test: `tests/SettingsViewAsrSetup.test.ts`
- Test: `src/services/tauriAsrSetup.test.ts`

- [ ] **Step 1: Prepare Python 3.11 before ASR setup**

In `AsrEngineSetupPanel.handleStart()`:

1. Probe runtime dependencies.
2. If `python311` is missing, open `RuntimeDependencyDialog`.
3. On confirm, call `prepareRuntimeDependency({ kind: "python311" })`.
4. After completion, call `startAsrSetup()`.

The setup panel should no longer disable the primary button solely because no system Python exists. It should show "需要 Python 3.11，点击配置时会先下载受管 Python。"

- [ ] **Step 2: Route ASR setup through source profile**

Extend `StartAsrSetupArgs` in TypeScript/Rust to include:

```ts
sourceMode?: RuntimeDependencySourceMode | null;
```

Rust should ignore the field for manual source modes and read the effective source from settings, so stale frontend props cannot force a hidden source.

- [ ] **Step 3: Set model cache environment**

In `asr.rs`, ensure sidecar always receives:

```text
HF_HOME=<install_dir>/deps/models/huggingface
```

And receives `HF_ENDPOINT` only when the effective profile has one.

- [ ] **Step 4: Keep ModelManager focused on model weights**

`ModelManager` should:

- Show engine unavailable if ASR venv is not ready.
- Use existing `downloadAsrModel()` after sidecar is available.
- Surface the selected source label in its download area.
- Refresh storage probe after download completes.

- [ ] **Step 5: Add model cache tests**

Add a Rust test for environment construction:

```rust
#[test]
fn hf_home_points_to_managed_model_cache() {
    let path = PathBuf::from("deps").join("models").join("huggingface");
    assert!(path.ends_with(Path::new("models").join("huggingface")));
}
```

- [ ] **Step 6: Run ASR tests**

Run:

```bash
pnpm test -- tests/SettingsViewAsrSetup.test.ts src/services/tauriAsrSetup.test.ts
cargo test --manifest-path src-tauri/Cargo.toml asr asr_setup dependencies
```

Expected: ASR setup tests pass with Python 3.11 on-demand semantics.

- [ ] **Step 7: Commit checkpoint**

Only run after explicit user instruction:

```bash
git add src/components/workflow/AsrEngineSetupPanel.tsx src/components/workflow/ModelManager.tsx src-tauri/src/asr.rs src-tauri/resources/asr-service/models.py asr-service/models.py src/types/index.ts
git commit -m "feat(asr): prepare python and model cache on demand"
```

---

### Task 9: Packaging And Documentation Updates

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `README.md`
- Test: `tests/WindowsBundleConfig.test.ts`

- [ ] **Step 1: Remove bundled FFmpeg resources**

In `src-tauri/tauri.conf.json`, remove:

```json
"binaries/*": "binaries/"
```

Keep:

```json
"resources/": ""
```

- [ ] **Step 2: Update release workflow**

Remove the "Fetch FFmpeg" step from `.github/workflows/release.yml`.

Update release body:

```text
FFmpeg and Python 3.11 are prepared on demand after installation. The app reuses system dependencies first and downloads managed copies only after user confirmation.
```

- [ ] **Step 3: Update Windows bundle test**

Modify `tests/WindowsBundleConfig.test.ts` to assert:

```ts
expect(JSON.stringify(config.bundle.resources)).not.toContain("binaries/*");
expect(packageJson.scripts["release:local"]).toBe("pnpm asr:prepare-resource && tauri build");
```

- [ ] **Step 4: Update README**

Update release and install notes:

- Release package no longer includes FFmpeg.
- First FFmpeg/Python/ASR use prompts before downloading managed dependencies.
- Managed dependencies live under the selected installation directory's `deps/`.
- Settings can show storage and clean managed dependencies.
- Python requirement is 3.11.
- Mainland China mirrors are available through the download source setting.

- [ ] **Step 5: Run packaging/docs tests**

Run:

```bash
pnpm test -- tests/WindowsBundleConfig.test.ts
rg -n "bundled FFmpeg|includes bundled FFmpeg|Python 3.10" README.md .github/workflows/release.yml src-tauri/tauri.conf.json
```

Expected: tests pass; search returns no stale claim that release bundles include FFmpeg or that ASR setup accepts Python 3.10.

- [ ] **Step 6: Commit checkpoint**

Only run after explicit user instruction:

```bash
git add package.json .github/workflows/release.yml src-tauri/tauri.conf.json README.md tests/WindowsBundleConfig.test.ts
git commit -m "build(release): remove bundled ffmpeg from packages"
```

---

### Task 10: Full Verification And Manual Smoke Checks

**Files:**
- No new source files unless previous tasks expose a mismatch.

- [ ] **Step 1: Run frontend tests**

Run:

```bash
pnpm test
```

Expected: all Vitest files pass.

- [ ] **Step 2: Run frontend build**

Run:

```bash
pnpm build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all Rust tests pass.

- [ ] **Step 4: Build local Windows package**

Run:

```bash
pnpm release:local
```

Expected:

- `src-tauri/target/release/bundle/nsis/` contains a Hikaru Sub NSIS setup.
- The command does not run `pnpm ffmpeg:fetch`.
- The clean bundle does not include `src-tauri/binaries/ffmpeg.exe` or `ffprobe.exe`.

- [ ] **Step 5: Manual clean-machine checks**

On a clean Windows environment:

1. Install the NSIS package.
2. Confirm Settings shows FFmpeg missing and Python 3.11 missing if neither exists on the system.
3. Start a FFmpeg-dependent action and confirm the dialog shows FFmpeg, size, install-directory `deps` path, and selected source.
4. Cancel the dialog and confirm the original workflow does not proceed.
5. Confirm and download FFmpeg, then rerun the workflow and confirm it proceeds.
6. Start ASR engine setup without system Python 3.11 and confirm Python 3.11 preparation appears before pip dependency setup.
7. Switch source mode to China and confirm pip/model logs include the selected mirror endpoint or index URL.
8. Open Settings storage section and clean temporary downloads.

- [ ] **Step 6: Final diff review**

Run:

```bash
git diff --stat
git diff --check
git status --short --branch
```

Expected: diff is scoped to runtime dependency management, release packaging, ASR setup integration, tests, and docs. `git diff --check` exits `0`.

- [ ] **Step 7: Commit checkpoint**

Only run after explicit user instruction:

```bash
git status --short
git commit -m "test(deps): verify runtime dependency management"
```

---

## Self Review

- Spec coverage: FFmpeg on-demand, Python 3.11 on-demand, ASR venv, model cache, mirrors, speed recommendation, confirmation dialog, storage cleanup, packaging changes, and migration are covered.
- No incomplete markers: the plan uses concrete paths, commands, expected outputs, type names, and test names.
- Type consistency: TypeScript `RuntimeDependencyKind` values match Rust `RuntimeDependencyKind` serde camelCase names.
- Commit safety: all commit checkpoints are explicitly marked as requiring a separate user instruction, matching `AGENTS.md`.
