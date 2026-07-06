# Runtime Dependency Management Design

## Goal

Reduce installer size and avoid unnecessary disk usage by moving large runtime dependencies to on-demand installation. Hikaru Sub should first reuse dependencies already available on the user's machine, and only download managed copies when the user starts a workflow that actually needs them.

The first implementation targets Windows packaging and keeps macOS paths and abstractions in the design. Linux runtime packaging remains deferred until Windows and macOS releases are stable.

## User Decisions

- Missing dependencies use a confirmation dialog before downloading.
- Download source selection defaults to automatic speed-based recommendation.
- The user can manually override the download source at any time.
- Managed files live under the selected installation directory's `deps/` directory.
- Settings exposes storage usage and cleanup actions.
- FFmpeg is no longer bundled in the installer.
- Python is fixed to Python 3.11.
- A managed Python 3.11 runtime is downloaded only when no usable system Python 3.11 is found.
- Mainland China mirrors are preconfigured for FFmpeg, Python, Python packages, PyTorch wheels, and ASR models, and are used only when selected by automatic recommendation or manual override.

## Current State

At the start of this design, the implementation had separate behavior for each dependency:

- `src-tauri/src/ffmpeg.rs` resolved FFmpeg as settings path, bundled resource, then system `ffmpeg`. Release packaging downloaded FFmpeg into `src-tauri/binaries/`, and Tauri bundled it as a resource.
- `src-tauri/src/asr_setup.rs` created a managed `asr-service/.venv`, but it needed an existing system Python 3.10+ to create the virtual environment.
- `src-tauri/src/asr.rs` starts the Python sidecar using settings `pythonPath`, service-local virtual environments, then system Python launchers.
- ASR model downloads happen inside the Python sidecar through `huggingface_hub.snapshot_download`.
- Settings already has explicit FFmpeg and Python path fields, and an ASR setup panel.

The new design replaces bundled FFmpeg and user-required Python bootstrap with a unified runtime dependency manager.

## Managed Layout

All managed dependencies are stored under the installation directory selected by the user:

```text
install_dir/hikaru-sub/
  deps/
    manifest.json
    downloads/
    ffmpeg/
      current/
        ffmpeg.exe
        ffprobe.exe
    python311/
      current/
        python.exe
    asr-service/
      main.py
      requirements.txt
      .venv/
    models/
      huggingface/
```

On macOS, executable names omit `.exe` and Python paths use the platform layout supplied by the selected standalone Python distribution. The dependency manager owns this layout and exposes resolved executable paths to existing FFmpeg and ASR code. If the selected installation directory is not writable, Windows attempts a UAC elevation restart before dependency preparation or cleanup instead of falling back to `%APPDATA%`.

`downloads/` stores temporary archives and partial downloads. Completed archives are removed after extraction unless the user enables a debug retention setting.

## Dependency Resolution

### FFmpeg

Resolution order:

1. User-configured FFmpeg path.
2. System `ffmpeg` and matching `ffprobe` from `PATH`.
3. Managed FFmpeg under `install_dir/deps/ffmpeg/current`.
4. Confirmation dialog to download managed FFmpeg.

Release builds should stop running `pnpm ffmpeg:fetch` as part of `release:local` and GitHub release packaging. `src-tauri/tauri.conf.json` should stop bundling `binaries/*` once the runtime FFmpeg installer is in place.

### Python 3.11

Resolution order:

1. User-configured Python path, accepted only if `sys.version_info[:2] == (3, 11)`.
2. System Python 3.11 launchers:
   - Windows: `py -3.11`, `python`, `python3`, `python3.11`, with version verification.
   - macOS: `python3.11`, `python3`, `python`, with version verification.
3. Managed Python 3.11 under `install_dir/deps/python311/current`.
4. Confirmation dialog to download managed Python 3.11.

The setup flow uses the resolved Python 3.11 only to create or repair the managed ASR virtual environment. Python packages are installed into the managed venv, never into system Python.

### ASR Python Environment

The ASR service source template remains packaged as a Tauri resource and copied into `install_dir/deps/asr-service`. The virtual environment lives at:

```text
install_dir/hikaru-sub/deps/asr-service/.venv
```

The environment is prepared only when the user configures or uses ASR. The setup flow is:

1. Ensure Python 3.11 is available.
2. Copy or refresh the ASR service template.
3. Create or reuse `.venv`.
4. Upgrade pip using the selected package source.
5. Install `requirements.txt`.
6. Install the selected optional engine profile requirements.
7. Verify the selected engine imports and reports available.
8. Save `asrServicePath` and `pythonPath` to point at the managed ASR service and venv.

