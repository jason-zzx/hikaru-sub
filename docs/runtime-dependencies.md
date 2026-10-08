# Runtime Dependencies

Hikaru Sub keeps release packages small by bundling only the fixed Native ASR CPU runtimes and preparing large media tools, CUDA runtime packs, and model weights when they are needed. This document describes dependency ownership, lookup order, storage, download, and cleanup.

## Packaging model

Release artifacts include:

- the verified Native ASR Windows x64 CPU runtimes (CTranslate2 and CrispASR), manifests, checksums, and licenses;
- the locked runtime dependency source manifest;
- no ASR model weights.

They do not include:

- FFmpeg or ffprobe;
- a Python sidecar or interpreter;
- an ASR virtual environment or Python packages;
- CUDA runtime packs;
- ASR model weights.

The bundled Native runtimes are status-only: they are neither downloaded nor removed through Settings. FFmpeg, the CUDA runtime packs, and the selected exact models are prepared separately after user confirmation when missing. Supported routes are seven Faster-Whisper model IDs (`tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, `large-v3-turbo`) plus `kotoba-faster-whisper / kotoba-tech/kotoba-whisper-v2.0-faster` on CTranslate2, and exact `Qwen/Qwen3-ASR-1.7B` + `Qwen/Qwen3-ForcedAligner-0.6B`, `nvidia/parakeet-tdt_ctc-0.6b-ja` (F16), and `reazon-research/reazonspeech-nemo-v2` (Q8_0) on CrispASR; `faster-whisper / large-v3` remains the default.

## Licenses and third-party components

Hikaru Sub's own source code is licensed under Apache License 2.0. Runtime dependencies and model weights remain under their respective licenses; the application does not relicense them.

The Native runtime packages include the license inventory and required materials for their actual CTranslate2, oneDNN, pocketfft, tokenizer/Rust, CrispASR, ggml, nlohmann/json, and Microsoft Visual C++ runtime payloads. CUDA packs additionally carry the NVIDIA CUDA/cuBLAS runtime files under the included NVIDIA terms. The bundled Microsoft runtime files are excluded from Hikaru Sub's Apache-2.0 license and remain governed by Microsoft's included terms.

FFmpeg and model weights are not bundled. Any managed download or future bundled distribution must preserve the component's required license, notices, source materials, and attributions. See [Third-Party Notices](../THIRD_PARTY_NOTICES.md).

## Resolution order

Hikaru Sub resolves FFmpeg in this order:

1. the path selected in Settings;
2. the system `PATH`;
3. managed FFmpeg under `deps/ffmpeg/current`.

The production ASR route does not resolve Python. It resolves:

1. the verified CTranslate2 worker from the packaged `native-asr/windows-x64/cpu` resource, or the verified CrispASR worker from `native-asr/windows-x64/crispasr/cpu`;
2. for `cuda` devices, the verified on-demand CUDA pack under `deps/asr-runtime/cuda/current` (CTranslate2) or `deps/asr-runtime/crispasr/cuda/current` (CrispASR) — the two trees are independent and never share DLLs;
3. the selected exact ready model from the bundled manifest and managed model roots.

The repo-root Python sidecar and its Python 3.11 setup helpers remain development/historical source only. They are not production runtime dependencies and are not included in release artifacts.

## Managed storage layout

Large managed dependencies live below the application installation or portable directory:

```text
deps/
├── ffmpeg/current/
├── asr-runtime/
│   ├── cuda/current/                 # on-demand CTranslate2 CUDA pack
│   └── crispasr/cuda/current/        # on-demand CrispASR CUDA pack
├── models/
│   ├── ctranslate2/faster-whisper/<model>/<revision>/
│   ├── ctranslate2/kotoba-faster-whisper/kotoba-tech/kotoba-whisper-v2.0-faster/<revision>/
│   ├── crispasr/qwen3-asr/Qwen/Qwen3-ASR-1.7B/<pair-revision>/
│   ├── crispasr/parakeet/nvidia/parakeet-tdt_ctc-0.6b-ja/<revision>/
│   ├── crispasr/reazonspeech-nemo/reazon-research/reazonspeech-nemo-v2/<revision>/
│   ├── shared/silero/vad/<vad-revision>/
│   └── huggingface/hub/models--<owner>--<repository>/snapshots/<revision>/
└── downloads/
    └── native-asr-models/<engine>/<model>/<revision>/
```

The direct CTranslate2 and CrispASR installs are immutable after complete verification. An exact legacy Hugging Face snapshot may be reused in place only after every required file matches the bundled manifest. Wrong revisions, framework-only caches, partials, symlink/reparse escapes, and wrong size/hash files are not ready.

Old `deps/python311` or `deps/asr-service` directories from a previous release are not production dependency targets. The NSIS installer removes these managed legacy Python directories automatically after installing the new files; portable builds skip that cleanup. When residues remain, Settings surfaces a "legacy Python transcription environment" entry so the user can retry the cleanup; models, Native runtimes, system Python, and custom environments are never touched.

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

`src-tauri/resources/runtime-dependency-sources.json` defines Official and China source profiles. The production UI uses the selected profile for managed FFmpeg, CUDA runtime packs, and exact Native model downloads:

- **Official** is the default source.
- **China** uses the configured FFmpeg mirror, the mirrored CUDA pack URLs, and `https://hf-mirror.com` for model files.

Both CUDA pack source rows (Official and China) must carry the same exact size and SHA-256; mirrors must not repack the archives.

Legacy `auto` or `custom` source settings migrate silently to Official. Historical Python/PyPI source rows remain only as rollback/source metadata for the retained development code; production dependency probe, preparation, measurement, and UI do not offer Python or venv actions.

Native model URLs are derived only from the bundled model repository, immutable revision, required file row, and selected source profile. Every file downloads through bounded `.part`/staging paths and must match the exact expected size and SHA-256 before atomic publication. Custom model URLs are not accepted.

## Native ASR runtime and model flow

The production ASR route is the bundled independent Native worker. Devices are `auto`, `cpu`, or `cuda`; `auto` selects a verified device before worker launch, explicit `cuda` never falls back to CPU, and CPU never initializes CUDA. The supported routes are:

```text
faster-whisper|kotoba-faster-whisper / selected manifest model / CTranslate2 / auto|cpu|cuda / Japanese / optional shared CPU VAD
qwen3-asr / Qwen/Qwen3-ASR-1.7B + Qwen/Qwen3-ForcedAligner-0.6B / CrispASR / auto|cpu|cuda / Japanese / required shared CPU VAD
parakeet / nvidia/parakeet-tdt_ctc-0.6b-ja / CrispASR / auto|cpu|cuda / Japanese / required shared CPU VAD
reazonspeech-nemo / reazon-research/reazonspeech-nemo-v2 / CrispASR / auto|cpu|cuda / Japanese / required shared CPU VAD
```

VAD always runs on CPU, even when the main ASR model runs on CUDA: speech windows are computed on CPU first, then handed to the ASR device. The three CrispASR routes share one required CPU Silero VAD; the Faster-Whisper and Kotoba routes can optionally enable the same VAD to filter long silences.

Model support is authoritative in `src-tauri/resources/native-asr-models.json`: seven Faster-Whisper IDs (`tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, `large-v3-turbo`), exact Kotoba `kotoba-tech/kotoba-whisper-v2.0-faster`, the exact Qwen3 pair, exact Parakeet, and exact ReazonSpeech; `faster-whisper / large-v3` remains the frontend default. Vulkan is not implemented.

Settings reports the Native CPU runtimes as built-in and unmanaged. Missing or corrupt runtime files indicate an application/package problem and do not trigger a runtime download or Python fallback.

Each selected model is checked and downloaded independently. A missing exact model can be downloaded after confirmation with aggregate progress; one model's missing, corrupt, or failed state does not affect the others. Kotoba additionally requires exact non-empty `preprocessor_config.json` and a loaded 128-Mel model. The Qwen pair, Parakeet, and ReazonSpeech each form one logical download/readiness unit with the shared CPU Silero VAD: a half-pair or missing VAD never publishes as ready, and CPU/CUDA share the same weights.

Approximate managed download sizes for the exact manifest closures are:

| Model | Approximate size |
| --- | ---: |
| `tiny` | 75 MiB |
| `base` | 141 MiB |
| `small` | 464 MiB |
| `medium` | 1,460 MiB |
| `large-v2` | 2,946 MiB |
| `large-v3` | 2,948 MiB |
| `large-v3-turbo` | 1,547 MiB |
| `kotoba-tech/kotoba-whisper-v2.0-faster` | 1,446 MiB |
| `Qwen/Qwen3-ASR-1.7B` + `Qwen/Qwen3-ForcedAligner-0.6B` | 1,926 MiB |
| `nvidia/parakeet-tdt_ctc-0.6b-ja` | 1,189 MiB |
| `reazon-research/reazonspeech-nemo-v2` | 636 MiB |
| shared Silero VAD (required for CrispASR routes, optional for Faster-Whisper/Kotoba) | 1 MiB |

CUDA acceleration uses two independent on-demand packs: the CTranslate2 CUDA pack (about 545 MiB) installs under `deps/asr-runtime/cuda/current`, and the CrispASR CUDA pack (about 686 MiB) under `deps/asr-runtime/crispasr/cuda/current`. Both are verified against exact size and SHA-256 before activation. CUDA execution is verified on an RTX 3070 8 GiB; binary architecture coverage does not imply every GPU generation is hardware-tested.

Relative speed and transcription quality vary by model and audio; elapsed time and quality observations are diagnostic rather than support gates.

For development or historical sidecar diagnostics only:

```bash
pnpm asr:setup
```

Optional Python profiles and the sidecar HTTP API are documented in [ASR Service](../asr-service/README.md). They are not shipped or used by the production desktop route.

## Storage measurement and cleanup

Opening Settings probes dependency availability, paths, sources, and versions without recursively measuring directories. Storage usage is calculated only after the user requests it.

Cleanup is available only after measurement reports a non-zero managed target. It can remove managed FFmpeg, bounded managed model storage, temporary downloads, owned CUDA runtime packs, legacy Python residues, or owned application-cache directories. It must not remove the bundled Native runtimes, custom external dependencies, user videos, projects, settings, or visible subtitle documents. The legacy Python entry is reported by residue presence rather than measured size and may be cleaned even when only empty directories remain.

## Write access and elevation

Preparing or removing managed dependencies requires write access to the application's `deps/` directory. If Hikaru Sub is installed in a protected location such as `C:\Program Files`, it may request an elevated restart. If elevation is cancelled, use an administrator launch or install the application in a user-writable directory.
