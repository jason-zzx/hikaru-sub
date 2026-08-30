# Runtime Dependencies

Hikaru Sub keeps release packages small by bundling only the fixed Native ASR CPU runtime and preparing large media tools and model weights when they are needed. This document describes dependency ownership, lookup order, storage, download, and cleanup.

## Packaging model

Release artifacts include:

- the verified Native ASR Windows x64 CPU runtime, manifest, checksums, and licenses;
- the locked runtime dependency source manifest;
- no ASR model weights.

They do not include:

- FFmpeg or ffprobe;
- a Python sidecar or interpreter;
- an ASR virtual environment or Python packages;
- ASR model weights.

The bundled Native runtime is status-only: it is neither downloaded nor removed through Settings. FFmpeg and the selected exact Faster-Whisper model are prepared separately after user confirmation when missing. Supported model IDs are `tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, and `large-v3-turbo`; `large-v3` remains the default.

## Licenses and third-party components

Hikaru Sub's own source code is licensed under Apache License 2.0. Runtime dependencies and model weights remain under their respective licenses; the application does not relicense them.

The Native runtime package includes the license inventory and required materials for its actual CTranslate2, oneDNN, pocketfft, tokenizer/Rust, nlohmann/json, and Microsoft Visual C++ runtime payload. The bundled Microsoft runtime files are excluded from Hikaru Sub's Apache-2.0 license and remain governed by Microsoft's included terms.

FFmpeg and model weights are not bundled. Any managed download or future bundled distribution must preserve the component's required license, notices, source materials, and attributions. See [Third-Party Notices](../THIRD_PARTY_NOTICES.md).

## Resolution order

Hikaru Sub resolves FFmpeg in this order:

1. the path selected in Settings;
2. the system `PATH`;
3. managed FFmpeg under `deps/ffmpeg/current`.

The production ASR route does not resolve Python. It resolves:

1. the verified `hikaru-asr-windows-x64-cpu-v2` worker from the packaged `native-asr/windows-x64/cpu` resource;
2. the selected exact ready Faster-Whisper model from the seven-row bundled manifest and managed model roots.

The repo-root Python sidecar and its Python 3.11 setup helpers remain development/historical rollback source for one stable release cycle. They are not production runtime dependencies and are not included in release artifacts.

## Managed storage layout

Large managed dependencies live below the application installation or portable directory:

```text
deps/
├── ffmpeg/current/
├── models/
│   ├── ctranslate2/faster-whisper/<model>/<revision>/
│   └── huggingface/hub/models--<owner>--<repository>/snapshots/<revision>/
└── downloads/
    └── native-asr-models/faster-whisper/<model>/<revision>/
```

The direct CTranslate2 install is immutable after complete verification. An exact legacy Hugging Face snapshot may be reused in place only after every required file matches the bundled manifest. Wrong revisions, framework-only caches, partials, symlink/reparse escapes, and wrong size/hash files are not ready.

Old `deps/python311` or `deps/asr-service` directories from a previous release are not production dependency targets. The Native cutover does not delete them automatically; rollback and user-data safety take precedence.

### Installed mode

Installed builds use the operating system's application data locations for settings and `<LocalAppData>/com.hikaru.sub/cache` for working caches. Managed FFmpeg, models, and downloads still live in the installation directory's `deps/` tree.

### Portable mode

Portable mode is enabled only when `.portable` exists beside `hikaru-sub.exe`. The application creates these sibling directories:

```text
data/       # settings and application data
cache/      # working media caches
webview/    # WebView2 user data
deps/       # managed FFmpeg, models, and downloads
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

`src-tauri/resources/runtime-dependency-sources.json` defines Official and China source profiles. The production UI uses the selected profile for managed FFmpeg and exact Native model downloads:

- **Official** is the default source.
- **China** uses the configured FFmpeg mirror and `https://hf-mirror.com` for model files.

Legacy `auto` or `custom` source settings migrate silently to Official. Historical Python/PyPI source rows remain only as rollback/source metadata for the retained development code; production dependency probe, preparation, measurement, and UI do not offer Python or venv actions.

Native model URLs are derived only from the bundled model repository, immutable revision, required file row, and selected source profile. Every file downloads through bounded `.part`/staging paths and must match the exact expected size and SHA-256 before atomic publication. Custom model URLs are not accepted.

## Native ASR runtime and model flow

The production ASR route is the bundled independent Native worker with exactly:

```text
faster-whisper / selected manifest model / CTranslate2 / auto|cpu / Japanese / no VAD
```

Model support is authoritative in `src-tauri/resources/native-asr-models.json`: `tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, and `large-v3-turbo`; `large-v3` remains the frontend default.

Settings reports the Native CPU runtime as built-in and unmanaged. Missing or corrupt runtime files indicate an application/package problem and do not trigger a runtime download or Python fallback.

Each selected Faster-Whisper model is checked and downloaded independently. A missing exact model can be downloaded after confirmation with aggregate progress; one model's missing, corrupt, or failed state does not affect the others. Kotoba, Qwen3, Parakeet, ReazonSpeech, CUDA/Vulkan, and Native VAD remain unavailable until their independent follow-up tasks qualify them.

Approximate managed download sizes for the exact four-file closures are:

| Model | Approximate size |
| --- | ---: |
| `tiny` | 75 MiB |
| `base` | 141 MiB |
| `small` | 464 MiB |
| `medium` | 1,460 MiB |
| `large-v2` | 2,947 MiB |
| `large-v3` | 2,948 MiB |
| `large-v3-turbo` | 1,547 MiB |

All production models are CPU-only in this release. Relative speed and transcription quality vary by model and audio; Python parity and a full quality matrix are diagnostic rather than support gates.

For development or historical sidecar diagnostics only:

```bash
pnpm asr:setup
```

Optional Python profiles and the sidecar HTTP API are documented in [ASR Service](../asr-service/README.md). They are not shipped or used by the production desktop route.

## Storage measurement and cleanup

Opening Settings probes dependency availability, paths, sources, and versions without recursively measuring directories. Storage usage is calculated only after the user requests it.

Cleanup is available only after measurement reports a non-zero managed target. It can remove managed FFmpeg, bounded managed model storage, temporary downloads, or owned application-cache directories. It must not remove the bundled Native runtime, old Python/sidecar directories automatically, custom external dependencies, user videos, projects, settings, or visible subtitle documents.

## Write access and elevation

Preparing or removing managed dependencies requires write access to the application's `deps/` directory. If Hikaru Sub is installed in a protected location such as `C:\Program Files`, it may request an elevated restart. If elevation is cancelled, use an administrator launch or install the application in a user-writable directory.