### ASR Models

Model cache should be moved under:

```text
install_dir/hikaru-sub/deps/models/huggingface
```

Sidecar commands set `HF_HOME` to that directory. Model status and model download logic continue to live in the existing `ModelManager`, but downloads use the selected Hugging Face endpoint.

## Download Sources

Add a download source setting with three modes:

- `auto`: use the source profile selected by speed probing.
- `official`: use upstream official sources.
- `china`: use preconfigured mainland China mirror sources.
- `custom`: use user-provided URLs/endpoints.

The effective source is resolved as:

```text
manual official/china/custom -> selected profile
auto -> latest successful speed recommendation
auto with no recommendation -> official
```

Source profiles contain per-dependency entries:

```json
{
  "name": "china",
  "ffmpeg": { "url": "...", "sha256": "...", "sizeBytes": 0 },
  "python311": { "url": "...", "sha256": "...", "sizeBytes": 0 },
  "pipIndexUrl": "...",
  "pipExtraIndexUrls": ["..."],
  "pytorchCpuIndexUrl": "...",
  "pytorchCudaIndexUrl": "...",
  "pytorchCpuFindLinksUrl": "...",
  "pytorchCudaFindLinksUrl": "...",
  "huggingfaceEndpoint": "..."
}
```

Binary archives must be checksum-pinned. If a built-in public mirror cannot provide stable URLs and checksums for FFmpeg or Python, the project should publish mirrored archives through its own release assets or object storage and reference those URLs in the built-in China profile.

## Speed Recommendation

Speed probing should be explicit and lightweight:

- Run during first launch after install, and when the user clicks "重新测速" in Settings.
- Probe official and China source profiles with small HEAD or range requests.
- Store the recommended profile and timestamp in settings.
- Do not block app startup or core navigation.
- If probing fails, keep the previous recommendation; if none exists, fall back to official.

The download confirmation dialog always shows the effective source and includes a shortcut to Settings for manual override.

## User Experience

When a workflow needs a missing dependency, the app shows a confirmation dialog:

- Dependency name, such as FFmpeg, Python 3.11, ASR engine dependencies, or ASR model.
- Why it is needed for the current action.
- Estimated download size.
- Managed storage location.
- Effective download source.
- Buttons: "下载并继续", "取消", and "更改下载源".

After the download or setup completes, the original action resumes when possible:

- Import or Transcribe resumes audio extraction after FFmpeg is ready.
- Download and Burn resume their FFmpeg-dependent operation.
- ASR setup continues after Python 3.11 is ready.
- Model download starts after the sidecar and selected engine are available.

Settings adds a "运行时依赖" section:

- Download source mode and speed recommendation.
- FFmpeg status and storage usage.
- Python 3.11 status and storage usage.
- ASR venv status and storage usage.
- ASR model cache usage.
- Per-item cleanup buttons.
- A full "清理未使用下载缓存" action.

## Tauri Commands

Add a new Rust module, `src-tauri/src/dependencies.rs`, with long-running job behavior similar to ASR setup and burn jobs.

Commands:

- `probe_runtime_dependencies()`: returns status for FFmpeg, Python 3.11, ASR venv, model cache, storage usage, and effective source.
- `prepare_runtime_dependency(args)`: starts a job for FFmpeg or Python 3.11.
- `get_runtime_dependency_progress(jobId)`: returns progress, stage, bytes, log tail, and final resolved path.
- `cancel_runtime_dependency(jobId)`: cancels active download or setup.
- `cleanup_runtime_dependency(args)`: removes managed FFmpeg, managed Python, ASR venv, model cache, or temporary downloads.
- `probe_download_sources()`: performs speed probing and stores the recommendation.

Existing commands should use shared dependency resolution helpers instead of duplicating lookup logic:

- `check_ffmpeg`, `extract_audio`, `get_video_info`, waveform extraction, downloads, preview frame rendering, transcode, and burn use the new FFmpeg resolver.
- `start_asr_setup` uses the new Python 3.11 resolver and downloader.
- Sidecar startup uses managed ASR paths first after setup completes.
- Model download passes mirror-related environment variables to the sidecar.

## Python Package Mirrors

For pip installs:

- Official source uses default PyPI behavior unless a package requires a dedicated index.
- China source passes `--index-url` and `--extra-index-url` according to the selected profile.
- PyTorch CPU/CUDA wheels use profile-specific PyTorch index URLs or `--find-links` wheel mirrors.

