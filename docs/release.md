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
- the verified `native-asr/windows-x64/cpu` runtime, manifest, checksums, and license inventory.

It does not bundle FFmpeg, a Python sidecar or interpreter, a virtual environment, Python packages, or model weights. FFmpeg and the selected exact Faster-Whisper model remain managed on-demand dependencies. The bundled manifest supports `tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, and `large-v3-turbo`; `large-v3` remains the default. See [Runtime Dependencies](./runtime-dependencies.md).

The portable staging directory also contains an empty `.portable` marker. Keep the marker beside `hikaru-sub.exe`; removing it changes where Hikaru Sub stores application data and caches.

## Local Windows build

Install Node.js 20+, pnpm 10+, and a stable Rust toolchain, then run:

```bash
pnpm install
pnpm release:local
```

`release:local` removes any stale packaged Python sidecar resource, verifies and extracts the tracked Native ASR runtime, runs the Tauri build, and creates the portable archive. It does not download FFmpeg, Python, or model weights.

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

## Continuous integration

Pull requests targeting `main` and pushes to `main` run `.github/workflows/ci.yml` on Windows. The workflow installs locked dependencies, prepares the ASR resource, runs frontend tests and typechecking, and runs Rust library tests in the release profile. Pull requests may restore the shared Rust cache, while only successful `main` runs save it for later releases.

## GitHub Release

Before tagging, push the release commit to `main` and wait for the CI workflow to succeed. Then create the tag from that tested `main` commit and push it:

```bash
git push origin main
# Wait for the main CI run to succeed.
git tag v0.1.0
git push origin v0.1.0
```

Pushing a `v*` tag runs `.github/workflows/release.yml`. The workflow can also be dispatched manually with an existing release tag. It verifies that the tag, application version, Cargo metadata, and matching `CHANGELOG.md` entry agree, restores the shared Rust cache produced on `main`, installs locked pnpm dependencies, prepares the ASR resource, builds the Tauri bundle, creates the portable zip, and uploads both Windows artifacts to a draft GitHub Release. Tests are not repeated during release packaging. The draft body is the matching changelog entry.

A tag containing `-` is marked as a prerelease. Updater metadata and signatures are not uploaded.

## Windows release validation

After `pnpm release:local`, validate the build on a Windows release machine:

1. Confirm that `bundle/nsis/` contains the Hikaru Sub setup and `bundle/portable/` contains the portable zip. A clean bundle directory must not contain a newly generated MSI.
2. Audit both artifacts: they must contain the same locked Native CPU runtime identity and the current eight-row model manifest (seven Faster-Whisper models plus exact `kotoba-tech/kotoba-whisper-v2.0-faster`). They must not contain `asr-service`, Python/venv/package trees, model weights, PDBs, GPU/VAD/CrispASR runtimes, caches, or staged `deps/` data. Setup must be `<= 80 MiB`, portable zip `<= 90 MiB`, unpacked Native runtime `<= 250 MiB`, and bundled model count must be zero.
3. Extract the portable zip and confirm that `.portable` is present. Starting `hikaru-sub.exe` must create `data/`, `cache/`, and `webview/` beside the executable, and later managed downloads must use the sibling `deps/` directory. If the directory is not writable, startup must show an error and exit without partially entering portable mode.
4. Run the NSIS setup and verify that the installation directory can be changed. When unchanged, the installer should use `%LOCALAPPDATA%\Programs\hikaru-sub`; the installed app must start from the Start menu or installation directory.
5. Initial startup and navigation to Download, Import, Transcription, and Burn must not stall. Visiting those pages may reuse cached dependency status but must not automatically download FFmpeg or a model.
6. Runtime Dependencies must report the Native CPU runtime as built-in/status-only. Entering Settings must only probe status; storage size appears only after Calculate Storage Usage. Cleanup must appear only for a measured, non-empty managed target and must never delete the bundled runtime, custom external paths, projects, subtitles, or protected current-video cache.
7. Run short Japanese transcription for every manifest-backed Faster-Whisper model and exact Kotoba, plus >10-minute Japanese smokes for `large-v2` and Kotoba. In installed and portable layouts, exercise at least one smaller Faster-Whisper model, `large-v2`, Kotoba, and the existing `large-v3` regression without Python configured. Progress, completion, output creation, cancellation, crash recovery, restart, offline cached rerun, and the active-job gate must work without starting a Python/sidecar process or accessing the model network.
8. A missing supported model must use its independent managed confirmation/download/progress flow. Wrong revision, missing file, size/hash mismatch, partial install, missing/corrupt Kotoba `preprocessor_config.json`, or escaped path must not report ready or affect another model. Qwen3, Parakeet, ReazonSpeech, CUDA, and VAD must remain visible but unavailable and must never fall back to Python or another model.
9. Native ASR and FFmpeg/ffprobe operations must not flash a terminal window. Visiting Burn must not probe source bitrate or encoders until the user requests source parameter detection.
10. Without system FFmpeg, an FFmpeg-dependent action must show a dependency confirmation containing the dependency name, expected size, managed destination, and selected source. Cancelling must stop the original action; confirming must prepare FFmpeg and resume it.
11. After transcription with managed FFmpeg, a present `deps/ffmpeg/current/ffprobe.exe` must be used to determine PlayRes instead of falling back to 1920×1080.
12. After editing subtitles, closing or switching the Working Video must warn about unsaved changes; cancelling must preserve the document, while reopening the same video after an unexpected exit must offer recovery and an explicit discard must prevent the prompt from recurring.
