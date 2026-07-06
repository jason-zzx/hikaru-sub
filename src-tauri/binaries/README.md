# FFmpeg binaries directory

This directory is kept only as a developer fallback for old local experiments.
Release packages do not bundle files from `src-tauri/binaries/`.

Runtime resolution is now:

1. User-configured FFmpeg path.
2. System `PATH`.
3. Managed FFmpeg under the installation directory's `deps/ffmpeg/current`,
   downloaded after user confirmation.

`pnpm ffmpeg:fetch` may still place files here for manual debugging, but release
scripts and Tauri resources must not depend on this directory.