The current requirements files contain hard-coded PyTorch index lines. To support source switching cleanly, split package selection from index selection:

- Keep requirements files for package names and version bounds.
- Move index URLs into setup command arguments based on the selected source profile.
- Preserve CPU and CUDA profile separation.

## ASR Model Mirrors

The sidecar sets `HF_HOME` to the managed model cache. It also sets mirror-related environment variables before calling `huggingface_hub`:

- Official source leaves endpoint unset.
- China source sets `HF_ENDPOINT` to the configured mirror endpoint.
- Custom source sets `HF_ENDPOINT` to the user-provided endpoint.

Model cache cleanup removes only the managed `HF_HOME`, not the user's global Hugging Face cache.

## Storage Cleanup

Cleanup actions are destructive and require confirmation. Each action shows the affected path and estimated freed space.

Rules:

- Cleaning FFmpeg removes only managed FFmpeg.
- Cleaning Python removes managed Python and marks ASR venv as needing repair if it was created by that Python.
- Cleaning ASR venv removes `.venv` but keeps the ASR service template copy.
- Cleaning model cache removes managed model files only.
- Cleaning temporary downloads removes partial archives and stale extraction directories.
- User-configured external paths are never deleted.

## Error Handling

Common failure cases:

- System dependency exists but is wrong version.
- Download source is unreachable.
- Checksum mismatch.
- Archive extraction fails.
- Insufficient disk space.
- Pip install fails.
- CUDA profile selected without NVIDIA GPU.
- Hugging Face mirror lacks a requested model.

Errors should show the failing stage, the effective source, and the managed path. Download and setup logs remain available in the progress snapshot or sidecar diagnostic log.

Checksum mismatch always fails closed and deletes the downloaded archive.

## Packaging Changes

Release packaging should change as follows:

- Stop fetching FFmpeg during release packaging.
- Stop bundling `src-tauri/binaries/*`.
- Continue preparing and bundling the clean ASR service template.
- Include a built-in dependency source manifest in app resources.
- Keep Windows release output NSIS-only for now.
- Keep macOS workflow commented until bundle/resource validation resumes.

`pnpm release:local` should prepare the ASR resource and build Tauri, but should not download FFmpeg.

## Testing

Rust tests:

- FFmpeg resolver prefers user path, then system, then managed path, then missing.
- Python resolver accepts only Python 3.11.
- Managed path cleanup never deletes user-configured external paths.
- Source selection resolves manual override before auto recommendation.
- Checksum mismatch removes the downloaded archive.

Frontend tests:

- Missing dependency dialog shows dependency name, size, path, and source.
- Confirming starts a prepare job and resumes the original action.
- Settings storage section displays per-dependency usage.
- Cleanup buttons ask for confirmation.
- Download source mode can be switched manually.

Integration or manual release checks:

- Clean Windows VM with no FFmpeg: first FFmpeg-dependent action prompts for FFmpeg download.
- Clean Windows VM with no Python: ASR setup prompts for Python 3.11 download.
- Windows machine with system FFmpeg/Python 3.11: app reuses system dependencies without downloading managed copies.
- China source selected: pip and model downloads receive mirror settings.

## Migration

Existing user settings are preserved. On startup:

- Existing explicit `ffmpegPath` remains valid if the file exists.
- Existing explicit `pythonPath` remains valid only if it is Python 3.11.
- Old development paths under source checkout ASR directories are still sanitized in packaged runtime.
- If `pythonPath` points to an old managed or source-checkout `.venv` created with Python 3.10, ASR setup marks it as needing repair and recreates it with Python 3.11.

## Open Implementation Choices

The implementation plan must lock down exact binary distributions and checksums before coding the downloader:

- FFmpeg archive source for Windows and macOS.
- Python 3.11 standalone distribution for Windows and macOS.
- Built-in China mirror URLs for FFmpeg and Python binaries.
- Built-in PyPI, PyTorch, and Hugging Face mirror endpoints.

The design requires these sources to be manifest-driven so they can be updated without changing resolver logic.

## Self Review

- Scope is focused on runtime dependency management and storage cleanup.
- The design removes bundled FFmpeg and keeps ASR service source bundled.
- Python is fixed to 3.11 and system reuse remains first.
- Mainland China source support covers binary downloads, pip, PyTorch, and model downloads.
- User consent is required before downloading large dependencies.
- No user-configured external dependency path is deleted by cleanup.
