# Tauri / Rust Development Guidelines

> Desktop backend for Hikaru Sub (`src-tauri/`).

**Global hard rules** (git commit policy, product naming, security, portable paths, runtime dependency policy): see [`/AGENTS.md`](/AGENTS.md). Specs here document how this layer implements those rules.

---

## Overview

Tauri owns:

- File I/O, FFmpeg/ffprobe, waveform, proxy transcode
- Portable vs installed path roots (`app_paths.rs`)
- Runtime dependency probe / prepare / measure / cleanup
- ASR sidecar process lifecycle and HTTP proxying to the Python service
- Download, clip, burn jobs and local HTTP media playback server

It does **not** own ASS domain editing logic (React) or ASR model inference (Python).

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Modules under `src-tauri/src/`, capabilities, resources |
| [Command Guidelines](./command-guidelines.md) | Implement → `lib.rs` → frontend `tauri.ts` |
| [Async and Blocking](./async-and-blocking.md) | `async` commands + `spawn_blocking` for disk/CPU |
| [Paths and Runtime Deps](./paths-and-runtime-deps.md) | Portable roots, cache layout, probe vs measure |
| [Media, FFmpeg, ASR](./media-ffmpeg-asr.md) | Resolve order, media server, sidecar, download/clip/burn |
| [Quality Guidelines](./quality-guidelines.md) | `cargo test`; logging without secrets |

---

## Pre-Development Checklist

- [ ] Read [`/AGENTS.md`](/AGENTS.md) architecture boundaries
- [ ] Confirm work belongs in Rust (I/O, process, FFmpeg, paths), not React or Python
- [ ] Plan the full command wiring chain including capabilities if permissions change
- [ ] Prefer `app_paths` helpers over raw `app.path().app_config_dir()` for business data

---

## Quality Check Pointers

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Filter by test name first when iterating, then run the relevant suite.

---

**Language**: Specs in this tree are written in **English**.
