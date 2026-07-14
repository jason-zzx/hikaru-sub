# Desktop Release Guide

This document owns the desktop packaging and release process for Hikaru Sub. The root README remains the short product and development entry point.

## Current release scope

| Platform | Artifacts | Status |
| --- | --- | --- |
| Windows | NSIS setup and portable zip | Supported |
| macOS | Intel and Apple Silicon bundles | Temporarily disabled pending bundle and resource validation |
| Linux | None | Deferred until the Windows and macOS release paths are stable |

Windows MSI generation is disabled. Windows artifacts are not code-signed and may trigger Microsoft SmartScreen warnings.

## Package contents

The desktop package contains:

- the `hikaru-sub` application;
- `runtime-dependency-sources.json`;
- a clean ASR service template.

It does not bundle FFmpeg, Python 3.11, an ASR virtual environment, Python engine dependencies, or model weights. Those dependencies are reused from the system or prepared after installation with user confirmation. See [Runtime Dependencies](./runtime-dependencies.md).

The portable staging directory also contains an empty `.portable` marker. Keep the marker beside `hikaru-sub.exe`; removing it changes where Hikaru Sub stores application data and caches.

## Local Windows build

Install Node.js 20+, pnpm 10+, and a stable Rust toolchain, then run:

```bash
pnpm install
pnpm release:local
```

`release:local` prepares the clean ASR resource, runs the Tauri build, and creates the portable archive. It does not download FFmpeg, Python, ASR dependencies, or model weights.

Expected artifacts:

- NSIS setup: `src-tauri/target/release/bundle/nsis/`
- portable zip: `src-tauri/target/release/bundle/portable/`

The portable archive name follows `Hikaru Sub_<version>_<arch>-portable.zip`.

## Version and release notes

The root `package.json` is the version source of truth. Tauri reads that file
directly, while the version helper keeps Cargo metadata in sync:

```bash
pnpm version:set 0.2.0
pnpm version:check
```

`version:set` updates `package.json`, `src-tauri/Cargo.toml`, and the root
package entry in `src-tauri/Cargo.lock`. It does not create a commit or tag.
Release versions support `MAJOR.MINOR.PATCH` and optional prerelease suffixes;
`+build` metadata is intentionally not used for desktop releases.

Record user-visible changes in the matching `CHANGELOG.md` entry before
tagging. Release headings must use this exact format:

```markdown
## [0.2.0] - 2026-07-14
```

Prereleases need their own exact entry, such as `## [0.2.0-rc.1] - 2026-07-14`.
Preview the extracted GitHub Release body locally with:

```bash
pnpm release:notes v0.2.0
```

## GitHub Release

Pushing a `v*` tag runs `.github/workflows/release.yml`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow can also be dispatched manually with an existing release tag. It first verifies that the tag, application version, Cargo metadata, and matching `CHANGELOG.md` entry agree. It then installs locked pnpm dependencies, prepares the ASR resource, runs frontend tests, builds the frontend, runs Rust tests, builds the Tauri bundle, creates the portable zip, and uploads both Windows artifacts to a draft GitHub Release. The draft body is the matching changelog entry.

A tag containing `-` is marked as a prerelease. Updater metadata and signatures are not uploaded.

## Windows release validation

After `pnpm release:local`, validate the build on a Windows release machine:

1. Confirm that `bundle/nsis/` contains the Hikaru Sub setup and `bundle/portable/` contains the portable zip. A clean bundle directory must not contain a newly generated MSI.
2. Extract the portable zip and confirm that `.portable` is present. Starting `hikaru-sub.exe` must create `data/`, `cache/`, and `webview/` beside the executable, and later managed downloads must use the sibling `deps/` directory. If the directory is not writable, startup must show an error and exit without partially entering portable mode.
3. Run the NSIS setup and verify that the installation directory can be changed. When unchanged, the installer should use `%LOCALAPPDATA%\Programs\hikaru-sub`; the installed app must start from the Start menu or installation directory.
4. Initial startup and navigation to Download, Import, Transcription, and Burn must not stall. Visiting those pages may reuse cached FFmpeg status but must not automatically download FFmpeg.
5. Visiting Transcription must not start the ASR sidecar. The sidecar starts only when the user checks engine status or begins transcription.
6. Visiting Burn must not probe source bitrate or encoders. Probing begins only after the user requests source parameter detection.
7. ASR checks, ASR setup, and FFmpeg or ffprobe operations must not flash a terminal window.
8. Without system FFmpeg, an FFmpeg-dependent action must show a dependency confirmation containing the dependency name, expected size, managed destination, and selected source. Cancelling must stop the original action; confirming must prepare FFmpeg and resume it.
9. Without Python 3.11, configuring an ASR engine must first request confirmation, then prepare managed Python under `deps/python311/current/` before creating the ASR virtual environment.
10. Runtime Dependency settings must support Official and China sources. Entering Settings must only probe status; storage size appears only after Calculate Storage Usage. Cleanup must appear only for a measured, non-empty managed target and must never delete custom external paths or a source-checkout `.venv`.
11. An installed build previously used after a development build must not keep pointing to the source checkout's `asr-service/.venv`. Managed setup must select `deps/asr-service/.venv`.
12. After transcription with managed FFmpeg, a present `deps/ffmpeg/current/ffprobe.exe` must be used to determine PlayRes instead of falling back to 1920×1080.
13. Model download status must show the effective source and diagnostic log. With the China source, diagnostics should report `HF_ENDPOINT=https://hf-mirror.com` and the managed Hugging Face cache under `deps/models/huggingface`.
14. Selecting `kotoba-faster-whisper` must verify Kotoba itself. An old sidecar or insufficient `faster-whisper` version must remain unavailable until setup updates the shared dependencies and service template.
