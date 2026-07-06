# ASR Engine One-Click Setup Design

## Goal

Make ASR engine dependency setup usable from the packaged desktop client on Windows and macOS. A user should be able to install the app, choose an ASR engine in Settings, click one setup button, and end with a working sidecar environment for that engine. Linux packaging and Linux-specific setup behavior are deferred until Windows/macOS releases are stable.

This feature installs Python dependencies only. ASR model weights remain managed by the existing `ModelManager` flow because model downloads already have separate status and byte progress.

## Current State

The sidecar is already integrated at runtime:

- `src-tauri/src/asr.rs` finds `asr-service`, chooses Python candidates, starts `main.py`, and proxies `/engines`, `/transcribe`, `/models/status`, and model download routes.
- `src/components/workflow/SettingsView.tsx` stores `pythonPath`, `asrServicePath`, `asrEngine`, `asrModel`, and `asrDevice`.
- `src/components/workflow/TranscribeView.tsx` calls `listAsrEngines()` and shows a dependency warning when the selected engine is unavailable.
- `src/components/workflow/ModelManager.tsx` detects and downloads model weights after the engine dependency is available.

The missing part is install-time usability. `pnpm asr:setup` currently shells out to `bash scripts/setup-asr.sh`, which is fine for development but fragile for packaged Windows/macOS clients. The current Tauri bundle also only includes `src-tauri/binaries/*`, so installed clients do not yet have an `asr-service` template available as a packaged resource.

## Product Scope

The first version supports:

- Windows and macOS packaged clients.
- Python 3.10+ supplied by the user or found from common launcher names.
- Managed `asr-service` copy under the app data directory.
- Managed `.venv` inside that copy.
- Setup profiles:
  - default faster-whisper dependencies.
  - Parakeet CPU dependencies.
  - Parakeet CUDA dependencies.
  - Qwen3-ASR CPU dependencies.
  - Qwen3-ASR CUDA dependencies.
- A single primary button in Settings that configures the currently selected engine/device profile.
- Progress, stage text, cancellable job state, and a collapsible log tail.
- Refresh of sidecar engine status and model status after setup completes.

Out of scope:

- Installing Python itself.
- Downloading model weights inside this setup job.
- macOS notarization or privileged installers.
- Linux setup and Linux package behavior.
- CUDA driver/toolkit installation. CUDA profiles install Python wheels only and still rely on a working NVIDIA driver stack.

## Architecture

### Resource Packaging

Add a clean packaged `asr-service` template to the Tauri bundle. The template must not include `.venv`, caches, model weights, or local developer artifacts.

Use a small Node preparation script before Tauri packaging:

- Source: `asr-service/`
- Destination: `src-tauri/resources/asr-service/`
- Exclude: `.venv`, `venv`, `__pycache__`, `.pytest_cache`, model caches, logs, and transient outputs.

Then update `src-tauri/tauri.conf.json` so `bundle.resources` includes both:

- `binaries/*`
- `resources/asr-service/**`

The runtime never installs dependencies into the resource directory. App resources can be read-only or live inside a macOS `.app` bundle. Setup copies the template into an app data managed directory and runs venv/pip there.

### Managed Service Directory

Add a helper in the Rust setup module:

```text
app_data_dir()/asr-service/
```

Setup copies packaged source files from the Tauri resource path `asr-service` to this managed directory before installing dependencies. The implementation should resolve the template with Tauri's resource base directory API instead of assuming a raw filesystem layout. It overwrites source files and requirements files but preserves `.venv` unless the user selects rebuild.

Before setup starts, the Settings page saves the current ASR selection so a user can change engine/device and immediately configure it without pressing Save separately. On successful setup, global settings are updated to point the runtime at the managed directory while preserving the already-saved ASR engine, model, device, and translation settings:

- `asrServicePath = <app_data_dir>/asr-service`
- `pythonPath = <app_data_dir>/asr-service/.venv/<platform python>`

This guarantees `asr.rs::python_candidates()` uses the venv created by one-click setup. Existing manual settings still work when the user does not use managed setup.

### Rust Setup Jobs

Create `src-tauri/src/asr_setup.rs` with a long-running job manager similar to the existing download/burn patterns:

- `AsrSetupState`: stores active and terminal setup jobs.
- `start_asr_setup(args) -> jobId`: validates profile, stops the current sidecar, prepares the managed service copy, creates/reuses `.venv`, runs pip installs, verifies sidecar startup, updates settings, and returns a job id immediately.
- `get_asr_setup_progress(jobId) -> AsrSetupSnapshot`: returns status, stage, progress, log tail, exit code, and error.
- `cancel_asr_setup(jobId)`: kills the current child process if present and marks the job cancelled.
- `probe_asr_setup_environment()`: reports service template availability, managed service path, selected Python candidate, Python version if detectable, `.venv` state, and NVIDIA GPU detection.

