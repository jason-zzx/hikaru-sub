# Runtime Dependencies

Hikaru Sub keeps release packages small by preparing large media and ASR dependencies only when they are needed. This document describes dependency ownership, lookup order, storage, setup, and cleanup.

## Packaging model

Release artifacts include a clean ASR service template and a locked dependency-source manifest. They do not include:

- FFmpeg or ffprobe;
- Python 3.11;
- the ASR virtual environment or Python packages;
- ASR model weights.

An operation that needs a missing managed dependency asks for confirmation before downloading it. Model weights are prepared separately from ASR engine dependencies.

## Licenses and third-party components

Hikaru Sub's own source code is licensed under Apache License 2.0. Runtime
dependencies and model weights remain under their respective licenses; the
application does not relicense them. The release package does not preinstall
FFmpeg, Python, a Python environment, or model weights, but a managed download
or a future bundled distribution must preserve the component's required
license, notices, source materials, and attributions.

See [Third-Party Notices](../THIRD_PARTY_NOTICES.md) for the maintained list
of major runtime components, model licenses, and the release-maintainer
checklist. In particular, a managed FFmpeg build with GPL components such as
`libx264` remains a separately licensed GPL component; record the exact build,
license output, corresponding source, and build configuration before
redistributing it.

## Resolution order

Hikaru Sub resolves FFmpeg in this order:

1. the path selected in Settings;
2. the system `PATH`;
3. managed FFmpeg under `deps/ffmpeg/current`.

Python is restricted to Python 3.11 and is resolved in this order:

1. the path selected in Settings;
2. a system Python 3.11 interpreter, including supported platform launchers;
3. managed Python under `deps/python311/current`.

Custom and system dependencies are external: Hikaru Sub may use them, but storage cleanup must not delete them.

## Managed storage layout

Large managed dependencies live below the application installation or portable directory:

```text
deps/
├── ffmpeg/current/
├── python311/current/
├── asr-service/.venv/
├── models/huggingface/
└── downloads/
```

The ASR service directory also contains `asr-debug.log` when diagnostics are enabled. Temporary dependency archives belong in `deps/downloads/`.

### Installed mode

Installed builds use the operating system's application data locations for settings and `<LocalAppData>/com.hikaru.sub/cache` for working caches. Managed dependencies still live in the installation directory's `deps/` tree.

### Portable mode

Portable mode is enabled only when `.portable` exists beside `hikaru-sub.exe`. The application creates these sibling directories:

```text
data/       # settings and application data
cache/      # working media caches
webview/    # WebView2 user data
deps/       # managed runtime dependencies
```

The portable directory must be writable. If initialization fails, Hikaru Sub reports a fatal startup error and exits without locking the process into portable mode.

`tauri-plugin-persisted-scope` may still leave a small scope file in the system application-data directory. Hikaru Sub does not rewrite global `APPDATA` or `LOCALAPPDATA` environment variables to suppress that file.

## Working cache

The application cache owns only generated working data and media:

- `workspace/` for per-video audio, burn input, and dirty subtitle recovery snapshots (`subtitle.recovery.json`);
- `transcode/` for playback proxy videos;
- `preview/` for diagnostic subtitle frames;
- `clip-frames/` for clipping previews.

Dirty subtitle documents are periodically written to the current video's workspace as a recovery snapshot. When the same Working Video is opened again, Hikaru Sub can restore or discard the snapshot. A successful save or an explicit discard removes it; an unexpected exit leaves it available for recovery. The snapshot is cache data, not a user-visible ASS document or a saved project.

Installed builds use `<LocalAppData>/com.hikaru.sub/cache`; portable builds use the sibling `cache/` directory. Older same-named directories directly below `com.hikaru.sub/` are not part of current storage measurement or cleanup.

Cleanup may preserve cache entries associated with the current Working Video, including its workspace and recovery snapshot. User videos and visible `.transcribed.ass` or `.translated.ass` files are never application-cache targets.

## Download sources and integrity

`src-tauri/resources/runtime-dependency-sources.json` defines the available source profiles and locks binary archives by SHA-256 and expected size.

- **Official** is the default source.
- **China** may provide mirrors for FFmpeg, Python, PyPI, PyTorch wheels, and Hugging Face.

Legacy `auto` or `custom` source settings migrate silently to Official. The China profile injects `HF_ENDPOINT=https://hf-mirror.com` into the ASR sidecar, while `HF_HOME` always points at the managed `deps/models/huggingface` cache.

`hf-mirror.com` may redirect traffic to the upstream Hugging Face service depending on the network exit. If a model download still fails, inspect the effective endpoint and `model_download_*` events in `asr-debug.log`, then try the Official source or a network route that can reach the selected endpoint.

## ASR environment setup

The in-app setup flow copies or refreshes the clean ASR service template, creates `deps/asr-service/.venv`, installs the selected dependency profile, and verifies the selected engine rather than only checking a shared package.

| Profile | Engines provided | Notes |
| --- | --- | --- |
| `default` | faster-whisper and kotoba-faster-whisper | Uses `requirements.txt`; Kotoba requires `faster-whisper>=1.1.1` |
| `parakeet-cpu` | Parakeet | Installs the CPU NeMo/PyTorch requirements |
| `parakeet-cuda` | Parakeet | Requires a detected NVIDIA GPU |
| `qwen3-cpu` | Qwen3-ASR | Installs the CPU Qwen/PyTorch requirements |
| `qwen3-cuda` | Qwen3-ASR | Requires a detected NVIDIA GPU |
| `reazonspeech-cpu` | ReazonSpeech NeMo | CPU torch + shared NeMo core (no torchaudio direct dep) |
| `reazonspeech-cuda` | ReazonSpeech NeMo | CUDA torch + shared NeMo core |

Both ReazonSpeech profiles install `requirements-reazonspeech.txt`; the profile selects the CPU or CUDA PyTorch wheel source.

Model weights are checked and downloaded after engine setup. Kotoba's model cache must include `preprocessor_config.json`; that requirement does not apply to ordinary faster-whisper models.

For source-checkout development, the default setup command installs the shared faster-whisper and Kotoba dependencies:

```bash
pnpm asr:setup
```

Optional engines require an explicit profile:

```bash
./scripts/setup-asr.sh parakeet-cpu
./scripts/setup-asr.sh parakeet-cuda
./scripts/setup-asr.sh qwen3-cpu
./scripts/setup-asr.sh qwen3-cuda
./scripts/setup-asr.sh reazonspeech-cpu
./scripts/setup-asr.sh reazonspeech-cuda
```

Use `./scripts/setup-asr.sh --recreate` when the development virtual environment must be rebuilt. See [ASR Service](../asr-service/README.md) for engine behavior and HTTP API details.

## Storage measurement and cleanup

Opening Settings probes dependency availability, paths, sources, and versions without recursively measuring directories. Storage usage is calculated only after the user requests it.

Cleanup is available only after measurement reports a non-zero managed target. It can remove managed FFmpeg, managed Python, the managed ASR virtual environment, managed models, temporary downloads, or owned application-cache directories. It must not remove custom external dependencies, source-checkout development environments, user videos, or visible subtitle documents.

## Write access and elevation

Preparing or removing managed dependencies requires write access to the application's `deps/` directory. If Hikaru Sub is installed in a protected location such as `C:\Program Files`, it may request an elevated restart. If elevation is cancelled, use an administrator launch or install the application in a user-writable directory.