Rust should run Python and pip directly instead of invoking Bash:

```text
python -m venv .venv
.venv/python -m pip install --upgrade pip
.venv/python -m pip install -r requirements.txt
.venv/python -m pip install -r requirements-parakeet-cpu.txt
```

This avoids Git Bash/MSYS/PowerShell portability problems on Windows and keeps cancellation simpler because each setup step is a direct child process.

### Profile Resolution

The UI sends a concrete profile:

- `default`
- `parakeet-cpu`
- `parakeet-cuda`
- `qwen3-cpu`
- `qwen3-cuda`

The UI chooses the profile from the selected engine and device:

- `faster-whisper` always maps to `default`.
- `parakeet` maps to CPU or CUDA based on selected device; `auto` uses `probe_asr_setup_environment().hasNvidiaGpu`.
- `qwen3-asr` maps to CPU or CUDA by the same rule.
- macOS never auto-selects CUDA because NVIDIA CUDA is not a supported first-path target there.

The Rust layer still validates incompatible profiles and gives a clear error if a CUDA profile is requested without `nvidia-smi`.

### Sidecar Lifecycle

Setup must not mutate a venv while the sidecar is using it. Before a setup job runs:

1. Stop the current sidecar process if it exists.
2. Run setup.
3. Verify the configured engine by running the managed venv Python in `asr-service` and checking `engines.registry.list_engines()` marks the requested engine available. This avoids duplicating the HTTP sidecar startup protocol inside the setup worker while still proving the engine imports in the same environment the sidecar will use.
4. Clear or replace sidecar state so later `list_asr_engines` and transcription calls use the new venv.

If verification fails after pip succeeds, the job fails with the sidecar startup or engine availability error in the log.

### Frontend UI

Add `src/components/workflow/AsrEngineSetupPanel.tsx` and mount it inside the `日语转录（ASR）默认` section of `SettingsView`.

The panel shows:

- The profile that will be installed for the current engine/device.
- Python/environment readiness.
- Primary button: `配置当前引擎依赖`.
- Optional checkbox: `重建虚拟环境`.
- Progress bar while running.
- Cancel button while running.
- Collapsible log tail.
- Completed/failed/cancelled status text.

The panel should not download model weights. After setup completes, `SettingsView` refreshes model status by remounting or triggering `ModelManager`.

In `TranscribeView`, keep the workflow focused. When the selected engine is unavailable, show a clear inline action:

```text
当前引擎依赖未安装。请先在设置中配置引擎依赖。
```

The action button navigates to Settings.

### TypeScript Service Boundary

Add typed wrappers in `src/services/tauri.ts`:

- `probeAsrSetupEnvironment()`
- `startAsrSetup(args)`
- `getAsrSetupProgress(jobId)`
- `cancelAsrSetup(jobId)`

Add matching types in `src/types/index.ts`:

- `AsrSetupProfile`
- `AsrSetupStatus`
- `StartAsrSetupArgs`
- `AsrSetupSnapshot`
- `AsrSetupEnvironment`

### Error Handling

The UI must surface these failures in Chinese:

- No packaged `asr-service` template found.
- No Python 3.10+ interpreter found.
- Python venv creation failed.
- pip install failed.
- CUDA profile requested but no NVIDIA GPU was detected.
- Setup cancelled.
- Setup succeeded but sidecar verification failed.

Logs should remain available for troubleshooting, but the top-level error must be concise.

### Tests

Rust unit tests cover:

- Profile to requirements-file mapping.
- Python candidate selection and version parsing.
- Managed service copy exclusion rules.
- Venv Python path by platform.
- Log tail truncation.
- Job terminal states for success, failure, and cancellation.
- Unknown job id errors.

Frontend tests cover:

- Engine/device to setup profile resolution.
- Command names and argument shape in `src/services/tauri.ts`.
- Pure profile-resolution tests for engine/device/profile mapping.
- Tauri service wrapper tests that mock `invoke` and verify command names and argument shapes.
- Lightweight Settings and Transcribe source guards for placement and Chinese UI labels.

Verification commands:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Release Interaction

The existing Windows/macOS release workflow must run the ASR resource preparation script before Tauri packaging. Local `pnpm release:local` should do the same. Linux remains deferred.

## Open Decisions

No user-facing model download is bundled into this feature. The existing model manager remains the place for model weights. This keeps the first setup button focused on making the sidecar engine importable and runnable.

## Implementation Gate

This document is a design/spec only. It has not been committed because repository instructions forbid commits without a separate explicit user request.
